import assert from "node:assert/strict";
import { test } from "node:test";
import { type AutoView, laneRowsOf, recentLinesOf, WHY_LABEL } from "../web/src/misfire-rows.ts";

// METRICS → MISFIRE(ATC-380)의 순수 부분: 레인마다 한 줄
const auto = (over: Partial<AutoView> = {}): AutoView => ({
  switches: { schedule: "on", fleetPlan: "off" },
  misfires: [
    { day: "2026-10-01", schedule: 1, fleet: 0 },
    { day: "2026-10-02", schedule: 1, fleet: 2 },
  ],
  applied: { schedule: 8, fleet: 4, fleetFailed: 1 },
  recent: [],
  ...over,
});

test("레인마다 한 줄: DISPATCH는 승인·misfire·몫 그대로, SCHEDULE·FLEET PLAN은 적용 수 대비 misfire 합", () => {
  const rows = laneRowsOf({ total: { approvals: 20, misfires: 3, share: 0.15 } }, auto());
  assert.deepEqual(
    rows.map((r) => [r.lane, r.switch, r.applied, r.misfires, r.share, r.failed]),
    [
      ["DISPATCH", null, 20, 3, 0.15, 0],
      ["SCHEDULE", "on", 8, 2, 0.25, 0],
      ["FLEET PLAN", "off", 4, 2, 0.5, 1],
    ],
  );
});

test("한 일이 없으면 몫은 null(0으로 지어내지 않는다)", () => {
  const rows = laneRowsOf({ total: { approvals: 0, misfires: 0, share: null } }, auto({ misfires: [], applied: { schedule: 0, fleet: 0, fleetFailed: 0 } }));
  assert.deepEqual(rows.map((r) => r.share), [null, null, null]);
});

test("읽지 못한 레인은 줄을 내지 않는다", () => {
  assert.deepEqual(laneRowsOf(null, null), []);
  assert.deepEqual(laneRowsOf(null, auto()).map((r) => r.lane), ["SCHEDULE", "FLEET PLAN"]);
  assert.deepEqual(laneRowsOf({ total: { approvals: 1, misfires: 0, share: 0 } }, null).map((r) => r.lane), ["DISPATCH"]);
});

test("LANDING GAP 레인(ATC-501): 에피소드가 한 일, MISFIRE는 스스로 풀린 막힘, 읽지 못하면 줄이 없다", () => {
  const gap = { switch: "on", episodes: 4, closed: 3, misfires: 1, share: 1 / 3 };
  const row = laneRowsOf(null, null, gap)[0]!;
  assert.deepEqual([row.lane, row.switch, row.applied, row.misfires, row.share], ["LANDING GAP", "on", 4, 1, 1 / 3]);
  assert.deepEqual(laneRowsOf(null, auto(), gap).map((r) => r.lane), ["SCHEDULE", "FLEET PLAN", "LANDING GAP"]);
  assert.deepEqual(laneRowsOf(null, auto(), null).map((r) => r.lane), ["SCHEDULE", "FLEET PLAN"]);
});

test("최근 misfire는 앞의 n건, 사유 이름이 모두 있다", () => {
  const recent = Array.from({ length: 15 }, (_, i) => ({ at: `2026-10-02T0${i % 10}:00:00Z`, kind: "schedule" as const, id: `S-${i}`, why: "undone" as const, what: "CLASSIFY" }));
  assert.equal(recentLinesOf(auto({ recent })).length, 10);
  assert.equal(recentLinesOf(auto({ recent }), 3).length, 3);
  assert.deepEqual(recentLinesOf(null), []);
  assert.deepEqual(Object.keys(WHY_LABEL).sort(), ["idle-launch", "restart-loop", "stop-launch", "undone"]);
});
