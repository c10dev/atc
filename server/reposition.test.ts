import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { Unserved } from "./dispatch.ts";
import type { AircraftView } from "./fleet.ts";
import { type ExecContext, executionOf, type FleetCandidate, type FleetInputs, type FleetProposal, FLEET_PLAN_DEFAULTS, fleetPlanOf, PlanError, repositionOf } from "./fleet-plan.ts";
import { computeActuals } from "./logbook.ts";
import { autoRepositionOf, isFlap, movedInDay, parseReposition, repositionAlertTextOf } from "./reposition.ts";
import { supervisorAlertsOf } from "./supervisor-alerts.ts";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
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
const need = (flight: string, airport: string, over: Partial<Unserved> = {}): Unserved => ({ flight, airport, type: "BUILD", ratings: [], labeled: true, why: "no-aircraft", tails: [], ...over });
const bg = (reg: string) => ({ registration: reg, kind: "background", id: reg.slice(-1).toLowerCase(), startedAt: NOW - DAY });
const assign = (flight: string, aircraftName: string, airport = "ATCC") => ({ flight, aircraftName, airport }) as never;

// 소스 ATCC에 쉬는 AIRCRAFT 넷(TEAM_E·F·G·K), 목표 DSGN에는 AIRCRAFT가 없고 FLIGHT DSG-1이 기다린다
const ATCC = ["TEAM_E", "TEAM_F", "TEAM_G", "TEAM_K"];
const base = (over: Partial<FleetInputs> = {}): FleetInputs => ({
  aircraft: ATCC.map((r) => view(r)),
  plan: { assign: [assign("ATC-1", "TEAM_E"), assign("ATC-2", "TEAM_G")], unserved: [need("DSG-1", "DSGN")] },
  sessions: ATCC.map(bg),
  // F가 가장 오래 쉬었다
  lastActive: new Map([["TEAM_E", ago(20 * MIN)], ["TEAM_F", ago(38 * MIN)], ["TEAM_G", ago(10 * MIN)], ["TEAM_K", ago(30 * MIN)]]),
  nordo: new Set(),
  los: new Map(),
  logbook: [],
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
const moves = (i: FleetInputs) => fleetPlanOf(i).candidates.filter((c) => c.kind === "REPOSITION");
const none = (i: FleetInputs) => assert.deepEqual(moves(i), []);

test("REPOSITION: 목표에 AIRCRAFT가 없고 FLIGHT가 기다리면 가장 오래 쉰 AIRCRAFT 하나를 옮긴다(FOXTROT이 옮기고 나머지는 남는다)", () => {
  const c = moves(base());
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].key, c[0].kind, c[0].aircraft, c[0].airport, c[0].from], ["REPOSITION|DSGN", "REPOSITION", "TEAM_F", "DSGN", "ATCC"]);
  const by = Object.fromEntries(c[0].reasons.map((r) => [r.code, r.detail]));
  assert.match(by.waiting, /DSGN: DSG-1 대기, 소속 AIRCRAFT 0/);
  assert.match(by.source, /ATCC: 쉬는 AIRCRAFT 4 → 3, 대기 FLIGHT 2/);
  assert.match(by.between, /TEAM_F: .* 38m, FLIGHT·STAND·PR 없음/);
  assert.match(by.cold, /DSGN 저장소에서 캐시 없이/);
  assert.match(by.session, /ATCC에서 멈추고 base를 DSGN으로 바꾼 뒤 DSGN 저장소에서 CREW BRIEFING/);
});

test("REPOSITION: 계획이 FLIGHT를 준 AIRCRAFT(TEAM_E·G)는 뽑지 않는다", () => {
  const c = moves(base({ lastActive: new Map([["TEAM_E", ago(9 * HOUR)], ["TEAM_F", ago(20 * MIN)], ["TEAM_G", ago(8 * HOUR)], ["TEAM_K", ago(30 * MIN)]]) }));
  assert.equal(c[0].aircraft, "TEAM_K"); // E·G가 가장 오래 쉬었지만 FLIGHT를 받는다. 남은 F·K 중 K가 더 오래
});

test("REPOSITION: 떠난 뒤 출발 AIRPORT가 자기 FLIGHT 수보다 적어지면 옮기지 않는다", () => {
  const two = ["TEAM_E", "TEAM_F"];
  none(base({ aircraft: two.map((r) => view(r)), sessions: two.map(bg), plan: { assign: [assign("ATC-1", "TEAM_E")], unserved: [need("DSG-1", "DSGN"), need("ATC-9", "ATCC")] } }));
  // 남는 AIRCRAFT 수가 FLIGHT 수와 같으면 옮긴다
  assert.equal(moves(base({ aircraft: two.map((r) => view(r)), sessions: two.map(bg), plan: { assign: [assign("ATC-1", "TEAM_E")], unserved: [need("DSG-1", "DSGN")] } })).length, 1);
});

test("REPOSITION: 목표에 이미 소속 AIRCRAFT가 있으면(ABSENT도) 옮기지 않는다. 퇴역·AOG는 세지 않는다", () => {
  none(base({ aircraft: [...ATCC.map((r) => view(r)), view("TEAM_X", { base: "DSGN", status: "absent" })] }));
  assert.equal(moves(base({ aircraft: [...ATCC.map((r) => view(r)), view("TEAM_X", { base: "DSGN", status: "absent", aog: { reason: "x", at: ago(HOUR) } })] })).length, 1);
});

test("REPOSITION: 목표가 GROUND STOP이거나 FLIGHT의 이유가 no-aircraft가 아니면 옮기지 않는다", () => {
  none(base({ groundStops: new Set(["DSGN"]) }));
  none(base({ plan: { assign: [], unserved: [need("DSG-1", "DSGN", { why: "unqualified" })] } }));
  none(base({ plan: { assign: [], unserved: [need("DSG-1", "DSGN", { why: "no-tail", tails: ["TEAM_Z"] })] } }));
  none(base({ plan: { assign: [], unserved: [] } }));
});

test("REPOSITION: RESUME(LIMIT)·RESTARTING·FUEL hold·NORDO인 AIRCRAFT는 옮기지 않는다", () => {
  const only = (a: AircraftView, extra: Partial<FleetInputs> = {}) => base({ aircraft: [a], sessions: [bg(a.registration)], plan: { assign: [], unserved: [need("DSG-1", "DSGN")] }, lastActive: new Map([[a.registration, ago(HOUR)]]), ...extra });
  assert.equal(moves(only(view("TEAM_F"))).length, 1); // 대조: 다른 조건이 없으면 옮긴다
  none(only(view("TEAM_F", { health: { code: "LIMIT", level: "caution", detail: "x", next: "", since: ago(HOUR), cut: true } as never })));
  none(only(view("TEAM_F", { restarting: { registration: "TEAM_F", name: "TEAM_F", sessionId: "s", since: ago(MIN), until: ago(-MIN) } as never })));
  none(only(view("TEAM_F", { fuel: { level: "hold" } as never })));
  none(only(view("TEAM_F"), { nordo: new Set(["TEAM_F"]) }));
});

test("REPOSITION: FLIGHT·STAND 점유·열린 PR이 있거나 세션이 백그라운드가 아니거나 바쁘면 옮기지 않는다", () => {
  const only = (a: AircraftView, extra: Partial<FleetInputs> = {}) => base({ aircraft: [a], sessions: [bg(a.registration)], plan: { assign: [], unserved: [need("DSG-1", "DSGN")] }, ...extra });
  none(only(view("TEAM_F", { flying: ["ATC-5"] })));
  none(only(view("TEAM_F", { flights: [{ key: "ATC-5", title: null }] as never })));
  none(only(view("TEAM_F", { status: "busy" })));
  none(only(view("TEAM_F"), { openPrs: new Set(["TEAM_F"]) }));
  none(only(view("TEAM_F"), { sessions: [{ registration: "TEAM_F", kind: "interactive", id: "f", startedAt: NOW - DAY }] }));
  none(only(view("TEAM_F"), { sessions: [] }));
});

test("REPOSITION: 목표 FLIGHT를 날 CREW·TYPE RATING이 없으면 옮기지 않는다", () => {
  none(base({ plan: { assign: [], unserved: [need("DSG-1", "DSGN", { ratings: ["SEC"] })] } }));
});

test("REPOSITION: minDwell 안에 LAUNCH·STOP·옮김이 있는 AIRCRAFT는 옮기지 않는다", () => {
  const only = (extra: Partial<FleetInputs>) => base({ aircraft: [view("TEAM_F")], sessions: [bg("TEAM_F")], plan: { assign: [], unserved: [need("DSG-1", "DSGN")] }, ...extra });
  assert.equal(moves(only({})).length, 1);
  none(only({ dwell: new Map([["TEAM_F", { op: "launch", at: ago(30 * MIN) }]]) }));
  none(only({ dwell: new Map([["TEAM_F", { op: "stop", at: ago(30 * MIN) }]]) }));
  assert.equal(moves(only({ dwell: new Map([["TEAM_F", { op: "launch", at: ago(3 * HOUR) }]]) })).length, 1); // minDwell(120분)이 지남
  none(only({ repositions: [{ aircraft: "TEAM_F", from: "RNPU", to: "ATCC", at: ago(30 * MIN), ok: true }] }));
});

test("REPOSITION: ACCOUNT CHANGE 후보인 AIRCRAFT는 뺀다(같은 세션에 두 제안이 없다)", () => {
  // 대조만: ACCOUNT CHANGE가 없는 입력에서는 옮긴다. (ACCOUNT CHANGE 자체는 fleet-plan.test.ts)
  assert.equal(moves(base()).length, 1);
});

test("REPOSITION 고르는 순서: 목표 AIRPORT의 ARRIVED 이력, 가장 오래 쉼, REGISTRATION", () => {
  const eq = new Map([["TEAM_E", ago(HOUR)], ["TEAM_F", ago(HOUR)], ["TEAM_G", ago(HOUR)], ["TEAM_K", ago(HOUR)]]);
  const i = (extra: Partial<FleetInputs>) => base({ plan: { assign: [], unserved: [need("DSG-1", "DSGN")] }, lastActive: eq, ...extra });
  assert.equal(moves(i({}))[0].aircraft, "TEAM_E"); // 전부 같으면 REGISTRATION 순
  const arr = (aircraft: string, n: number) => Array.from({ length: n }, (_, k) => ({ aircraft, airport: "DSGN", arrivedAt: ago((k + 1) * DAY), blockMin: 60, landingWaitMin: 3 }));
  const c = moves(i({ logbook: [...arr("TEAM_G", 2), ...arr("TEAM_K", 1)] }));
  assert.equal(c[0].aircraft, "TEAM_G"); // 이력이 가장 많음(오래 쉼보다 먼저)
  assert.match(c[0].reasons.find((r) => r.code === "history")!.detail, /DSGN에서 ARRIVED 2건/);
  // 14일 밖의 이력은 세지 않는다
  assert.equal(moves(i({ logbook: [{ aircraft: "TEAM_K", airport: "DSGN", arrivedAt: ago(15 * DAY), blockMin: 60, landingWaitMin: 3 }] }))[0].aircraft, "TEAM_E");
  // 이력이 같으면 가장 오래 쉰 것
  assert.equal(moves(i({ lastActive: new Map([["TEAM_E", ago(HOUR)], ["TEAM_F", ago(HOUR)], ["TEAM_G", ago(5 * HOUR)], ["TEAM_K", ago(2 * HOUR)]]) }))[0].aircraft, "TEAM_G");
});

test("REPOSITION: 목표 AIRPORT마다 하나, 같은 출발 AIRPORT에서 둘을 빼서 자기 수요를 깨지 않는다", () => {
  const i = base({
    aircraft: ["TEAM_E", "TEAM_F", "TEAM_G"].map((r) => view(r)),
    sessions: ["TEAM_E", "TEAM_F", "TEAM_G"].map(bg),
    plan: { assign: [assign("ATC-1", "TEAM_E")], unserved: [need("DSG-1", "DSGN"), need("DSG-2", "DSGN"), need("RNP-1", "RNPU")] },
    lastActive: new Map([["TEAM_E", ago(HOUR)], ["TEAM_F", ago(2 * HOUR)], ["TEAM_G", ago(3 * HOUR)]]),
  });
  const c = moves(i);
  // DSGN(FLIGHT 둘)에는 하나만, RNPU에는 하나. ATCC는 셋 중 수요 1을 남기려면 둘까지 뺄 수 있다
  assert.deepEqual(c.map((x) => `${x.airport}:${x.aircraft}`), ["DSGN:TEAM_G", "RNPU:TEAM_F"]);
  // 넷째 목표가 있어도 출발 AIRPORT는 수요(1) 아래로 내려가지 않는다
  const j = moves({ ...i, plan: { assign: i.plan.assign, unserved: [need("DSG-1", "DSGN"), need("RNP-1", "RNPU"), need("XXX-1", "XXXX")] } });
  assert.equal(j.length, 2);
});

test("REPOSITION flapping: 조건은 맞지만 minDwell 안에 직전 base로 되돌아가려는 AIRCRAFT를 알린다(옮기지 않는다)", () => {
  // TEAM_F가 30분 전에 ATCC → DSGN으로 옮겼다. 지금은 ATCC에 FLIGHT가 기다리고 DSGN에 남은 것이 F뿐이다
  const i = base({
    aircraft: [view("TEAM_F", { base: "DSGN" }), view("TEAM_E", { base: "DSGN" })],
    sessions: [bg("TEAM_F"), bg("TEAM_E")],
    plan: { assign: [], unserved: [need("ATC-9", "ATCC")] },
    repositions: [{ aircraft: "TEAM_F", from: "ATCC", to: "DSGN", at: ago(30 * MIN), ok: true }],
    lastActive: new Map([["TEAM_F", ago(HOUR)], ["TEAM_E", ago(HOUR)]]),
  });
  const out = fleetPlanOf(i);
  assert.deepEqual(out.flaps, [{ aircraft: "TEAM_F", from: "DSGN", to: "ATCC" }]);
  assert.deepEqual(out.candidates.filter((c) => c.kind === "REPOSITION").map((c) => c.aircraft), ["TEAM_E"]); // 다른 AIRCRAFT는 옮길 수 있다
  // minDwell이 지나면 flapping이 아니다
  assert.deepEqual(fleetPlanOf({ ...i, repositions: [{ aircraft: "TEAM_F", from: "ATCC", to: "DSGN", at: ago(3 * HOUR), ok: true }] }).flaps, []);
});

test("isFlap·movedInDay: 실패한 옮김은 base가 안 바뀌었으니 세지 않고, LAUNCH만 실패한 것은 센다", () => {
  const ev = { aircraft: "TEAM_F", from: "ATCC", to: "DSGN", at: ago(30 * MIN) };
  assert.ok(isFlap([{ ...ev, ok: true }], "TEAM_F", "ATCC", NOW, 120));
  assert.ok(!isFlap([{ ...ev, ok: true }], "TEAM_F", "RNPU", NOW, 120));
  assert.ok(!isFlap([{ ...ev, ok: false }], "TEAM_F", "ATCC", NOW, 120));
  assert.ok(isFlap([{ ...ev, ok: false, baseChanged: true } as never], "TEAM_F", "ATCC", NOW, 120));
  assert.equal(movedInDay([{ ...ev, ok: true }, { ...ev, ok: false }, { ...ev, ok: false, baseChanged: true }, { ...ev, ok: true, at: ago(25 * HOUR) }] as never, NOW), 2);
});

test("auto 가드: 하루 상한까지만 옮기고 넘는 것은 카드로 남긴다. flapping이면 아무것도 옮기지 않고 approval로 돌린다", () => {
  const cand = (aircraft: string, airport: string): Pick<FleetCandidate, "key" | "aircraft" | "airport"> => ({ key: `REPOSITION|${airport}`, aircraft, airport });
  const ready = [cand("A", "P1"), cand("B", "P2"), cand("C", "P3")];
  const moved = (n: number) => Array.from({ length: n }, (_, k) => ({ aircraft: `X${k}`, from: "A", to: "B", at: ago(HOUR), ok: true }));
  const d = autoRepositionOf({ ready, flaps: [], events: moved(3), now: NOW, dailyMax: 4 });
  assert.deepEqual(d.act.map((c) => c.aircraft), ["A"]);
  assert.equal(d.skipped.length, 2);
  assert.match(d.skipped[0], /하루 상한 4/);
  assert.deepEqual(autoRepositionOf({ ready, flaps: [], events: moved(4), now: NOW, dailyMax: 4 }).act, []);
  assert.equal(autoRepositionOf({ ready, flaps: [], events: moved(0), now: NOW, dailyMax: 4 }).act.length, 3);
  const f = autoRepositionOf({ ready, flaps: [{ aircraft: "TEAM_F", from: "DSGN", to: "ATCC" }], events: [], now: NOW, dailyMax: 4 });
  assert.deepEqual(f.act, []);
  assert.match(f.toApproval!, /TEAM_F가 DSGN → ATCC로 되돌아가려 함/);
});

test("parseReposition: 기본은 shadow와 하루 4, 모르는 값은 기본값", () => {
  assert.deepEqual(parseReposition(null), { mode: "shadow", dailyMax: 4 });
  assert.deepEqual(parseReposition({ reposition: "auto", repositionDailyMax: 2 }), { mode: "auto", dailyMax: 2 });
  assert.deepEqual(parseReposition({ reposition: "yes", repositionDailyMax: 0 }), { mode: "shadow", dailyMax: 4 });
  assert.equal(parseReposition({ reposition: "off" }).mode, "off");
  assert.equal(parseReposition({ reposition: "approval" }).mode, "approval");
});

// ── 실행(executionOf) ──
const proposal = (over: Partial<FleetProposal> = {}): FleetProposal => ({
  id: "F-0001", key: "REPOSITION|DSGN", kind: "REPOSITION", aircraft: "TEAM_F", airport: "DSGN", from: "ATCC", reasons: [], at: ago(MIN), status: "open", closedAt: null, verdict: null, closeReason: null, approval: null, execution: null, ...over,
});
const cand: FleetCandidate = { key: "REPOSITION|DSGN", kind: "REPOSITION", aircraft: "TEAM_F", airport: "DSGN", from: "ATCC", reasons: [] };
const ctx = (over: Partial<ExecContext> = {}): ExecContext => ({
  mode: "approval", latest: [cand], ranAt: ago(MIN), aircraft: [view("TEAM_F")], sessions: [bg("TEAM_F")], taken: [], lastLaunch: new Map(),
  airports: [{ code: "DSGN", repo: "/r/dsgn" }, { code: "ATCC", repo: "/r/atcc" }], now: NOW, ...over,
});

test("executionOf REPOSITION: STOP → base 쓰기 → LAUNCH, 마지막 LAUNCH의 permission mode·model", () => {
  const r = executionOf(proposal(), {}, ctx({ lastLaunch: new Map([["TEAM_F", { permissionMode: "acceptEdits", model: "opus" }]]) }));
  assert.deepEqual(r.steps, [
    { action: "stop", registration: "TEAM_F" },
    { action: "base", registration: "TEAM_F", base: "DSGN" },
    { action: "launch", registration: "TEAM_F", permissionMode: "acceptEdits", model: null, lastModel: "opus" }, // ATC-279: 마지막 LAUNCH의 모델은 lastModel(설정이 먼저)
  ]);
});

test("executionOf REPOSITION: 거절 — 모드, 옛 제안, FLIGHT 중, 세션 종류, 목표 저장소를 STOP 전에 본다", () => {
  const refuses = (p: FleetProposal, c: ExecContext, re: RegExp) => assert.throws(() => executionOf(p, {}, c), (e) => e instanceof PlanError && re.test(e.message));
  refuses(proposal(), ctx({ mode: "shadow" }), /그림자 운용/);
  refuses(proposal(), ctx({ latest: [] }), /조건이 바뀜/);
  refuses(proposal(), ctx({ aircraft: [view("TEAM_F", { flying: ["ATC-5"] })] }), /FLIGHT 중/);
  refuses(proposal(), ctx({ aircraft: [view("TEAM_F", { status: "busy" })] }), /FLIGHT 중/);
  refuses(proposal(), ctx({ sessions: [{ registration: "TEAM_F", kind: "interactive", id: "f", startedAt: 1 }] }), /백그라운드|세션/);
  refuses(proposal(), ctx({ sessions: [] }), /세션이 떠 있지 않음/);
  refuses(proposal(), ctx({ airports: [{ code: "DSGN", repo: null }] }), /DSGN의 저장소를 모름 — TEAM_F는 멈추지 않았다/);
  refuses(proposal(), ctx({ aircraft: [view("TEAM_F", { base: "DSGN" })] }), /이미 DSGN 소속/);
  refuses(proposal(), ctx({ aircraft: [view("TEAM_F", { retired: { at: ago(DAY) } })] }), /RETIRED/);
  refuses(proposal({ status: "executed" }), ctx(), /이미 닫힘/);
});

// ── 알림 ──
test("REPOSITION 알림: 자동 옮김은 ADVISORY, 실패는 CAUTION(LAUNCH 실패는 base가 바뀐 채라고 말한다), supervisor가 승인한 성공은 알리지 않는다", () => {
  const rec = (over: Record<string, unknown>) => ({ t: ago(HOUR), aircraft: "TEAM_F", from: "ATCC", to: "DSGN", ok: true, by: "auto", ...over }) as never;
  const inp = { sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null };
  const out = supervisorAlertsOf({
    ...inp,
    repositions: [rec({}), rec({ t: ago(2 * HOUR), by: "supervisor" }), rec({ t: ago(3 * HOUR), ok: false, stage: "launch", error: "not trusted" }), rec({ t: ago(4 * HOUR), ok: false, stage: "stop", by: "supervisor" })],
    repositionFlaps: [{ t: ago(MIN), reason: "TEAM_F가 DSGN → ATCC로 되돌아가려 함" }],
  }).filter((a) => a.group === "reposition");
  assert.equal(out.length, 4); // 자동 성공, 실패 둘, flapping
  assert.deepEqual(out.map((a) => a.level), ["advisory", "caution", "caution", "advisory"]);
  assert.match(out[0].text, /TEAM_F ATCC → DSGN \(자동\)/);
  assert.match(out[1].text, /base를 DSGN로 바꿨지만 LAUNCH가 실패함/);
  assert.match(out[1].next, /ABSENT로 LAUNCH 카드/);
  assert.match(out[3].text, /자동 모드를 approval로 되돌림/);
  assert.equal(repositionAlertTextOf({ t: "x", aircraft: "A", from: "P", to: "Q", ok: false, by: "auto", stage: "precheck", error: "e" }).level, "caution");
});
