import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allShadow,
  applyGroundStops,
  autoEligibility,
  ciMinutesOf,
  DEFAULT_ATFM,
  enforcedStops,
  type GroundStop,
  groundStopsOf,
  LAND_TIMEOUT_MS,
  landFiguresOf,
  landSpansOf,
  mainStateOf,
  type MainStatus,
  parseAtfm,
  precisionOf,
  s3Eligibility,
  setSwitch,
  slotHoldOf,
  slotLimitOf,
  slotsOf,
  type SlotView,
  undoneOf,
} from "./atfm.ts";
import type { AircraftView } from "./fleet.ts";
import type { GhPull } from "./landing.ts";
import type { PullRequest, Ticket } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import type { ScheduleOp } from "./schedule.ts";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const VCDO = "/p/vocado_nextjs";
const ATCC = "/p/atc";
const airports = [{ code: "VCDO", repo: VCDO }, { code: "ATCC", repo: ATCC }];
const main = (state: MainStatus["state"], over: Partial<MainStatus> = {}): MainStatus => ({
  repo: VCDO, slug: "o/vocado_nextjs", branch: "main", sha: "abcdef1234", state, failing: state === "failure" ? ["Production build"] : [], checks: state === "none" ? 0 : 3, at: ago(0), ...over,
});
const gh = (number: number, rollup: GhPull["statusCheckRollup"]): GhPull => ({
  number, title: `PR ${number}`, url: "u", headRefName: "b", headRefOid: `h${number}`, baseRefName: "main", isDraft: false, mergeStateStatus: "CLEAN",
  reviewDecision: null, createdAt: ago(100), author: null, statusCheckRollup: rollup, reviews: [],
});
const stopInput = (over: Partial<Parameters<typeof groundStopsOf>[0]> = {}) => ({
  airports, mains: new Map<string, MainStatus>(), pulls: new Map<string, GhPull[]>(), losOpen: new Map<string, number>(), cfg: DEFAULT_ATFM, now: NOW, ...over,
});

test("스위치: 기본값은 켜지지 않은 상태, 모르는 값은 기본값, on은 출발 중지 다섯 가지(ATC-62)와 머지 슬롯", () => {
  assert.deepEqual(parseAtfm({}), DEFAULT_ATFM);
  assert.equal(DEFAULT_ATFM.groundStop.mainBroken, "shadow");
  assert.equal(DEFAULT_ATFM.groundStop.manual, "off");
  const bad = parseAtfm({ groundStop: { mainBroken: "yes", failureWave: "on", manual: "on" }, slots: "yes", autoAssign: "on", slotLimits: { vcdo: 1, atcc: null, x: 99 } });
  assert.equal(bad.groundStop.mainBroken, "shadow"); // 모르는 값
  assert.equal(bad.groundStop.failureWave, "on"); // ATC-62: 실패 몰림·혼잡·LOS도 켤 수 있다
  assert.deepEqual(
    [DEFAULT_ATFM.groundStop.failureWave, DEFAULT_ATFM.groundStop.congestion, DEFAULT_ATFM.groundStop.los],
    ["shadow", "shadow", "shadow"],
  ); // 기본값은 그대로 그림자
  assert.equal(bad.groundStop.manual, "on");
  assert.equal(bad.slots, "shadow"); // 모르는 값
  assert.equal(bad.autoAssign, "shadow"); // 켤 수 없는 것
  assert.equal(parseAtfm({ slots: "on" }).slots, "on"); // 7단계: 머지 슬롯은 켤 수 있다
  assert.deepEqual(bad.slotLimits, { VCDO: 1, ATCC: null });
  assert.equal(setSwitch(DEFAULT_ATFM, "groundStop.mainBroken", "on").groundStop.mainBroken, "on");
  for (const k of ["failureWave", "congestion", "los"] as const) assert.equal(setSwitch(DEFAULT_ATFM, `groundStop.${k}`, "on").groundStop[k], "on");
  assert.throws(() => setSwitch(DEFAULT_ATFM, "autoAssign", "on"), /off\|shadow/);
  assert.throws(() => setSwitch(DEFAULT_ATFM, "nope", "off"), /모르는 스위치/);
  let on = setSwitch(setSwitch(DEFAULT_ATFM, "groundStop.mainBroken", "on"), "groundStop.manual", "on");
  for (const k of ["failureWave", "congestion", "los"]) on = setSwitch(on, `groundStop.${k}`, "on");
  assert.deepEqual(allShadow(on).groundStop, { ...DEFAULT_ATFM.groundStop, mainBroken: "shadow", manual: "off" }); // ATFM OFF: 다섯 모두 그림자·꺼짐
  assert.equal(allShadow(setSwitch(DEFAULT_ATFM, "groundStop.los", "off")).groundStop.los, "off"); // 꺼진 것은 그대로
  assert.equal(setSwitch(DEFAULT_ATFM, "slots", "on").slots, "on");
  assert.equal(allShadow(setSwitch(DEFAULT_ATFM, "slots", "on")).slots, "shadow"); // ATFM OFF는 슬롯도 그림자로
  assert.equal(allShadow(setSwitch(DEFAULT_ATFM, "slots", "off")).slots, "off");
});

test("기본 브랜치 상태: 실패 체크·실패 status는 failure, 진행 중은 pending, 없으면 none", () => {
  assert.deepEqual(mainStateOf([{ name: "build", status: "completed", conclusion: "failure" }, { name: "lint", status: "completed", conclusion: "success" }], []), { state: "failure", failing: ["build"], checks: 2 });
  assert.equal(mainStateOf([{ name: "build", status: "in_progress", conclusion: null }], []).state, "pending");
  assert.equal(mainStateOf([], [{ context: "ci/x", state: "error" }]).state, "failure");
  assert.equal(mainStateOf([{ name: "b", status: "completed", conclusion: "skipped" }], [{ context: "c", state: "success" }]).state, "success");
  assert.deepEqual(mainStateOf([], []), { state: "none", failing: [], checks: 0 });
});

test("기본 브랜치 상태(ATC-121): 늘 도는 체크가 이 SHA에 아직 없으면 pending — none·success가 아니다", () => {
  // 새 커밋: 체크가 아직 하나도 안 떴다
  assert.deepEqual(mainStateOf([], [], "check"), { state: "pending", failing: [], checks: 0 });
  // 다른 체크만 떴고 check는 아직: 통과한 것이 있어도 pending
  assert.equal(mainStateOf([{ name: "codex", status: "completed", conclusion: "success" }], [], "check").state, "pending");
  // 체크가 떠서 도는 중 · 끝남
  assert.equal(mainStateOf([{ name: "check", status: "in_progress", conclusion: null }], [], "check").state, "pending");
  assert.equal(mainStateOf([{ name: "check", status: "completed", conclusion: "success" }], [], "check").state, "success");
  // commit status의 context로 있어도 있는 것으로 본다
  assert.equal(mainStateOf([], [{ context: "check", state: "success" }], "check").state, "success");
  // 이미 실패한 체크가 있으면 그대로 failure
  assert.equal(mainStateOf([{ name: "codex", status: "completed", conclusion: "failure" }], [], "check").state, "failure");
  // 정한 체크가 없는 저장소는 예전 그대로
  assert.deepEqual(mainStateOf([], [], null), { state: "none", failing: [], checks: 0 });
  assert.deepEqual(mainStateOf([], []), { state: "none", failing: [], checks: 0 });
  assert.equal(mainStateOf([{ name: "codex", status: "completed", conclusion: "success" }], []).state, "success");
});

test("CI 소요 시간: 체크가 모두 끝났을 때 가장 이른 시작 → 가장 늦은 끝", () => {
  assert.equal(ciMinutesOf([
    { __typename: "CheckRun", name: "a", status: "COMPLETED", conclusion: "SUCCESS", startedAt: ago(10), completedAt: ago(7) },
    { __typename: "CheckRun", name: "b", status: "COMPLETED", conclusion: "SUCCESS", startedAt: ago(9), completedAt: ago(4) },
  ]), 6);
  assert.equal(ciMinutesOf([{ __typename: "CheckRun", name: "a", status: "IN_PROGRESS", startedAt: ago(10) }]), null);
  assert.equal(ciMinutesOf([]), null);
});

test("출발 중지: main 깨짐은 shadow면 그림자·on이면 실제로 막음·off면 없음, 나머지는 늘 그림자, 수동은 켜져 있을 때만", () => {
  const mains = new Map([[VCDO, main("failure")], [ATCC, main("none", { repo: ATCC })]]);
  const shadow = groundStopsOf(stopInput({ mains }));
  assert.deepEqual(shadow.map((s) => [s.airport, s.trigger, s.enforced]), [["VCDO", "main-broken", false]]);
  assert.match(shadow[0].text, /Production build/);
  const on = groundStopsOf(stopInput({ mains, cfg: setSwitch(DEFAULT_ATFM, "groundStop.mainBroken", "on") }));
  assert.equal(on[0].enforced, true);
  assert.deepEqual(groundStopsOf(stopInput({ mains, cfg: setSwitch(DEFAULT_ATFM, "groundStop.mainBroken", "off") })), []);

  const fail = (at: number) => [{ __typename: "CheckRun", name: "Production build", status: "COMPLETED", conclusion: "FAILURE", startedAt: ago(at + 5), completedAt: ago(at) }];
  const pulls = new Map([[VCDO, [gh(1, fail(10)), gh(2, fail(20)), gh(3, fail(30)), gh(4, fail(90))]]]);
  const wave = groundStopsOf(stopInput({ pulls }));
  assert.deepEqual(wave.map((s) => [s.trigger, s.enforced, s.evidence.join(",")]), [["failure-wave", false, "#1,#2,#3"]]);

  const pending = (n: number) => gh(n, [{ __typename: "CheckRun", name: "b", status: "IN_PROGRESS", startedAt: ago(45) }]);
  const jam = groundStopsOf(stopInput({ pulls: new Map([[VCDO, [1, 2, 3, 4, 5].map(pending)]]) }));
  assert.deepEqual(jam.map((s) => [s.trigger, s.kind, s.enforced]), [["congestion", "delay", false]]);
  assert.deepEqual(groundStopsOf(stopInput({ pulls: new Map([[VCDO, [1, 2, 3, 4].map(pending)]]) })), []);

  assert.deepEqual(groundStopsOf(stopInput({ losOpen: new Map([[ATCC, 2]]) })).map((s) => [s.airport, s.trigger]), [["ATCC", "los"]]);

  const manual = { ...DEFAULT_ATFM, manualStops: [{ airport: "ATCC", reason: "배포 점검", at: ago(5) }] };
  assert.deepEqual(groundStopsOf(stopInput({ cfg: manual })), []); // 스위치 꺼짐
  const m = groundStopsOf(stopInput({ cfg: { ...manual, groundStop: { ...manual.groundStop, manual: "on" } } }));
  assert.deepEqual(m.map((s) => [s.airport, s.trigger, s.enforced, s.text]), [["ATCC", "manual", true, "수동 출발 중지: 배포 점검"]]);
});

const stop = (over: Partial<GroundStop>): GroundStop => ({ airport: "VCDO", repo: VCDO, trigger: "main-broken", kind: "stop", land: true, enforced: true, text: "main 깨짐", evidence: [], since: ago(1), ...over });

test("켜진 출발 중지만 계획에서 ASSIGN을 뺀다(그림자·GROUND DELAY는 그대로)", () => {
  const plan = { assign: [{ flight: "VOC-1", airport: "VCDO" }, { flight: "VOC-2", airport: "ATCC" }], excluded: [] as { flight: string; reason: string }[] };
  assert.deepEqual(applyGroundStops(plan, [stop({ enforced: false }), stop({ kind: "delay", trigger: "congestion" })]), plan);
  const out = applyGroundStops(plan, [stop({})]);
  assert.deepEqual(out.assign.map((a) => a.flight), ["VOC-2"]);
  assert.deepEqual(out.excluded, [{ flight: "VOC-1", reason: "GROUND STOP — main 깨짐" }]);
  assert.deepEqual([...enforcedStops([stop({}), stop({ airport: "ATCC", enforced: false })]).keys()], ["VCDO"]);
});

const pr = (number: number, over: Partial<PullRequest> = {}): PullRequest => ({
  repo: VCDO, number, title: `PR ${number}`, url: "u", branch: `b${number}`, head: `h${number}`, base: "main", ticketKey: `VOC-${number}`,
  standPath: `/wt/${number}`, draft: false, landing: "CLEARED", blocks: [], readyAt: ago(60 - number), createdAt: ago(200), ...over,
});

test("머지 슬롯: CI 있는 저장소는 1, 없으면 무제한, 이미 LAND가 나간 PR은 밀리지 않고 Urgent는 그 다음, LAND 30분 넘으면 슬롯을 비운다", () => {
  assert.equal(slotLimitOf("VCDO", main("success"), DEFAULT_ATFM), 1);
  assert.equal(slotLimitOf("ATCC", main("none"), DEFAULT_ATFM), null);
  assert.equal(slotLimitOf("VCDO", main("success"), { ...DEFAULT_ATFM, slotLimits: { VCDO: 2 } }), 2);
  const pulls = [pr(1), pr(2), pr(3), pr(4, { landing: "APPROACH", readyAt: null })];
  const opts = (landed: Record<number, number>, urgent: number[] = [], limit: number | null = 1) => ({
    limitOf: () => limit,
    priorityOf: (k: string | null) => (urgent.some((n) => k === `VOC-${n}`) ? 1 : 3),
    landOf: (p: PullRequest) => (p.number in landed ? ago(landed[p.number]) : null),
    now: NOW,
  });
  const view = (m: Map<string, { slot: string; lanePos: number }>) => [...m].map(([k, v]) => `${k.split("#")[1]}:${v.slot === "in-slot" ? "IN" : "wait"}@${v.lanePos}`);
  assert.deepEqual(view(slotsOf(pulls, opts({}))), ["1:IN@1", "2:wait@2", "3:wait@3"]); // readyAt 순, APPROACH는 빠짐
  assert.deepEqual(view(slotsOf(pulls, opts({}, [3]))), ["3:IN@1", "1:wait@2", "2:wait@3"]); // Urgent가 앞으로
  assert.deepEqual(view(slotsOf(pulls, opts({ 2: 5 }, [3]))), ["2:IN@1", "3:wait@2", "1:wait@3"]); // LAND가 나간 #2는 밀리지 않는다
  const timedOut = slotsOf(pulls, opts({ 2: LAND_TIMEOUT_MS / 60_000 + 1 }));
  assert.equal(timedOut.get(`${VCDO}#2`)!.landTimedOut, true);
  assert.equal(timedOut.get(`${VCDO}#1`)!.slot, "in-slot"); // 시간이 지난 LAND는 슬롯을 비운다
  assert.ok([...slotsOf(pulls, opts({}, [], null)).values()].every((v) => v.slot === "in-slot"));
});

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  key: "VOC-10", title: "t", state: "Todo", stateType: "unstarted", stateColor: null, priority: 2, url: null, updatedAt: ago(10), project: "Song Experience",
  labels: ["type:BUILD", "wake:M", "rating:UI"], createdAt: ago(100), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null, ...over,
} as Ticket);
const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "D-0001", at: ago(30), kind: "ASSIGN", flight: "VOC-10", aircraft: "f", aircraftName: "TEAM_F", airport: "VCDO", score: 9, factors: [],
  status: "proposed", decidedAt: null, statusAt: ago(30), timeline: { proposed: ago(30) }, reason: null, note: "본문상 제약 없음", caution: false, hold: [], holdAt: null,
  message: null, departedStand: null, crosscheck: { by: "CROSSCHECK", model: "muse-spark-1.3-contributor", verdict: "agree", reason: "r", at: ago(20) }, ...over,
});
const aircraft = { registration: "TEAM_F", routes: ["Song Experience"], ratings: ["UI", "DOCS"], aog: null } as unknown as AircraftView;
const autoCtx = (over: Partial<Parameters<typeof autoEligibility>[1]> = {}) => ({
  ticket: ticket(), aircraft, state: { id: "f", name: "TEAM_F", callsign: "FOXTROT", airport: "VCDO", available: true, reason: "PARKED", reserved: null },
  parentKeys: new Set<string>(), history: [] as Proposal[], stopped: new Map<string, GroundStop>(), now: NOW, ...over,
});
const failedCodes = (p: Proposal, ctx = autoCtx()) => autoEligibility(p, ctx).failed.map((c) => c.code);

test("자동 배정 대상(A1~A10): 모두 맞으면 대상, 조건마다 빠진다", () => {
  assert.deepEqual(autoEligibility(proposal(), autoCtx()).eligible, true);
  assert.deepEqual(autoEligibility(proposal(), autoCtx()).checked, ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ labels: ["rating:UI"] }) })), ["A1"]); // 기본값 BUILD·M
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ labels: ["type:BUILD", "wake:H", "rating:UI"] }) })), ["A2"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ labels: ["type:SURVEY", "wake:L", "rating:UI"] }) })), ["A3"]); // 결정 1
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ labels: ["type:MAINT", "wake:M", "Risk:Security"] }) })), ["A4", "A8"]); // SEC가 없는 AIRCRAFT
  assert.deepEqual(failedCodes(proposal({ caution: true })), ["A5"]);
  assert.deepEqual(failedCodes(proposal({ note: null })), ["A5"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ project: "Beta Readiness" }) })), ["A6"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ project: "Beta Readiness", labels: ["type:BUILD", "wake:M", "tail:TEAM_F"] }) })), []); // tail이 맞으면 ROUTE는 보지 않는다
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ labels: ["type:BUILD", "wake:M", "tail:TEAM_B"] }) })), ["A6"]);
  assert.deepEqual(failedCodes(proposal({ crosscheck: null })), ["A7"]);
  // OCC와 같은 Sonnet의 agree는 CROSSCHECK로 치지 않는다. 지금 CROSSCHECK(Opus)와 옛 Muse는 된다(2026-09-29)
  assert.deepEqual(failedCodes(proposal({ crosscheck: { by: "x", model: "claude-sonnet-5-5", verdict: "agree", reason: "r", at: ago(1) } })), ["A7"]);
  assert.deepEqual(failedCodes(proposal({ crosscheck: { by: "x", model: "claude-opus-5-5", verdict: "agree", reason: "r", at: ago(1) } })), []);
  assert.deepEqual(failedCodes(proposal({ crosscheck: { by: "x", model: "muse-spark-1.3-contributor", verdict: "disagree", reason: "r", at: ago(1) } })), ["A7"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ state: { ...autoCtx().state, available: false } })), ["A8"]);
  const declined = proposal({ id: "D-0000", flight: "VOC-9", status: "declined", timeline: { declined: ago(60) } });
  assert.deepEqual(failedCodes(proposal(), autoCtx({ history: [declined] })), ["A8"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ ticket: ticket({ priority: 0 }) })), ["A9"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ parentKeys: new Set(["VOC-10"]) })), ["A9"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ history: [proposal({ id: "D-0000", status: "disagreed" })] })), ["A9"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ stopped: new Map([["VCDO", stop({})]]) })), ["A10"]);
});

const draft = (over: Partial<ScheduleOp> = {}): ScheduleOp => ({
  id: "S-0001", kind: "CLASSIFY", flight: "VOC-10", payload: { type: "MAINT", wake: "M" }, reason: "4.1 MAINT: 동작 변경 없음 · 4.2 M: 한 파일과 테스트",
  at: ago(30), status: "draft", statusAt: ago(30), verdictReason: null, calls: null, appliedRef: null, decision: null,
  crosscheck: { by: "CROSSCHECK", model: "claude-ocx-opencode-go--muse-spark-1.3-contributor", verdict: "agree", reason: "r", at: ago(10) }, ...over,
} as ScheduleOp);

test("S3 대상(S1~S4): 빈 축에만 더하고, SEC 없고, 허용 모델 agree와 절 인용, Todo·Backlog이고 STAND 없음", () => {
  const t = ticket({ labels: ["rating:UI"] });
  const ctx = (over: Partial<Parameters<typeof s3Eligibility>[2]> = {}) => ({ standTickets: new Set<string>(), inFlight: new Set<string>(), cautions: new Set<string>(), ...over });
  const ok = s3Eligibility(draft(), t, ctx());
  assert.equal(ok.eligible, true);
  assert.deepEqual(ok.checked, ["S1", "S2", "S3", "S4"]);
  const codes = (op: ScheduleOp, tk = t, stands = new Set<string>()) => s3Eligibility(op, tk, ctx({ standTickets: stands })).failed.map((c) => c.code);
  assert.deepEqual(codes(draft(), ticket({ labels: ["type:BUILD"] })), ["S1"]); // 있는 type을 바꿈
  assert.deepEqual(codes(draft({ kind: "PRIORITIZE", payload: { priority: 2 } as never })), ["S1"]);
  assert.deepEqual(codes(draft({ payload: { type: "MAINT", ratings: ["SEC"] }, reason: "4.1 MAINT · 4.3 SEC" })), ["S2"]);
  assert.deepEqual(codes(draft(), ticket({ labels: ["Risk:Security"] })), ["S2"]);
  assert.deepEqual(codes(draft({ reason: "4.1 MAINT만 인용" })), ["S3"]); // wake 근거(4.2) 없음
  assert.deepEqual(codes(draft({ crosscheck: null })), ["S3"]);
  assert.deepEqual(codes(draft(), ticket({ labels: [], stateType: "started", state: "In Progress" })), ["S4"]);
  assert.deepEqual(codes(draft(), t, new Set(["VOC-10"])), ["S4"]);
  // SEC는 절대 자동으로: Risk 그룹 라벨, 옛 단독 Risk 라벨, OCC CAUTION, 티켓을 모름
  assert.deepEqual(codes(draft(), ticket({ labels: ["Risk: Security"] })), ["S2"]);
  assert.deepEqual(codes(draft(), ticket({ labels: ["rating:SEC"] })), ["S2"]);
  assert.deepEqual(s3Eligibility(draft(), t, ctx({ cautions: new Set(["VOC-10"]) })).failed.map((c) => c.code), ["S2"]);
  assert.deepEqual(s3Eligibility(draft(), undefined, ctx()).failed.map((c) => c.code), ["S2", "S4"]);
  // STAND 없이 날고 있는 FLIGHT(READBACK 뒤 끝나지 않은 제안)도 S4에서 빠진다
  assert.deepEqual(s3Eligibility(draft(), t, ctx({ inFlight: new Set(["VOC-10"]) })).failed.map((c) => c.code), ["S4"]);
});

test("그림자 정확도: 대상이 된 건 중 사람 판정, 막아야 했던 사유로 거절된 수", () => {
  const items = [
    { id: "D-1", human: { verdict: "agree" as const } },
    { id: "D-2", human: { verdict: "disagree" as const }, reasonCodes: ["already-done"] },
    { id: "D-3", human: { verdict: "disagree" as const }, reasonCodes: ["other"] },
    { id: "D-4", human: null },
    { id: "D-5", human: { verdict: "agree" as const } }, // 대상이 아니었음
  ];
  assert.deepEqual(precisionOf(new Set(["D-1", "D-2", "D-3", "D-4"]), items), { eligible: 4, decided: 3, approved: 1, rate: 1 / 3, bad: 1 });
  assert.deepEqual(precisionOf(new Set(), items), { eligible: 0, decided: 0, approved: 0, rate: null, bad: 0 });
});

test("되돌린 라벨: 7일 안에 APPLIED된 CLASSIFY의 라벨이 Linear에서 사라짐", () => {
  const applied = draft({ status: "applied", statusAt: ago(60) });
  const old = draft({ id: "S-0002", status: "applied", statusAt: new Date(NOW - 8 * 86_400_000).toISOString() });
  const changes = (o: ScheduleOp, t: Ticket) => (t.labels.includes("type:MAINT") ? [] : ["type:MAINT"]);
  assert.deepEqual(undoneOf([applied, old], [ticket({ labels: [] })], changes, NOW), ["S-0001"]);
  assert.deepEqual(undoneOf([applied], [ticket({ labels: ["type:MAINT"] })], changes, NOW), []);
});

test("A8: ARRIVED 전 STAND 없는 FLIGHT를 날고 있는 AIRCRAFT는 대상이 아니다(ARRIVED·RECALLED·STAND DEPARTED는 괜찮음)", () => {
  const light = (over: Partial<Proposal>) =>
    proposal({ id: "D-0000", flight: "VOC-9", status: "departed", departedStand: null, departedVia: "readback", timeline: { departed: ago(90) }, ...over });
  assert.deepEqual(failedCodes(proposal(), autoCtx({ history: [light({})] })), ["A8"]);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ history: [light({ status: "arrived" })] })), []);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ history: [light({ status: "recalled" })] })), []);
  assert.deepEqual(failedCodes(proposal(), autoCtx({ history: [light({ departedStand: "/w/VOC-9", departedVia: "stand" })] })), []);
  // 다른 AIRCRAFT의 것은 상관없다
  assert.deepEqual(failedCodes(proposal(), autoCtx({ history: [light({ aircraftName: "TEAM_B" })] })), []);
});

test("slotHoldOf: slots가 on이고 waiting-slot일 때만 LAND를 막는 이유, 시간이 지난 LAND는 따로 적는다", () => {
  const v = (slot: "in-slot" | "waiting-slot", over: Partial<SlotView> = {}): SlotView => ({ slot, lanePos: 2, limit: 1, urgent: false, landAt: null, landTimedOut: false, ...over });
  assert.equal(slotHoldOf(v("waiting-slot"), "shadow"), null);
  assert.equal(slotHoldOf(v("waiting-slot"), "off"), null);
  assert.equal(slotHoldOf(v("in-slot"), "on"), null);
  assert.equal(slotHoldOf(null, "on"), null);
  assert.equal(slotHoldOf(v("waiting-slot"), "on")!.text, "머지 슬롯 대기 — 저장소 안 2번째, 동시 LAND 1");
  assert.match(slotHoldOf(v("waiting-slot", { landTimedOut: true, landAt: "2026-09-27T00:00:00Z" }), "on")!.text, /30분이 지나도 머지되지 않아/);
});

test("머지 슬롯 켜기 판단: LAND를 머지에 짝지어 동시 LAND·LAND→머지·30분 초과를 AIRPORT별로 센다", () => {
  const T = Date.parse("2026-09-27T12:00:00Z");
  const at = (min: number) => new Date(T + min * 60_000).toISOString();
  const land = (min: number, stand: string | null, flight: string | null = null, cancelled: number | null = null) => ({ type: "LAND" as const, at: at(min), stand, flight, cancelledAt: cancelled === null ? null : at(cancelled) });
  const entries = [
    { airport: "VCDO", arrivedAt: at(20), stands: ["/wt/a"], flight: "VOC-1" },
    { airport: "VCDO", arrivedAt: at(50), stands: ["/wt/b"], flight: "VOC-2" },
    { airport: "ATCC", arrivedAt: at(5), stands: [], flight: "ATC-9" },
  ];
  const spans = landSpansOf(
    [land(0, "/wt/a"), land(10, "/wt/b"), land(60, "/wt/c"), land(0, null, "ATC-9"), { ...land(1, "/wt/x"), type: "TAXI" as never }, land(70, "/wt/unknown")],
    entries,
    (c) => (c.stand === "/wt/c" ? "VCDO" : null),
    T + 120 * 60_000,
  );
  assert.deepEqual(spans.map((x) => `${x.airport}:${x.mergedMin}:${x.timedOut}`), ["VCDO:20:false", "VCDO:40:true", "VCDO:null:true", "ATCC:5:false"]);
  const figures = landFiguresOf(spans, T - 1);
  assert.deepEqual(figures, [
    { airport: "ATCC", lands: 1, concurrent: 0, mergedMedianMin: 5, timeouts: 0 },
    { airport: "VCDO", lands: 3, concurrent: 2, mergedMedianMin: 30, timeouts: 2 }, // a(0~20)와 b(10~50)가 겹침, c(60~90)는 따로
  ]);
  assert.deepEqual(landFiguresOf(spans, T + 30 * 60_000).map((f) => `${f.airport}:${f.lands}`), ["VCDO:1"]); // 창 밖 LAND는 뺀다
  // 취소된 LAND는 취소 시각에 끝나고 시간 초과가 아니다
  const [c] = landSpansOf([land(0, "/wt/c", null, 5)], [], () => "VCDO", T + 120 * 60_000);
  assert.deepEqual([c.end - c.start, c.timedOut], [5 * 60_000, false]);
});
