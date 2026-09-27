import assert from "node:assert/strict";
import { test } from "node:test";
import { BRIEFING_MAX, BriefingError, factsOf, firstSentence, parseBriefing, waypointIndex } from "./briefing.ts";
import type { LogEntry } from "./logbook.ts";
import type { Ticket } from "./model.ts";
import type { Route, Waypoint } from "./routes.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, priority: 2, url: null, updatedAt: null,
  project: "Beta Readiness", labels: [], createdAt: ago(5), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [],
  ...over,
});
const entry = (flight: string, aircraft: string, d: number): LogEntry => ({
  key: `o/v#${flight}`, aircraft, flight, class: null, airport: "VCDO", pr: { repo: "o/v", number: 1, url: "", title: `PR ${flight}` }, stands: [],
  departedAt: ago(d), departedFrom: "pr", arrivedAt: ago(d), blockMin: null, landingWaitMin: 1, codexFindings: 0, changesRequested: false, reverted: false, los: 0,
});
const wp = (name: string, keys: string[], counts: Waypoint["counts"], state: Waypoint["state"] = "active"): Waypoint => ({
  id: name, name, state, linearStatus: null, progress: 0.5, targetDate: null, criteria: [], truncated: false, late: false, eta: null, counts,
  flights: keys.map((key) => ({ key, title: key, phase: "planned", aircraft: null, url: null })),
});
const route = (project: string, waypoints: Waypoint[]): Route => ({
  project, state: "started", progress: 0.5, targetDate: null, open: { active: 0, blocked: 0, planned: 0 }, aircraft: [], rate: { completed: 0, perWeek: 0 }, waypoints,
});

test("parseBriefing: 세 줄 모두, 공백 정리, 길이 제한", () => {
  assert.deepEqual(parseBriefing({ what: " 재생  버튼\n정리 ", why: "b", risk: "c" }), { what: "재생 버튼 정리", why: "b", risk: "c" });
  assert.throws(() => parseBriefing({ what: "a", why: "b" }), BriefingError);
  assert.throws(() => parseBriefing({ what: "a", why: " ", risk: "c" }), /why/);
  assert.throws(() => parseBriefing({ what: "x".repeat(BRIEFING_MAX + 1), why: "b", risk: "c" }), /이내/);
  assert.throws(() => parseBriefing(null), BriefingError);
});

test("firstSentence: 제목·머리 줄을 건너뛰고 첫 문장, 링크·강조를 벗기고 자른다", () => {
  assert.equal(firstSentence("## Why\n\nThe SUPERVISOR often doesn't remember. To judge a proposal they open Linear."), "The SUPERVISOR often doesn't remember.");
  assert.equal(firstSentence("Why:\n- **잠금**은 [큐](https://x) 행만 건다. 나머지는 그대로다."), "잠금은 큐 행만 건다.");
  assert.equal(firstSentence("마침표 없는 한 줄"), "마침표 없는 한 줄");
  assert.equal(firstSentence("v1.2 버전을 올린다. 끝."), "v1.2 버전을 올린다.");
  assert.equal(firstSentence("a".repeat(300), 20), `${"a".repeat(19)}…`);
  assert.equal(firstSentence(""), null);
  assert.equal(firstSentence("## 제목만"), null);
});

test("factsOf: PRIORITY·대기 일수·ROUTE·WAYPOINT·선행·최근 FLIGHT·CROSSCHECK", () => {
  const tickets = [
    ticket("VOC-10", { priority: 1, createdAt: ago(3.5), blockedBy: ["VOC-11"] }),
    ticket("VOC-11", { state: "In Progress", stateType: "started" }),
    ticket("VOC-12", { state: "Done", stateType: "completed" }),
    ticket("VOC-20", { title: "같은 ROUTE 앞 FLIGHT" }),
    ticket("VOC-30", { project: "Other" }),
  ];
  const routes = [route("Beta Readiness", [wp("Beta Ready", ["VOC-10", "VOC-20"], { done: 2, active: 1, blocked: 0, planned: 2 })])];
  const entries = [entry("VOC-20", "TEAM_B", 2), entry("VOC-30", "TEAM_B", 1), entry("VOC-21", "TEAM_C", 1), entry("VOC-22", "TEAM_B", 40)];
  const facts = factsOf(
    { id: "D-0001", flight: "VOC-10", aircraftName: "TEAM_B", hold: ["VOC-12"], crosscheck: { verdict: "disagree", reason: "선행이 안 끝남" } },
    { now: NOW, tickets, routes, entries, flying: [{ flight: "VOC-40", aircraftName: "TEAM_B", at: ago(0.5) }] },
  );
  assert.equal(facts.priority, 1);
  assert.equal(facts.waitDays, 3);
  assert.equal(facts.route, "Beta Readiness");
  assert.deepEqual(facts.waypoint, { name: "Beta Ready", state: "active", remaining: 3 });
  assert.deepEqual(facts.blockers, [{ key: "VOC-11", state: "In Progress", done: false }, { key: "VOC-12", state: "Done", done: true }]);
  // 같은 ROUTE, 같은 AIRCRAFT, 30일 안만. VOC-40은 ROUTE를 몰라 빠진다
  assert.deepEqual(facts.recent.map((r) => [r.key, r.how, r.title]), [["VOC-20", "ARRIVED", "같은 ROUTE 앞 FLIGHT"]]);
  assert.deepEqual(facts.crosscheck, { verdict: "disagree", reason: "선행이 안 끝남" });
});

test("factsOf: 모르는 FLIGHT는 null, 날고 있는 같은 ROUTE FLIGHT는 ENROUTE", () => {
  const routes = [route("Beta Readiness", [wp("Beta Ready", ["VOC-50"], { done: 0, active: 1, blocked: 0, planned: 0 })])];
  const facts = factsOf(
    { id: "D-0002", flight: "VOC-99", aircraftName: "TEAM_B", hold: [], crosscheck: null },
    { now: NOW, tickets: [ticket("VOC-50")], routes, entries: [], flying: [{ flight: "VOC-50", aircraftName: "team_b", at: ago(1) }] },
  );
  assert.equal(facts.priority, null);
  assert.equal(facts.waitDays, null);
  assert.equal(facts.route, null);
  assert.equal(facts.waypoint, null);
  assert.deepEqual(facts.recent, []);
  const known = factsOf(
    { id: "D-0003", flight: "VOC-50", aircraftName: "TEAM_C", hold: [], crosscheck: null },
    { now: NOW, tickets: [ticket("VOC-50"), ticket("VOC-51")], routes, entries: [], flying: [{ flight: "VOC-51", aircraftName: "TEAM_C", at: ago(1) }] },
  );
  assert.deepEqual(known.recent.map((r) => [r.key, r.how]), [["VOC-51", "ENROUTE"]]);
  assert.equal(waypointIndex(routes).get("VOC-50")?.route, "Beta Readiness");
});
