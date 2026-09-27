import assert from "node:assert/strict";
import { test } from "node:test";
import type { Route, Waypoint } from "./routes.ts";
import { ackSlips, freshSlipKeys, type SlipsReported, slipOf, slipsOf, type WaypointEta, waypointEtasOf } from "./waypoint-slips.ts";

const NOW = new Date(2026, 8, 27, 12, 0).getTime(); // 2026-09-27 12:00 로컬

const wp = (name: string, over: Partial<Waypoint> = {}): Waypoint => ({
  id: `m-${name}`, name, state: "planned", linearStatus: "unstarted", progress: 0, targetDate: null, criteria: [], flights: [],
  counts: { done: 0, active: 0, blocked: 0, planned: 0 }, truncated: false, late: false, eta: null,
  ...over,
});
const route = (project: string, waypoints: Waypoint[]): Route => ({
  project, state: "started", progress: 0.5, targetDate: null, open: { active: 0, blocked: 0, planned: 0 }, aircraft: [], rate: { completed: 6, perWeek: 1.5 }, waypoints,
});
const eta = (over: Partial<WaypointEta> = {}): WaypointEta => ({
  route: "atc", id: "m1", name: "M16", state: "active", targetDate: "2026-10-10", progress: 0.5, eta: "2026-10-05", reason: null, remaining: 2, cumulative: 2, late: false,
  ...over,
});

test("waypointEtasOf: 지난 WAYPOINT와 WAYPOINT 없는 ROUTE는 빼고, ROUTE 이름순", () => {
  const routes = [
    route("vocado", [wp("Beta", { state: "active", targetDate: "2026-10-10T00:00:00.000Z", eta: { at: "2026-10-04", remaining: 2, cumulative: 2, reason: null } })]),
    route("Idle", []),
    route("atc", [
      wp("M15", { state: "passed", linearStatus: "done" }),
      wp("M16", { state: "active", late: true, eta: { at: "2026-10-20", remaining: 3, cumulative: 3, reason: null } }),
      wp("M17", { eta: { at: null, remaining: 0, cumulative: 3, reason: "no-flights" } }),
    ]),
  ];
  const r = waypointEtasOf(routes);
  assert.deepEqual(r.map((w) => `${w.route}/${w.name}`), ["atc/M16", "atc/M17", "vocado/Beta"]);
  assert.equal(r[0].eta, "2026-10-20");
  assert.equal(r[0].late, true);
  assert.equal(r[1].reason, "no-flights");
  assert.equal(r[1].cumulative, 3);
  assert.equal(r[2].targetDate, "2026-10-10"); // 날짜만
});

test("slipOf: 늦지 않으면 없음", () => {
  assert.equal(slipOf(eta(), NOW), null);
});

test("slipOf: ETA가 목표일보다 늦으면 eta-after-target과 늦은 날수", () => {
  const s = slipOf(eta({ late: true, eta: "2026-10-14" }), NOW)!;
  assert.equal(s.code, "eta-after-target");
  assert.equal(s.key, "m1:eta-after-target");
  assert.equal(s.days, 4);
  assert.match(s.text, /ETA 2026-10-14가 목표일 2026-10-10보다 4일 늦음/);
});

test("slipOf: 목표일이 지났으면 ETA보다 먼저 target-passed", () => {
  const s = slipOf(eta({ late: true, targetDate: "2026-09-20", eta: "2026-10-01" }), NOW)!;
  assert.equal(s.code, "target-passed");
  assert.equal(s.days, 7);
  const unknown = slipOf(eta({ late: true, targetDate: "2026-09-26", eta: null, reason: "few-samples" }), NOW)!;
  assert.equal(unknown.days, 1);
  assert.match(unknown.text, /ETA 모름\(few-samples\)/);
});

test("slipOf: 목표일 없이 Linear overdue면 linear-overdue", () => {
  const s = slipOf(eta({ late: true, targetDate: null }), NOW)!;
  assert.equal(s.code, "linear-overdue");
  assert.equal(s.days, null);
});

test("fresh와 ack: 보고한 경고는 fresh가 아니고, 풀린 경고는 잊는다", () => {
  const slips = slipsOf([eta({ id: "a", late: true, eta: "2026-10-14" }), eta({ id: "b", late: true, targetDate: "2026-09-20" }), eta({ id: "c" })], NOW);
  assert.deepEqual(slips.map((s) => s.key), ["a:eta-after-target", "b:target-passed"]);
  let r: SlipsReported = { reported: { "z:target-passed": "2026-09-01T00:00:00.000Z" } };
  assert.deepEqual(freshSlipKeys(slips, r), ["a:eta-after-target", "b:target-passed"]);
  r = ackSlips(slips, r, ["a:eta-after-target", "nope"], "2026-09-27T03:00:00.000Z");
  assert.deepEqual(r.reported, { "a:eta-after-target": "2026-09-27T03:00:00.000Z" }); // 풀린 z는 지워짐, 없는 key는 안 적음
  assert.deepEqual(freshSlipKeys(slips, r), ["b:target-passed"]);
  // 같은 WAYPOINT가 목표일을 넘기면 코드가 바뀌어 새 경고가 된다
  const later = slipsOf([eta({ id: "a", late: true, targetDate: "2026-09-26", eta: "2026-10-14" })], NOW);
  assert.deepEqual(freshSlipKeys(later, r), ["a:target-passed"]);
});
