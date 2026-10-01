import assert from "node:assert/strict";
import { test } from "node:test";
import { LAND } from "../web/src/views/globe-land.ts";
import {
  antisolarPoint,
  bearingDeg,
  capRing,
  clipPolyline,
  clipRing,
  defaultHome,
  destination,
  distanceDeg,
  globeSceneOf,
  hash32,
  layoutAirports,
  normLon,
  nightRing,
  placeAirports,
  PLACE_MAX_ARC,
  PLACE_MIN_ARC,
  PLACE_MIN_SEP,
  project,
  slerp,
  subsolarPoint,
  unproject,
  type LatLon,
} from "./globe.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("project: 중심은 원점, 동쪽은 오른쪽, 북쪽은 위쪽, 뒷면은 depth ≤ 0", () => {
  const v: LatLon = { lat: 20, lon: 30 };
  const c = project(v, v);
  near(c.x, 0);
  near(c.y, 0);
  near(c.depth, 1);
  assert.ok(project({ lat: 20, lon: 50 }, v).x > 0);
  assert.ok(project({ lat: 40, lon: 30 }, v).y > 0);
  assert.ok(project({ lat: -20, lon: 210 }, v).depth < 0);
  const edge = project({ lat: 0, lon: 90 }, { lat: 0, lon: 0 }); // 중심에서 90°: 지평선 위
  near(edge.x, 1);
  near(edge.depth, 0);
});

test("project와 unproject는 앞면에서 서로 되돌린다", () => {
  const v: LatLon = { lat: -35, lon: 120 };
  for (const p of [{ lat: -30, lon: 100 }, { lat: 10, lon: 150 }, { lat: -80, lon: 120 }, { lat: -35, lon: 120 }]) {
    const q = project(p, v);
    assert.ok(q.depth > 0);
    const back = unproject(q, v)!;
    near(back.lat, p.lat, 1e-6);
    near(normLon(back.lon - p.lon), 0, 1e-6);
  }
  assert.equal(unproject({ x: 1, y: 1 }, v), null);
});

test("destination·bearing·distance: 서로 맞는다", () => {
  const a: LatLon = { lat: 10, lon: 20 };
  const b = destination(a, 75, 18);
  near(distanceDeg(a, b), 18, 1e-6);
  near(bearingDeg(a, b), 75, 1e-6);
  const north = destination({ lat: 0, lon: 0 }, 0, 30);
  near(north.lat, 30);
  near(north.lon, 0);
  const east = destination({ lat: 0, lon: 170 }, 90, 20);
  near(east.lon, -170);
});

test("slerp: 끝점과 가운데 점이 큰 원 위에 있다", () => {
  const a: LatLon = { lat: 0, lon: 0 };
  const b: LatLon = { lat: 0, lon: 90 };
  near(slerp(a, b, 0).lon, 0);
  near(slerp(a, b, 1).lon, 90);
  const m = slerp(a, b, 0.5);
  near(m.lat, 0);
  near(m.lon, 45);
  const c = slerp({ lat: 60, lon: 0 }, { lat: 60, lon: 90 }, 0.5);
  assert.ok(c.lat > 60); // 큰 원은 같은 위도의 위선보다 극 쪽으로 휜다
  assert.deepEqual(slerp(a, a, 0.3), a);
});

test("clipPolyline: 지평선에서 잘리고 뒷면은 그리지 않는다", () => {
  const v: LatLon = { lat: 0, lon: 0 };
  const equator = Array.from({ length: 73 }, (_, i) => ({ lat: 0, lon: -180 + i * 5 }));
  const segs = clipPolyline(equator, v);
  assert.equal(segs.length, 1);
  const s = segs[0];
  assert.ok(s.every((p) => Math.hypot(p.x, p.y) <= 1 + 1e-9));
  near(s[0].x, -1);
  near(s[s.length - 1].x, 1);
  // 전부 뒷면이면 아무것도 없다
  assert.deepEqual(clipPolyline([{ lat: 0, lon: 150 }, { lat: 0, lon: 170 }], v), []);
  // 앞뒤로 두 번 지나는 선은 두 조각
  const wave = [{ lat: 0, lon: 0 }, { lat: 0, lon: 120 }, { lat: 0, lon: 240 }, { lat: 0, lon: 0 }];
  assert.equal(clipPolyline(wave, v).length, 2);
});

const areaOf = (r: { x: number; y: number }[]) => r.reduce((s, a, i) => s + (a.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * a.y), 0) / 2;
const box = (lat0: number, lon0: number, d: number): LatLon[] => [
  { lat: lat0 - d, lon: lon0 - d },
  { lat: lat0 - d, lon: lon0 + d },
  { lat: lat0 + d, lon: lon0 + d },
  { lat: lat0 + d, lon: lon0 - d },
];

test("clipRing: 앞면 고리는 그대로, 걸친 고리는 한계선을 따라 닫히고, 뒷면 고리는 없다", () => {
  const v: LatLon = { lat: 0, lon: 0 };
  const front = clipRing(box(0, 0, 10), v);
  assert.equal(front.length, 1);
  assert.equal(front[0].length, 4);
  assert.deepEqual(clipRing(box(0, 180, 10), v), []);
  const half = clipRing(box(0, 90, 40), v);
  assert.equal(half.length, 1);
  assert.ok(half[0].length > 4);
  assert.ok(half[0].every((p) => Math.hypot(p.x, p.y) <= 1 + 1e-9));
  assert.ok(half[0].some((p) => Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-9)); // 한계선 위의 점이 있다
  assert.ok(areaOf(half[0]) > 0); // 반시계 방향이면 넓이가 양수
});

test("clipRing: 지평선을 여러 번 드나드는 고리도 넓이가 맞다(반시계로 가장 가까운 들어오는 점에 잇는다)", () => {
  // 적도를 따라 한 바퀴 도는 두꺼운 띠(위도 ±20°): 원판의 한가운데를 가로지르는 띠
  const band: LatLon[] = [];
  for (let lon = -180; lon < 180; lon += 10) band.push({ lat: -20, lon });
  for (let lon = 170; lon >= -180; lon -= 10) band.push({ lat: 20, lon });
  const v: LatLon = { lat: 0, lon: 0 };
  const parts = clipRing(band, v);
  const total = parts.reduce((s, r) => s + areaOf(r), 0);
  // 위도 ±a 띠가 원판에서 차지하는 넓이: ∫∫ cosφ·cosλ·cosφ dφ dλ = 2(a + sin a cos a)
  const a = (20 * Math.PI) / 180;
  near(total, 2 * (a + Math.sin(a) * Math.cos(a)), 0.03);
  assert.ok(parts.every((r) => areaOf(r) > 0));
  // 육지 같은 바깥 고리 하나(북반구 큰 대륙)를 비스듬히 봐도 원판 넓이를 넘지 않는다
  const continent: LatLon[] = [];
  for (let lon = -170; lon <= 170; lon += 10) continent.push({ lat: 10, lon });
  for (let lon = 170; lon >= -170; lon -= 10) continent.push({ lat: 70, lon });
  for (const view of [{ lat: 12, lon: 34 }, { lat: 40, lon: 100 }, { lat: -30, lon: -60 }, { lat: 80, lon: 0 }]) {
    const t = clipRing(continent, view).reduce((s, r) => s + areaOf(r), 0);
    assert.ok(t >= -1e-9 && t <= Math.PI + 1e-9, `${JSON.stringify(view)} ${t}`);
  }
});

test("실제 육지: 어느 쪽에서 봐도 육지 넓이가 원판의 일부이고 조각은 모두 반시계다", () => {
  const rings = LAND.map((r) => Array.from({ length: r.length / 2 }, (_, i) => ({ lon: r[2 * i] / 10, lat: r[2 * i + 1] / 10 })));
  for (const v of [{ lat: 12, lon: 34 }, { lat: 0, lon: 135 }, { lat: 40, lon: -100 }, { lat: -25, lon: 140 }, { lat: 85, lon: 0 }, { lat: -85, lon: 0 }, { lat: 0, lon: 179 }]) {
    let land = 0;
    for (const ring of rings)
      for (const part of clipRing(ring, v)) {
        const a = areaOf(part);
        assert.ok(a > -1e-4, `${JSON.stringify(v)} 음수 조각 ${a}`);
        land += a;
      }
    const share = land / Math.PI;
    assert.ok(share > 0.03 && share < 0.65, `${JSON.stringify(v)} 육지 비율 ${share.toFixed(2)}`);
  }
});

test("밤 모자: 해 반대편이 중심이면 원판 전체, 해 쪽으로 돌리면 일부만 덮는다", () => {
  const at = Date.UTC(2026, 5, 21, 12, 0, 0);
  const sun = subsolarPoint(at);
  const night = nightRing(at);
  // 해 쪽으로 100° 돌린 시점이면 밤은 원판의 일부만 덮는다
  const away = destination(night.center, bearingDeg(night.center, sun), 100);
  const part = clipRing(night.ring, away, distanceDeg(away, night.center) < 90);
  const partArea = part.reduce((s, r) => s + areaOf(r), 0);
  assert.ok(partArea > 0 && partArea < Math.PI / 2);
  // 반대편을 보면 원판 전체가 밤이다
  const full = clipRing(night.ring, night.center, true);
  near(full.reduce((s, r) => s + areaOf(r), 0), Math.PI, 0.1);
  // 해를 보면 밤이 없다(밤 반구는 containsCenter가 거짓이고 고리는 전부 지평선 위나 뒤)
  assert.deepEqual(clipRing(night.ring, sun, false), []);
});

test("subsolarPoint: 분점·지점과 균시차", () => {
  // 2026-03-20 14:46 UTC 춘분: 적위 ≈ 0
  near(subsolarPoint(Date.UTC(2026, 2, 20, 14, 46)).lat, 0, 0.2);
  // 하지 근처: 적위 ≈ +23.4
  near(subsolarPoint(Date.UTC(2026, 5, 21, 12, 0)).lat, 23.4, 0.1);
  // 동지 근처
  near(subsolarPoint(Date.UTC(2026, 11, 21, 12, 0)).lat, -23.4, 0.1);
  // 10월 1일 정오(UTC): 균시차 ≈ +10분이라 해가 본초 자오선을 이미 지나 서쪽(≈ −2.5°)에 있다. 적위 ≈ −3
  const oct = subsolarPoint(Date.UTC(2026, 9, 1, 12, 0));
  near(oct.lon, -2.5, 0.6);
  near(oct.lat, -3, 0.5);
  // 6시간 뒤에는 약 90° 서쪽
  near(normLon(subsolarPoint(Date.UTC(2026, 9, 1, 18, 0)).lon - oct.lon), -90, 0.1);
  assert.deepEqual(antisolarPoint({ lat: 10, lon: 170 }), { lat: -10, lon: -10 });
});

test("capRing: 중심에서 반지름만큼 떨어진 점들", () => {
  const c: LatLon = { lat: 20, lon: 40 };
  for (const p of capRing(c, 90, 36)) near(distanceDeg(c, p), 90, 1e-6);
});

test("layoutAirports: 같은 입력은 같은 출력, 순서와 무관, 홈은 거리 0", () => {
  const ids = ["root-c", "root-a", "root-d", "root-b", "root-e"];
  const a = layoutAirports(ids, "root-a");
  const b = layoutAirports([...ids].reverse(), "root-a");
  assert.deepEqual(a, b);
  assert.deepEqual(layoutAirports(ids, "root-a"), a);
  const home = a.find((p) => p.id === "root-a")!;
  assert.equal(home.distance, 0);
  for (const p of a.filter((x) => x.id !== "root-a")) {
    assert.ok(p.distance >= PLACE_MIN_ARC - 1e-9);
    assert.ok(p.bearing >= 0 && p.bearing < 360);
  }
  for (const p of a) assert.ok(p.runway >= 0 && p.runway < 180);
});

test("layoutAirports: 서로 최소 간격 이상 떨어지고, 한 AIRPORT가 늘어도 앞의 자리는 안 바뀐다", () => {
  const ids = Array.from({ length: 14 }, (_, i) => `repo-${String(i).padStart(2, "0")}`);
  const places = layoutAirports(ids, "repo-05");
  const hub: LatLon = { lat: 0, lon: 0 };
  const at = placeAirports(hub, places);
  const list = [...at];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) assert.ok(distanceDeg(list[i][1], list[j][1]) >= PLACE_MIN_SEP - 1e-6, `${list[i][0]} ${list[j][0]}`);
  // id 순서로 놓으므로 맨 뒤에 새 id가 붙으면 앞의 자리는 그대로
  const more = layoutAirports([...ids, "repo-99"], "repo-05");
  for (const p of places) assert.deepEqual(more.find((x) => x.id === p.id), p);
  assert.ok(Math.max(...places.map((p) => p.distance)) <= PLACE_MAX_ARC + 11);
});

test("layoutAirports: 홈이 없으면 허브에 아무것도 놓지 않는다", () => {
  const a = layoutAirports(["x", "y"], null);
  assert.ok(a.every((p) => p.distance >= PLACE_MIN_ARC));
  assert.deepEqual(layoutAirports([], "x"), []);
});

test("placeAirports: 허브 기준 상대 배치이고, 옮긴 자리가 이긴다", () => {
  const places = layoutAirports(["a", "b", "c"], "a");
  const hub: LatLon = { lat: 37, lon: -122 };
  const at = placeAirports(hub, places);
  assert.deepEqual(at.get("a"), hub);
  for (const p of places.filter((x) => x.id !== "a")) {
    near(distanceDeg(hub, at.get(p.id)!), p.distance, 1e-6);
    near(bearingDeg(hub, at.get(p.id)!), p.bearing, 1e-4);
  }
  const moved = placeAirports(hub, places, { b: { lat: 1, lon: 2 } });
  assert.deepEqual(moved.get("b"), { lat: 1, lon: 2 });
  assert.deepEqual(moved.get("c"), at.get("c"));
  // 간격은 허브를 어디에 두어도 같다
  const other = placeAirports({ lat: -50, lon: 80 }, places);
  near(distanceDeg(at.get("b")!, at.get("c")!), distanceDeg(other.get("b")!, other.get("c")!), 1e-6);
});

test("hash32: 안정된 값", () => {
  assert.equal(hash32("a"), 0xe40c292c);
  assert.equal(hash32("a"), hash32("a"));
  assert.notEqual(hash32("a"), hash32("b"));
});

const airports = [
  { id: "id-atcc", code: "ATCC", name: "atc", repo: "/p/atc" },
  { id: "id-voco", code: "VOCO", name: "vocado", repo: "/p/vocado" },
  { id: "id-abcd", code: "ABCD", name: "abcd", repo: "/p/abcd" },
];

test("defaultHome: 살아 있는 세션이 가장 많은 AIRPORT, 동률은 코드순, 세션이 없으면 코드순 첫 곳", () => {
  const s = (repo: string | null, status: "busy" | "idle" | "dead" = "busy") => ({ repo, status });
  assert.equal(defaultHome(airports, [s("/p/vocado"), s("/p/vocado"), s("/p/atc")]), "VOCO");
  assert.equal(defaultHome(airports, [s("/p/vocado"), s("/p/atc")]), "ATCC");
  assert.equal(defaultHome(airports, [s("/p/vocado", "dead"), s("/p/vocado", "dead"), s("/p/atc")]), "ATCC");
  assert.equal(defaultHome(airports, [s(null), s("/elsewhere")]), "ABCD");
  assert.equal(defaultHome([], []), null);
});

test("globeSceneOf: home, airports, parked", () => {
  const at = new Date("2026-10-01T03:00:00Z");
  const aircraft = [
    { registration: "TEAM_A", callsign: "TEAM_A", base: "ATCC", flying: false, retired: false },
    { registration: "TEAM_B", callsign: "TEAM_B", base: "ATCC", flying: true, retired: false }, // FLIGHT 중
    { registration: "TEAM_C", callsign: "TEAM_C", base: "VOCO", flying: false, retired: false },
    { registration: "TEAM_D", callsign: "TEAM_D", base: null, flying: false, retired: false }, // base 없음
    { registration: "TEAM_E", callsign: "TEAM_E", base: "GONE", flying: false, retired: false }, // 모르는 AIRPORT
    { registration: "TEAM_F", callsign: "TEAM_F", base: "ATCC", flying: false, retired: true }, // 퇴역
  ];
  const sessions = [{ repo: "/p/atc", status: "busy" as const }];
  const scene = globeSceneOf({ at, airports, sessions, aircraft });
  assert.equal(scene.at, "2026-10-01T03:00:00.000Z");
  assert.equal(scene.home, "ATCC");
  assert.deepEqual(scene.airports.map((a) => a.code), ["ABCD", "ATCC", "VOCO"]);
  assert.equal(scene.airports.find((a) => a.code === "ATCC")!.distance, 0);
  assert.ok(scene.airports.filter((a) => a.code !== "ATCC").every((a) => a.distance >= PLACE_MIN_ARC));
  assert.deepEqual(scene.parked, [
    { registration: "TEAM_A", callsign: "TEAM_A", airport: "ATCC" },
    { registration: "TEAM_C", callsign: "TEAM_C", airport: "VOCO" },
  ]);
  const other = globeSceneOf({ at, airports, sessions, aircraft, home: "VOCO" });
  assert.equal(other.home, "VOCO");
  assert.equal(other.airports.find((a) => a.code === "VOCO")!.distance, 0);
  assert.equal(globeSceneOf({ at, airports, sessions, aircraft, home: "NOPE" }).home, "ATCC"); // 모르는 코드는 기본값
  assert.deepEqual(globeSceneOf({ at, airports, sessions, aircraft }), scene); // 같은 입력은 같은 출력
  const empty = globeSceneOf({ at, airports: [], sessions: [], aircraft });
  assert.deepEqual([empty.home, empty.airports, empty.parked], [null, [], []]);
});
