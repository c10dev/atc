import assert from "node:assert/strict";
import { test } from "node:test";
import { type FollowInput, followRowOf } from "./follow.ts";
import type { Ticket } from "./model.ts";
import { type AlertsInput, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { parseStuckUnserved, stuckUnservedCountOf, unservedStuckOf } from "./stuck-unserved.ts";

// 막힘 알림 문구(ATC-522). 계획(plan.unserved·aircraft)은 2026-10-03에 본 모양을 그대로 넣는다
const NOW = Date.parse("2026-10-03T13:30:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({
    key, title: `${key} title`, state: "Todo", stateType: "unstarted", stateColor: null, priority: 3, url: `https://linear/${key}`, updatedAt: ago(90),
    project: null, labels: [], createdAt: ago(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null, ...over,
  }) as Ticket;
const ac = (name: string, airport: string, over: Record<string, unknown> = {}) => ({ id: name, name, callsign: name, airport, available: false, reason: "", reserved: null, ...over });
const input = (plan: unknown, tickets: Ticket[]): Omit<FollowInput, "parents"> => ({
  tickets, proposals: [], pulls: [], clearances: [], milestones: new Map(), following: [], progress: {}, plan: plan as FollowInput["plan"], noDeploy: new Set(), now: NOW,
});
const base: AlertsInput = { sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null };
const alertOf = (key: string, plan: unknown, tickets: Ticket[], stuckUnserved?: { k3Relaunch: boolean }) => {
  const r = followRowOf(key, input(plan, tickets));
  return supervisorAlertsOf({ ...base, follow: { rows: [r], now: NOW, ...(stuckUnserved ? { stuckUnserved } : {}) } }).find((a) => a.key.startsWith("follow|stuck|"));
};

// RNPU FLIGHT: 그 AIRPORT에 base인 AIRCRAFT가 없다(처음 LAUNCH 전)
const rnpuPlan = {
  hold: [], excluded: [],
  unserved: [{ flight: "ATC-306", airport: "RNPU", type: "BUILD", ratings: [], labeled: false, why: "no-aircraft", tails: [] }],
  aircraft: [ac("TEAM_A", "ATCC", { available: true })],
};
// K3 VCDO FLIGHT: 후보는 모두 바쁘다
const k3Plan = {
  hold: [], excluded: [],
  unserved: [{ flight: "VOC-301", airport: "VCDO", type: "BUILD", ratings: ["DATA"], labeled: true, why: "no-aircraft", tails: [], k3: true }],
  aircraft: [ac("TEAM_V", "VCDO", { reserved: "D-0001" }), ac("TEAM_W", "VCDO", { resting: true })],
};

test("RNPU FLIGHT, 그 AIRPORT 소속 AIRCRAFT 없음: 사유·AIRPORT·첫 LAUNCH를 적는다", () => {
  const a = alertOf("ATC-306", rnpuPlan, [ticket("ATC-306")], { k3Relaunch: false })!;
  assert.match(a.text, /no-aircraft/);
  assert.match(a.text, /AIRPORT RNPU/);
  assert.match(a.next, /base가 RNPU인 AIRCRAFT를 LAUNCH/);
  assert.match(a.next, /첫 LAUNCH/);
  assert.deepEqual(a.unserved, { flight: "ATC-306", why: "no-aircraft", airport: "RNPU" });
  assert.doesNotMatch(a.text, /제안 없이 Todo/);
});

test("K3 VCDO FLIGHT, 후보가 모두 바쁨: k3Relaunch 켜기나 STOP을 적는다(켜져 있으면 카드 승인)", () => {
  const off = alertOf("VOC-301", k3Plan, [ticket("VOC-301")], { k3Relaunch: false })!;
  assert.match(off.text, /K3/);
  assert.match(off.text, /RATING DATA/);
  assert.match(off.next, /k3Relaunch.*켜거나/);
  assert.match(off.next, /STOP/);
  const on = alertOf("VOC-301", k3Plan, [ticket("VOC-301")], { k3Relaunch: true })!;
  assert.match(on.next, /K3 RELAUNCH 카드를 승인/);
  assert.doesNotMatch(on.next, /켜거나/);
});

test("RATING이 없는 FLIGHT(unqualified, tails 없음): RATING을 이름 붙인다", () => {
  const plan = { hold: [], excluded: [], unserved: [{ flight: "VOC-246", airport: "VCDO", type: "BUILD", ratings: ["DATA"], labeled: true, why: "no-aircraft", tails: [] }], aircraft: [] };
  const a = alertOf("VOC-246", plan, [ticket("VOC-246")], { k3Relaunch: false })!;
  assert.match(a.text, /no-aircraft/);
  assert.match(a.text, /RATING DATA/);
  const u = unservedStuckOf({ why: "unqualified", airport: "VCDO", ratings: ["DATA"], tails: [], k3: false, at: [] }, false);
  assert.match(u.text, /unqualified/);
  assert.match(u.next, /DATA RATING/);
});

test("소속 AIRCRAFT가 있으나 세션이 없으면 그 AIRCRAFT를 LAUNCH, 모두 바쁘면 기다리거나 하나 더", () => {
  const absent = unservedStuckOf({ why: "no-aircraft", airport: "ATCC", ratings: [], tails: [], k3: false, at: [{ name: "TEAM_X", launch: true }] }, false);
  assert.match(absent.next, /TEAM_X을 LAUNCH/);
  const busy = unservedStuckOf({ why: "no-aircraft", airport: "ATCC", ratings: [], tails: [], k3: false, at: [{ name: "TEAM_X", launch: false }] }, false);
  assert.match(busy.text, /모두 바쁨/);
});

test("다른 이유로 막힌 Todo(열린 제안·HOLD·계획에 없음)는 옛 문구 그대로", () => {
  const hold = { hold: [{ flight: "ATC-5", blockedBy: ["ATC-9"] }], excluded: [], unserved: [], aircraft: [] };
  assert.equal(alertOf("ATC-5", hold, [ticket("ATC-5")], { k3Relaunch: false }), undefined); // HOLD는 막힘이 아니다
  const none = alertOf("ATC-6", { hold: [], excluded: [{ flight: "ATC-6", reason: "PREFLIGHT HOLD" }], unserved: [], aircraft: [] }, [ticket("ATC-6")], { k3Relaunch: false })!;
  assert.match(none.text, /제안 없이 Todo 90분/);
  assert.equal(none.unserved, undefined);
  assert.match(none.next, /제외 사유/);
});

test("스위치 off(stuckUnserved 없음): 옛 문구, 센 표시 없음", () => {
  const a = alertOf("ATC-306", rnpuPlan, [ticket("ATC-306")])!;
  assert.match(a.text, /막힘: 제안 없이 Todo 90분$/);
  assert.match(a.next, /제외 사유/);
  assert.equal(a.unserved, undefined);
});

test("스위치 값 읽기와 센 수", () => {
  assert.equal(parseStuckUnserved("off"), "off");
  assert.equal(parseStuckUnserved(undefined), "on");
  assert.equal(parseStuckUnserved("x"), "on");
  const recs = [{ t: ago(10), op: "stuck-unserved" }, { t: ago(60 * 24 * 8), op: "stuck-unserved" }, { t: ago(5), op: "other" }];
  assert.equal(stuckUnservedCountOf(recs, NOW, 7), 1);
});
