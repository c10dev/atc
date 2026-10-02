// 관제 세션의 DECISION 카드(ATC-352, docs/occ.md): 관제 세션이 사람의 결정이 필요할 때 턴을 막지 않고
// SUPERVISOR QUEUE에 카드 한 장(결정 하나)을 올리는 길. 순수 함수만(파일은 decision-card-run.ts).
// 카드는 묻기만 한다: 승인·전송·머지를 하지 않는다. SUPERVISOR의 답은 그 세션의 다음 tick 브리핑으로 돌아간다.

export const DECISION_ROLES = ["tower", "occ", "mcc", "crosscheck", "duty"] as const;
export type DecisionRole = (typeof DECISION_ROLES)[number];
export const DECISION_ASK_MAX = 600;
export const DECISION_OPTION_MAX = 160;
export const DECISION_OPTIONS_MIN = 2;
export const DECISION_OPTIONS_MAX = 6;
export const DECISION_ANSWER_MAX = 600;

export interface Decision {
  id: string; // "DC-0001"
  key: string; // 같은 role 안에서 같은 결정이면 늘 같은 key(PR이면 head를 넣는다)
  role: DecisionRole;
  at: string;
  ask: string;
  options: string[];
  pr: { number: number; head: string | null } | null;
  status: "open" | "answered" | "withdrawn";
  statusAt: string;
  answer: { choice: number | null; text: string } | null; // 고른 옵션 번호(0부터)와 덧붙인 글
  ackAt: string | null; // 세션이 답을 읽었다고 표시한 시각
}

type CreateOp = Omit<Decision, "status" | "statusAt" | "answer" | "ackAt">;
export type DecisionOp =
  | ({ op: "create" } & CreateOp)
  | { op: "answer"; id: string; at: string; choice: number | null; text: string }
  | { op: "withdraw"; id: string; at: string }
  | { op: "ack"; id: string; at: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// 일본어·중국어 글자는 받지 않는다(한국어는 SUPERVISOR가 읽는 글이라 된다)
const JA_ZH = /[぀-ヿ㐀-䶿一-鿿]/;
const KEY = /^[A-Za-z0-9|:#@._/-]{1,120}$/;

export const isDecisionRole = (r: unknown): r is DecisionRole => (DECISION_ROLES as readonly unknown[]).includes(r);

export interface DecisionInput {
  role: DecisionRole;
  key: string;
  ask: string;
  options: string[];
  pr: { number: number; head: string | null } | null;
}

const textError = (name: string, v: string, max: number): string | null => {
  if (!v) return `${name}가 필요함`;
  if (v.length > max) return `${name}는 ${max}자 이내(지금 ${v.length}자)`;
  if (CONTROL.test(v)) return `${name}에 제어 문자가 있음`;
  if (JA_ZH.test(v)) return `${name}에 일본어·중국어 글자가 있음`;
  return null;
};

// 요청 본문 검사(순수). 틀리면 사유 하나, 맞으면 정리한 입력
export function decisionInputOf(body: unknown): DecisionInput | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isDecisionRole(b.role)) return { error: `role은 ${DECISION_ROLES.join("|")} 중 하나` };
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!KEY.test(key)) return { error: "key는 영문·숫자와 | : # @ . _ / - 로 120자 이내" };
  const ask = typeof b.ask === "string" ? b.ask.trim() : "";
  const askErr = textError("ask", ask, DECISION_ASK_MAX);
  if (askErr) return { error: askErr };
  if (!Array.isArray(b.options) || b.options.length < DECISION_OPTIONS_MIN || b.options.length > DECISION_OPTIONS_MAX) return { error: `options는 ${DECISION_OPTIONS_MIN}~${DECISION_OPTIONS_MAX}개` };
  const options: string[] = [];
  for (const o of b.options) {
    const t = typeof o === "string" ? o.trim() : "";
    const err = textError("option", t, DECISION_OPTION_MAX);
    if (err) return { error: err };
    options.push(t);
  }
  if (new Set(options).size !== options.length) return { error: "options에 같은 것이 둘 있음" };
  let pr: DecisionInput["pr"] = null;
  if (b.pr != null) {
    const p = b.pr as Record<string, unknown>;
    const number = typeof p.number === "number" ? p.number : NaN;
    if (!Number.isInteger(number) || number <= 0) return { error: "pr.number는 양의 정수" };
    const head = typeof p.head === "string" && p.head.trim() ? p.head.trim() : null;
    if (head !== null && !/^[0-9a-f]{7,40}$/i.test(head)) return { error: "pr.head는 커밋 해시(7~40자리)" };
    pr = { number, head };
  }
  return { role: b.role, key, ask, options, pr };
}

// 기록(ops)을 접어 지금 상태를 만든다
export function foldDecisions(ops: readonly DecisionOp[]): Decision[] {
  const byId = new Map<string, Decision>();
  for (const o of ops) {
    if (o.op === "create") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, { ...rest, status: "open", statusAt: o.at, answer: null, ackAt: null });
      continue;
    }
    const d = byId.get(o.id);
    if (!d) continue;
    if (o.op === "answer" && d.status === "open") Object.assign(d, { status: "answered", statusAt: o.at, answer: { choice: o.choice, text: o.text } });
    else if (o.op === "withdraw" && d.status === "open") Object.assign(d, { status: "withdrawn", statusAt: o.at });
    else if (o.op === "ack" && d.status === "answered" && !d.ackAt) d.ackAt = o.at;
  }
  return [...byId.values()];
}

export const nextDecisionId = (ops: readonly DecisionOp[]) => `DC-${String(ops.filter((o) => o.op === "create").length + 1).padStart(4, "0")}`;

// 같은 role·key의 카드가 withdrawn이 아니면 새로 올리지 않는다(이미 물었고, 답이 왔어도 같은 key로 다시 묻지 않는다)
export const duplicateOf = (all: readonly Decision[], role: DecisionRole, key: string): Decision | null => all.find((d) => d.role === role && d.key === key && d.status !== "withdrawn") ?? null;

// 세션이 아직 읽지 않은 답
export const unackedAnswers = (all: readonly Decision[], role: DecisionRole) => all.filter((d) => d.role === role && d.status === "answered" && !d.ackAt);

// 답 본문 검사. choice(옵션 번호)나 text 중 하나는 있어야 한다
export function decisionAnswerOf(d: Pick<Decision, "options">, body: unknown): { choice: number | null; text: string } | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  let choice: number | null = null;
  if (b.choice != null) {
    if (typeof b.choice !== "number" || !Number.isInteger(b.choice) || b.choice < 0 || b.choice >= d.options.length) return { error: `choice는 0~${d.options.length - 1}` };
    choice = b.choice;
  }
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (text) {
    const err = textError("text", text, DECISION_ANSWER_MAX);
    if (err) return { error: err };
  }
  if (choice === null && !text) return { error: "choice나 text가 필요함" };
  return { choice, text };
}

// 세션이 읽는 답 한 줄(영어: 세션끼리 주고받는 글, ATC-126)
export function answerLineOf(d: Pick<Decision, "id" | "key" | "options" | "answer">): string {
  const a = d.answer;
  const picked = a && a.choice !== null ? `option ${a.choice + 1} (${d.options[a.choice]})` : "no option";
  return `DECISION ${d.id} [${d.key}] ANSWERED by SUPERVISOR — ${picked}${a?.text ? ` · note: ${a.text}` : ""} — act on it, then \`atcctl decision ack ${d.id}\``;
}
