import assert from "node:assert/strict";
import { test } from "node:test";
import type { GlobeFlightState } from "./globe.ts";
import { EARTH_R, headingOf, layoutBodies, missedLoop, modeOf, ORBIT, ORBIT_SWEEP, PARK, parkLoop, PLANET_R, pointOf, polarOf, RING_MAX, RING_MIN, routeOf, SPACE_SIZE, starsOf } from "./space.ts";

const ap = (id: string, code: string, bearing: number, distance: number) => ({ id, code, name: id, bearing, distance, runway: 0 });
const scene = (airports: ReturnType<typeof ap>[], home: string | null = "ATCC") => ({ airports, home });
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("modeOf: 저장된 값이 우선, 처음이면 night 테마만 SPACE", () => {
  assert.equal(modeOf("globe", "night"), "globe");
  assert.equal(modeOf("space", "radar"), "space");
  assert.equal(modeOf(undefined, "night"), "space");
  assert.equal(modeOf(undefined, "radar"), "globe");
  assert.equal(modeOf("bogus", "night"), "space");
  assert.equal(modeOf(null, "cockpit"), "globe");
});

test("layoutBodies: 지구는 홈 AIRPORT가 가운데, 행성은 distance 순위로 궤도를 받고 각도는 bearing", () => {
  const s = scene([ap("c", "CCCC", 180, 30), ap("home", "ATCC", 10, 0), ap("a", "AAAA", 90, 12), ap("b", "BBBB", 270, 20)]);
  const bodies = layoutBodies(s);
  const by = Object.fromEntries(bodies.map((b) => [b.code, b]));
  assert.deepEqual([by.ATCC!.x, by.ATCC!.y, by.ATCC!.r, by.ATCC!.home], [0, 0, EARTH_R, true]);
  // 순위: A(12) < B(20) < C(30) → 안쪽 궤도부터
  assert.ok(by.AAAA!.ring < by.BBBB!.ring && by.BBBB!.ring < by.CCCC!.ring);
  assert.ok(by.AAAA!.ring > RING_MIN && by.CCCC!.ring < RING_MAX);
  assert.equal(by.AAAA!.r, PLANET_R);
  // bearing 90 = 오른쪽, 270 = 왼쪽, 180 = 아래(SVG y가 아래)
  near(by.AAAA!.x, by.AAAA!.ring);
  near(by.AAAA!.y, 0);
  near(by.BBBB!.x, -by.BBBB!.ring);
  near(by.CCCC!.y, by.CCCC!.ring);
  // 그날 그 자리: 입력 순서가 바뀌어도, 다시 계산해도 같다
  const again = layoutBodies(scene([...s.airports].reverse()));
  assert.deepEqual(Object.fromEntries(again.map((b) => [b.code, [b.x, b.y]])), Object.fromEntries(bodies.map((b) => [b.code, [b.x, b.y]])));
});

test("layoutBodies: 같은 distance는 id 순, 홈이 없으면 가장 가까운 것이 지구, AIRPORT가 없으면 빈 목록, 하나뿐이면 지구만", () => {
  const tie = layoutBodies(scene([ap("b", "BBBB", 0, 15), ap("a", "AAAA", 0, 15), ap("h", "ATCC", 0, 0)]));
  assert.deepEqual(tie.map((b) => b.code), ["ATCC", "AAAA", "BBBB"]);
  const noHome = layoutBodies(scene([ap("x", "XXXX", 0, 22), ap("y", "YYYY", 0, 14)], null));
  assert.equal(noHome[0]!.code, "YYYY");
  assert.equal(noHome[0]!.home, true);
  assert.deepEqual(layoutBodies(scene([])), []);
  assert.equal(layoutBodies(scene([ap("h", "ATCC", 0, 0)])).length, 1);
  // 행성이 하나여도 궤도는 가운데 줄
  const one = layoutBodies(scene([ap("h", "ATCC", 0, 0), ap("a", "AAAA", 0, 20)]));
  near(one[1]!.ring, (RING_MIN + RING_MAX) / 2);
});

test("polarOf: 발사 → 궤도 → 하강 → 착륙이 한 길로 이어진다(cruise 끝 = final 시작, final 끝 = 발사대)", () => {
  const out = 40;
  const pad = polarOf("boarding", 0, out);
  assert.deepEqual(pad, { r: 1, ang: out });
  assert.deepEqual(polarOf("cruise", 0, out), pad); // 발사
  const top = polarOf("cruise", 1, out);
  near(top.r, ORBIT);
  near(top.ang, out + ORBIT_SWEEP);
  const f0 = polarOf("final", 0, out);
  near(f0.r, top.r);
  near(f0.ang, top.ang);
  const land = polarOf("final", 1, out);
  near(land.r, 1);
  near(land.ang, out + 360); // 한 바퀴 돌아 발사대
  assert.equal(polarOf("arrived", 0, out).r, 1);
  assert.equal(polarOf("taxi", 1, out).ang, out);
  // 대기 궤도는 비행 궤도 바깥, 고리는 궤도를 넘지 않는다
  assert.equal(polarOf("hold", 1, out).r, PARK);
  assert.ok(PARK > ORBIT);
  assert.ok(missedLoop(out).every((p) => p.r >= 1 && p.r <= ORBIT + 1e-9));
  // t가 범위를 벗어나도 끝에 머문다
  assert.deepEqual(polarOf("cruise", 7, out), polarOf("cruise", 1, out));
  assert.deepEqual(polarOf("cruise", -1, out), polarOf("cruise", 0, out));
});

const STATES: GlobeFlightState[] = ["boarding", "cruise", "hold", "final", "goAround", "taxi", "arrived", "nordo"];

test("모든 FLIGHT 상태가 자리와 방향을 가진다(GLOBE와 같은 여덟 상태)", () => {
  for (const s of STATES) {
    for (const t of [0, 0.5, 0.9, 1]) {
      const p = pointOf({ x: 100, y: 100 }, PLANET_R, polarOf(s, t, 123));
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${s} ${t}`);
      const h = headingOf(s, t, 123);
      assert.ok(h >= 0 && h < 360, `${s} ${t} heading ${h}`);
    }
  }
  // 몸의 둘레 안: 지표(1)부터 대기 궤도(3)까지
  for (const s of STATES) {
    const r = polarOf(s, 0.5, 0).r;
    assert.ok(r >= 1 && r <= PARK, s);
  }
});

test("pointOf·headingOf: 위가 0°, 시계 방향. 발사대의 비행기는 바깥쪽을 향하고, 궤도의 비행기는 진행 방향", () => {
  const p = pointOf({ x: 10, y: 20 }, 10, { r: 2, ang: 90 });
  near(p.x, 30);
  near(p.y, 20);
  const up = pointOf({ x: 0, y: 0 }, 10, { r: 1, ang: 0 });
  near(up.y, -10);
  assert.equal(headingOf("boarding", 0, 90), 90);
  assert.equal(headingOf("arrived", 0, 350), 350);
  // 시계 방향 궤도: 오른쪽(90°)에 있을 때 아래쪽(180°)으로 간다. cruise가 ang=out+300t이므로 t로 그 자리를 만든다
  const h = headingOf("hold", 0.25, 15); // ang = 15 + 75 = 90
  assert.ok(Math.abs(h - 180) < 8, `hold heading ${h}`);
  // t = 1 끝에서도 방향이 계산된다
  assert.ok(Number.isFinite(headingOf("final", 1, 0)));
});

test("routeOf: 발사대에서 시작해 발사대로 끝나는 선", () => {
  const r = routeOf(200);
  near(r[0]!.r, 1);
  near(r.at(-1)!.r, 1);
  near(r[0]!.ang, 200);
  near(r.at(-1)!.ang, 560);
});

test("starsOf: 같은 시드는 같은 별, 화면 안, 움직이지 않는 고정 목록", () => {
  const a = starsOf(50);
  assert.deepEqual(a, starsOf(50));
  assert.notDeepEqual(a, starsOf(50, SPACE_SIZE, "other"));
  assert.equal(a.length, 50);
  assert.ok(a.every((s) => s.x >= 0 && s.x <= SPACE_SIZE && s.y >= 0 && s.y <= SPACE_SIZE && s.r > 0 && s.o > 0 && s.o <= 1));
});

test("parkLoop: 대기 궤도의 한 바퀴, 비행기가 있는 자리에서 시작한다", () => {
  const l = parkLoop(75);
  assert.equal(l.length, 49);
  assert.ok(l.every((p) => p.r === PARK));
  near(l[0]!.ang, 75);
  near(l.at(-1)!.ang, 435);
});
