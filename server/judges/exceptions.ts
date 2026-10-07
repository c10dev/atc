import { JudgeAnswerError } from "./classify.ts";
import { POLICY_POINTS, POLICY_TEXT, policyPointOf } from "./exception-policy.ts";
import { maskText, MESSAGE_MAX } from "./report.ts";

// 예외 판정(ATC-558, docs/control-plane.md W4). CAPTAIN의 UNABLE·질문·두 번째 침묵을 고정된 메뉴 하나로 정한다.
// 계산만 한다 — 네트워크·claude -p·기록·카드는 exceptions-run.ts. 싼 판정부터: Jev(TypeSafe) 확신 ≥ 0.8이면 그 답, 아니면 claude -p 한 번.
// ANSWER는 정책이 바로 그 점을 정할 때만 행동이고, 메뉴에 맞는 것이 없거나 실행할 수 없는 행동이면 ESCALATE(SUPERVISOR 카드)다.

export const EXCEPTION_ACTIONS = ["RESEND", "HOLD_UNTIL", "REASSIGN", "ANSWER", "ESCALATE", "ACCEPT_UNDONE"] as const;
export type ExceptionAction = (typeof EXCEPTION_ACTIONS)[number];
export const NONE = "NONE"; // "메뉴에 없음" — 첫날부터 ESCALATE
export type ProposedAction = ExceptionAction | typeof NONE;
export const EXCEPTION_KINDS = ["unable", "question", "silence"] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
export type ExceptionRole = "occ" | "tower";
export const CONFIDENCE_MIN = 0.8; // Jev의 답을 쓰는 확신(이 아래는 claude -p)
export const REF_RE = /^(D|C)-\d{4,}$/; // D-xxxx(FLIGHT PLAN) · C-xxxx(CLEARANCE)

export const roleOfRef = (ref: string): ExceptionRole => (ref.startsWith("D-") ? "occ" : "tower");

// ---- 메뉴: 행동마다 뜻(판정에 그대로 간다) ----
export const ACTION_CRITERIA: Record<ProposedAction, string> = {
  RESEND: "Send the same call once more: the captain did not get it whole or answered a garbled copy, and it has not been resent yet.",
  HOLD_UNTIL: "Wait until another named FLIGHT or PR lands (policy P10); nothing is sent now.",
  REASSIGN: "This aircraft should not do this work; let the work go back to the planner for another aircraft (policy P11).",
  ANSWER: "Answer the captain's question yes or no, because one policy point settles exactly this question.",
  ESCALATE: "The supervisor must decide: the policy does not settle it, it is a supervisor decision (P2, P14), or it is unclear.",
  ACCEPT_UNDONE: "Record it and leave the call undone: the work is already done or no longer needed (policy P12).",
  NONE: "None of the other actions fits.",
};

// 실행할 수 있는 행동(호출 종류 × 예외 종류). 그 밖의 행동은 판정이 골라도 ESCALATE다.
// OCC는 팀에 글을 보낼 수 없어(send-guard: FLIGHT PLAN·RECALL·CREW CHANGE만) D-의 ANSWER는 SUPERVISOR 카드로 간다(제안한 답을 싣는다).
// 두 번째 침묵에는 다시 보내지 않는다(P13). RESEND는 아직 다시 보내지 않은 호출에만
const EXECUTABLE: Record<ExceptionRole, Record<ExceptionKind, readonly ExceptionAction[]>> = {
  tower: {
    unable: ["RESEND", "HOLD_UNTIL", "REASSIGN", "ACCEPT_UNDONE", "ESCALATE"],
    question: ["RESEND", "HOLD_UNTIL", "ANSWER", "ACCEPT_UNDONE", "ESCALATE"],
    silence: ["HOLD_UNTIL", "ACCEPT_UNDONE", "ESCALATE"],
  },
  occ: {
    unable: ["RESEND", "HOLD_UNTIL", "REASSIGN", "ACCEPT_UNDONE", "ESCALATE"],
    question: ["RESEND", "HOLD_UNTIL", "REASSIGN", "ESCALATE"],
    silence: ["HOLD_UNTIL", "ESCALATE"],
  },
};
export const executableOf = (role: ExceptionRole, kind: ExceptionKind) => EXECUTABLE[role][kind];

// ---- 판정에 가는 것: 가린 CAPTAIN 글(최대 1,500자) + 메뉴 + 정책 + 정해진 말로 된 상황 ----
// REPORT 가림(경로·URL·이메일·토큰, ATC-89) 위에 더: 코드 블록(파일 내용)·긴 인라인 코드, 비밀 이름의 값, Bearer, 긴 16진·base64 줄
const FENCE_RE = /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g;
const INLINE_CODE_RE = /`[^`\n]{41,}`/g;
const SECRET_ASSIGN_RE = /\b((?:[A-Za-z_][\w.-]*?)?(?:key|token|secret|passw(?:or)?d|pwd|credential|auth|cookie|session)[\w.-]*)(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|\S+)/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const HEX_RE = /\b[A-Fa-f0-9]{20,}\b/g;
const B64_RE = /(?<![\w/+])[A-Za-z0-9+/]{24,}={0,2}(?![\w/+])/g;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*KEY-----[\s\S]*?(?:-----END [A-Z ]*KEY-----|$)/g;

export function exportMask(text: string, max = MESSAGE_MAX): string {
  const stripped = text
    .replace(PRIVATE_KEY_RE, "<key>")
    .replace(FENCE_RE, (_m, lead: string) => `${lead}<code>`)
    .replace(INLINE_CODE_RE, "<code>")
    .replace(BEARER_RE, "$1 <token>")
    .replace(SECRET_ASSIGN_RE, (_m, name: string, sep: string) => `${name}${sep}<secret>`)
    .replace(HEX_RE, "<token>")
    .replace(B64_RE, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? "<token>" : m));
  return maskText(stripped, max);
}

// HOLD_UNTIL의 대상 후보: 가리기 전 글에서 FLIGHT key와 PR 번호만(D-·C-·CC- 같은 호출 id는 아니다). 가린 글에도 그대로 남는 꼴이다
const FLIGHT_KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
const PR_RE = /\bPR\s*#?(\d{1,6})\b|(?<![\w#])#(\d{1,6})\b/gi;
const CALL_PREFIX = new Set(["D", "C", "CC", "DC", "R", "W", "EX", "X", "S"]);
export const WAIT_MAX = 6;
export function waitCandidatesOf(text: string, self?: string | null): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    if (v !== self && !out.includes(v) && out.length < WAIT_MAX) out.push(v);
  };
  for (const m of text.matchAll(FLIGHT_KEY_RE)) if (!CALL_PREFIX.has(m[1]!)) add(`${m[1]}-${m[2]}`);
  for (const m of text.matchAll(PR_RE)) add(`PR #${m[1] ?? m[2]}`);
  return out;
}

// 상황: 정해진 말로만(이름·FLIGHT key·경로 없음)
export interface ExceptionSituation {
  call: string; // "FLIGHT PLAN" | "CLEARANCE GO AROUND" …
  resent: boolean; // 이 호출을 이미 한 번 다시 보냈나
  session: "idle" | "busy" | "gone" | "unknown"; // 받는 세션의 지금 상태(침묵에만 뜻이 있다)
}
const KIND_TEXT: Record<ExceptionKind, string> = {
  unable: "The captain answered the call with UNABLE and the reason in `message`.",
  question: "Instead of answering the call, the captain asked the question in `message`.",
  silence: "The captain did not answer the call or its one resend. `message` is the captain's last message in its session, if any.",
};
export function situationTextOf(kind: ExceptionKind, s: ExceptionSituation): string {
  return [KIND_TEXT[kind], `The call is a ${s.call}.`, s.resent ? "It was already resent once." : "It has not been resent.", kind === "silence" ? `The captain's session is ${s.session}.` : ""].filter(Boolean).join(" ");
}

export interface ExceptionState {
  exception: { situation: string; message: string; wait_candidates: string[] };
  menu: Record<ProposedAction, string>;
  policy: string;
}
export const exceptionStateOf = (kind: ExceptionKind, s: ExceptionSituation, masked: string, candidates: string[]): ExceptionState => ({
  exception: { situation: situationTextOf(kind, s), message: masked, wait_candidates: candidates },
  menu: ACTION_CRITERIA,
  policy: POLICY_TEXT,
});

// ---- Jev 질문(TypeSafe System One: choice·noul·score뿐이라 wait_for는 글에서 찾은 후보 가운데 Choice) ----
export const Q = { action: "action", waitFor: "wait_for", answerYes: "answer_yes", covers: "policy_covers", point: "policy_point" } as const;
export function exceptionQuestions(kind: ExceptionKind, candidates: string[]): Record<string, unknown> {
  const q: Record<string, unknown> = {
    [Q.action]: {
      type: "choice",
      instructions:
        "Read `exception.situation`, the captain's `exception.message` (paths, links, code and secrets were replaced by placeholders) and the written `policy`. Which action from `menu` should the control session take? Pick NONE when no action fits. Pick ANSWER only when one policy point settles exactly what the captain asks.",
      criteria: ACTION_CRITERIA,
    },
    [Q.covers]: {
      type: "noul",
      instructions: "Does one point of the written `policy` settle exactly the point the captain raises in `exception.message` (not a nearby point, not only in part)?",
      criteria: { true: "One policy point settles exactly this point.", false: "No policy point settles exactly this point, or only in part." },
    },
    [Q.point]: {
      type: "choice",
      instructions: "Which point of the written `policy` settles the captain's point in `exception.message`? Pick NONE if none settles it exactly.",
      criteria: { ...Object.fromEntries(POLICY_POINTS.map((p) => [p.id, p.rule.slice(0, 160)])), NONE: "No policy point settles it exactly." },
    },
  };
  if (kind === "question")
    q[Q.answerYes] = {
      type: "noul",
      instructions: "If the captain's question in `exception.message` is answered by the written `policy`, is the answer yes?",
      criteria: { true: "By the policy the answer is yes (go ahead, allowed).", false: "By the policy the answer is no (do not, not allowed), or the policy does not answer it." },
    };
  if (candidates.length)
    q[Q.waitFor] = {
      type: "choice",
      instructions: "Which FLIGHT or PR from `exception.wait_candidates` does the captain say the work waits on? Pick NONE if it waits on none of them.",
      criteria: { ...Object.fromEntries(candidates.map((c) => [c, `The work waits until ${c} lands.`])), NONE: "It waits on none of these." },
    };
  return q;
}

// ---- 답: 판정 하나의 모양 ----
export interface ExceptionVerdict {
  proposed: ProposedAction;
  confidence: number | null; // 이 행동에 쓰는 질문들의 확신 가운데 가장 낮은 것(Noul은 max(p, 1-p))
  waitFor: string | null;
  answerYes: boolean | null;
  covered: boolean | null;
  point: string | null; // P1 …
  answer: string | null; // 팀에 보낼 영어 답(ANSWER일 때)
  reason: string;
}

const prob = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
const decisive = (p: number | null) => (p === null ? null : Math.max(p, 1 - p));
const PROPOSED: readonly string[] = [...EXCEPTION_ACTIONS, NONE];

export function jevVerdictOf(answers: unknown, kind: ExceptionKind, candidates: string[]): ExceptionVerdict {
  const a = (answers && typeof answers === "object" ? answers : {}) as Record<string, { type?: unknown; choice?: unknown; noul?: unknown; confidence?: unknown }>;
  const act = a[Q.action];
  if (act?.type !== "choice" || !PROPOSED.includes(act.choice as string)) throw new JudgeAnswerError(`${Q.action}: ${PROPOSED.join("|")} 중 하나가 아님`);
  const proposed = act.choice as ProposedAction;
  const covP = a[Q.covers]?.type === "noul" ? prob(a[Q.covers]!.noul) : null;
  const pt = a[Q.point]?.type === "choice" && typeof a[Q.point]!.choice === "string" ? (a[Q.point]!.choice as string) : null;
  const yesP = a[Q.answerYes]?.type === "noul" ? prob(a[Q.answerYes]!.noul) : null;
  const wf = a[Q.waitFor]?.type === "choice" && candidates.includes(a[Q.waitFor]!.choice as string) ? (a[Q.waitFor]!.choice as string) : null;
  const point = pt && policyPointOf(pt) ? pt : null;
  const covered = covP === null ? null : covP >= 0.5 && point !== null;
  const answerYes = kind === "question" && yesP !== null ? yesP >= 0.5 : null;
  // 쓰지 않는 갈래의 불확실성은 보지 않는다: 행동의 확신, ANSWER면 덮음·점·예/아니오, HOLD_UNTIL이면 대상
  const parts: (number | null)[] = [prob(act.confidence)];
  if (proposed === "ANSWER") parts.push(decisive(covP), prob(a[Q.point]?.confidence), decisive(yesP));
  if (proposed === "HOLD_UNTIL" && candidates.length) parts.push(prob(a[Q.waitFor]?.confidence));
  const confidence = parts.some((p) => p === null) ? null : Math.min(...(parts as number[]));
  const p = point ? policyPointOf(point)! : null;
  return {
    proposed,
    confidence,
    waitFor: wf,
    answerYes,
    covered,
    point,
    answer: proposed === "ANSWER" && answerYes !== null && p ? templatedAnswer(answerYes, p.id) : null,
    reason: `Jev: ${proposed}${prob(act.confidence) !== null ? ` (${Math.round(prob(act.confidence)! * 100)}%)` : ""}${point ? `, ${point}` : ""}${covP !== null ? `, covers ${Math.round(covP * 100)}%` : ""}${wf ? `, waits on ${wf}` : ""}`,
  };
}

export const templatedAnswer = (yes: boolean, pointId: string) => `${yes ? "Yes" : "No"}. Per atc policy ${pointId}: ${policyPointOf(pointId)?.rule ?? ""}`.slice(0, 600);

// ---- claude -p 한 번(Claude 모델만): 짧은 프롬프트, JSON 답 ----
export function claudePromptOf(state: ExceptionState, kind: ExceptionKind): string {
  return [
    "You decide how an atc control session handles one exception from a team captain. Answer with one JSON object and nothing else.",
    "",
    "Written policy:",
    state.policy,
    "",
    "Menu (pick exactly one action, or NONE):",
    ...Object.entries(state.menu).map(([k, v]) => `- ${k}: ${v}`),
    "",
    `Situation: ${state.exception.situation}`,
    `Captain's message (paths, links, code and secrets are placeholders): """${state.exception.message || "(none)"}"""`,
    `FLIGHTs or PRs named in the message: ${state.exception.wait_candidates.join(", ") || "(none)"}`,
    "",
    "JSON keys:",
    `{"action": one of ${[...EXCEPTION_ACTIONS, NONE].join("|")},`,
    ' "wait_for": one of the named FLIGHTs or PRs the work waits on, or null,',
    kind === "question" ? ' "answer_yes": true or false by the policy, or null if the policy does not answer it,' : ' "answer_yes": null,',
    ' "policy_point": the id (P1 ...) of the one policy point that settles exactly this point, or null,',
    ' "policy_covers": true only if that point settles exactly this point,',
    ' "answer": for ANSWER, one or two plain English sentences to send the captain, else null,',
    ' "reason": one short English sentence}',
    "Pick ANSWER only when policy_covers is true. When unsure, pick ESCALATE.",
  ].join("\n");
}

// claude -p --output-format json의 출력 → 판정. 모델 이름이 claude-로 시작하지 않으면 거절(다른 모델로 돌려진 호출을 쓰지 않는다)
export function claudeVerdictOf(stdout: string, kind: ExceptionKind, candidates: string[]): { verdict: ExceptionVerdict; model: string } {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(stdout);
  } catch {
    throw new JudgeAnswerError(stdout.trim() ? "claude 출력이 JSON이 아님" : "claude가 답하지 않음(없거나 시간 초과)");
  }
  if (d.is_error === true || typeof d.result !== "string") throw new JudgeAnswerError("claude 결과가 오류");
  const models = Object.keys((d.modelUsage && typeof d.modelUsage === "object" ? d.modelUsage : {}) as object);
  if (!models.length || models.some((m) => !/^claude-/i.test(m))) throw new JudgeAnswerError(`Claude 모델이 아님: ${models.join(",").slice(0, 80) || "모름"}`);
  const body = /\{[\s\S]*\}/.exec(d.result)?.[0];
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body ?? "");
  } catch {
    throw new JudgeAnswerError("claude 답에 JSON이 없음");
  }
  if (!PROPOSED.includes(j.action as string)) throw new JudgeAnswerError(`action: ${PROPOSED.join("|")} 중 하나가 아님`);
  const proposed = j.action as ProposedAction;
  const point = typeof j.policy_point === "string" && policyPointOf(j.policy_point) ? j.policy_point : null;
  const covered = j.policy_covers === true && point !== null;
  const answerYes = kind === "question" && typeof j.answer_yes === "boolean" ? j.answer_yes : null;
  const waitFor = typeof j.wait_for === "string" && candidates.includes(j.wait_for) ? j.wait_for : null;
  const own = typeof j.answer === "string" ? j.answer.trim() : "";
  // 팀에 가는 글은 영어(ATC-126): 한글·가나·한자가 있거나 길면 정책 점에서 지은 답을 쓴다
  const answer = proposed === "ANSWER" && answerYes !== null && point ? (own && own.length <= 600 && !/[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯]/.test(own) ? own : templatedAnswer(answerYes, point)) : null;
  const reason = typeof j.reason === "string" ? j.reason.trim().slice(0, 300) : "";
  return { verdict: { proposed, confidence: null, waitFor, answerYes, covered, point, answer, reason: `Claude: ${proposed}${point ? `, ${point}` : ""}${reason ? ` — ${reason}` : ""}` }, model: models[0]! };
}

// ---- 판정 → 실행할 행동 ----
export interface ExceptionDecision {
  action: ExceptionAction;
  floor: string | null; // 판정이 고른 것과 다르게 정한 이유(없으면 null)
}
export function decide(role: ExceptionRole, kind: ExceptionKind, s: Pick<ExceptionSituation, "resent">, v: ExceptionVerdict | null): ExceptionDecision {
  const esc = (floor: string): ExceptionDecision => ({ action: "ESCALATE", floor });
  if (!v) return esc("no judge answered");
  if (v.proposed === NONE) return esc("none of the menu actions fits");
  const a = v.proposed;
  if (a === "ESCALATE") return { action: a, floor: null };
  if (a === "ANSWER") {
    if (kind !== "question") return esc("ANSWER only answers a question");
    if (v.covered !== true) return esc("the policy does not settle this exact point");
    if (v.answerYes === null || !v.answer) return esc("no yes or no answer from the policy");
  }
  if (a === "HOLD_UNTIL" && !v.waitFor) return esc("HOLD_UNTIL names no FLIGHT or PR to wait on");
  if (a === "RESEND" && s.resent) return esc("a call is resent at most once (P13)");
  if (!executableOf(role, kind).includes(a)) return esc(role === "occ" && a === "ANSWER" ? "OCC cannot send an answer to a team; the supervisor relays it" : `${a} is not executable for a ${kind} on a ${role === "occ" ? "FLIGHT PLAN" : "CLEARANCE"}`);
  return { action: a, floor: null };
}

// Jev의 답을 쓰나: 확신이 문턱 이상일 때만
export const jevDecisive = (v: ExceptionVerdict | null) => Boolean(v && v.confidence !== null && v.confidence >= CONFIDENCE_MIN);

// ---- 기록과 수 ----
export type ExceptionSource = "jev" | "claude" | "none";
export type ExceptionMark = "right" | "wrong" | "unnecessary";
export const EXCEPTION_MARKS: readonly ExceptionMark[] = ["right", "wrong", "unnecessary"];

export interface ExceptionCountsInput {
  source: ExceptionSource;
  action: ExceptionAction;
  at: string;
  mark: ExceptionMark | null;
}
export interface ExceptionCounts {
  days: number;
  judged: number;
  handled: number; // ESCALATE가 아닌 것: 관제 세션의 판단 없이 정해진 몫
  handledShare: number | null;
  jev: number;
  claude: number;
  none: number;
  escalated: number;
  marked: number;
  wrong: number; // 행동(ESCALATE 아님)이 틀렸다고 표시됨
  unnecessary: number; // ESCALATE가 필요 없었다고 표시됨
  wrongRate: number | null; // 표시된 행동 가운데 틀린 것
  misfires: number; // wrong + unnecessary(오작동 카운터)
}
export function exceptionCountsOf(items: readonly ExceptionCountsInput[], now: number, days = 7): ExceptionCounts {
  const since = now - days * 86_400_000;
  const xs = items.filter((x) => Date.parse(x.at) >= since);
  const acted = xs.filter((x) => x.action !== "ESCALATE");
  const actedMarked = acted.filter((x) => x.mark === "right" || x.mark === "wrong");
  const wrong = acted.filter((x) => x.mark === "wrong").length;
  const unnecessary = xs.filter((x) => x.action === "ESCALATE" && x.mark === "unnecessary").length;
  return {
    days,
    judged: xs.length,
    handled: acted.length,
    handledShare: xs.length ? acted.length / xs.length : null,
    jev: xs.filter((x) => x.source === "jev").length,
    claude: xs.filter((x) => x.source === "claude").length,
    none: xs.filter((x) => x.source === "none").length,
    escalated: xs.length - acted.length,
    marked: xs.filter((x) => x.mark).length,
    wrong,
    unnecessary,
    wrongRate: actedMarked.length ? wrong / actedMarked.length : null,
    misfires: wrong + unnecessary,
  };
}

// ---- ESCALATE → SUPERVISOR 카드(DECISION, 그 호출을 맡은 역할의 카드라 답이 그 세션의 decision-answered로 돌아간다) ----
// 묻는 글은 한국어 600자 이내(decision-card.ts). CAPTAIN 글은 가린 것의 앞부분만, 일본어·중국어 글자는 뺀다
const KIND_KO: Record<ExceptionKind, string> = { unable: "UNABLE", question: "질문", silence: "두 번째 침묵(다시 보낸 뒤에도 답 없음)" };
const JA_ZH_RE = /[぀-ヿ㐀-䶿一-鿿]/g;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cardText = (s: string, n: number) => clip(s.replace(JA_ZH_RE, "?").replace(/\s+/g, " ").trim(), n);
export interface CardCase {
  ref: string;
  kind: ExceptionKind;
  role: ExceptionRole;
  situation: ExceptionSituation;
  flight: string | null;
  toName: string | null;
}
export function exceptionCardOf(x: CardCase, id: string, hash: string, masked: string, v: ExceptionVerdict | null, d: ExceptionDecision, source: ExceptionSource) {
  const judge = source === "none" ? "판정 없음(Jev·Claude 모두 답하지 못함)" : `${source === "jev" ? "Jev" : "Claude"}${v?.confidence != null && source === "jev" ? ` ${Math.round(v.confidence * 100)}%` : ""}: ${v?.proposed ?? "?"}`;
  const ask = [
    `예외 판정 ESCALATE · ${x.ref} ${x.situation.call}${x.toName ? ` → ${x.toName}` : ""}${x.flight ? ` · ${x.flight}` : ""} · ${KIND_KO[x.kind]}`,
    masked ? `CAPTAIN 글(가림): "${cardText(masked, 220)}"` : "CAPTAIN 글 없음",
    `판정 ${judge}${d.floor ? ` · 넘긴 이유: ${cardText(d.floor, 90)}` : ""}`,
    v?.reason ? `근거: ${cardText(v.reason, 140)}` : "",
    v?.answer ? `제안한 답(${v.point}): ${cardText(v.answer, 120)}` : "",
    `어떻게 할까요? (${id})`,
  ]
    .filter(Boolean)
    .join("\n");
  const options =
    x.kind === "question"
      ? x.role === "tower"
        ? ["예로 답하기 (TOWER가 INFO로 전함)", "아니오로 답하기 (TOWER가 INFO로 전함)", "기다리기 (HOLD_UNTIL)", "끝내지 않은 채 두기 (ACCEPT_UNDONE)"]
        : ["내가 RELAY로 답한다", "기다리기 (HOLD_UNTIL)", "다른 AIRCRAFT에 맡기기 (REASSIGN)"]
      : ["다시 보내기 (RESEND)", "기다리기 (HOLD_UNTIL)", "다른 AIRCRAFT에 맡기기 (REASSIGN)", "끝내지 않은 채 두기 (ACCEPT_UNDONE)"];
  const key = x.kind === "silence" ? `exception|${x.ref}|silence` : `exception|${x.ref}|${hash.slice(0, 8)}`;
  return { role: x.role, key, ask: clip(ask, 600), options, pr: null };
}
