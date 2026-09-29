import assert from "node:assert/strict";
import { test } from "node:test";
import { type PriceTable, parsePriceTable } from "./fuel-cost.ts";
import { type FuelRecord, summarizeFuel, utcDay } from "./fuel.ts";

// ATC-137: /api/fuel의 byDay·byModel. 같은 패스에서 셈한다
const TABLE = parsePriceTable({
  writeMult: { "5m": 1.25, "1h": 2 },
  multipliers: {},
  models: { "m-opus": { in: 4, out: 20, readMult: 0.05 } },
}) as PriceTable;
const M = 1_000_000;
const NOW = Date.parse("2026-09-28T12:00:00Z");
const rec = (o: Partial<FuelRecord>): FuelRecord => ({
  key: Math.random().toString(36), session: "s1", sidechain: false, agent: null, t: "2026-09-28T10:00:00Z", model: "m-opus",
  input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, stopReason: "end_turn", version: null, effort: null, speed: "standard", geo: null, ...o,
});
const run = (records: FuelRecord[], days = 3) => summarizeFuel({ records, prices: TABLE, now: NOW, days });

test("utcDay: Z 시각은 앞 10자, 다른 꼴은 UTC로 바꿔 읽는다", () => {
  assert.equal(utcDay("2026-09-28T23:59:59.999Z"), "2026-09-28");
  assert.equal(utcDay("2026-09-29T00:00:00Z"), "2026-09-29");
  assert.equal(utcDay("2026-09-29T08:30:00+09:00"), "2026-09-28"); // UTC로는 전날
});

test("byDay: UTC 날짜 경계(23:59:59와 00:00:00)는 다른 날, 오래된 날부터", () => {
  const s = run([
    rec({ t: "2026-09-27T23:59:59Z", input: M }), // $4
    rec({ t: "2026-09-28T00:00:00Z", input: M }), // $4
    rec({ t: "2026-09-27T00:00:00Z", output: M }), // $20
  ]);
  assert.deepEqual(s.byDay.map((d) => d.day), ["2026-09-27", "2026-09-28"]);
  assert.equal(s.byDay[0].captain, 24);
  assert.equal(s.byDay[1].captain, 4);
  assert.deepEqual(s.byDay.map((d) => d.requests), [2, 1]);
});

test("byDay: CAPTAIN과 CREW를 나눠 센다", () => {
  const s = run([rec({ input: M }), rec({ sidechain: true, agent: "a1", input: 2 * M }), rec({ sidechain: true, agent: "a1", output: M })]);
  assert.equal(s.byDay.length, 1);
  assert.equal(s.byDay[0].captain, 4);
  assert.equal(s.byDay[0].crew, 28); // 8 + 20
  assert.equal(s.byDay[0].requests, 3);
  // 합은 totals와 같다
  assert.equal(s.byDay[0].captain + s.byDay[0].crew, s.totals.total.cost.total);
});

test("byDay: 값 없는 모델은 비용에 들지 않고 unpricedTokens에 든다(0이 아니라 따로)", () => {
  const s = run([rec({ input: M }), rec({ model: "m-unknown", input: 3 * M, output: M, t: "2026-09-27T05:00:00Z" })]);
  const d = Object.fromEntries(s.byDay.map((x) => [x.day, x]));
  assert.equal(d["2026-09-27"].captain, 0);
  assert.equal(d["2026-09-27"].unpricedTokens, 4 * M);
  assert.equal(d["2026-09-28"].captain, 4);
  assert.equal(d["2026-09-28"].unpricedTokens, 0);
  assert.equal(s.totals.total.unpriced.tokens, 4 * M);
});

test("byDay: 기간 밖 기록은 빼고, 비어 있으면 빈 배열", () => {
  const old = rec({ t: "2026-09-20T10:00:00Z", input: M });
  assert.deepEqual(run([old]).byDay, []);
  assert.deepEqual(run([]).byDay, []);
  assert.deepEqual(run([]).byModel, []);
  assert.equal(run([old, rec({ input: M })]).byDay.length, 1);
});

test("byModel: 모델마다 요청·토큰·비용, 비용이 큰 순서, 값 없는 모델은 토큰과 unpriced만", () => {
  const s = run([
    rec({ input: M }), // opus $4
    rec({ output: M }), // opus $20
    rec({ model: "m-b", input: 5 * M }),
    rec({ model: "m-b", input: M }),
  ]);
  assert.deepEqual(s.byModel.map((m) => m.model), ["m-opus", "m-b"]);
  const [opus, b] = s.byModel;
  assert.deepEqual([opus.requests, opus.tokens, opus.cost, opus.unpricedRequests], [2, 2 * M, 24, 0]);
  assert.deepEqual([b.requests, b.tokens, b.cost, b.unpricedRequests, b.unpricedTokens], [2, 6 * M, 0, 2, 6 * M]);
});

test("byDay·byModel은 기존 필드를 바꾸지 않는다(더하기만)", () => {
  const s = run([rec({ input: M }), rec({ sidechain: true, agent: "a", output: M })]);
  assert.equal(s.requests, 2);
  assert.equal(s.totals.captain.cost.total, 4);
  assert.equal(s.totals.crew.cost.total, 20);
  assert.deepEqual(s.models, { "m-opus": 2 });
});
