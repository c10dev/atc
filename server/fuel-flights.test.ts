import assert from "node:assert/strict";
import { test } from "node:test";
import type { Departure } from "./departures.ts";
import type { FuelRecord } from "./fuel.ts";
import type { CrewWarning } from "./fuel-crew.ts";
import type { LeakEvent } from "./fuel-leaks.ts";
import { arrivedSpan, attributeFuel, type ClaimSpan, enRouteSpans, type FlightSpan, fuelForEntry, segmentsOf } from "./fuel-flights.ts";
import type { LogEntry } from "./logbook.ts";

const T = (hm: string) => `2026-09-28T${hm}:00.000Z`;
const ms = (hm: string) => Date.parse(T(hm));

let n = 0;
const rec = (session: string, hm: string, over: Partial<FuelRecord> = {}): FuelRecord => ({
  key: `k${++n}`,
  session,
  sidechain: false,
  agent: null,
  t: T(hm),
  model: "claude-opus-5-5",
  input: 10,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 90,
  output: 5,
  stopReason: "end_turn",
  version: null,
  effort: null,
  speed: null,
  geo: null,
  ...over,
});

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  key: "o/atc#1",
  aircraft: "TEAM_H",
  flight: "ATC-1",
  class: null,
  airport: "ATCC",
  pr: { repo: "o/atc", number: 1, url: "https://github.com/o/atc/pull/1", title: "One (ATC-1)" },
  branch: "claude/atc-1",
  stands: ["/w/atc-1"],
  departedAt: T("10:00"),
  departedFrom: "claim",
  arrivedAt: T("12:00"),
  blockMin: 90,
  landingWaitMin: 30,
  codexFindings: 0,
  changesRequested: false,
  reverted: false,
  los: 0,
  ...over,
});

const dep = (hm: string, over: Partial<Departure> = {}): Departure => ({
  t: T(hm),
  flight: "ATC-1",
  aircraft: "TEAM_H",
  stand: "/w/atc-1",
  branch: "claude/atc-1",
  repo: "/r/atc",
  via: "claim",
  ...over,
});

const names: Record<string, string> = { h1: "TEAM_H", h2: "TEAM_H", j1: "TEAM_J" };
const aircraftOf = (s: string) => names[s] ?? null;
const run = (records: FuelRecord[], spans: FlightSpan[], claims: ClaimSpan[] = []) => attributeFuel({ records, spans, aircraftOf, claims });
const reqs = (a: ReturnType<typeof run>, key: string) => {
  const f = a.flights.find((x) => x.key === key)?.fuel;
  return f ? [f.captain.requests, f.crew.requests] : null;
};

test("FLIGHT 하나: 구간 안 요청만 그 FLIGHT에, CAPTAIN·CREW를 따로 세고, 구간 밖은 AIRCRAFT의 UNATTRIBUTED", () => {
  const span = arrivedSpan(entry(), [], "/r/atc");
  const a = run(
    [rec("h1", "09:00"), rec("h1", "10:30"), rec("h1", "11:00", { sidechain: true, agent: "x", output: 1 }), rec("h1", "13:00")],
    [span],
  );
  assert.deepEqual(reqs(a, "o/atc#1"), [1, 1]);
  const row = a.flights[0];
  assert.deepEqual(row.aircraft, ["TEAM_H"]);
  assert.deepEqual(row.sessions, ["h1"]);
  assert.equal(row.fuel.crew.outputLowerBound, true);
  assert.equal(row.fuel.captain.output, 5);
  assert.equal(row.fuel.crew.output, 1);
  assert.equal(row.fuel.cacheHit, 0.9);
  assert.deepEqual(row.fuel.models, { "claude-opus-5-5": 2 });
  const h = a.aircraft.get("TEAM_H")!;
  assert.equal(h.flights.total.requests, 2);
  assert.equal(h.unattributed.captain.requests, 2);
  assert.equal(h.enRoute.total.requests, 0);
  assert.equal(a.totals.unattributed.total.requests, 2);
});

test("한 세션의 FLIGHT 둘: 차례로 자르고, 겹치면 늦게 출발한 FLIGHT, 그때 STAND를 점유했으면 그 FLIGHT", () => {
  const e1 = entry();
  const e2 = entry({ key: "o/atc#2", flight: "ATC-2", branch: "claude/atc-2", stands: ["/w/atc-2"], departedAt: T("11:00"), arrivedAt: T("14:00") });
  const spans = [arrivedSpan(e1, [], null), arrivedSpan(e2, [], null)];
  // 10:30은 앞 FLIGHT, 11:30(앞 FLIGHT의 착륙 대기)과 13:00은 뒤 FLIGHT
  let a = run([rec("h1", "10:30"), rec("h1", "11:30"), rec("h1", "13:00")], spans);
  assert.deepEqual(reqs(a, "o/atc#1"), [1, 0]);
  assert.deepEqual(reqs(a, "o/atc#2"), [2, 0]);
  // 11:30에 앞 FLIGHT의 STAND를 고치고 있었으면(리뷰 수정) 앞 FLIGHT
  a = run([rec("h1", "10:30"), rec("h1", "11:30"), rec("h1", "13:00")], spans, [
    { sessionId: "h1", workspacePath: "/w/atc-1", since: T("11:20"), lastAt: T("11:40") },
  ]);
  assert.deepEqual(reqs(a, "o/atc#1"), [2, 0]);
  assert.deepEqual(reqs(a, "o/atc#2"), [1, 0]);
  assert.equal(a.totals.unattributed.total.requests, 0);
});

test("HANDOFF: 착수 기록의 AIRCRAFT 줄로 구간을 나누고, 같은 AIRCRAFT의 새 세션도 그 FLIGHT에 든다", () => {
  const departures = [
    dep("09:50", { aircraft: null, via: "stand" }),
    dep("10:05"),
    dep("12:00", { aircraft: "TEAM_J", via: "handoff" }),
    dep("15:00", { aircraft: "TEAM_K", via: "handoff" }), // 머지 뒤: 다음 작업
  ];
  const e = entry({ aircraft: "TEAM_J", arrivedAt: T("14:00") });
  const span = arrivedSpan(e, departures, "/r/atc");
  assert.deepEqual(span.segments, [
    { aircraft: "TEAM_H", from: ms("10:00"), to: ms("12:00") },
    { aircraft: "TEAM_J", from: ms("12:00"), to: ms("14:00") },
  ]);
  const a = run([rec("h1", "10:30"), rec("h2", "11:30"), rec("h1", "13:00"), rec("j1", "11:00"), rec("j1", "13:00", { sidechain: true })], [span]);
  assert.deepEqual(reqs(a, "o/atc#1"), [2, 1]); // h1 10:30, h2 11:30(TEAM_H가 이어 연 세션), j1 13:00 CREW
  assert.deepEqual(a.flights[0].aircraft, ["TEAM_H", "TEAM_J"]);
  assert.deepEqual(a.flights[0].sessions, ["h1", "h2", "j1"]);
  assert.equal(a.aircraft.get("TEAM_H")!.unattributed.total.requests, 1); // HANDOFF 뒤 TEAM_H의 13:00
  assert.equal(a.aircraft.get("TEAM_J")!.unattributed.total.requests, 1); // HANDOFF 전 TEAM_J의 11:00
});

test("segmentsOf: AIRCRAFT 줄이 없으면 LOGBOOK의 AIRCRAFT, 그것도 없으면 없음. 같은 AIRCRAFT가 이어지면 합친다", () => {
  assert.deepEqual(segmentsOf([], 1, 5, "TEAM_H"), [{ aircraft: "TEAM_H", from: 1, to: 5 }]);
  assert.deepEqual(segmentsOf([dep("10:00", { aircraft: null })], 1, 5, null), []);
  const lines = [dep("10:00"), dep("10:30", { via: "handoff" })];
  assert.deepEqual(segmentsOf(lines, ms("09:00"), ms("11:00"), null), [{ aircraft: "TEAM_H", from: ms("09:00"), to: ms("11:00") }]);
});

test("AD HOC: ticket key가 없는 FLIGHT도 STAND 점유로 자르고, 이름 없는 세션은 점유한 때만 든다", () => {
  const e = entry({ key: "o/atc#9", flight: null, aircraft: null, branch: "fix-typo", stands: ["/w/fix-typo"] });
  const span = arrivedSpan(e, [], "/r/atc");
  assert.deepEqual(span.segments, []);
  const a = run([rec("u", "10:30"), rec("u", "11:30"), rec("u", "10:40", { sidechain: true })], [span], [
    { sessionId: "u", workspacePath: "/w/fix-typo", since: T("10:10"), lastAt: T("10:50") },
  ]);
  assert.deepEqual(reqs(a, "o/atc#9"), [1, 1]);
  assert.equal(a.flights[0].flight, null);
  assert.equal(a.totals.unattributed.total.requests, 1); // 11:30: 점유 밖, AIRCRAFT도 모른다
  assert.equal(a.aircraft.size, 0);
});

test("EN ROUTE: 지금 있는 STAND의, 도착하지 않은 착수 기록은 따로 세고 UNATTRIBUTED로 치지 않는다", () => {
  const arrived = entry(); // /w/atc-1, 12:00 도착
  const departures = [
    dep("10:00"),
    dep("12:30", { flight: null, branch: "claude/next", via: "claim" }), // 같은 STAND, 도착 뒤 새 브랜치
    dep("11:00", { flight: "ATC-3", branch: "claude/atc-3", stand: "/w/atc-3" }),
    dep("11:00", { flight: "ATC-4", branch: "claude/atc-4", stand: "/w/gone", aircraft: "TEAM_J" }), // 지워진 STAND
  ];
  const open = new Set(["/w/atc-1", "/w/atc-3"]);
  const spans = enRouteSpans(departures, [arrived], open, ms("16:00"));
  assert.deepEqual(
    spans.map((s) => [s.key, s.flight, s.from, s.to, s.stands]),
    [
      ["enroute:/r/atc|claude/next", null, ms("12:30"), ms("16:00"), ["/w/atc-1"]],
      ["enroute:/r/atc|claude/atc-3", "ATC-3", ms("11:00"), ms("16:00"), ["/w/atc-3"]],
    ],
  );
  const a = run([rec("h1", "13:00"), rec("j1", "13:00")], [arrivedSpan(arrived, departures, "/r/atc"), ...spans]);
  // 13:00의 TEAM_H: EN ROUTE 둘 중 늦게 출발한 claude/next
  assert.deepEqual(reqs(a, "enroute:/r/atc|claude/next"), [1, 0]);
  assert.equal(a.aircraft.get("TEAM_H")!.enRoute.total.requests, 1);
  assert.equal(a.aircraft.get("TEAM_J")!.unattributed.total.requests, 1); // 지워진 STAND의 FLIGHT는 구간이 없다
});

test("fuelForEntry: 출발 시각을 모르거나 읽은 기간 앞에 출발했거나 요청이 없으면 붙이지 않고, 아직 없는 칸은 넣지 않는다", () => {
  const e = entry();
  const a = run([rec("h1", "10:30")], [arrivedSpan(e, [], null)]);
  const fuel = fuelForEntry(e, a, ms("00:00"))!;
  assert.deepEqual(Object.keys(fuel).sort(), ["cacheHit", "captain", "crew", "models"]);
  assert.equal(fuel.captain.requests, 1);
  assert.equal(fuelForEntry({ ...e, departedFrom: "pr" }, a, ms("00:00")), null);
  assert.equal(fuelForEntry(e, a, ms("10:30")), null);
  assert.equal(fuelForEntry({ ...e, key: "o/atc#404" }, a, ms("00:00")), null);
});

test("LEAK(F3): miss도 요청과 같은 규칙으로 FLIGHT에 나누고, LEAK을 넘기지 않으면 칸이 없다", () => {
  const e1 = entry();
  const e2 = entry({ key: "o/atc#2", flight: "ATC-2", branch: "claude/atc-2", stands: ["/w/atc-2"], departedAt: T("13:00"), arrivedAt: T("15:00") });
  const spans = [arrivedSpan(e1, [], null), arrivedSpan(e2, [], null)];
  const leak = (hm: string, rule: LeakEvent["rule"], rewritten: number): LeakEvent => ({
    session: "h1",
    t: T(hm),
    rule,
    rewritten,
    units: rewritten,
    cost: rewritten / 1_000_000,
    gapMs: 0,
    model: "claude-opus-5-5",
    prevModel: "claude-opus-5-5",
    wake: null,
  });
  const records = [rec("h1", "10:30"), rec("h1", "11:00"), rec("h1", "12:30"), rec("h1", "14:00")];
  const leaks = [leak("11:00", "coldCache", 5000), leak("11:00", "expectedRebuild", 100), leak("12:30", "modelSwitch", 3000)];
  const a = attributeFuel({ records, spans, aircraftOf, claims: [], leaks });
  const l1 = a.flights.find((f) => f.key === "o/atc#1")!.fuel.leak!;
  assert.deepEqual(Object.keys(l1.total), ["count", "tokens", "units", "unpricedTokens"]); // LOGBOOK fuel.leak은 F4 모양 그대로(비용 없음)
  assert.deepEqual([l1.coldCache.tokens, l1.total.count, l1.total.tokens, l1.expectedRebuild.tokens], [5000, 1, 5000, 100]);
  const l2 = a.flights.find((f) => f.key === "o/atc#2")!.fuel.leak!;
  assert.equal(l2.total.count, 0); // miss가 없던 FLIGHT는 0(12:30 miss는 어느 FLIGHT에도 없다)
  const fuel = fuelForEntry(e1, a, ms("00:00"))!;
  assert.deepEqual(Object.keys(fuel), ["captain", "crew", "cacheHit", "leak", "models"]);
  assert.equal(run(records, spans).flights[0].fuel.leak, undefined);
});

test("CREW 경고(F7): FLIGHT마다 같은 규칙으로 세고, CREW 몫이 50 %를 넘은 FLIGHT는 highCrewShare 1. 넘기지 않으면 칸이 없다", () => {
  const e1 = entry();
  const e2 = entry({ key: "o/atc#2", flight: "ATC-2", branch: "claude/atc-2", stands: ["/w/atc-2"], departedAt: T("13:00"), arrivedAt: T("15:00") });
  const spans = [arrivedSpan(e1, [], null), arrivedSpan(e2, [], null)];
  const crewRec = (hm: string) => rec("h1", hm, { sidechain: true, agent: "a1", cacheRead: 900 });
  const records = [rec("h1", "10:30"), crewRec("10:40"), crewRec("10:50"), rec("h1", "13:30"), rec("h1", "14:00")];
  const warn = (hm: string, kind: CrewWarning["kind"]): CrewWarning => ({ kind, session: "h1", agent: "a1", agentType: "Explore", t: T(hm), value: 1, detail: null });
  const warnings = [warn("10:40", "heavyPrefix"), warn("10:40", "expensiveReadOnly"), warn("12:30", "coldCrew")];
  const a = attributeFuel({ records, spans, aircraftOf, claims: [], warnings });
  const w1 = a.flights.find((f) => f.key === "o/atc#1")!.fuel.crewWarnings!;
  assert.deepEqual([w1.heavyPrefix, w1.expensiveReadOnly, w1.coldCrew, w1.highCrewShare], [1, 1, 0, 1]);
  const w2 = a.flights.find((f) => f.key === "o/atc#2")!.fuel.crewWarnings!;
  assert.deepEqual(Object.values(w2), [0, 0, 0, 0, 0, 0, 0]); // 12:30 경고는 어느 FLIGHT에도 없다
  assert.deepEqual(Object.keys(fuelForEntry(e1, a, ms("00:00"))!), ["captain", "crew", "cacheHit", "crewWarnings", "models"]);
  assert.equal(run(records, spans).flights[0].fuel.crewWarnings, undefined);
});

test("EN ROUTE 구간도 AIRPORT를 안다(SESSION CHANGE 기준선, F7)", () => {
  const spans = enRouteSpans([dep("11:00", { stand: "/w/x", branch: "b" })], [], new Set(["/w/x"]), ms("16:00"), (repo) => (repo === "/r/atc" ? "ATCC" : null));
  assert.equal(spans[0].airport, "ATCC");
  assert.equal(arrivedSpan(entry(), [], null).airport, "ATCC");
});
