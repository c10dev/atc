import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { Job } from "./job-state.ts";

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
export const CAP_MIN = 50_000;
export const CAP_MAX = 900_000;

// ~/.local/state/atc/control-recycle.json (원자적으로 바꿔 쓴다)
export interface RecycleConfig {
  mode: RecycleMode;
  caps: Record<string, number | null>; // 세션 이름 → CAP 토큰. null이면 그 세션은 재시작하지 않는다
  auto: Record<string, boolean>; // 세션 이름 → atc가 스스로 재시작해도 되나. false면 측정·알림만(OCC 기본)
  cooldownHours: number; // 같은 세션을 다시 재시작하지 않는 시간
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
  return {
    mode: RECYCLE_MODES.includes(r.mode as RecycleMode) ? (r.mode as RecycleMode) : "off",
    caps,
    auto,
    cooldownHours: typeof h === "number" && Number.isFinite(h) && h >= 0.5 && h <= 48 ? h : DEFAULT_COOLDOWN_HOURS,
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
  occ: { approved: number; recalling: number; youngSent: number; crewChangeOpen: number } | null; // 승인됐지만 아직 안 나간 FLIGHT PLAN, RECALL 중, 10분 안에 나간 것, 열린 CREW CHANGE
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
      if (f.tower.events > 0) out.push(`brief에 처리하지 않은 이벤트 ${f.tower.events}건`);
      if (f.tower.overdue > 0) out.push(`overdue CLEARANCE ${f.tower.overdue}건`);
    }
  } else if (n === "OCC") {
    if (!f.occ) out.push("dispatch brief를 읽지 못함");
    else {
      if (f.occ.approved > 0) out.push(`승인됐지만 나가지 않은 FLIGHT PLAN ${f.occ.approved}건`);
      if (f.occ.recalling > 0) out.push(`RECALL 진행 ${f.occ.recalling}건`);
      if (f.occ.youngSent > 0) out.push(`10분 안에 나간 FLIGHT PLAN ${f.occ.youngSent}건(READBACK이 오는 중일 수 있음)`);
      if (f.occ.crewChangeOpen > 0) out.push(`열린 CREW CHANGE ${f.occ.crewChangeOpen}건`);
    }
  } else if (n === "MCC") {
    if (!f.mcc) out.push("MCC queue를 읽지 못함");
    else if (f.mcc.blocked) out.push(f.mcc.blocked);
  }
  return out; // CROSSCHECK·REVIEW: 공통 두 조건뿐
}

// job이 한 턴을 마치고 쉬는 중(ATC-165 1.3): state done, tempo idle. working·blocked면 턴을 버리게 된다
export const jobIdle = (job: Pick<Job, "state" | "tempo"> | null | undefined): boolean => job?.state === "done" && job.tempo === "idle";

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

export { type OverCap, overCapAlertTextOf, type RecycleRecord, type RecycleResult, recycleAlertTextOf } from "./control-recycle-text.ts";
