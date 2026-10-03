import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aircraftGroups,
  aircraftStateWord,
  compareFlights,
  DONE_WINDOW_MS,
  filterLabeled,
  flightGroups,
  type FlightInput,
  groupByAirport,
  HOME_ANCHORS,
  matchesQuery,
  METRICS_ITEMS,
  metricsSubOf,
  NO_AIRPORT,
  releaseGroups,
} from "../web/src/sidebar-rows.ts";

const AIRPORTS = [
  { code: "ATCC", repo: "/r/atc", name: "atc" },
  { code: "VCDO", repo: "/r/vocado", name: "vocado" },
];
const NOW = Date.parse("2026-10-02T12:00:00Z");
const f = (key: string, over: Partial<FlightInput> = {}): FlightInput => ({
  key,
  title: `title of ${key}`,
  state: "In Progress",
  stateType: "started",
  priority: 0,
  airport: "ATCC",
  live: false,
  updatedAt: "2026-10-02T10:00:00Z",
  ...over,
});

test("검색어: 낱말이 모두 어딘가에 있으면 맞고, 대소문자·빈 검색어는 무시한다", () => {
  assert.equal(matchesQuery("", ["x"]), true);
  assert.equal(matchesQuery("  ", [null, undefined]), true);
  assert.equal(matchesQuery("atc-4 sidebar", ["ATC-443", "Shell Z2: a screen sidebar"]), true);
  assert.equal(matchesQuery("atc-4 rail", ["ATC-443", "Shell Z2: a screen sidebar"]), false);
  assert.equal(matchesQuery("team_f", ["TEAM_F"]), true);
});

test("AIRPORT 묶음: airports 순서, 빈 묶음 없음, 모르는 코드와 코드 없음은 맨 뒤 한 묶음", () => {
  const rows = [
    { id: 1, airport: "VCDO" },
    { id: 2, airport: "ATCC" },
    { id: 3, airport: null },
    { id: 4, airport: "ZZZZ" },
    { id: 5, airport: "ATCC" },
  ];
  const g = groupByAirport(rows, AIRPORTS);
  assert.deepEqual(g.map((x) => x.code), ["ATCC", "VCDO", NO_AIRPORT]);
  assert.deepEqual(g[0]!.rows.map((r) => r.id), [2, 5]);
  assert.deepEqual(g[2]!.rows.map((r) => r.id), [3, 4]);
  assert.equal(g[0]!.repo, "/r/atc");
  assert.equal(g[2]!.repo, null);
  assert.deepEqual(groupByAirport([], AIRPORTS), []);
});

test("FLIGHT 정렬: 살아 있는 것 먼저, 하는 중 → 기다림, 우선순위(없음은 맨 뒤), key 숫자순", () => {
  const list = [
    f("ATC-10", { stateType: "unstarted" }),
    f("ATC-9", { stateType: "started", priority: 3 }),
    f("ATC-11", { stateType: "started", priority: 1 }),
    f("ATC-12", { stateType: "started" }),
    f("ATC-50", { stateType: "unstarted", live: true }),
  ];
  assert.deepEqual([...list].sort(compareFlights).map((x) => x.key), ["ATC-50", "ATC-11", "ATC-9", "ATC-12", "ATC-10"]);
});

test("FLIGHT 묶음: 끝난 것은 개수 뒤로 접고, 오래된 끝난 것과 backlog는 뺀다", () => {
  const list = [
    f("ATC-1"),
    f("ATC-2", { stateType: "completed", updatedAt: "2026-10-01T00:00:00Z" }),
    f("ATC-3", { stateType: "canceled", updatedAt: "2026-09-01T00:00:00Z" }), // 7일보다 오래됨
    f("ATC-4", { stateType: "backlog" }),
    f("ATC-5", { stateType: "backlog", live: true }), // 살아 있으면 들어간다
    f("VOC-1", { airport: "VCDO", stateType: "completed", updatedAt: "2026-10-02T11:00:00Z" }), // 끝난 것만 있는 AIRPORT
  ];
  const g = flightGroups(list, AIRPORTS, "", NOW);
  assert.deepEqual(g.map((x) => x.code), ["ATCC", "VCDO"]);
  assert.deepEqual(g[0]!.rows.map((x) => x.key), ["ATC-5", "ATC-1"]);
  assert.equal(g[0]!.liveCount, 1);
  assert.deepEqual(g[0]!.done.map((x) => x.key), ["ATC-2"]);
  assert.equal(g[0]!.doneCount, 1);
  assert.equal(g[1]!.rows.length, 0);
  assert.equal(g[1]!.doneCount, 1);
  assert.ok(DONE_WINDOW_MS === 7 * 24 * 3600_000);
});

test("FLIGHT 묶음: 검색은 key·제목·AIRPORT만 거르고 묶음과 접힘은 그대로다", () => {
  const list = [f("ATC-1", { title: "Fix sidebar" }), f("ATC-2", { title: "Other" }), f("VOC-9", { airport: "VCDO", title: "sidebar for vocado" }), f("ATC-3", { stateType: "completed", title: "old sidebar" })];
  const g = flightGroups(list, AIRPORTS, "sidebar", NOW);
  assert.deepEqual(g.map((x) => x.code), ["ATCC", "VCDO"]);
  assert.deepEqual(g[0]!.rows.map((x) => x.key), ["ATC-1"]);
  assert.equal(g[0]!.doneCount, 1);
  assert.deepEqual(flightGroups(list, AIRPORTS, "nomatch", NOW), []);
  assert.deepEqual(flightGroups(list, AIRPORTS, "vcdo", NOW).map((x) => x.code), ["VCDO"]);
});

test("AIRCRAFT 묶음: 퇴역은 빼고, 비행 중 → 쉬는 중 → NORDO → ABSENT 순, 상태 낱말로도 검색된다", () => {
  const items = [
    { registration: "TEAM_B", callsign: "BRAVO", airport: "ATCC", status: "idle", retired: false },
    { registration: "TEAM_A", callsign: "ALFA", airport: "ATCC", status: "busy", retired: false },
    { registration: "TEAM_C", callsign: "CHARLIE", airport: "ATCC", status: "absent", retired: false },
    { registration: "TEAM_D", callsign: "DELTA", airport: "VCDO", status: "dead", retired: false },
    { registration: "TEAM_E", callsign: "ECHO", airport: "ATCC", status: "busy", retired: true },
  ];
  const g = aircraftGroups(items, AIRPORTS, "");
  assert.deepEqual(g[0]!.rows.map((a) => a.registration), ["TEAM_A", "TEAM_B", "TEAM_C"]);
  assert.deepEqual(g.map((x) => x.code), ["ATCC", "VCDO"]);
  assert.deepEqual(aircraftGroups(items, AIRPORTS, "nordo").map((x) => x.rows.map((a) => a.registration)), [["TEAM_D"]]);
  assert.deepEqual(aircraftGroups(items, AIRPORTS, "alfa")[0]!.rows.map((a) => a.registration), ["TEAM_A"]);
  assert.equal(aircraftStateWord("busy"), "AIRBORNE");
  assert.equal(aircraftStateWord("idle"), "IDLE");
  assert.equal(aircraftStateWord("dead"), "NORDO");
  assert.equal(aircraftStateWord("absent"), "ABSENT");
});

test("RELEASE 묶음: AIRPORT별, 우선순위 먼저, 검색", () => {
  const items = [
    { key: "ATC-30", title: "low", priority: 4, airport: "ATCC" },
    { key: "ATC-31", title: "urgent", priority: 1, airport: "ATCC" },
    { key: "VOC-5", title: "other repo", priority: 0, airport: "VCDO" },
    { key: "XXX-1", title: "no airport", priority: 2, airport: null },
  ];
  const g = releaseGroups(items, AIRPORTS, "");
  assert.deepEqual(g.map((x) => x.code), ["ATCC", "VCDO", NO_AIRPORT]);
  assert.deepEqual(g[0]!.rows.map((r) => r.key), ["ATC-31", "ATC-30"]);
  assert.deepEqual(releaseGroups(items, AIRPORTS, "voc").map((x) => x.rows.map((r) => r.key)), [["VOC-5"]]);
});

test("METRICS 하위 화면과 HOME 닻: 이름·주소가 고정이고 검색이 거른다", () => {
  assert.deepEqual(METRICS_ITEMS.map((m) => m.label), ["OPERATIONS", "LEAKS", "MISFIRE", "FUEL", "NETWORK"]);
  assert.deepEqual(HOME_ANCHORS.map((a) => a.label), ["TO DO"]); // BRAKES는 아래 패널 탭으로 갔다(ATC-455)
  assert.deepEqual(filterLabeled(METRICS_ITEMS, "fuel").map((m) => m.id), ["fuel"]);
  assert.equal(filterLabeled(HOME_ANCHORS, "").length, 1);
  assert.equal(metricsSubOf("#metrics"), "ops");
  assert.equal(metricsSubOf("#metrics/leaks"), "leaks");
  assert.equal(metricsSubOf("#metrics/nope"), "ops");
  assert.equal(metricsSubOf("#home"), "ops");
});
