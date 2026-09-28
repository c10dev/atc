import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEntry } from "./logbook.ts";
import type { Ticket } from "./model.ts";
import { arrivedByProject, type NetworkCtx, networkChangesOf, networkSupersedeReason, parseRoute, parseTarget, stepError, type TargetPayload, weeklyArrived } from "./network-drafts.ts";
import { callsOf, changesOf, draftOps, fold, gateOf, NETWORK_APPLY_WHY, syncLines } from "./schedule.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const entry = (aircraft: string, flight: string | null, daysAgo: number): LogEntry =>
  ({ key: `o/r#${flight}-${daysAgo}`, aircraft, flight, arrivedAt: iso(daysAgo), landingWaitMin: 10, reverted: false, los: 0 }) as LogEntry;

type View = NetworkCtx["views"][number];
const view = (registration: string, over: Partial<View> = {}): View => ({
  registration,
  callsign: registration,
  status: "idle",
  routes: ["Song Experience"],
  targets: { flightsPerWeek: 3, onTime: 0.8 },
  actuals: { weekFrom: iso(3), week: 2, onTime: { rate: 0.75, within: 3, measured: 4 }, weekOnTime: { rate: 1, within: 2, measured: 2 }, reverted: 0, los: 0, total: 5, landingWait: { medianMin: 20, count: 5 }, recent: [] },
  retired: null,
  aog: null,
  ...over,
});
const ticket = (key: string, project: string) => ({ key, project, title: key, state: "Todo", stateType: "unstarted", labels: [], priority: 3 }) as unknown as Ticket;
const ctx = (over: Partial<NetworkCtx> = {}): NetworkCtx => ({
  views: [view("TEAM_I"), view("TEAM_C", { routes: ["Home & Discovery", "Song Experience"], actuals: { ...view("x").actuals, total: 1 } })],
  entries: [entry("TEAM_I", "VOC-1", 1), entry("TEAM_I", "VOC-2", 3), entry("TEAM_I", "VOC-3", 9), entry("TEAM_I", null, 20), entry("TEAM_C", "VOC-2", 2)],
  tickets: [ticket("VOC-1", "Song Experience"), ticket("VOC-2", "Beta Readiness"), ticket("VOC-3", "Song Experience")],
  goals: [
    { name: "Song Experience", state: "started", targetDate: null, progress: 0.5 },
    { name: "Beta Readiness", state: "started", targetDate: null, progress: 0.2 },
    { name: "Home & Discovery", state: "completed", targetDate: null, progress: 1 },
  ] as NetworkCtx["goals"],
  routeRows: [
    { project: "Song Experience", goal: null, open: { todo: 4, inProgress: 1, inReview: 0 }, arrived14: 3, aircraft: ["TEAM_I"], landingWaitMedianMin: 12 },
    { project: "Beta Readiness", goal: null, open: { todo: 6, inProgress: 0, inReview: 0 }, arrived14: 1, aircraft: [], landingWaitMedianMin: null },
  ],
  now: NOW,
  ...over,
});

test("stepError: flightsPerWeek는 2나 50% 가운데 큰 만큼, onTime은 0.1까지. 지금 값이 없거나 지우면 제한 없음", () => {
  assert.equal(stepError({ flightsPerWeek: 3, onTime: null }, { flightsPerWeek: 5 }), null);
  assert.match(stepError({ flightsPerWeek: 3, onTime: null }, { flightsPerWeek: 6 }) ?? "", /한 번에 2까지/);
  assert.equal(stepError({ flightsPerWeek: 10, onTime: null }, { flightsPerWeek: 15 }), null);
  assert.match(stepError({ flightsPerWeek: 10, onTime: null }, { flightsPerWeek: 16 }) ?? "", /한 번에 5까지/);
  assert.equal(stepError({ flightsPerWeek: null, onTime: null }, { flightsPerWeek: 20 }), null);
  assert.equal(stepError({ flightsPerWeek: 3, onTime: 0.8 }, { flightsPerWeek: null, onTime: 0.9 }), null);
  assert.match(stepError({ flightsPerWeek: null, onTime: 0.8 }, { onTime: 0.95 }) ?? "", /onTime/);
});

test("weeklyArrived·arrivedByProject: 최근 4주 7일씩, 14일 동안 간 프로젝트", () => {
  const c = ctx();
  assert.deepEqual(weeklyArrived(c.entries, "TEAM_I", NOW).map((w) => w.arrived), [0, 1, 1, 2]); // 20일 전은 14~21일 칸
  assert.deepEqual(arrivedByProject(c.entries, c.tickets, "TEAM_I", NOW), [
    { project: "Song Experience", arrived: 2 },
    { project: "Beta Readiness", arrived: 1 },
  ]);
});

test("parseTarget: 바꾸는 값과 그때 값, atc가 붙인 근거. 검사는 FLEET 탭과 같고 폭·근거 수를 본다", () => {
  const p = parseTarget({ registration: "team_i", flightsPerWeek: "5" }, ctx());
  assert.equal(p.registration, "TEAM_I");
  assert.equal(p.flightsPerWeek, 5);
  assert.equal("onTime" in p, false);
  assert.deepEqual(p.from, { flightsPerWeek: 3, onTime: 0.8 });
  assert.equal(p.evidence.arrived14, 5);
  assert.equal(p.evidence.aircraft.targets.flightsPerWeek, 3);
  assert.deepEqual(p.evidence.routes.map((r) => r.project), ["Song Experience"]);
  assert.equal(p.evidence.weekly.length, 4);
  assert.equal(parseTarget({ registration: "TEAM_I", onTime: "none" }, ctx()).onTime, null); // 목표 지우기
  assert.throws(() => parseTarget({ registration: "TEAM_I" }, ctx()), /flightsPerWeek나 onTime/);
  assert.throws(() => parseTarget({ registration: "TEAM_I", flightsPerWeek: 3 }, ctx()), /바꿀 것이 없음/);
  assert.throws(() => parseTarget({ registration: "TEAM_I", onTime: 1.5 }, ctx()), /onTime은 0~1/);
  assert.throws(() => parseTarget({ registration: "TEAM_I", flightsPerWeek: 9 }, ctx()), /한 번에/);
  assert.throws(() => parseTarget({ registration: "TEAM_C", flightsPerWeek: 4 }, ctx()), /ARRIVED가 1건/);
  assert.throws(() => parseTarget({ registration: "TEAM_Z", flightsPerWeek: 4 }, ctx()), /FLEET에 없는/);
  const gone = ctx({ views: [view("TEAM_I", { retired: { at: iso(1) } })] });
  assert.throws(() => parseTarget({ registration: "TEAM_I", flightsPerWeek: 4 }, gone), /퇴역/);
  const aog = ctx({ views: [view("TEAM_I", { aog: { reason: "수리", at: iso(1) } })] });
  assert.throws(() => parseTarget({ registration: "TEAM_I", flightsPerWeek: 4 }, aog), /AOG/);
});

test("parseRoute: 더하는 것은 끝나지 않은 Linear 프로젝트, 빼는 것은 지금 ROUTE에 있는 것(끝난 프로젝트도)", () => {
  const p = parseRoute({ registration: "TEAM_C", add: ["beta readiness"], remove: "Home & Discovery" }, ctx());
  assert.deepEqual(p.add, ["Beta Readiness"]);
  assert.deepEqual(p.remove, ["Home & Discovery"]);
  assert.deepEqual(p.from, ["Home & Discovery", "Song Experience"]);
  assert.deepEqual(p.evidence.routes.map((r) => r.project), ["Beta Readiness"]); // 끝난 프로젝트는 NETWORK 행이 없다
  assert.deepEqual(p.evidence.where, [{ project: "Beta Readiness", arrived: 1 }]);
  assert.throws(() => parseRoute({ registration: "TEAM_C", add: "Home & Discovery" }, ctx()), /더할 수 없는/);
  assert.throws(() => parseRoute({ registration: "TEAM_C", add: "Song Experience" }, ctx()), /이미 있음/);
  assert.throws(() => parseRoute({ registration: "TEAM_C", remove: "Beta Readiness" }, ctx()), /ROUTE에 없음/);
  assert.throws(() => parseRoute({ registration: "TEAM_C" }, ctx()), /add나 remove/);
  assert.throws(() => parseRoute({ registration: "TEAM_C", add: "Beta Readiness" }, ctx({ goals: null })), /아직 읽지 못함/);
});

test("networkChangesOf·networkSupersedeReason: FLEET 등록부와 비교", () => {
  const p = parseTarget({ registration: "TEAM_I", flightsPerWeek: 5, onTime: 0.85 }, ctx());
  assert.deepEqual(networkChangesOf("TARGET", p, view("TEAM_I")), ["TEAM_I flightsPerWeek 3 → 5", "TEAM_I onTime 80% → 85%"]);
  assert.deepEqual(networkChangesOf("TARGET", p, view("TEAM_I", { targets: { flightsPerWeek: 5, onTime: 0.85 } })), []);
  const r = parseRoute({ registration: "TEAM_C", add: "Beta Readiness", remove: "Home & Discovery" }, ctx());
  assert.deepEqual(networkChangesOf("ROUTE", r, view("TEAM_C", { routes: ["Home & Discovery"] })), ["TEAM_C ROUTE + Beta Readiness", "TEAM_C ROUTE − Home & Discovery"]);
  assert.equal(networkSupersedeReason("TARGET", p, [view("TEAM_I")]), null);
  assert.equal(networkSupersedeReason("TARGET", p, [view("TEAM_I", { targets: { flightsPerWeek: 5, onTime: 0.85 } })]), "FLEET에 이미 반영됨");
  assert.equal(networkSupersedeReason("TARGET", p, [view("TEAM_I", { retired: { at: iso(0) } })]), "AIRCRAFT가 퇴역함");
  assert.equal(networkSupersedeReason("TARGET", p, []), "AIRCRAFT가 FLEET에 없음");
});

test("SCHEDULE TARGET·ROUTE: flight 없이 AIRCRAFT·종류마다 열린 초안 하나, 한도에 들고, 게이트와 따로 센다", () => {
  const c = ctx();
  const first = draftOps([], { kind: "TARGET", registration: "TEAM_I", flightsPerWeek: 4, reason: "14일 5건, 대기 FLIGHT 5" }, [], iso(0.1), 0, { network: c });
  assert.deepEqual(first.map((l) => `${l.op}:${l.id}`), ["draft:S-0001"]);
  let ops = fold(first);
  assert.equal(ops[0].flight, null);
  assert.equal((ops[0].payload as TargetPayload).evidence.arrived14, 5);
  // 같은 AIRCRAFT·종류의 새 초안이 대신한다. ROUTE는 따로다
  const second = draftOps(ops, { kind: "TARGET", registration: "TEAM_I", flightsPerWeek: 5, reason: "x" }, [], iso(0.05), ops.length, { network: c });
  assert.deepEqual(second.map((l) => `${l.op}:${l.id}`), ["supersede:S-0001", "draft:S-0002"]);
  ops = fold([...first, ...second]);
  const route = draftOps(ops, { kind: "ROUTE", registration: "TEAM_I", add: "Beta Readiness", reason: "y" }, [], iso(0.04), ops.length, { network: c });
  assert.deepEqual(route.map((l) => `${l.op}:${l.id}`), ["draft:S-0003"]);
  assert.throws(() => draftOps(ops, { kind: "TARGET", registration: "TEAM_I", flightsPerWeek: 4, reason: " " }, [], iso(0), ops.length, { network: c }), /근거/);
  assert.throws(() => draftOps(ops, { kind: "TARGET", registration: "TEAM_I", flightsPerWeek: 4, reason: "x" }, [], iso(0), ops.length), /NETWORK 자료가 없음/);
  ops = fold([...first, ...second, ...route]);
  assert.deepEqual(changesOf("TARGET", ops[1].payload, undefined, view("TEAM_I")), ["TEAM_I flightsPerWeek 3 → 5"]);
  // 판정은 게이트·CROSSCHECK 일치율에 넣지 않고 종류마다 센다
  ops = fold([...first, ...second, ...route, { op: "verdict", id: "S-0002", at: iso(0), verdict: "agree", reason: null }, { op: "verdict", id: "S-0003", at: iso(0), verdict: "disagree", reason: "아직 이름" }]);
  const g = gateOf(ops);
  assert.equal(g.decided, 0);
  assert.deepEqual(g.network, { TARGET: { decided: 1, agreed: 1, agreement: 1 }, ROUTE: { decided: 1, agreed: 0, agreement: 0 } });
  // 발부(Linear 호출)는 없다
  assert.throws(() => callsOf(ops[1], undefined, "Vocado"), (e: Error) => e.message === NETWORK_APPLY_WHY);
});

test("SCHEDULE TARGET·ROUTE 동기화: FLEET에 이미 반영되거나 퇴역하면 SUPERSEDED, 3일이면 EXPIRED, views가 없으면 만료만", () => {
  const c = ctx();
  const lines = [
    ...draftOps([], { kind: "TARGET", registration: "TEAM_I", flightsPerWeek: 4, reason: "x" }, [], iso(0.1), 0, { network: c }),
  ];
  const lines2 = draftOps(fold(lines), { kind: "ROUTE", registration: "TEAM_I", add: "Beta Readiness", reason: "y" }, [], iso(4), 1, { network: c });
  const ops = fold([...lines, ...lines2]);
  const views = [view("TEAM_I", { targets: { flightsPerWeek: 4, onTime: 0.8 } })];
  assert.deepEqual(syncLines(ops, [], NOW, { views }).map((l) => `${l.op}:${l.id}`), ["supersede:S-0001", "expire:S-0002"]);
  assert.deepEqual(syncLines(ops, [], NOW).map((l) => `${l.op}:${l.id}`), ["expire:S-0002"]);
  assert.equal((syncLines(ops, [], NOW, { views }).find((l) => l.id === "S-0001") as { reason: string }).reason, "FLEET에 이미 반영됨");
});
