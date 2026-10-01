import assert from "node:assert/strict";
import { test } from "node:test";
import { landDecisionOf, type MccLandInfo } from "./land-by.ts";
import { ARRIVED_FADE_MIN, CRUISE_CAP, flightsOf, globeSceneOf, GO_AROUND_MIN, outboundBearings, type GlobeFlightsIn } from "./globe.ts";
import type { Milestones } from "./milestones.ts";
import type { FlightProgress, Segment } from "./progress.ts";

// GLOBE G2: docs/globe.md 3.3의 표 한 줄에 테스트 하나

const NOW = Date.parse("2026-10-01T12:00:00Z");
const MIN = 60_000;
const ago = (min: number) => new Date(NOW - min * MIN).toISOString();
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

const airports = [
  { id: "id-atcc", code: "ATCC", name: "atc", repo: "/p/atc" },
  { id: "id-abcd", code: "ABCD", name: "abcd", repo: "/p/abcd" },
];
const ms = (o: Partial<Milestones> = {}): Milestones => ({ out: null, off: null, on: null, in: null, reverted: null, ...o });
// 진행 막대의 marker는 (구간 번호 + 구간 안 몫)/4
const IDX: Record<Segment, number> = { work: 0, landing: 1, rts: 2, done: 3 };
const prog = (segment: Segment, frac: number | null, o: Partial<FlightProgress> = {}): FlightProgress => ({
  segment,
  elapsedMin: segment === "done" ? null : 30,
  typical: null,
  late: false,
  marker: segment === "done" ? null : ((IDX[segment] + (frac ?? 0)) / 4),
  standFree: false,
  ...o,
});
const air = (registration: string, status: "busy" | "idle" | "dead", flying: string[]) => ({ registration, callsign: registration.replace("TEAM_", "CALL "), status, flying });

// 한 FLIGHT(ATC-1)를 ATCC에서 돌리는 기본 입력. 필요한 부분만 덮어쓴다
function input(over: Partial<GlobeFlightsIn> & { key?: string } = {}): GlobeFlightsIn {
  const key = over.key ?? "ATC-1";
  return {
    now: NOW,
    tickets: [{ key, stateType: "started" }],
    workspaces: [{ ticketKey: key, repo: "/p/atc", isMain: false }],
    pulls: [],
    clearances: [],
    aircraft: [air("TEAM_A", "busy", [key])],
    milestones: { [key]: ms({ out: ago(30) }) },
    progress: { [key]: prog("work", 0.5) },
    ...over,
  };
}
const one = (i: GlobeFlightsIn) => {
  const f = flightsOf(i, airports);
  assert.equal(f.length, 1, JSON.stringify(f));
  return f[0];
};
const pull = (landing: "CLEARED" | "APPROACH", codes: string[] = [], key = "ATC-1") => ({ ticketKey: key, repo: "/p/atc", landing, blocks: codes.map((code) => ({ code })) });
const clr = (type: string, minAgo: number, extra: Partial<{ flight: string | null; cancelledAt: string | null }> = {}) => ({ type, flight: "ATC-1" as string | null, at: ago(minAgo), cancelledAt: null as string | null, ...extra });

test("3.3 boarding: STAND는 있고 OUT이 없다 → 게이트에서 출발을 기다린다", () => {
  const f = one(input({ milestones: {}, progress: {} }));
  assert.equal(f.state, "boarding");
  assert.equal(f.t, 0);
  assert.equal(f.aircraft, "TEAM_A");
  assert.equal(f.callsign, "CALL A");
  assert.equal(f.airport, "ATCC");
});

test("3.3 cruise: work 구간의 t는 진행 막대 marker에서만 온다(몫 0.5 → t 0.5)", () => {
  const f = one(input());
  assert.equal(f.state, "cruise");
  near(f.t, 0.5);
  assert.equal(f.late, false);
  assert.deepEqual(f.blocks, []);
});

test("3.3 cruise, 추정 없음: t는 0이고 어디에도 퍼센트나 ETA가 없다", () => {
  const f = one(input({ progress: { "ATC-1": prog("work", null, { elapsedMin: 12 }) } }));
  assert.equal(f.state, "cruise");
  assert.equal(f.t, 0);
  assert.deepEqual(Object.keys(f).sort(), ["aircraft", "airport", "blocks", "callsign", "fadeFrom", "key", "landBy", "landWhy", "late", "outbound", "reverted", "state", "t"]);
});

test("3.3 cruise, late: IAF 앞에서 멈추고(t ≤ CRUISE_CAP) late가 켜진다. 홀딩이 아니다", () => {
  const f = one(input({ progress: { "ATC-1": prog("work", 1, { late: true, elapsedMin: 90 }) } }));
  assert.equal(f.state, "cruise");
  assert.equal(f.late, true);
  near(f.t, CRUISE_CAP);
});

test("3.3 hold: AIRCRAFT가 STAND를 쥔 채 idle(holding)이면 지금 자리에서 홀딩", () => {
  const f = one(input({ aircraft: [air("TEAM_A", "idle", ["ATC-1"])] }));
  assert.equal(f.state, "hold");
  near(f.t, 0.5);
});

test("3.3 hold: 열린 HOLD CLEARANCE도 홀딩. CONTINUE·LAND가 뒤따르거나 취소되면 닫힌다", () => {
  assert.equal(one(input({ clearances: [clr("HOLD", 10)] })).state, "hold");
  assert.equal(one(input({ clearances: [clr("HOLD", 10), clr("CONTINUE", 5)] })).state, "cruise");
  assert.equal(one(input({ clearances: [clr("HOLD", 10), clr("LAND", 5)] })).state, "cruise");
  assert.equal(one(input({ clearances: [clr("HOLD", 10, { cancelledAt: ago(9) })] })).state, "cruise");
  assert.equal(one(input({ clearances: [clr("HOLD", 10, { flight: "ATC-2" })] })).state, "cruise"); // 다른 FLIGHT의 HOLD
  assert.equal(one(input({ clearances: [clr("CONTINUE", 20), clr("HOLD", 10)] })).state, "hold"); // CONTINUE가 먼저면 HOLD가 열려 있다
});

test("3.3 nordo: 죽은 세션이면 NORDO(회색, 움직이지 않음)", () => {
  const f = one(input({ aircraft: [air("TEAM_A", "dead", ["ATC-1"])] }));
  assert.equal(f.state, "nordo");
  near(f.t, 0.5); // 멈춘 자리
  assert.equal(one(input({ milestones: {}, progress: {}, aircraft: [air("TEAM_A", "dead", ["ATC-1"])] })).state, "nordo"); // 게이트에서 죽어도
});

test("3.3 final: landing 구간 + PR CLEARED → IAF에서 활주로로, 위치는 landing marker", () => {
  const f = one(input({ milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.4) }, pulls: [pull("CLEARED")] }));
  assert.equal(f.state, "final");
  near(f.t, 0.4);
  assert.deepEqual(f.blocks, []);
});

test("3.3 final, 추정 없음이나 오래 걸림: t는 0이거나 활주로 앞에서 멈춘다", () => {
  const m = { "ATC-1": ms({ out: ago(60), off: ago(20) }) };
  assert.equal(one(input({ milestones: m, progress: { "ATC-1": prog("landing", null) }, pulls: [pull("CLEARED")] })).t, 0);
  const late = one(input({ milestones: m, progress: { "ATC-1": prog("landing", 1, { late: true }) }, pulls: [pull("CLEARED")] }));
  near(late.t, CRUISE_CAP);
  assert.equal(late.late, true);
});

test("3.3 landing + PR APPROACH(막힘): IAF에서 홀딩하고 막는 조건 코드를 싣는다", () => {
  const f = one(input({ milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.2) }, pulls: [pull("APPROACH", ["checks-pending", "no-review"])] }));
  assert.equal(f.state, "hold");
  assert.equal(f.t, 1);
  assert.deepEqual(f.blocks, ["checks-pending", "no-review"]);
});

test("3.3 goAround: 최근 30분의 GO AROUND CLEARANCE, 또는 dirty·behind 블록. 새 head가 CLEARED면 끝", () => {
  const m = { "ATC-1": ms({ out: ago(60), off: ago(20) }) };
  const p = { "ATC-1": prog("landing", 0.2) };
  const base = { milestones: m, progress: p };
  // CLEARANCE + 아직 APPROACH
  assert.equal(one(input({ ...base, pulls: [pull("APPROACH", ["checks-pending"])], clearances: [clr("GO AROUND", 5)] })).state, "goAround");
  // landing.conflict에 해당하는 dirty·behind
  assert.equal(one(input({ ...base, pulls: [pull("APPROACH", ["dirty"])] })).state, "goAround");
  assert.equal(one(input({ ...base, pulls: [pull("APPROACH", ["behind", "checks-pending"])] })).state, "goAround");
  // 30분이 지난 GO AROUND는 세지 않는다 → 막힘(홀딩)
  const old = one(input({ ...base, pulls: [pull("APPROACH", ["checks-pending"])], clearances: [clr("GO AROUND", GO_AROUND_MIN + 1)] }));
  assert.equal(old.state, "hold");
  // 새 head가 CLEARED가 되면 GO AROUND는 끝나고 final
  assert.equal(one(input({ ...base, pulls: [pull("CLEARED")], clearances: [clr("GO AROUND", 5)] })).state, "final");
  // 취소된 GO AROUND는 세지 않는다
  assert.equal(one(input({ ...base, pulls: [pull("APPROACH", ["checks-pending"])], clearances: [clr("GO AROUND", 5, { cancelledAt: ago(4) })] })).state, "hold");
  const g = one(input({ ...base, pulls: [pull("APPROACH", ["dirty"])] }));
  assert.equal(g.t, 0);
  assert.deepEqual(g.blocks, ["dirty"]); // 블록 코드가 같이 간다
});

test("3.3 ON(머지): RTS가 따르는 FLIGHT는 활주로에서 게이트로 taxi, t는 0(추정 없음)", () => {
  const f = one(input({ milestones: { "ATC-1": ms({ out: ago(60), off: ago(30), on: ago(5) }) }, progress: { "ATC-1": prog("rts", null, { elapsedMin: 5 }) } }));
  assert.equal(f.state, "taxi");
  assert.equal(f.t, 0);
});

test("3.3 IN: 게이트에서 30분 동안 서서히 사라진다. fadeFrom은 IN이고, 30분이 지나면 빠진다", () => {
  const m = ms({ out: ago(90), off: ago(60), on: ago(40), in: ago(10) });
  const f = one(input({ milestones: { "ATC-1": m }, progress: { "ATC-1": prog("done", null) } }));
  assert.equal(f.state, "arrived");
  assert.equal(f.fadeFrom, m.in);
  assert.equal(flightsOf(input({ milestones: { "ATC-1": ms({ ...m, in: ago(ARRIVED_FADE_MIN + 1) }) }, progress: { "ATC-1": prog("done", null) } }), airports).length, 0);
  assert.equal(flightsOf(input({ milestones: { "ATC-1": ms({ ...m, in: ago(ARRIVED_FADE_MIN - 1) }) }, progress: { "ATC-1": prog("done", null) } }), airports).length, 1);
});

test("3.3 ON, 뒤따르는 RTS 없음(done): fadeFrom은 ON. 되돌려졌으면 reverted를 싣는다", () => {
  const rev = { number: 9, url: "https://example.test/9", at: ago(2) };
  const m = ms({ out: ago(90), off: ago(60), on: ago(8), reverted: rev });
  const f = one(input({ milestones: { "ATC-1": m }, progress: { "ATC-1": prog("done", null) } }));
  assert.equal(f.state, "arrived");
  assert.equal(f.fadeFrom, m.on);
  assert.equal(f.reverted, true);
  assert.equal(one(input()).reverted, false);
});

test("3.3 AIRCRAFT without a FLIGHT: 세워 둔다. FLIGHT가 그려지면 parked에서 빠지고, 사라지면 다시 parked", () => {
  const aircraft = [
    { registration: "TEAM_A", callsign: "CALL A", base: "ATCC", flying: true, retired: false },
    { registration: "TEAM_B", callsign: "CALL B", base: "ATCC", flying: false, retired: false },
  ];
  const at = new Date(NOW);
  const sessions = [{ repo: "/p/atc", status: "busy" as const }];
  const flying = globeSceneOf({ at, airports, sessions, aircraft, flights: input() });
  assert.deepEqual(flying.flights.map((f) => f.key), ["ATC-1"]);
  assert.deepEqual(flying.parked.map((p) => p.registration), ["TEAM_B"]);
  // 도착한 지 30분이 지난 FLIGHT는 그려지지 않으니 그 AIRCRAFT는 다시 세워 둔다(STAND를 쥐고 있어도)
  const faded = globeSceneOf({ at, airports, sessions, aircraft, flights: input({ milestones: { "ATC-1": ms({ out: ago(200), in: ago(100) }) }, progress: { "ATC-1": prog("done", null) } }) });
  assert.equal(faded.flights.length, 0);
  assert.deepEqual(faded.parked.map((p) => p.registration), ["TEAM_A", "TEAM_B"]);
  // flights 입력이 없으면(G1) flights는 비고 flying 표시로 가른다
  const g1 = globeSceneOf({ at, airports, sessions, aircraft });
  assert.deepEqual(g1.flights, []);
  assert.deepEqual(g1.parked.map((p) => p.registration), ["TEAM_B"]);
});

test("놓을 자리가 없거나 닫힌 이슈의 지난 FLIGHT는 빠진다. STAND 없는 FLIGHT는 aircraft null", () => {
  assert.equal(flightsOf(input({ workspaces: [], pulls: [] }), airports).length, 0); // AIRPORT를 모른다
  const closed = input({ tickets: [{ key: "ATC-1", stateType: "completed" }] });
  assert.equal(flightsOf(closed, airports).length, 0);
  // 닫힌 이슈라도 막 도착한 FLIGHT는 사라지는 중이라 그린다
  const justDone = input({ tickets: [{ key: "ATC-1", stateType: "completed" }], milestones: { "ATC-1": ms({ out: ago(90), on: ago(3) }) }, progress: { "ATC-1": prog("done", null) } });
  assert.equal(flightsOf(justDone, airports)[0].state, "arrived");
  const free = one(input({ aircraft: [], pulls: [pull("CLEARED")], milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.3) } }));
  assert.equal(free.aircraft, null);
  assert.equal(free.callsign, null);
  assert.equal(free.state, "final");
});

test("다른 AIRPORT의 FLIGHT는 자기 AIRPORT 코드로 간다(PR의 저장소로도 찾는다)", () => {
  const f = flightsOf(
    input({ key: "ABC-7", tickets: [{ key: "ABC-7", stateType: "started" }], workspaces: [{ ticketKey: "ABC-7", repo: "/p/abcd", isMain: false }], aircraft: [air("TEAM_A", "busy", ["ABC-7"])], milestones: { "ABC-7": ms({ out: ago(5) }) }, progress: { "ABC-7": prog("work", 0.1) } }),
    airports,
  );
  assert.equal(f[0].airport, "ABCD");
  const viaPull = flightsOf(input({ workspaces: [], pulls: [{ ticketKey: "ATC-1", repo: "/p/abcd", landing: "CLEARED", blocks: [] }], milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.5) } }), airports);
  assert.equal(viaPull[0].airport, "ABCD");
});

test("outboundBearings: 같은 key는 같은 방위, 같은 AIRPORT의 FLIGHT끼리는 25° 넘게 떨어지고, 뒤 key가 늘어도 앞은 안 바뀐다", () => {
  const keys = Array.from({ length: 8 }, (_, i) => `ATC-${100 + i}`);
  const a = outboundBearings(keys);
  assert.deepEqual([...a], [...outboundBearings([...keys].reverse())]);
  const vals = [...a.values()];
  for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) assert.ok(Math.abs(((vals[i] - vals[j] + 540) % 360) - 180) >= 25 - 1e-9, `${vals[i]} ${vals[j]}`);
  const more = outboundBearings([...keys, "ATC-999"]);
  for (const k of keys) assert.equal(more.get(k), a.get(k));
  assert.ok(vals.every((v) => v >= 0 && v < 360));
});

test("outbound는 FLIGHT가 늘어도 안정이다(장면에 실린 값)", () => {
  const two = flightsOf(
    input({ aircraft: [air("TEAM_A", "busy", ["ATC-1"]), air("TEAM_B", "busy", ["ATC-2"])], workspaces: [{ ticketKey: "ATC-1", repo: "/p/atc", isMain: false }, { ticketKey: "ATC-2", repo: "/p/atc", isMain: false }], milestones: { "ATC-1": ms({ out: ago(5) }), "ATC-2": ms({ out: ago(5) }) }, progress: { "ATC-1": prog("work", 0.1), "ATC-2": prog("work", 0.2) } }),
    airports,
  );
  const alone = one(input());
  assert.equal(two.find((f) => f.key === "ATC-1")!.outbound, alone.outbound);
});

// ── 바퀴의 모양 ──
import { bearingDeg, circuitOf, circuitSize, distanceDeg, pointAlong, racetrack, RUNWAY_HALF, type LatLon } from "./globe.ts";

test("circuitSize: 가장 가까운 AIRPORT 거리의 0.35배를 2°~7°로 묶고, 다른 AIRPORT가 없으면 20°로 친다", () => {
  near(circuitSize(10), 3.5);
  assert.equal(circuitSize(3), 2);
  assert.equal(circuitSize(60), 7);
  near(circuitSize(null), 7);
});

test("circuitOf: 최종은 활주로 방향으로 들어오고, 출발은 AIRPORT·회전점은 outbound 방위", () => {
  const apt: LatLon = { lat: 20, lon: 30 };
  const c = circuitOf(apt, 70, 200, 4);
  assert.deepEqual(c.cruise[0], apt);
  near(distanceDeg(apt, c.cruise[1]), 4, 1e-6);
  near(bearingDeg(apt, c.cruise[1]), 200, 1e-4);
  near(bearingDeg(c.iaf, apt), 70, 1.5); // IAF에서 AIRPORT를 보는 방위가 활주로 방향
  near(distanceDeg(c.runwayStart, c.runwayEnd), 2 * RUNWAY_HALF, 1e-6);
  assert.deepEqual(c.final, [c.iaf, apt]);
  assert.equal(c.cruise[2], c.iaf);
  assert.deepEqual(c.taxi[0], c.runwayEnd);
  assert.deepEqual(c.taxi[1], c.gate);
  assert.equal(c.missed[c.missed.length - 1], c.iaf); // 한 바퀴 돌아 IAF로
});

test("pointAlong: 끝점과 길이 몫, 진행 방위", () => {
  const path: LatLon[] = [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 10, lon: 10 }];
  near(pointAlong(path, 0).at.lon, 0, 1e-9);
  const mid = pointAlong(path, 0.5);
  near(mid.at.lon, 10, 1e-6); // 두 구간의 길이가 같아서 가운데가 꺾이는 점
  near(mid.at.lat, 0, 1e-6);
  near(pointAlong(path, 0.25).heading, 90, 0.5); // 동쪽으로 간다
  near(((pointAlong(path, 0.75).heading + 180) % 360) - 180, 0, 0.5); // 북쪽으로 간다
  const end = pointAlong(path, 1);
  near(end.at.lat, 10, 1e-6);
  near(((end.heading + 180) % 360) - 180, 0, 0.5);
  assert.deepEqual(pointAlong([{ lat: 3, lon: 4 }], 0.5).at, { lat: 3, lon: 4 });
  assert.equal(pointAlong(path, -1).at.lon, 0); // 범위 밖은 끝점
});

test("racetrack: 닫힌 타원 — 길이 방향으로 length, 폭 방향으로 width(+반원)", () => {
  const c: LatLon = { lat: 10, lon: 20 };
  const r = racetrack(c, 90, 2, 0.8);
  const lons = r.map((p) => p.lon - c.lon);
  const lats = r.map((p) => p.lat - c.lat);
  near(Math.max(...lons) - Math.min(...lons), 2 + 0.8, 0.1);
  near(Math.max(...lats) - Math.min(...lats), 0.8, 0.05);
  assert.ok(r.length >= 10);
  // 모든 꼭짓점이 중심에서 length/2 + width/2 안에 있다
  assert.ok(r.every((p) => distanceDeg(c, p) <= 1.5));
});

// ── ATC-300: 누가 착륙시키나 ──
const MCC_REPO = "/p/atc";
const mccInfo = (over: Partial<MccLandInfo> = {}, tiers: Record<number, "auto" | "flagged" | "user"> = {}): MccLandInfo => ({
  repo: MCC_REPO, mode: "land+rts", holds: [], escalated: [], tiers: new Map(Object.entries(tiers).map(([n, tier]) => [Number(n), { head: `head${n}`, tier }])), ...over,
});
// 열린 PR 하나가 landing 구간에서 APPROACH인 FLIGHT. 번호·head가 있어야 landBy를 셈한다
const landing = (mcc: MccLandInfo | null, num: number, over: { repo?: string; head?: string; landing?: "CLEARED" | "APPROACH"; teamsMerge?: boolean } = {}) =>
  one(
    input({
      milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) },
      progress: { "ATC-1": prog("landing", 0.2) },
      pulls: [{ ...pull(over.landing ?? "APPROACH", over.landing === "CLEARED" ? [] : ["no-review"]), repo: over.repo ?? MCC_REPO, number: num, head: over.head ?? `head${num}` }],
      land: (p) => landDecisionOf(p, mcc, over.teamsMerge ?? true),
    }),
  );

test("ATC-300 landBy·landWhy: landWhy 코드마다 FLIGHT 하나(user, escalate, hold, mode, tier-unknown, teams-merge-off), 그리고 mcc와 holder", () => {
  const cases: [string, ReturnType<typeof landing>, string | null, string | null][] = [
    ["user", landing(mccInfo({}, { 1: "user" }), 1), "supervisor", "user"],
    ["escalate", landing(mccInfo({ escalated: [2] }, { 2: "auto" }), 2), "supervisor", "escalate"],
    ["hold", landing(mccInfo({ holds: [3] }, { 3: "auto" }), 3), "supervisor", "hold"],
    ["mode", landing(mccInfo({ mode: "shadow" }, { 4: "auto" }), 4), "supervisor", "mode"],
    ["tier-unknown", landing(mccInfo({}, {}), 5), "supervisor", "tier-unknown"],
    ["teams-merge-off", landing(null, 6, { repo: "/p/abcd", teamsMerge: false }), "supervisor", "teams-merge-off"],
    ["mcc auto", landing(mccInfo({}, { 7: "auto" }), 7), "mcc", null],
    ["mcc flagged", landing(mccInfo({}, { 8: "flagged" }), 8), "mcc", null],
    ["holder", landing(mccInfo({}, { 9: "auto" }), 9, { repo: "/p/abcd" }), "holder", null],
  ];
  for (const [name, f, by, why] of cases) assert.deepEqual([f.landBy, f.landWhy], [by, why], name);
});

test("ATC-300 landBy: 등급을 잰 뒤 head가 바뀌었으면(옛 등급) supervisor와 tier-unknown", () => {
  const f = landing(mccInfo({}, { 1: "auto" }), 1, { head: "newhead" });
  assert.deepEqual([f.landBy, f.landWhy], ["supervisor", "tier-unknown"]);
});

test("ATC-300 landBy: CLEARED인 final도 SUPERVISOR가 머지해야 하면 표시한다(user 등급)", () => {
  const f = landing(mccInfo({}, { 1: "user" }), 1, { landing: "CLEARED" });
  assert.equal(f.state, "final");
  assert.deepEqual([f.landBy, f.landWhy], ["supervisor", "user"]);
});

test("ATC-300 landBy: landing 구간 밖(cruise, boarding, taxi, arrived, nordo)과 열린 PR이 없으면 null, land 콜백이 없어도 null", () => {
  const land = (p: { repo: string; number: number; head: string }) => landDecisionOf(p, mccInfo({}, { 1: "user" }), true);
  const pr1 = { ...pull("APPROACH", ["no-review"]), number: 1, head: "head1" };
  const none = { landBy: null, landWhy: null };
  const pick = (f: ReturnType<typeof one>) => ({ landBy: f.landBy, landWhy: f.landWhy });
  // work 구간에 열린 PR이 (먼저) 있어도 cruise
  assert.deepEqual(pick(one(input({ pulls: [pr1], land }))), none);
  // OUT 전 boarding
  assert.deepEqual(pick(one(input({ milestones: {}, progress: {}, land }))), none);
  // rts(taxi)
  assert.deepEqual(pick(one(input({ milestones: { "ATC-1": ms({ out: ago(90), off: ago(60), on: ago(10) }) }, progress: { "ATC-1": prog("rts", 0) }, land }))), none);
  // done(arrived)
  assert.deepEqual(pick(one(input({ milestones: { "ATC-1": ms({ out: ago(90), off: ago(60), on: ago(20), in: ago(10) }) }, progress: { "ATC-1": prog("done", null) }, land }))), none);
  // 죽은 세션(nordo)
  assert.deepEqual(pick(one(input({ aircraft: [air("TEAM_A", "dead", ["ATC-1"])], milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.2) }, pulls: [pr1], land }))), none);
  // landing 구간인데 PR이 없다(열린 HOLD로 홀딩)
  assert.deepEqual(pick(one(input({ milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.2) }, clearances: [clr("HOLD", 5)], land }))), none);
  // land 콜백이 없으면(G1·옛 호출) landing 구간의 PR이 있어도 null
  assert.deepEqual(pick(one(input({ milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.2) }, pulls: [pr1] }))), none);
  // PR 번호·head를 모르는 입력(옛 테스트 모양)은 셈하지 않는다
  assert.deepEqual(pick(one(input({ milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.2) }, pulls: [pull("APPROACH", ["no-review"])], land }))), none);
});

test("ATC-300 goAround도 landBy를 싣는다(GO AROUND 뒤에도 누가 착륙시키는지)", () => {
  const f = one(input({
    milestones: { "ATC-1": ms({ out: ago(60), off: ago(20) }) }, progress: { "ATC-1": prog("landing", 0.2) },
    pulls: [{ ...pull("APPROACH", ["dirty"]), number: 1, head: "head1" }], land: (p) => landDecisionOf(p, mccInfo({}, { 1: "user" }), true),
  }));
  assert.equal(f.state, "goAround");
  assert.deepEqual([f.landBy, f.landWhy], ["supervisor", "user"]);
});
