import assert from "node:assert/strict";
import { test } from "node:test";
import { ARRIVAL_GRACE_MS, restartSafetyOf, SENT_GRACE_MS, WIP_IDLE_MS } from "./occ-safe.ts";

// ATC-169: OCC를 지금 STOP·LAUNCH해도 잃는 것이 없나(순수)
const NOW = Date.parse("2026-09-30T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const base = { inFlight: [], arrivalMissing: [], wip: [], now: NOW };

test("아무것도 없으면 안전하다", () => {
  assert.deepEqual(restartSafetyOf(base), { safe: true, blockers: [] });
});

test("approved·recalling은 막는다(아직 보내지 못한 FLIGHT PLAN·RECALL)", () => {
  const r = restartSafetyOf({ ...base, inFlight: [{ id: "D-1", status: "approved", statusAt: ago(60_000) }, { id: "D-2", status: "recalling", statusAt: ago(60_000) }] });
  assert.equal(r.safe, false);
  assert.deepEqual(r.blockers.map((b) => b.code), ["approved", "recalling"]);
});

test("sent는 10분이 안 됐으면 막고, 지났으면 막지 않는다(overdue가 다시 보낸다). 보낸 시각은 timeline.sent", () => {
  const fresh = restartSafetyOf({ ...base, inFlight: [{ id: "D-1", status: "sent", statusAt: ago(SENT_GRACE_MS - 60_000) }] });
  assert.deepEqual(fresh.blockers.map((b) => b.code), ["sent-fresh"]);
  assert.equal(restartSafetyOf({ ...base, inFlight: [{ id: "D-1", status: "sent", statusAt: ago(SENT_GRACE_MS + 60_000) }] }).safe, true);
  // STANDBY 등으로 statusAt이 바뀌어도 timeline.sent가 기준이다
  const r = restartSafetyOf({ ...base, inFlight: [{ id: "D-1", status: "sent", statusAt: ago(60_000), timeline: { sent: ago(SENT_GRACE_MS + 60_000) } }] });
  assert.equal(r.safe, true);
  // accepted(READBACK 뒤)는 막지 않는다
  assert.equal(restartSafetyOf({ ...base, inFlight: [{ id: "D-1", status: "accepted", statusAt: ago(1000) }] }).safe, true);
});

test("arrivalMissing은 머지 30분 안이면 막고(보고가 오는 중), 그 뒤엔 막지 않는다(이미 빠뜨렸다면 알림 몫)", () => {
  const r = restartSafetyOf({ ...base, arrivalMissing: [{ flight: "ATC-1", arrivedAt: ago(ARRIVAL_GRACE_MS - 60_000), ageMin: 29 }] });
  assert.deepEqual(r.blockers.map((b) => [b.code, b.id]), [["arrival-fresh", "ATC-1"]]);
  assert.equal(restartSafetyOf({ ...base, arrivalMissing: [{ flight: "ATC-1", arrivedAt: ago(ARRIVAL_GRACE_MS + 60_000), ageMin: 31 }] }).safe, true);
});

test("wip CHARTER REQUEST는 30분 안에 손댔으면 막고, 오래 손대지 않았으면 막지 않는다", () => {
  assert.deepEqual(restartSafetyOf({ ...base, wip: [{ id: "W-0001", touchedAt: ago(5 * 60_000) }] }).blockers.map((b) => b.code), ["wip-active"]);
  assert.equal(restartSafetyOf({ ...base, wip: [{ id: "W-0001", touchedAt: ago(WIP_IDLE_MS + 60_000) }] }).safe, true);
});

test("여러 조건이 겹치면 모두 적는다", () => {
  const r = restartSafetyOf({
    ...base,
    inFlight: [{ id: "D-1", status: "approved", statusAt: ago(1000) }],
    arrivalMissing: [{ flight: "ATC-1", arrivedAt: ago(60_000), ageMin: 1 }],
    wip: [{ id: "W-0001", touchedAt: ago(60_000) }],
  });
  assert.equal(r.blockers.length, 3);
  assert.equal(r.safe, false);
});
