import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { JsonlCache } from "./jsonl-cache.ts";
import { config } from "./config.ts";
import { type KVerdict, kWhyOf } from "./k-approval.ts";
import { severityOf } from "./landing.ts";

// MCC(docs/mcc.md): atc 자신의 PR을 INSPECTION하고, 규칙이 허락하면 착륙시키고, 7700을 새 코드로 RETURN TO SERVICE한다.
// 이 파일은 설정·기록 읽기와 순수 계산, 실행(GitHub 쓰기·RTS 시작)은 mcc-run.ts.
// 스위치는 SUPERVISOR만 바꾼다(설정 창, 이 화면 Origin만). 관제 세션 CLI(atcctl)에는 명령이 없다.

export type MccMode = "shadow" | "land" | "land+rts" | "rts";
export const MCC_MODES: readonly MccMode[] = ["shadow", "land", "land+rts", "rts"];
// MCC가 착륙시키는 모드(land, land+rts). rts에서는 SUPERVISOR가 손으로 머지하므로 MCC는 would-land만 남긴다
export const mccLands = (m: MccMode) => m === "land" || m === "land+rts";
// 서버가 스스로 RETURN TO SERVICE를 시작하는 모드(ATC-84): rts(SUPERVISOR 머지), land+rts(MCC 착륙)
export const mccDeploys = (m: MccMode) => m === "rts" || m === "land+rts";

// ~/.local/state/atc/mcc.json (원자적으로 바꿔 쓴다)
export interface MccConfig {
  mode: MccMode;
  airport: string; // MCC가 맡는 AIRPORT 코드(atc 저장소)
  ciCheck: string; // 착륙 조건 L4의 CI 체크 이름
  holds: number[]; // SUPERVISOR가 HOLD한 PR 번호: 착륙시키지 않는다
  // K 승인 착륙(ATC-391): 발권 때 승인한 K 효과 안에서 만든 user 등급 PR을 MCC가 착륙시킨다. 기본 on(처음부터 켬), 끄는 것은 SUPERVISOR만(설정 창)
  kApproval: "on" | "off";
  // 지우기 규칙(ATC-495): 작업 지시서가 이름 붙이지 않은 기능을 지우는 PR을 inspector가 ESCALATE하고 `Removed:` 줄을 요구한다. 기본 on, 끄는 것은 SUPERVISOR만(설정 창)
  removalGuard: "on" | "off";
  // 서버의 기계적 판단(ATC-556): auto 등급 PR의 LAND와 그 RTS를 MCC 세션의 /tick 없이 서버가 한다. 기본 on, 끄면 MCC 세션이 다시 한다(SUPERVISOR만, 설정 창)
  serverAuto: "on" | "off";
}
export const DEFAULT_MCC: MccConfig = { mode: "shadow", airport: "ATCC", ciCheck: "check", holds: [], kApproval: "on", removalGuard: "on", serverAuto: "on" };

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
    kApproval: r.kApproval === "off" ? "off" : d.kApproval, // 꺼지는 것은 정확히 "off"일 때뿐
    removalGuard: r.removalGuard === "off" ? "off" : d.removalGuard, // 꺼지는 것은 정확히 "off"일 때뿐. 깨진 파일은 기본(on)이다: 읽을 수 없는 설정이 규칙을 끄지 않는다
    serverAuto: r.serverAuto === "off" ? "off" : d.serverAuto, // 꺼지는 것은 정확히 "off"일 때뿐
  };
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
// 파일이 있는데 JSON이 깨졌으면 K 승인 착륙은 끈다(ATC-391: 읽을 수 없는 설정이 자동 착륙을 켠 채로 두지 않는다). 파일이 없으면 기본(on)
export function loadMcc(file = CONFIG_FILE()): MccConfig {
  const parsed = parseMcc(readJson(file));
  if (!existsSync(file) || readJson(file) !== null) return parsed;
  return { ...parsed, kApproval: "off", serverAuto: "off" }; // 깨진 파일이면 서버 자동 착륙도 끈다(읽을 수 없는 설정이 머지를 켠 채로 두지 않는다)
}
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
  | { op: "land" | "would-land"; at: string; pr: number; head: string; tier: string; result: "ok" | "rejected" | "failed" | "already-landed"; detail?: string; model?: string; by?: "supervisor" | "server"; k?: { release: string; flight: string; channel: string } } // k: K 승인으로 착륙한 user 등급 PR의 발권 id(ATC-391). already-landed: 다른 쪽이 같은 PR을 같은 때 먼저 머지함(ATC-563)
  | { op: "rts" | "would-rts"; at: string; from: string | null; to: string; result: "started" | "failed"; detail?: string; model?: string; by?: "supervisor" | "server" }
  | { op: "mode"; at: string; mode: MccMode; detail: string; kApproval?: "on" | "off"; removalGuard?: "on" | "off"; serverAuto?: "on" | "off" } // kApproval: K 승인 착륙 스위치를 바꾼 줄(ATC-391). mode는 그때의 MCC 모드 그대로
  | { op: "hold" | "unhold"; at: string; pr: number };

export function appendMccRecord(r: MccRecord, file = RECORD_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(r)}\n`);
}

// 파일이 바뀌었을 때만 읽는다. 자라기만 했으면 새 바이트만(jsonl-cache.ts, ATC-537). 돌려준 배열은 읽기 전용으로 쓴다
const jsonl = new JsonlCache<unknown>();
export function readJsonl<T>(file: string): T[] {
  return jsonl.read(file).lines as T[];
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
// 이 head의 리뷰(ATC-390): INSPECTION 기록이 있으면 그것, 없고 MCC가 이 head를 ESCALATE했으면 P0·P1 없는 pass로 센다.
// ESCALATE는 MCC가 이 head를 보고 사용자에게 넘긴다는 뜻이다. P0·P1이 있으면 MCC가 같은 head에 findings INSPECTION도 남기고(mcc/CLAUDE.md), 그 기록이 먼저다.
// head가 바뀌면 ESCALATE는 PR에 남지만(escalationOf) 리뷰는 아니다: 새 head는 새 INSPECTION이 필요하다
export function reviewOfHead(records: readonly MccRecord[], pr: number, head: string): Pick<Inspection, "verdict" | "text" | "p0" | "p1" | "p2" | "at"> | null {
  const inspected = inspectionOf(records, pr, head);
  if (inspected) return inspected;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.op === "escalate" && r.pr === pr && r.head === head) return { verdict: "pass", text: `MCC ESCALATE: ${r.reason}`, p0: 0, p1: 0, p2: 0, at: r.at };
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
  checkPath?: string | null; // 이 PR이 K 승인 검사 자체를 바꾸는 파일(k-approval.ts CHECK_CORE). 등급과 상관없이 L3: 늘 사용자가 머지(ATC-391)
  kApproval?: KVerdict | null; // K 승인 판정(ATC-391, k-approval.ts). ok면 user 등급의 L3를 푼다. ESCALATE(의심)는 늘 막는다
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
  else if (x.checkPath && x.tier !== "user") out.push({ code: "L3", text: `K 승인 검사 자체를 바꾸는 PR(${x.checkPath}) — 사용자가 머지` });
  else if (x.tier === "user" && !x.kApproval?.ok) out.push({ code: "L3", text: `user 등급 — 사용자가 머지(${x.tierReasons.join(", ") || "경로 규칙"})${x.kApproval ? ` · ${kWhyOf(x.kApproval)}` : ""}` });
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
  sessions?: { id: string; name: string | null }[]; // 세션 점검(ATC-102)이 실패했을 때 죽은 세션
}
export const RTS_SPACING_MS = 5 * 60_000;
export interface RtsInput {
  deployed: string | null; // 서비스가 시작한 커밋(/api/version head)
  main: string | null; // origin 기본 브랜치 head
  mainCi: CiState;
  last: RtsRecord | null; // rts.jsonl 마지막 줄
  lastStartAt: string | null; // 5분 간격을 세는 마지막 rts 시작(거절된 시작은 뺀 것, spacingStartOf)
  now: number;
  mainReadAt?: string | null; // atc가 main의 CI 상태를 읽은 시각(main 상태 at)
  lastLandAt?: string | null; // mcc.jsonl의 마지막 실제 착륙(land ok)
}
// 5분 간격을 세는 마지막 RTS 시작(순수, ATC-121). mcc.jsonl의 rts started 가운데, 그 시작의 결과가 unit의 "refused"(rts.jsonl에서 시작 뒤,
// 같은 main을 향한 줄)인 것은 뺀다 — 거절된 시작이 다음 시작을 5분 막지 않게. 아직 결과가 없거나 running·ok·rollback·failed면 센다
export function spacingStartOf(records: readonly MccRecord[], rts: readonly RtsRecord[]): string | null {
  const same = (a: string | null, b: string) => Boolean(a) && (a!.startsWith(b) || b.startsWith(a!));
  type Start = { at: string; to: string };
  const starts: Start[] = [];
  for (const r of records) if (r.op === "rts" && r.result === "started") starts.push({ at: r.at, to: r.to });
  for (let i = starts.length - 1; i >= 0; i--) {
    const r = starts[i];
    const until = i + 1 < starts.length ? Date.parse(starts[i + 1].at) : Infinity; // 다음 시작 전까지가 이 시작의 결과다
    const own = rts.filter((x) => Date.parse(x.at) >= Date.parse(r.at) && Date.parse(x.at) < until && same(x.to, r.to));
    if (own.length && own.every((x) => x.result === "refused")) continue;
    return r.at;
  }
  return null;
}
// 서버의 자동 RTS 판정(순수, ATC-84). rts·land+rts에서 서버가 스스로 유닛을 시작해도 되나.
// 시작 조건은 rtsDueOf(5분 간격 포함)와 같고, 거절이 이미 예상되거나 같은 main으로 거절·실패한 뒤에는 사람에게 넘긴다
export interface AutoRtsInput {
  mode: MccMode;
  due: { due: boolean; why: string }; // rtsDueOf(5분 간격)
  main: string | null;
  rangeRefusal: string | null; // 범위가 package*.json·유닛 파일을 바꾸면 사람이 배포(deploy/rts.mjs planRts)
  guard: string | null; // 이 서버가 유닛을 시작할 수 없는 사유(시험 서버)
  last: RtsRecord | null; // rts.jsonl 마지막 줄
  lastFailedAt: string | null; // mcc.jsonl의 마지막 rts failed(같은 main, 유닛 시작 오류)
  // 서버 자동(ATC-556): 스위치가 on이고 deployed..main 범위의 PR이 모두 서버가 착륙시킨 것이면 shadow·land 모드에서도 RTS를 시작한다
  viaAuto?: boolean;
  now: number;
}
export function autoRtsOf(x: AutoRtsInput): { start: boolean; why: string } {
  if (!mccDeploys(x.mode) && !x.viaAuto) return { start: false, why: `모드 ${x.mode}: 자동 배포 꺼짐` };
  if (x.guard) return { start: false, why: x.guard };
  if (!x.due.due) return { start: false, why: x.due.why };
  if (x.rangeRefusal) return { start: false, why: `사람이 배포: ${x.rangeRefusal}` };
  const same = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
  if (x.last && x.main && (x.last.result === "refused" || x.last.result === "failed") && same(x.last.to, x.main))
    return { start: false, why: `자동 배포 멈춤 — 같은 main(${x.main.slice(0, 7)})에 RTS가 ${x.last.result === "refused" ? "거절" : "실패"}함. UPDATE 바에서 사람이` };
  if (x.lastFailedAt && x.now - Date.parse(x.lastFailedAt) < RTS_SPACING_MS) return { start: false, why: "유닛 시작이 방금 실패함 — 5분 뒤 다시" };
  return { start: true, why: x.due.why };
}
// mcc.jsonl의 마지막 rts failed(유닛 시작 오류) 가운데 이 main을 향한 것의 시각
export function lastRtsFailureOf(records: readonly MccRecord[], main: string | null): string | null {
  if (!main) return null;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.op === "rts" && r.result === "failed" && (r.to.startsWith(main) || main.startsWith(r.to))) return r.at;
  }
  return null;
}
// UPDATE 바에 보이는 자동 배포 상태: 켜짐이고, 5분 간격 때문에 기다리는 중이면 다음 시각
export function autoRtsInfoOf(mode: MccMode, spacingStartAt: string | null, behind: boolean, now: number): { on: boolean; nextAt: string | null } {
  if (!mccDeploys(mode)) return { on: false, nextAt: null };
  const t = spacingStartAt ? Date.parse(spacingStartAt) + RTS_SPACING_MS : NaN;
  return { on: true, nextAt: behind && Number.isFinite(t) && t > now ? new Date(t).toISOString() : null };
}
// ROLLBACK 뒤에는 SUPERVISOR가 모드를 다시 고를 때까지 멈춘다(모드 기록이 ROLLBACK보다 늦으면 풀림)
export function rtsStopOf(last: RtsRecord | null, lastModeAt: string | null): string | null {
  if (!last) return null;
  if (last.result === "running") return `RTS 진행 중(${last.to.slice(0, 7)})`;
  if (last.result === "rollback" && !(lastModeAt && Date.parse(lastModeAt) > Date.parse(last.at)))
    return `ROLLBACK 뒤 멈춤(${last.at}) — SUPERVISOR가 설정 창에서 MCC 모드를 다시 고르면 풀림`;
  return null;
}
// 실제 atc-rts 유닛은 7700을 배포한다. 임시 상태 폴더나 7700이 아닌 포트로 도는 서버(시험)는 시작하지 않는다.
// 진짜 상태 폴더는 HOME 환경 변수가 아니라 계정(passwd)의 홈에서 잡는다(임시 HOME으로 띄운 시험 서버를 못 속이게)
export const REAL_PORT = 7700;
export function rtsUnitGuard(x: { stateDir: string; port: number; realStateDir: string }): string | null {
  if (x.port !== REAL_PORT) return `시험 서버(포트 ${x.port})는 atc-rts를 시작하지 않음 — 운영 7700을 배포하는 유닛이라서`;
  if (resolve(x.stateDir) !== resolve(x.realStateDir)) return "임시 상태 폴더의 서버는 atc-rts를 시작하지 않음 — 운영 7700을 배포하는 유닛이라서";
  return null;
}
// spacingMs: MCC가 여는 RTS는 머지 여러 개를 한 번에 묶으려고 5분 간격을 둔다. SUPERVISOR 클릭(UPDATE 바)은 0
export function rtsDueOf(x: RtsInput, stop: string | null, spacingMs = RTS_SPACING_MS): { due: boolean; why: string } {
  if (stop) return { due: false, why: stop };
  if (!x.deployed) return { due: false, why: "서비스의 커밋을 모름(/api/version head)" };
  if (!x.main) return { due: false, why: "기본 브랜치 head를 모름" };
  if (x.main.startsWith(x.deployed) || x.deployed.startsWith(x.main)) return { due: false, why: "서비스가 최신" };
  if (x.mainCi !== "ok") return { due: false, why: `기본 브랜치 CI ${x.mainCi === "none" ? "없음" : x.mainCi === "pending" ? "진행 중" : "실패"}` };
  // 마지막 착륙이 atc가 main CI를 읽은 때보다 늦으면 그 CI 상태는 착륙 전 커밋의 것일 수 있다(ATC-121)
  if (x.lastLandAt && x.mainReadAt && Date.parse(x.lastLandAt) > Date.parse(x.mainReadAt)) return { due: false, why: "마지막 착륙 뒤 main CI를 아직 다시 읽지 못함" };
  if (spacingMs > 0 && x.lastStartAt && x.now - Date.parse(x.lastStartAt) < spacingMs) return { due: false, why: "지난 RTS에서 5분이 안 지남" };
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

// ── SHADOW GATE(docs/mcc.md 9장): 머지된 atc PR과 MCC 기록을 맞춰 land로 올릴 근거를 잰다 ──
// 읽기만 한다: LOGBOOK(머지·되돌림)과 mcc.jsonl. 모드는 바꾸지 않는다 — ready여도 SUPERVISOR가 설정 창에서 올린다
export const MCC_GATE = { prs: 20, days: 5, reverted: 0 } as const;
const GATE_OPS = new Set<MccRecord["op"]>(["inspect", "escalate", "would-land", "land"]);

// LOGBOOK에서 쓰는 것만(logbook.ts LogEntry)
export interface GateEntry {
  airport: string | null;
  pr: { number: number; url: string; title: string };
  arrivedAt: string;
  reverted: boolean;
  revertedBy?: { number: number; url: string; at: string } | null;
}
export interface GatePr {
  pr: number;
  title: string;
  url: string;
  arrivedAt: string;
  head: string | null; // 머지된 head. 모르면 null(머지 전 마지막 INSPECTION으로 대신 맞춘다)
  inspection: InspectVerdict | null; // 머지된 head의 마지막 INSPECTION
  staleInspection: boolean; // INSPECTION이 머지된 head가 아닌 옛 head에만 있었다
  wouldLand: boolean; // 머지된 head에 would-land(또는 MCC가 LANDED)
  escalated: boolean;
  landedBy: "mcc" | "other"; // MCC가 LANDED면 mcc, 아니면 사람·structure
  reverted: boolean;
  revertedBy: { number: number; url: string; at: string } | null;
}
export type GateMissKind = "findings" | "no-inspection" | "reverted-would-land";
export interface GateMiss {
  pr: number;
  title: string;
  url: string;
  kind: GateMissKind;
  text: string;
}
export interface MccGate {
  airport: string;
  since: string | null; // 첫 MCC 기록(inspect·escalate·would-land·land)
  days: number; // since부터 지금까지(일, 소수 첫째 자리)
  merged: number; // since 뒤 머지된 PR
  prs: number; // 그중 MCC가 판단한 PR: 머지된 head에 INSPECTION이 있거나 ESCALATE
  wouldLand: number;
  reverted: number; // would-land였는데 되돌린 PR
  target: typeof MCC_GATE;
  ready: boolean;
  rows: GatePr[]; // 도착 최신순
  misses: GateMiss[];
}

export function mccGateOf(x: { records: readonly MccRecord[]; entries: readonly GateEntry[]; airport: string; heads: ReadonlyMap<number, string>; now: number }): MccGate {
  const first = x.records.find((r) => GATE_OPS.has(r.op));
  const since = first?.at ?? null;
  const sinceMs = since ? Date.parse(since) : Infinity;
  const days = since ? Math.max(0, Math.floor(((x.now - sinceMs) / 86_400_000) * 10) / 10) : 0;
  const entries = x.entries.filter((e) => e.airport === x.airport && Date.parse(e.arrivedAt) >= sinceMs).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  const rows: GatePr[] = [];
  const misses: GateMiss[] = [];
  for (const e of entries) {
    const n = e.pr.number;
    const mergedMs = Date.parse(e.arrivedAt);
    const mine = x.records.filter((r): r is Extract<MccRecord, { pr: number }> => "pr" in r && r.pr === n && Date.parse(r.at) <= mergedMs);
    const known = x.heads.get(n) ?? null;
    const inspections = mine.filter((r): r is Inspection => r.op === "inspect");
    // head를 모르면 머지 전 마지막 INSPECTION의 head를 머지된 head로 본다
    const head = known ?? inspections.at(-1)?.head ?? null;
    const onHead = (r: { head: string }) => head !== null && r.head === head;
    const inspection = inspections.filter(onHead).at(-1) ?? null;
    const landed = mine.some((r) => r.op === "land" && r.result === "ok" && onHead(r));
    const wouldLand = landed || mine.some((r) => r.op === "would-land" && r.result === "ok" && onHead(r));
    const row: GatePr = {
      pr: n,
      title: e.pr.title,
      url: e.pr.url,
      arrivedAt: e.arrivedAt,
      head: known,
      inspection: inspection?.verdict ?? null,
      staleInspection: !inspection && inspections.length > 0,
      wouldLand,
      escalated: mine.some((r) => r.op === "escalate"),
      landedBy: landed ? "mcc" : "other",
      reverted: e.reverted,
      revertedBy: e.revertedBy ?? null,
    };
    rows.push(row);
    const miss = (kind: GateMissKind, text: string) => misses.push({ pr: n, title: e.pr.title, url: e.pr.url, kind, text });
    if (row.landedBy === "other" && row.inspection === "findings") miss("findings", "사람·structure가 머지 — MCC INSPECTION은 findings");
    else if (row.landedBy === "other" && !row.inspection && !row.escalated)
      miss("no-inspection", row.staleInspection ? "사람·structure가 머지 — MCC는 옛 head만 INSPECTION" : "사람·structure가 머지 — MCC INSPECTION 없음");
    if (row.wouldLand && row.reverted) miss("reverted-would-land", `MCC ${row.landedBy === "mcc" ? "LANDED" : "would-land"} — 뒤에 되돌림${row.revertedBy ? `(#${row.revertedBy.number})` : ""}`);
  }
  const prs = rows.filter((r) => r.inspection || r.escalated).length;
  const reverted = rows.filter((r) => r.wouldLand && r.reverted).length;
  return {
    airport: x.airport,
    since,
    days,
    merged: rows.length,
    prs,
    wouldLand: rows.filter((r) => r.wouldLand).length,
    reverted,
    target: MCC_GATE,
    ready: prs >= MCC_GATE.prs && days >= MCC_GATE.days && reverted <= MCC_GATE.reverted,
    rows,
    misses,
  };
}

// atcctl mcc queue에 싣는 한 줄
export const mccGateLine = (g: MccGate) =>
  `SHADOW GATE ${g.ready ? "충족 — land는 SUPERVISOR가 설정 창에서" : "아직"} · 판단한 PR ${g.prs}/${g.target.prs}건 · ${g.days}/${g.target.days}일 · would-land 되돌림 ${g.reverted}건 · 불일치 ${g.misses.length}건`;
