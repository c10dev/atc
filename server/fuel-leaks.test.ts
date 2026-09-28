import assert from "node:assert/strict";
import { test } from "node:test";
import { type FuelRecord, summarizeFuel } from "./fuel.ts";
import { parsePriceTable } from "./fuel-cost.ts";
import { controlSendsOf, findLeaks, rewrittenOf, sessionLeaks, ttlAfter, TTL_1H_MS, TTL_5M_MS, unitsOf } from "./fuel-leaks.ts";

// F3 시험용 가격표(값은 시험 데이터). Sonnet은 일부러 빼서 값 없는 모델을 본다
const TABLE = parsePriceTable({
  writeMult: { "5m": 1.25, "1h": 2 },
  models: { "claude-opus-5-5": { in: 4, out: 20, readMult: 0.05 }, "claude-fable-5-1": { in: 10, out: 50, readMult: 0.025 } },
});

const S = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-09-28T08:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

// 실제 CAPTAIN 요청 모양: 입력 2토큰, 새 메시지만 1h로 쓰고 나머지는 읽는다
function req(min: number, o: Partial<FuelRecord> = {}): FuelRecord {
  return {
    key: `k${min}${o.model ?? ""}`,
    session: S,
    sidechain: false,
    agent: null,
    t: at(min),
    model: "claude-opus-5-5",
    input: 2,
    cacheWrite5m: 0,
    cacheWrite1h: 3_000,
    cacheRead: 100_000,
    output: 500,
    stopReason: "tool_use",
    version: "2.1.281",
    effort: "high",
    speed: "standard",
    geo: null,
    ...o,
  };
}
// 캐시가 식어 맥락 전체를 다시 쓴 요청
const cold = (min: number, o: Partial<FuelRecord> = {}) => req(min, { cacheWrite1h: 104_000, cacheRead: 2_000, ...o });

test("따뜻한 요청은 leak이 아니다(간격이 TTL 안이고 앞 맥락을 읽었다)", () => {
  assert.equal(rewrittenOf(req(0), req(2, { cacheRead: 103_000 })), 0);
  assert.deepEqual(sessionLeaks([req(0), req(2, { cacheRead: 103_000 }), req(50, { cacheRead: 106_000 })], [], []), []);
});

test("miss 기준: 캐시에서 읽을 수 있던 것의 5 %를 넘고 2,000 토큰 이상", () => {
  const prev = req(0); // 읽을 수 있던 것 103,000
  assert.equal(rewrittenOf(prev, req(1, { cacheRead: 101_001, cacheWrite1h: 5_000 })), 0); // 1,999
  assert.equal(rewrittenOf(prev, req(1, { cacheRead: 98_000, cacheWrite1h: 8_000 })), 0); // 5,000 ≤ 5 %(5,150)
  assert.equal(rewrittenOf(prev, req(1, { cacheRead: 97_000, cacheWrite1h: 9_000 })), 6_000);
  const small = req(0, { cacheWrite1h: 1_000, cacheRead: 30_000 }); // 31,000의 5 % = 1,550 → 2,000이 기준
  assert.equal(rewrittenOf(small, req(1, { cacheRead: 29_100, cacheWrite1h: 3_000 })), 0);
  const big = req(0, { cacheRead: 900_000, cacheWrite1h: 0 }); // 5 % = 45,000
  assert.equal(rewrittenOf(big, req(1, { cacheRead: 860_000, cacheWrite1h: 44_000 })), 0);
  assert.equal(rewrittenOf(big, req(1, { cacheRead: 850_000, cacheWrite1h: 54_000 })), 50_000);
});

test("COLD CACHE(HOLD): 1h로 쓴 세션이 1시간 넘게 쉬고 다시 쓰면 coldCache", () => {
  const [e] = sessionLeaks([req(0), cold(70)], [], []);
  assert.equal(e.rule, "coldCache");
  assert.equal(e.rewritten, 101_000);
  assert.equal(e.gapMs, 70 * 60_000);
  assert.equal(e.wake, null);
  // 1시간 안이면 같은 miss라도 COLD CACHE가 아니다
  assert.equal(sessionLeaks([req(0), cold(50)], [], [])[0].rule, "unexplained");
});

test("COLD CACHE(HOLD): 5m으로만 쓴 세션은 5분이 TTL", () => {
  const w5 = { cacheWrite5m: 3_000, cacheWrite1h: 0 };
  assert.equal(sessionLeaks([req(0, w5), cold(6, { cacheWrite5m: 104_000, cacheWrite1h: 0 })], [], [])[0].rule, "coldCache");
  assert.equal(sessionLeaks([req(0, w5), cold(4, { cacheWrite5m: 104_000, cacheWrite1h: 0 })], [], [])[0].rule, "unexplained");
});

test("TTL: 읽기만 한 요청은 앞서 쓴 층을 이어 간다", () => {
  assert.equal(ttlAfter(req(0), null), TTL_1H_MS);
  assert.equal(ttlAfter(req(0, { cacheWrite1h: 0, cacheWrite5m: 10 }), TTL_1H_MS), TTL_5M_MS);
  assert.equal(ttlAfter(req(0, { cacheWrite1h: 0 }), TTL_1H_MS), TTL_1H_MS);
  // 1h로 쓴 뒤 읽기만 한 요청 다음 40분 쉼: 아직 1h 안이라 COLD CACHE가 아니다
  const rs = sessionLeaks([req(0), req(1, { cacheWrite1h: 0, cacheRead: 103_000 }), cold(41)], [], []);
  assert.equal(rs[0].rule, "unexplained");
});

test("COLD CACHE(control wake): 쉬는 사이에 atc가 보낸 CLEARANCE가 깨웠으면 controlWake", () => {
  const sends = controlSendsOf({ clearances: [{ at: at(69), to: S, toName: "TEAM_J" }] });
  const [e] = sessionLeaks([req(0), cold(70)], [], sends);
  assert.equal(e.rule, "controlWake");
  assert.equal(e.wake, "CLEARANCE");
  // 쉬기 전이나 깨어난 뒤의 발신은 깨운 것이 아니다
  const outside = controlSendsOf({ clearances: [{ at: at(-1), to: S, toName: "TEAM_J" }, { at: at(71), to: S, toName: "TEAM_J" }] });
  assert.equal(sessionLeaks([req(0), cold(70)], [], outside)[0].rule, "coldCache");
});

test("control wake: 받는 세션을 이름(REGISTRATION)으로도 맞추고, 다른 세션 발신은 무시한다", () => {
  const sends = controlSendsOf({ crewChanges: [{ registration: "TEAM_J", sentAt: at(65) }, { registration: "TEAM_K", sentAt: at(66) }] });
  const [e] = findLeaks([req(0), cold(70)], [], sends, new Map([[S, "team_j"]]));
  assert.equal(e.rule, "controlWake");
  assert.equal(e.wake, "CREW CHANGE");
  assert.equal(findLeaks([req(0), cold(70)], [], sends, new Map([[S, "TEAM_X"]]))[0].rule, "coldCache");
});

test("controlSendsOf: CLEARANCE는 기록 시각, FLIGHT PLAN은 send, RECALL은 요청 시각, CREW CHANGE는 sent", () => {
  const out = controlSendsOf({
    clearances: [{ at: "t1", to: S, toName: "TEAM_J" }],
    proposals: [
      { aircraft: S, aircraftName: "TEAM_J", timeline: { proposed: "t0", sent: "t2", recalling: "t3" } },
      { aircraft: S, aircraftName: "TEAM_J", timeline: { proposed: "t0" } },
    ],
    crewChanges: [{ registration: "TEAM_J", sentAt: "t4" }, { registration: "TEAM_J", sentAt: null }],
  });
  assert.deepEqual(
    out.map((s) => [s.kind, s.at, s.session, s.name]),
    [
      ["CLEARANCE", "t1", S, "TEAM_J"],
      ["FLIGHT PLAN", "t2", S, "TEAM_J"],
      ["RECALL", "t3", S, "TEAM_J"],
      ["CREW CHANGE", "t4", null, "TEAM_J"],
    ],
  );
});

test("MODEL SWITCH: 이어진 CAPTAIN 요청의 모델이 바뀌고 miss면 modelSwitch(쉰 시간과 상관없이)", () => {
  const sonnet = { model: "claude-sonnet-5" };
  const [e] = sessionLeaks([req(0), cold(2, sonnet)], [], [], TABLE);
  assert.equal(e.rule, "modelSwitch");
  assert.equal(e.prevModel, "claude-opus-5-5");
  assert.equal(e.model, "claude-sonnet-5");
  assert.equal(e.units, null); // 읽기 배수가 표에 없는 모델은 값을 매기지 않는다
  assert.equal(sessionLeaks([req(0), cold(90, sonnet)], [], [])[0].rule, "modelSwitch");
  // 모델이 바뀌어도 miss가 아니면(작은 옆 요청, 돌아왔는데 캐시가 따뜻함) leak이 아니다
  assert.deepEqual(sessionLeaks([req(0), req(1, { ...sonnet, cacheWrite1h: 1_500, cacheRead: 0 }), req(2, { cacheRead: 103_000 })], [], []), []);
});

test("compaction 뒤 다시 짓기는 F7로 넘긴다(expectedRebuild, LEAK에 넣지 않음)", () => {
  const events = sessionLeaks([req(0), cold(70, { cacheWrite1h: 20_000, cacheRead: 0 })], [at(69)], []);
  assert.equal(events[0].rule, "expectedRebuild");
  const s = summarizeFuel({ records: [req(0), cold(70)], leaks: events, now: T0 + 2 * 3_600_000, days: 1 });
  assert.equal(s.totals.leak.total.count, 0);
  assert.equal(s.totals.leak.unexplained.count, 0);
  assert.equal(s.totals.leak.expectedRebuild.count, 1);
  assert.equal(s.totals.leak.expectedRebuild.tokens, 20_002); // 입력 2토큰까지(맥락 전체보다 작다)
  assert.deepEqual(s.leakEvents, []);
});

test("첫 요청과 CREW 요청은 판단하지 않는다(SESSION CHANGE·CREW 경고는 F7)", () => {
  assert.deepEqual(findLeaks([cold(0)], [], []), []);
  const crew = (min: number, o: Partial<FuelRecord> = {}) => ({ ...req(min, o), sidechain: true, agent: "a1", key: `c${min}` });
  assert.deepEqual(findLeaks([crew(0), crew(70, { cacheWrite1h: 104_000, cacheRead: 0 })], [], []), []);
  // CREW 요청이 사이에 끼어도 CAPTAIN끼리 비교한다
  assert.deepEqual(findLeaks([req(0), crew(1, { cacheRead: 0, cacheWrite5m: 50_000 }), req(2, { cacheRead: 103_000 })], [], []), []);
});

test("단위: rewritten × (writeMult − readMult) — Opus 5.5 1h 쓰기는 2 − 0.05", () => {
  assert.equal(unitsOf(100_000, req(0), TABLE), 195_000);
  assert.equal(unitsOf(100_000, req(0, { cacheWrite1h: 0, cacheWrite5m: 1 }), TABLE), 120_000);
  assert.equal(unitsOf(100_000, req(0, { model: "claude-fable-5-1" }), TABLE), 197_500);
  assert.equal(unitsOf(100_000, req(0, { model: "deepseek-v4.1-flash" }), TABLE), null);
  assert.equal(unitsOf(100_000, req(0), null), null); // 가격표가 없으면 값 없음
});

test("summarizeFuel: 세션·AIRCRAFT·전체로 규칙별 LEAK를 모으고, 큰 사건 순서로 준다", () => {
  const S2 = "22222222-2222-4222-8222-222222222222";
  const other = (min: number, o: Partial<FuelRecord> = {}) => ({ ...req(min, o), session: S2, key: `o${min}` });
  const records = [req(0), cold(70), req(71, { cacheRead: 107_000 }), cold(80, { model: "claude-sonnet-5" }), other(0), other(10, { cacheWrite1h: 53_000, cacheRead: 50_000 })];
  const leaks = findLeaks(records, [], controlSendsOf({ clearances: [{ at: at(60), to: S, toName: "TEAM_J" }] }), new Map(), TABLE);
  assert.deepEqual(
    leaks.map((e) => [e.session === S ? "S" : "S2", e.rule]),
    [
      ["S2", "unexplained"],
      ["S", "controlWake"],
      ["S", "modelSwitch"],
    ],
  );
  const s = summarizeFuel({ records, leaks, names: new Map([[S, "TEAM_J"], [S2, "team_j"]]), now: T0 + 2 * 3_600_000, days: 1 });
  const j = s.sessions.find((x) => x.session === S)!;
  assert.equal(j.leak.controlWake.count, 1);
  assert.equal(j.leak.controlWake.tokens, 101_000);
  assert.equal(j.leak.controlWake.units, 196_950);
  assert.equal(j.leak.modelSwitch.count, 1);
  assert.equal(j.leak.modelSwitch.unpricedTokens, 104_002);
  assert.equal(j.leak.total.count, 2);
  assert.equal(s.aircraft[0].leak.total.count, 3);
  assert.equal(s.aircraft[0].leak.unexplained.tokens, 53_000);
  assert.equal(s.totals.leak.total.tokens, 101_000 + 104_002 + 53_000);
  assert.deepEqual(
    s.leakEvents.map((e) => [e.rule, e.rewritten, e.name]),
    [
      ["modelSwitch", 104_002, "TEAM_J"],
      ["controlWake", 101_000, "TEAM_J"],
      ["unexplained", 53_000, "team_j"],
    ],
  );
  // 기간 밖 사건은 빠진다
  assert.equal(summarizeFuel({ records, leaks, now: T0 + 30 * 3_600_000, days: 1 }).totals.leak.total.count, 0);
});
