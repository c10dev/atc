import type { Airport, Session } from "../model.ts";
import { regKey } from "../registration.ts";
import { JudgeAnswerError } from "./classify.ts";

// typed-judgment REPORT 판정(ATC-89, docs/fleet.md 8.8). atc AIRCRAFT의 턴이 끝날 때(Stop) CAPTAIN의 마지막 메시지를 Choice 하나로 분류한다.
// 계산만 한다 — 대화 기록 읽기는 sources/claude.ts, 네트워크는 engines.ts, 기록·스위치는 store.ts, 호출은 run.ts.
// 그림자 전용: health 코드, DISPATCH, FLEET PLAN을 바꾸지 않는다. 메시지 본문은 기록하지 않는다(보낸 글자 수만).

// atc(ATCC) AIRCRAFT의 세션만 읽는다
export const ATC_AIRPORT = "ATCC";
export const MESSAGE_MAX = 1500; // 보내는 글자 수 상한(마스킹한 뒤)
export const DECISION_MIN = 0.7; // "결정이 필요함" 확률이 이 이상이면 FLIGHT FOLLOWING 항목

export const REPORT_CLASSES = ["done", "decision", "stopped", "ready", "unknown"] as const;
export type ReportClass = (typeof REPORT_CLASSES)[number];
export const REPORT_LABEL: Record<ReportClass, string> = {
  done: "reported done",
  decision: "asks for a decision",
  stopped: "stopped mid-work",
  ready: "idle and ready",
  unknown: "can't tell",
};
export const REPORT_QUESTION_ID = "report_class";

// ---- 대상: ATCC 확인이 어떤 읽기보다 먼저 ----
// 살아 있는 Claude AIRCRAFT(TEAM_* 이름) 가운데 cwd가 ATCC 저장소에 속한 세션. 그 밖의 세션은 대화 기록을 열지 않는다
export function reportCandidatesOf(sessions: readonly Pick<Session, "id" | "agent" | "name" | "status" | "repo" | "cwd" | "lastActiveAt">[], airports: readonly Pick<Airport, "repo" | "code">[], teamPattern: string) {
  const team = new RegExp(teamPattern, "i");
  const atc = new Set(airports.filter((a) => a.code === ATC_AIRPORT).map((a) => a.repo));
  return sessions.filter((s) => s.agent === "claude" && s.status === "idle" && team.test(s.name) && s.repo !== null && atc.has(s.repo));
}

export const registrationOf = (name: string, teamPattern: string) => regKey(name, teamPattern);

// ---- 마지막 메시지 ----
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? String((b as { text?: unknown }).text ?? "") : "")).join("\n");
}

// 대화 기록 끝(여러 줄) → 턴이 끝난 CAPTAIN의 마지막 메시지. 마지막 assistant 줄이 글이고(tool_use로 끝나지 않고) 그 뒤에 새 지시가 없을 때만.
// 서브에이전트(isSidechain)와 API 오류 줄은 건너뛴다. 본문은 호출한 쪽이 곧바로 마스킹해 보내고 저장하지 않는다
export function lastMessageOf(text: string): { text: string; at: number } | null {
  let last: { text: string; at: number; tool: boolean } | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain || d.isCompactSummary) continue;
    const at = Date.parse(d.timestamp);
    if (Number.isNaN(at)) continue;
    const content = d.message?.content;
    if (d.type === "assistant") {
      if (d.isApiErrorMessage) {
        last = null;
        continue;
      }
      last = { text: textOf(content).trim(), at, tool: Array.isArray(content) && content.some((b) => b?.type === "tool_use") };
      continue;
    }
    if (d.isMeta && !("turnOrigin" in d)) continue;
    // tool_result는 턴 안의 일이고, 그 밖의 user 줄은 새 지시다
    if (Array.isArray(content) && content.some((b) => b?.type === "tool_result")) continue;
    last = null;
  }
  return last && last.text && !last.tool ? { text: last.text, at: last.at } : null;
}

// ---- 마스킹: 경로·URL(그리고 토큰·이메일)은 나가지 않는다. 남은 글이 MESSAGE_MAX를 넘으면 끝부분만(결론·질문은 대개 끝에 있다) ----
const URL_RE = /\b(?:https?|ftp|file):\/\/[^\s<>"')\]]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ABS_PATH_RE = /(?<![\w<])(?:~|\.{1,2})?\/[\w.\-@~+/]*[\w\-@~+/]/g; // /home/x, ~/x, ./x, ../x
const REL_PATH_RE = /(?<![\w<./@-])(?:(?:[\w.\-@+]+\/){2,}[\w.\-@+]*|[\w.\-@+]+\/[\w\-@+]*\.[A-Za-z]\w*)(?![\w/])/g; // a/b/c, server/x.ts (and/or 같은 글은 그대로)
const TOKEN_RE = /\b(?:sk|ghp|gho|xox[bp]|lin_api|ts)[-_][\w-]{16,}|\b[A-Za-z0-9_-]{32,}\b/g;

export function maskText(s: string, max = MESSAGE_MAX): string {
  const masked = s
    .replace(URL_RE, "<url>")
    .replace(EMAIL_RE, "<email>")
    .replace(ABS_PATH_RE, (m) => (m.length > 1 ? "<path>" : m)) // 홀로 있는 "/"는 그대로
    .replace(REL_PATH_RE, (m) => (/^\d+(?:\/\d+)+$/.test(m) ? m : "<path>")) // 날짜·비율(1/2)은 그대로
    .replace(TOKEN_RE, "<token>")
    .trim();
  return masked.length > max ? masked.slice(masked.length - max) : masked;
}

// ---- 질문 ----
const CRITERIA: Record<ReportClass, string> = {
  done: "It reports finished work and points to a result, such as a pull request, a merged change, a verified fix or written findings.",
  decision: "It asks the supervisor to decide, approve or choose something before it can go on.",
  stopped: "It stops in the middle of the work without finishing or asking: an unfinished plan, an error, a timeout, or a promise to continue.",
  ready: "It is idle and waiting for the next assignment; nothing is pending.",
  unknown: "The message is too short or too unclear to tell which of these it is.",
};

// TypeSafe System One 질문 맵. 질문 id는 모델에 가지 않는다
export function reportQuestions(): Record<string, unknown> {
  return {
    [REPORT_QUESTION_ID]: {
      type: "choice",
      instructions:
        "The text in `message` is the last message an AI coding agent (the captain of a team) wrote at the end of its turn, addressed to its supervisor. Paths, links and tokens in it were replaced by placeholders. Which state is the agent in? If it both reports work and asks for a decision, pick `decision`.",
      criteria: CRITERIA,
    },
  };
}

// ---- 답: 모양 검사 ----
export interface ReportJudgment {
  class: ReportClass;
  probabilities: Record<ReportClass, number>;
  confidence: number | null;
}

const prob = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);

export function reportJudgmentOf(answers: unknown): ReportJudgment {
  const x = (answers as Record<string, { type?: unknown; choice?: unknown; probabilities?: unknown; confidence?: unknown }> | null)?.[REPORT_QUESTION_ID];
  if (!x || x.type !== "choice" || !(REPORT_CLASSES as readonly string[]).includes(x.choice as string)) throw new JudgeAnswerError(`${REPORT_QUESTION_ID}: ${REPORT_CLASSES.join("|")} 중 하나가 아님`);
  const p = (x.probabilities && typeof x.probabilities === "object" ? x.probabilities : {}) as Record<string, unknown>;
  const probabilities = Object.fromEntries(REPORT_CLASSES.map((c) => [c, prob(p[c]) ?? (c === x.choice ? 1 : 0)])) as Record<ReportClass, number>;
  return { class: x.choice as ReportClass, probabilities, confidence: prob(x.confidence) };
}

// FLIGHT FOLLOWING 항목을 만드는가: "결정이 필요함" 확률이 문턱 이상
export const needsDecision = (j: Pick<ReportJudgment, "probabilities">, min = DECISION_MIN) => j.probabilities.decision >= min;

// ---- 일치율: SUPERVISOR가 맞다·틀리다고 표시한 것 가운데 맞은 것(표시만, 어떤 기준도 아니다) ----
export interface ReportRate {
  judged: number; // 판정한 턴 수
  marked: number; // SUPERVISOR가 표시한 것
  right: number;
  rate: number | null;
}
export function reportRateOf(items: { mark: "right" | "wrong" | null }[]): ReportRate {
  const marked = items.filter((m) => m.mark);
  const right = marked.filter((m) => m.mark === "right").length;
  return { judged: items.length, marked: marked.length, right, rate: marked.length ? right / marked.length : null };
}
