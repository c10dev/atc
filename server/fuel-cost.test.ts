import assert from "node:assert/strict";
import { test } from "node:test";
import { costOf, leakPriceOf, mergePriceTables, modelPriceOf, parsePriceTable, type PriceTable, rateOf } from "./fuel-cost.ts";
import { findLeaks } from "./fuel-leaks.ts";
import { type FuelRecord, summarizeFuel } from "./fuel.ts";

// 시험용 가격표. 값은 시험 데이터일 뿐, 실제 가격은 server/fuel-prices.json에 있다
const TABLE = parsePriceTable({
  writeMult: { "5m": 1.25, "1h": 2 },
  multipliers: { "inferenceGeo:us": 1.1 },
  models: {
    "m-opus": { in: 4, out: 20, readMult: 0.05, multipliers: { "speed:fast": 2 } },
    "m-haiku": { in: 1, out: 5, readMult: 0.1 },
  },
}) as PriceTable;
const M = 1_000_000;
const k = (o: Partial<FuelRecord> = {}) => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, ...o });
const priced = (model: string, speed: string | null = "standard", geo: string | null = "not_available") => {
  const r = rateOf(TABLE, { model, speed, geo });
  assert.ok("rate" in r, JSON.stringify(r));
  return r.rate;
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("costOf: 다섯 가지를 각각 — input·P_in, 5m·1.25·P_in, 1h·2·P_in, read·readMult·P_in, output·P_out", () => {
  const r = priced("m-opus");
  near(costOf(k({ input: M }), r).total, 4);
  near(costOf(k({ cacheWrite5m: M }), r).total, 5);
  near(costOf(k({ cacheWrite1h: M }), r).total, 8);
  near(costOf(k({ cacheRead: M }), r).total, 0.2);
  near(costOf(k({ output: M }), r).total, 20);
  const all = costOf(k({ input: M, cacheWrite5m: M, cacheWrite1h: M, cacheRead: M, output: M }), r);
  near(all.cacheWrite1h, 8);
  near(all.total, 4 + 5 + 8 + 0.2 + 20);
});

test("rateOf: 가격표에 없는 모델은 값을 매기지 않고, 비슷한 이름으로 짐작하지 않는다", () => {
  assert.deepEqual(rateOf(TABLE, { model: "deepseek-v4.1-flash", speed: null, geo: null }), { unpriced: "no price for model" });
  assert.equal(modelPriceOf(TABLE, "m-opus-2"), null);
  assert.equal(modelPriceOf(TABLE, "m-opu"), null);
  // 날짜만 붙은 이름은 같은 모델
  assert.equal(modelPriceOf(TABLE, "m-haiku-20251001")?.in, 1);
  assert.deepEqual(rateOf(parsePriceTable({ models: { x: { in: 1, out: 1, readMult: 0.1 } } })!, { model: "x", speed: null, geo: null }), {
    unpriced: "no writeMult in price table",
  });
});

test("배수: fast 모드는 그 모델에 적힌 배수, 없으면 값 없음. inferenceGeo는 표에 있을 때만", () => {
  near(costOf(k({ input: M, output: M }), priced("m-opus", "fast")).total, 48);
  assert.deepEqual(rateOf(TABLE, { model: "m-haiku", speed: "fast", geo: null }), { unpriced: "no price for speed:fast" });
  near(costOf(k({ input: M }), priced("m-haiku", "standard", "us")).total, 1.1);
  near(costOf(k({ input: M }), priced("m-haiku", null, "global")).total, 1);
  near(costOf(k({ input: M }), priced("m-opus", "fast", "us")).total, 8.8);
});

test("parsePriceTable: 잘못된 항목은 빼고 errors에, mergePriceTables는 뒤 표가 모델 단위로 덮는다", () => {
  const errors: string[] = [];
  const t = parsePriceTable({ writeMult: { "5m": 1.25, "1h": "2" }, models: { a: { in: 1, out: 2, readMult: 0.1 }, b: { in: "1", out: 2 } } }, errors)!;
  assert.deepEqual(Object.keys(t.models), ["a"]);
  assert.deepEqual(errors, ["writeMult.1h: 숫자가 아님", "models.b: in·out·readMult가 숫자가 아님"]);
  assert.equal(parsePriceTable("x"), null);
  const over = parsePriceTable({ source: "local", models: { "m-haiku": { in: 2, out: 6, readMult: 0.1 }, "m-new": { in: 1, out: 1, readMult: 0.1 } } });
  const m = mergePriceTables(TABLE, over, null);
  assert.equal(m.source, "local");
  assert.equal(m.models["m-haiku"].in, 2);
  assert.equal(m.models["m-opus"].in, 4);
  assert.ok(m.models["m-new"]);
  assert.deepEqual(m.writeMult, { "5m": 1.25, "1h": 2 });
  assert.equal(m.multipliers["inferenceGeo:us"], 1.1);
});

test("leakPriceOf: F3의 rewritten × (writeMult − readMult)가 같은 표에서, 값 없는 모델은 null", () => {
  const r = { model: "m-opus", speed: "standard", geo: null, cacheWrite1h: 5 };
  assert.deepEqual(leakPriceOf(M, r, TABLE), { units: 1_950_000, cost: 7.8 });
  const five = leakPriceOf(M, { ...r, cacheWrite1h: 0 }, TABLE)!;
  assert.equal(five.units, 1_200_000);
  near(five.cost, 4.8);
  assert.equal(leakPriceOf(M, { ...r, model: "other" }, TABLE), null);
  assert.equal(leakPriceOf(M, r, null), null);
});

const S = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-09-28T08:00:00Z");
function rec(min: number, o: Partial<FuelRecord> = {}): FuelRecord {
  return {
    key: `k${min}`,
    session: S,
    sidechain: false,
    agent: null,
    t: new Date(T0 + min * 60_000).toISOString(),
    model: "m-opus",
    input: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0,
    stopReason: "end_turn",
    version: null,
    effort: null,
    speed: "standard",
    geo: null,
    ...o,
  };
}

test("summarizeFuel: 토큰 옆에 비용, 값 없는 모델은 경고로. NET은 LEAK가 없으면 비용과 같다", () => {
  const records = [rec(0, { cacheWrite1h: M }), rec(1, { output: M, sidechain: true, agent: "a" }), rec(2, { model: "deepseek-v4.1-flash", input: 500 })];
  const s = summarizeFuel({ records, prices: TABLE, names: new Map([[S, "TEAM_J"]]), now: T0 + 3_600_000, days: 1 });
  assert.equal(s.totals.captain.cost.cacheWrite1h, 8);
  assert.equal(s.totals.crew.cost.output, 20);
  assert.equal(s.totals.total.cost.total, 28);
  assert.deepEqual(s.totals.total.unpriced, { requests: 1, tokens: 500 });
  assert.equal(s.totals.netCost, 28);
  assert.equal(s.sessions[0].netCost, 28);
  assert.equal(s.aircraft[0].netCost, 28);
  assert.deepEqual(s.priceWarnings, [{ model: "deepseek-v4.1-flash", reason: "no price for model", requests: 1, tokens: 500 }]);
});

test("NET FUEL = 비용 − 값이 매겨진 LEAK(F3). 값 없는 LEAK는 빼지 않는다", () => {
  const warm = rec(0, { cacheWrite1h: 3_000, cacheRead: 100_000 });
  const cold = rec(70, { cacheWrite1h: 103_000, cacheRead: 0 });
  const records = [warm, cold];
  const leaks = findLeaks(records, [], [], new Map(), TABLE);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].rule, "coldCache");
  const s = summarizeFuel({ records, leaks, prices: TABLE, now: T0 + 2 * 3_600_000, days: 1 });
  const cost = (106_000 * 8 + 100_000 * 0.2) / M;
  const leak = (103_000 * 1.95 * 4) / M;
  near(s.totals.total.cost.total, Math.round(cost * 10_000) / 10_000);
  near(s.totals.leak.total.cost, Math.round(leak * 10_000) / 10_000);
  near(s.totals.netCost, Math.round((cost - leak) * 10_000) / 10_000);
  near(s.leakEvents[0].cost!, Math.round(leak * 10_000) / 10_000);
  // 가격표에 없는 모델의 LEAK는 unpricedTokens로만 남고 NET에서 빼지 않는다
  const other = records.map((r) => ({ ...r, model: "other" }));
  const u = summarizeFuel({ records: other, leaks: findLeaks(other, [], [], new Map(), TABLE), prices: TABLE, now: T0 + 2 * 3_600_000, days: 1 });
  assert.equal(u.totals.leak.total.count, 1);
  assert.equal(u.totals.leak.total.unpricedTokens, 103_000);
  assert.equal(u.totals.netCost, 0);
});
