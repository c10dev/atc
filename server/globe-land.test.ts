import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRPORTS, TZ_CITY } from "../web/src/views/globe-geo.ts";
import { distanceDeg, LAND_BANDS, layoutAirports, PLACE_MIN_ARC, placeAirports, placeOnLand, tzCity, type LatLon } from "./globe.ts";

// 육지 위의 자리(ATC-291, docs/globe.md "Land placement as built")
const near = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const apLoc = (iata: string): LatLon => {
  const a = AIRPORTS.find((x) => x[0] === iata)!;
  return { lat: a[1] / 10, lon: a[2] / 10 };
};
const seoul = tzCity("Asia/Seoul", TZ_CITY)!;
const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];

test("tzCity: Asia/Seoul은 약 37.6°N 127.0°E, 링크도 풀리고, 모르는 이름은 null", () => {
  near(seoul.lat, 37.6, 0.11);
  near(seoul.lon, 127.0, 0.11);
  assert.ok(tzCity("Asia/Calcutta", TZ_CITY));
  assert.deepEqual(tzCity("Asia/Calcutta", TZ_CITY), tzCity("Asia/Kolkata", TZ_CITY));
  assert.equal(tzCity("Etc/GMT+5", TZ_CITY), null);
  assert.equal(tzCity(undefined, TZ_CITY), null);
});

test("placeOnLand: 서울 허브이면 모든 AIRPORT가 목록의 공항이고 띠 안에 있다", () => {
  const places = layoutAirports(ids, "a");
  const at = placeOnLand(seoul, places, AIRPORTS);
  assert.deepEqual(at.get("a"), { ...seoul });
  const used = new Set<string>();
  for (const p of places.filter((x) => x.id !== "a")) {
    const r = at.get(p.id)!;
    assert.ok(r.iata, p.id);
    assert.deepEqual({ lat: r.lat, lon: r.lon }, apLoc(r.iata));
    const d = distanceDeg(seoul, r);
    assert.ok(d >= PLACE_MIN_ARC - 1e-6 && d <= LAND_BANDS[LAND_BANDS.length - 1] + 1e-6, `${p.id} ${d}`);
    assert.ok(!used.has(r.iata), "같은 공항을 두 번 쓰지 않는다");
    used.add(r.iata);
  }
});

test("placeOnLand: 같은 입력은 같은 출력, AIRPORT가 붙어도 앞의 자리는 그대로", () => {
  const places = layoutAirports(ids, "a");
  const base = placeOnLand(seoul, places, AIRPORTS);
  assert.deepEqual([...base], [...placeOnLand(seoul, places, AIRPORTS)]);
  const more = placeOnLand(seoul, layoutAirports([...ids, "zz"], "a"), AIRPORTS);
  for (const [id, v] of base) assert.deepEqual(more.get(id), v);
});

test("placeOnLand: 옮긴 자리가 이긴다", () => {
  const moved = placeOnLand(seoul, layoutAirports(ids, "a"), AIRPORTS, { b: { lat: 1, lon: 2 } });
  assert.deepEqual(moved.get("b"), { lat: 1, lon: 2 });
});

test("placeOnLand: 45° 안에 공항이 없으면 해시 자리로 돌아가고, 있는 것만 공항에 놓인다", () => {
  const hub: LatLon = { lat: 0, lon: 150 };
  const places = layoutAirports(["a", "b", "c"], "a");
  assert.deepEqual([...placeOnLand(hub, places, [["XXX", 0, 0]])], [...placeAirports(hub, places)]);
  const far = placeOnLand(hub, places, [["XXX", 0, 0], ["NEA", 100, 1650]]); // NEA는 허브에서 15° 거리, XXX는 150°
  assert.equal(far.get("b")!.iata, "NEA");
  assert.equal(far.get("c")!.iata, undefined); // 후보가 하나뿐이면 b가 쓰고 c는 해시 자리
});

test("placeOnLand: 여러 시간대 도시 허브에서 모든 AIRPORT가 공항에 놓인다", () => {
  for (const tz of ["America/Denver", "Asia/Seoul", "Australia/Sydney", "America/Sao_Paulo", "Europe/London"]) {
    const hub = tzCity(tz, TZ_CITY)!;
    const at = placeOnLand(hub, layoutAirports(ids, "a"), AIRPORTS);
    for (const id of ids.slice(1)) assert.ok(at.get(id)!.iata, `${tz} ${id}`);
  }
});
