import type { Hono } from "hono";
import { foldReports, readReports } from "./arrival-report.ts";
import { readWips, wipView } from "./charter-wip.ts";
import { arrivalMissingOf, followingNow } from "./following.ts";
import { type RestartSafety, restartSafetyOf } from "./occ-safe.ts";
import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import {
  type CapBlocked,
  type OverCap,
  type OverdueRef,
  type WaitStuck,
  type RecycleConfig,
  type RecycleMode,
  type RecycleRecord,
  type SafeFacts,
  autoChangeLines,
  capBlockedOf,
  capChangeLines,
  contextTokensOf,
  controlRecycleOf,
  goneOf,
  jobIdle,
  loadRecycle,
  safeBlocksOf,
  saveRecycle,
  waitMinutesOf,
  wouldWaitDue,
} from "./control-recycle.ts";
import { allClearances, isClearanceOverdue, isPending } from "./clearances.ts";
import { resendLinksOf } from "./clearance-resend.ts";
import { loadCarrySwitch } from "./recycle-carry-run.ts";
import { allCrewChanges, isOpenCrewChange } from "./crew-change.ts";
import { ttlCache } from "./agents-cache.ts";
import type { ApplyControl } from "./apply-now.ts";
import { readJob, settleJob } from "./job-state.ts";
import type { Clearance, Snapshot } from "./model.ts";
import { allProposals, isInFlight, READBACK_OVERDUE_MS } from "./proposals.ts";
import { readRecords, record } from "./recorder.ts";
import {
  type AgentRow,
  agentRows,
  CONTROL_SESSIONS,
  configDirOfRow,
  controlDirOf,
  controlRowsOf,
  controlSpecOf,
  launchControl,
  stopControl,
} from "./session-control.ts";

// CONTROL RECYCLE의 실행(ATC-166). 판단은 control-recycle.ts(순수). 여기는 자료를 모아 넣고, 결정이 recycle이면 버튼과 같은 길(stopControl → 확인 → launchControl)로 한다.
// 새로 세션을 보내거나 조종하는 길은 없다. guard는 그대로.

const TAIL = 512 * 1024;

// 대화 기록 꼬리에서 마지막 요청의 컨텍스트. 기록은 <계정 폴더>/projects/<cwd를 -로 바꾼 이름>/<sessionId>.jsonl
export const projectDirName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
const ctxCache = new Map<string, { key: string; tokens: number | null }>();
export function contextOfRow(row: Pick<AgentRow, "sessionId" | "cwd" | "account">, claudeDir = config.claudeDir, configDir: string | null = null): number | null {
  const base = configDir ?? claudeDir;
  let file = join(base, "projects", projectDirName(row.cwd), `${row.sessionId}.jsonl`);
  try {
    statSync(file);
  } catch {
    // cwd 이름 규칙이 바뀐 경우를 위해 projects/ 아래를 한 번 훑는다
    try {
      const hit = readdirSync(join(base, "projects")).find((d) => {
        try {
          statSync(join(base, "projects", d, `${row.sessionId}.jsonl`));
          return true;
        } catch {
          return false;
        }
      });
      if (!hit) return null;
      file = join(base, "projects", hit, `${row.sessionId}.jsonl`);
    } catch {
      return null;
    }
  }
  try {
    const fd = openSync(file, "r");
    try {
      const st = fstatSync(fd);
      const key = `${st.mtimeMs}:${st.size}`;
      const hit = ctxCache.get(file);
      if (hit?.key === key) return hit.tokens;
      const len = Math.min(st.size, TAIL);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, st.size - len);
      const lines = buf.toString("utf8").split("\n");
      const tokens = contextTokensOf(st.size > len ? lines.slice(1) : lines);
      ctxCache.set(file, { key, tokens });
      return tokens;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

// ── 안전 조건 자료 ──
export interface FactDeps {
  rtsBusy: (s: Snapshot) => Promise<string | null>; // UPDATE 상태에서(index.ts가 넘긴다)
  towerEvents: () => number; // TOWER 커서 뒤 이벤트 수
  now: () => number;
}
const TEN_MIN = READBACK_OVERDUE_MS;

// OCC의 안전 조건(ATC-169·175): dispatch brief의 restartSafety와 같은 함수(restartSafetyOf)의 blockers. 여기서 세지 않고 그 결과를 그대로 쓴다.
// 읽지 못하면 막는다(fail-closed)
export function occSafetyOf(s: Snapshot, now: number): RestartSafety {
  try {
    const arrivalMissing = arrivalMissingOf(followingNow(s, now, undefined, false), foldReports(readReports()), now);
    return restartSafetyOf({ inFlight: allProposals().filter(isInFlight), arrivalMissing, wip: wipView(readWips(), now), now });
  } catch (e) {
    return { safe: false, blockers: [{ code: "approved", id: "?", text: `dispatch 안전 조건을 읽지 못함(${e instanceof Error ? e.message : String(e)})` }] };
  }
}

// TOWER의 overdue CLEARANCE(ATC-565): id·받는 세션과 RESEND 고리. 고리의 다른 CLEARANCE가 답을 받은 것은 brief처럼 뺀다
export function overdueRefsOf(all: readonly Clearance[], now: number): OverdueRef[] {
  const links = resendLinksOf(all);
  return all
    .filter((c) => isPending(c) && isClearanceOverdue(c, now, TEN_MIN) && !links.get(c.id)?.answeredVia)
    .map((c) => {
      const l = links.get(c.id);
      return { id: c.id, to: c.toName || c.to.slice(0, 8), ...(l?.resendOf ? { resendOf: l.resendOf } : {}), ...(l?.resentBy.length ? { resent: true } : {}) };
    });
}

export async function safeFactsOf(s: Snapshot, d: FactDeps): Promise<SafeFacts> {
  const now = d.now();
  const rtsBusy = await d.rtsBusy(s).catch((e) => `UPDATE 상태를 읽지 못함(${e instanceof Error ? e.message : String(e)})`);
  return {
    rtsBusy,
    tower: { events: d.towerEvents(), overdue: overdueRefsOf(allClearances(), now), carry: loadCarrySwitch() === "on" },
    occ: { blockers: occSafetyOf(s, now).blockers, crewChangeOpen: allCrewChanges().filter(isOpenCrewChange).length },
    // MCC: INSPECTION·LAND 중인지는 atc가 보지 못한다(ATC-165 1.3). 턴 사이(job idle)와 RTS 조건이 그 근사다
    mcc: { blocked: null },
  };
}

// ── 행동 ──
export interface ActDeps {
  stop: (name: string) => Promise<{ ok: boolean; error?: string; unverified?: boolean }>;
  rowsOf: () => Promise<AgentRow[]>; // 새로 읽는다
  pidAlive: (pid: number) => boolean;
  launch: (name: string, account: string | undefined) => Promise<{ ok: boolean; jobId?: string; account?: string | null; error?: string }>;
  sleep: (ms: number) => Promise<void>;
  confirmMs?: number;
}

export const pidAliveOf = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // 있지만 권한 없음
  }
};

// stopControl → job이 사라졌음을 확인 → 같은 ACCOUNT로 launchControl. 실패하면 어디까지 갔는지(result)를 돌려준다. 기록은 부르는 쪽이 한다
export async function performRecycle(d: ActDeps, row: Pick<AgentRow, "id" | "pid" | "account">, name: string, contextBefore: number, reason: string, carried: readonly string[] = []): Promise<RecycleRecord> {
  const base = { t: new Date().toISOString(), session: name, contextBefore, reason, mode: "on" as const, ...(row.account ? { account: row.account } : {}), ...(carried.length ? { carried: [...carried] } : {}) };
  const st = await d.stop(name);
  // ATC-521: claude stop은 성공했지만 job이 stopped가 되지 않았다. 종료 코드만 믿고 새 세션을 띄우지 않는다(옛 세션이 계속 돌 수 있다)
  if (!st.ok) return { ...base, ok: false, result: st.unverified ? "stop-unverified" : "stop-failed", error: st.error };
  // ATC-165 1.5: 저장한 pid가 사라지고 줄에 pid·status가 없을 때만 안 것으로 본다. done에서 STOP한 job은 줄이 유령으로 남는다(STALE, LAUNCH는 무시한다)
  const deadline = Date.now() + (d.confirmMs ?? 15_000);
  let ghost = false;
  for (;;) {
    const rows = await d.rowsOf().catch(() => null);
    const mine = rows ? (rows.find((r) => r.id === row.id) ?? null) : undefined;
    if (mine !== undefined) {
      const g = goneOf({ pid: row.pid ?? null, pidAlive: row.pid != null ? d.pidAlive(row.pid) : null, row: mine });
      ghost = g.ghost;
      if (g.gone) break;
    }
    if (Date.now() >= deadline) {
      // ATC-175: 확인하지 못했어도 LAUNCH를 시도한다. launchControl은 살아 있는(STALE이 아닌) 줄이 있으면 스스로 거절하므로, 세션이 둘이 되지는 않는다.
      // STOP이 먹었는데 줄만 남았다면 세션이 내려가 있는 것이라 다시 띄우는 것이 맞다
      const l = await d.launch(name, row.account);
      const launch = { ok: l.ok, ...(l.jobId ? { jobId: l.jobId } : {}), ...(l.error ? { error: l.error } : {}) };
      return { ...base, ok: l.ok, result: "stop-unconfirmed", error: "STOP 뒤에도 job이 남아 있음", launch, ...(l.jobId ? { jobId: l.jobId } : {}) };
    }
    await d.sleep(1000);
  }
  const l = await d.launch(name, row.account);
  if (!l.ok) return { ...base, ok: false, result: "launch-failed", error: `${l.error ?? "LAUNCH 실패"}${ghost ? " (유령 줄은 STALE)" : ""}` };
  return { ...base, ok: true, result: "recycled", ...(l.jobId ? { jobId: l.jobId } : {}) };
}

const toLine = (r: RecycleRecord, by = "atc"): Parameters<typeof record>[0] => ({ kind: "control", op: "recycle", by, ...r });

// ── 한 주기 ──
let busy = false; // 한 번에 한 세션만
let recycling: string | null = null;
const wouldAt = new Map<string, number>(); // shadow: 세션·job마다 cooldown 안에 한 번만 남긴다

export const recyclingNow = () => recycling;

// CAP을 넘고 wait인 세션이 처음 wait가 된 것을 본 때(ATC-175). 재시작하거나 조건이 바뀌면 지운다
const waitSince = new Map<string, number>();
const wouldWaitAt = new Map<string, number>(); // shadow: 세션마다 cooldown 안에 한 번만 would-wait를 남긴다
let stuck: WaitStuck[] = [];
export const waitStuckNow = () => stuck;

// CAP을 넘었지만 자동 재시작 대상이 아닌 세션(OCC). 1분마다 새로 잰다. since는 처음 넘은 것을 본 때
let overCap: (OverCap & { since: string })[] = [];
export const overCapNow = () => overCap;

// CAP을 넘은 채 SUPERVISOR를 기다리며(job blocked) waitAlertMin 넘게 멈춘 세션(ATC-565). HOME 카드 recycle|blocked
let capBlocked: CapBlocked[] = [];
export const capBlockedNow = () => capBlocked;

export function lastRecycleAtOf(name: string, sinceMs: number): number | null {
  let last: number | null = null;
  for (const r of readRecords(sinceMs)) {
    if (r.kind !== "control" || r.op !== "recycle" || r.session !== name || r.result === "would" || r.result === "would-wait") continue;
    const t = Date.parse(r.t);
    if (last === null || t > last) last = t;
  }
  return last;
}

export interface RunDeps extends FactDeps {
  act: ActDeps;
  fuelAccounts?: (s: Snapshot) => Snapshot["fuelAccounts"];
}

export async function runControlRecycle(s: Snapshot, d: RunDeps, cfg: RecycleConfig = loadRecycle()): Promise<{ name: string; action: string; reason: string }[]> {
  if (busy) return [];
  busy = true;
  const out: { name: string; action: string; reason: string }[] = [];
  try {
    const rows = await agentRows();
    const now = d.now();
    const cooldownMs = cfg.cooldownHours * 3_600_000;
    let facts: SafeFacts | null | undefined;
    const excluded: OverCap[] = [];
    const nowStuck: WaitStuck[] = [];
    const nowBlocked: CapBlocked[] = [];
    const seen = new Set<string>(); // 이번 주기에 본 세션. 재시작 뒤 break로 못 본 세션의 카드는 지난 주기 것을 둔다(카드가 1분 사라졌다 돌아오지 않게)
    // 은퇴한 관제 세션(CROSSCHECK, ATC-371)이 아직 떠 있으면 스스로 멈춘다. 모드와 상관없이, SUPERVISOR 단계 없이
    for (const spec of CONTROL_SESSIONS) {
      if (!spec.retired || !controlRowsOf(spec, rows, controlDirOf(spec)).some((r) => !r.stale)) continue;
      const r = await stopControl(spec.name, "retire");
      out.push({ name: spec.name, action: r.ok ? "retired-stop" : "retired-stop-failed", reason: r.ok ? "CROSSCHECK는 은퇴했다(ATC-371)" : (r.error ?? "stop 실패") });
    }
    for (const spec of CONTROL_SESSIONS) {
      if (spec.launch !== "bg") continue;
      seen.add(spec.name);
      const live = controlRowsOf(spec, rows, controlDirOf(spec)).filter((r) => !r.stale);
      const bg = live.find((r) => r.kind === "background" && r.id);
      const context = bg ? contextOfRow(bg, config.claudeDir, configDirOfRow(bg)) : null;
      const cap = cfg.caps[spec.name] ?? null;
      const job = bg ? (settleJob(readJob(bg.id)) ?? null) : null;
      // 자료는 CAP을 넘은 세션이 있을 때만 읽는다
      const over = bg && cap !== null && context !== null && context > cap;
      const auto = cfg.auto[spec.name] ?? false;
      // 자동 재시작 대상이 아닌 세션은 모드와 상관없이 재고 알린다(OCC, SUPERVISOR 결정 2026-09-30)
      if (over && !auto) excluded.push({ session: spec.name, context: context!, cap: cap! });
      // SUPERVISOR를 기다리느라 CAP을 넘긴 채 멈춤(ATC-565): 모드·auto와 상관없이. 그 밖에 막는 것은 아래 결정이 wait면 채운다
      const blockedCard = bg ? capBlockedOf({ session: spec.name, context, cap, job, waitAlertMin: cfg.waitAlertMin, now }) : null;
      if (blockedCard) nowBlocked.push(blockedCard);
      if (cfg.mode === "off") {
        waitSince.delete(spec.name);
        continue;
      }
      if (!over) waitSince.delete(spec.name);
      if (over && auto && facts === undefined) facts = await safeFactsOf(s, d).catch(() => null);
      const lastAt = over ? lastRecycleAtOf(spec.name, now - cooldownMs) : null;
      const dec = controlRecycleOf({
        name: spec.name,
        mode: cfg.mode,
        cap,
        auto,
        context,
        background: Boolean(bg) && live.length === 1,
        job,
        safe: over ? (facts ?? null) : null,
        lastRecycleAt: lastAt,
        otherRecycling: recycling && recycling !== spec.name ? recycling : null,
        cooldownMs,
        now,
      });
      if (dec.action !== "recycle" || !bg || context === null) {
        if (dec.action === "wait") {
          out.push({ name: spec.name, action: "wait", reason: dec.reason });
          if (blockedCard) blockedCard.others = dec.blocks.filter((b) => !b.startsWith("턴 사이가 아님"));
          const since = waitSince.get(spec.name) ?? now;
          waitSince.set(spec.name, since);
          const minutes = waitMinutesOf(since, now, cfg.waitAlertMin);
          if (minutes !== null && context !== null && cap !== null) {
            nowStuck.push({ session: spec.name, context, cap, blocks: dec.blocks, since: new Date(since).toISOString(), minutes });
            // shadow: 세션마다 cooldown에 한 줄(ATC-175)
            if (bg && wouldWaitDue(cfg.mode, wouldWaitAt.get(spec.name), now, cooldownMs)) {
              wouldWaitAt.set(spec.name, now);
              record(toLine({ t: new Date(now).toISOString(), session: spec.name, contextBefore: context, reason: dec.reason, mode: "shadow", ok: true, result: "would-wait", blocks: dec.blocks, ...(bg.account ? { account: bg.account } : {}) }));
            }
          }
        } else waitSince.delete(spec.name);
        continue;
      }
      waitSince.delete(spec.name);
      if (cfg.mode === "shadow") {
        const key = `${spec.name}|${bg.id}`;
        if (now - (wouldAt.get(key) ?? 0) < cooldownMs) continue;
        wouldAt.set(key, now);
        record(toLine({ t: new Date(now).toISOString(), session: spec.name, contextBefore: context, reason: dec.reason, mode: "shadow", ok: true, result: "would", ...(bg.account ? { account: bg.account } : {}) }));
        out.push({ name: spec.name, action: "would", reason: dec.reason });
        continue;
      }
      recycling = spec.name;
      try {
        const r = await performRecycle(d.act, bg, spec.name, context, dec.reason, dec.carry ?? []);
        record(toLine(r));
        out.push({ name: spec.name, action: r.result, reason: dec.reason });
      } finally {
        recycling = null;
      }
      break; // 한 주기에 한 세션만. 다음 세션은 다음 주기에(다른 세션이 재시작 중이 아닐 때)
    }
    stuck = [...nowStuck, ...stuck.filter((w) => !seen.has(w.session))];
    capBlocked = [...nowBlocked, ...capBlocked.filter((b) => !seen.has(b.session))];
    overCap = excluded.map((e) => ({ ...e, since: overCap.find((o) => o.session === e.session)?.since ?? new Date(now).toISOString() }));
  } finally {
    busy = false;
  }
  return out;
}

// ── APPLY NOW(ATC-244): 관제 세션을 다른 ACCOUNT로 옮긴다. 같은 안전 조건과 같은 performRecycle(목표 ACCOUNT만 다르다) ──
// 사실만 읽는다(순수 계획 applyNowPlanOf의 입력). 관제 세션마다 세션 종류·지금 ACCOUNT·턴 사이인가·안전 조건의 막는 이유
export async function applyControlFactsOf(s: Snapshot, d: FactDeps, rows?: AgentRow[]): Promise<ApplyControl[]> {
  const all = rows ?? (await agentRows());
  let facts: SafeFacts | null | undefined;
  const out: ApplyControl[] = [];
  for (const spec of CONTROL_SESSIONS) {
    if (spec.launch !== "bg") continue;
    const live = controlRowsOf(spec, all, controlDirOf(spec));
    const bg = live.find((r) => r.kind === "background" && r.id);
    if (!live.length) {
      out.push({ name: spec.name, current: null, session: null, idle: false, blocks: [] });
      continue;
    }
    if (facts === undefined) facts = await safeFactsOf(s, d).catch(() => null);
    const job = bg ? (settleJob(readJob(bg.id)) ?? null) : null;
    const blocks = [...safeBlocksOf(spec.name, facts), ...(recycling && recycling !== spec.name ? [`${recycling}가 재시작 중`] : [])];
    out.push({ name: spec.name, current: (bg ?? live[0]).account ?? null, session: bg && live.length === 1 ? "background" : "other", idle: jobIdle(job), blocks });
  }
  return out;
}

// 한 세션을 목표 ACCOUNT로 STOP → LAUNCH. RECYCLE과 같은 한 번에 한 세션 잠금을 쓴다. 기록: RECYCLE 줄(by SUPERVISOR, reason에 APPLY NOW)
// ATC-255: CONTROL BULK의 RESTART·ALIGN도 같은 길이다(to가 null이면 LAUNCH ACCOUNT·라벨이 정한 곳, label은 기록의 reason 머리)
export async function applyNowControl(d: ActDeps, name: string, to: string | null, by: string, label = "APPLY NOW"): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  if (busy || recycling) return { ok: false, error: `${recycling ?? "CONTROL RECYCLE"}가 재시작 중 — 끝난 뒤 다시` };
  busy = true;
  recycling = name;
  try {
    const spec = controlSpecOf(name);
    const bg = spec ? controlRowsOf(spec, await agentRows(), controlDirOf(spec)).find((r) => r.kind === "background" && r.id && !r.stale) : undefined;
    if (!spec || !bg) return { ok: false, error: `${name}: 떠 있는 claude --bg 세션이 없음` };
    const context = contextOfRow(bg, config.claudeDir, configDirOfRow(bg)) ?? 0;
    const r = await performRecycle(d, { id: bg.id, pid: bg.pid, account: to ?? undefined }, name, context, `${label}: ${bg.account ?? "?"} → ${to ?? "(default)"}`);
    record(toLine(r, by));
    return { ok: r.ok, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
  } finally {
    recycling = null;
    busy = false;
  }
}

// 실제 stop·launch·읽기를 묶은 기본 ActDeps. stopControl·launchControl은 FLEET의 STOP·LAUNCH 버튼과 같은 함수다
export const defaultActDeps = (fuelAccounts: () => Snapshot["fuelAccounts"], by = "RECYCLE"): ActDeps => ({
  stop: async (name) => {
    const r = await stopControl(name, by);
    return { ok: r.ok, error: r.error, ...(r.unverified ? { unverified: true } : {}) };
  },
  rowsOf: () => agentRows(),
  pidAlive: pidAliveOf,
  launch: async (name, account) => {
    const r = await launchControl(name, by, account, fuelAccounts());
    return { ok: r.ok, jobId: r.jobId, account: r.account, error: r.error };
  },
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
});

// 스위치(SUPERVISOR만: 설정 창 PUT /api/settings의 controlRecycleMode). 바꾸면 FLIGHT RECORDER에 남는다
export function setRecycleMode(mode: RecycleMode, by = "SUPERVISOR") {
  const cfg = loadRecycle();
  if (cfg.mode === mode) return;
  saveRecycle({ ...cfg, mode });
  record({ t: new Date().toISOString(), kind: "control", op: "recycle-mode", by, from: cfg.mode, to: mode });
}
// 캡·auto 바꿈은 세션마다 한 줄씩 FLIGHT RECORDER에 남긴다(ATC-175, recycle-caps·recycle-auto). 값이 그대로면 남기지 않는다
export function setRecycleAuto(patch: Record<string, boolean>, by = "SUPERVISOR") {
  const cfg = loadRecycle();
  saveRecycle({ ...cfg, auto: { ...cfg.auto, ...patch } });
  for (const line of autoChangeLines(cfg.auto, patch, new Date().toISOString(), by)) record(line);
}
export function setRecycleCaps(patch: Record<string, number | null>, by = "SUPERVISOR") {
  const cfg = loadRecycle();
  saveRecycle({ ...cfg, caps: { ...cfg.caps, ...patch } });
  for (const line of capChangeLines(cfg.caps, patch, new Date().toISOString(), by)) record(line);
}

// 화면이 읽는다(읽기만): 세션마다 지금 컨텍스트와 CAP, 최근 재시작 기록. 스위치·CAP은 PUT /api/settings로 바꾼다
const cachedRows = ttlCache(agentRows);
export function mountControlRecycle(app: Hono) {
  app.get("/api/control/recycle", async (c) => {
    const cfg = loadRecycle();
    const rows = await cachedRows.get(c.req.query("fresh") === "1").catch(() => [] as AgentRow[]);
    const day = Date.now() - 24 * 3_600_000;
    const recent = readRecords(day)
      .filter((r) => r.kind === "control" && r.op === "recycle")
      .slice(-20)
      .reverse();
    return c.json({
      mode: cfg.mode,
      cooldownHours: cfg.cooldownHours,
      waitAlertMin: cfg.waitAlertMin,
      auto: cfg.auto,
      recycling: recyclingNow(),
      sessions: CONTROL_SESSIONS.filter((x) => x.launch === "bg").map((spec) => {
        const bg = controlRowsOf(spec, rows, controlDirOf(spec)).find((r) => r.kind === "background" && r.id && !r.stale);
        const context = bg ? contextOfRow(bg, config.claudeDir, configDirOfRow(bg)) : null;
        const cap = cfg.caps[spec.name] ?? null;
        return { name: spec.name, cap, auto: cfg.auto[spec.name] ?? false, context, over: cap !== null && context !== null && context > cap, running: Boolean(bg) };
      }),
      recent,
    });
  });
}
