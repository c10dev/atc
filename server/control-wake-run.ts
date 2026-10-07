import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { accountFolders } from "./accounts.ts";
import { config } from "./config.ts";
import { jobIdle, loadRecycle, safeBlocksOf, type SafeFacts } from "./control-recycle.ts";
import { type ActDeps, contextOfRow, type FactDeps, recycleOnce, recyclingNow, safeFactsOf } from "./control-recycle-run.ts";
import {
  allMenu,
  delivered,
  emptyRoleState,
  infoOnlyAckOf,
  launchedModeOf,
  openFlightsOf,
  planWake,
  ROLE_NAME,
  type RoleState,
  transitionWhy,
  WAKE_ROLES,
  wakeCountsOf,
  wakeEventsOf,
  wakeIdOf,
  type WakeMode,
  wakePromptOf,
  wakeResultOf,
  type WakeRole,
} from "./control-wake.ts";
import { effectiveWakeOf, loadWakeSwitch, wakeScope } from "./control-wake-switch.ts";
import { allDecisions } from "./decision-card-run.ts";
import { answerLineOf, unackedAnswers } from "./decision-card.ts";
import { readJob, settleJob } from "./job-state.ts";
import type { Snapshot } from "./model.ts";
import { readRecords, record } from "./recorder.ts";
import { checkControlWake } from "./send-checks.ts";
import { type Breaker, breakerEventOf, breakerOf, confirmOf, priorDeliveriesOf, serverLiveOf, unconfirmedOf } from "./server-send.ts";
import { type AgentRow, cachedAgentRows, configDirOfRow, controlDirOf, controlRowsOf, controlSpecOf } from "./session-control.ts";
import { deliverChecked, findSessionRecord, transcriptOf, type WriterMode, writerModeOf, writerPlaceNow } from "./session-socket.ts";
import { type Fetcher, gatherInputs } from "./squelch-run.ts";
import { readSeen } from "./tick-seen.ts";
import { SERVER_CLEARANCE_KINDS } from "./server-clearance.ts";
import { loadServerClearanceSwitch } from "./server-clearance-run.ts";

// CONTROL WAKE(ATC-557 a)의 입출력. 판단은 control-wake.ts(순수), 검사는 send-checks.ts checkControlWake, 세션에 쓰기는 session-socket.ts deliverChecked뿐이다.
// 30초마다(jobs/control-wake.ts): ① 닿은 깨움이 대화 기록에 보이는지·끝에 WAKE RESULT가 있는지 ② 역할마다(TOWER 30초, OCC 1분, MCC 2분) 판단할 일을 모아
// 새 것이 있으면 깨운다 ③ 스위치와 다른 모드로 떠 있는 세션(/loop로 뜬 세션)을 안전한 순간에 한 번 다시 띄운다(운영 서버만)

const DAY = 86_400_000;
const STATE_FILE = () => join(config.stateDir, "control-wake-state.json");
const iso = (ms: number) => new Date(ms).toISOString();
type AnyLine = { t: string; kind: string; op?: string } & Record<string, unknown>;

interface StateFile {
  seq: number;
  roles: Partial<Record<WakeRole, RoleState>>;
}
export function loadWakeState(file = STATE_FILE()): StateFile {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<StateFile>;
    return { seq: Number.isInteger(raw.seq) ? (raw.seq as number) : 0, roles: raw.roles && typeof raw.roles === "object" ? raw.roles : {} };
  } catch {
    return { seq: 0, roles: {} };
  }
}
function saveWakeState(st: StateFile, file = STATE_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(st) + "\n");
  renameSync(tmp, file);
}

export { wakeScope } from "./control-wake-switch.ts";

let lastPassAt: number | null = null;
const startedAt = Date.now();
const lastRoleRun: Partial<Record<WakeRole, number>> = {};
export const CADENCE_MS: Record<WakeRole, number> = { tower: 30_000, occ: 60_000, mcc: 120_000 }; // MCC queue는 PR마다 GitHub를 읽는다(mcc-auto와 같은 값)
const waiting: Partial<Record<WakeRole, string>> = {}; // 옮기기를 기다리는 이유(화면)
// 깨움 BREAKER가 멈췄는데 /loop로 다시 띄우지 못한 역할(CAUTION 카드, supervisor-alerts-run.ts가 읽는다)
export interface WakeFallbackStuck {
  role: string;
  why: string;
  since: string;
}
const fallbackStuck: Partial<Record<WakeRole, WakeFallbackStuck>> = {};
export const wakeFallbackStuckNow = (): WakeFallbackStuck[] => Object.values(fallbackStuck).filter((x): x is WakeFallbackStuck => Boolean(x));

const configDirs = () => accountFolders().map((f) => f.dir);

// 깨움이 살아 있나(`atcctl tick <역할>`의 /loop tick이 일을 하지 않아도 되나): 스위치 wake, job이 3분 안에 돌았고, 그 역할의 BREAKER가 켜져 있다.
// 아니면 /loop tick이 전처럼 일한다(깨움이 멈추면 /loop가 남은 세션은 귀가 먹지 않는다)
export function wakeModeLive(role: WakeRole, now = Date.now()): { live: boolean; why: string } {
  if (loadWakeSwitch()[role] !== "wake") return { live: false, why: "스위치 loop" };
  if (!serverLiveOf(lastPassAt, now)) return { live: false, why: "깨움 job이 3분 넘게 돌지 않음" };
  const b = breakerOf(readRecords(now - 30 * DAY) as unknown as AnyLine[], now, wakeScope(role));
  if (b.state !== "armed") return { live: false, why: `깨움 BREAKER ${b.state}` };
  return { live: true, why: "wake" };
}

// 시험 opt-in(ATC_SERVER_SEND_TEST=1)에서만: 진짜 TOWER·OCC·MCC 대신 이 머리를 붙인 버리는 세션을 깨운다(OS 임시 폴더 아래 cwd만, deliverChecked가 다시 본다)
const TEST_PREFIX = () => process.env.ATC_CONTROL_WAKE_TEST_PREFIX || "";
export function recipientNameOf(role: WakeRole, mode: WriterMode): string | null {
  if (mode === "production") return ROLE_NAME[role];
  const p = TEST_PREFIX();
  return /^[A-Za-z][A-Za-z0-9_-]{1,30}$/.test(p) ? `${p}${ROLE_NAME[role]}` : null;
}
function roleRowOf(role: WakeRole, rows: readonly AgentRow[], mode: WriterMode): AgentRow | null {
  if (mode === "production") {
    const spec = controlSpecOf(ROLE_NAME[role]);
    if (!spec) return null;
    const live = controlRowsOf(spec, [...rows], controlDirOf(spec));
    const bg = live.filter((r) => r.kind === "background" && r.id);
    return live.length === 1 && bg.length === 1 ? bg[0]! : null; // 두 벌이거나 데스크톱 세션이면 깨우지 않는다(오작동 "깨우지 못함"으로 보인다)
  }
  const name = recipientNameOf(role, mode);
  const hit = rows.filter((r) => !r.stale && r.kind === "background" && r.id && r.name === name);
  return hit.length === 1 ? hit[0]! : null;
}

function readTail(path: string, max = 4 << 20): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

const wakeLines = (lines: readonly AnyLine[]) => lines.filter((l) => l.kind === "control-wake");
export const RESULT_IDLE_MS = 15 * 60_000; // 보인 뒤 세션이 idle인데 이만큼 결과 줄이 없으면 unknown
export const RESULT_CAP_MS = 60 * 60_000;
export const BUSY_MS = 20 * 60_000; // 앞 깨움의 결과를 이만큼까지 기다린 뒤 다음 깨움을 보낸다

// 앞 깨움이 아직 끝나지 않았다: 닿았는데 결과·안 보임 줄이 없고 20분이 지나지 않았다
export function pendingWakeOf(lines: readonly AnyLine[], role: WakeRole, now: number): boolean {
  const mine = wakeLines(lines).filter((l) => l.role === role);
  const last = mine.filter((l) => l.op === "deliver").at(-1);
  if (!last || now - Date.parse(last.t) >= BUSY_MS) return false;
  return !mine.some((l) => (l.op === "result" || (l.op === "confirm" && l.seen === false)) && l.msgId === last.msgId);
}

// ① 확인과 결과
function confirmPass(lines: readonly AnyLine[], now: number) {
  for (const d of unconfirmedOf(lines as never, "control-wake")) {
    const role = (d as unknown as { role: WakeRole }).role;
    const seen = d.transcript ? readTail(d.transcript).includes(d.msgId) : false;
    const rec = seen ? null : findSessionRecord(d.sessionId, configDirs());
    const c = confirmOf({ seen, ageMs: now - Date.parse(d.t), session: seen ? "idle" : !rec ? "gone" : rec.status === "busy" ? "busy" : "idle" });
    if (!c) continue;
    const all = readRecords(now - 30 * DAY) as unknown as AnyLine[];
    const before = breakerOf(all, now, wakeScope(role));
    record({ t: iso(now), kind: "control-wake", op: "confirm", id: d.id, role, msgId: d.msgId, sessionId: d.sessionId, ...c });
    const after = breakerOf(readRecords(now - 30 * DAY) as unknown as AnyLine[], now, wakeScope(role));
    const event = breakerEventOf(before, after);
    if (event) {
      record({ t: iso(now), kind: "control-wake", op: "breaker", role, event, id: d.id, why: event === "trip" ? after.why : null });
      // fail safe: 멈추면 그 역할은 loop로(LAUNCH는 /loop, /loop 없이 뜬 세션은 다시 띄움), 다시 켜지면 wake로 돌아간다. 스위치가 wake일 때만 의미가 있다
      if (loadWakeSwitch()[role] === "wake") record({ t: iso(now), kind: "control-wake", op: "fallback", role, to: event === "trip" ? "loop" : "wake", why: event === "trip" ? after.why : null });
      if (event === "trip") console.error(`[atc] CONTROL WAKE breaker trip (${ROLE_NAME[role]}) — loop로 돌린다: ${after.why}`);
    }
  }
  const all = wakeLines(lines);
  const done = new Set(all.flatMap((l) => (l.op === "result" || (l.op === "confirm" && l.seen === false) ? [String(l.msgId)] : [])));
  const seenOk = new Set(all.flatMap((l) => (l.op === "confirm" && l.seen === true ? [String(l.msgId)] : [])));
  for (const d of all) {
    if (d.op !== "deliver" || done.has(String(d.msgId))) continue;
    const age = now - Date.parse(d.t);
    const res = typeof d.transcript === "string" ? wakeResultOf(readTail(d.transcript), String(d.msgId)) : null;
    const base = { t: iso(now), kind: "control-wake" as const, op: "result" as const, id: String(d.id), role: d.role as WakeRole, msgId: String(d.msgId) };
    if (res) {
      record({ ...base, result: res });
      continue;
    }
    const rec = findSessionRecord(String(d.sessionId), configDirs());
    const why = !rec ? "세션이 끝남" : age > RESULT_CAP_MS ? "60분 안에 결과 줄이 없음" : seenOk.has(String(d.msgId)) && rec.status !== "busy" && age > RESULT_IDLE_MS ? "보였고 세션이 쉬는데 결과 줄이 없음" : null;
    if (why) record({ ...base, result: "unknown", why });
  }
}

export interface WakeDeps {
  get: Fetcher; // 브리핑(서버 안의 같은 핸들러)
  ack?: (cursor: string) => Promise<unknown>; // TOWER cursor ack(ATC LOG에만 적는 사건뿐일 때)
  rows?: () => Promise<AgentRow[]>;
  deliver?: typeof deliverChecked;
  now?: () => number;
  recycle?: { facts: FactDeps; act: ActDeps }; // /loop ↔ wake 옮기기(운영 서버만)
  force?: boolean; // 시험: 역할마다의 간격을 보지 않는다
}
export interface WakeSummary {
  writer: WriterMode | null;
  woke: { role: WakeRole; id: string }[];
  failed: string[];
  refused: string[];
  missed: number;
  acked: string | null;
  transition: { role: WakeRole; result: string } | null;
}

export async function controlWakePass(s: Snapshot, deps: WakeDeps): Promise<WakeSummary> {
  const now = deps.now?.() ?? Date.now();
  const out: WakeSummary = { writer: null, woke: [], failed: [], refused: [], missed: 0, acked: null, transition: null };
  const mode = writerModeOf(writerPlaceNow());
  out.writer = mode;
  if (!mode) return out; // 시험 서버(opt-in 없음)는 아무것도 하지 않는다: 세션에 쓰지도, 기록하지도 않는다
  lastPassAt = now;
  confirmPass(readRecords(now - 2 * DAY) as unknown as AnyLine[], now);
  const sw = loadWakeSwitch();
  const clearanceSw = loadServerClearanceSwitch();
  const rows = await (deps.rows ?? (() => cachedAgentRows.get()))().catch(() => [] as AgentRow[]);
  const launches = readRecords(now - 30 * DAY) as unknown as AnyLine[];
  const lines = readRecords(now - 2 * DAY) as unknown as AnyLine[];
  const st = loadWakeState();
  for (const role of WAKE_ROLES) {
    if (!deps.force && now - (lastRoleRun[role] ?? 0) < CADENCE_MS[role]) continue;
    lastRoleRun[role] = now;
    const row = roleRowOf(role, rows, mode);
    const launched = row?.id ? launchedModeOf(launches, row.id) : null;
    // 스위치가 wake이거나, 지금 세션이 /loop 없이 떴다(스위치가 loop로 돌아가 다시 띄워지기 전까지 귀가 먹지 않게)
    if (sw[role] !== "wake" && launched !== "wake") {
      delete st.roles[role];
      continue;
    }
    const prev = st.roles[role] ?? emptyRoleState();
    const inputs = await gatherInputs(role, deps.get).catch(() => ({}));
    const seen = new Set(readSeen()[role] ?? []);
    const answers = role === "mcc" ? [] : unackedAnswers(allDecisions(), role).map(answerLineOf);
    let serverResent: Set<string> | undefined;
    if (role === "occ") {
      serverResent = new Set();
      for (const x of ((inputs as { dispatch?: { inFlight?: unknown[] } }).dispatch?.inFlight ?? []) as { id: string; sentVia?: string; timeline?: { sent?: string } }[]) {
        if (x?.sentVia !== "server") continue;
        if (priorDeliveriesOf(lines, x.id).some((d) => d.purpose === "resend" && (!x.timeline?.sent || d.at >= x.timeline.sent))) serverResent.add(x.id);
      }
    }
    // SERVER CLEARANCE(ATC-557 b): on인 종류만 메뉴로 센다
    const serverKinds = role === "tower" ? new Set(SERVER_CLEARANCE_KINDS.filter((k) => clearanceSw[k] === "on")) : undefined;
    const events = wakeEventsOf(role, inputs, { seen, now, answers, serverResent, serverKinds });
    const busy = pendingWakeOf(lines, role, now);
    const rec = row ? findSessionRecord(row.sessionId, configDirs()) : null;
    // TOWER: 할 일 없이 ATC LOG에만 적는 사건만 남았으면 서버가 ack한다(QUIET tick이 하던 일). 세션이 쉬고 앞 깨움이 끝났을 때만(세션의 cursor와 엇갈리지 않게)
    if (role === "tower" && !events.length && !busy && rec?.status !== "busy" && deps.ack) {
      const cursor = infoOnlyAckOf((inputs as { brief?: unknown }).brief);
      if (cursor) {
        await deps.ack(cursor).catch(() => null);
        record({ t: iso(now), kind: "control-wake", op: "ack", role: "tower", cursor });
        out.acked = cursor;
      }
    }
    const breaker: Breaker = breakerOf(launches, now, wakeScope(role));
    const canSend = Boolean(row && rec) && (breaker.state === "armed" || breaker.state === "probe");
    const plan = planWake(prev, events, { now, busy, canSend });
    for (const m of plan.missed) record({ t: iso(now), kind: "control-wake", op: "missed", role, key: m.key, event: m.kind, first: m.first, menu: m.menu });
    out.missed += plan.missed.length;
    let next = plan.next;
    if (plan.wake && row && rec) {
      st.seq += 1;
      const id = wakeIdOf(st.seq);
      const flightIds = [...new Set([...plan.wake.fresh, ...plan.wake.still].flatMap((e) => e.flights))];
      const text = wakePromptOf({ role, wakeId: id, plan: plan.wake, lastWakeId: prev.lastWakeId ?? null, lastWakeAt: prev.lastWakeAt ?? null, flights: openFlightsOf(role, inputs, flightIds), now });
      const c = checkControlWake({ wakeId: id, role: ROLE_NAME[role], session: { id: row.sessionId, name: rec.name ?? "" }, expectedName: recipientNameOf(role, mode) ?? "", text, mode: sw[role], launchedWake: launched === "wake", now });
      if (!c.ok) {
        const last = wakeLines(lines).filter((l) => l.role === role && l.op === "refused").at(-1);
        if (last?.check !== c.reason) record({ t: iso(now), kind: "control-wake", op: "refused", id, role, sessionId: row.sessionId, check: c.reason });
        out.refused.push(id);
        next = { ...next, lastFailAt: iso(now) };
      } else {
        const r = await (deps.deliver ?? deliverChecked)(c.send, { configDirs: configDirs() });
        if (!r.ok) {
          record({ t: iso(now), kind: "control-wake", op: "failed", id, role, sessionId: row.sessionId, stage: r.stage, why: r.why });
          out.failed.push(id);
          next = { ...next, lastFailAt: iso(now) };
        } else {
          const all = [...plan.wake.fresh, ...plan.wake.still];
          record({
            t: iso(now),
            kind: "control-wake",
            op: "deliver",
            id,
            role,
            sessionId: c.send.sessionId,
            session: c.send.to,
            pid: r.pid,
            msgId: r.msgId,
            transcript: r.cwd ? transcriptOf(r.configDir, r.cwd, c.send.sessionId) : null,
            textHash: c.send.textHash,
            text: c.send.text,
            check: "pass",
            menu: allMenu(plan.wake),
            events: all.map((e) => ({ key: e.key, kind: e.kind, menu: e.menu })),
            fresh: plan.wake.fresh.map((e) => e.key),
            still: plan.wake.still.map((e) => e.key),
            resolved: plan.wake.resolved,
            flights: flightIds,
          });
          out.woke.push({ role, id });
          next = delivered(next, plan.wake, id, now);
        }
      }
    }
    st.roles[role] = next;
  }
  saveWakeState(st);
  if (mode === "production" && deps.recycle) out.transition = await transitionPass(s, sw, rows, launches, deps.recycle, now);
  return out;
}

// ③ /loop ↔ wake 옮기기: 스위치와 다른 모드로 뜬 세션을 한 번 다시 띄운다. 한 주기에 하나, 운영 서버만, CONTROL RECYCLE과 같은 안전 조건·잠금
async function transitionPass(s: Snapshot, sw: Record<WakeRole, WakeMode>, rows: readonly AgentRow[], launches: readonly AnyLine[], d: { facts: FactDeps; act: ActDeps }, now: number): Promise<{ role: WakeRole; result: string } | null> {
  let facts: SafeFacts | null | undefined;
  const cfg = loadRecycle();
  const { eff } = effectiveWakeOf(sw, launches, now); // 깨움 BREAKER가 멈춘 역할은 loop(fail safe)
  for (const role of WAKE_ROLES) {
    const row = roleRowOf(role, rows, "production");
    const launched = row?.id ? launchedModeOf(launches, row.id) : null;
    const urgent = sw[role] === "wake" && eff[role] === "loop" && launched === "wake";
    if (!urgent) delete fallbackStuck[role];
    if (!row?.id || launched === null) {
      delete waiting[role];
      continue;
    }
    const want = eff[role];
    if (launched === want) {
      delete waiting[role];
      continue;
    }
    const name = ROLE_NAME[role];
    if (facts === undefined) facts = await safeFactsOf(s, d.facts).catch(() => null);
    const lastTry = wakeLines(launches)
      .filter((l) => l.op === "transition" && l.role === role)
      .map((l) => Date.parse(l.t))
      .at(-1);
    const tw = transitionWhy({ want, launched, single: true, idle: jobIdle(settleJob(readJob(row.id)) ?? null), blocks: safeBlocksOf(name, facts), auto: cfg.auto[name] ?? false, recycleOff: cfg.mode === "off", urgent, lastTryAt: lastTry ?? null, uptimeMs: now - startedAt, now, recycling: recyclingNow() });
    if (!tw.go) {
      waiting[role] = tw.why;
      // fail safe가 지금 되지 않으면 SUPERVISOR가 보게 CAUTION 카드 하나(그 역할에는 깨움도 /loop도 없다)
      if (urgent) fallbackStuck[role] = { role: name, why: tw.why, since: fallbackStuck[role]?.since ?? iso(now) };
      continue;
    }
    delete waiting[role];
    const context = contextOfRow(row, config.claudeDir, configDirOfRow(row)) ?? 0;
    const r = await recycleOnce(d.act, { id: row.id, pid: row.pid, account: row.account }, name, context, urgent ? `CONTROL WAKE: 깨움 BREAKER 멈춤 — wake → loop (ATC-557)` : `CONTROL WAKE: ${launched} → ${want} (ATC-557)`, "WAKE");
    const line = "busy" in r ? { ok: false, result: "busy", error: `${r.busy}가 재시작 중` } : { ok: r.ok, result: r.result, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
    record({ t: iso(now), kind: "control-wake", op: "transition", role, from: launched, to: want, ...line, ...(urgent ? { cause: "breaker" as const } : {}) });
    if (urgent && !line.ok) fallbackStuck[role] = { role: name, why: line.error ?? line.result, since: fallbackStuck[role]?.since ?? iso(now) };
    else if (urgent) delete fallbackStuck[role];
    return { role, result: line.result };
  }
  return null;
}

// 시험: 옮기기 한 번(운영 서버만 부르는 길을 가짜 행동으로)
export const transitionPassForTest = transitionPass;

// tick-run.ts가 `atcctl tick <역할> --wake <id>`를 받으면 한 줄(깨움을 세션이 집어 든 때)
export function notePickup(role: WakeRole, id: string, now = Date.now()) {
  if (!/^(W-\d{4,}|boot)$/.test(id)) return;
  record({ t: iso(now), kind: "control-wake", op: "pickup", role, id });
}

// 설정 창 CONTROL WAKE 블록의 자료: 역할마다 스위치·떠 있는 세션의 모드·BREAKER·옮기기를 기다리는 이유, 7일 수(오작동 셋 포함)
export function controlWakeData(now = Date.now()) {
  const lines = readRecords(now - 30 * DAY) as unknown as AnyLine[];
  const sw = loadWakeSwitch();
  const counts = wakeCountsOf(lines, now, 7);
  const roles = Object.fromEntries(
    WAKE_ROLES.map((role) => {
      const b = breakerOf(lines, now, wakeScope(role));
      const lastJob = lines.filter((l) => l.kind === "control" && l.op === "launch" && l.session === ROLE_NAME[role] && l.ok === true).at(-1);
      return [role, { ...counts.roles[role], mode: sw[role], effective: sw[role] === "wake" && b.state === "armed" ? "wake" : "loop", launched: lastJob ? (lastJob.wake === true ? "wake" : "loop") : null, breaker: b.state, breakerWhy: b.why, waiting: waiting[role] ?? null, fallbackStuck: fallbackStuck[role]?.why ?? null }];
    }),
  );
  return { days: counts.days, total: counts.total, roles, live: serverLiveOf(lastPassAt, now), writer: writerModeOf(writerPlaceNow()) };
}
