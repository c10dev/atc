import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { severityOf } from "./landing.ts";

// MCC(docs/mcc.md): atc 자신의 PR을 INSPECTION하고, 규칙이 허락하면 착륙시키고, 7700을 새 코드로 RETURN TO SERVICE한다.
// 이 파일은 설정·기록 읽기와 순수 계산, 실행(GitHub 쓰기·RTS 시작)은 mcc-run.ts.
// 스위치는 SUPERVISOR만 바꾼다(설정 창, 이 화면 Origin만). 관제 세션 CLI(atcctl)에는 명령이 없다.

export type MccMode = "shadow" | "land" | "land+rts";
export const MCC_MODES: readonly MccMode[] = ["shadow", "land", "land+rts"];

// ~/.local/state/atc/mcc.json (원자적으로 바꿔 쓴다)
export interface MccConfig {
  mode: MccMode;
  airport: string; // MCC가 맡는 AIRPORT 코드(atc 저장소)
  ciCheck: string; // 착륙 조건 L4의 CI 체크 이름
  holds: number[]; // SUPERVISOR가 HOLD한 PR 번호: 착륙시키지 않는다
}
export const DEFAULT_MCC: MccConfig = { mode: "shadow", airport: "ATCC", ciCheck: "check", holds: [] };

const CONFIG_FILE = () => join(config.stateDir, "mcc.json");
export const RECORD_FILE = () => join(config.stateDir, "mcc.jsonl");
export const RTS_FILE = () => join(config.stateDir, "rts.jsonl");

// 모르는 값은 기본값(shadow)으로 — 깨진 파일이 무엇도 켜지 않게
export function parseMcc(raw: unknown): MccConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_MCC;
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  return {
    mode: MCC_MODES.includes(r.mode as MccMode) ? (r.mode as MccMode) : d.mode,
    airport: text(r.airport, d.airport).toUpperCase(),
    ciCheck: text(r.ciCheck, d.ciCheck),
    holds: [...new Set((Array.isArray(r.holds) ? r.holds : []).filter((n): n is number => Number.isInteger(n) && n > 0))],
  };
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
export const loadMcc = (file = CONFIG_FILE()) => parseMcc(readJson(file));
// 사용자가 적어 둔 다른 키는 그대로 두고 바꾼 것만 쓴다
export function saveMcc(next: MccConfig, file = CONFIG_FILE()) {
  const user = readJson(file);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...(user && typeof user === "object" ? user : {}), ...next }, null, 2) + "\n");
  renameSync(tmp, file);
}

// ── 기록(mcc.jsonl, 추가만) ──
export type InspectVerdict = "pass" | "findings";
export interface Inspection {
  op: "inspect";
  at: string;
  pr: number;
  head: string;
  verdict: InspectVerdict;
  text: string;
  model: string;
  p0: number;
  p1: number;
  p2: number;
  comment?: "posted" | "failed"; // findings를 PR 댓글로 남긴 결과(SUPERVISOR 결정 2026-09-28)
}
export type MccRecord =
  | Inspection
  | { op: "escalate"; at: string; pr: number; head: string; reason: string; model?: string }
  | { op: "land" | "would-land"; at: string; pr: number; head: string; tier: string; result: "ok" | "rejected" | "failed"; detail?: string; model?: string }
  | { op: "rts" | "would-rts"; at: string; from: string | null; to: string; result: "started" | "failed"; detail?: string; model?: string }
  | { op: "mode"; at: string; mode: MccMode; detail: string }
  | { op: "hold" | "unhold"; at: string; pr: number };

export function appendMccRecord(r: MccRecord, file = RECORD_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(r)}\n`);
}

// 파일이 바뀌었을 때만 다시 읽는다(스냅샷마다 부른다)
const caches = new Map<string, { key: string; lines: unknown[] }>();
export function readJsonl<T>(file: string): T[] {
  let key = "";
  try {
    const st = statSync(file);
    key = `${st.size}:${st.mtimeMs}`;
  } catch {
    return [];
  }
  const hit = caches.get(file);
  if (hit?.key === key) return hit.lines as T[];
  const lines: unknown[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l) continue;
    try {
      lines.push(JSON.parse(l));
    } catch {}
  }
  caches.set(file, { key, lines });
  return lines as T[];
}
export const readMccRecords = (file = RECORD_FILE()) => readJsonl<MccRecord>(file);

// 이 head의 마지막 INSPECTION. 새 head는 새 INSPECTION이 필요하다
export function inspectionOf(records: readonly MccRecord[], pr: number, head: string): Inspection | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.op === "inspect" && r.pr === pr && r.head === head) return r;
  }
  return null;
}
// ESCALATE는 PR에 붙는다(head가 바뀌어도 남는다). 사용자 등급이 되면 사용자가 머지한다
export function escalationOf(records: readonly MccRecord[], pr: number): { reason: string; head: string; at: string } | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.op === "escalate" && r.pr === pr) return { reason: r.reason, head: r.head, at: r.at };
  }
  return null;
}

// INSPECTION을 남길 수 있는 모델: Claude(SUPERVISOR 결정 2026-09-28). guard(--mcc)가 세션 기록의 실제 모델을 붙인다
export const MCC_MODELS = /^claude-(opus|sonnet|fable|haiku)\b/i;
export const INSPECT_TEXT_MAX = 4000;

export class MccError extends Error {
  status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.status = status;
  }
}

// MCC 쓰기(inspect·escalate·land·rts)는 MCC guard가 붙인 실제 모델(ATC_MCC_MODEL)이 있어야 한다.
// TOWER·OCC guard는 atcctl을 모두 통과시키지만 이 값을 붙이지 않으므로, 그 세션의 atcctl mcc 쓰기는 여기서 막힌다
export function mccModelOf(body: Record<string, unknown>): string {
  const model = typeof body.model === "string" ? body.model.trim().slice(0, 120) : "";
  if (!model) throw new MccError("model이 없음 — MCC 세션에서만 쓴다(guard가 실제 모델을 붙인다)", 400);
  if (!MCC_MODELS.test(model)) throw new MccError(`MCC는 Claude 모델만 — 지금 ${model}`, 400);
  return model;
}

// INSPECTION 입력 검사: head는 지금 head(짧은 SHA도 됨), verdict pass|findings, text 필수.
// 지적 등급은 P0·P1·P2 — pass에는 P0·P1을 적지 않고, findings에는 등급이 하나 이상 있어야 한다
export function parseInspect(body: Record<string, unknown>, pr: number, head: string, at: string): Inspection {
  const want = typeof body.head === "string" ? body.head.trim().toLowerCase() : "";
  if (want.length < 7 || !head.startsWith(want)) throw new MccError(`head가 지금 head(${head.slice(0, 7)})와 다름 — 새 head는 새 INSPECTION이 필요하다`, 409);
  if (body.verdict !== "pass" && body.verdict !== "findings") throw new MccError("verdict는 pass|findings", 400);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new MccError("text(INSPECTION 내용)가 필요함", 400);
  if (text.length > INSPECT_TEXT_MAX) throw new MccError(`text는 ${INSPECT_TEXT_MAX}자 이내 (지금 ${text.length}자)`, 400);
  const sev = severityOf(text);
  if (body.verdict === "pass" && (sev.p0 || sev.p1)) throw new MccError("pass에는 P0·P1 지적을 적지 않는다 — 있으면 findings", 400);
  if (body.verdict === "findings" && !sev.p0 && !sev.p1 && !sev.p2) throw new MccError("findings에는 P0·P1·P2 등급을 하나 이상 적는다", 400);
  const model = mccModelOf(body);
  return { op: "inspect", at, pr, head, verdict: body.verdict, text, model, p0: sev.p0, p1: sev.p1, p2: sev.p2 };
}

// findings를 PR에 남기는 댓글. 고칠 사람이 PR에서 바로 보게 한다
export const inspectionComment = (i: Pick<Inspection, "head" | "text" | "p0" | "p1" | "p2">) =>
  `**MCC INSPECTION — findings** (head \`${i.head.slice(0, 7)}\`, P0 ${i.p0} · P1 ${i.p1} · P2 ${i.p2})\n\n${i.text}\n\n— atc MCC (docs/mcc.md). 고친 뒤 새 head에서 다시 INSPECTION합니다.`;

// ── 착륙 조건(docs/mcc.md 5장, L2–L8. L1 모드는 실행부가 본다: shadow면 would-land로 남긴다) ──
export type CiState = "ok" | "pending" | "failed" | "none";
export interface LandInput {
  pr: { state: string; draft: boolean; base: string; head: string; mergeableState: string; fork: boolean };
  defaultBranch: string;
  head: string; // 요청한 head
  tier: "auto" | "flagged" | "user";
  tierReasons: string[];
  escalated: { reason: string } | null;
  ci: CiState;
  ciCheck: string;
  inspection: Pick<Inspection, "verdict"> | null;
  held: boolean;
  groundStop: string | null; // ATCC에 걸린 GROUND STOP 사유
  rtsBlocked: string | null; // RTS가 돌고 있거나 ROLLBACK 뒤 SUPERVISOR를 기다림
}
export interface LandBlock {
  code: "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8";
  text: string;
}
export function landBlocksOf(x: LandInput): LandBlock[] {
  const out: LandBlock[] = [];
  const short = (s: string) => s.slice(0, 7);
  if (x.pr.state !== "open") out.push({ code: "L2", text: `PR이 열려 있지 않음(${x.pr.state})` });
  if (x.pr.draft) out.push({ code: "L2", text: "Draft PR" });
  // 공개 저장소라 fork에서 온 PR은 착륙시키지 않는다(같은 저장소의 브랜치만)
  if (x.pr.fork) out.push({ code: "L2", text: "fork에서 온 PR — 사용자가 머지" });
  if (x.pr.base !== x.defaultBranch) out.push({ code: "L2", text: `base가 ${x.defaultBranch}이 아님(${x.pr.base})` });
  if (!x.pr.head.startsWith(x.head.toLowerCase()) || x.head.length < 7) out.push({ code: "L2", text: `head가 움직임(지금 ${short(x.pr.head)}) — 새 head로 다시` });
  if (x.escalated) out.push({ code: "L3", text: `ESCALATE됨 — 사용자가 머지(${x.escalated.reason})` });
  else if (x.tier === "user") out.push({ code: "L3", text: `user 등급 — 사용자가 머지(${x.tierReasons.join(", ") || "경로 규칙"})` });
  if (x.ci === "none") out.push({ code: "L4", text: `head에 CI ${x.ciCheck}가 없음` });
  else if (x.ci === "pending") out.push({ code: "L4", text: `CI ${x.ciCheck} 진행 중` });
  else if (x.ci === "failed") out.push({ code: "L4", text: `CI ${x.ciCheck} 실패` });
  // GitHub mergeable_state: clean만 통과. unstable(필수 아닌 체크 실패)도 받는다 — 필수 체크는 L4가 본다
  if (!["clean", "unstable", "has_hooks"].includes(x.pr.mergeableState)) {
    const why: Record<string, string> = { dirty: "base와 충돌", behind: "base보다 뒤처짐", blocked: "GitHub 보호 규칙이 막음", draft: "Draft", unknown: "GitHub이 아직 계산 중" };
    out.push({ code: "L5", text: `머지 상태 ${x.pr.mergeableState}${why[x.pr.mergeableState] ? ` — ${why[x.pr.mergeableState]}` : ""}` });
  }
  if (!x.inspection) out.push({ code: "L6", text: `head ${short(x.pr.head)}에 INSPECTION 없음` });
  else if (x.inspection.verdict !== "pass") out.push({ code: "L6", text: "INSPECTION findings — 고친 뒤 새 head에서 다시" });
  if (x.held) out.push({ code: "L7", text: "SUPERVISOR HOLD" });
  if (x.groundStop) out.push({ code: "L7", text: `GROUND STOP — ${x.groundStop}` });
  if (x.rtsBlocked) out.push({ code: "L8", text: x.rtsBlocked });
  return out;
}

// ── RETURN TO SERVICE(docs/mcc.md 6장) ──
// rts.jsonl은 deploy/rts.mjs가 쓴다(7단계). 여기서는 읽기만: 마지막 시도와 ROLLBACK 뒤 멈춤
export interface RtsRecord {
  at: string;
  from: string | null;
  to: string;
  result: "running" | "ok" | "refused" | "rollback" | "failed";
  detail?: string;
}
export const RTS_SPACING_MS = 5 * 60_000;
export interface RtsInput {
  deployed: string | null; // 서비스가 시작한 커밋(/api/version head)
  main: string | null; // origin 기본 브랜치 head
  mainCi: CiState;
  last: RtsRecord | null; // rts.jsonl 마지막 줄
  lastStartAt: string | null; // mcc.jsonl의 마지막 rts 시작
  now: number;
}
// ROLLBACK 뒤에는 SUPERVISOR가 모드를 다시 고를 때까지 멈춘다(모드 기록이 ROLLBACK보다 늦으면 풀림)
export function rtsStopOf(last: RtsRecord | null, lastModeAt: string | null): string | null {
  if (!last) return null;
  if (last.result === "running") return `RTS 진행 중(${last.to.slice(0, 7)})`;
  if (last.result === "rollback" && !(lastModeAt && Date.parse(lastModeAt) > Date.parse(last.at)))
    return `ROLLBACK 뒤 멈춤(${last.at}) — SUPERVISOR가 설정 창에서 MCC 모드를 다시 고르면 풀림`;
  return null;
}
export function rtsDueOf(x: RtsInput, stop: string | null): { due: boolean; why: string } {
  if (stop) return { due: false, why: stop };
  if (!x.deployed) return { due: false, why: "서비스의 커밋을 모름(/api/version head)" };
  if (!x.main) return { due: false, why: "기본 브랜치 head를 모름" };
  if (x.main.startsWith(x.deployed) || x.deployed.startsWith(x.main)) return { due: false, why: "서비스가 최신" };
  if (x.mainCi !== "ok") return { due: false, why: `기본 브랜치 CI ${x.mainCi === "none" ? "없음" : x.mainCi === "pending" ? "진행 중" : "실패"}` };
  if (x.lastStartAt && x.now - Date.parse(x.lastStartAt) < RTS_SPACING_MS) return { due: false, why: "지난 RTS에서 5분이 안 지남" };
  return { due: true, why: `${x.deployed.slice(0, 7)} → ${x.main.slice(0, 7)}` };
}

// ── LANDING 조건 연결(landing.ts): MCC가 맡은 저장소의 PR은 INSPECTION이 리뷰를 대신한다 ──
export interface MccReview {
  verdict: InspectVerdict;
  text: string;
  p0: number;
  p1: number;
  p2: number;
}

// ── 등급(deploy/landing-tier.mjs tierOf) ──
// deploy/는 사용자 등급이라 타입 파일을 두지 않고 동적으로 읽는다
type TierOf = (files: string[]) => { tier: "auto" | "flagged" | "user"; reasons: { file: string; tier: string; why: string }[] };
let tierFn: TierOf | null = null;
export async function tierOfFiles(files: string[]): Promise<ReturnType<TierOf>> {
  if (!tierFn) tierFn = ((await import(new URL("../deploy/landing-tier.mjs", import.meta.url).href)) as { tierOf: TierOf }).tierOf;
  return tierFn(files);
}
