import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { Unserved } from "./dispatch.ts";
import type { AircraftView } from "./fleet.ts";
import {
  type FleetCandidate,
  type FleetInputs,
  type FleetPlanOp,
  FLEET_PLAN_DEFAULTS,
  fleetPlanGateOf,
  fleetPlanOf,
  foldFleetPlan,
  persistOf,
  runwayOf,
  syncFleetPlan,
} from "./fleet-plan.ts";
import { computeActuals } from "./logbook.ts";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const view = (registration: string, over: Partial<AircraftView> = {}): AircraftView => ({
  registration, callsign: registration, status: "idle", base: "ATCC",
  complement: DEFAULT_FLEET.defaults.complement, complementIsDefault: true, ratings: ["UI", "DATA", "DOCS"], ratingsIsDefault: true,
  routes: [], targets: {}, note: null, flying: [], flights: [], flyingSince: null, lastActiveAt: null, configuration: null, enteredAt: ago(60 * DAY), aog: null, retired: null,
  actuals: computeActuals([], registration, NOW), ...over,
});
const need = (flight: string, over: Partial<Unserved> = {}): Unserved => ({
  flight, airport: "ATCC", type: "BUILD", ratings: [], labeled: true, why: "no-aircraft", tails: [], ...over,
});
// 활주로가 병목이 아닌 기록(착륙 대기 3분, block 60분)과 최근 ARRIVED
const arrived = (aircraft: string, airport = "ATCC", at = ago(DAY)) => ({ aircraft, airport, arrivedAt: at, blockMin: 60, landingWaitMin: 3 });

const inputs = (over: Partial<FleetInputs> = {}): FleetInputs => ({
  aircraft: [],
  plan: { assign: [], unserved: [] },
  sessions: [],
  lastActive: new Map(),
  nordo: new Set(),
  los: new Map(),
  // 기본은 모두 최근에 ARRIVED — RETIRE 후보가 섞이지 않게
  logbook: [..."ABCDEFGHIJK"].map((c) => arrived(`TEAM_${c}`)),
  openPrs: new Set(),
  groundStops: new Set(),
  dwell: new Map(),
  maxLaunched: 6,
  nextRegistration: "TEAM_L",
  defaults: DEFAULT_FLEET.defaults,
  config: FLEET_PLAN_DEFAULTS,
  now: NOW,
  ...over,
});
const kinds = (cs: FleetCandidate[]) => cs.map((c) => `${c.kind} ${c.aircraft}`).sort();

test("LAUNCH: 받을 곳 없는 FLIGHT가 있으면 운항하지 않는 등록 AIRCRAFT 중 가장 많이 받을 수 있는 것", () => {
  const out = fleetPlanOf(
    inputs({
      aircraft: [
        view("TEAM_H", { status: "busy", flying: ["ATC-1"] }),
        view("TEAM_I", { status: "absent", ratings: ["UI", "DOCS"] }),
        view("TEAM_J", { status: "absent", ratings: ["DOCS"] }),
        view("TEAM_K", { status: "absent", base: "RNPU" }), // 다른 AIRPORT
      ],
      plan: { assign: [], unserved: [need("ATC-2", { ratings: ["UI"] }), need("ATC-3", { ratings: ["DOCS"] })] },
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["LAUNCH TEAM_I"]);
  const c = out.candidates[0];
  assert.equal(c.key, "DEMAND|ATCC");
  assert.match(c.reasons.find((r) => r.code === "waiting")!.detail, /2건: ATC-2, ATC-3/);
  assert.deepEqual(out.demand.find((d) => d.airport === "ATCC"), { airport: "ATCC", served: 0, unserved: ["ATC-2", "ATC-3"], parked: 0, blocked: null });
});

test("LAUNCH를 막는 것: GROUND STOP, 활주로 병목, 백그라운드 상한, 최근 STOP(minDwell)", () => {
  const base = {
    aircraft: [view("TEAM_I", { status: "absent" })],
    plan: { assign: [], unserved: [need("ATC-2")] },
  };
  const blocked = (over: Partial<FleetInputs>) => {
    const out = fleetPlanOf(inputs({ ...base, ...over }));
    return { none: !out.candidates.length, why: out.demand[0].blocked };
  };
  assert.deepEqual(blocked({ groundStops: new Set(["ATCC"]) }), { none: true, why: "GROUND STOP 중" });
  const slow = [1, 2, 3].map(() => ({ aircraft: "TEAM_I", airport: "ATCC", arrivedAt: ago(DAY), blockMin: 60, landingWaitMin: 48 * 60 }));
  const r = blocked({ logbook: slow });
  assert.equal(r.none, true);
  assert.match(r.why!, /^활주로가 병목 — 착륙 대기 중앙값 2d · block 1h/);
  const bg = Array.from({ length: 6 }, (_, n) => ({ registration: `TEAM_${"ABCDEF"[n]}`, kind: "background", id: `b${n}`, startedAt: NOW }));
  assert.deepEqual(blocked({ sessions: bg }), { none: true, why: "백그라운드 세션 6/6 — 상한" });
  // 방금 멈춘 AIRCRAFT는 다시 띄우자고 하지 않는다. 다른 맞는 AIRCRAFT가 없으면 ENTRY
  const out = fleetPlanOf(inputs({ ...base, dwell: new Map([["TEAM_I", { op: "stop" as const, at: ago(30 * MIN) }]]) }));
  assert.deepEqual(kinds(out.candidates), ["ENTRY TEAM_L"]);
});

test("ENTRY: 맞는 등록 AIRCRAFT가 없으면 FLIGHT를 가장 많이 받는 CONFIGURATION으로 새 등록번호를 제안", () => {
  const out = fleetPlanOf(
    inputs({
      aircraft: [view("TEAM_I", { status: "absent", ratings: ["UI", "DOCS"] })],
      plan: { assign: [], unserved: [need("ATC-5", { ratings: ["SEC"] }), need("ATC-6", { ratings: ["SEC", "DATA"] })] },
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["ENTRY TEAM_L"]);
  assert.equal(out.candidates[0].configuration, "security");
  // tail로 정한 FLIGHT는 새 AIRCRAFT로 풀리지 않는다
  const tail = fleetPlanOf(inputs({ plan: { assign: [], unserved: [need("ATC-7", { why: "no-tail", tails: ["TEAM_Q"] })] } }));
  assert.equal(tail.candidates.length, 0);
  assert.match(tail.demand[0].blocked!, /tail로 정한 팀이 운항할 수 없음: ATC-7\(tail:TEAM_Q\)/);
});

test("LAUNCH: tail로 정한 등록 AIRCRAFT가 떠 있지 않으면 그 AIRCRAFT를", () => {
  const out = fleetPlanOf(
    inputs({
      aircraft: [view("TEAM_I", { status: "absent" }), view("TEAM_J", { status: "absent" })],
      plan: { assign: [], unserved: [need("ATC-8", { why: "no-tail", tails: ["TEAM_J"] })] },
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["LAUNCH TEAM_J"]);
});

test("분류 라벨이 없는 FLIGHT는 rating 확인 없이 세고 사유에 적는다", () => {
  const out = fleetPlanOf(inputs({ aircraft: [view("TEAM_I", { status: "absent" })], plan: { assign: [], unserved: [need("ATC-9", { labeled: false })] } }));
  assert.match(out.candidates[0].reasons.find((r) => r.code === "unlabeled")!.detail, /ATC-9/);
});

test("STOP: 오래 쉰 백그라운드 세션, 수요가 있는 AIRPORT는 예비를 남긴다", () => {
  const bg = (reg: string) => ({ registration: reg, kind: "background", id: reg.slice(-1).toLowerCase(), startedAt: NOW - DAY });
  const aircraft = [view("TEAM_H"), view("TEAM_I")];
  const lastActive = new Map([
    ["TEAM_H", ago(20 * HOUR)],
    ["TEAM_I", ago(13 * HOUR)],
  ]);
  // 수요 없음: 둘 다 멈춘다
  const quiet = fleetPlanOf(inputs({ aircraft, sessions: [bg("TEAM_H"), bg("TEAM_I")], lastActive }));
  assert.deepEqual(kinds(quiet.candidates), ["STOP TEAM_H", "STOP TEAM_I"]);
  // 수요 있음(다른 팀에 배정된 FLIGHT): 예비 1대를 남기고, 더 오래 쉰 쪽부터 멈춘다
  const busy = fleetPlanOf(
    inputs({
      aircraft: [...aircraft, view("TEAM_J", { status: "busy" })],
      plan: { assign: [{ kind: "ASSIGN", flight: "ATC-1", aircraft: "j", aircraftName: "TEAM_J", airport: "ATCC", score: 1, factors: [] }], unserved: [] },
      sessions: [bg("TEAM_H"), bg("TEAM_I")],
      lastActive,
    }),
  );
  assert.deepEqual(kinds(busy.candidates), ["STOP TEAM_H"]);
  assert.match(busy.candidates[0].reasons.find((r) => r.code === "reserve")!.detail, /PARKED 2 → 1 · 예비 1/);
  // 12시간이 안 됐거나, STAND를 쥐었거나, 계획이 FLIGHT를 주거나, 방금 띄웠으면 멈추지 않는다
  const none = fleetPlanOf(
    inputs({
      aircraft: [view("TEAM_H", { flying: ["ATC-3"] }), view("TEAM_I"), view("TEAM_J")],
      plan: { assign: [{ kind: "ASSIGN", flight: "ATC-1", aircraft: "i", aircraftName: "TEAM_I", airport: "ATCC", score: 1, factors: [] }], unserved: [] },
      sessions: [bg("TEAM_H"), bg("TEAM_I"), bg("TEAM_J")],
      lastActive: new Map([...lastActive, ["TEAM_J", ago(30 * HOUR)]]),
      dwell: new Map([["TEAM_J", { op: "launch" as const, at: ago(HOUR) }]]),
    }),
  );
  assert.deepEqual(kinds(none.candidates), []);
  // 데스크톱·터미널 세션은 대상이 아니다
  const desk = fleetPlanOf(inputs({ aircraft, sessions: [{ ...bg("TEAM_H"), kind: "interactive" }], lastActive }));
  assert.deepEqual(kinds(desk.candidates), []);
});

test("STOP: RETIRED인데 떠 있는 백그라운드 세션", () => {
  const out = fleetPlanOf(inputs({ aircraft: [view("TEAM_H", { retired: { at: ago(DAY), reason: null } })], sessions: [{ registration: "TEAM_H", kind: "background", id: "h", startedAt: NOW }] }));
  assert.deepEqual(kinds(out.candidates), ["STOP TEAM_H"]);
});

test("RESTART: 예비로 남아야 해서 멈추지 못하는 오래된 백그라운드 세션", () => {
  const out = fleetPlanOf(
    inputs({
      aircraft: [view("TEAM_H"), view("TEAM_J", { status: "busy" })],
      plan: { assign: [{ kind: "ASSIGN", flight: "ATC-1", aircraft: "j", aircraftName: "TEAM_J", airport: "ATCC", score: 1, factors: [] }], unserved: [] },
      sessions: [{ registration: "TEAM_H", kind: "background", id: "h", startedAt: NOW - 4 * DAY }],
      lastActive: new Map([["TEAM_H", ago(20 * HOUR)]]),
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["RESTART TEAM_H"]);
});

test("AOG: NORDO나 최근 LOS, 이미 AOG·RETIRED면 없음", () => {
  const out = fleetPlanOf(
    inputs({
      aircraft: [view("TEAM_H", { status: "absent" }), view("TEAM_I"), view("TEAM_J", { aog: { reason: "x", until: null, at: ago(DAY) } })],
      nordo: new Set(["TEAM_H", "TEAM_J"]),
      los: new Map([["TEAM_I", ago(HOUR)]]),
      logbook: [arrived("TEAM_H"), arrived("TEAM_I"), arrived("TEAM_J")],
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["AOG TEAM_H", "AOG TEAM_I"]);
  assert.equal(out.candidates.find((c) => c.aircraft === "TEAM_H")!.reasons.at(-1)!.value, "2026-09-29");
});

test("RETIRE: 30일 ARRIVED 없음. 새로 들인 것, 열린 PR, AIRBORNE, 예비로 필요한 것은 아님", () => {
  const out = fleetPlanOf(
    inputs({
      aircraft: [
        view("TEAM_A", { status: "absent" }),
        view("TEAM_B", { status: "absent", enteredAt: ago(3 * DAY) }),
        view("TEAM_C", { status: "absent" }),
        view("TEAM_D", { status: "busy" }),
        view("TEAM_E", { status: "absent", enteredAt: null }),
        view("TEAM_F", { status: "absent" }),
      ],
      openPrs: new Set(["TEAM_C"]),
      logbook: [arrived("TEAM_F", "ATCC", ago(40 * DAY)), arrived("TEAM_A", "ATCC", ago(31 * DAY))],
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["RETIRE TEAM_A", "RETIRE TEAM_E", "RETIRE TEAM_F"]);
  assert.match(out.candidates.find((c) => c.aircraft === "TEAM_A")!.reasons[0].detail, /마지막 2026-08-28/);
  // 수요가 있는 AIRPORT의 마지막 PARKED AIRCRAFT는 예비라 퇴역시키지 않는다
  const reserve = fleetPlanOf(
    inputs({
      aircraft: [view("TEAM_A"), view("TEAM_D", { status: "busy" })],
      plan: { assign: [{ kind: "ASSIGN", flight: "ATC-1", aircraft: "d", aircraftName: "TEAM_D", airport: "ATCC", score: 1, factors: [] }], unserved: [] },
    }),
  );
  assert.deepEqual(kinds(reserve.candidates), []);
});

test("runwayOf: 최근 14일 착륙 대기와 block의 중앙값", () => {
  assert.deepEqual(runwayOf([], "ATCC", NOW), { bottleneck: false, detail: "최근 14일 착륙 기록 부족 — 활주로 확인 못 함" });
  const old = { aircraft: "TEAM_H", airport: "ATCC", arrivedAt: ago(20 * DAY), blockMin: 60, landingWaitMin: 9999 };
  assert.equal(runwayOf([old, arrived("TEAM_H")], "ATCC", NOW).bottleneck, false);
});

test("persistOf: 두 주기 이어져야, LAUNCH·ENTRY는 waitMin 이어져야 준비됨. 끊기면 처음부터", () => {
  const stop: FleetCandidate = { key: "STOP|TEAM_H", kind: "STOP", aircraft: "TEAM_H", airport: "ATCC", reasons: [] };
  const launch: FleetCandidate = { key: "DEMAND|ATCC", kind: "LAUNCH", aircraft: "TEAM_I", airport: "ATCC", reasons: [] };
  const c = FLEET_PLAN_DEFAULTS;
  const first = persistOf({}, [stop, launch], NOW, c);
  assert.deepEqual(first.ready, []);
  const second = persistOf(first.pending, [stop, launch], NOW + 5 * MIN, c);
  assert.deepEqual(second.ready.map((x) => x.kind), ["STOP"]);
  const later = persistOf(second.pending, [launch], NOW + 120 * MIN, c);
  assert.deepEqual(later.ready.map((x) => x.kind), ["LAUNCH"]);
  assert.deepEqual(Object.keys(later.pending), ["DEMAND|ATCC"]);
  // 같은 열쇠면 AIRCRAFT가 바뀌어도 기다린 시간이 이어진다
  assert.equal(persistOf(later.pending, [{ ...launch, aircraft: "TEAM_J" }], NOW + 125 * MIN, c).ready.length, 1);
});

test("syncFleetPlan: 새 제안, 조건이 풀리면 expire, 다른 AIRCRAFT가 되면 supersede", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const launch: FleetCandidate = { key: "DEMAND|ATCC", kind: "LAUNCH", aircraft: "TEAM_I", airport: "ATCC", reasons: [{ code: "waiting", detail: "1건" }] };
  const ops1 = syncFleetPlan([], [launch], [launch], NOW, cfg);
  assert.deepEqual(ops1.map((o) => `${o.op} ${o.id}`), ["create F-0001"]);
  const all1 = foldFleetPlan(ops1);
  // 그대로면 아무것도 하지 않는다
  assert.deepEqual(syncFleetPlan(all1, [launch], [launch], NOW + 5 * MIN, cfg), []);
  // 다른 AIRCRAFT가 됨: 옛 제안을 supersede하고 새로
  const other = { ...launch, aircraft: "TEAM_J" };
  const ops2 = syncFleetPlan(all1, [other], [other], NOW + 10 * MIN, cfg);
  assert.deepEqual(ops2.map((o) => `${o.op} ${o.id}`), ["supersede F-0001", "create F-0002"]);
  const all2 = foldFleetPlan([...ops1, ...ops2]);
  assert.equal(all2[0].status, "superseded");
  assert.equal(all2[0].closeReason, "F-0002");
  // 조건이 풀림
  const ops3 = syncFleetPlan(all2, [], [], NOW + 15 * MIN, cfg);
  assert.deepEqual(ops3, [{ op: "expire", id: "F-0002", reason: "조건이 풀림", at: new Date(NOW + 15 * MIN).toISOString() }]);
  // 아직 준비되지 않은 후보가 있으면 열린 제안은 유지된다
  assert.deepEqual(syncFleetPlan(all2, [other], [], NOW + 15 * MIN, cfg), []);
});

test("syncFleetPlan: 판정한 같은 제안은 24시간 다시 내지 않고, minDwell 안의 반대 제안(LAUNCH ↔ STOP)도 내지 않는다", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const stop: FleetCandidate = { key: "STOP|TEAM_H", kind: "STOP", aircraft: "TEAM_H", airport: "ATCC", reasons: [] };
  const created = syncFleetPlan([], [stop], [stop], NOW, cfg);
  const verdict: FleetPlanOp = { op: "verdict", id: "F-0001", verdict: "disagree", by: "SUPERVISOR", reason: "곧 씀", at: new Date(NOW + MIN).toISOString() };
  const all = foldFleetPlan([...created, verdict]);
  assert.equal(all[0].status, "disagreed");
  assert.deepEqual(syncFleetPlan(all, [stop], [stop], NOW + 2 * HOUR, cfg), []);
  assert.deepEqual(syncFleetPlan(all, [stop], [stop], NOW + 25 * HOUR, cfg).map((o) => `${o.op} ${o.id}`), ["create F-0002"]);
  // STOP 제안 뒤 minDwell 안에는 같은 AIRCRAFT의 LAUNCH를 내지 않는다
  const launch: FleetCandidate = { key: "DEMAND|ATCC", kind: "LAUNCH", aircraft: "TEAM_H", airport: "ATCC", reasons: [] };
  assert.deepEqual(syncFleetPlan(all, [launch], [launch], NOW + HOUR, cfg), []);
  assert.equal(syncFleetPlan(all, [launch], [launch], NOW + 3 * HOUR, cfg).length, 1);
});

test("foldFleetPlan: 닫힌 제안은 다시 바뀌지 않는다", () => {
  const at = new Date(NOW).toISOString();
  const all = foldFleetPlan([
    { op: "create", id: "F-0001", key: "AOG|TEAM_H", kind: "AOG", aircraft: "TEAM_H", airport: "ATCC", reasons: [], at },
    { op: "verdict", id: "F-0001", verdict: "agree", by: "SUPERVISOR", at },
    { op: "expire", id: "F-0001", at },
    { op: "verdict", id: "F-0001", verdict: "disagree", by: "SUPERVISOR", at },
  ]);
  assert.equal(all[0].status, "agreed");
});

test("fleetPlanGateOf: 20건·80%, 종류마다 건수", () => {
  const at = new Date(NOW).toISOString();
  const ops: FleetPlanOp[] = [];
  for (let n = 1; n <= 20; n++) {
    const id = `F-${String(n).padStart(4, "0")}`;
    ops.push({ op: "create", id, key: `STOP|T${n}`, kind: n <= 10 ? "STOP" : "RETIRE", aircraft: `T${n}`, airport: "ATCC", reasons: [], at });
    ops.push({ op: "verdict", id, verdict: n <= 16 ? "agree" : "disagree", by: "SUPERVISOR", at });
  }
  const g = fleetPlanGateOf(foldFleetPlan(ops));
  assert.equal(g.decided, 20);
  assert.equal(g.agreement, 0.8);
  assert.equal(g.ready, true);
  assert.deepEqual(g.byKind.RETIRE, { decided: 10, agreed: 6 });
  assert.equal(fleetPlanGateOf(foldFleetPlan(ops.slice(0, 38))).ready, false);
});
