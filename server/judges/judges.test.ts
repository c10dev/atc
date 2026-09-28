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
