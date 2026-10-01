import { GATE } from "./proposals.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { Unserved } from "./dispatch.ts";
import type { AircraftView } from "./fleet.ts";
import {
  type ExecContext,
  executionOf,
  type FleetCandidate,
  type FleetProposal,
  type FleetInputs,
  type FleetPlanOp,
  FLEET_PLAN_DEFAULTS,
  fleetPlanGateOf,
  fleetPlanOf,
  foldFleetPlan,
  entryAccountOf,
  fuelExpiryOf,
  fuelOfPlan,
  isManual,
  isStale,
  PlanError,
  persistOf,
  runwayOf,
  syncFleetPlan,
} from "./fleet-plan.ts";
import { parsePriceTable } from "./fuel-cost.ts";
import { type ContextSize, contextSizeOf } from "./fuel-context.ts";
import type { FuelRemaining } from "./fuel-remaining.ts";
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

test("LAUNCH(ATC-91): /clear 뒤 첫 메시지를 기다리는(RESTARTING) AIRCRAFT는 LAUNCH 후보에서 뺀다 — 곧 그 이름으로 세션이 뜬다", () => {
  const restarting = { registration: "TEAM_I", name: "TEAM_I", sessionId: "old", since: new Date(NOW - 5 * 60_000).toISOString(), until: new Date(NOW + 25 * 60_000).toISOString() };
  const out = fleetPlanOf(
    inputs({
      aircraft: [view("TEAM_H", { status: "busy", flying: ["ATC-1"] }), view("TEAM_I", { status: "absent", ratings: ["UI"], restarting }), view("TEAM_J", { status: "absent", ratings: ["UI"] })],
      plan: { assign: [], unserved: [need("ATC-2", { ratings: ["UI"] })] },
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["LAUNCH TEAM_J"]);
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

test("fleetPlanGateOf: 20건에서도 80%이면 통과하고 종류마다 건수를 센다", () => {
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
  assert.equal(fleetPlanGateOf(foldFleetPlan(ops.slice(0, 38))).ready, true); // 19건, 80%도 5건 이상이면 통과
});

test("fleetPlanGateOf(ATC-273): FLEET PLAN은 5건·80%, DISPATCH 게이트는 20건 그대로", () => {
  const at = new Date(NOW).toISOString();
  const run = (n: number, disagree: number) => {
    const ops: FleetPlanOp[] = [];
    for (let i = 1; i <= n; i++) {
      const id = `F-${String(i).padStart(4, "0")}`;
      ops.push({ op: "create", id, key: `STOP|T${i}`, kind: "STOP", aircraft: `T${i}`, airport: "ATCC", reasons: [], at });
      ops.push({ op: "verdict", id, verdict: i <= disagree ? "disagree" : "agree", by: "SUPERVISOR", at });
    }
    return fleetPlanGateOf(foldFleetPlan(ops));
  };
  assert.deepEqual(run(5, 0).target, { decided: 5, agreement: 0.8 });
  assert.equal(run(4, 0).ready, false); // 판정 4건은 아직
  assert.equal(run(5, 0).ready, true);
  assert.equal(run(5, 1).ready, true); // 4/5 = 80%
  assert.equal(run(5, 2).ready, false); // 3/5 = 60%
  assert.equal(run(7, 1).ready, true); // 실제 7건(6/7)
  assert.equal(GATE.decided, 20); // DISPATCH·SCHEDULE은 그대로
  assert.equal(GATE.agreement, 0.8);
});

// ── 3단계: 승인 운용(8.7) ──

test("RETURN: FLEET PLAN이 건 AOG의 해제 기한이 그날 끝까지 지나면. 사람이 건 AOG는 아님", () => {
  const aog = (reason: string, until: string) => ({ reason, until, at: ago(2 * DAY) });
  const out = fleetPlanOf(
    inputs({
      aircraft: [
        view("TEAM_H", { status: "absent", aog: aog("FLEET PLAN F-0003: NORDO", "2026-09-27") }),
        view("TEAM_I", { aog: aog("FLEET PLAN F-0004: LOS", "2026-09-28") }), // 오늘 끝까지는 아님
        view("TEAM_J", { aog: aog("디자인 리뷰 대기", "2026-09-20") }),
      ],
      nordo: new Set(["TEAM_H"]),
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["RETURN TEAM_H"]);
  assert.match(out.candidates[0].reasons[1].detail, /아직 NORDO/);
});

const at = (ms = 0) => new Date(NOW + ms).toISOString();
const created = (id: string, kind: FleetProposal["kind"], aircraft: string, over: Partial<FleetPlanOp> = {}): FleetPlanOp =>
  ({ op: "create", id, key: kind === "LAUNCH" || kind === "ENTRY" ? "DEMAND|ATCC" : `${kind}|${aircraft}`, kind, aircraft, airport: "ATCC", reasons: [], at: at(), ...over }) as FleetPlanOp;

test("foldFleetPlan: approve → executing → executed·failed. 실행 중인 제안은 expire·verdict로 바뀌지 않는다", () => {
  const ops: FleetPlanOp[] = [
    created("F-0001", "STOP", "TEAM_H"),
    { op: "approve", id: "F-0001", by: "SUPERVISOR", options: {}, at: at(MIN) },
    { op: "expire", id: "F-0001", at: at(2 * MIN) },
    { op: "verdict", id: "F-0001", verdict: "disagree", by: "SUPERVISOR", at: at(2 * MIN) },
  ];
  assert.equal(foldFleetPlan(ops)[0].status, "executing");
  const done = foldFleetPlan([...ops, { op: "executed", id: "F-0001", ok: false, steps: [{ action: "stop", registration: "TEAM_H", ok: false, error: "x" }], at: at(3 * MIN) }]);
  assert.equal(done[0].status, "failed");
  assert.equal(done[0].execution!.steps[0].error, "x");
  // 열린 제안에 온 executed는 무시(승인 없이 실행된 것으로 보지 않는다)
  assert.equal(foldFleetPlan([created("F-0002", "STOP", "TEAM_I"), { op: "executed", id: "F-0002", ok: true, steps: [], at: at() }])[0].status, "open");
});

test("승인은 게이트에서 동의로 센다. 실행을 끝낸 승인은 24시간 쉬고, 실패한 실행은 쉬지 않는다", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const stop: FleetCandidate = { key: "STOP|TEAM_H", kind: "STOP", aircraft: "TEAM_H", airport: "ATCC", reasons: [] };
  const base: FleetPlanOp[] = [created("F-0001", "STOP", "TEAM_H"), { op: "approve", id: "F-0001", by: "SUPERVISOR", options: {}, at: at(MIN) }];
  const executed = foldFleetPlan([...base, { op: "executed", id: "F-0001", ok: true, steps: [], at: at(2 * MIN) }]);
  const failed = foldFleetPlan([...base, { op: "executed", id: "F-0001", ok: false, steps: [], at: at(2 * MIN) }]);
  assert.deepEqual([fleetPlanGateOf(executed).decided, fleetPlanGateOf(executed).agreed], [1, 1]);
  assert.deepEqual([fleetPlanGateOf(failed).decided, fleetPlanGateOf(failed).agreed], [1, 1]);
  assert.deepEqual(syncFleetPlan(executed, [stop], [stop], NOW + HOUR, cfg), []);
  assert.deepEqual(syncFleetPlan(failed, [stop], [stop], NOW + HOUR, cfg).map((o) => `${o.op} ${o.id}`), ["create F-0002"]);
  // 실행 중이면 같은 열쇠로 새로 내지 않고, 조건이 풀려도 expire하지 않는다
  const running = foldFleetPlan(base);
  assert.deepEqual(syncFleetPlan(running, [stop], [stop], NOW + HOUR, cfg), []);
  assert.deepEqual(syncFleetPlan(running, [], [], NOW + HOUR, cfg), []);
});

const bgRow = (reg: string, kind = "background") => ({ registration: reg, kind, id: reg.slice(-1).toLowerCase(), startedAt: NOW - DAY });
const ctx = (over: Partial<ExecContext> = {}): ExecContext => ({
  mode: "approval",
  latest: [],
  ranAt: at(-MIN),
  aircraft: [view("TEAM_H"), view("TEAM_I", { status: "absent" })],
  sessions: [bgRow("TEAM_H")],
  taken: ["TEAM_H", "TEAM_I"],
  lastLaunch: new Map(),
  maxLaunched: 6,
  now: NOW,
  ...over,
});
// 열린 제안 하나와, 최근 주기가 같은 제안을 여전히 낸다는 문맥
const openOf = (id: string, kind: FleetProposal["kind"], aircraft: string, over: Partial<FleetPlanOp> = {}) => {
  const p = foldFleetPlan([created(id, kind, aircraft, over)])[0];
  const latest: FleetCandidate[] = [{ key: p.key, kind: p.kind, aircraft: p.aircraft, airport: p.airport, reasons: [] }];
  return { p, latest };
};
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof PlanError);
    return `${e.status} ${e.message}`;
  }
  assert.fail("거절되지 않음");
};

test("executionOf: 그림자 운용, 닫힌 제안, 조건이 바뀐 제안(최근 주기가 안 냄·주기가 10분 넘게 멈춤)은 거절", () => {
  const { p, latest } = openOf("F-0001", "STOP", "TEAM_H");
  assert.match(refused(() => executionOf(p, {}, ctx({ mode: "shadow", latest }))), /^409 그림자 운용 중/);
  assert.match(refused(() => executionOf({ ...p, status: "disagreed" }, {}, ctx({ latest }))), /^409 F-0001는 이미 닫힘/);
  assert.match(refused(() => executionOf(p, {}, ctx())), /^409 조건이 바뀜/);
  assert.match(refused(() => executionOf(p, {}, ctx({ latest, ranAt: at(-11 * MIN) }))), /^409 조건이 바뀜/);
  assert.deepEqual(executionOf(p, {}, ctx({ latest })).steps, [{ action: "stop", registration: "TEAM_H" }]);
});

test("executionOf LAUNCH·ENTRY: 기본 permission mode auto, 상한·이미 떠 있음·등록번호가 쓰임은 거절", () => {
  const l = openOf("F-0001", "LAUNCH", "TEAM_I");
  assert.deepEqual(executionOf(l.p, {}, ctx({ latest: l.latest })).steps, [{ action: "launch", registration: "TEAM_I", permissionMode: "auto", model: null }]);
  assert.deepEqual(executionOf(l.p, { permissionMode: "acceptEdits", model: "haiku" }, ctx({ latest: l.latest })).options, { permissionMode: "acceptEdits", model: "haiku" });
  assert.match(refused(() => executionOf(l.p, { permissionMode: "bypassPermissions" }, ctx({ latest: l.latest }))), /^400 permission mode/);
  const six = Array.from({ length: 6 }, (_, n) => bgRow(`TEAM_${"ABCDEF"[n]}`));
  assert.match(refused(() => executionOf(l.p, {}, ctx({ latest: l.latest, sessions: six }))), /^409 백그라운드 세션 6개/);
  assert.match(refused(() => executionOf(l.p, {}, ctx({ latest: l.latest, sessions: [bgRow("TEAM_I", "interactive")] }))), /이미 떠 있음/);
  const e = openOf("F-0002", "ENTRY", "TEAM_L", { configuration: "security" } as Partial<FleetPlanOp>);
  assert.deepEqual(executionOf(e.p, {}, ctx({ latest: e.latest })).steps.map((x) => x.action), ["entry", "launch"]);
  assert.match(refused(() => executionOf(e.p, {}, ctx({ latest: e.latest, taken: ["TEAM_L"] }))), /이미 쓰는 등록번호/);
});

test("executionOf(ATC-76): 출처가 background일 때만 실행, 데스크톱·터미널은 그 출처의 손 절차로 거절", () => {
  const s = openOf("F-0001", "STOP", "TEAM_H");
  assert.match(refused(() => executionOf(s.p, {}, ctx({ latest: s.latest, sessions: [{ ...bgRow("TEAM_H", "interactive"), origin: "desktop" as const }] }))), /데스크톱\(Claude 앱\) 세션 — atc가 멈추지 않는다\. SUPERVISOR: Claude 앱에서 그 세션을 닫는다/);
  const r = openOf("F-0002", "RESTART", "TEAM_H");
  assert.match(refused(() => executionOf(r.p, {}, ctx({ latest: r.latest, sessions: [{ ...bgRow("TEAM_H", "interactive"), origin: "terminal" as const }] }))), /터미널 세션 — atc가 다시 띄우지 않는다\. SUPERVISOR: 그 터미널에서 \/exit로 claude를 닫고, 새 세션을 이름 TEAM_H로/);
  // background 출처는 실행된다(STOP 한 단계)
  assert.deepEqual(executionOf(s.p, {}, ctx({ latest: s.latest, sessions: [{ ...bgRow("TEAM_H"), origin: "background" as const }] })).steps, [{ action: "stop", registration: "TEAM_H" }]);
});

test("executionOf STOP·RESTART: 백그라운드 세션만. RESTART는 마지막 LAUNCH의 permission mode·모델로 다시 띄운다", () => {
  const s = openOf("F-0001", "STOP", "TEAM_H");
  assert.match(refused(() => executionOf(s.p, {}, ctx({ latest: s.latest, sessions: [bgRow("TEAM_H", "interactive")] }))), /백그라운드가 아닌 세션 — atc가 멈추지 않는다/);
  const r = openOf("F-0002", "RESTART", "TEAM_H");
  const plan = executionOf(r.p, {}, ctx({ latest: r.latest, lastLaunch: new Map([["TEAM_H", { permissionMode: "acceptEdits", model: "sonnet" }]]) }));
  assert.deepEqual(plan.steps, [
    { action: "stop", registration: "TEAM_H" },
    { action: "launch", registration: "TEAM_H", permissionMode: "acceptEdits", model: null, lastModel: "sonnet" }, // ATC-279: 마지막 LAUNCH의 모델은 lastModel(설정이 먼저)
  ]);
});

test("executionOf AOG·RETURN·RETIRE: 사유 머리는 FLEET PLAN id, RETIRE는 기본으로 백그라운드 세션도 멈춤", () => {
  const a = openOf("F-0001", "AOG", "TEAM_H", { reasons: [{ code: "nordo", detail: "" }, { code: "until", detail: "", value: "2026-09-29" }] } as Partial<FleetPlanOp>);
  assert.deepEqual(executionOf(a.p, {}, ctx({ latest: a.latest })).steps, [{ action: "aog", registration: "TEAM_H", reason: "FLEET PLAN F-0001: NORDO", until: "2026-09-29" }]);
  assert.match(refused(() => executionOf(a.p, { until: "9/29" }, ctx({ latest: a.latest }))), /^400 until/);
  const ret = openOf("F-0002", "RETURN", "TEAM_H");
  assert.match(refused(() => executionOf(ret.p, {}, ctx({ latest: ret.latest }))), /AOG가 아님/);
  const aogd = [view("TEAM_H", { aog: { reason: "FLEET PLAN F-0001: NORDO", until: "2026-09-27", at: ago(DAY) } })];
  assert.deepEqual(executionOf(ret.p, {}, ctx({ latest: ret.latest, aircraft: aogd })).steps, [{ action: "return", registration: "TEAM_H" }]);
  const t = openOf("F-0003", "RETIRE", "TEAM_H");
  assert.deepEqual(executionOf(t.p, {}, ctx({ latest: t.latest })).steps.map((x) => x.action), ["retire", "stop"]);
  assert.deepEqual(executionOf(t.p, { stopSession: false }, ctx({ latest: t.latest })).steps.map((x) => x.action), ["retire"]);
  assert.deepEqual(executionOf(t.p, {}, ctx({ latest: t.latest, sessions: [] })).steps.map((x) => x.action), ["retire"]);
});

// AIRCRAFT health에서 나오는 제안(ATC-48)
const health = (code: "MODEL" | "LIMIT" | "CONTEXT" | "HUNG" | "PENDING" | "THROTTLE" | "NETWORK" | "UNANSWERED" | "DENIED" | "UNKNOWN" | "PROVIDER", over: Partial<NonNullable<AircraftView["health"]>> = {}) =>
  ({ code, level: "alert", since: ago(2 * HOUR), detail: `${code} 원문`, next: `${code} 다음`, holds: true, ...over }) as NonNullable<AircraftView["health"]>;

test("health: MODEL·주간 LIMIT은 AOG, CONTEXT·ALERT HUNG은 RESTART, 나머지 코드는 제안 없음", () => {
  const reset = "2026-10-02T09:00:00.000Z";
  const out = fleetPlanOf(
    inputs({
      aircraft: [
        view("TEAM_A", { health: health("MODEL") }),
        view("TEAM_B", { health: health("LIMIT", { weekly: true, resetsAt: reset }) }),
        view("TEAM_C", { health: health("LIMIT", { resetsAt: "2026-09-28T14:00:00.000Z" }) }), // 5시간 한도
        view("TEAM_D", { health: health("CONTEXT"), flying: ["ATC-9"] }),
        view("TEAM_E", { status: "busy", health: health("HUNG") }),
        view("TEAM_F", { status: "busy", health: health("HUNG", { level: "info" }) }),
        ...(["PENDING", "THROTTLE", "NETWORK", "UNANSWERED", "DENIED", "UNKNOWN", "PROVIDER"] as const).map((c, n) => view(`TEAM_${"GHIJKLM"[n]}`, { health: health(c) })),
      ],
      sessions: [{ registration: "TEAM_D", kind: "background", id: "d", startedAt: NOW - HOUR }, { registration: "TEAM_E", kind: "interactive", startedAt: NOW - HOUR }],
      lastActive: new Map([["TEAM_D", ago(MIN)], ["TEAM_E", ago(2 * HOUR)]]),
      logbook: [..."ABCDEFGHIJKLM"].map((c) => arrived(`TEAM_${c}`)),
    }),
  );
  assert.deepEqual(kinds(out.candidates), ["AOG TEAM_A", "AOG TEAM_B", "RESTART TEAM_D", "RESTART TEAM_E"]);
  const by = (reg: string) => out.candidates.find((c) => c.aircraft === reg)!;
  assert.deepEqual(by("TEAM_A").reasons.map((r) => r.code), ["model", "until"]);
  assert.equal(by("TEAM_A").reasons.at(-1)!.value, "2026-09-29");
  // 주간 LIMIT만이면 해제 기한은 reset 날
  assert.deepEqual(by("TEAM_B").reasons.at(-1), { code: "until", detail: "해제 기한 2026-10-02(주간 LIMIT reset 날)", value: "2026-10-02" });
  assert.deepEqual(by("TEAM_D").reasons.map((r) => r.code), ["context", "handoff", "session"]);
  assert.match(by("TEAM_D").reasons[1]!.detail, /ATC-9.*HANDOFF/);
  assert.match(by("TEAM_E").reasons[2]!.detail, /승인 실행은 안 됨 — TEAM_E는 백그라운드가 아닌 세션 — atc가 다시 띄우지 않는다/);
});

test("health: NORDO와 MODEL이 겹치면 AOG 하나에 사유 둘, 승인하면 사유 머리에 두 코드", () => {
  const out = fleetPlanOf(inputs({ aircraft: [view("TEAM_H", { health: health("MODEL") })], nordo: new Set(["TEAM_H"]) }));
  assert.deepEqual(out.candidates.map((c) => c.reasons.map((r) => r.code)), [["nordo", "model", "until"]]);
  const { p, latest } = openOf("F-0001", "AOG", "TEAM_H", { reasons: out.candidates[0]!.reasons } as Partial<FleetPlanOp>);
  const plan = executionOf(p, {}, ctx({ latest }));
  assert.deepEqual(plan.steps, [{ action: "aog", registration: "TEAM_H", reason: "FLEET PLAN F-0001: NORDO·MODEL", until: "2026-09-29" }]);
});

test("health: 코드가 풀리면 열린 제안은 expire된다", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const first = fleetPlanOf(inputs({ aircraft: [view("TEAM_D", { health: health("CONTEXT") })] })).candidates;
  const all = foldFleetPlan(syncFleetPlan([], first, first, NOW, cfg));
  assert.deepEqual(all.map((p) => `${p.kind} ${p.aircraft} ${p.status}`), ["RESTART TEAM_D open"]);
  const cleared = fleetPlanOf(inputs({ aircraft: [view("TEAM_D")] })).candidates;
  assert.deepEqual(syncFleetPlan(all, cleared, [], NOW + 10 * MIN, cfg).map((o) => o.op), ["expire"]);
});

// ── FUEL(ATC-63): ACCOUNT가 hold면 LAUNCH·ENTRY 없음, info면 사유 줄. 기록이 없으면 전과 같다 ──
const RESET = "2026-09-28T21:00:00.000Z";
const fuelOf = (account: string | null, pct: number, over: Partial<FuelRemaining> = {}): FuelRemaining => ({
  group: account ?? "aircraft:TEAM_I", account, at: ago(5 * MIN), from: "TEAM_H", fromKind: "aircraft",
  windows: [{ name: "seven_day", pct, resetsAt: RESET }], top: { name: "seven_day", pct, resetsAt: RESET },
  level: pct >= 95 ? "hold" : pct >= 80 ? "info" : "ok", aircraft: [], control: [], ...over,
});
const fuelBase = (fuelAccounts: FuelRemaining[], aircraft = [view("TEAM_I", { status: "absent", account: "acct-1" })]) =>
  inputs({ aircraft, plan: { assign: [], unserved: [need("ATC-2")] }, fuelAccounts });

test("FUEL: 맞는 AIRCRAFT의 ACCOUNT가 hold면 LAUNCH 없음 — AIRPORT 수요 줄이 FUEL을 말한다(D3 스위치와 상관없이)", () => {
  const out = fleetPlanOf(fuelBase([fuelOf("acct-1", 100, { aircraft: ["TEAM_I"] })]));
  assert.deepEqual(out.candidates, []);
  assert.equal(out.demand.find((d) => d.airport === "ATCC")!.blocked, "FUEL 사용 100% (account acct-1) until 21:00Z — TEAM_I — ENTRY도 제안 안 함(새 세션이 열릴 계정을 모름)");
});

test("FUEL: 맞는 AIRCRAFT의 ACCOUNT가 hold면 건너뛰고 다음 AIRCRAFT. 모두 hold면 ENTRY로 넘기지 않는다(default가 비어 있어도)", () => {
  const two = [view("TEAM_I", { status: "absent", account: "acct-1" }), view("TEAM_J", { status: "absent", account: "acct-2" })];
  const next = fleetPlanOf(fuelBase([fuelOf("acct-1", 100)], two));
  assert.deepEqual(kinds(next.candidates), ["LAUNCH TEAM_J"]);
  assert.match(next.candidates[0].reasons.find((r) => r.code === "fuel-held")!.detail, /FUEL 사용 100% \(account acct-1\).*TEAM_I/);
  // default ACCOUNT에 기록이 없어도(ok로 보이지 않아도) ENTRY를 내지 않는다 — 새 세션이 열릴 계정을 atc는 모른다
  const none = fleetPlanOf(fuelBase([fuelOf("acct-1", 100)]));
  assert.deepEqual(none.candidates, []);
  assert.match(none.demand[0].blocked!, /^FUEL 사용 100% \(account acct-1\) until 21:00Z — TEAM_I — ENTRY도 제안 안 함/);
});

test("FUEL: info면 제안하고 FUEL 사유 줄을 단다. ENTRY는 default ACCOUNT의 값으로", () => {
  const out = fleetPlanOf(fuelBase([fuelOf("acct-1", 85, { aircraft: ["TEAM_I"], control: ["OCC"] })]));
  assert.deepEqual(kinds(out.candidates), ["LAUNCH TEAM_I"]);
  const r = out.candidates[0].reasons.find((x) => x.code === "fuel")!;
  assert.match(r.detail, /^FUEL 사용 85% · resets 21:00Z \(account acct-1\) — 한도에 가까움\(INFO\) · TEAM_I · control OCC$/);
  assert.equal(r.value, 85);
  // 맞는 등록 AIRCRAFT가 없으면 ENTRY — default ACCOUNT가 info
  const entry = fleetPlanOf(fuelBase([fuelOf("default", 90)], []));
  assert.deepEqual(kinds(entry.candidates), ["ENTRY TEAM_L"]);
  assert.match(entry.candidates[0].reasons.find((x) => x.code === "fuel")!.detail, /FUEL 사용 90%.*\(account default\)/);
  // ENTRY의 default ACCOUNT가 hold면 없음
  const held = fleetPlanOf(fuelBase([fuelOf("default", 100)], []));
  assert.deepEqual(held.candidates, []);
  assert.match(held.demand[0].blocked!, /^FUEL 사용 100% \(account default\) until 21:00Z — 새 AIRCRAFT\(ENTRY\)가 들 ACCOUNT$/);
});

test("FUEL: 기록이 없거나 ok면 전과 같다. ACCOUNT를 모르면(라벨 없음) 그 AIRCRAFT 자신의 값만", () => {
  const plain = fleetPlanOf(fuelBase([]));
  const ok = fleetPlanOf(fuelBase([fuelOf("acct-1", 40)]));
  const other = fleetPlanOf(fuelBase([fuelOf("acct-9", 100)])); // 다른 ACCOUNT
  for (const out of [plain, ok, other]) {
    assert.deepEqual(kinds(out.candidates), ["LAUNCH TEAM_I"]);
    assert.ok(!out.candidates[0].reasons.some((r) => r.code.startsWith("fuel")));
  }
  assert.deepEqual(plain, fleetPlanOf(inputs({ aircraft: [view("TEAM_I", { status: "absent", account: "acct-1" })], plan: { assign: [], unserved: [need("ATC-2")] } })));
  // 라벨 없음: group aircraft:TEAM_I만 본다. 남의 AIRCRAFT 값은 보지 않는다
  const bare = [view("TEAM_I", { status: "absent", account: null })];
  assert.deepEqual(fleetPlanOf(fuelBase([fuelOf(null, 100, { group: "aircraft:TEAM_H" })], bare)).candidates.length, 1);
  // 자기 값이 hold면 건너뛰고, ENTRY로도 넘기지 않는다
  const own = fleetPlanOf(fuelBase([fuelOf(null, 100, { group: "aircraft:TEAM_I" })], bare));
  assert.deepEqual(own.candidates, []);
  assert.match(own.demand[0].blocked!, /^FUEL 사용 100% until 21:00Z — TEAM_I — ENTRY도 제안 안 함/);
});

test("FUEL: 관제 세션만 적은 ACCOUNT도 hold면 그 ACCOUNT의 AIRCRAFT를 LAUNCH하지 않는다", () => {
  const out = fleetPlanOf(fuelBase([fuelOf("acct-1", 100, { group: "acct-1", aircraft: [], control: ["OCC", "TOWER"], from: "OCC", fromKind: "control" }), fuelOf("default", 100)]));
  assert.deepEqual(out.candidates, []);
  assert.match(out.demand[0].blocked!, /FUEL 사용 100% \(account acct-1\) until 21:00Z — TEAM_I/);
});

test("FUEL: 열린 LAUNCH·ENTRY의 ACCOUNT가 hold가 되면 expire(사유는 FUEL). 후보가 남아 있어도, 새 후보가 되면 새로 낸다", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const launch: FleetCandidate = { key: "DEMAND|ATCC", kind: "LAUNCH", aircraft: "TEAM_I", airport: "ATCC", reasons: [{ code: "waiting", detail: "1건" }] };
  const all = foldFleetPlan(syncFleetPlan([], [launch], [launch], NOW, cfg));
  const i = fuelBase([fuelOf("acct-1", 100)]);
  const later = NOW + 10 * MIN;
  // 같은 후보가 남아 있어도(스위치와 상관없이) FUEL로 expire
  const ops = syncFleetPlan(all, [launch], [], later, cfg, (p) => fuelExpiryOf({ ...i, now: later }, p));
  assert.deepEqual(ops.map((o) => o.op), ["expire"]);
  assert.match((ops[0] as { reason: string }).reason, /^FUEL 사용 100% \(account acct-1\) until 21:00Z — ACCOUNT가 FUEL hold 수준$/);
  // 다른 AIRCRAFT 후보가 준비되면 expire하고 새로 낸다(supersede하지 않는다)
  const other = { ...launch, aircraft: "TEAM_J" };
  const ops2 = syncFleetPlan(all, [other], [other], later, cfg, (p) => fuelExpiryOf({ ...i, now: later }, p));
  assert.deepEqual(ops2.map((o) => `${o.op} ${o.id}`), ["expire F-0001", "create F-0002"]);
  // ENTRY는 default ACCOUNT로, info는 expire하지 않는다. STOP 같은 다른 종류는 보지 않는다
  assert.match(fuelExpiryOf({ ...fuelBase([fuelOf("default", 99)]), now: later }, { kind: "ENTRY", aircraft: "TEAM_L" })!, /account default/);
  assert.equal(fuelExpiryOf({ ...fuelBase([fuelOf("acct-1", 85)]), now: later }, { kind: "LAUNCH", aircraft: "TEAM_I" }), null);
  assert.equal(fuelExpiryOf({ ...i, now: later }, { kind: "STOP", aircraft: "TEAM_I" }), null);
});

// ── REFRESH(ATC-69) ──

const PRICES = parsePriceTable({ writeMult: { "5m": 1.25, "1h": 2 }, models: { "claude-opus-5-5": { in: 4, out: 20, readMult: 0.05 } } });
const ctxSize = (contextTokens: number | null, over: Partial<ContextSize> = {}): ContextSize =>
  contextSizeOf({ session: "s", contextTokens, at: ago(30 * MIN), model: "claude-opus-5-5", compacted: false, base: 25_000, maxSeen: contextTokens ?? 0, tier: "1h", speed: null, geo: null, ...over });
const flown = (aircraft: string, flight: string, at = ago(HOUR)) => ({ ...arrived(aircraft, "ATCC", at), flight });
const refreshInputs = (over: Partial<FleetInputs> = {}) =>
  inputs({
    aircraft: [view("TEAM_J")],
    sessions: [{ registration: "TEAM_J", kind: "interactive", id: "j", startedAt: NOW - HOUR * 5 }],
    lastActive: new Map([["TEAM_J", ago(30 * MIN)]]),
    logbook: [flown("TEAM_J", "ATC-63")],
    context: new Map([["TEAM_J", ctxSize(501_700)]]),
    prices: PRICES,
    ...over,
  });

test("REFRESH: FLIGHT를 마치고 쉬는 AIRCRAFT의 대화가 300k를 넘으면. 사유에 크기와 cold wake에 아낄 캐시 쓰기", () => {
  const out = fleetPlanOf(refreshInputs());
  assert.deepEqual(kinds(out.candidates), ["REFRESH TEAM_J"]);
  const c = out.candidates[0];
  assert.equal(c.key, "REFRESH|TEAM_J");
  const r = Object.fromEntries(c.reasons.map((x) => [x.code, x]));
  assert.match(r.context.detail, /^502k \/ 1M \(50%\) — claude-opus-5-5/);
  assert.match(r.context.detail, /창은 본 크기로 짐작/);
  // (501.7k − 25k) × 2 × $4/M = $3.81
  assert.equal(r.saving.value, 3.81);
  assert.match(r.saving.detail, /477k ≈ \$3\.81 캐시 쓰기\(1h\)/);
  assert.match(r.arrived.detail, /마지막 FLIGHT ATC-63 ARRIVED/);
  assert.equal(r.session.value, "interactive");
  assert.match(r.session.detail, /\/clear/);
  assert.ok(isManual({ kind: c.kind, reasons: c.reasons }));
  // 백그라운드 세션은 atc가 다시 띄운다
  const bg = fleetPlanOf(refreshInputs({ sessions: [{ registration: "TEAM_J", kind: "background", id: "j1", startedAt: NOW - HOUR }] })).candidates[0];
  assert.equal(bg.reasons.find((x) => x.code === "session")!.value, "background");
  assert.ok(!isManual({ kind: bg.kind, reasons: bg.reasons }));
});

test("REFRESH 기준: 300k 또는 창의 40%. 창을 짐작만 했으면(200k 기본) 토큰 기준만", () => {
  const at = (c: ContextSize) => kinds(fleetPlanOf(refreshInputs({ context: new Map([["TEAM_J", c]]) })).candidates);
  assert.deepEqual(at(ctxSize(250_000)), []); // 1M 창(본 크기로) 25%
  assert.deepEqual(at(ctxSize(120_000, { model: "claude-sonnet-5[1m]", maxSeen: 120_000 })), []); // 1M 12%
  assert.deepEqual(at(ctxSize(90_000, { maxSeen: 90_000 })), []); // 200k 기본 창: 45%지만 사실이 아니다
  assert.deepEqual(at(contextSizeOf({ ...ctxSize(90_000), maxSeen: 90_000 }, { "claude-opus-5-5": 200_000 })), ["REFRESH TEAM_J"]); // 설정한 200k 창의 45%
  assert.deepEqual(at(ctxSize(300_000)), ["REFRESH TEAM_J"]);
  assert.deepEqual(at(ctxSize(null, { maxSeen: 600_000, compacted: true })), []); // compaction 뒤 크기를 모름
});

test("REFRESH 제외: 아직 끝나지 않은 FLIGHT의 STAND, 열린 PR, 이번 계획의 배정, 최근 LAUNCH, busy·AOG·RETIRED", () => {
  const none = (over: Partial<FleetInputs>) => assert.deepEqual(kinds(fleetPlanOf(refreshInputs(over)).candidates), []);
  none({ aircraft: [view("TEAM_J", { flying: ["ATC-69"] })] }); // HOLDING, ATC-69는 ARRIVED 아님
  none({ openPrs: new Set(["TEAM_J"]) });
  none({ plan: { assign: [{ kind: "ASSIGN", flight: "ATC-70", aircraft: "j", aircraftName: "TEAM_J", airport: "ATCC", score: 1, factors: [] }], unserved: [] } });
  none({ dwell: new Map([["TEAM_J", { op: "launch" as const, at: ago(30 * MIN) }]]) });
  none({ aircraft: [view("TEAM_J", { status: "busy" })] });
  none({ aircraft: [view("TEAM_J", { aog: { reason: "x", until: null, at: ago(HOUR) } })] });
  none({ context: new Map() });
  // ARRIVED한 FLIGHT의 STAND만 남았으면(HOLDING, 정리 전) 낸다. 오래전 LAUNCH도 괜찮다
  const ok = fleetPlanOf(refreshInputs({ aircraft: [view("TEAM_J", { flying: ["ATC-63"] })], dwell: new Map([["TEAM_J", { op: "launch" as const, at: ago(3 * HOUR) }]]) }));
  assert.deepEqual(kinds(ok.candidates), ["REFRESH TEAM_J"]);
  assert.match(ok.candidates[0].reasons.find((r) => r.code === "arrived")!.detail, /남은 STAND ATC-63은 ARRIVED/);
});

test("REFRESH: 같은 AIRCRAFT에 RESTART(오래된 세션)가 있으면 따로 내지 않고 RESTART에 사유를 붙인다", () => {
  const out = fleetPlanOf(refreshInputs({ sessions: [{ registration: "TEAM_J", kind: "background", id: "j", startedAt: NOW - 4 * DAY }] }));
  assert.deepEqual(kinds(out.candidates), ["RESTART TEAM_J"]);
  assert.deepEqual(out.candidates[0].reasons.map((r) => r.code), ["age", "session", "context", "saving"]);
});

test("REFRESH 지속·반대 규칙: 두 주기 뒤 제안, minDwell 안의 LAUNCH 제안 뒤에는 내지 않는다", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const c = fleetPlanOf(refreshInputs()).candidates;
  const first = persistOf({}, c, NOW, cfg);
  assert.deepEqual(first.ready, []);
  const second = persistOf(first.pending, c, NOW + 5 * MIN, cfg);
  assert.deepEqual(kinds(second.ready), ["REFRESH TEAM_J"]);
  const launched = foldFleetPlan([created("F-0001", "LAUNCH", "TEAM_J", { at: at(-30 * MIN) } as Partial<FleetPlanOp>)]);
  assert.deepEqual(syncFleetPlan(launched, c, c, NOW, cfg).filter((o) => o.op === "create"), []);
  assert.deepEqual(syncFleetPlan([], c, c, NOW, cfg).map((o) => o.op === "create" && `${o.kind} ${o.aircraft}`), ["REFRESH TEAM_J"]);
});

test("executionOf REFRESH: 백그라운드는 RESTART처럼 STOP → LAUNCH, 데스크톱·터미널은 실행하지 않는다(사람이 /clear)", () => {
  const bg = openOf("F-0001", "REFRESH", "TEAM_H", { reasons: [{ code: "session", detail: "", value: "background" }] } as Partial<FleetPlanOp>);
  const plan = executionOf(bg.p, {}, ctx({ latest: bg.latest, lastLaunch: new Map([["TEAM_H", { permissionMode: "acceptEdits" }]]) }));
  assert.deepEqual(plan.steps, [
    { action: "stop", registration: "TEAM_H" },
    { action: "launch", registration: "TEAM_H", permissionMode: "acceptEdits", model: null },
  ]);
  const hand = openOf("F-0002", "REFRESH", "TEAM_H", { reasons: [{ code: "session", detail: "", value: "interactive" }] } as Partial<FleetPlanOp>);
  assert.match(refused(() => executionOf(hand.p, {}, ctx({ latest: hand.latest }))), /^409 TEAM_H는 백그라운드 세션이 아님 — 그 세션에서 \/clear/);
});

// ── ENTRY의 ACCOUNT(ATC-147): 등록부가 있으면 등록되고 로그인이 안 됐다고 알려지지 않은 ACCOUNT 중 hold 아래에서 사용이 가장 낮은 것 ──
const logged = (...xs: [string, boolean | null][]) => xs.map(([label, loggedIn]) => ({ label, loggedIn }));

test("ENTRY ACCOUNT: 사용이 가장 낮은 등록 ACCOUNT를 고르고 사유 줄에 적는다(기록 없음은 0, 같으면 라벨 순)", () => {
  const i = fuelBase([fuelOf("acct-1", 60), fuelOf("acct-2", 30)], []);
  const out = fleetPlanOf({ ...i, accountLogins: logged(["acct-1", true], ["acct-2", true], ["acct-3", null]) });
  assert.deepEqual(kinds(out.candidates), ["ENTRY TEAM_L"]);
  assert.equal(out.candidates[0].account, "acct-3"); // 기록이 없는 ACCOUNT는 사용 0, 로그인은 모름(null)이라 막지 않는다
  assert.match(out.candidates[0].reasons.find((r) => r.code === "account")!.detail, /ACCOUNT acct-3.*FUEL 기록 없음/);
  const two = fleetPlanOf({ ...i, accountLogins: logged(["acct-1", true], ["acct-2", true]) });
  assert.equal(two.candidates[0].account, "acct-2");
  assert.match(two.candidates[0].reasons.find((r) => r.code === "account")!.detail, /ACCOUNT acct-2.*: 30%/);
  assert.deepEqual(entryAccountOf({ ...i, accountLogins: logged(["b", true], ["a", true]) }), { registered: true, account: "a", use: null, blocked: null }); // 같으면 라벨 순
});

test("ENTRY ACCOUNT: 로그인 안 된 ACCOUNT와 hold인 ACCOUNT는 건너뛴다. 모두 그러면 사유와 함께 제안 없음", () => {
  const i = fuelBase([fuelOf("acct-1", 100), fuelOf("acct-2", 10)], []);
  const out = fleetPlanOf({ ...i, accountLogins: logged(["acct-1", true], ["acct-2", false]) });
  assert.equal(out.candidates.length, 0);
  assert.equal(out.demand[0].blocked, "새 AIRCRAFT(ENTRY)가 날 ACCOUNT가 없음 — acct-1: FUEL hold 100%, acct-2: 로그인 안 됨");
  const ok = fleetPlanOf({ ...i, accountLogins: logged(["acct-1", true], ["acct-2", true]) });
  assert.equal(ok.candidates[0].account, "acct-2");
});

test("ENTRY ACCOUNT: 맞는 AIRCRAFT가 모두 hold여도 등록부가 있으면 ENTRY가 다른 ACCOUNT를 고른다(옛 '계정을 모름' 차단 없음). 등록부가 없으면 전과 같다", () => {
  const fuel = [fuelOf("acct-1", 100, { aircraft: ["TEAM_I"] }), fuelOf("acct-2", 20)];
  const withReg = fleetPlanOf({ ...fuelBase(fuel), accountLogins: logged(["acct-1", true], ["acct-2", true]) });
  assert.deepEqual(kinds(withReg.candidates), ["ENTRY TEAM_L"]);
  assert.equal(withReg.candidates[0].account, "acct-2");
  assert.equal(withReg.demand[0].blocked, null);
  const noReg = fleetPlanOf(fuelBase(fuel));
  assert.deepEqual(noReg.candidates, []);
  assert.match(noReg.demand[0].blocked!, /ENTRY도 제안 안 함\(새 세션이 열릴 계정을 모름\)/);
  // 등록부가 없을 때 ENTRY 후보에는 account가 없다(제안 기록 형식이 전과 같다)
  assert.equal("account" in fleetPlanOf(fuelBase([], [])).candidates[0], false);
});

test("ENTRY ACCOUNT: 제안이 account를 실어 나르고, 그 ACCOUNT가 hold가 되면 expire", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const i = { ...fuelBase([fuelOf("acct-2", 20)], []), accountLogins: logged(["acct-2", true]) };
  const cand = fleetPlanOf(i).candidates;
  const all = foldFleetPlan(syncFleetPlan([], cand, cand, NOW, cfg));
  assert.equal(all[0].account, "acct-2");
  const later = NOW + 10 * MIN;
  assert.equal(fuelExpiryOf({ ...i, now: later }, all[0]), null);
  const held = { ...i, fuelAccounts: [fuelOf("acct-2", 99)], now: later };
  assert.match(fuelExpiryOf(held, all[0])!, /\(account acct-2\).*FUEL hold 수준$/);
});

// ── ACCOUNT CHANGE(ATC-148): FLIGHT 사이의 AIRCRAFT를 여유 있는 ACCOUNT로 ──
const RESET_SOON = new Date(NOW + 5 * HOUR).toISOString();
const bgFact = (reg: string) => ({ registration: reg, kind: "background", id: reg.slice(-1).toLowerCase(), startedAt: NOW - DAY });
const fuelAt = (account: string, pct: number) => fuelOf(account, pct, { group: account });
// TEAM_H는 home acct-2인데 acct-2가 hold. 등록 ACCOUNT 셋. 세션은 백그라운드로 떠 있고 쉬는 중
const changeBase = (over: Partial<FleetInputs> = {}, aircraft: AircraftView[] = [view("TEAM_H", { account: "acct-2", observedAccount: null })]): FleetInputs =>
  inputs({
    aircraft,
    sessions: [bgFact("TEAM_H")],
    lastActive: new Map([["TEAM_H", ago(2 * HOUR)]]),
    fuelAccounts: [fuelAt("acct-2", 97), fuelAt("acct-1", 40), fuelAt("acct-3", 10)],
    accountLogins: logged(["acct-1", true], ["acct-2", true], ["acct-3", true]),
    ...over,
  });
const changes = (i: FleetInputs) => fleetPlanOf(i).candidates.filter((c) => c.kind === "ACCOUNT CHANGE");

test("ACCOUNT CHANGE: hold인 ACCOUNT의 쉬는 AIRCRAFT를 사용이 가장 낮은 ACCOUNT로(셋 중). 사유가 두 ACCOUNT의 사용과 reset을 적는다", () => {
  const [c] = changes(changeBase());
  assert.equal(c.account, "acct-3"); // acct-1 40%, acct-3 10% 중 가장 낮은 것
  assert.deepEqual([c.key, c.kind, c.aircraft], ["ACCOUNT CHANGE|TEAM_H", "ACCOUNT CHANGE", "TEAM_H"]);
  const by = Object.fromEntries(c.reasons.map((r) => [r.code, r.detail]));
  assert.match(by.account, /^FUEL 사용 97% \(account acct-2\) until 21:00Z — hold 수준$/);
  assert.match(by.target, /^옮길 ACCOUNT acct-3: 사용 10%\(reset 21:00Z\).*사용이 가장 낮음\(다른 후보 acct-1 40%\)/);
  assert.match(by.between, /FLIGHT 사이/);
  assert.match(by.cold, /ACCOUNT CHANGE/);
  assert.match(by.session, /ACCOUNT acct-2에서 멈추고 ACCOUNT acct-3에서.*home ACCOUNT acct-2는 그대로/);
  // 관찰한 ACCOUNT를 쓴다: home은 acct-1(여유)이지만 세션이 acct-2 폴더에서 돌고 있다
  const [o] = changes(changeBase({}, [view("TEAM_H", { account: "acct-1", observedAccount: "acct-2" })]));
  assert.equal(o.account, "acct-3");
});

test("ACCOUNT CHANGE: 오래 남은 LIMIT도 이유가 된다(reset이 accountChangeLimitMin 넘게 남았을 때만). 잘린 턴은 RESUME이라 옮기지 않는다", () => {
  const ok = { fuelAccounts: [fuelAt("acct-2", 50), fuelAt("acct-1", 40)], accountLogins: logged(["acct-1", true], ["acct-2", true]) };
  const limit = (resetsAt: string, over = {}) => view("TEAM_H", { account: "acct-2", observedAccount: null, health: { ...health("LIMIT"), resetsAt, ...over } as never });
  const [c] = changes(changeBase(ok, [limit(RESET_SOON)]));
  assert.equal(c.account, "acct-1");
  assert.match(c.reasons.find((r) => r.code === "limit")!.detail, /ACCOUNT acct-2: LIMIT — reset 17:00Z까지 .*남음\(기준 60분\)/);
  assert.equal(changes(changeBase(ok, [limit(new Date(NOW + 30 * MIN).toISOString())])).length, 0); // 곧 풀린다
  assert.equal(changes(changeBase(ok, [limit(RESET_SOON, { cut: true })])).length, 0); // 한도로 잘린 턴 = RESUME(같은 ACCOUNT)
});

test("ACCOUNT CHANGE: FLIGHT 중이거나 점유·PR이 있거나 FLIGHT를 받을 예정이면 없다. 살아 있는 FLIGHT는 옮기지 않는다", () => {
  const base = (over: Partial<AircraftView>) => changeBase({}, [view("TEAM_H", { account: "acct-2", observedAccount: null, ...over })]);
  assert.equal(changes(base({})).length, 1);
  assert.equal(changes(base({ status: "busy" })).length, 0);
  assert.equal(changes(base({ flying: ["ATC-5"] })).length, 0);
  assert.equal(changes(base({ flights: [{ key: "ATC-5", title: null, kept: true }] })).length, 0);
  assert.equal(changes({ ...changeBase(), openPrs: new Set(["TEAM_H"]) }).length, 0);
  // 이번 계획에서 FLIGHT를 받으면(수요) 옮기지 않는다
  const assign = { flight: "ATC-9", aircraft: "TEAM_H", aircraftName: "TEAM_H", airport: "ATCC", score: 1, factors: [] } as never;
  assert.equal(changes({ ...changeBase(), plan: { assign: [assign], unserved: [] } }).length, 0);
  // 방금 띄웠으면(minDwell) 쉰다
  assert.equal(changes({ ...changeBase(), dwell: new Map([["TEAM_H", { op: "launch" as const, at: ago(30 * MIN) }]]) }).length, 0);
  // 백그라운드 세션이 아니면 atc가 옮기지 못한다
  assert.equal(changes({ ...changeBase(), sessions: [{ ...bgFact("TEAM_H"), kind: "interactive" }] }).length, 0);
});

test("ACCOUNT CHANGE: 옮길 ACCOUNT가 없으면(하나도 여유 없음·로그인 안 됨·상한) 없다. 등록부가 없어도 없다", () => {
  const solo = (login: [string, boolean | null][], fuel: FuelRemaining[]) => changeBase({ accountLogins: logged(["acct-2", true], ...login), fuelAccounts: fuel });
  assert.equal(changes(solo([["acct-1", true]], [fuelAt("acct-2", 97), fuelAt("acct-1", 85)])).length, 0); // infoPct 이상
  assert.equal(changes(solo([["acct-1", true]], [fuelAt("acct-2", 97), fuelAt("acct-1", 96)])).length, 0); // hold
  assert.equal(changes(solo([["acct-1", false]], [fuelAt("acct-2", 97), fuelAt("acct-1", 5)])).length, 0); // 로그인 안 됨
  assert.equal(changes(solo([["acct-1", null]], [fuelAt("acct-2", 97)])).length, 1); // 로그인을 모르면 막지 않는다
  const capped = changeBase({ accountLogins: [{ label: "acct-2", loggedIn: true }, { label: "acct-1", loggedIn: true, maxLaunched: 2, running: 2 }, { label: "acct-3", loggedIn: false }] });
  assert.equal(changes(capped).length, 0); // 상한 참 + 로그인 안 됨
  assert.equal(changes(changeBase({ accountLogins: [] })).length, 0); // 등록부 없음
  assert.equal(changes(changeBase({}, [view("TEAM_H", { account: null, observedAccount: null })])).length, 0); // ACCOUNT를 모름
  // 이유가 없으면(hold도 LIMIT도 아님) 없다
  assert.equal(changes(changeBase({ fuelAccounts: [fuelAt("acct-2", 50), fuelAt("acct-1", 40)] })).length, 0);
});

test("ACCOUNT CHANGE: home이 아닌 ACCOUNT에서 돌다가 home이 infoPct 아래로 돌아오면 home로 돌아가자는 평범한 제안(자동 아님)", () => {
  const away = [view("TEAM_H", { account: "acct-2", observedAccount: "acct-1" })];
  const back = changes(changeBase({ fuelAccounts: [fuelAt("acct-2", 30), fuelAt("acct-1", 60), fuelAt("acct-3", 10)] }, away));
  assert.equal(back.length, 1);
  assert.equal(back[0].account, "acct-2"); // acct-3가 더 낮아도 home로 돌아가는 것만이 이유면 home로
  assert.match(back[0].reasons.find((r) => r.code === "home")!.detail, /home ACCOUNT acct-2: 사용 30% — infoPct 아래로 돌아옴/);
  // home이 아직 차 있으면 없다
  assert.equal(changes(changeBase({ fuelAccounts: [fuelAt("acct-2", 88), fuelAt("acct-1", 60)] }, away)).length, 0);
  // 옮겨 가 있는 ACCOUNT가 hold이면 가장 낮은 곳(home이 아니어도)
  assert.equal(changes(changeBase({ fuelAccounts: [fuelAt("acct-2", 88), fuelAt("acct-1", 99), fuelAt("acct-3", 10)] }, away))[0].account, "acct-3");
});

test("ACCOUNT CHANGE: 옮길 ACCOUNT가 있으면 주간 LIMIT만으로 AOG를 제안하지 않는다", () => {
  const weekly = view("TEAM_H", { account: "acct-2", observedAccount: null, health: { ...health("LIMIT"), weekly: true, resetsAt: RESET_SOON } as never });
  assert.deepEqual(kinds(fleetPlanOf(changeBase({}, [weekly])).candidates), ["ACCOUNT CHANGE TEAM_H"]);
  const none = changeBase({ accountLogins: logged(["acct-2", true]) }, [weekly]);
  assert.deepEqual(kinds(fleetPlanOf(none).candidates), ["AOG TEAM_H"]); // 옮길 곳이 없으면 전과 같다
});

test("ACCOUNT CHANGE: 열린 제안은 AIRCRAFT가 FLIGHT를 받거나 옛 ACCOUNT가 풀리면 expire, 옮길 ACCOUNT가 바뀌면 새 제안, 옮길 ACCOUNT가 차면 expire", () => {
  const cfg = FLEET_PLAN_DEFAULTS;
  const [c] = changes(changeBase());
  const all = foldFleetPlan(syncFleetPlan([], [c], [c], NOW, cfg));
  assert.equal(all[0].account, "acct-3");
  const later = NOW + 10 * MIN;
  // 이어서 같은 후보면 그대로
  assert.deepEqual(syncFleetPlan(all, [c], [c], later, cfg), []);
  // AIRCRAFT가 FLIGHT를 받으면 후보가 사라진다 → expire
  const busy = fleetPlanOf(changeBase({}, [view("TEAM_H", { account: "acct-2", observedAccount: null, status: "busy", flying: ["ATC-7"] })])).candidates;
  assert.deepEqual(syncFleetPlan(all, busy, [], later, cfg).map((o) => `${o.op} ${(o as { reason?: string }).reason ?? ""}`), ["expire 조건이 풀림"]);
  // 옛 ACCOUNT의 창이 풀리면(hold 아래) 후보가 사라진다 → expire
  const reset = fleetPlanOf(changeBase({ fuelAccounts: [fuelAt("acct-2", 20), fuelAt("acct-1", 40), fuelAt("acct-3", 10)] })).candidates;
  assert.deepEqual(syncFleetPlan(all, reset, [], later, cfg).map((o) => o.op), ["expire"]);
  // 옮길 ACCOUNT가 바뀌면 같은 AIRCRAFT라도 다른 제안: 옛 것은 supersede
  const other = changes(changeBase({ fuelAccounts: [fuelAt("acct-2", 97), fuelAt("acct-1", 40), fuelAt("acct-3", 70)] }))[0];
  assert.equal(other.account, "acct-1");
  assert.deepEqual(syncFleetPlan(all, [other], [other], later, cfg).map((o) => `${o.op} ${o.id}`), ["supersede F-0001", "create F-0002"]);
  // 옮길 ACCOUNT가 infoPct 이상이 되면 후보가 같아도 expire(사유는 FUEL)
  const i = { ...changeBase({ fuelAccounts: [fuelAt("acct-2", 97), fuelAt("acct-3", 85)] }), now: later };
  const ops = syncFleetPlan(all, [c], [], later, cfg, (p) => fuelExpiryOf(i, p));
  assert.match((ops[0] as { reason: string }).reason, /\(account acct-3\).*옮길 ACCOUNT에 여유가 없음$/);
  assert.equal(fuelExpiryOf({ ...changeBase(), now: later }, all[0]), null);
  // isStale: 최근 주기가 다른 ACCOUNT로 내면 이 제안은 낡았다
  assert.equal(isStale(all[0], [c], at(-MIN), NOW), false);
  assert.equal(isStale(all[0], [other], at(-MIN), NOW), true);
});

test("executionOf RESTART(ATC-279): 양식에 적은 모델은 model(우선), 마지막 LAUNCH의 모델은 lastModel(설정이 하나도 안 맞을 때만)", () => {
  const r = openOf("F-0002", "RESTART", "TEAM_H");
  const last = new Map([["TEAM_H", { permissionMode: "acceptEdits", model: "sonnet" }]]);
  const typed = executionOf(r.p, { model: "claude-opus-5-5" }, ctx({ latest: r.latest, lastLaunch: last }));
  assert.deepEqual(typed.steps[1], { action: "launch", registration: "TEAM_H", permissionMode: "acceptEdits", model: "claude-opus-5-5", lastModel: "sonnet" });
  const blank = executionOf(r.p, { model: "" }, ctx({ latest: r.latest, lastLaunch: last }));
  assert.deepEqual(blank.steps[1], { action: "launch", registration: "TEAM_H", permissionMode: "acceptEdits", model: null, lastModel: "sonnet" });
  const none = executionOf(r.p, {}, ctx({ latest: r.latest }));
  assert.deepEqual(none.steps[1], { action: "launch", registration: "TEAM_H", permissionMode: "auto", model: null });
});

test("executionOf ACCOUNT CHANGE: 옛 ACCOUNT에서 STOP 뒤 새 ACCOUNT에서 LAUNCH(마지막 LAUNCH의 옵션). FLIGHT 중·백그라운드 아님·옮길 ACCOUNT 없음은 거절", () => {
  const [c] = changes(changeBase());
  const p = foldFleetPlan([created("F-0001", "ACCOUNT CHANGE", "TEAM_H", { account: c.account } as Partial<FleetPlanOp>)])[0];
  const latest: FleetCandidate[] = [{ ...c, key: p.key }];
  const ok = (over: Partial<ExecContext> = {}) => ctx({ latest, ...over });
  const plan = executionOf(p, {}, ok({ lastLaunch: new Map([["TEAM_H", { permissionMode: "acceptEdits", model: "sonnet" }]]) }));
  assert.deepEqual(plan.steps, [
    { action: "stop", registration: "TEAM_H" },
    { action: "launch", registration: "TEAM_H", permissionMode: "acceptEdits", model: null, lastModel: "sonnet", account: "acct-3" },
  ]);
  // 승인하는 사이 FLIGHT를 받았으면 거절(최근 주기가 아직 안 봤어도)
  assert.match(refused(() => executionOf(p, {}, ok({ aircraft: [view("TEAM_H", { flying: ["ATC-7"] })] }))), /^409 TEAM_H가 FLIGHT 중\(ATC-7\) — 살아 있는 FLIGHT는 옮기지 않는다/);
  assert.match(refused(() => executionOf(p, {}, ok({ aircraft: [view("TEAM_H", { status: "busy" })] }))), /FLIGHT 중/);
  assert.match(refused(() => executionOf(p, {}, ok({ sessions: [bgRow("TEAM_H", "interactive")] }))), /백그라운드가 아닌 세션/);
  assert.match(refused(() => executionOf({ ...p, account: undefined }, {}, ok({ latest: [{ ...c, key: p.key, account: undefined }] }))), /옮길 ACCOUNT가 없음/);
  // 다른 제안 열쇠는 낡음
  assert.match(refused(() => executionOf(p, {}, ctx({ latest: [{ ...c, key: p.key, account: "acct-1" }] }))), /^409 조건이 바뀜/);
});

// ── LAUNCH ACCOUNT(ATC-239): AIRCRAFT의 것이 설정돼 있으면 그것이 효과 있는 home ──
test("LAUNCH ACCOUNT + ACCOUNT CHANGE: 설정이 없으면 전과 같다. 설정이 있으면 프로필 home로 돌아가자는 제안이 없고, 돌아감은 LAUNCH ACCOUNT로", () => {
  const away = [view("TEAM_H", { account: "acct-2", observedAccount: "acct-1" })]; // home acct-2, 지금 acct-1에서 돈다
  const fuel = [fuelAt("acct-2", 30), fuelAt("acct-1", 60), fuelAt("acct-3", 10)];
  // 설정 없음: home(acct-2)로 돌아가자는 제안(ATC-148)
  const before = changes(changeBase({ fuelAccounts: fuel }, away));
  assert.equal(before[0].account, "acct-2");
  assert.match(before[0].reasons.find((r) => r.code === "home")!.detail, /^home ACCOUNT acct-2:/);
  // LAUNCH ACCOUNT acct-1 = 이미 그 ACCOUNT에서 돈다 → 프로필 home(acct-2)로 돌아가자는 제안이 없다
  assert.equal(changes(changeBase({ fuelAccounts: fuel, launchAccount: "acct-1" }, away)).length, 0);
  // LAUNCH ACCOUNT acct-3 = 그쪽이 여유 있으면 "돌아감"은 LAUNCH ACCOUNT로(acct-3가 acct-2보다 낮아도 home로 돌아가는 사유는 LAUNCH ACCOUNT 하나)
  const toLaunch = changes(changeBase({ fuelAccounts: fuel, launchAccount: "acct-3" }, away));
  assert.equal(toLaunch.length, 1);
  assert.equal(toLaunch[0].account, "acct-3");
  assert.match(toLaunch[0].reasons.find((r) => r.code === "home")!.detail, /^LAUNCH ACCOUNT acct-3: 사용 10% — infoPct 아래로 돌아옴/);
  assert.match(toLaunch[0].reasons.find((r) => r.code === "session")!.detail, /프로필 home ACCOUNT acct-2는 그대로\(지금은 LAUNCH ACCOUNT acct-3가 기준\)/);
  // LAUNCH ACCOUNT가 차 있으면(infoPct 이상) 돌아가자고 하지 않는다
  assert.equal(changes(changeBase({ fuelAccounts: [fuelAt("acct-2", 30), fuelAt("acct-1", 60), fuelAt("acct-3", 88)], launchAccount: "acct-3" }, away)).length, 0);
  // 등록부에 없는 LAUNCH ACCOUNT는 효과가 없다(전과 같다)
  assert.equal(changes(changeBase({ fuelAccounts: fuel, launchAccount: "acct-9" }, away))[0].account, "acct-2");
  // hold 때문에 옮기는 제안은 그대로 난다(목표는 사용이 가장 낮은 것)
  assert.equal(changes(changeBase({ launchAccount: "acct-1" }))[0].account, "acct-3");
});

test("LAUNCH ACCOUNT + ENTRY·LAUNCH: 설정이 있으면 새 AIRCRAFT가 거기서 나고 hold 검사도 그 ACCOUNT로, 거절 사유가 있으면 다른 ACCOUNT로 돌리지 않고 막는다", () => {
  const i = fuelBase([fuelOf("acct-1", 60), fuelOf("acct-2", 30)], []);
  const logins = logged(["acct-1", true], ["acct-2", true]);
  // 설정 없음: 사용이 가장 낮은 acct-2
  assert.equal(entryAccountOf({ ...i, accountLogins: logins }).account, "acct-2");
  // LAUNCH ACCOUNT acct-1: 더 높아도 거기서
  assert.deepEqual(entryAccountOf({ ...i, accountLogins: logins, launchAccount: "acct-1" }), { registered: true, account: "acct-1", use: 60, blocked: null });
  const out = fleetPlanOf({ ...i, accountLogins: logins, launchAccount: "acct-1" });
  assert.equal(out.candidates[0].account, "acct-1");
  // 로그인 안 됨·hold면 막는다(acct-2로 돌리지 않는다)
  const off = entryAccountOf({ ...i, accountLogins: logged(["acct-1", false], ["acct-2", true]), launchAccount: "acct-1" });
  assert.equal(off.account, null);
  assert.match(off.blocked!, /LAUNCH ACCOUNT acct-1를 쓸 수 없음 — 로그인 안 됨/);
  const hold = entryAccountOf({ ...fuelBase([fuelOf("acct-1", 99), fuelOf("acct-2", 30)], []), accountLogins: logins, launchAccount: "acct-1" });
  assert.match(hold.blocked!, /LAUNCH ACCOUNT acct-1를 쓸 수 없음 — FUEL hold 99%/);
  // 등록부에 없는 설정은 무시한다
  assert.equal(entryAccountOf({ ...i, accountLogins: logins, launchAccount: "acct-9" }).account, "acct-2");
  // LAUNCH 제안의 hold 검사는 LAUNCH ACCOUNT의 FUEL로(AIRCRAFT의 home이 아니라)
  const fuel = [fuelOf("acct-1", 99, { group: "acct-1" }), fuelOf("acct-2", 10, { group: "acct-2" })];
  const base = { aircraft: [view("TEAM_I", { status: "absent", account: "acct-2" })], fuelAccounts: fuel };
  assert.equal(fuelOfPlan(base, "LAUNCH", "TEAM_I")?.account, "acct-2");
  assert.equal(fuelOfPlan({ ...base, launchAccount: "acct-1" }, "LAUNCH", "TEAM_I")?.account, "acct-1");
  assert.equal(fuelOfPlan({ ...base, launchAccount: "acct-1" }, "ENTRY", null)?.account, "acct-1");
  assert.equal(fuelOfPlan({ ...base, launchAccount: "acct-1" }, "STOP", "TEAM_I")?.account, "acct-2", "멈추기는 지금 ACCOUNT, 설정과 무관");
});
