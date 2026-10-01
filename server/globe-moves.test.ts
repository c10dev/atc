import assert from "node:assert/strict";
import { test } from "node:test";
import { arcLift, arcOf, ARC_PEAK, distanceDeg, globeSceneOf, type GlobeMovesIn, MOVE_FADE_MIN, movesOf, REPOSITION_STALE_MIN } from "./globe.ts";

// GLOBE G3: docs/globe.md 3.4 — OUTSTATION과 REPOSITION의 큰 원 호(moves[])
const NOW = Date.parse("2026-10-01T12:00:00Z");
const MIN = 60_000;
const ago = (min: number) => new Date(NOW - min * MIN).toISOString();
const airports = [
  { id: "id-atcc", code: "ATCC", name: "atc", repo: "/p/atc" },
  { id: "id-abcd", code: "ABCD", name: "abcd", repo: "/p/abcd" },
  { id: "id-efgh", code: "EFGH", name: "efgh", repo: "/p/efgh" },
];
const callsigns = { TEAM_H: "HOTEL", TEAM_K: "KILO" };
const rep = (id: string, over: Partial<GlobeMovesIn["repositions"][number]> = {}): GlobeMovesIn["repositions"][number] => ({
  id,
  kind: "REPOSITION",
  aircraft: "TEAM_H",
  from: "ATCC",
  airport: "ABCD",
  status: "executing",
  approval: { at: ago(5) },
  execution: null,
  ...over,
});
const input = (over: Partial<GlobeMovesIn> = {}): GlobeMovesIn => ({ now: NOW, callsigns, away: [], repositions: [], ...over });

test("OUTSTATION: 다른 AIRPORT에서 일하는 AIRCRAFT는 base→그 AIRPORT 호, 비행기는 목적지(t = 1), 끝난 시각 없음", () => {
  const out = movesOf(input({ away: [{ registration: "TEAM_K", fromRepo: "/p/atc", toRepo: "/p/abcd" }] }), airports);
  assert.deepEqual(out, [{ kind: "outstation", aircraft: "TEAM_K", callsign: "KILO", from: "ATCC", to: "ABCD", t: 1, endedAt: null, failed: false, proposal: null }]);
});

test("OUTSTATION: 같은 AIRCRAFT가 한 AIRPORT에 여러 번 나와도 한 줄, 저장소를 모르거나 같은 AIRPORT면 뺀다, 이름 순", () => {
  const out = movesOf(
    input({
      away: [
        { registration: "TEAM_K", fromRepo: "/p/atc", toRepo: "/p/abcd" },
        { registration: "TEAM_K", fromRepo: "/p/atc", toRepo: "/p/abcd" },
        { registration: "TEAM_H", fromRepo: "/p/atc", toRepo: "/p/efgh" },
        { registration: "TEAM_K", fromRepo: "/p/atc", toRepo: "/p/unknown" },
        { registration: "TEAM_K", fromRepo: "/p/atc", toRepo: "/p/atc" },
        { registration: "TEAM_K", fromRepo: "/p/unknown", toRepo: "/p/abcd" },
      ],
    }),
    airports,
  );
  assert.deepEqual(out.map((m) => `${m.aircraft}:${m.from}>${m.to}`), ["TEAM_H:ATCC>EFGH", "TEAM_K:ATCC>ABCD"]);
});

test("REPOSITION 실행 중: 새 LAUNCH 전이라 t = 0, 끝난 시각 없음. 중간점을 지어내지 않는다", () => {
  const [m] = movesOf(input({ repositions: [rep("F-0001")] }), airports);
  assert.deepEqual(m, { kind: "reposition", aircraft: "TEAM_H", callsign: "HOTEL", from: "ATCC", to: "ABCD", t: 0, endedAt: null, failed: false, proposal: "F-0001" });
});

test("REPOSITION 끝남: t = 1과 endedAt, 2시간 동안 옅어지는 흔적, 그 뒤엔 없다", () => {
  const done = rep("F-0002", { status: "executed", execution: { at: ago(30), ok: true } });
  const [m] = movesOf(input({ repositions: [done] }), airports);
  assert.equal(m.t, 1);
  assert.equal(m.endedAt, ago(30));
  assert.equal(m.failed, false);
  assert.equal(movesOf(input({ repositions: [{ ...done, execution: { at: ago(MOVE_FADE_MIN - 1), ok: true } }] }), airports).length, 1);
  assert.equal(movesOf(input({ repositions: [{ ...done, execution: { at: ago(MOVE_FADE_MIN), ok: true } }] }), airports).length, 0);
});

test("REPOSITION 실패(LAUNCH까지 못 감): t = 0, failed, 흔적이 같은 시간 남는다", () => {
  const [m] = movesOf(input({ repositions: [rep("F-0003", { status: "failed", execution: { at: ago(10), ok: false } })] }), airports);
  assert.deepEqual([m.t, m.failed, m.endedAt], [0, true, ago(10)]);
});

test("REPOSITION: 승인했는데 한 시간이 지나도 실행 중이면 그리지 않는다(끊긴 실행)", () => {
  assert.equal(movesOf(input({ repositions: [rep("F-0004", { approval: { at: ago(REPOSITION_STALE_MIN - 1) } })] }), airports).length, 1);
  assert.equal(movesOf(input({ repositions: [rep("F-0004", { approval: { at: ago(REPOSITION_STALE_MIN + 1) } })] }), airports).length, 0);
});

test("REPOSITION: 열린·거절·만료·다른 종류·모르는 AIRPORT·같은 AIRPORT 제안은 그리지 않는다", () => {
  const drop = [
    rep("F-1", { status: "open" }),
    rep("F-2", { status: "agreed" }),
    rep("F-3", { status: "expired" }),
    rep("F-4", { kind: "RESTART" }),
    rep("F-5", { from: "ZZZZ" }),
    rep("F-6", { airport: "ZZZZ" }),
    rep("F-7", { airport: "ATCC" }),
    rep("F-8", { aircraft: null }),
    rep("F-9", { approval: null }),
  ];
  assert.deepEqual(movesOf(input({ repositions: drop }), airports), []);
});

test("장면: moves가 없으면 빈 목록(전과 같다), 있으면 OUTSTATION 먼저 그다음 REPOSITION", () => {
  const base = { at: new Date(NOW), airports, sessions: [], aircraft: [] };
  assert.deepEqual(globeSceneOf(base).moves, []);
  const scene = globeSceneOf({ ...base, moves: input({ away: [{ registration: "TEAM_K", fromRepo: "/p/atc", toRepo: "/p/abcd" }], repositions: [rep("F-0001")] }) });
  assert.deepEqual(scene.moves.map((m) => m.kind), ["outstation", "reposition"]);
  // G1·G2의 칸은 그대로
  assert.deepEqual(Object.keys(scene).sort(), ["airports", "at", "flights", "home", "moves", "parked"]);
});

test("호: 양 끝을 포함한 n+1개 점, 큰 원 위(두 점 사이 거리가 일정), 높이는 가운데가 가장 높고 끝은 0", () => {
  const a = { lat: 10, lon: 20 };
  const b = { lat: 40, lon: 80 };
  const pts = arcOf(a, b, 16);
  assert.equal(pts.length, 17);
  assert.ok(distanceDeg(pts[0], a) < 1e-3 && distanceDeg(pts[16], b) < 1e-3);
  const step = distanceDeg(pts[0], pts[1]);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(distanceDeg(pts[i - 1], pts[i]) - step) < 1e-3, `간격 ${i}`);
  assert.equal(arcLift(0), 0);
  assert.ok(Math.abs(arcLift(1)) < 1e-12);
  assert.equal(arcLift(0.5), ARC_PEAK);
  assert.ok(arcLift(0.25) < arcLift(0.5));
  assert.equal(arcLift(-1), 0);
});
