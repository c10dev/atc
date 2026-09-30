import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { Job } from "./job-state.ts";
import type { RestartBlocker } from "./occ-safe.ts";

// CONTROL RECYCLE(ATC-166, docs/control-recycle.md): 컨텍스트가 CAP을 넘은 관제 세션을 atc가 안전한 순간에 STOP하고 LAUNCH한다.
// 이 파일은 설정 읽기·쓰기와 순수 계산. 실행(claude stop·--bg)은 control-recycle-run.ts가 session-control.ts의 stopControl·launchControl로 한다.
// 스위치는 SUPERVISOR만 바꾼다(설정 창, 이 화면 Origin만). 관제 세션 CLI(atcctl)에는 명령이 없다.

export type RecycleMode = "off" | "shadow" | "on";
export const RECYCLE_MODES: readonly RecycleMode[] = ["off", "shadow", "on"];

// ATC-165 권고(docs/control-recycle.md 2.1): TOWER·OCC·CROSSCHECK 250k, MCC 150k, REVIEW는 스스로 auto-compact(170k)해서 없음(null)
export const DEFAULT_CAPS: Readonly<Record<string, number | null>> = { TOWER: 250_000, OCC: 250_000, MCC: 150_000, CROSSCHECK: 250_000, REVIEW: null };
// SUPERVISOR 결정(2026-09-30): OCC는 미기록 CAPTAIN 보고 틈(2.3 항목 4)이 별도 이슈로 닫힐 때까지 어떤 모드에서도 atc가 재시작하지 않는다.
// 컨텍스트는 재고 CAP을 넘으면 알림만 한다. 나중에 켜는 것은 설정 하나(`auto.OCC: true`)다
export const DEFAULT_AUTO: Readonly<Record<string, boolean>> = { TOWER: true, OCC: false, MCC: true, CROSSCHECK: true, REVIEW: true };
export const DEFAULT_COOLDOWN_HOURS = 3;
export const DEFAULT_WAIT_ALERT_MIN = 60; // CAP을 넘고 wait인 채 이만큼 지나면 SUPERVISOR에게 CAUTION(ATC-175)
export const WAIT_ALERT_MIN_RANGE = [5, 1440] as const;
// TOWER: brief에 아직 acked하지 않은 이벤트는 새 TOWER가 다시 받는다(ATC-165 1.2 — 잃는 것은 없고 중복 한 번뿐). 그래서 이벤트 종류를 가리지 않고
// 작은 문턱만 둔다: 한 바퀴가 처리 중일 만큼 쌓였을 때(이 수를 넘을 때)만 기다린다(ATC-175)
export const TOWER_EVENTS_MAX = 5;
export const CAP_MIN = 50_000;
export const CAP_MAX = 900_000;

// ~/.local/state/atc/control-recycle.json (원자적으로 바꿔 쓴다)
export interface RecycleConfig {
  mode: RecycleMode;
  caps: Record<string, number | null>; // 세션 이름 → CAP 토큰. null이면 그 세션은 재시작하지 않는다
  auto: Record<string, boolean>; // 세션 이름 → atc가 스스로 재시작해도 되나. false면 측정·알림만(OCC 기본)
  cooldownHours: number; // 같은 세션을 다시 재시작하지 않는 시간
  waitAlertMin: number; // CAP을 넘고 wait인 채 이만큼(분) 지나면 CAUTION 알림, shadow는 would-wait 기록(ATC-175)
}

export const recycleCapOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= CAP_MIN && (v as number) <= CAP_MAX;

// 모르는 값은 기본값(off·권고 CAP)으로 — 깨진 파일이 무엇도 켜지 않게
export function parseRecycle(raw: unknown): RecycleConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawCaps = (r.caps && typeof r.caps === "object" ? r.caps : {}) as Record<string, unknown>;
  const caps: Record<string, number | null> = { ...DEFAULT_CAPS };
  for (const name of Object.keys(DEFAULT_CAPS)) {
    if (!(name in rawCaps)) continue;
    const v = rawCaps[name];
    if (v === null) caps[name] = null;
    else if (recycleCapOk(v)) caps[name] = v;
  }
  const rawAuto = (r.auto && typeof r.auto === "object" ? r.auto : {}) as Record<string, unknown>;
  const auto: Record<string, boolean> = { ...DEFAULT_AUTO };
  for (const name of Object.keys(DEFAULT_AUTO)) if (typeof rawAuto[name] === "boolean") auto[name] = rawAuto[name] as boolean;
  const h = r.cooldownHours;
  const w = r.waitAlertMin;
  return {
    mode: RECYCLE_MODES.includes(r.mode as RecycleMode) ? (r.mode as RecycleMode) : "off",
    caps,
    auto,
    cooldownHours: typeof h === "number" && Number.isFinite(h) && h >= 0.5 && h <= 48 ? h : DEFAULT_COOLDOWN_HOURS,
    waitAlertMin: typeof w === "number" && Number.isFinite(w) && w >= WAIT_ALERT_MIN_RANGE[0] && w <= WAIT_ALERT_MIN_RANGE[1] ? w : DEFAULT_WAIT_ALERT_MIN,
  };
}

const CONFIG_FILE = () => join(config.stateDir, "control-recycle.json");
const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
export const loadRecycle = (file = CONFIG_FILE()) => parseRecycle(readJson(file));
export function saveRecycle(next: RecycleConfig, file = CONFIG_FILE()) {
  const user = readJson(file);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...(user && typeof user === "object" ? user : {}), ...next }, null, 2) + "\n");
  renameSync(tmp, file);
}

// ── 컨텍스트 ──
// 마지막 요청의 input + cache read + cache write. mcc/context-cap.mjs의 contextTokensOf와 같은 합(시험이 두 구현을 맞춰 본다)
export function contextTokensOf(lines: readonly string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    let j: { type?: unknown; isSidechain?: unknown; message?: { usage?: Record<string, unknown> } } | null;
    try {
      j = JSON.parse(lines[i]!);
    } catch {
      continue;
    }
    if (j?.type !== "assistant" || j.isSidechain === true) continue;
    const u = j.message?.usage;
    if (!u || typeof u !== "object") continue;
    const num = (v: unknown) => (typeof v === "number" ? v : 0);
    const n = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
    if (n > 0) return n;
  }
  return null;
}

// ── 안전한 순간(docs/control-recycle.md 1.3, ATC-165) ──
// 공통: RTS가 돌거나 곧 시작하지 않는다. RTS는 재시작 전에 살아 있는 백그라운드 세션을 세어 두고 2분 안에 하나라도 없어지면 실패(ROLLBACK)한다.
export interface SafeFacts {
  rtsBusy: string | null; // RTS가 돌거나 곧 시작되면 그 사유(UPDATE 상태 starting·running, 또는 자동 배포 모드에서 available). 모르면 null이 아니라 사유 글로 막는다
  tower: { events: number; overdue: number } | null; // brief에 아직 안 acked 이벤트 수, overdue CLEARANCE 수
  occ: { blockers: readonly Pick<RestartBlocker, "code" | "id" | "text">[]; crewChangeOpen: number } | null; // OCC: dispatch brief의 restartSafety와 같은 함수(server/occ-safe.ts restartSafetyOf, ATC-169)의 blockers — 승인됐지만 아직 안 나간 FLIGHT PLAN, RECALL 중, 10분 안에 나간 것, 머지 30분 안인데 도착 보고가 없는 FLIGHT, 30분 안에 손댄 CHARTER REQUEST — 와 열린 CREW CHANGE 수
  mcc: { blocked: string | null } | null; // 지금 land·inspect를 하는 중이라 볼 근거
}
export const NO_FACTS: SafeFacts = { rtsBusy: null, tower: null, occ: null, mcc: null };

// 순수: 이 세션을 지금 재시작하면 잃는 것이 있는 이유들. 비면 안전하다. 사실을 못 읽은 세션(null)은 막는다(fail-closed)
export function safeBlocksOf(name: string, f: SafeFacts | null): string[] {
  if (!f) return ["안전 조건을 읽지 못함"];
  const out: string[] = [];
  if (f.rtsBusy) out.push(`RTS: ${f.rtsBusy}`);
  const n = name.toUpperCase();
  if (n === "TOWER") {
    if (!f.tower) out.push("TOWER brief를 읽지 못함");
    else {
      if (f.tower.events > TOWER_EVENTS_MAX) out.push(`brief에 처리하지 않은 이벤트 ${f.tower.events}건(문턱 ${TOWER_EVENTS_MAX})`);
      if (f.tower.overdue > 0) out.push(`overdue CLEARANCE ${f.tower.overdue}건`);
    }
  } else if (n === "OCC") {
    if (!f.occ) out.push("dispatch brief를 읽지 못함");
    else {
      for (const b of f.occ.blockers) out.push(b.text);
      if (f.occ.crewChangeOpen > 0) out.push(`열린 CREW CHANGE ${f.occ.crewChangeOpen}건`);
    }
  } else if (n === "MCC") {
    if (!f.mcc) out.push("MCC queue를 읽지 못함");
    else if (f.mcc.blocked) out.push(f.mcc.blocked);
  }
  return out; // CROSSCHECK·REVIEW: 공통 두 조건뿐
}

// job이 턴 사이에 있다(ATC-175): tempo가 idle이고 state가 blocked가 아니다. ATC-165 1.3은 done/idle을 재었고(간격 사이 job), working/idle(다음 바퀴를 기다리는 /loop)도 같은 쉬는 모양이다.
// working/active(턴 도중), blocked/*(사람을 기다림 — 답이 오면 이어 간다), job을 모름은 아니다
export const jobIdle = (job: Pick<Job, "state" | "tempo"> | null | undefined): boolean => Boolean(job) && job!.tempo === "idle" && job!.state !== "blocked";

// ── 결정 ──
export interface RecycleInput {
  name: string;
  mode: RecycleMode;
  cap: number | null;
  auto: boolean; // 이 세션은 atc가 스스로 재시작해도 되나(OCC는 false: 측정·알림만)
  context: number | null;
  background: boolean; // atc가 띄운 `claude --bg` 세션이 살아 있다(tmux·interactive는 다시 띄울 수 없다)
  job: Pick<Job, "state" | "tempo"> | null;
  safe: SafeFacts | null;
  lastRecycleAt: number | null; // 이 세션을 마지막으로 재시작(시도)한 시각
  otherRecycling: string | null; // 지금 다른 세션이 재시작 중이면 그 이름
  cooldownMs: number;
  now: number;
}
// skip: 할 일 없음(끔, 미만, CAP 없음 …). wait: CAP은 넘었지만 지금은 안전하지 않다. recycle: 지금 한다(shadow면 기록만)
export type RecycleDecision = { action: "skip" | "wait" | "recycle"; reason: string; blocks: string[] };

export function controlRecycleOf(i: RecycleInput): RecycleDecision {
  const skip = (reason: string): RecycleDecision => ({ action: "skip", reason, blocks: [] });
  if (i.mode === "off") return skip("mode off");
  if (i.cap === null) return skip("CAP 없음");
  if (i.context === null) return skip("컨텍스트를 모름");
  if (i.context <= i.cap) return skip("CAP 미만");
  if (!i.auto) return skip("자동 재시작 대상이 아님 — 측정·알림만");
  if (!i.background) return skip("claude --bg 세션이 아님");
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const over = `컨텍스트 ${k(i.context)} > CAP ${k(i.cap)}`;
  const blocks: string[] = [];
  if (!jobIdle(i.job)) blocks.push(`턴 사이가 아님(job ${i.job ? `${i.job.state}/${i.job.tempo ?? "?"}` : "?"})`);
  if (i.lastRecycleAt !== null && i.now - i.lastRecycleAt < i.cooldownMs) blocks.push(`${Math.round(i.cooldownMs / 3_600_000 * 10) / 10}시간 안에 재시작함`);
  if (i.otherRecycling) blocks.push(`${i.otherRecycling}가 재시작 중`);
  blocks.push(...safeBlocksOf(i.name, i.safe));
  if (blocks.length) return { action: "wait", reason: `${over} — 기다림: ${blocks.join("; ")}`, blocks };
  return { action: "recycle", reason: over, blocks: [] };
}

// ── wait가 오래됐나(ATC-175) ──
// since: 처음 wait가 된 것을 본 때(ms). 이 분(minutes)이 waitAlertMin 이상이면 알림·would-wait 대상. 아직 wait가 아니면 null
export function waitMinutesOf(since: number | null | undefined, now: number, waitAlertMin: number): number | null {
  if (since == null) return null;
  const m = Math.floor((now - since) / 60_000);
  return m >= waitAlertMin ? m : null;
}
// shadow에서 would-wait를 남길 차례인가: shadow이고, 그 세션에 cooldown 안에 남긴 것이 없다
export const wouldWaitDue = (mode: RecycleMode, lastAt: number | undefined, now: number, cooldownMs: number): boolean => mode === "shadow" && now - (lastAt ?? 0) >= cooldownMs;

// ── 캡·auto 바꿈 기록(ATC-175) ── 값이 바뀐 세션마다 한 줄(recycle-caps·recycle-auto, from → to). 그대로면 남기지 않는다
export type RecycleChangeLine = { t: string; kind: "control"; op: "recycle-caps" | "recycle-auto"; by: string; session: string; from: number | boolean | null; to: number | boolean | null };
export function capChangeLines(cur: Record<string, number | null>, patch: Record<string, number | null>, t: string, by: string): RecycleChangeLine[] {
  return Object.entries(patch).flatMap(([session, to]) => ((cur[session] ?? null) !== to ? [{ t, kind: "control" as const, op: "recycle-caps" as const, by, session, from: cur[session] ?? null, to }] : []));
}
export function autoChangeLines(cur: Record<string, boolean>, patch: Record<string, boolean>, t: string, by: string): RecycleChangeLine[] {
  return Object.entries(patch).flatMap(([session, to]) => ((cur[session] ?? false) !== to ? [{ t, kind: "control" as const, op: "recycle-auto" as const, by, session, from: cur[session] ?? false, to }] : []));
}

// ── STOP 확인(ATC-165 1.5) ──
// `claude agents`만 보면 안 된다: done에서 STOP한 job은 pid·status 없는 줄로 남는다(STALE). 저장한 pid가 사라졌는지가 직접 증거이고,
// pid를 모르면 (줄이 없거나 pid·status가 없는 줄)로 본다
export interface GoneInput {
  pid: number | null;
  pidAlive: boolean | null; // process.kill(pid, 0). pid를 모르면 null
  row: { pid?: number; status?: string } | null; // STOP 뒤의 그 job의 줄(없으면 null)
}
export function goneOf(i: GoneInput): { gone: boolean; ghost: boolean } {
  const rowGone = i.row === null || (i.row.pid == null && i.row.status == null);
  const ghost = i.row !== null && rowGone;
  if (i.pid !== null) return { gone: i.pidAlive === false && rowGone, ghost };
  return { gone: rowGone, ghost };
}

// ── 기록·알림 입력 ──

export { type OverCap, overCapAlertTextOf, type RecycleRecord, type RecycleResult, recycleAlertTextOf, type WaitStuck, waitAlertTextOf } from "./control-recycle-text.ts";
