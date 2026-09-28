import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlightCost, PriceTable } from "./fuel-cost.ts";
import type { FuelRecord } from "./fuel.ts";
import type { FlightFuel } from "./fuel-flights.ts";
import type { LeakEvent } from "./fuel-leaks.ts";
import { MEDIAN_MIN_SAMPLES } from "./logbook.ts";
import {
  coldCachesOf,
  fleetFuelLabel,
  fleetFuelOf,
  generationOf,
  largeLeaksOf,
  type PricedEntry,
  quantile,
  TRIP_FUEL_MIN_SAMPLES,
  tripCheckOf,
  tripFuelOf,
  tripLabel,
} from "./fuel-view.ts";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const burn = (over: Partial<FlightFuel["captain"]> = {}) => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, requests: 1, cacheHit: null, ...over });
const bucket = (count = 0, tokens = 0) => ({ count, tokens, units: 0, unpricedTokens: 0 });
const fuel = (over: Partial<FlightFuel> = {}): FlightFuel => ({
  captain: burn({ cacheRead: 900, cacheWrite1h: 100 }),
  crew: { ...burn({ cacheRead: 50, cacheWrite5m: 50 }), outputLowerBound: true },
  cacheHit: null,
  models: { "claude-opus-5-5": 10 },
  ...over,
});
const cost = (total: number, net: number, crew = 0): FlightCost => {
  const c = (t: number) => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: t, total: t });
  return { captain: c(total - crew), crew: c(crew), total: c(total), leakCost: Math.round((total - net) * 10_000) / 10_000, netCost: net, unpriced: [] };
};

let seq = 0;
const entry = (over: Partial<PricedEntry> & { net?: number | null; type?: string; wake?: string } = {}): PricedEntry => {
  const { net, type = "BUILD", wake = "M", ...rest } = over;
  seq++;
  return {
    key: `o/atc#${seq}`,
    aircraft: "TEAM_J",
    flight: `ATC-${seq}`,
    class: { type: type as never, wake: wake as never, ratings: [], explicit: { type: true, wake: true } } as never,
    airport: "ATCC",
    pr: { repo: "o/atc", number: seq, url: "u", title: "t" },
    stands: [],
    departedAt: at(2),
    departedFrom: "departure",
    arrivedAt: at(1),
    blockMin: 60,
    landingWaitMin: 5,
    codexFindings: 0,
    changesRequested: false,
    reverted: false,
    los: 0,
    ...(net === undefined ? {} : net === null ? { fuel: fuel(), fuelCost: null } : { fuel: fuel(), fuelCost: cost(net + 1, net) }),
    ...rest,
  };
};

test("TRIP_FUEL_MIN_SAMPLES는 LOGBOOK의 MEDIAN_MIN_SAMPLES와 같다", () => {
  assert.equal(TRIP_FUEL_MIN_SAMPLES, MEDIAN_MIN_SAMPLES);
});

test("quantile: 선형 보간, p50은 중앙값", () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([4], 0.9), 4);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10, 1, 5], 0.5), 5);
  assert.ok(Math.abs(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)! - 9.1) < 1e-9);
});

test("tripFuelOf: TYPE×WAKE에 표본이 충분하면 그 단계의 p50–p90", () => {
  const es = [2, 4, 6, 8].map((net) => entry({ net }));
  const t = tripFuelOf({ class: { type: "BUILD", wake: "M" }, airport: "ATCC" }, es, NOW);
  assert.equal(t.level, "TYPE×WAKE");
  assert.equal(t.group, "BUILD·M");
  assert.equal(t.samples, 4);
  assert.equal(t.p50, 5);
  assert.equal(t.p90, 7.4);
  assert.equal(tripLabel(t), "TRIP FUEL $5.00–$7.40 · TYPE×WAKE BUILD·M (4)");
});

test("tripFuelOf: 모자라면 WAKE, 그다음 AIRPORT로 넓힌다", () => {
  const wake = [entry({ net: 1 }), entry({ net: 2, type: "CHECK" }), entry({ net: 3, type: "CHECK" })];
  let t = tripFuelOf({ class: { type: "BUILD", wake: "M" }, airport: "ATCC" }, wake, NOW);
  assert.equal(t.level, "WAKE");
  assert.equal(t.group, "M");
  assert.equal(t.samples, 3);
  const apt = [entry({ net: 1 }), entry({ net: 2, wake: "L" }), entry({ net: 3, wake: "H" })];
  t = tripFuelOf({ class: { type: "BUILD", wake: "M" }, airport: "ATCC" }, apt, NOW);
  assert.equal(t.level, "AIRPORT");
  assert.equal(t.group, "ATCC");
  // AD HOC(분류 없음)은 AIRPORT부터
  t = tripFuelOf({ class: null, airport: "ATCC" }, apt, NOW);
  assert.equal(t.level, "AIRPORT");
});

test("tripFuelOf: 어디에도 모자라면 값 없음(level null, 0이 아님)과 pool", () => {
  const es = [entry({ net: 1 }), entry({ net: 2, airport: "VOCA" }), entry()]; // 마지막은 fuel 없음
  const t = tripFuelOf({ class: { type: "BUILD", wake: "M" }, airport: "ATCC" }, es, NOW);
  assert.equal(t.level, null);
  assert.equal(t.p50, null);
  assert.equal(t.p90, null);
  assert.equal(t.pool, 2);
  assert.equal(tripLabel(t), null);
});

test("tripFuelOf: fuel 없는 옛 줄, 값 없는 줄(fuelCost null·netCost null), 기간 밖, 자기 줄은 표본이 아니다", () => {
  const unpricedAll: PricedEntry = { ...entry({ net: 1 }), fuelCost: { captain: null, crew: null, total: null, leakCost: null, netCost: null, unpriced: [{ model: "deepseek", reason: "no price for model", requests: 3, tokens: 9 }] } };
  const self = entry({ net: 50 });
  const es = [entry(), entry({ net: null }), unpricedAll, entry({ net: 9, arrivedAt: at(90) }), self, entry({ net: 1 }), entry({ net: 2 })];
  const t = tripFuelOf({ key: self.key, class: { type: "BUILD", wake: "M" }, airport: "ATCC" }, es, NOW);
  assert.equal(t.pool, 2);
  assert.equal(t.level, null);
});

test("tripFuelOf: 모델 세대로 나눈다. 표본이 적은 세대는 범위 없이 건수만", () => {
  const sonnet = (net: number) => entry({ net, fuel: fuel({ models: { "claude-sonnet-5": 8, "claude-opus-5-5": 2 } }) });
  const es = [entry({ net: 1 }), entry({ net: 2 }), entry({ net: 3 }), sonnet(10), sonnet(12)];
  const t = tripFuelOf({ class: { type: "BUILD", wake: "M" }, airport: "ATCC" }, es, NOW);
  assert.equal(t.samples, 5);
  assert.deepEqual(
    t.generations.map((g) => [g.model, g.samples, g.p50]),
    [
      ["claude-opus-5-5", 3, 2],
      ["claude-sonnet-5", 2, null],
    ],
  );
});

test("generationOf: 요청이 가장 많은 모델, 날짜 꼬리는 뗀다", () => {
  assert.equal(generationOf({ models: { "claude-haiku-4-5-20251001": 5, "claude-opus-5-5": 2 } }), "claude-haiku-4-5");
  assert.equal(generationOf({ models: {} }), null);
  assert.equal(generationOf(null), null);
});

test("tripCheckOf: p90 이하 inside, 넘으면 unexpected, NET이나 범위가 없으면 null", () => {
  const base = [2, 4, 6, 8].map((net) => entry({ net }));
  const big = entry({ net: 30 });
  const small = entry({ net: 1 });
  const all = [...base, big, small];
  assert.equal(tripCheckOf(big, all, NOW).verdict, "unexpected");
  assert.equal(tripCheckOf(small, all, NOW).verdict, "inside");
  const old = entry(); // fuel 없음
  assert.equal(tripCheckOf(old, [...all, old], NOW).net, null);
  assert.equal(tripCheckOf(old, [...all, old], NOW).verdict, null);
  const lone = entry({ net: 5, airport: "VOCA", type: "CHECK", wake: "J" });
  assert.equal(tripCheckOf(lone, [lone], NOW).verdict, null);
});

test("fleetFuelOf: 값 매긴 FLIGHT의 평균, CACHE HIT은 fuel 있는 줄의 토큰으로, CREW 몫, TOP LEAK", () => {
  const leak = {
    coldCache: bucket(2, 5000), controlWake: bucket(1, 9000), modelSwitch: bucket(), compaction: bucket(), sessionChange: bucket(), upgrade: bucket(), unexplained: bucket(1, 100),
    total: bucket(4, 14100), crew: bucket(), expectedRebuild: bucket(), proxied: bucket(1, 99_000),
  };
  const warnings = { heavyPrefix: 2, trivialDelegation: 0, highCrewShare: 1, deepNesting: 0, expensiveReadOnly: 0, coldCrew: 0, complementDrift: 0 };
  const es = [
    { ...entry({ net: 4 }), fuelCost: cost(6, 4, 3), fuel: fuel({ leak, crewWarnings: warnings }) },
    { ...entry({ net: 8 }), fuelCost: cost(10, 8, 2) },
    entry(), // fuel 없는 옛 줄: ARRIVED에는 세고 값·CACHE에는 넣지 않는다
    entry({ net: 1, aircraft: "TEAM_H" }),
    entry({ net: 1, arrivedAt: at(20) }),
  ];
  const f = fleetFuelOf("team_j", es, NOW);
  assert.equal(f.arrived, 3);
  assert.equal(f.withFuel, 2);
  assert.equal(f.priced, 2);
  assert.equal(f.costPerFlight, 8);
  assert.equal(f.netPerFlight, 6);
  assert.equal(f.leakCost, 4);
  assert.equal(f.crewShare, 0.313);
  assert.deepEqual(f.cacheHit, { captain: 0.9, crew: 0.5, total: 0.864 });
  assert.deepEqual(
    f.leaks.map((l) => l.rule),
    ["controlWake", "coldCache", "unexplained"],
  );
  // proxied(LEAK 밖)는 TOP LEAK에 없다. CREW 경고는 F7 뒤 줄의 수를 더한다
  assert.deepEqual(f.crewWarnings, [
    { kind: "heavyPrefix", count: 2 },
    { kind: "highCrewShare", count: 1 },
  ]);
  assert.equal(fleetFuelLabel(f), "FUEL $8.00/FLT · CACHE 86%");
});

test("fleetFuelOf: fuel 없는 AIRCRAFT는 값이 모두 null(0이 아니다)", () => {
  const f = fleetFuelOf("TEAM_J", [entry(), entry()], NOW);
  assert.equal(f.arrived, 2);
  assert.equal(f.costPerFlight, null);
  assert.equal(f.netPerFlight, null);
  assert.equal(f.leakCost, null);
  assert.equal(f.cacheHit, null);
  assert.equal(f.crewShare, null);
  assert.deepEqual(f.leaks, []);
  assert.equal(f.crewWarnings, null); // F7 전 줄: 재지 않음(없음 []과 다르다)
  assert.equal(fleetFuelLabel(f), null);
  // fuel은 있지만 값이 없는 모델뿐: CACHE는 보이고 비용은 없다
  const onlyDeep = { ...entry(), fuel: fuel(), fuelCost: { captain: null, crew: null, total: null, leakCost: null, netCost: null, unpriced: [{ model: "deepseek", reason: "x", requests: 1, tokens: 1 }] } };
  const g = fleetFuelOf("TEAM_J", [onlyDeep], NOW);
  assert.equal(g.costPerFlight, null);
  assert.deepEqual(g.unpriced, ["deepseek"]);
  assert.equal(fleetFuelLabel(g), "FUEL CACHE 86%");
});

const ev = (over: Partial<LeakEvent & { name: string | null }>): LeakEvent & { name: string | null } => ({
  session: "s1",
  t: new Date(NOW - 3_600_000).toISOString(),
  rule: "coldCache",
  rewritten: 500_000,
  units: 1,
  cost: 4,
  gapMs: 0,
  model: "claude-opus-5-5",
  prevModel: "claude-opus-5-5",
  speed: null,
  geo: null,
  writeTier: "1h",
  wake: null,
  name: "TEAM_F",
  ...over,
});

test("largeLeaksOf: 24시간 안 값이 매겨진 LEAK을 팀 AIRCRAFT마다 더해 기준 이상만", () => {
  const isTeam = (n: string) => /^TEAM_[A-Z]$/.test(n);
  const got = largeLeaksOf(
    [
      ev({}),
      ev({ rule: "controlWake", cost: 7 }),
      ev({ cost: 30, t: new Date(NOW - 30 * 3_600_000).toISOString() }), // 24시간 밖
      ev({ name: "TEAM_A", cost: 3 }), // 작다
      ev({ name: "OCC", cost: 50 }), // 팀이 아님
      ev({ name: "TEAM_B", cost: null, units: null, rewritten: 9e6 }), // 값 없음은 짐작하지 않는다
      ev({ name: "TEAM_C", rule: "expectedRebuild", cost: 40 }),
      ev({ name: "TEAM_E", rule: "proxied", cost: 40 }), // LEAK 밖
    ],
    isTeam,
    NOW,
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].aircraft, "TEAM_F");
  assert.equal(got[0].cost, 11);
  assert.equal(got[0].count, 2);
  assert.equal(got[0].top, "controlWake");
  assert.equal(got[0].key, "leak|TEAM_F|2026-09-28");
  assert.match(got[0].text, /FUEL LEAK \$11\.0 in 24h — TEAM_F, 2 misses, 1\.0M rewritten, mostly CONTROL WAKE/);
});

const TABLE: PriceTable = { source: null, writeMult: { "5m": 1.25, "1h": 2 }, multipliers: {}, models: { "claude-opus-5-5": { in: 5, out: 25, readMult: 0.1 } } };
const rec = (over: Partial<FuelRecord>): FuelRecord => ({
  key: `k${seq++}`,
  session: "s1",
  sidechain: false,
  agent: null,
  t: new Date(NOW - 10 * 60_000).toISOString(),
  model: "claude-opus-5-5",
  stopReason: "end_turn",
  version: null,
  effort: null,
  speed: null,
  geo: null,
  input: 10,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 5,
  ...over,
});

test("coldCachesOf: 5m 층은 5분 뒤 식고, 1h 층은 1시간까지 따뜻하다. 읽기만 한 요청은 앞 층을 잇는다", () => {
  const holding = [
    { session: "s5", name: "Team_A", lastActiveAt: null },
    { session: "s1h", name: "TEAM_B", lastActiveAt: null },
  ];
  const records = [
    rec({ session: "s5", cacheWrite5m: 100_000, t: new Date(NOW - 30 * 60_000).toISOString() }),
    rec({ session: "s5", cacheRead: 100_000, t: new Date(NOW - 10 * 60_000).toISOString() }),
    rec({ session: "s1h", cacheWrite1h: 200_000, t: new Date(NOW - 50 * 60_000).toISOString() }),
    rec({ session: "s1h", cacheRead: 200_000, t: new Date(NOW - 20 * 60_000).toISOString() }),
    rec({ session: "s5", sidechain: true, t: new Date(NOW - 60_000).toISOString() }), // CREW는 보지 않는다
  ];
  const got = coldCachesOf(holding, records, NOW, TABLE);
  assert.equal(got.length, 1);
  assert.equal(got[0].aircraft, "TEAM_A");
  assert.equal(got[0].idleMin, 10);
  assert.equal(got[0].ttlMin, 5);
  assert.equal(got[0].prefix, 100_010);
  // 100,010 × (1.25 − 0.1) × $5/M
  assert.equal(got[0].cost, 0.58);
  assert.match(got[0].text, /^COLD CACHE — TEAM_A HOLDING 10m \(cache TTL 5m\): a message now re-writes ~100K \(~\$0\.58\)$/);
});

test("coldCachesOf: 1h 층이 한 시간을 넘으면 식는다. 값 없는 모델은 비용 null, 기록 없는 세션은 마지막 활동이 1시간을 넘을 때만", () => {
  const holding = [
    { session: "a", name: "TEAM_A", lastActiveAt: null },
    { session: "b", name: "TEAM_B", lastActiveAt: null },
    { session: "c", name: "TEAM_C", lastActiveAt: new Date(NOW - 90 * 60_000).toISOString() },
    { session: "d", name: "TEAM_D", lastActiveAt: new Date(NOW - 20 * 60_000).toISOString() },
  ];
  const records = [
    rec({ session: "a", cacheWrite1h: 50_000, t: new Date(NOW - 70 * 60_000).toISOString() }),
    rec({ session: "b", model: "deepseek", cacheWrite5m: 1000, t: new Date(NOW - 30 * 60_000).toISOString() }),
  ];
  const got = coldCachesOf(holding, records, NOW, TABLE);
  assert.deepEqual(
    got.map((c) => [c.aircraft, c.ttlMin, c.cost === null]),
    [
      ["TEAM_A", 60, false],
      ["TEAM_B", 5, true],
      ["TEAM_C", 60, true],
    ],
  );
  assert.equal(got.find((c) => c.aircraft === "TEAM_C")!.prefix, null);
  assert.match(got.find((c) => c.aircraft === "TEAM_C")!.text, /context size unknown/);
});
