import "../test-hermetic.ts"; // 진짜 HOME·상태 폴더를 읽지 않게(ATC-190). 첫 import여야 한다
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// 예외 판정(ATC-558). Jev는 stub 엔진, claude -p는 가짜 runner만 쓴다 — 진짜 TypeSafe나 claude를 부르지 않는다.
const STATE = mkdtempSync(join(tmpdir(), "atc-exceptions-"));
process.env.ATC_STATE_DIR = STATE;
after(() => rmSync(STATE, { recursive: true, force: true }));

const ex = await import("./exceptions.ts");
const { POLICY_HASH, POLICY_POINTS, POLICY_TEXT } = await import("./exception-policy.ts");
const { stubEngine, jevEngine } = await import("./engines.ts");
const run = await import("./exceptions-run.ts");
const store = await import("./store.ts");
const { issueClearance } = await import("../clearances.ts");
const { Hono } = await import("hono");

const SECRET = "sk-live_ABCDEFGHIJKLMNOPQRSTUV123456";
const jevAnswers = (action: string, conf: number, extra: Record<string, unknown> = {}) => ({
  action: { type: "choice", choice: action, probabilities: {}, confidence: conf },
  policy_covers: { type: "noul", noul: 0.1 },
  policy_point: { type: "choice", choice: "NONE", probabilities: {}, confidence: 0.9 },
  ...extra,
});
const claudeOut = (j: Record<string, unknown>, model = "claude-sonnet-5-5") => JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(j), modelUsage: { [model]: { inputTokens: 1 } } });

type Deps = ReturnType<typeof run.defaultExceptionDeps>;
function harness(opts: { answers?: unknown; jevThrows?: Error; engine?: () => ReturnType<typeof stubEngine>; claude?: string | (() => string) } = {}) {
  const lines: ReturnType<Deps["readLines"]> = [];
  const cards: unknown[] = [];
  const prompts: string[] = [];
  const engine = stubEngine();
  const deps: Deps = {
    engine: () => {
      if (opts.engine) return opts.engine();
      return {
        ...engine,
        async ask(call) {
          engine.calls.push(call);
          if (opts.jevThrows) throw opts.jevThrows;
          return { model: "jev-test", answers: structuredClone(opts.answers ?? jevAnswers("ESCALATE", 0.9)) };
        },
      };
    },
    claude: async (p) => {
      prompts.push(p);
      return typeof opts.claude === "function" ? opts.claude() : (opts.claude ?? "");
    },
    fileCard: (body) => {
      cards.push(body);
      return `DC-${String(cards.length).padStart(4, "0")}`;
    },
    readLines: () => lines,
    append: (l) => lines.push(l),
    now: () => Date.parse("2026-10-07T10:00:00Z"),
  };
  return { deps, lines, cards, prompts, calls: engine.calls };
}

const situation = (over: Partial<import("./exceptions.ts").ExceptionSituation> = {}) => ({ call: "CLEARANCE INFO", resent: false, session: "idle" as const, ...over });
const kase = (over: Partial<import("./exceptions-run.ts").ExceptionCase> = {}): import("./exceptions-run.ts").ExceptionCase => ({
  ref: "C-0042",
  kind: "question",
  role: "tower",
  via: "atcctl",
  text: "May I merge PR #12 myself once CI is green?",
  situation: situation(),
  flight: "ATC-900",
  toName: "TEAM_X",
  ...over,
});

test("메뉴는 고정된 여섯과 NONE, Jev 질문은 action·policy_covers·policy_point(+질문이면 answer_yes, 후보가 있으면 wait_for)", () => {
  assert.deepEqual([...ex.EXCEPTION_ACTIONS], ["RESEND", "HOLD_UNTIL", "REASSIGN", "ANSWER", "ESCALATE", "ACCEPT_UNDONE"]);
  const q = ex.exceptionQuestions("question", ["ATC-12"]) as Record<string, { type: string; criteria: Record<string, string> }>;
  assert.deepEqual(Object.keys(q).sort(), ["action", "answer_yes", "policy_covers", "policy_point", "wait_for"]);
  assert.deepEqual(Object.keys(q.action!.criteria), [...ex.EXCEPTION_ACTIONS, "NONE"]);
  assert.equal(q.action!.type, "choice");
  assert.equal(q.policy_covers!.type, "noul");
  assert.deepEqual(Object.keys(q.policy_point!.criteria), [...POLICY_POINTS.map((p) => p.id), "NONE"]);
  assert.deepEqual(Object.keys(q.wait_for!.criteria), ["ATC-12", "NONE"]);
  const u = ex.exceptionQuestions("unable", []);
  assert.ok(!("answer_yes" in u) && !("wait_for" in u));
});

test("가림: 코드 블록·비밀 값·Bearer·경로·URL·토큰이 나가지 않고 1,500자를 넘지 않는다", () => {
  const text = [
    "UNABLE — the build fails here:",
    "```ts",
    `const key = "${SECRET}"`,
    "readFileSync('/home/c10/.env.local')",
    "```",
    `TYPESAFE_API_KEY=${SECRET} and password: hunter2`,
    "Authorization: Bearer abcdefghijklmnop123",
    "see server/judges/run.ts and https://github.com/c10dev/atc/pull/12",
    "hash deadbeefdeadbeefdeadbeef1234",
    "x".repeat(3000),
  ].join("\n");
  const m = ex.exportMask(text);
  assert.ok(m.length <= 1500, `${m.length}`);
  for (const bad of [SECRET, "hunter2", "/home/c10", ".env.local", "server/judges/run.ts", "github.com", "abcdefghijklmnop123", "deadbeefdeadbeef", "readFileSync"]) assert.ok(!m.includes(bad), `${bad} 새어 나감: ${m.slice(0, 300)}`);
  assert.match(m, /<code>/);
  assert.match(m, /TYPESAFE_API_KEY=<secret>/);
});

test("Jev 확신 ≥ 0.8: Jev의 답을 쓰고 claude를 부르지 않는다. 내보낸 것은 가린 글·메뉴·정책·상황뿐", async () => {
  const h = harness({ answers: jevAnswers("REASSIGN", 0.86) });
  const { line } = await run.judgeException(kase({ kind: "unable", text: `UNABLE — this is DB work outside my ratings. token ${SECRET}` }), h.deps);
  assert.equal(line.source, "jev");
  assert.equal(line.action, "REASSIGN");
  assert.equal(line.confidence, 0.86);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.cards.length, 0);
  assert.equal(h.calls.length, 1);
  const state = h.calls[0]!.state as Record<string, unknown>;
  assert.deepEqual(Object.keys(state).sort(), ["exception", "menu", "policy"]);
  assert.equal(state.policy, POLICY_TEXT);
  assert.ok(!JSON.stringify(h.calls[0]).includes(SECRET));
  assert.ok(!JSON.stringify(h.calls[0]).includes("ATC-900") && !JSON.stringify(h.calls[0]).includes("TEAM_X"), "FLIGHT·REGISTRATION은 나가지 않는다");
  assert.equal(line.policy, POLICY_HASH);
  assert.ok(line.hash && line.sent.chars > 0);
  assert.ok(!JSON.stringify(line).includes(SECRET) && !JSON.stringify(line).includes("outside my ratings"), "기록에 CAPTAIN 글이 없다");
});

test("Jev 확신 < 0.8: claude -p 한 번이 정한다", async () => {
  const h = harness({ answers: jevAnswers("REASSIGN", 0.6), claude: claudeOut({ action: "HOLD_UNTIL", wait_for: "ATC-77", reason: "waits on ATC-77" }) });
  const { line } = await run.judgeException(kase({ kind: "unable", text: "UNABLE — needs ATC-77 to land first" }), h.deps);
  assert.equal(h.prompts.length, 1);
  assert.equal(line.source, "claude");
  assert.equal(line.action, "HOLD_UNTIL");
  assert.equal(line.waitFor, "ATC-77");
  assert.deepEqual(line.jev, { proposed: "REASSIGN", confidence: 0.6, error: null });
  assert.equal(line.model, "claude-sonnet-5-5");
  assert.ok(h.prompts[0]!.includes(POLICY_TEXT));
});

test("Jev 오류 → claude, 키 없음 → claude(아무것도 TypeSafe로 가지 않는다)", async () => {
  const h = harness({ jevThrows: new Error("TypeSafe HTTP 500"), claude: claudeOut({ action: "ACCEPT_UNDONE", reason: "PR merged" }) });
  const a = await run.judgeException(kase({ kind: "unable", text: "UNABLE — already merged in PR #5" }), h.deps);
  assert.equal(a.line.source, "claude");
  assert.equal(a.line.action, "ACCEPT_UNDONE");
  assert.match(a.line.jev!.error!, /HTTP 500/);

  let fetched = 0;
  const noKey = jevEngine("", (async () => {
    fetched++;
    return new Response("{}");
  }) as never);
  const h2 = harness({ engine: () => noKey as never, claude: claudeOut({ action: "ESCALATE", reason: "unclear" }) });
  const b = await run.judgeException(kase({ kind: "unable", text: "UNABLE — no idea" }), h2.deps);
  assert.equal(fetched, 0);
  assert.equal(b.line.source, "claude");
  assert.match(b.line.jev!.error!, /TYPESAFE_API_KEY/);
  assert.equal(b.line.action, "ESCALATE");
  assert.equal(b.line.card, "DC-0001");
});

test("ANSWER는 정책이 그 점을 정할 때만: 덮지 않으면 ESCALATE 카드, 덮으면 정책 점에서 지은 답", async () => {
  const h = harness({ answers: jevAnswers("ANSWER", 0.95, { answer_yes: { type: "noul", noul: 0.05 } }) });
  const a = await run.judgeException(kase(), h.deps);
  assert.equal(a.line.action, "ESCALATE");
  assert.equal(a.line.floor, "the policy does not settle this exact point");
  assert.equal(a.line.card, "DC-0001");
  const card = h.cards[0] as { role: string; key: string; ask: string; options: string[] };
  assert.equal(card.role, "tower");
  assert.match(card.key, /^exception\|C-0042\|/);
  assert.ok(card.ask.length <= 600 && card.ask.includes("예외 판정 ESCALATE"));
  assert.ok(card.options.length >= 2 && card.options.length <= 6);

  const h2 = harness({
    answers: jevAnswers("ANSWER", 0.95, {
      answer_yes: { type: "noul", noul: 0.04 },
      policy_covers: { type: "noul", noul: 0.95 },
      policy_point: { type: "choice", choice: "P4", probabilities: {}, confidence: 0.92 },
    }),
  });
  const b = await run.judgeException(kase(), h2.deps);
  assert.equal(b.line.source, "jev");
  assert.equal(b.line.action, "ANSWER");
  assert.equal(b.line.covered, true);
  assert.equal(b.line.point, "P4");
  assert.match(b.line.answer!, /^No\. Per atc policy P4:/);
  assert.equal(h2.cards.length, 0);
  assert.match(run.exceptionAnswerText(b.line, false), /ANSWER \(no, P4\): No\./);
});

test("ANSWER의 불확실한 갈래(덮음 0.5 근처)는 확신을 낮춰 claude로 간다", async () => {
  const h = harness({
    answers: jevAnswers("ANSWER", 0.95, { answer_yes: { type: "noul", noul: 0.9 }, policy_covers: { type: "noul", noul: 0.55 }, policy_point: { type: "choice", choice: "P1", confidence: 0.9 } }),
    claude: claudeOut({ action: "ANSWER", answer_yes: true, policy_point: "P1", policy_covers: true, answer: "Yes, use your discretion and note it in the PR.", reason: "P1" }),
  });
  const { line } = await run.judgeException(kase({ text: "Should the button say Save or Apply?" }), h.deps);
  assert.equal(h.prompts.length, 1);
  assert.equal(line.source, "claude");
  assert.equal(line.action, "ANSWER");
  assert.equal(line.answer, "Yes, use your discretion and note it in the PR.");
});

test("메뉴에 없음(NONE)은 첫날부터 ESCALATE", async () => {
  const h = harness({ answers: jevAnswers("NONE", 0.97) });
  const { line } = await run.judgeException(kase({ kind: "unable", text: "UNABLE — something odd" }), h.deps);
  assert.equal(line.proposed, "NONE");
  assert.equal(line.action, "ESCALATE");
  assert.equal(line.floor, "none of the menu actions fits");
  assert.equal(h.cards.length, 1);
});

test("실행할 수 없는 행동은 ESCALATE: OCC의 ANSWER, 두 번째 침묵의 RESEND, 이미 다시 보낸 호출의 RESEND", () => {
  const v = (proposed: string, over: object = {}) => ({ proposed, confidence: 0.9, waitFor: null, answerYes: true, covered: true, point: "P1", answer: "Yes.", reason: "", ...over }) as never;
  assert.deepEqual(ex.decide("occ", "question", { resent: false }, v("ANSWER")), { action: "ESCALATE", floor: "OCC cannot send an answer to a team; the supervisor relays it" });
  assert.equal(ex.decide("tower", "silence", { resent: true }, v("RESEND")).action, "ESCALATE");
  assert.equal(ex.decide("tower", "unable", { resent: true }, v("RESEND")).floor, "a call is resent at most once (P13)");
  assert.equal(ex.decide("tower", "unable", { resent: false }, v("RESEND")).action, "RESEND");
  assert.equal(ex.decide("tower", "unable", { resent: false }, v("HOLD_UNTIL")).floor, "HOLD_UNTIL names no FLIGHT or PR to wait on");
  assert.equal(ex.decide("tower", "question", { resent: false }, null).action, "ESCALATE");
});

test("claude가 Claude 모델이 아니거나 답하지 않으면 판정 없음 → ESCALATE", async () => {
  const h = harness({ answers: jevAnswers("REASSIGN", 0.5), claude: claudeOut({ action: "REASSIGN" }, "deepseek-chat") });
  const { line } = await run.judgeException(kase({ kind: "unable", text: "UNABLE — outside my repo" }), h.deps);
  assert.equal(line.source, "none");
  assert.match(line.claude!.error!, /Claude 모델이 아님/);
  assert.equal(line.action, "ESCALATE");
  assert.equal(line.card, "DC-0001");
});

test("같은 입력은 다시 판정하지 않는다(cached)", async () => {
  const h = harness({ answers: jevAnswers("REASSIGN", 0.9) });
  const x = kase({ kind: "unable", text: "UNABLE — another team holds it" });
  const a = await run.judgeException(x, h.deps);
  const b = await run.judgeException(x, h.deps);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(a.line.id, b.line.id);
  assert.equal(h.calls.length, 1);
  assert.equal(h.lines.length, 1);
});

test("HOLD_UNTIL의 대상은 가린 글에서 찾은 FLIGHT·PR 가운데 Choice, 호출 id와 그 FLIGHT 자신은 빼고", async () => {
  assert.deepEqual(ex.waitCandidatesOf("waits on ATC-77 and PR #12, see D-0003 C-0004 CC-0001 and ATC-900", "ATC-900"), ["ATC-77", "PR #12"]);
  const h = harness({ answers: jevAnswers("HOLD_UNTIL", 0.9, { wait_for: { type: "choice", choice: "PR #12", confidence: 0.85 } }) });
  const { line } = await run.judgeException(kase({ kind: "unable", text: "UNABLE — needs PR #12 merged first" }), h.deps);
  assert.equal(line.action, "HOLD_UNTIL");
  assert.equal(line.waitFor, "PR #12");
});

test("수와 표시: 다룬 몫, Jev·Claude, ESCALATE, 틀린 행동 비율, 오작동", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const at = "2026-10-07T10:00:00Z";
  const c = ex.exceptionCountsOf(
    [
      { source: "jev", action: "REASSIGN", at, mark: "right" },
      { source: "jev", action: "ANSWER", at, mark: "wrong" },
      { source: "claude", action: "HOLD_UNTIL", at, mark: null },
      { source: "claude", action: "ESCALATE", at, mark: "unnecessary" },
      { source: "none", action: "ESCALATE", at, mark: null },
      { source: "jev", action: "REASSIGN", at: "2026-09-01T00:00:00Z", mark: "wrong" },
    ],
    now,
  );
  assert.equal(c.judged, 5);
  assert.equal(c.handled, 3);
  assert.equal(c.handledShare, 3 / 5);
  assert.deepEqual([c.jev, c.claude, c.none, c.escalated], [2, 2, 1, 2]);
  assert.equal(c.wrongRate, 1 / 2);
  assert.equal(c.misfires, 2);
});

test("스위치: judges.json의 exceptions(기본 on), jev 칸은 그대로 둔다. off면 라우트가 판정하지 않는다", async () => {
  const file = join(STATE, "judges.json");
  writeFileSync(file, JSON.stringify({ jev: "shadow", reportDecisionMin: 0.6 }));
  assert.equal(store.loadExceptionsMode(), "on");
  assert.equal(store.saveExceptionsMode("off"), true);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(saved, { jev: "shadow", reportDecisionMin: 0.6, exceptions: "off" });
  assert.equal(store.loadJudges().jev, "shadow");

  const app = new Hono();
  run.mountExceptions(app, async () => ({ sessions: [] }) as never);
  const post = (body: unknown) => app.request("/api/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const off = await post({ ref: "C-0001", kind: "unable", text: "UNABLE — x" });
  assert.equal(off.status, 200);
  assert.equal(((await off.json()) as { off?: boolean }).off, true);
  assert.equal(store.readJudgeLines().length, 0, "off면 아무것도 기록하지 않는다");
  assert.equal((await post({ ref: "X-1", kind: "unable", text: "a" })).status, 400);
  assert.equal((await post({ ref: "C-0001", kind: "question", text: "" })).status, 400);

  store.saveExceptionsMode("on");
  assert.equal((await post({ ref: "C-0999", kind: "unable", text: "UNABLE — x" })).status, 404);
  const mark = await app.request("/api/judges/exceptions/EX-1/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict: "wrong" }) });
  assert.equal(mark.status, 403, "표시는 이 화면 Origin만");
});

test("서버가 본 두 번째 침묵: 판정 중이면 이번 바퀴에서 빼고, ESCALATE 카드면 깨우지 않고, 다른 행동은 글에 붙인다. off면 그대로", async () => {
  const c = issueClearance({ to: "sess-1", toName: "TEAM_X", type: "INFO", stand: null, flight: "ATC-900", text: "PR #3 cannot land yet" });
  const s = { sessions: [] } as never;
  const ev = (id: string) => ({ key: `second-silence:${id}`, kind: "second-silence", text: `no answer to ${id}`, flights: [], menu: false });
  const other = { key: "land:x", kind: "land", text: "land", flights: [], menu: true };

  const h = harness({ answers: jevAnswers("ACCEPT_UNDONE", 0.9) });
  const first = run.exceptionWakeEvents("tower", [ev(c.id), other], s, h.deps);
  assert.deepEqual(first, [other], "판정 중에는 빼 둔다");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.lines.length, 1);
  const judged = h.lines[0] as import("./store.ts").ExceptionJudgeLine;
  assert.equal(judged.via, "server");
  assert.equal(judged.kind, "silence");
  const second = run.exceptionWakeEvents("tower", [ev(c.id)], s, h.deps);
  assert.match(second[0]!.text, /exception judge ACCEPT_UNDONE .*atcctl exception C-\d+ --kind silence/);

  const h2 = harness({ answers: jevAnswers("ESCALATE", 0.95) });
  const c2 = issueClearance({ to: "sess-2", toName: "TEAM_Y", type: "FIX", stand: null, flight: null, text: "fix it" });
  run.exceptionWakeEvents("tower", [ev(c2.id)], s, h2.deps);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h2.cards.length, 1);
  assert.equal((h2.cards[0] as { key: string }).key, `exception|${c2.id}|silence`);
  assert.deepEqual(run.exceptionWakeEvents("tower", [ev(c2.id)], s, h2.deps), [], "카드가 보고를 대신한다");

  assert.deepEqual(run.exceptionWakeEvents("mcc", [ev(c2.id)], s, h2.deps).length, 1, "MCC는 손대지 않는다");
  store.saveExceptionsMode("off");
  assert.equal(run.exceptionWakeEvents("tower", [ev(c2.id)], s, h2.deps)[0]!.text, `no answer to ${c2.id}`);
  store.saveExceptionsMode("on");
});

test("침묵은 호출 하나에 판정 하나: 마지막 메시지가 바뀌어도 24시간 안이면 다시 판정하지 않는다", async () => {
  const h = harness({ answers: jevAnswers("ESCALATE", 0.95) });
  const x = kase({ ref: "C-0077", kind: "silence", text: "Working on the tests now.", situation: situation({ resent: true }) });
  const a = await run.judgeException(x, h.deps);
  const b = await run.judgeException({ ...x, text: "Tests pass, writing the PR body." }, h.deps);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(b.line.id, a.line.id);
  assert.equal(h.calls.length, 1);
  assert.equal(h.cards.length, 1);
});
