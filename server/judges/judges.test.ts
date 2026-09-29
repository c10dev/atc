import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// 합성 티켓과 stub 엔진만 쓴다. 실제 티켓 데이터로 TypeSafe를 부르지 않는다(ATC-36).
const STATE = mkdtempSync(join(tmpdir(), "atc-judges-"));
process.env.ATC_STATE_DIR = STATE;
after(() => rmSync(STATE, { recursive: true, force: true }));

const { bodyWithheld, classifyInputOf, classifyQuestions, judgmentOf, JudgeAnswerError, verdictOf } = await import("./classify.ts");
const { JEV_MODEL, JEV_URL, jevEngine, JudgeEngineError, requestBodyOf, STUB_FALLBACK, stubEngine } = await import("./engines.ts");
const { judgeRateOf, judgesViewOf, loadJudges, marksOf, parseJudges, readJudgeLines, setJudgeMode } = await import("./store.ts");
const { judgeOp, targetsOf } = await import("./run.ts");
const { fold, gateOf, humanOf } = await import("../schedule.ts");
const { FLIGHT_TYPES, RATINGS, WAKES } = await import("../crew.ts");

const SECRET_LINE = "SECRET_NOT_ALLOWED";
const BODY = [
  "## 목표",
  "설정 화면에 테마 선택을 더한다.",
  "## 수정 허용 범위",
  "web/src/SettingsPanel.tsx",
  "## 금지 사항",
  `${SECRET_LINE} 금지 칸은 보내지 않는다`,
  "## 완료 기준",
  "- 테마 세 개를 고를 수 있다",
  "## 배경",
  `${SECRET_LINE} 배경 칸도 보내지 않는다`,
].join("\n");

const answers = (type: string, wake: string, r: Partial<Record<string, number>> = {}) => ({
  flight_type: { type: "choice", choice: type, probabilities: {}, confidence: 0.8 },
  wake: { type: "choice", choice: wake, probabilities: {}, confidence: 0.7 },
  rating_sec: { type: "noul", noul: r.SEC ?? 0.05 },
  rating_ui: { type: "noul", noul: r.UI ?? 0.05 },
  rating_data: { type: "noul", noul: r.DATA ?? 0.05 },
  rating_docs: { type: "noul", noul: r.DOCS ?? 0.05 },
});

test("입력 허용 목록: 제목과 목표·수정 허용 범위·완료 기준만. 다른 칸, key, 라벨은 보내지 않는다", () => {
  const input = classifyInputOf({ title: "테마 선택 더하기", description: BODY }, false);
  assert.deepEqual(Object.keys(input).sort(), ["sections", "title"]);
  assert.deepEqual(Object.keys(input.sections).sort(), ["allowed_scope", "done_criteria", "goal"]);
  assert.ok(!JSON.stringify(input).includes(SECRET_LINE));
  assert.match(input.sections.goal!, /테마 선택/);
  // 본문을 보내지 않으면 제목만
  assert.deepEqual(classifyInputOf({ title: "t", description: BODY }, true), { title: "t", sections: {} });
  // 본문이 없거나 칸이 없으면 제목만
  assert.deepEqual(classifyInputOf({ title: "t", description: "그냥 한 줄" }, false).sections, {});
});

test("rating:SEC·Risk:* 라벨, 모르는 라벨, SEC를 붙이는 초안은 본문을 보내지 않는다", () => {
  assert.equal(bodyWithheld(["type:BUILD", "rating:UI"], { type: "BUILD" }), null);
  assert.match(bodyWithheld(["rating:SEC"], {})!, /rating:SEC/);
  assert.match(bodyWithheld(["Risk: Security"], {})!, /Risk/);
  assert.match(bodyWithheld(["risk:rights"], {})!, /risk/);
  assert.match(bodyWithheld(null, {})!, /라벨을 모름/);
  assert.match(bodyWithheld([], { ratings: ["SEC"] })!, /SEC/);
});

test("질문: FLIGHT TYPE·WAKE는 Choice(선택지가 docs/fleet.md 4장과 같다), TYPE RATING마다 Noul", () => {
  const q = classifyQuestions() as Record<string, { type: string; criteria: Record<string, unknown> }>;
  assert.equal(q.flight_type.type, "choice");
  assert.deepEqual(Object.keys(q.flight_type.criteria), [...FLIGHT_TYPES]);
  assert.equal(q.wake.type, "choice");
  assert.deepEqual(Object.keys(q.wake.criteria), [...WAKES]);
  for (const r of RATINGS) assert.equal(q[`rating_${r.toLowerCase()}`].type, "noul");
  assert.equal(Object.keys(q).length, 2 + RATINGS.length);
});

test("답 검사: 모양이 틀리면 JudgeAnswerError", () => {
  const j = judgmentOf(answers("MAINT", "L", { DOCS: 0.9 }));
  assert.equal(j.type, "MAINT");
  assert.equal(j.wake, "L");
  assert.equal(j.ratings.DOCS, 0.9);
  assert.equal(j.confidence.type, 0.8);
  assert.throws(() => judgmentOf({ ...answers("MAINT", "L"), flight_type: { type: "choice", choice: "PARTY" } }), JudgeAnswerError);
  assert.throws(() => judgmentOf({ ...answers("MAINT", "L"), rating_sec: { type: "noul", noul: 2 } }), JudgeAnswerError);
  assert.throws(() => judgmentOf(null), JudgeAnswerError);
});

test("mark: 초안이 적은 축만 비교한다. RATING은 초안이 붙이거나 이미 있는 라벨과 비교", () => {
  const j = judgmentOf(answers("MAINT", "L", { UI: 0.8 }));
  assert.equal(verdictOf({ type: "MAINT" }, [], j)!.verdict, "agree");
  const d = verdictOf({ type: "BUILD", wake: "L" }, [], j)!;
  assert.equal(d.verdict, "disagree");
  assert.match(d.reason, /TYPE MAINT\(80%\) ≠ 초안 BUILD/);
  // UI는 이미 라벨이 있어 초안이 붙이지 않았다 → 일치
  assert.equal(verdictOf({ ratings: ["DOCS"] }, ["rating:UI"], j)!.verdict, "disagree"); // DOCS를 붙였는데 판정은 no
  assert.equal(verdictOf({ ratings: ["UI"] }, [], j)!.verdict, "agree");
  assert.equal(verdictOf({}, [], j), null);
});

test("stub 엔진으로 초안 하나: 본문을 보내지 않을 때는 Linear 본문도 읽지 않는다", async () => {
  const [op] = fold([{ op: "draft", id: "S-0001", at: "2026-09-01T00:00:00Z", kind: "CLASSIFY", flight: "SYN-1", payload: { type: "SURVEY", wake: "L" }, reason: "r" }]);
  const engine = stubEngine({ "합성 조사 티켓": answers("SURVEY", "L") });
  let reads = 0;
  const read = async () => {
    reads++;
    return { title: "합성 조사 티켓", description: BODY };
  };
  const line = (await judgeOp(op, { title: "합성 조사 티켓", labels: [] }, read, engine, "jev", "shadow", "2026-09-01T01:00:00Z"))!;
  assert.equal(line.verdict, "agree");
  assert.equal(line.engine, "stub");
  assert.deepEqual(line.sent, ["title", "goal", "allowed_scope", "done_criteria"]);
  assert.equal(reads, 1);
  const sec = (await judgeOp(op, { title: "합성 보안 티켓", labels: ["rating:SEC"] }, read, engine, "jev", "shadow", "2026-09-01T01:00:00Z"))!;
  assert.equal(reads, 1); // 읽지 않음
  assert.deepEqual(sec.sent, ["title"]);
  assert.match(sec.withheld!, /rating:SEC/);
  assert.deepEqual(engine.inputs[1], { title: "합성 보안 티켓", sections: {} });
  // 녹화 응답이 없으면 기본 응답(BUILD·M)
  assert.equal(((await stubEngine().judge({ title: "x", sections: {} })).answers as typeof STUB_FALLBACK).flight_type.choice, STUB_FALLBACK.flight_type.choice);
});

test("jev 엔진: POST /v1/systemone, jev-latest, Bearer. 보내는 state는 ticket 하나. 오류에 키가 없다", async () => {
  const KEY = "ts_test_key_do_not_log";
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: answers("CHECK", "L"), usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  };
  const input = { title: "합성 검토", sections: { goal: "PR을 검토한다" } };
  const r = await jevEngine(KEY, ok).judge(input);
  assert.equal(r.model, "jev-1.13.0");
  assert.equal(calls[0].url, JEV_URL);
  assert.equal(JEV_URL, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, JEV_MODEL);
  assert.equal(JEV_MODEL, "jev-latest");
  assert.deepEqual(body.state, { ticket: input });
  assert.deepEqual(body, JSON.parse(JSON.stringify(requestBodyOf(input))));

  const fail = async () => new Response(JSON.stringify({ detail: "bad" }), { status: 401 });
  await assert.rejects(jevEngine(KEY, fail).judge(input), (e: Error) => e instanceof JudgeEngineError && !e.message.includes(KEY) && /401/.test(e.message));
  let called = false;
  await assert.rejects(
    jevEngine("", async () => {
      called = true;
      return new Response("{}");
    }).judge(input),
    /TYPESAFE_API_KEY 없음/,
  );
  assert.equal(called, false);
});

test("스위치: 기본 off, 모르는 값도 off. 바꾸면 judges.json과 mode 줄", () => {
  assert.deepEqual(parseJudges(null), { jev: "off" });
  assert.deepEqual(parseJudges({ jev: "on" }), { jev: "off" });
  assert.deepEqual(loadJudges(), { jev: "off" });
  setJudgeMode("jev", "replay", "2026-09-02T00:00:00Z");
  assert.equal(JSON.parse(readFileSync(join(STATE, "judges.json"), "utf8")).jev, "replay");
  assert.deepEqual(readJudgeLines().at(-1), { op: "mode", family: "jev", at: "2026-09-02T00:00:00Z", from: "off", to: "replay" });
  setJudgeMode("jev", "off");
  assert.deepEqual(loadJudges(), { jev: "off" });
});

// 합성 SCHEDULE 기록: S-1 판정됨(agree), S-2 판정됨(disagree), S-3 열린 초안, S-4 ATFM 자동 판정, S-5 PRIORITIZE
const lines = [
  { op: "draft", id: "S-0001", at: "2026-09-01T00:00:00Z", kind: "CLASSIFY", flight: "SYN-1", payload: { type: "MAINT" }, reason: "r" },
  { op: "verdict", id: "S-0001", at: "2026-09-01T02:00:00Z", verdict: "agree", reason: null },
  { op: "draft", id: "S-0002", at: "2026-09-01T00:00:00Z", kind: "CLASSIFY", flight: "SYN-2", payload: { type: "BUILD" }, reason: "r" },
  { op: "verdict", id: "S-0002", at: "2026-09-01T02:00:00Z", verdict: "disagree", reason: "MAINT임" },
  { op: "draft", id: "S-0003", at: "2026-09-02T00:00:00Z", kind: "CLASSIFY", flight: "SYN-3", payload: { wake: "L" }, reason: "r" },
  { op: "draft", id: "S-0004", at: "2026-09-01T00:00:00Z", kind: "CLASSIFY", flight: "SYN-4", payload: { wake: "M" }, reason: "r" },
  { op: "verdict", id: "S-0004", at: "2026-09-01T02:00:00Z", verdict: "agree", reason: null, via: "atfm" },
  { op: "draft", id: "S-0005", at: "2026-09-01T00:00:00Z", kind: "PRIORITIZE", flight: "SYN-5", payload: { priority: 2 }, reason: "r" },
  { op: "verdict", id: "S-0005", at: "2026-09-01T02:00:00Z", verdict: "agree", reason: null },
] as Parameters<typeof fold>[0];
type Line = Parameters<typeof marksOf>[0][number];
const judge = (id: string, verdict: "agree" | "disagree", at: string, run: "replay" | "shadow" = "replay"): Line =>
  ({ op: "judge", family: "jev", target: "schedule", id, flight: null, at, run, engine: "stub", model: "stub", verdict, reason: "r", judgment: judgmentOf(answers("MAINT", "M")), withheld: null, sent: ["title"] });

test("대상: off면 없음, replay는 판정된 CLASSIFY, shadow는 열린 CLASSIFY. 이미 mark가 있거나 skip이면 뺀다", () => {
  const ops = fold(lines);
  assert.deepEqual(targetsOf(ops, new Map(), "jev", "off"), []);
  assert.deepEqual(
    targetsOf(ops, new Map(), "jev", "replay").map((o) => o.id),
    ["S-0001", "S-0002"],
  ); // S-0004(ATFM)은 사람 판정이 아니다, S-0005는 PRIORITIZE
  assert.deepEqual(targetsOf(ops, marksOf([judge("S-0001", "agree", "2026-09-03T00:00:00Z")]), "jev", "replay", new Set(["S-0002"])), []);
  assert.deepEqual(targetsOf(ops, new Map(), "jev", "shadow").map((o) => o.id), ["S-0003"]);
});

test("일치율: crosscheckRateOf로 계열별. replay mark(판정 뒤)도 센다. 게이트와 초안 상태는 그대로", () => {
  const ops = fold(lines);
  const before = JSON.stringify({ gate: gateOf(ops), status: ops.map((o) => o.status) });
  const marks = marksOf([
    judge("S-0001", "disagree", "2026-09-03T00:00:00Z"),
    judge("S-0001", "agree", "2026-09-03T01:00:00Z"), // 나중 줄이 앞의 것을 대신한다
    judge("S-0002", "agree", "2026-09-03T00:00:00Z"),
    judge("S-0003", "agree", "2026-09-02T01:00:00Z", "shadow"),
  ]);
  const judged = ops.map((o) => ({ id: o.id, kind: o.kind, human: humanOf(o) }));
  assert.deepEqual(judgeRateOf(judged, marks).jev, { marked: 2, matched: 1, rate: 0.5 });
  assert.equal(JSON.stringify({ gate: gateOf(ops), status: ops.map((o) => o.status) }), before);
  assert.ok(!existsSync(join(STATE, "schedule.jsonl"))); // 판정 계열은 schedule.jsonl에 쓰지 않는다
});

test("쏠림 방지: mark는 SUPERVISOR가 판정한 초안에만 보인다. 열린 초안은 숨기고 수만 센다", () => {
  const ops = fold(lines);
  const marks = marksOf([judge("S-0001", "agree", "2026-09-03T00:00:00Z"), judge("S-0003", "disagree", "2026-09-02T01:00:00Z", "shadow")]);
  const v = judgesViewOf(ops.map((o) => ({ id: o.id, kind: o.kind, human: humanOf(o) })), marks, { jev: "shadow" });
  assert.deepEqual(Object.keys(v.marks), ["S-0001"]);
  assert.equal(v.hidden, 1);
  assert.equal(v.marks["S-0001"][0].family, "jev");
  assert.equal(v.modes.jev, "shadow");
  // shown으로 좁히면 그 초안만
  assert.deepEqual(Object.keys(judgesViewOf(ops.map((o) => ({ id: o.id, kind: o.kind, human: humanOf(o) })), marks, { jev: "shadow" }, new Set(["S-0002"])).marks), []);
});

test("스위치는 SUPERVISOR만: 이 화면 Origin이 없으면 403, 관제 CLI(atcctl)에는 명령이 없다", async () => {
  const { Hono } = await import("hono");
  const { mountSettings } = await import("../settings.ts");
  const app = new Hono();
  mountSettings(app);
  const put = (headers: Record<string, string>, body: unknown) => app.request("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await put({}, { judgesJev: "shadow" })).status, 403);
  assert.deepEqual(loadJudges(), { jev: "off" });
  assert.equal((await put({ Origin: "http://localhost:7700" }, { judgesJev: "on" })).status, 400);
  const ok = await put({ Origin: "http://localhost:7700" }, { judgesJev: "shadow" });
  assert.equal(ok.status, 200);
  const s = await ok.json();
  assert.equal(s.judges.jev.mode, "shadow");
  assert.equal(typeof s.judges.jev.apiKeySet, "boolean");
  assert.ok(!JSON.stringify(s).includes(process.env.TYPESAFE_API_KEY || "\u0000none"));
  assert.deepEqual(loadJudges(), { jev: "shadow" });
  const cli = readFileSync(new URL("../../controller/atcctl.mjs", import.meta.url), "utf8");
  assert.ok(!/judges|\/api\/settings/.test(cli));
});

// ---- DISPATCH(ATC-88) ----
const { dispatchJudgmentOf, dispatchQuestions, dispatchStateOf, dispatchStatsOf, recentEntriesOf, sentOf, levelOf } = await import("./dispatch.ts");
const { dispatchMarksOf } = await import("./store.ts");
const { dispatchTargetsOf, interleave, judgeDispatchOp } = await import("./run.ts");
const { fold: foldProposals, judgesBriefOf } = await import("../proposals.ts");

const dAnswers = (ready: number, prereq: number, score?: number) => ({
  ready: { type: "noul", noul: ready },
  prerequisite: { type: "noul", noul: prereq },
  ...(score === undefined ? {} : { same_area: { type: "score", score, legend: { "1": "a", "2": "b", "3": "c", "4": "d", "5": "e" }, probabilities: {}, confidence: 0.5 } }),
});
const entry = (n: number, over: Record<string, unknown> = {}) =>
  ({ key: `o/r#${n}`, aircraft: "TEAM_J", flight: `ATC-${n}`, airport: "ATCC", arrivedAt: `2026-09-0${n}T00:00:00Z`, ...over }) as unknown as Parameters<typeof recentEntriesOf>[0][number];

test("DISPATCH 질문: Ready·Prerequisite는 Noul, Same area는 Score(최근 FLIGHT가 있을 때만)", () => {
  const q = dispatchQuestions(true) as Record<string, { type: string; criteria: unknown }>;
  assert.deepEqual(Object.keys(q), ["ready", "prerequisite", "same_area"]);
  assert.deepEqual([q.ready.type, q.prerequisite.type, q.same_area.type], ["noul", "noul", "score"]);
  assert.equal((q.same_area.criteria as unknown[]).length, 5);
  assert.deepEqual(Object.keys(dispatchQuestions(false)), ["ready", "prerequisite"]);
});

test("DISPATCH 입력: FLIGHT는 ATC-36 허용 목록, 최근 FLIGHT는 제목만. key·REGISTRATION·댓글은 없다", () => {
  const s = dispatchStateOf({ title: "합성", description: BODY }, false, ["a", "b", "c"]);
  assert.deepEqual(Object.keys(s).sort(), ["recent_flights", "ticket"]);
  assert.ok(!JSON.stringify(s).includes(SECRET_LINE));
  assert.deepEqual(sentOf(s), ["title", "goal", "allowed_scope", "done_criteria", "recent_flights"]);
  const t = dispatchStateOf({ title: "합성", description: BODY }, true, null);
  assert.deepEqual(t, { ticket: { title: "합성", sections: {} } });
  assert.deepEqual(sentOf(t), ["title"]);
});

test("최근 FLIGHT: 마지막 3개가 모두 ATCC의 FLIGHT일 때만. 아니면 묻지 않는다", () => {
  const log = [1, 2, 3, 4].map((n) => entry(n));
  assert.deepEqual(recentEntriesOf(log, "team_j"), { keys: ["ATC-4", "ATC-3", "ATC-2"], why: null });
  assert.match(recentEntriesOf([...log, entry(5, { airport: "VOCA" })], "TEAM_J").why!, /VOCA/);
  assert.match(recentEntriesOf([...log, entry(5, { flight: null })], "TEAM_J").why!, /AD HOC/);
  assert.match(recentEntriesOf(log, "TEAM_K").why!, /지난 FLIGHT가 없음/);
  assert.match(recentEntriesOf(log, null).why!, /AIRCRAFT/);
  // 3개보다 오래된 vocado 줄은 상관없다
  assert.equal(recentEntriesOf([entry(1, { airport: "VOCA" }), entry(2), entry(3), entry(4)], "TEAM_J").why, null);
});

test("DISPATCH 답 검사: score는 legend 범위 안이어야 하고 0~1로 바꾼다", () => {
  const j = dispatchJudgmentOf(dAnswers(0.9, 0.2, 4), true);
  assert.equal(j.ready, 0.9);
  assert.equal(j.sameArea!.level, 0.75);
  assert.equal(dispatchJudgmentOf(dAnswers(0.9, 0.2), false).sameArea, null);
  assert.throws(() => dispatchJudgmentOf(dAnswers(0.9, 0.2), true), JudgeAnswerError);
  assert.throws(() => dispatchJudgmentOf(dAnswers(0.9, 0.2, 9), true), JudgeAnswerError);
  assert.throws(() => dispatchJudgmentOf({ ...dAnswers(0.9, 0.2), ready: { type: "noul", noul: 3 } }, false), JudgeAnswerError);
  assert.equal(levelOf({ score: 0, legend: { "0": "x", "1": "y", "2": "z" } }), 0);
});

const p = (id: string, over: Record<string, unknown> = {}) =>
  ({ op: "create", id, at: "2026-09-10T00:00:00Z", kind: "ASSIGN", flight: "ATC-9", aircraft: "s", aircraftName: "TEAM_J", registration: "TEAM_J", airport: "ATCC", score: 1, factors: [], ...over }) as unknown as Parameters<typeof foldProposals>[0][number];

test("DISPATCH 대상: shadow는 열린 ASSIGN(HOLD 포함), replay는 SUPERVISOR가 판정한 ASSIGN. RELEASE·mark 있는 것은 뺀다", () => {
  const ps = foldProposals([
    p("D-0001"),
    p("D-0002", { at: "2026-09-11T00:00:00Z" }),
    { op: "verdict", id: "D-0002", at: "2026-09-11T01:00:00Z", verdict: "agree", reason: null },
    p("D-0003", { kind: "RELEASE" }),
    p("D-0004", { at: "2026-09-12T00:00:00Z" }),
  ] as Parameters<typeof foldProposals>[0]);
  assert.deepEqual(dispatchTargetsOf(ps, new Map(), "jev", "off"), []);
  assert.deepEqual(dispatchTargetsOf(ps, new Map(), "jev", "shadow").map((x) => x.id), ["D-0001", "D-0004"]);
  assert.deepEqual(dispatchTargetsOf(ps, new Map(), "jev", "replay").map((x) => x.id), ["D-0002"]);
  const marked = dispatchMarksOf([{ op: "judge", family: "jev", target: "dispatch", id: "D-0001" } as never]);
  assert.deepEqual(dispatchTargetsOf(ps, marked, "jev", "shadow", new Set(["D-0004"])), []);
});

test("한도는 CLASSIFY와 DISPATCH가 번갈아 나눠 쓴다", () => {
  assert.deepEqual(interleave(["s1", "s2", "s3"], ["d1", "d2", "d3"], 3).map((x) => ("a" in x ? x.a : x.b)), ["s1", "d1", "s2"]);
  assert.deepEqual(interleave([], ["d1", "d2", "d3", "d4"], 3).map((x) => ("a" in x ? x.a : x.b)), ["d1", "d2", "d3"]);
});

test("stub으로 ASSIGN 하나: 최근 FLIGHT 제목을 보내고, 보낸 것·안 보낸 것을 기록한다. SEC는 제목만", async () => {
  const engine = stubEngine({ "합성 티켓": dAnswers(0.9, 0.1, 5) });
  let reads = 0;
  const read = async () => (reads++, { title: "합성 티켓", description: BODY });
  const titleOf = async (k: string) => `제목 ${k}`;
  const line = (await judgeDispatchOp({ id: "D-0001", flight: "SYN-1" }, { title: "합성 티켓", labels: [] }, read, { keys: ["ATC-1", "ATC-2"], why: null }, titleOf, engine, "jev", "shadow", "2026-09-01T00:00:00Z"))!;
  assert.equal(line.target, "dispatch");
  assert.equal(line.judgment.sameArea!.level, 1);
  assert.deepEqual(line.sent, ["title", "goal", "allowed_scope", "done_criteria", "recent_flights"]);
  assert.equal(line.withheld, null);
  const call = engine.calls[0];
  assert.deepEqual(call.state.recent_flights, ["제목 ATC-1", "제목 ATC-2"]);
  assert.ok(!JSON.stringify(call.state).includes("SYN-1") && !JSON.stringify(call.state).includes("TEAM_J") && !JSON.stringify(call.state).includes(SECRET_LINE));
  // SEC: 본문을 읽지도 않는다. 최근 FLIGHT를 못 보내면 Same area를 묻지 않는다
  const sec = (await judgeDispatchOp({ id: "D-0002", flight: "SYN-2" }, { title: "합성 보안", labels: ["Risk: Security"] }, read, { keys: [], why: "AD HOC이 섞임" }, titleOf, engine, "jev", "shadow", "2026-09-01T00:00:00Z"))!;
  assert.equal(reads, 1);
  assert.deepEqual(sec.sent, ["title"]);
  assert.match(sec.withheld!, /Risk/);
  assert.equal(sec.recentWithheld, "AD HOC이 섞임");
  assert.equal(sec.judgment.sameArea, null);
  assert.deepEqual(Object.keys(engine.calls[1].questions), ["ready", "prerequisite"]);
  // 제목을 모르는 지난 FLIGHT가 있으면 묻지 않는다
  const unk = (await judgeDispatchOp({ id: "D-0003", flight: "SYN-3" }, { title: "합성", labels: [] }, read, { keys: ["ATC-1"], why: null }, async () => null, engine, "jev", "shadow", "2026-09-01T00:00:00Z"))!;
  assert.equal(unk.judgment.sameArea, null);
  assert.match(unk.recentWithheld!, /제목/);
  // 라벨을 모르면 제목만
  const nolabel = (await judgeDispatchOp({ id: "D-0004", flight: "SYN-4" }, null, async () => ({ title: "x", description: BODY }), { keys: [], why: "x" }, titleOf, engine, "jev", "shadow", "2026-09-01T00:00:00Z"))!;
  assert.equal(nolabel, null); // 제목도 모름 → 판정 안 함
});

test("게이트 통계: Ready=no↔거절, Prerequisite=yes↔waiting-on-prior·OCC HOLD, Same area 가까움↔승인", () => {
  const h = (verdict: "agree" | "disagree") => ({ verdict, at: "t", reason: null });
  const j = (ready: number, prereq: number, level: number | null) => ({ ready, prerequisite: prereq, sameArea: level === null ? null : { score: 1, level, confidence: null } });
  const st = dispatchStatsOf([
    { id: "a", judgment: j(0.2, 0.1, 0.9), human: h("disagree"), codes: [], occHold: false }, // ready no → 거절 ✓, near → 승인 ✗
    { id: "b", judgment: j(0.1, 0.1, 0.9), human: h("agree"), codes: [], occHold: false }, // ready no → 거절 ✗, near → 승인 ✓
    { id: "c", judgment: j(0.9, 0.8, null), human: h("disagree"), codes: ["waiting-on-prior"], occHold: false }, // prereq ✓
    { id: "d", judgment: j(0.9, 0.8, null), human: null, codes: [], occHold: true }, // 판정 없이 OCC HOLD ✓
    { id: "e", judgment: j(0.9, 0.9, null), human: h("agree"), codes: [], occHold: false }, // prereq ✗
    { id: "f", judgment: j(0.1, 0.1, null), human: null, codes: [], occHold: false }, // 결과 없음 → 세지 않음
  ]);
  assert.deepEqual(st.ready, { marked: 2, matched: 1, rate: 0.5 });
  assert.deepEqual(st.prerequisite, { marked: 3, matched: 2, rate: 2 / 3 });
  assert.deepEqual(st.sameArea, { marked: 2, matched: 1, rate: 0.5 });
  assert.equal(st.judged, 6);
  assert.deepEqual(dispatchStatsOf([]).ready, { marked: 0, matched: 0, rate: null });
});

test("쏠림 방지: mark는 닫힌 제안(RECENT)에만 싣는다. 열린 제안은 수만 센다. proposals는 그대로", () => {
  const ps = foldProposals([p("D-0001"), p("D-0002", { at: "2026-09-11T00:00:00Z" }), { op: "verdict", id: "D-0002", at: "2026-09-11T01:00:00Z", verdict: "agree", reason: null }] as Parameters<typeof foldProposals>[0]);
  const before = JSON.stringify(ps);
  const line = (id: string) => ({ op: "judge", family: "jev", target: "dispatch", id, flight: "ATC-9", at: "t", run: "shadow", engine: "stub", model: "stub", judgment: dispatchJudgmentOf(dAnswers(0.9, 0.1, 3), true), withheld: null, recentWithheld: null, sent: ["title"] }) as never;
  const view = judgesBriefOf(ps, [ps[1]], dispatchMarksOf([line("D-0001"), line("D-0002")]), "shadow");
  assert.deepEqual(Object.keys(view.marks), ["D-0002"]);
  assert.equal(view.hidden, 1);
  assert.equal(view.marks["D-0002"][0].ready, 0.9);
  assert.equal(view.stats.judged, 2);
  assert.equal(JSON.stringify(ps), before);
  assert.ok(!existsSync(join(STATE, "proposals.jsonl"))); // 판정 계열은 proposals.jsonl에 쓰지 않는다
});
