import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { type CrosscheckVerdict, crosscheckRateOf, type HumanDecision } from "../crosscheck.ts";
import type { Rating } from "../crew.ts";
import { type ClassifyJudgment, JUDGE_FAMILIES, type JudgeFamily } from "./classify.ts";
import type { DispatchJudgment } from "./dispatch.ts";
import { DECISION_MIN, type ReportClass, type ReportJudgment, reportRateOf } from "./report.ts";
import type { EngineName } from "./engines.ts";
import type { ExceptionAction, ExceptionKind, ExceptionMark, ExceptionRole, ExceptionSource, ProposedAction } from "./exceptions.ts";

// 판정 계열의 스위치와 기록(ATC-36).
// - 스위치 ~/.local/state/atc/judges.json {"jev": "off"|"replay"|"shadow"} — 원자적으로 바꿔 쓴다. 기본 off.
//   SUPERVISOR만 바꾼다(설정 창 PUT /api/settings의 judgesJev, 이 화면 Origin만). atcctl에는 명령이 없다.
// - 기록 ~/.local/state/atc/judges.jsonl — 계열마다 추가만 하는 `judge` 줄. schedule.jsonl과 CROSSCHECK 칸은 건드리지 않는다.
//   초안 상태를 바꾸지 않고, 20건·80% 게이트(gateOf)에도 들지 않는다.

export type JudgeMode = "off" | "replay" | "shadow";
export const JUDGE_MODES: readonly JudgeMode[] = ["off", "replay", "shadow"];
export type JudgesConfig = Record<JudgeFamily, JudgeMode>;
export const DEFAULT_JUDGES: JudgesConfig = { jev: "off" };

const CONFIG_FILE = () => join(config.stateDir, "judges.json");
const RECORD_FILE = () => join(config.stateDir, "judges.jsonl");

// 모르는 값은 off — 깨진 파일이 무엇도 켜지 않게
export function parseJudges(raw: unknown): JudgesConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(JUDGE_FAMILIES.map((f) => [f, JUDGE_MODES.includes(o[f] as JudgeMode) ? o[f] : "off"])) as JudgesConfig;
}

export function loadJudges(file = CONFIG_FILE()): JudgesConfig {
  try {
    return parseJudges(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_JUDGES };
  }
}

export function saveJudges(cfg: JudgesConfig, file = CONFIG_FILE()) {
  let user: Record<string, unknown> = {};
  try {
    user = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...user, ...cfg }, null, 2) + "\n");
  renameSync(tmp, file);
}

// ---- 기록 ----
export type JudgeRun = "replay" | "shadow";

export interface JudgeLine {
  op: "judge";
  family: JudgeFamily;
  target: "schedule"; // SCHEDULE CLASSIFY. DISPATCH는 DispatchJudgeLine
  id: string; // S-0001
  flight: string | null;
  at: string;
  run: JudgeRun;
  engine: EngineName;
  model: string; // 응답의 모델 id(jev-1.13.0), stub은 "stub"
  verdict: CrosscheckVerdict; // 초안과 같은 분류면 agree
  reason: string;
  judgment: ClassifyJudgment;
  withheld: string | null; // 본문을 보내지 않은 이유(제목만 보냄). 보냈으면 null
  sent: string[]; // 보낸 칸(title, goal, allowed_scope, done_criteria)
  hash?: string; // 판정한 입력의 해시(ATC-555, WO-23). 옛 줄에는 없다
  release?: string; // 그 FLIGHT의 발권 id(ATC-555). 발권 기록이 없거나 옛 줄이면 없다
}

// DISPATCH 판정(ATC-88): 열린 ASSIGN 하나(D-0085)의 세 답. 제안 상태·점수는 바꾸지 않는다
export interface DispatchJudgeLine {
  op: "judge";
  family: JudgeFamily;
  target: "dispatch";
  id: string; // D-0085
  flight: string;
  at: string;
  run: JudgeRun;
  engine: EngineName;
  model: string;
  judgment: DispatchJudgment;
  withheld: string | null; // 본문을 보내지 않은 이유. 보냈으면 null
  recentWithheld: string | null; // 최근 FLIGHT 제목을 보내지 않은(Same area를 묻지 않은) 이유. 보냈으면 null
  sent: string[]; // 보낸 칸(title, goal, allowed_scope, done_criteria, recent_flights)
  hash?: string; // 판정한 입력의 해시(ATC-555, WO-23). 옛 줄에는 없다
  release?: string; // 그 FLIGHT의 발권 id(ATC-555). 발권 기록이 없거나 옛 줄이면 없다
}

// REPORT 판정(ATC-89): atc AIRCRAFT의 턴 하나(세션·시각)의 분류. 메시지 본문은 없다 — 보낸 글자 수만
export interface ReportJudgeLine {
  op: "judge";
  family: JudgeFamily;
  target: "report";
  id: string; // R-<세션 앞 8자>-<메시지 시각 epoch초>
  session: string;
  aircraft: string; // REGISTRATION
  at: string;
  turnAt: string; // 판정한 마지막 메시지의 시각
  run: JudgeRun;
  engine: EngineName;
  model: string;
  judgment: ReportJudgment;
  reason?: string; // engine이 "rule"일 때 어떤 규칙인가(limit-cut)
  sent: { chars: number };
  hash?: string; // 판정한 입력의 해시(ATC-555, WO-23). 옛 줄에는 없다
  release?: string; // 그 FLIGHT의 발권 id(ATC-555). 발권 기록이 없거나 옛 줄이면 없다
}

// SUPERVISOR가 분류를 맞다·틀리다고 표시(나중 줄이 앞의 것을 대신한다)
export interface ReportMarkLine {
  op: "mark";
  target: "report";
  id: string;
  verdict: "right" | "wrong";
  at: string;
}

// 모드 변경 기록(누가·언제 켰나)
export interface JudgeModeLine {
  op: "mode";
  family: JudgeFamily;
  at: string;
  from: JudgeMode;
  to: JudgeMode;
}

// 예외 판정(ATC-558): CAPTAIN의 UNABLE·질문·두 번째 침묵 하나의 판정. CAPTAIN 글은 남기지 않는다(가린 글의 해시와 보낸 글자 수만)
export interface ExceptionJudgeLine {
  op: "judge";
  family: JudgeFamily; // 판정 계열 jev(이 판정의 스위치는 judges.json의 exceptions)
  target: "exception";
  id: string; // EX-<D-/C-id>-<해시 앞 8자>: 같은 입력이면 같은 id(다시 판정하지 않는다)
  ref: string; // D-xxxx | C-xxxx
  kind: ExceptionKind;
  role: ExceptionRole; // 그 호출을 맡은 관제 세션
  via: "atcctl" | "server"; // 관제 세션이 물었나, 서버가 스스로 봤나(두 번째 침묵)
  flight: string | null;
  at: string;
  source: ExceptionSource; // 행동을 정한 판정: jev(확신 ≥ 0.8) | claude | none(둘 다 답하지 못함 → ESCALATE)
  model: string | null;
  confidence: number | null; // Jev의 확신(claude는 없음)
  jev: { proposed: ProposedAction | null; confidence: number | null; error: string | null } | null; // Jev가 낸 것(문턱 아래여도). 키가 없으면 error
  claude: { proposed: ProposedAction | null; error: string | null } | null; // 부르지 않았으면 null
  proposed: ProposedAction | null; // 행동을 정한 판정이 고른 것
  action: ExceptionAction; // 실행할 것
  floor: string | null; // 판정과 다르게 정한 이유(ANSWER인데 정책이 덮지 않음 …)
  covered: boolean | null;
  point: string | null; // 정책 점(P1 …)
  waitFor: string | null;
  answerYes: boolean | null;
  answer: string | null; // 팀에 보낼 답(판정이 지은 글, CAPTAIN 글이 아니다)
  reason: string;
  card: string | null; // ESCALATE면 DECISION 카드 id
  hash: string; // 판정한 입력(가린 글·상황·후보)의 해시(principle 7)
  policy: string; // 정책 해시
  policyVersion: string;
  sent: { chars: number }; // 내보낸 가린 글의 글자 수
  release?: string;
}

// SUPERVISOR가 예외 판정을 표시: 맞음 | 틀림(행동) | 필요 없음(ESCALATE). 나중 줄이 앞의 것을 대신한다
export interface ExceptionMarkLine {
  op: "mark";
  target: "exception";
  id: string;
  verdict: ExceptionMark;
  at: string;
}

export type JudgesLogLine = JudgeLine | DispatchJudgeLine | ReportJudgeLine | ReportMarkLine | JudgeModeLine | ExceptionJudgeLine | ExceptionMarkLine;

export function readJudgeLines(file = RECORD_FILE()): JudgesLogLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: JudgesLogLine[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line);
      if (l && (l.op === "judge" || l.op === "mode") && JUDGE_FAMILIES.includes(l.family)) out.push(l);
      else if (l && l.op === "mark" && l.target === "report" && (l.verdict === "right" || l.verdict === "wrong") && typeof l.id === "string") out.push(l);
      else if (l && l.op === "mark" && l.target === "exception" && (l.verdict === "right" || l.verdict === "wrong" || l.verdict === "unnecessary") && typeof l.id === "string") out.push(l);
    } catch {}
  }
  return out;
}

export function appendJudgeLines(lines: JudgesLogLine[], file = RECORD_FILE()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

export function setJudgeMode(family: JudgeFamily, mode: JudgeMode, at = new Date().toISOString()) {
  const cfg = loadJudges();
  if (cfg[family] === mode) return;
  saveJudges({ ...cfg, [family]: mode });
  appendJudgeLines([{ op: "mode", family, at, from: cfg[family], to: mode }]);
}

// 초안마다·계열마다 마지막 mark
export type JudgeMarks = Map<string, Partial<Record<JudgeFamily, JudgeLine>>>;
export function marksOf(lines: JudgesLogLine[]): JudgeMarks {
  const out: JudgeMarks = new Map();
  for (const l of lines) {
    if (l.op !== "judge" || l.target !== "schedule") continue;
    out.set(l.id, { ...out.get(l.id), [l.family]: l });
  }
  return out;
}

export type DispatchMarks = Map<string, Partial<Record<JudgeFamily, DispatchJudgeLine>>>;
export function dispatchMarksOf(lines: JudgesLogLine[]): DispatchMarks {
  const out: DispatchMarks = new Map();
  for (const l of lines) {
    if (l.op !== "judge" || l.target !== "dispatch") continue;
    out.set(l.id, { ...out.get(l.id), [l.family]: l });
  }
  return out;
}

// ---- 일치율과 화면 ----
export interface JudgedOp {
  id: string;
  kind: string;
  human: HumanDecision | null; // SUPERVISOR 판정(schedule.ts humanOf). ATFM 자동 판정은 null
}

// 계열별 일치율: crosscheckRateOf를 그대로 쓴다(byModel 키가 계열).
// CROSSCHECK와 달리 판정 뒤에 단 mark(replay)도 센다 — 판정 계열의 입력에는 SUPERVISOR 판정이 들어가지 않는다.
export function judgeRateOf(ops: JudgedOp[], marks: JudgeMarks) {
  const items = ops
    .filter((o) => o.kind === "CLASSIFY")
    .flatMap((o) =>
      JUDGE_FAMILIES.map((f) => {
        const m = marks.get(o.id)?.[f];
        return { crosscheck: m && o.human ? { by: f, model: f, verdict: m.verdict, reason: m.reason, at: o.human.at } : null, human: o.human };
      }),
    );
  const { byModel } = crosscheckRateOf(items);
  return Object.fromEntries(JUDGE_FAMILIES.map((f) => [f, byModel[f] ?? { marked: 0, matched: 0, rate: null }])) as Record<JudgeFamily, { marked: number; matched: number; rate: number | null }>;
}

export interface JudgeMarkView {
  family: JudgeFamily;
  verdict: CrosscheckVerdict;
  reason: string;
  model: string;
  engine: EngineName;
  run: JudgeRun;
  at: string;
  type: string;
  wake: string;
  ratings: Record<Rating, number>;
  withheld: string | null;
}

// SCHEDULE 브리핑의 judges: 스위치, 계열별 일치율, mark.
// mark는 SUPERVISOR가 판정한 초안에만 보인다(쏠림 방지). 열린 초안의 mark는 세기만 한다(pending).
// shown이 있으면 그 초안의 mark만 싣는다(일치율은 모든 초안으로)
export function judgesViewOf(ops: JudgedOp[], marks: JudgeMarks, modes: JudgesConfig, shown?: Set<string>) {
  const decided = new Set(ops.filter((o) => o.human).map((o) => o.id));
  const visible: Record<string, JudgeMarkView[]> = {};
  let hidden = 0;
  for (const o of ops) {
    const m = marks.get(o.id);
    if (!m) continue;
    const list = Object.values(m) as JudgeLine[];
    if (!decided.has(o.id)) {
      hidden += list.length;
      continue;
    }
    if (shown && !shown.has(o.id)) continue;
    visible[o.id] = list.map((l) => ({
      family: l.family,
      verdict: l.verdict,
      reason: l.reason,
      model: l.model,
      engine: l.engine,
      run: l.run,
      at: l.at,
      type: l.judgment.type,
      wake: l.judgment.wake,
      ratings: l.judgment.ratings,
      withheld: l.withheld,
    }));
  }
  return { modes, rate: judgeRateOf(ops, marks), marks: visible, hidden };
}

// ---- REPORT: 세션마다 마지막 판정과 SUPERVISOR 표시, 문턱, 일치율 ----
export interface ReportView {
  id: string;
  session: string;
  class: ReportClass;
  probabilities: ReportJudgment["probabilities"];
  confidence: number | null;
  decisionP: number;
  turnAt: string;
  at: string;
  chars: number;
  model: string;
  run: JudgeRun;
  mark: "right" | "wrong" | null;
}

export function reportViewsOf(lines: JudgesLogLine[]): { bySession: Map<string, ReportView>; all: ReportView[]; ids: Set<string> } {
  const marks = new Map<string, "right" | "wrong">();
  const judged: ReportJudgeLine[] = [];
  for (const l of lines) {
    if (l.op === "mark" && l.target === "report") marks.set(l.id, l.verdict);
    else if (l.op === "judge" && l.target === "report") judged.push(l);
  }
  const all = judged.map<ReportView>((l) => ({
    id: l.id,
    session: l.session,
    class: l.judgment.class,
    probabilities: l.judgment.probabilities,
    confidence: l.judgment.confidence,
    decisionP: l.judgment.probabilities.decision,
    turnAt: l.turnAt,
    at: l.at,
    chars: l.sent.chars,
    model: l.model,
    run: l.run,
    mark: marks.get(l.id) ?? null,
  }));
  const bySession = new Map<string, ReportView>();
  for (const v of all) if (!bySession.get(v.session) || v.turnAt >= bySession.get(v.session)!.turnAt) bySession.set(v.session, v);
  return { bySession, all, ids: new Set(all.map((v) => v.id)) };
}

// 판정은 파일을 다시 읽지 않고 크기·수정 시각이 같으면 캐시를 쓴다(스냅숏마다 부른다)
let viewCache: { key: string; views: ReturnType<typeof reportViewsOf> } | null = null;
export function loadReportViews(file = RECORD_FILE()) {
  let key = "none";
  try {
    const st = statSync(file);
    key = `${file}:${st.size}:${st.mtimeMs}`;
  } catch {}
  if (viewCache?.key !== key) viewCache = { key, views: reportViewsOf(readJudgeLines(file)) };
  return viewCache.views;
}

export const reportRate = (views = loadReportViews()) => reportRateOf(views.all);

// SUPERVISOR 표시를 적는다. 없는 판정 id면 false
export function markReport(id: string, verdict: "right" | "wrong", at = new Date().toISOString(), file = RECORD_FILE()): boolean {
  if (!readJudgeLines(file).some((l) => l.op === "judge" && l.target === "report" && l.id === id)) return false;
  appendJudgeLines([{ op: "mark", target: "report", id, verdict, at }], file);
  return true;
}

// ---- 예외 판정(ATC-558)의 스위치: judges.json의 exceptions(on|off, 기본 on, shadow 없음). judges.jev와 따로다 ----
export type ExceptionsMode = "on" | "off";
export const EXCEPTIONS_MODES: readonly ExceptionsMode[] = ["off", "on"];
export const DEFAULT_EXCEPTIONS: ExceptionsMode = "on"; // SUPERVISOR 결정(2026-10-07): K2 반출 승인, live first
export function loadExceptionsMode(file = CONFIG_FILE()): ExceptionsMode {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")).exceptions;
    return v === "on" || v === "off" ? v : DEFAULT_EXCEPTIONS;
  } catch {
    return DEFAULT_EXCEPTIONS;
  }
}
// 다른 칸(jev, reportDecisionMin …)은 그대로 두고 exceptions만 바꾼다. 바뀌었으면 true
export function saveExceptionsMode(v: ExceptionsMode, file = CONFIG_FILE()): boolean {
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  if (loadExceptionsMode(file) === v && cur.exceptions === v) return false;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...cur, exceptions: v }, null, 2) + "\n");
  renameSync(tmp, file);
  return true;
}

export const exceptionLinesOf = (lines: readonly JudgesLogLine[]) => lines.filter((l): l is ExceptionJudgeLine => l.op === "judge" && l.target === "exception");
export function exceptionMarksOf(lines: readonly JudgesLogLine[]): Map<string, ExceptionMark> {
  const out = new Map<string, ExceptionMark>();
  for (const l of lines) if (l.op === "mark" && l.target === "exception") out.set(l.id, l.verdict);
  return out;
}

// "결정이 필요함" 문턱: judges.json의 reportDecisionMin(0~1), 없거나 틀리면 기본값
export function loadReportThreshold(file = CONFIG_FILE()): number {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")).reportDecisionMin;
    return typeof v === "number" && v > 0 && v <= 1 ? v : DECISION_MIN;
  } catch {
    return DECISION_MIN;
  }
}
