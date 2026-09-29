import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "./model.ts";
import type { Route } from "./routes.ts";
import { callsOf, candidatesOf, changesOf, draftOps, fold, gateOf, type ScheduleOp, ScheduleError, syncLines } from "./schedule.ts";
import { ackRoutes, freshRouteKeys, parseWaypoint, routesWithoutWaypointsOf, waypointCandidatesOf, waypointSyncOf } from "./schedule-waypoint.ts";
import type { Milestone } from "./sources/linear-projects.ts";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (key: string, over: Partial<Ticket> = {}) =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", labels: [], priority: 3, project: "Song Catalog", url: null, ...over }) as Ticket;
const issue = (key: string, stateType = "unstarted") => ({ key, title: key, state: stateType, stateType, completedAt: null });
const ms = (id: string, name: string, over: Partial<Milestone> = {}): Milestone => ({
  id,
  project: "Song Catalog",
  name,
  description: "Exit criteria:\n1. Catalog API returns songs\n2. Read model rebuilt nightly",
  targetDate: null,
  progress: 0.5,
  sortOrder: 1,
  status: "next",
  issues: [],
  truncated: false,
  teams: ["VOC"],
  ...over,
});

// Song Catalog: Foundation(지남) → Beta Ready(지금 구간, VOC-1이 있음) → Launch(다음). Lyrics: 모두 지남. Search: 잘림
const MS: Milestone[] = [
  ms("m-1", "Foundation", { sortOrder: 0, status: "done", issues: [issue("VOC-9", "completed")] }),
  ms("m-2", "Beta Ready", { sortOrder: 1, issues: [issue("VOC-1")] }),
  ms("m-3", "Launch", { sortOrder: 2, status: "unstarted", description: "Ship when beta feedback is in." }),
  ms("m-4", "M1", { project: "Lyrics", status: "done", issues: [issue("VOC-30", "completed")] }),
  ms("m-5", "Index", { project: "Search", truncated: true }),
];

test("WAYPOINT 입력 검사: 이름·id, 다른 프로젝트, 지난 WAYPOINT, 이미 붙음, 잘린 ROUTE, 못 읽음", () => {
  const f = t("VOC-2");
  assert.deepEqual(parseWaypoint({ milestone: "beta ready" }, f, MS), { route: "Song Catalog", milestone: { id: "m-2", name: "Beta Ready" } });
  assert.deepEqual(parseWaypoint({ milestone: "m-3" }, f, MS).milestone, { id: "m-3", name: "Launch" });
  assert.throws(() => parseWaypoint({}, f, MS), /이름이나 id가 필요함/);
  // 다른 프로젝트의 마일스톤(가능한 것은 지나지 않은 것만 보인다)
  assert.throws(() => parseWaypoint({ milestone: "M1" }, f, MS), /Song Catalog의 마일스톤이 아님: M1 \(가능: Beta Ready, Launch\)/);
  assert.throws(() => parseWaypoint({ milestone: "Foundation" }, f, MS), /이미 지난 WAYPOINT\(done\)/);
  assert.throws(() => parseWaypoint({ milestone: "Launch" }, t("VOC-1"), MS), /이미 WAYPOINT Beta Ready에 있음/);
  assert.throws(() => parseWaypoint({ milestone: "Index" }, t("VOC-40", { project: "Search" }), MS), (e: Error & { status?: number }) => /잘려/.test(e.message) && e.status === 409);
  assert.throws(() => parseWaypoint({ milestone: "Launch" }, t("VOC-2", { project: null }), MS), /프로젝트\(ROUTE\)가 없음/);
  assert.throws(() => parseWaypoint({ milestone: "Launch" }, f, null), (e: Error & { status?: number }) => /아직 읽지 못함/.test(e.message) && e.status === 503);
});

test("WAYPOINT 초안: In Progress도 되고 닫힌 FLIGHT·근거 없음·자료 없음은 거절, 판정은 S2 게이트에 센다", () => {
  const tickets = [t("VOC-2", { state: "In Progress", stateType: "started" }), t("VOC-3", { state: "Done", stateType: "completed" })];
  const c = { waypoint: { milestones: MS } };
  const first = draftOps([], { kind: "WAYPOINT", flight: "voc-2", milestone: "Beta Ready", reason: "완료 기준 1이 이 FLIGHT" }, tickets, iso(10), 0, c);
  const op = fold(first)[0];
  assert.equal(op.kind, "WAYPOINT");
  assert.equal(op.flight, "VOC-2");
  assert.deepEqual(op.payload, { route: "Song Catalog", milestone: { id: "m-2", name: "Beta Ready" } });
  assert.deepEqual(changesOf("WAYPOINT", op.payload, tickets[0]), ["WAYPOINT 없음 → Song Catalog · Beta Ready"]);
  // 같은 FLIGHT의 새 WAYPOINT 초안은 앞의 것을 대신한다
  const second = draftOps(fold(first), { kind: "WAYPOINT", flight: "VOC-2", milestone: "Launch", reason: "다음 구간" }, tickets, iso(5), 1, c);
  assert.deepEqual(second.map((l) => `${l.op}:${l.id}`), ["supersede:S-0001", "draft:S-0002"]);
  assert.throws(() => draftOps([], { kind: "WAYPOINT", flight: "VOC-3", milestone: "Launch", reason: "x" }, tickets, iso(0), 0, c), /이미 닫힘/);
  assert.throws(() => draftOps([], { kind: "WAYPOINT", flight: "VOC-2", milestone: "Launch", reason: " " }, tickets, iso(0), 0, c), /근거/);
  assert.throws(() => draftOps([], { kind: "WAYPOINT", flight: "VOC-2", milestone: "Launch", reason: "x" }, tickets, iso(0), 0), (e) => e instanceof ScheduleError && e.status === 503);
  assert.throws(() => draftOps([], { kind: "WAYPOINT", flight: "VOC-2", milestone: "Launch", reason: "x" }, tickets, iso(0), 0, { waypoint: { milestones: null } }), (e) => e instanceof ScheduleError && e.status === 503);
  // 후보 팀이 아닌 FLIGHT는 다른 종류처럼 거절
  assert.throws(() => draftOps([], { kind: "WAYPOINT", flight: "ATC-2", milestone: "Launch", reason: "x" }, [t("ATC-2")], iso(0), 0, { ...c, teams: new Set(["VOC"]) }), /SCHEDULE 후보가 아님/);
  const agreed = fold([...first, { op: "verdict", id: "S-0001", at: iso(1), verdict: "agree", reason: null }]);
  assert.equal(gateOf(agreed).decided, 1);
});

const base = { at: iso(10), status: "approved" as const, statusAt: iso(5), verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null, reason: "완료 기준 1이 이 FLIGHT" };

test("WAYPOINT 발부 호출: save_issue {id, milestone: id} 하나와 근거 댓글, 상태·담당·라벨은 없음", () => {
  const op: ScheduleOp = { ...base, id: "S-0031", kind: "WAYPOINT", flight: "VOC-2", payload: { route: "Song Catalog", milestone: { id: "m-2", name: "Beta Ready" } } };
  const calls = callsOf(op, t("VOC-2", { labels: ["type:BUILD"] }), "Vocado");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { tool: "save_issue", input: { id: "VOC-2", milestone: "m-2" } });
  assert.equal(calls[1].tool, "save_comment");
  assert.deepEqual(Object.keys(calls[1].input).sort(), ["body", "issueId"]);
  assert.match(String(calls[1].input.body), /^\[OCC S-0031\] WAYPOINT Song Catalog · Beta Ready — 근거: 완료 기준 1이 이 FLIGHT \(SCHEDULE S-0031, SUPERVISOR 승인\)$/);
  for (const k of ["state", "assignee", "delegate", "labels", "addLabels", "removeLabels", "project", "priority"]) assert.equal(k in calls[0].input, false);
});

test("WAYPOINT APPLIED·SUPERSEDED: 그 WAYPOINT에 보이면 APPLIED(발부 전이면 SUPERSEDED), 닫히거나 다른 WAYPOINT에 붙으면 SUPERSEDED", () => {
  const draft = { op: "draft" as const, id: "S-0001", at: iso(30), kind: "WAYPOINT" as const, flight: "VOC-2", payload: { route: "Song Catalog", milestone: { id: "m-2", name: "Beta Ready" } }, reason: "x" };
  const released = [draft, { op: "approve" as const, id: "S-0001", at: iso(20) }, { op: "release" as const, id: "S-0001", at: iso(10), calls: [] }];
  const withIt = MS.map((m) => (m.id === "m-2" ? { ...m, issues: [...m.issues, issue("VOC-2")] } : m));
  const onLaunch = MS.map((m) => (m.id === "m-3" ? { ...m, issues: [issue("VOC-2")] } : m));
  const tk = [t("VOC-2", { state: "In Progress", stateType: "started" })];
  assert.deepEqual(syncLines(fold(released), tk, NOW, { milestones: withIt }), [{ op: "apply", id: "S-0001", at: iso(0), ref: "VOC-2" }]);
  assert.deepEqual(syncLines(fold([draft]), tk, NOW, { milestones: withIt }), [{ op: "supersede", id: "S-0001", at: iso(0), reason: "Linear에 이미 반영됨" }]);
  assert.deepEqual(syncLines(fold(released), tk, NOW, { milestones: MS }), []); // 아직 안 보임
  assert.match(String((syncLines(fold([draft]), tk, NOW, { milestones: onLaunch })[0] as { reason: string }).reason), /다른 WAYPOINT에 붙음\(Launch\)/);
  assert.match(String((syncLines(fold([draft]), [t("VOC-2", { state: "Canceled", stateType: "canceled" })], NOW, { milestones: MS })[0] as { reason: string }).reason), /FLIGHT가 닫힘/);
  // 마일스톤을 못 읽었거나 넘기지 않으면 소속으로는 닫지 않는다(닫힘은 본다)
  assert.deepEqual(syncLines(fold([draft]), tk, NOW, { milestones: null }), []);
  assert.deepEqual(syncLines(fold([draft]), tk, NOW), []);
  assert.equal(syncLines(fold([draft]), [t("VOC-2", { state: "Done", stateType: "completed" })], NOW)[0].op, "supersede");
  // 발부 전에 WAYPOINT를 지나면 SUPERSEDED, 발부 뒤면 반영을 기다린다. 마일스톤이 없어지면 SUPERSEDED
  const passed = MS.map((m) => (m.id === "m-2" ? { ...m, status: "done" } : m));
  assert.match(String((syncLines(fold([draft]), tk, NOW, { milestones: passed })[0] as { reason: string }).reason), /이미 지남/);
  assert.deepEqual(syncLines(fold(released), tk, NOW, { milestones: passed }), []);
  assert.match(String((syncLines(fold([draft]), tk, NOW, { milestones: MS.filter((m) => m.id !== "m-2") })[0] as { reason: string }).reason), /없어짐/);
  // 3일이 지나면 EXPIRED
  const old = { ...draft, at: new Date(NOW - 4 * 86_400_000).toISOString() };
  assert.equal(syncLines(fold([old]), tk, NOW, { milestones: MS })[0].op, "expire");
  assert.deepEqual(waypointSyncOf({ flight: "VOC-2", payload: draft.payload, status: "draft" }, undefined, MS), { supersede: "FLIGHT가 목록에 없음" });
});

test("WAYPOINT 후보: 소속 없는 열린 FLIGHT만, 지난 것만 있는 ROUTE·잘린 ROUTE·열린 작업은 뺀다", () => {
  const tickets = [
    t("VOC-1"), // Beta Ready에 있음
    t("VOC-2"), // 없음 → 후보
    t("VOC-4", { state: "In Progress", stateType: "started" }), // 없음 → 후보(진행 중도)
    t("VOC-5", { state: "Done", stateType: "completed" }), // 닫힘
    t("VOC-9", { state: "Done", stateType: "completed" }),
    t("VOC-31", { project: "Lyrics" }), // 모두 지난 ROUTE
    t("VOC-40", { project: "Search" }), // 잘린 ROUTE
    t("VOC-50", { project: "Beta Readiness" }), // WAYPOINT 없는 ROUTE(알림 쪽)
    t("VOC-60", { project: null }),
  ];
  const c = waypointCandidatesOf(tickets, MS);
  assert.equal(c.length, 1);
  assert.equal(c[0].route, "Song Catalog");
  assert.deepEqual(c[0].flights, ["VOC-2", "VOC-4"]);
  // 지나지 않은 WAYPOINT만, ROUTE MAP 순서. 번호 목록이 없으면 설명
  assert.deepEqual(c[0].waypoints.map((w) => [w.name, w.state, w.criteria.length, w.description]), [
    ["Beta Ready", "active", 2, null],
    ["Launch", "planned", 0, "Ship when beta feedback is in."],
  ]);
  // 열린 WAYPOINT 작업이 있는 FLIGHT는 candidatesOf가 뺀다. 마일스톤을 못 읽었으면 null
  const open: ScheduleOp = { ...base, id: "S-0001", kind: "WAYPOINT", status: "draft", flight: "VOC-2", payload: { route: "Song Catalog", milestone: { id: "m-2", name: "Beta Ready" } } };
  assert.deepEqual(candidatesOf(tickets, [open], new Map(), NOW, [], MS).waypoint?.[0].flights, ["VOC-4"]);
  assert.equal(candidatesOf(tickets, [], new Map(), NOW, [], null).waypoint, null);
  // 모두 후보가 아니면 ROUTE째 빠진다
  assert.deepEqual(waypointCandidatesOf([t("VOC-1")], MS), []);
});

const route = (project: string, open: Partial<Route["open"]>, waypoints = 0) =>
  ({ project, open: { active: 0, blocked: 0, planned: 0, ...open }, waypoints: Array.from({ length: waypoints }) }) as Pick<Route, "project" | "open" | "waypoints">;

test("WAYPOINT 없는 ROUTE 알림: 열린 FLIGHT가 있는 것만, 한 번 보고하고 ack, 풀리면 잊는다", () => {
  const routes = [route("Song Catalog", { active: 3 }, 2), route("Beta Readiness", { active: 4, planned: 9 }), route("Docs", { planned: 2 }), route("Idle", {})];
  const list = routesWithoutWaypointsOf(routes);
  assert.deepEqual(list, [{ route: "Beta Readiness", open: 13 }, { route: "Docs", open: 2 }]);
  let r = { reported: {} as Record<string, string> };
  assert.deepEqual(freshRouteKeys(list, r), ["Beta Readiness", "Docs"]);
  r = ackRoutes(list, r, ["Beta Readiness", "Nope"], iso(0));
  assert.deepEqual(r.reported, { "Beta Readiness": iso(0) });
  assert.deepEqual(freshRouteKeys(list, r), ["Docs"]);
  // 다시 ack해도 처음 시각을 지킨다
  assert.equal(ackRoutes(list, r, ["Beta Readiness"], iso(-5)).reported["Beta Readiness"], iso(0));
  // WAYPOINT가 생기면 잊고, 다시 없어지면 fresh
  const later = routesWithoutWaypointsOf([route("Beta Readiness", { active: 4 }, 1), route("Docs", { planned: 2 })]);
  r = ackRoutes(later, r, [], iso(-10));
  assert.deepEqual(r.reported, {});
  assert.deepEqual(freshRouteKeys(list, r), ["Beta Readiness", "Docs"]);
});
