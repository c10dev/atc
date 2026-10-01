import assert from "node:assert/strict";
import { test } from "node:test";
import type { GlobeFlight } from "./globe.ts";
import {
  airportOfHash,
  assignGates,
  atAirport,
  callStateOf,
  gatePoints,
  lineOf,
  planeOf,
  planeSpot,
  pulsesOf,
  showCrosscheck,
  stationOf,
  stationPoint,
  VIEW_H,
  VIEW_W,
} from "./globe-radio.ts";
import type { Transmission } from "./radio.ts";

const NOW = Date.parse("2026-10-01T06:00:00.000Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const tx = (over: Partial<Transmission>): Transmission => ({ id: "C-1", at: ago(30), freq: "TOWER", from: "TOWER", to: "OCC", kind: "GO AROUND", head: "h", ...over }) as Transmission;
const flight = (key: string, over: Partial<GlobeFlight> = {}): GlobeFlight => ({
  key, airport: "ATCC", aircraft: "TEAM_A", callsign: "ALPHA", state: "cruise", t: 0.4, outbound: 10, late: false, blocks: [], fadeFrom: null, reverted: false, ...over,
});

test("stationOf: DELIVERY·COMPANY는 OCC, TOWER, GROUND는 MCC, PREFLIGHT는 CROSSCHECK, 모르는 주파수는 일반 스테이션", () => {
  assert.equal(stationOf({ freq: "DELIVERY" }), "OCC");
  assert.equal(stationOf({ freq: "COMPANY" }), "OCC");
  assert.equal(stationOf({ freq: "TOWER" }), "TOWER");
  assert.equal(stationOf({ freq: "GROUND" }), "MCC");
  assert.equal(stationOf({ freq: "PREFLIGHT" }), "CROSSCHECK");
  assert.equal(stationOf({ freq: "SOMETHING-NEW" as never }), "RADIO");
  assert.equal(stationOf({ freq: undefined as never }), "RADIO");
  // 어떤 스테이션도 자리가 있다
  for (const s of ["OCC", "TOWER", "MCC", "CROSSCHECK", "RADIO"] as const) assert.ok(Number.isFinite(stationPoint(s).x));
});

test("callStateOf: 열린 호출은 open, overdueAt을 넘기면 overdue, 답과 닫힌 호출은 answered", () => {
  assert.equal(callStateOf({ open: true, overdueAt: new Date(NOW + 60_000).toISOString() }, NOW), "open");
  assert.equal(callStateOf({ open: true, overdueAt: new Date(NOW - 60_000).toISOString() }, NOW), "overdue");
  assert.equal(callStateOf({ open: true }, NOW), "open"); // overdueAt이 없으면 늦지 않았다
  assert.equal(callStateOf({ open: true, overdueAt: "nonsense" }, NOW), "open");
  assert.equal(callStateOf({ replyTo: "C-1" }, NOW), "answered");
  assert.equal(callStateOf({}, NOW), "answered"); // 닫힌 호출·한쪽 방송
  assert.equal(callStateOf({ open: true, replyTo: "C-1" }, NOW), "answered");
});

test("planeOf: flight 키가 먼저, 없으면 AIRCRAFT, AIRPORT가 적혀 있으면 같은 AIRPORT의 것, 없으면 null", () => {
  const fs = [flight("ATC-1", { aircraft: "TEAM_A" }), flight("ATC-2", { aircraft: "TEAM_B" }), flight("ATC-2", { aircraft: "TEAM_B", airport: "ATCA" })];
  assert.equal(planeOf({ flight: "ATC-2" }, fs)?.aircraft, "TEAM_B");
  assert.equal(planeOf({ flight: "ATC-2", airport: "ATCA" }, fs)?.airport, "ATCA");
  assert.equal(planeOf({ flight: "ATC-9", aircraft: "TEAM_A" }, fs)?.key, "ATC-1"); // flight이 없으면 AIRCRAFT로
  assert.equal(planeOf({ aircraft: "TEAM_B" }, fs)?.key, "ATC-2");
  assert.equal(planeOf({ flight: "ATC-9" }, fs), null);
  assert.equal(planeOf({}, fs), null);
  assert.equal(planeOf({ flight: "ATC-1" }, []), null);
});

test("pulsesOf: 창 안의 교신만, 시각순, 시각이 이상하거나 미래 먼 것은 버리고 AIRPORT는 교신 → 비행기 순", () => {
  const txs = [
    tx({ id: "a", at: ago(30), airport: "ATCA" }),
    tx({ id: "b", at: ago(200) }), // 창(120초) 밖
    tx({ id: "g", at: ago(3000), open: true, overdueAt: ago(2400), flight: "ATC-1" }), // 창 밖이어도 열린 호출은 답이 올 때까지 남는다
    tx({ id: "h", at: ago(3000), replyTo: "g" }), // 창 밖의 답은 아니다
    tx({ id: "c", at: "garbage" }),
    tx({ id: "d", at: ago(-3600) }), // 한 시간 뒤
    tx({ id: "e", at: ago(10), flight: "ATC-1", open: true, overdueAt: ago(1) }),
    tx({ id: "f", at: ago(60), freq: "WHATEVER" as never }),
  ];
  const p = pulsesOf(txs, [flight("ATC-1")], NOW, 120_000);
  assert.deepEqual(p.map((x) => x.tx.id), ["g", "f", "a", "e"]);
  assert.equal(p[0].state, "overdue");
  assert.equal(p[1].station, "RADIO"); // 모르는 주파수는 깨지지 않는다
  assert.equal(p[2].airport, "ATCA"); // 교신의 AIRPORT
  assert.equal(p[3].airport, "ATCC"); // 교신에 없어서 비행기의 AIRPORT
  assert.equal(p[3].state, "overdue");
  assert.equal(p[3].plane?.key, "ATC-1");
  assert.equal(p[2].plane, null);
  assert.deepEqual(atAirport(p, "ATCC").map((x) => x.tx.id), ["g", "e"]);
});

test("gatePoints·assignGates: 최소 4개, FLIGHT는 key 순, 세워 둔 AIRCRAFT는 그 뒤, 게이트는 겹치지 않는다", () => {
  assert.equal(gatePoints(0).length, 1);
  const g = assignGates([flight("ATC-2"), flight("ATC-1")], [{ registration: "TEAM_C" }]);
  assert.equal(g.all.length, 4);
  assert.deepEqual([g.flights.get("ATC-1"), g.flights.get("ATC-2"), g.parked.get("TEAM_C")], [g.all[0], g.all[1], g.all[2]]);
  const many = assignGates(Array.from({ length: 7 }, (_, i) => flight(`ATC-${i}`)), []);
  assert.equal(new Set(many.all.map((p) => p.x)).size, 7);
  for (const p of many.all) assert.ok(p.x >= 0 && p.x <= VIEW_W && p.y >= 0 && p.y <= VIEW_H);
});

test("planeSpot: 8가지 상태가 모두 뷰 안의 자리를 갖고, t는 서버가 준 것만 쓴다(도착을 짐작하지 않는다)", () => {
  const gate = { x: 300, y: 300 };
  const states = ["boarding", "cruise", "hold", "final", "goAround", "taxi", "arrived", "nordo"] as const;
  for (const s of states) {
    for (const t of [0, 0.5, 0.9, 1, -1, NaN]) {
      const p = planeSpot(s, t, gate);
      assert.ok(p.x >= 0 && p.x <= VIEW_W && p.y >= 0 && p.y <= VIEW_H, `${s} ${t}`);
      assert.ok(p.heading >= 0 && p.heading < 360, `${s} heading`);
    }
  }
  assert.deepEqual(planeSpot("boarding", 0, gate), { ...gate, heading: 180 });
  assert.deepEqual(planeSpot("arrived", 0.7, gate), { ...gate, heading: 180 });
  // cruise는 t가 커질수록 오른쪽 위로, final은 왼쪽에서 활주로로
  assert.ok(planeSpot("cruise", 0.8, gate).y < planeSpot("cruise", 0.2, gate).y);
  assert.ok(planeSpot("final", 0.8, gate).x > planeSpot("final", 0.2, gate).x);
  assert.ok(planeSpot("final", 0.9, gate).x < 230); // 활주로 앞에서 멈춘다
  // taxi의 t는 0이라 활주로(터치다운)에서 시작하고, 게이트 쪽으로 가면 y가 줄어든다
  assert.equal(planeSpot("taxi", 0, gate).y, 440);
  assert.ok(planeSpot("taxi", 0.99, gate).y < 440);
});

test("lineOf: 시설에서 비행기까지, 비행기를 모르면 선이 없다", () => {
  const p = pulsesOf([tx({ flight: "ATC-1", freq: "DELIVERY" })], [flight("ATC-1")], NOW, 120_000)[0];
  const l = lineOf(p, { x: 400, y: 300 });
  assert.deepEqual(l?.to, { x: 400, y: 300 });
  assert.equal(l?.from.x, stationPoint("OCC").x);
  assert.equal(lineOf(p, null), null);
  // MCC의 GROUND 방송(비행기·AIRPORT 없음, to ALL)은 활주로 가운데로
  const b = pulsesOf([tx({ id: "m", freq: "GROUND", from: "MCC", to: "ALL", kind: "LAND", pr: 7 })], [], NOW, 120_000)[0];
  assert.deepEqual(lineOf(b, null)?.to, { x: 450, y: 440 });
  assert.equal(lineOf(pulsesOf([tx({ id: "t", freq: "TOWER", to: "ALL" })], [], NOW, 120_000)[0], null), null); // MCC가 아니면 선이 없다
});

test("atAirport: 방송(AIRPORT·비행기 없이 ALL)은 모든 AIRPORT의 목록에 든다", () => {
  const ps = pulsesOf([tx({ id: "m", freq: "GROUND", from: "MCC", to: "ALL" }), tx({ id: "x", airport: "ATCA" }), tx({ id: "y", flight: "ATC-1" })], [flight("ATC-1")], NOW, 120_000);
  assert.deepEqual(atAirport(ps, "ATCC").map((p) => p.tx.id), ["m", "y"]);
  assert.deepEqual(atAirport(ps, "ATCA").map((p) => p.tx.id), ["m", "x"]);
});

test("showCrosscheck: PREFLIGHT 교신이 있을 때만", () => {
  assert.equal(showCrosscheck([{ freq: "TOWER" }, { freq: "GROUND" }]), false);
  assert.equal(showCrosscheck([{ freq: "TOWER" }, { freq: "PREFLIGHT" }]), true);
  assert.equal(showCrosscheck([]), false);
});

test("airportOfHash: #globe/<CODE>만, 대문자로", () => {
  assert.equal(airportOfHash("#globe/ATCC"), "ATCC");
  assert.equal(airportOfHash("globe/atcc/"), "ATCC");
  assert.equal(airportOfHash("#globe"), null);
  assert.equal(airportOfHash("#radio/ATCC"), null);
  assert.equal(airportOfHash("#globe/<script>"), null);
  assert.equal(airportOfHash("#globe/AB"), null);
});
