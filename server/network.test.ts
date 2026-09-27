import assert from "node:assert/strict";
import { test } from "node:test";
import { crosscheckRateOf } from "./crosscheck.ts";
import { DEFAULT_FLEET, fleetView } from "./fleet.ts";
import { computeActuals, type LogEntry } from "./logbook.ts";
import type { Session, Ticket } from "./model.ts";
import { aircraftRows, buildNetwork, dayKey, dayWindows, gateTrend, logbookTrend, NETWORK_DAYS, openPhase, routeRows } from "./network.ts";
import { fold as foldProposals, gateOf as dispatchGate, humanOf as proposalHuman, type Op } from "./proposals.ts";
import { fold as foldSchedule, gateOf as scheduleGate, humanOf as scheduleHuman } from "./schedule.ts";
import { toGoal } from "./sources/linear-projects.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 27, 12, 0).getTime(); // 2026-09-27(일) 12:00 로컬
const ago = (d: number, h = 0) => new Date(NOW - d * DAY - h * 3_600_000).toISOString();

const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, priority: 2, url: null, updatedAt: null,
  project: "Beta Readiness", labels: [], createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [],
  ...over,
});

const entry = (n: number, over: Partial<LogEntry> = {}): LogEntry => ({
  key: `o/v#${n}`, aircraft: "TEAM_B", flight: `VOC-${n}`, class: null, airport: "VCDO",
  pr: { repo: "o/v", number: n, url: "", title: "" }, stands: [], departedAt: ago(1), departedFrom: "pr", arrivedAt: ago(1),
  blockMin: null, landingWaitMin: 60, codexFindings: 0, changesRequested: false, reverted: false, los: 0,
  ...over,
});

const session = (id: string, name: string): Session =>
  ({ id, name, status: "idle", repo: "/r/v", cwd: "/r/v", agent: "claude", pid: 1, startedAt: "", lastActiveAt: "", workspacePath: null }) as Session;
const snap = { sessions: [session("b", "TEAM_B")], claims: [], workspaces: [], airports: [{ id: "r", code: "VCDO", name: "v", repo: "/r/v" }] };

test("NETWORK 열린 FLIGHT 단계: 화면과 같은 규칙(Todo·ENROUTE·APPROACH), backlog·끝난 것은 세지 않음", () => {
  assert.equal(openPhase({ state: "Todo", stateType: "unstarted" }), "todo");
  assert.equal(openPhase({ state: "In Progress", stateType: "started" }), "inProgress");
  assert.equal(openPhase({ state: "In Review", stateType: "started" }), "inReview");
  assert.equal(openPhase({ state: "Ready to Merge", stateType: "started" }), "inReview");
  assert.equal(openPhase({ state: "Backlog", stateType: "backlog" }), null);
  assert.equal(openPhase({ state: "Done", stateType: "completed" }), null);
  assert.equal(openPhase({ state: "In Review", stateType: "canceled" }), null);
});

test("NETWORK 날짜: 오늘을 포함한 28일, 오래된 날 먼저, 로컬 자정 경계", () => {
  const w = dayWindows(NOW);
  assert.equal(w.length, NETWORK_DAYS);
  assert.equal(w.at(-1)!.date, "2026-09-27");
  assert.equal(w[0].date, "2026-08-31");
  assert.equal(new Date(w.at(-1)!.from).getHours(), 0);
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59).getTime()), "2026-01-05");
});

test("NETWORK ROUTE: 상태별 열린 FLIGHT, 14일 ARRIVED, ROUTE를 가진 AIRCRAFT, 착륙 대기 중앙값, 목표", () => {
  const tickets = [
    ticket("VOC-1"),
    ticket("VOC-2", { state: "In Progress", stateType: "started" }),
    ticket("VOC-3", { state: "In Review", stateType: "started" }),
    ticket("VOC-4", { children: ["VOC-1"] }), // 상위 이슈는 세지 않는다
    ticket("VOC-5", { state: "Done", stateType: "completed" }),
    ticket("VOC-6", { state: "Done", stateType: "completed" }),
    ticket("VOC-7", { state: "Done", stateType: "completed" }),
    ticket("VOC-8", { project: "Song Experience", state: "Backlog", stateType: "backlog" }),
    ticket("VOC-9", { project: null }),
  ];
  const entries = [
    entry(5, { landingWaitMin: 30 }),
    entry(6, { landingWaitMin: 90, arrivedAt: ago(13) }),
    entry(7, { arrivedAt: ago(15) }), // 14일 밖
    entry(99), // 스냅샷이 모르는 FLIGHT는 어느 ROUTE에도 넣지 않는다
  ];
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_B: { routes: ["Beta Readiness"] }, TEAM_E: { routes: ["Beta Readiness", "Song Experience"] }, TEAM_Z: { routes: ["Beta Readiness"], retired: { at: "", reason: null } } } };
  const views = fleetView(snap, fleet, undefined, entries, NOW);
  const goals = [
    { name: "Beta Readiness", targetDate: "2026-10-31", progress: 0.84, state: "started", teams: ["VOC"] },
    { name: "Home & Discovery", targetDate: null, progress: 1, state: "completed", teams: ["VOC"] }, // 끝났고 활동이 없으면 뺀다
    { name: "Lyrics Canonical Data", targetDate: null, progress: 0.2, state: "planned", teams: ["VOC"] },
  ];
  const rows = routeRows({ tickets, entries, views, goals, now: NOW });
  assert.deepEqual(rows.map((r) => r.project), ["Beta Readiness", "Lyrics Canonical Data", "Song Experience"]);
  const beta = rows[0];
  assert.deepEqual(beta.open, { todo: 1, inProgress: 1, inReview: 1 });
  assert.equal(beta.arrived14, 2);
  assert.equal(beta.landingWaitMedianMin, 60);
  assert.deepEqual(beta.aircraft, ["TEAM_B", "TEAM_E"]);
  assert.deepEqual(beta.goal, { targetDate: "2026-10-31", progress: 0.84, state: "started" });
  assert.deepEqual(rows[2], { project: "Song Experience", goal: null, open: { todo: 0, inProgress: 0, inReview: 0 }, arrived14: 0, aircraft: ["TEAM_E"], landingWaitMedianMin: null });
  // Linear 프로젝트를 못 읽으면 목표는 모두 null이고, 활동 있는 ROUTE만 남는다
  const off = routeRows({ tickets, entries, views, goals: null, now: NOW });
  assert.deepEqual(off.map((r) => [r.project, r.goal]), [["Beta Readiness", null], ["Song Experience", null]]);
});

test("NETWORK AIRCRAFT: 실적은 computeActuals 그대로(FLEET 카드와 같은 숫자), 퇴역은 뺀다", () => {
  const entries = [
    entry(1, { arrivedAt: ago(0, 2), blockMin: 30, class: { type: "BUILD", wake: "L", ratings: [], explicit: { type: true, wake: true } }, los: 2 }),
    entry(2, { arrivedAt: ago(7), blockMin: 90, class: { type: "BUILD", wake: "L", ratings: [], explicit: { type: true, wake: true } }, reverted: true, landingWaitMin: 20 }),
  ];
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_B: { targets: { flightsPerWeek: 3, onTime: 0.8 } }, TEAM_Z: { retired: { at: "", reason: null } } } };
  const rows = aircraftRows(fleetView(snap, fleet, undefined, entries, NOW));
  assert.deepEqual(rows.map((r) => r.registration), ["TEAM_B"]);
  const a = computeActuals(entries, "TEAM_B", NOW);
  assert.deepEqual(rows[0], {
    registration: "TEAM_B", callsign: "BRAVO", status: "idle",
    targets: { flightsPerWeek: 3, onTime: 0.8 },
    actuals: { weekDone: a.week, onTimeRate: a.onTime.rate, landingWaitMedianMin: a.landingWait.medianMin, reverts: a.reverted, los: a.los },
  });
  assert.deepEqual(rows[0].actuals, { weekDone: 1, onTimeRate: 0.5, landingWaitMedianMin: 40, reverts: 1, los: 2 });
});

test("NETWORK 추세(LOGBOOK): 날마다 ARRIVED 수, 착륙 대기 중앙값, 그날 머지된 Revert", () => {
  const entries = [
    entry(1, { arrivedAt: ago(0, 1), landingWaitMin: 10 }),
    entry(2, { arrivedAt: ago(0, 2), landingWaitMin: 30, reverted: true, revertedBy: { number: 9, url: "", at: ago(0, 1) } }),
    entry(3, { arrivedAt: ago(2), landingWaitMin: 5 }),
    entry(4, { arrivedAt: ago(40) }), // 28일 밖
  ];
  const days = logbookTrend(entries, NOW);
  assert.equal(days.length, NETWORK_DAYS);
  assert.deepEqual(days.at(-1), { date: "2026-09-27", arrived: 2, landingWaitMedianMin: 20, reverts: 1 });
  assert.deepEqual(days.at(-3), { date: "2026-09-25", arrived: 1, landingWaitMedianMin: 5, reverts: 0 });
  assert.equal(days.reduce((n, d) => n + d.arrived, 0), 3);
  assert.equal(days[0].landingWaitMedianMin, null);
});

test("NETWORK 추세(게이트): 날마다 그림자 판정 수, 누적 합의율은 gateOf와, CROSSCHECK 일치율은 crosscheckRateOf와 같다", () => {
  const create = (id: string, at: string): Op => ({ op: "create", id, at, kind: "ASSIGN", flight: `VOC-${id}`, aircraft: "b", aircraftName: "TEAM_B", airport: "VCDO", score: 1, factors: [] });
  const mark = (id: string, at: string, verdict: "agree" | "disagree") => ({ op: "crosscheck" as const, id, by: "CROSSCHECK", model: "m", verdict, reason: "r", at });
  const proposals = foldProposals([
    create("1", ago(5)), create("2", ago(5)), create("3", ago(5)), create("4", ago(5)),
    mark("1", ago(4, 1), "agree"),
    { op: "verdict", id: "1", at: ago(4), verdict: "agree", reason: null },
    { op: "verdict", id: "2", at: ago(4), verdict: "disagree", reason: "x" },
    { op: "verdict", id: "3", at: ago(0, 1), verdict: "agree", reason: null },
    { op: "approve", id: "4", at: ago(0, 1) }, // 승인 단계는 게이트처럼 세지 않는다
  ]);
  const ops = foldSchedule([
    { op: "draft", id: "S-1", at: ago(3), kind: "PRIORITIZE", flight: "VOC-7", payload: { priority: 2 }, reason: "r" },
    { op: "draft", id: "S-2", at: ago(3), kind: "PRIORITIZE", flight: "VOC-8", payload: { priority: 2 }, reason: "r" },
    mark("S-1", ago(2, 1), "disagree"),
    { op: "verdict", id: "S-1", at: ago(2), verdict: "agree", reason: null },
    mark("S-2", ago(2, 1), "agree"),
  ] as Parameters<typeof foldSchedule>[0]);
  const gates = gateTrend(proposals, ops, NOW);
  assert.equal(gates.length, NETWORK_DAYS);
  const byDate = Object.fromEntries(gates.map((g) => [g.date, g]));
  assert.equal(byDate["2026-09-23"].dispatchDecided, 2);
  assert.equal(byDate["2026-09-23"].dispatchAgreement, 0.5);
  assert.equal(byDate["2026-09-23"].crosscheckMatch, 1); // 1건 일치
  assert.equal(byDate["2026-09-24"].dispatchAgreement, 0.5); // 판정 없는 날은 앞의 누적을 잇는다
  assert.equal(byDate["2026-09-24"].scheduleAgreement, null);
  assert.equal(byDate["2026-09-25"].scheduleDecided, 1);
  assert.equal(byDate["2026-09-25"].crosscheckMatch, 0.5); // S-1은 불일치
  assert.equal(gates[0].dispatchAgreement, null);
  const last = gates.at(-1)!;
  assert.equal(last.dispatchDecided, 1);
  assert.equal(last.dispatchAgreement, dispatchGate(proposals).agreement);
  assert.equal(last.scheduleAgreement, scheduleGate(ops).agreement);
  assert.equal(gates.reduce((n, g) => n + g.dispatchDecided, 0), dispatchGate(proposals).decided);
  assert.equal(
    last.crosscheckMatch,
    crosscheckRateOf([...proposals.map((p) => ({ crosscheck: p.crosscheck, human: proposalHuman(p) })), ...ops.map((s) => ({ crosscheck: s.crosscheck, human: scheduleHuman(s) }))]).rate,
  );
});

test("NETWORK 전체: 응답 모양과 출처 표시", () => {
  const n = buildNetwork({ now: NOW, tickets: [], entries: [], views: [], goals: null, proposals: [], schedule: [], sources: { linear: false, github: true, logbook: false } });
  assert.deepEqual(Object.keys(n), ["at", "windowDays", "routes", "aircraft", "trend", "sources"]);
  assert.equal(n.windowDays, 28);
  assert.deepEqual(n.routes, []);
  assert.equal(n.trend.days.length, 28);
  assert.equal(n.trend.gates.length, 28);
  assert.deepEqual(n.sources, { linear: false, github: true, logbook: false });
});

test("Linear 프로젝트 목표: state는 status.type, 없으면 status.name. 모르는 값은 null, 이름 없으면 버림", () => {
  assert.deepEqual(toGoal({ name: "Beta Readiness", targetDate: "2026-10-31", progress: 0.5, status: { name: "In Progress", type: "started" } }), { name: "Beta Readiness", targetDate: "2026-10-31", progress: 0.5, state: "started", teams: [] });
  assert.equal(toGoal({ name: "X", status: { name: "Custom", type: null } })!.state, "Custom");
  assert.deepEqual(toGoal({ name: "X" }), { name: "X", targetDate: null, progress: null, state: null, teams: [] });
  assert.equal(toGoal({ name: "X", status: null })!.state, null);
  assert.equal(toGoal({ progress: 1 }), null);
});
