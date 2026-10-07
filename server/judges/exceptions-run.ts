import type { Hono } from "hono";
import { resendLinksOf } from "../clearance-resend.ts";
import { allClearances } from "../clearances.ts";
import { config } from "../config.ts";
import { createDecision } from "../decision-card-run.ts";
import { contentHashOf } from "../input-binding.ts";
import { releaseOfFlightNow } from "../input-binding-run.ts";
import type { Session, Snapshot } from "../model.ts";
import { fromThisApp } from "../origin.ts";
import { allProposals } from "../proposals.ts";
import { readRecords, record } from "../recorder.ts";
import { priorDeliveriesOf } from "../server-send.ts";
import { lastMessageOfSession } from "../sources/claude.ts";
import { CLAUDE_MODEL, type ClaudeRunner, claudeRunner, type JudgeEngine, jevEngine, stubEngine } from "./engines.ts";
import { EXCEPTION_POLICY_VERSION, POLICY_HASH } from "./exception-policy.ts";
import {
  claudePromptOf,
  claudeVerdictOf,
  decide,
  EXCEPTION_KINDS,
  EXCEPTION_MARKS,
  type ExceptionKind,
  type ExceptionMark,
  type ExceptionRole,
  type ExceptionSituation,
  type ExceptionSource,
  type ExceptionVerdict,
  exceptionCardOf,
  exceptionCountsOf,
  exceptionQuestions,
  exceptionStateOf,
  exportMask,
  jevDecisive,
  jevVerdictOf,
  REF_RE,
  roleOfRef,
  waitCandidatesOf,
} from "./exceptions.ts";
import { appendJudgeLines, type ExceptionJudgeLine, exceptionLinesOf, exceptionMarksOf, type JudgesLogLine, loadExceptionsMode, readJudgeLines } from "./store.ts";

// 예외 판정(ATC-558)의 입출력. 계산은 exceptions.ts(순수). 두 길로 부른다:
// ① 관제 세션(OCC·TOWER)이 팀의 UNABLE·질문·두 번째 침묵을 받으면 `atcctl exception <D-/C-id> --kind … -- '<글>'` → POST /api/exceptions
// ② 서버가 스스로 본 두 번째 침묵(control-wake의 second-silence 사건, ATC-557·562): exceptionWakeEvents가 깨우기 전에 판정한다.
// 반출(K2, SUPERVISOR 승인 2026-10-07): TypeSafe Jev와 claude -p에 가는 것은 가린 CAPTAIN 글(최대 1,500자)·메뉴·정책·정해진 말의 상황뿐이다.
// 기록: judges.jsonl의 target "exception" 줄(입력 해시·정책 해시·판정·출처·확신). CAPTAIN 글은 남기지 않는다.

export { CLAUDE_MODEL, type ClaudeRunner };
const TEXT_MAX = 8000; // 받는 CAPTAIN 글의 상한(가리기 전)
const DAY = 86_400_000;

// 엔진: ATC_JUDGE_ENGINE=stub이면 녹화 응답(네트워크 없음, 조심스러운 ESCALATE). 아니면 jev — 키가 없으면 ask가 던지고 claude로 간다
export const exceptionEngine = (): JudgeEngine => (config.judgeEngine === "stub" ? stubEngine() : jevEngine(config.typesafeApiKey));

export interface ExceptionCase {
  ref: string; // D-xxxx | C-xxxx
  kind: ExceptionKind;
  role: ExceptionRole;
  via: "atcctl" | "server";
  text: string; // 가리기 전 CAPTAIN 글(침묵이면 그 세션의 마지막 메시지, 없으면 "")
  situation: ExceptionSituation;
  flight: string | null;
  toName: string | null; // 카드에 보이는 받는 이
}
export interface ExceptionDeps {
  engine: () => JudgeEngine;
  claude: ClaudeRunner;
  fileCard: (body: unknown) => string | null; // DECISION 카드 id
  readLines: () => JudgesLogLine[];
  append: (l: ExceptionJudgeLine) => void;
  now: () => number;
}
export const defaultExceptionDeps = (): ExceptionDeps => ({
  engine: exceptionEngine,
  claude: claudeRunner,
  fileCard: (body) => {
    const r = createDecision(body, "judge");
    if ("error" in r) {
      console.error(`[atc] exception card refused: ${r.error}`);
      return null;
    }
    return r.decision.id;
  },
  readLines: () => readJudgeLines(),
  append: (l) => appendJudgeLines([l]),
  now: () => Date.now(),
});

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

// 같은 입력이면 같은 id. 판정은 한 번만(기록이 있으면 그것을, 판정 중이면 그 결과를 같이 기다린다)
export function exceptionIdOf(x: Pick<ExceptionCase, "ref" | "kind" | "text" | "situation" | "flight">) {
  const masked = exportMask(x.text);
  const candidates = waitCandidatesOf(masked, x.flight);
  const hash = contentHashOf({ ref: x.ref, kind: x.kind, situation: x.situation, message: masked, candidates, policy: POLICY_HASH });
  return { id: `EX-${x.ref}-${hash.slice(0, 8)}`, masked, candidates, hash };
}

const inflight = new Map<string, Promise<ExceptionJudgeLine>>();
export const cachedException = (id: string, deps: Pick<ExceptionDeps, "readLines"> = defaultExceptionDeps()) => exceptionLinesOf(deps.readLines()).find((l) => l.id === id) ?? null;

export async function judgeException(x: ExceptionCase, deps: ExceptionDeps = defaultExceptionDeps()): Promise<{ line: ExceptionJudgeLine; cached: boolean }> {
  const { id, masked, candidates, hash } = exceptionIdOf(x);
  const known = cachedException(id, deps);
  if (known) return { line: known, cached: true };
  const running = inflight.get(id);
  if (running) return { line: await running, cached: true };
  const p = judgeFresh(x, id, masked, candidates, hash, deps).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return { line: await p, cached: false };
}

async function judgeFresh(x: ExceptionCase, id: string, masked: string, candidates: string[], hash: string, deps: ExceptionDeps): Promise<ExceptionJudgeLine> {
  const state = exceptionStateOf(x.kind, x.situation, masked, candidates);
  // ① Jev(TypeSafe): 확신 ≥ 0.8이면 그 답
  let jv: ExceptionVerdict | null = null;
  let jevModel: string | null = null;
  let jevError: string | null = null;
  try {
    const r = await deps.engine().ask({ target: "exception", title: id, state: state as unknown as Record<string, unknown>, questions: exceptionQuestions(x.kind, candidates) });
    jevModel = r.model;
    jv = jevVerdictOf(r.answers, x.kind, candidates);
  } catch (e) {
    jevError = errText(e);
  }
  let source: ExceptionSource = "none";
  let verdict: ExceptionVerdict | null = null;
  let model: string | null = null;
  let claude: ExceptionJudgeLine["claude"] = null;
  if (jevDecisive(jv)) {
    source = "jev";
    verdict = jv;
    model = jevModel;
  } else {
    // ② 문턱 아래·오류·키 없음: claude -p 한 번(Claude 모델만)
    try {
      const got = claudeVerdictOf(await deps.claude(claudePromptOf(state, x.kind)), x.kind, candidates);
      source = "claude";
      verdict = got.verdict;
      model = got.model;
      claude = { proposed: got.verdict.proposed, error: null };
    } catch (e) {
      claude = { proposed: null, error: errText(e) };
    }
  }
  const d = decide(x.role, x.kind, x.situation, verdict);
  const at = new Date(deps.now()).toISOString();
  let card: string | null = null;
  if (d.action === "ESCALATE") card = deps.fileCard(exceptionCardOf(x, id, hash, masked, verdict, d, source));
  const release = releaseOfFlightNow(x.flight);
  const line: ExceptionJudgeLine = {
    op: "judge",
    family: "jev",
    target: "exception",
    id,
    ref: x.ref,
    kind: x.kind,
    role: x.role,
    via: x.via,
    flight: x.flight,
    at,
    source,
    model,
    confidence: source === "jev" ? (verdict?.confidence ?? null) : null,
    jev: { proposed: jv?.proposed ?? null, confidence: jv?.confidence ?? null, error: jevError },
    claude,
    proposed: verdict?.proposed ?? null,
    action: d.action,
    floor: d.floor,
    covered: verdict?.covered ?? null,
    point: verdict?.point ?? null,
    waitFor: d.action === "HOLD_UNTIL" ? (verdict?.waitFor ?? null) : null,
    answerYes: verdict?.answerYes ?? null,
    answer: d.action === "ANSWER" ? (verdict?.answer ?? null) : null,
    reason: verdict?.reason ?? (jevError ? `Jev: ${jevError}` : "no judge answered"),
    card,
    hash,
    policy: POLICY_HASH,
    policyVersion: EXCEPTION_POLICY_VERSION,
    sent: { chars: masked.length },
    ...(release ? { release } : {}),
  };
  deps.append(line);
  return line;
}

// ---- 호출(D-·C-)에서 사실을 읽는다 ----
function sessionState(s: Pick<Snapshot, "sessions"> | null, pick: (x: Session) => boolean): { state: ExceptionSituation["session"]; session: Session | null } {
  if (!s) return { state: "unknown", session: null };
  const live = s.sessions.find((x) => x.status !== "dead" && pick(x)) ?? null;
  return { state: live ? (live.status === "busy" ? "busy" : "idle") : "gone", session: live };
}

export type CaseOrError = { case: ExceptionCase; session: Session | null } | { error: string; status: 400 | 404 };
export function caseOf(body: { ref: string; kind: ExceptionKind; text: string; via: "atcctl" | "server" }, s: Pick<Snapshot, "sessions"> | null, now = Date.now()): CaseOrError {
  const role = roleOfRef(body.ref);
  if (role === "occ") {
    const p = allProposals().find((x) => x.id === body.ref);
    if (!p) return { error: `${body.ref}: 그런 FLIGHT PLAN이 없음`, status: 404 };
    const sentAt = p.timeline?.sent;
    const resent = priorDeliveriesOf(readRecords(now - 2 * DAY) as never, p.id).some((d) => d.purpose === "resend" && (!sentAt || d.at >= sentAt));
    const name = p.aircraftName ?? p.registration ?? null;
    const ss = sessionState(s, (x) => Boolean(name) && x.name === name);
    return { case: { ref: body.ref, kind: body.kind, role, via: body.via, text: body.text, situation: { call: "FLIGHT PLAN", resent: resent || body.kind === "silence", session: ss.state }, flight: p.flight ?? null, toName: name }, session: ss.session };
  }
  const all = allClearances();
  const c = all.find((x) => x.id === body.ref);
  if (!c) return { error: `${body.ref}: 그런 CLEARANCE가 없음`, status: 404 };
  const l = resendLinksOf(all).get(c.id);
  const ss = sessionState(s, (x) => x.id === c.to);
  return { case: { ref: body.ref, kind: body.kind, role, via: body.via, text: body.text, situation: { call: `CLEARANCE ${c.type}`, resent: Boolean(l?.resentBy.length || l?.resendOf) || body.kind === "silence", session: ss.state }, flight: c.flight ?? null, toName: c.toName ?? null }, session: ss.session };
}

// 침묵이고 글이 없으면 그 세션의 마지막 메시지(REPORT와 같은 읽기). 없으면 ""
const lastMessage = (sess: Session | null) => (sess ? (lastMessageOfSession(sess.cwd, sess.id, sess.account)?.text ?? "") : "");

// ---- atcctl이 찍는 답(관제 세션이 읽는다. 영어 머리 + 한 줄씩) ----
export function exceptionAnswerText(l: ExceptionJudgeLine, cached: boolean): string {
  const head = `EXCEPTION ${l.id} · ${l.action} · ${l.source}${l.confidence !== null ? ` ${Math.round(l.confidence * 100)}%` : ""}${cached ? " · cached" : ""}`;
  const lines = [head];
  if (l.action === "HOLD_UNTIL") lines.push(`WAIT FOR: ${l.waitFor}`);
  if (l.action === "ANSWER") lines.push(`ANSWER (${l.answerYes ? "yes" : "no"}, ${l.point}): ${l.answer}`);
  if (l.action === "ESCALATE") lines.push(l.card ? `CARD: ${l.card} — the SUPERVISOR answers on HOME; the answer comes back as decision-answered` : "CARD: not filed — report to the SUPERVISOR as before");
  if (l.floor) lines.push(`FLOOR: ${l.floor}`);
  lines.push(`WHY: ${l.reason}`);
  return lines.join("\n");
}

// ---- 서버가 본 두 번째 침묵(control-wake, ATC-557·562). 깨우기 전에 판정한다 ----
// 판정이 끝났으면: ESCALATE는 카드가 SUPERVISOR 보고를 대신하니 깨우지 않는다. 다른 행동은 사건 글에 판정을 붙인다(관제 세션이 그대로 실행).
// 판정 중이면 이번 바퀴에서 빼 둔다(다음 바퀴, 30초 뒤에 판정과 함께 깨운다). 스위치가 off면 그대로 둔다
export interface WakeEventLike {
  key: string;
  kind: string;
  text: string;
}
export function exceptionWakeEvents<E extends WakeEventLike>(role: string, events: E[], s: Pick<Snapshot, "sessions">, deps: ExceptionDeps = defaultExceptionDeps()): E[] {
  if ((role !== "tower" && role !== "occ") || loadExceptionsMode() !== "on") return events;
  const out: E[] = [];
  for (const e of events) {
    const ref = e.kind === "second-silence" ? e.key.slice("second-silence:".length) : "";
    if (!REF_RE.test(ref) || roleOfRef(ref) !== role) {
      out.push(e);
      continue;
    }
    try {
      const got = caseOf({ ref, kind: "silence", text: "", via: "server" }, s);
      if ("error" in got) {
        out.push(e);
        continue;
      }
      const x = { ...got.case, text: lastMessage(got.session) };
      const { id } = exceptionIdOf(x);
      const done = cachedException(id, deps);
      if (!done) {
        if (!inflight.has(id)) void judgeException(x, deps).catch((err) => console.error(`[atc] exception judge failed ${ref}:`, errText(err)));
        continue; // 판정 중: 다음 바퀴에
      }
      if (done.action === "ESCALATE" && done.card) continue; // 카드가 보고를 대신한다
      out.push({ ...e, text: `${e.text} — exception judge ${done.action}${done.waitFor ? ` until ${done.waitFor}` : ""} (${done.id}): run atcctl exception ${ref} --kind silence and act on its answer` });
    } catch (err) {
      console.error(`[atc] exception wake ${ref}:`, errText(err));
      out.push(e);
    }
  }
  return out;
}

// ---- 설정 창 자료: 스위치, 7일 수, 최근 판정(표시 버튼) ----
export function exceptionsData(now = Date.now(), lines: JudgesLogLine[] = readJudgeLines()) {
  const xs = exceptionLinesOf(lines);
  const marks = exceptionMarksOf(lines);
  const items = xs.map((l) => ({ source: l.source, action: l.action, at: l.at, mark: marks.get(l.id) ?? null }));
  return {
    mode: loadExceptionsMode(),
    engine: config.judgeEngine === "stub" ? "stub" : "jev",
    apiKeySet: Boolean(config.typesafeApiKey),
    claudeModel: CLAUDE_MODEL,
    policyVersion: EXCEPTION_POLICY_VERSION,
    policyHash: POLICY_HASH,
    last7d: exceptionCountsOf(items, now, 7),
    last30d: exceptionCountsOf(items, now, 30),
    recent: xs
      .slice(-8)
      .reverse()
      .map((l) => ({ id: l.id, ref: l.ref, kind: l.kind, role: l.role, via: l.via, at: l.at, source: l.source, confidence: l.confidence, proposed: l.proposed, action: l.action, floor: l.floor, waitFor: l.waitFor, point: l.point, card: l.card, reason: l.reason, mark: marks.get(l.id) ?? null })),
  };
}

export type ExceptionsData = ReturnType<typeof exceptionsData>;

export function markException(id: string, verdict: ExceptionMark, at = new Date().toISOString()): boolean {
  if (!exceptionLinesOf(readJudgeLines()).some((l) => l.id === id)) return false;
  appendJudgeLines([{ op: "mark", target: "exception", id, verdict, at }]);
  return true;
}

export function mountExceptions(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 관제 세션(atcctl exception)이 부른다. 스위치가 off면 판정하지 않고 그렇게 답한다(관제 세션이 오늘처럼 스스로 판단)
  app.post("/api/exceptions", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { ref?: unknown; kind?: unknown; text?: unknown; role?: unknown };
    const ref = typeof b.ref === "string" ? b.ref.trim().toUpperCase() : "";
    if (!REF_RE.test(ref)) return c.json({ error: "ref는 D-xxxx(FLIGHT PLAN) 또는 C-xxxx(CLEARANCE)" }, 400);
    if (!EXCEPTION_KINDS.includes(b.kind as ExceptionKind)) return c.json({ error: `kind는 ${EXCEPTION_KINDS.join("|")} 중 하나` }, 400);
    const kind = b.kind as ExceptionKind;
    if (b.role !== undefined && b.role !== roleOfRef(ref)) return c.json({ error: `${ref}는 ${roleOfRef(ref)}의 호출` }, 400);
    const text = typeof b.text === "string" ? b.text : "";
    if (kind !== "silence" && !text.trim()) return c.json({ error: "unable·question에는 CAPTAIN의 글(-- 뒤)이 필요함" }, 400);
    if (text.length > TEXT_MAX) return c.json({ error: `글은 ${TEXT_MAX}자 이내` }, 400);
    if (loadExceptionsMode() !== "on") return c.json({ off: true, line: "EXCEPTION OFF — judges.exceptions is off: judge it yourself as the manual says" });
    const s = await getSnapshot().catch(() => null);
    const got = caseOf({ ref, kind, text, via: "atcctl" }, s);
    if ("error" in got) return c.json({ error: got.error }, got.status);
    const x = kind === "silence" && !text.trim() ? { ...got.case, text: lastMessage(got.session) } : got.case;
    const r = await judgeException(x);
    return c.json({ judgment: r.line, cached: r.cached, line: exceptionAnswerText(r.line, r.cached) });
  });

  // SUPERVISOR가 판정을 표시한다(맞음·틀림·필요 없음). 이 화면 Origin만 — 관제 세션은 표시할 수 없다
  app.post("/api/judges/exceptions/:id/mark", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서만 표시할 수 있다" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { verdict?: unknown };
    if (!EXCEPTION_MARKS.includes(body.verdict as ExceptionMark)) return c.json({ error: `verdict는 ${EXCEPTION_MARKS.join("|")}` }, 400);
    if (!markException(c.req.param("id"), body.verdict as ExceptionMark)) return c.json({ error: "그런 판정이 없다" }, 404);
    return c.json({ ok: true, data: exceptionsData() });
  });
}

// 스위치 기록(FLIGHT RECORDER): 누가·언제 바꿨나
export const recordExceptionsMode = (from: string, to: string, by = "SUPERVISOR") => record({ t: new Date().toISOString(), kind: "policy", op: "judges-exceptions-mode", by, from, to });
