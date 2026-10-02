import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEntry } from "./logbook.ts";
import type { Ticket } from "./model.ts";
import { dayKey } from "./day-key.ts";
import { activeWaypointsOf, buildRoutes, completedIn, criteriaOf, etaOf, isBlocked, isLate, phaseOf, waypointStates } from "./routes.ts";
import { mergeByTeam, type Milestone, type MilestoneIssue, toGoal, toMilestone } from "./sources/linear-projects.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 27, 12, 0).getTime(); // 2026-09-27 12:00 로컬
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 2, url: null, updatedAt: null,
  project: "Song Experience", labels: [], createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [],
  ...over,
});
const issue = (key: string, stateType = "unstarted", completedAt: string | null = null): MilestoneIssue => ({ key, title: key, state: stateType, stateType, completedAt });
const ms = (name: string, sortOrder: number, over: Partial<Milestone> = {}): Milestone => ({
  id: name, project: "Song Experience", name, description: "", targetDate: null, progress: 0, sortOrder, status: "unstarted", issues: [], truncated: false, teams: ["VOC"],
  ...over,
});
const entry = (flight: string, arrivedAt: string): LogEntry => ({
  key: `o/v#${flight}`, aircraft: "TEAM_F", flight, class: null, airport: "VCDO", pr: { repo: "o/v", number: 1, url: "", title: "" }, stands: [],
  departedAt: arrivedAt, departedFrom: "pr", arrivedAt, blockMin: null, landingWaitMin: 1, codexFindings: 0, changesRequested: false, reverted: false, los: 0,
});

test("criteriaOf: Exit criteria 아래 번호 목록만, 첫 줄만, 강조 벗김", () => {
  const d = [
    "Goal:",
    "1. not this",
    "",
    "Exit criteria:",
    "",
    "1. Material UI PRs expose a **Preview URL**.",
    "   continued line",
    "2) Human reviewers can test.",
    "3\\. Escaped number.",
    "",
    "Notes:",
    "4. not this either",
  ].join("\n");
  assert.deepEqual(criteriaOf(d), ["Material UI PRs expose a Preview URL.", "Human reviewers can test.", "Escaped number."]);
});

test("criteriaOf: 제목이 없으면 설명 전체의 번호 목록, 목록이 없으면 빈 배열", () => {
  assert.deepEqual(criteriaOf("intro\n1. a\n2. b"), ["a", "b"]);
  assert.deepEqual(criteriaOf("## 완료 기준\n- x\n1. 한국어 항목"), ["한국어 항목"]);
  assert.deepEqual(criteriaOf("just prose"), []);
});

test("toMilestone: 진행률 0~100 → 0~1, 잘림 표시, 빠진 필드는 버린다", () => {
  const m = toMilestone({
    id: "m1", name: "Beta Ready", project: { name: "Song Catalog" }, progress: 83.33, sortOrder: 3064, status: "next", targetDate: "2026-10-10",
    issues: { pageInfo: { hasNextPage: true }, nodes: [{ identifier: "VOC-1", title: "t", state: { name: "Done", type: "completed" }, completedAt: ago(1) }, { title: "no key" }] },
  });
  assert.equal(m?.progress, 0.8333);
  assert.equal(m?.truncated, true);
  assert.deepEqual(m?.issues.map((i) => i.key), ["VOC-1"]);
  assert.equal(toMilestone({ id: "x", name: "n" }), null);
  assert.equal(toMilestone({ id: "x", name: "n", project: { name: "p" }, progress: 250 })?.progress, 1);
});

test("phaseOf·isBlocked: 끝남·취소·막힘·진행·계획", () => {
  assert.equal(phaseOf("completed", false), "done");
  assert.equal(phaseOf("canceled", false), null);
  assert.equal(phaseOf("duplicate", true), null);
  assert.equal(phaseOf("started", true), "blocked");
  assert.equal(phaseOf("started", false), "active");
  assert.equal(phaseOf("backlog", false), "planned");
  const byKey = new Map([["VOC-1", { stateType: "started" as const }], ["VOC-2", { stateType: "completed" as const }]]);
  assert.equal(isBlocked({ blockedBy: ["VOC-1"] }, byKey), true);
  assert.equal(isBlocked({ blockedBy: ["VOC-2", "VOC-9"] }, byKey), false); // 끝났거나 보드에 없는 선행
  assert.equal(isBlocked(undefined, byKey), false);
});

test("waypointStates: done은 passed, 순서상 첫 미완료 하나만 active", () => {
  // Song Catalog: Beta Ready(next)가 Web Surface(done)보다 앞에 있다
  const got = waypointStates([
    { status: "done", sortOrder: 77 },
    { status: "done", sortOrder: 1966 },
    { status: "unstarted", sortOrder: 5000 },
    { status: "next", sortOrder: 3064 },
    { status: "done", sortOrder: 4085 },
  ]);
  assert.deepEqual(got, ["passed", "passed", "planned", "active", "passed"]);
  assert.deepEqual(waypointStates([{ status: "done", sortOrder: 1 }]), ["passed"]);
});

test("completedIn: LOGBOOK ARRIVED와 Linear completedAt을 중복 없이, 창 안만", () => {
  const projectOf = new Map([["VOC-1", "Song Experience"], ["VOC-2", "Song Experience"], ["VOC-3", "Other"]]);
  const milestones = [ms("A", 1, { issues: [issue("VOC-1", "completed", ago(2)), issue("VOC-4", "completed", ago(40)), issue("VOC-5", "completed", ago(3))] })];
  const entries = [entry("VOC-1", ago(1)), entry("VOC-2", ago(5)), entry("VOC-3", ago(1)), entry("VOC-2", ago(30))];
  assert.equal(completedIn({ project: "Song Experience", entries, milestones, projectOf, now: NOW }), 3); // VOC-1, 2, 5
});

test("etaOf: 누적 남은 FLIGHT ÷ 하루 완료 수, 모름의 이유", () => {
  // 28일에 14개 = 하루 0.5개. 누적 3개 → 6일
  assert.deepEqual(etaOf({ remaining: 2, cumulative: 3, truncated: false, completed: 14, now: NOW }), { remaining: 2, cumulative: 3, at: dayKey(NOW + 6 * DAY), reason: null });
  assert.equal(etaOf({ remaining: 2, cumulative: 2, truncated: false, completed: 2, now: NOW }).reason, "few-samples");
  assert.equal(etaOf({ remaining: 0, cumulative: 4, truncated: false, completed: 20, now: NOW }).reason, "no-flights");
  assert.equal(etaOf({ remaining: 1, cumulative: 1, truncated: true, completed: 20, now: NOW }).reason, "truncated");
});

test("isLate: 지난 목표일, ETA보다 앞선 목표일, overdue", () => {
  const eta = { at: "2026-10-05", remaining: 1, cumulative: 1, reason: null };
  assert.equal(isLate({ state: "active", targetDate: "2026-10-01", linearStatus: "next", eta }, NOW), true);
  assert.equal(isLate({ state: "active", targetDate: "2026-10-10", linearStatus: "next", eta }, NOW), false);
  assert.equal(isLate({ state: "planned", targetDate: "2026-09-20", linearStatus: "unstarted", eta: null }, NOW), true);
  assert.equal(isLate({ state: "planned", targetDate: null, linearStatus: "overdue", eta: null }, NOW), true);
  assert.equal(isLate({ state: "passed", targetDate: "2026-09-01", linearStatus: "done", eta: null }, NOW), false);
});

test("buildRoutes: WAYPOINT·FLIGHT·AIRCRAFT·누적 ETA, WAYPOINT 없는 ROUTE는 뒤에 빈 목록으로", () => {
  const tickets = [
    ticket("VOC-10", { stateType: "started", state: "In Progress" }),
    ticket("VOC-11", { blockedBy: ["VOC-10"] }),
    ticket("VOC-12", { stateType: "canceled" }),
    ticket("VOC-20", { project: "Beta Readiness", stateType: "started" }),
    ticket("VOC-21", { project: "Beta Readiness", blockedBy: ["VOC-20"] }),
    ticket("VOC-22", { project: "Beta Readiness", stateType: "backlog" }),
    ticket("VOC-30", { project: "Home & Discovery", stateType: "started" }),
  ];
  const milestones = [
    ms("Foundation", 68, { status: "done", progress: 1, issues: [issue("VOC-1", "completed", ago(3)), issue("VOC-2", "completed", ago(4)), issue("VOC-3", "completed", ago(5))] }),
    ms("Listening v1", 1087, {
      status: "next", progress: 0.5, targetDate: "2026-09-30", description: "Exit criteria:\n1. plays\n2. differs",
      issues: [issue("VOC-4", "completed", ago(6)), issue("VOC-10", "unstarted"), issue("VOC-11"), issue("VOC-12")],
    }),
    ms("v2", 2000, { issues: [issue("VOC-13")] }),
  ];
  const r = buildRoutes({
    now: NOW,
    goals: [
      { name: "Song Experience", targetDate: null, progress: 0.8, state: "started", teams: ["VOC"] },
      { name: "Beta Readiness", targetDate: null, progress: 0.85, state: "started", teams: ["VOC"] },
      { name: "Home & Discovery", targetDate: null, progress: 1, state: "completed", teams: ["VOC"] },
      { name: "Idle", targetDate: null, progress: 0, state: "planned", teams: ["VOC"] },
    ],
    milestones,
    tickets,
    entries: [],
    aircraftOf: new Map([["VOC-10", "TEAM_F"], ["VOC-20", "TEAM_B"]]),
  });
  assert.equal(r.milestones, true);
  assert.deepEqual(r.routes.map((x) => x.project), ["Song Experience", "Beta Readiness", "Idle"]); // 끝난 ROUTE는 숨김
  const se = r.routes[0];
  assert.equal(se.rate.completed, 4);
  assert.deepEqual(se.open, { active: 1, blocked: 1, planned: 0 });
  assert.deepEqual(se.aircraft, ["TEAM_F"]);
  assert.deepEqual(se.waypoints.map((w) => w.state), ["passed", "active", "planned"]);
  const [done, active, next] = se.waypoints;
  assert.equal(done.eta, null);
  // 보드의 상태(started)가 마일스톤 쪽 상태보다 앞선다. canceled는 뺀다
  assert.deepEqual(active.flights.map((f) => [f.key, f.phase, f.aircraft]), [["VOC-4", "done", null], ["VOC-10", "active", "TEAM_F"], ["VOC-11", "blocked", null]]);
  assert.deepEqual(active.counts, { done: 1, active: 1, blocked: 1, planned: 0 });
  assert.deepEqual(active.criteria, ["plays", "differs"]);
  // 하루 4/28개: 남은 2개 → 14일, 누적 3개 → 21일
  assert.equal(active.eta?.at, dayKey(NOW + 14 * DAY));
  assert.equal(active.late, true); // 목표일 9-30 < ETA
  assert.equal(next.eta?.cumulative, 3);
  assert.equal(next.eta?.at, dayKey(NOW + 21 * DAY));
  const br = r.routes[1];
  assert.deepEqual(br.waypoints, []);
  assert.deepEqual(br.open, { active: 1, blocked: 1, planned: 0 }); // backlog는 세지 않는다
  assert.deepEqual(br.aircraft, ["TEAM_B"]);
});

test("buildRoutes: 마일스톤을 못 읽으면 milestones false, ROUTE는 WAYPOINT 없이", () => {
  const r = buildRoutes({ now: NOW, goals: [{ name: "P", targetDate: null, progress: null, state: "started", teams: ["VOC"] }], milestones: null, tickets: [], entries: [], aircraftOf: new Map() });
  assert.equal(r.milestones, false);
  assert.deepEqual(r.routes.map((x) => [x.project, x.waypoints.length]), [["P", 0]]);
});

test("여러 팀 읽기: toGoal·toMilestone은 읽은 팀을 적고, mergeByTeam은 같은 프로젝트·마일스톤을 합쳐 teams를 더한다", () => {
  assert.deepEqual(toGoal({ name: "atc", status: { type: "started" } }, "ATC")?.teams, ["ATC"]);
  assert.deepEqual(toGoal({ name: "atc" })?.teams, []);
  const m = (id: string, team: string) => toMilestone({ id, name: id, project: { name: "P" } }, team)!;
  const merged = mergeByTeam([[m("a", "VOC"), m("b", "VOC")], [m("b", "ATC"), m("c", "ATC")]], (x) => x.id);
  assert.deepEqual(merged.map((x) => `${x.id}:${x.teams.join("+")}`), ["a:VOC", "b:VOC+ATC", "c:ATC"]);
  const goals = mergeByTeam([[toGoal({ name: "Shared" }, "VOC")!], [toGoal({ name: "Shared" }, "ATC")!, toGoal({ name: "atc" }, "ATC")!]], (g) => g.name);
  assert.deepEqual(goals.map((g) => `${g.name}:${g.teams.join("+")}`), ["Shared:VOC+ATC", "atc:ATC"]);
});

test("activeWaypointsOf: ROUTE마다 지나지 않은 첫 WAYPOINT의 이슈만 'ROUTE · WAYPOINT'로", () => {
  const m = (project: string, name: string, sortOrder: number, status: string, keys: string[]) => ({ project, name, sortOrder, status, issues: keys.map((k) => issue(k)) });
  const got = activeWaypointsOf([
    m("Song Catalog", "Foundation", 1, "done", ["VOC-1"]),
    m("Song Catalog", "Beta Ready", 2, "next", ["VOC-2", "VOC-3"]),
    m("Song Catalog", "Launch", 3, "unstarted", ["VOC-4"]),
    m("atc", "M15", 1, "done", ["ATC-1"]),
  ]);
  assert.deepEqual([...got], [["VOC-2", "Song Catalog · Beta Ready"], ["VOC-3", "Song Catalog · Beta Ready"]]);
  assert.equal(activeWaypointsOf(null).size, 0);
});
