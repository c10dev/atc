import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampWindow, crewWarningRowsOf, dayBarsOf, groupedRows, groupOf, leakViewsOf, modelRowsOf, rowsOf, sortRows, summaryOf, tokensLong, topFlightsOf, unpricedText,
} from "../web/src/fuel-overview.ts";
import { emptyWarnings } from "./fuel-crew.ts";
import { emptyLeaks } from "./fuel-leaks.ts";
import type { AircraftFuel, Burn, ModelFuel, SessionFuel } from "./fuel.ts";

const cost = (total: number) => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, total });
const burn = (total: number, requests: number, hit: number | null = 0.9, unpriced = { requests: 0, tokens: 0 }): Burn =>
  ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, requests, cacheHit: hit, cost: cost(total), unpriced });
const leakWith = (c: number) => {
  const l = emptyLeaks();
  l.total.cost = c;
  return l;
};
const air = (name: string, captain: number, crew: number, models: Record<string, number> = { "m-a": 1 }, leak = 0): AircraftFuel =>
  ({
    aircraft: name, sessions: [name], captain: burn(captain, 2), crew: { ...burn(crew, 1), outputLowerBound: true, nullStopShare: null, agents: 0, byType: {}, maxSpawnDepth: null },
    total: burn(captain + crew, 3), models, leak: leakWith(leak), crewWarnings: emptyWarnings(), netCost: captain + crew - leak,
  }) as AircraftFuel;
const PATTERN = "^TEAM_[A-Z]$";

test("unpricedText: 건수와 토큰을 늘 적고, 없으면 0건", () => {
  assert.equal(unpricedText({ requests: 4710, tokens: 1_040_000_000 }), "가격 없는 모델 4,710건 · 1.04B tokens 제외");
  assert.equal(unpricedText({ requests: 12, tokens: 3_400_000 }), "가격 없는 모델 12건 · 3.4M tokens 제외");
  assert.equal(unpricedText({ requests: 0, tokens: 0 }), "가격 없는 모델 0건");
  assert.equal(tokensLong(999), "999");
});

test("summaryOf: 전체·CAPTAIN·CREW 비용, CREW 몫, CACHE HIT, 요청 수, 가격 없는 몫", () => {
  const t = { captain: burn(30, 90), crew: burn(10, 10), total: burn(40, 100, 0.95, { requests: 5, tokens: 2_000_000 }) };
  const s = summaryOf(t, 100);
  assert.deepEqual([s.total, s.captain, s.crew, s.crewShare, s.cacheHit, s.requests], [40, 30, 10, 0.25, 0.95, 100]);
  assert.equal(s.unpriced, "가격 없는 모델 5건 · 2.0M tokens 제외");
  assert.equal(summaryOf({ captain: burn(0, 0, null), crew: burn(0, 0, null), total: burn(0, 0, null) }, 0).crewShare, null);
});

test("groupOf: teamPattern은 팀, TOWER·OCC·MCC·CROSSCHECK·REVIEW·ENGINEERING은 관제, 나머지는 기타", () => {
  assert.equal(groupOf("TEAM_G", PATTERN), "team");
  assert.equal(groupOf("Team G", "^team[ _-]?[a-z]$"), "team");
  for (const n of ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW", "ENGINEERING", "occ"]) assert.equal(groupOf(n, PATTERN), "control", n);
  assert.equal(groupOf("scratch", PATTERN), "other");
  assert.equal(groupOf("TEAM_G", "("), "other"); // 깨진 패턴
});

test("rowsOf·groupedRows: 팀이 먼저, 관제 묶음, 기타(이름 없는 세션 포함). 묶음 안은 정렬 기준대로", () => {
  const unnamed = { session: "abcdef1234567890", name: null, total: burn(1, 1), crew: burn(0, 0), leak: leakWith(0), models: { "m-x": 1 }, netCost: 1 } as unknown as SessionFuel;
  const named = { ...unnamed, session: "s2", name: "TEAM_A" } as SessionFuel;
  const rows = rowsOf([air("TOWER", 5, 0), air("TEAM_B", 10, 0), air("TEAM_A", 2, 2), air("scratch", 7, 0)], [unnamed, named], PATTERN);
  assert.equal(rows.length, 5); // 이름 있는 세션은 AIRCRAFT에 이미 들어 있다
  const g = groupedRows(rows, "cost", "desc");
  assert.deepEqual(g.map((x) => x.id), ["team", "control", "other"]);
  assert.deepEqual(g[0].rows.map((r) => r.label), ["TEAM_B", "TEAM_A"]);
  assert.deepEqual(g[2].rows.map((r) => r.label), ["scratch", "session abcdef12"]);
  assert.equal(g[0].rows[0].fleet, true);
  assert.equal(g[1].rows[0].fleet, false);
  // 묶음이 비면 나오지 않는다
  assert.deepEqual(groupedRows(rows.filter((r) => r.group === "team"), "cost", "asc").map((x) => x.id), ["team"]);
});

test("행 값: 비용·요청·CREW 몫·LEAK·NET·주 모델", () => {
  const [r] = rowsOf([air("TEAM_A", 6, 2, { "m-a": 3, "m-b": 5 }, 1.5)], [], PATTERN);
  assert.deepEqual([r.cost, r.requests, r.crewShare, r.leakCost, r.net, r.topModel], [8, 3, 0.25, 1.5, 6.5, "m-b"]);
});

test("sortRows: 숫자·글자 모두 asc·desc, null은 늘 뒤, 같으면 이름순", () => {
  const rows = rowsOf([air("TEAM_A", 1, 0), air("TEAM_B", 3, 0), air("TEAM_C", 3, 0), air("TEAM_D", 2, 0)], [], PATTERN);
  assert.deepEqual(sortRows(rows, "cost", "desc").map((r) => r.label), ["TEAM_B", "TEAM_C", "TEAM_D", "TEAM_A"]);
  assert.deepEqual(sortRows(rows, "cost", "asc").map((r) => r.label), ["TEAM_A", "TEAM_D", "TEAM_B", "TEAM_C"]);
  assert.deepEqual(sortRows(rows, "label", "desc").map((r) => r.label), ["TEAM_D", "TEAM_C", "TEAM_B", "TEAM_A"]);
  const withNull = rows.map((r, i) => (i === 1 ? { ...r, crewShare: null } : { ...r, crewShare: i / 10 }));
  assert.equal(sortRows(withNull, "crewShare", "asc").at(-1)!.label, "TEAM_B");
  assert.equal(sortRows(withNull, "crewShare", "desc").at(-1)!.label, "TEAM_B");
});

test("modelRowsOf: 값이 매겨진 모델과 가격 없는 모델(토큰만)을 나눈다", () => {
  const m = (model: string, requests: number, unpricedRequests: number): ModelFuel => ({ model, requests, tokens: requests * 10, cost: 1, unpricedRequests, unpricedTokens: unpricedRequests * 10 });
  const r = modelRowsOf([m("a", 4, 0), m("b", 3, 3), m("c", 5, 2)]);
  assert.deepEqual(r.priced.map((x) => x.model), ["a", "c"]); // 일부만 값이 없는 모델은 값이 있는 쪽
  assert.deepEqual(r.unpriced.map((x) => x.model), ["b"]);
});

test("leakViewsOf: 규칙마다 뜻과 값, LEAK 밖(proxied·expectedRebuild)은 표시", () => {
  const l = emptyLeaks();
  l.coldCache = { count: 3, tokens: 900, units: 1, cost: 2.5, unpricedTokens: 0 };
  l.proxied = { count: 9, tokens: 5000, units: 0, cost: 0, unpricedTokens: 5000 };
  const v = leakViewsOf(l);
  assert.deepEqual(v.map((x) => x.label), ["COLD CACHE", "CONTROL WAKE", "MODEL SWITCH", "COMPACTION", "SESSION CHANGE", "ACCOUNT CHANGE", "UPGRADE", "UNEXPLAINED", "PROXIED", "EXPECTED REBUILD"]);
  assert.equal(v[0].count, 3);
  assert.equal(v[0].cost, 2.5);
  assert.ok(v.every((x) => x.meaning.length > 10));
  assert.deepEqual(v.filter((x) => x.outside).map((x) => x.label), ["PROXIED", "EXPECTED REBUILD"]);
  assert.equal(v.find((x) => x.label === "PROXIED")!.unpricedTokens, 5000);
  const w = emptyWarnings();
  w.coldCrew = 4;
  assert.equal(crewWarningRowsOf(w).find((x) => x.kind === "coldCrew")!.count, 4);
  assert.equal(crewWarningRowsOf(w).length, 7);
});

test("dayBarsOf: 기간의 UTC 날짜를 빠짐없이, 기록 없는 날은 0, 최댓값", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const since = new Date(now - 3 * 86_400_000).toISOString(); // 09-25T12
  const { bars, max } = dayBarsOf([{ day: "2026-09-26", captain: 3, crew: 1, requests: 4, unpricedTokens: 0 }, { day: "2026-09-28", captain: 1, crew: 0.5, requests: 2, unpricedTokens: 7 }], since, now);
  assert.deepEqual(bars.map((b) => b.day), ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
  assert.deepEqual(bars.map((b) => b.total), [0, 4, 0, 1.5]);
  assert.equal(max, 4);
  const empty = dayBarsOf([], since, now);
  assert.equal(empty.bars.length, 4);
  assert.equal(empty.max, 0);
});

test("topFlightsOf: 기간 안 NET 큰 순서 10개, 값 없는 FLIGHT는 빼고, 같은 FLIGHT는 하나, TRIP 판정을 싣는다", () => {
  const e = (flight: string | null, net: number | null, at = "2026-09-27T10:00:00Z", verdict: "inside" | "unexpected" | null = "inside") => ({ key: `k${flight}${net}`, flight, aircraft: "TEAM_A", arrivedAt: at, trip: { net, verdict } });
  const many = Array.from({ length: 14 }, (_, i) => e(`ATC-${i}`, i + 1));
  const top = topFlightsOf([...many, e("ATC-99", null), e(null, 500), e("ATC-old", 900, "2026-09-01T00:00:00Z"), e("ATC-3", 40, "2026-09-27T11:00:00Z", "unexpected")], "2026-09-20T00:00:00Z");
  assert.equal(top.length, 10);
  assert.deepEqual(top.slice(0, 3).map((t) => [t.flight, t.net]), [["ATC-3", 40], ["ATC-13", 14], ["ATC-12", 13]]);
  assert.equal(top[0].verdict, "unexpected");
  assert.ok(!top.some((t) => t.flight === "ATC-old" || t.flight === "ATC-99"));
  assert.deepEqual(topFlightsOf([], "2026-09-20T00:00:00Z"), []);
});

test("clampWindow: 1·7·14·30만, 그 밖은 기본 7", () => {
  assert.equal(clampWindow(14), 14);
  assert.equal(clampWindow(30), 30);
  assert.equal(clampWindow(90), 7);
  assert.equal(clampWindow("14"), 7);
});
