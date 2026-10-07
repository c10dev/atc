import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allMenu,
  delivered,
  emptyRoleState,
  infoOnlyAckOf,
  launchedModeOf,
  MISS_MS,
  openFlightsOf,
  parseWakeSwitch,
  planWake,
  REMIND_MS,
  SERVER_FIRST_MS,
  transitionWhy,
  TRANSITION_UPTIME_MS,
  wakeCountsOf,
  wakeEventsOf,
  wakeLaunchPromptOf,
  wakePromptOf,
  wakeResultOf,
  type WakeEvent,
  DAILY_AT_MIN,
  dailyDaysOf,
  dailyDigestOf,
  dailyDueOf,
  dailyPromptOf,
  parseWakeDaily,
  WAKE_CAP,
  WAKE_ROLES,
} from "./control-wake.ts";
import { checkControlWake, controlWakeWhy, isChecked } from "./send-checks.ts";
import { actionable } from "./tick.ts";

// CONTROL WAKE(ATC-557 a): 순수 부분. 사건 목록, delta, 글, 결과 줄, 수, /loop ↔ wake 옮기기의 조건
const T0 = Date.parse("2026-10-07T09:00:00Z");
const at = (min: number) => T0 + min * 60_000;
const NO = { seen: new Set<string>(), now: T0 };

const tower = (over: Record<string, unknown> = {}) => ({
  cursor: "epochA:5",
  reset: false,
  events: [],
  open: { conflicts: [], orphans: [], unattended: [], noContact: [], health: [], healthAlerts: [], fuel: [], fuelLeaks: [], coldCache: [], stranded: [] },
  landingQueue: [],
  relays: [],
  clearances: { pending: [], overdue: [] },
  ...over,
});

test("스위치: 없는 값은 wake(기본), loop는 loop, 모르는 값은 loop(틀린 값이 깨움을 켜지 않게)", () => {
  assert.deepEqual(parseWakeSwitch(null), { tower: "wake", occ: "wake", mcc: "wake", review: "wake" });
  assert.deepEqual(parseWakeSwitch({ roles: { tower: "loop", occ: "fresh", review: "loop" } }), { tower: "loop", occ: "loop", mcc: "wake", review: "loop" });
  // 하루 한 번 점검 턴(ATC-557 d): 없는 값은 on, 모르는 값은 off(오늘처럼 점검 턴 없음)
  assert.deepEqual([parseWakeDaily(null), parseWakeDaily({ daily: "off" }), parseWakeDaily({ daily: "yes" })], ["on", "off", "off"]);
});

test("TOWER 사건: actionable과 같은 기준 — 할 일이 없으면 사건도 없고, info 사건만이면 서버가 ack할 cursor", () => {
  const quiet = tower({ events: [{ id: 3, kind: "handoff" }, { id: 4, kind: "away.started" }] });
  assert.equal(actionable("tower", { brief: quiet }).act, false);
  assert.deepEqual(wakeEventsOf("tower", { brief: quiet }, NO), []);
  assert.equal(infoOnlyAckOf(quiet), "epochA:5");
  assert.equal(infoOnlyAckOf(tower({ events: [{ id: 3, kind: "handoff" }, { id: 5, kind: "alert.raised" }] })), null);
  assert.equal(infoOnlyAckOf(tower()), null); // 사건이 없으면 ack할 것도 없다
});

test("SERVER CLEARANCE(ATC-557 b): 서버 몫(landVia·action server, serverSends)은 사건이 아니다. 스위치 on인 종류만 메뉴, off인 종류는 TOWER의 일", () => {
  const b = tower({
    clearances: { pending: [{ id: "C-1", to: { name: "TEAM_A" }, type: "HOLD" }], overdue: ["C-1"] },
    landingQueue: [
      { airport: "ATCC", pr: { number: 7, head: "abcdef1234" }, landing: "CLEARED", landBy: "holder", landVia: "server", holders: [{ name: "TEAM_A" }] },
      { airport: "ATCC", pr: { number: 8, head: "1234567aaa" }, landing: "APPROACH", fix: { action: "server" }, info: { action: "send" }, holders: [{ name: "TEAM_B" }] },
    ],
    relays: [{ id: "R-1", to: "TEAM_C", type: "INFO" }],
    serverSends: { relays: [{ id: "R-2" }], resend: ["C-9"] },
  });
  const keys = (kinds?: Set<string>) => wakeEventsOf("tower", { brief: b }, { ...NO, ...(kinds ? { serverKinds: kinds as never } : {}) }).map((e) => [e.key, e.menu]);
  // 서버가 보내는 LAND(landVia)·FIX(action server)·R-2·C-9는 사건이 없다. TOWER에게 온 INFO(send)·relay R-1·RESEND C-1만
  assert.deepEqual(keys(new Set(["info", "goAround", "fix", "land", "resend", "relay"])), [["approach-info:ATCC #8@1234567:send", true], ["relay:R-1", true], ["overdue:C-1", true]]);
  // INFO·RELAY가 off: TOWER의 일이라 메뉴가 아니다(그것만으로 깨워도 오작동이 아니다)
  assert.deepEqual(keys(new Set(["goAround", "fix", "land", "resend"])), [["approach-info:ATCC #8@1234567:send", false], ["relay:R-1", false], ["overdue:C-1", true]]);
  // 옛 셈(serverKinds 없음)은 그대로
  assert.deepEqual(keys().map((x) => x[1]), [true, true, true]);
  assert.deepEqual(actionable("tower", { brief: tower({ landingQueue: [b.landingQueue[0]] }) }).reasons, []); // landVia server는 tick의 할 일도 아니다
});

test("TOWER 사건: 첫 침묵은 RESEND(메뉴), RESEND 뒤 두 번째 침묵은 보고(판단), LAND·FIX send는 메뉴, supervisor는 판단", () => {
  const b = tower({
    clearances: {
      pending: [
        { id: "C-1", to: { name: "TEAM_A" }, type: "HOLD", flight: "ATC-9" },
        { id: "C-2", to: { name: "TEAM_B" }, type: "INFO", resentBy: ["C-3"] },
      ],
      overdue: ["C-1", "C-2"],
    },
    landingQueue: [
      { airport: "ATCC", pr: { number: 7, head: "abcdef1234" }, flight: "ATC-9", landing: "CLEARED", landBy: "holder", holders: [{ name: "TEAM_A" }] },
      { airport: "ATCC", pr: { number: 8, head: "1234567aaa" }, landing: "APPROACH", fix: { action: "supervisor" }, holders: [] },
    ],
    events: [{ id: 9, kind: "landing.conflict", flight: "ATC-9" }],
  });
  const ev = wakeEventsOf("tower", { brief: b }, NO);
  const by = (k: string) => ev.find((e) => e.key === k)!;
  assert.equal(by("overdue:C-1").menu, true);
  assert.equal(by("second-silence:C-2").menu, false);
  assert.equal(by("land:ATCC #7@abcdef1").menu, true);
  assert.equal(by("fix:ATCC #8@1234567:supervisor").menu, false);
  assert.equal(by("event:epochA:9").kind, "event:landing.conflict");
  assert.deepEqual(by("event:epochA:9").flights, ["ATC-9"]);
  // actionable이 할 일이라고 하는 것은 모두 사건이 된다
  assert.equal(actionable("tower", { brief: b }).act, true);
  // 읽지 못한 브리핑은 "메뉴 밖" 하나(세션이 직접 읽는다)
  assert.equal(wakeEventsOf("tower", { brief: null }, NO)[0]!.kind, "outside-menu");
});

test("TOWER 새로 보인 상태 항목(FUEL 등)은 seen에 없을 때만, DECISION 답도 사건이다", () => {
  const b = tower({ open: { ...tower().open, fuel: [{ key: "acct-1@w1" }] } });
  assert.equal(wakeEventsOf("tower", { brief: b }, NO).some((e) => e.kind === "new:fuel"), true);
  assert.equal(wakeEventsOf("tower", { brief: b }, { seen: new Set(["fuel:acct-1@w1"]), now: T0 }).length, 0);
  const ans = wakeEventsOf("tower", { brief: tower() }, { ...NO, answers: ["DECISION DC-0003 [k] ANSWERED by SUPERVISOR — option 1"] });
  assert.deepEqual(ans.map((e) => e.key), ["decision:DC-0003"]);
});

test("OCC: 서버가 보낸 FLIGHT PLAN의 첫 overdue는 서버 몫(사건 아님), 서버가 다시 보낸 뒤는 두 번째 침묵. 승인된 카드는 서버가 먼저(3분)", () => {
  const dispatch = {
    mode: "approval",
    open: [],
    held: [],
    inFlight: [
      { id: "D-1", status: "sent", sentVia: "server", flight: "VOC-1", aircraftName: "TEAM_A" },
      { id: "D-2", status: "approved", flight: "VOC-2", aircraftName: "TEAM_B" },
    ],
    overdue: ["D-1"],
  };
  const i = { dispatch, crewChange: {}, schedule: { mode: "shadow" }, following: { items: [] } };
  const before = wakeEventsOf("occ", i, { seen: new Set([`target-route:2026-10-07`]), now: T0 });
  assert.deepEqual(before.map((e) => e.key), ["send-plan:D-2"]);
  assert.equal(before[0]!.graceMs, SERVER_FIRST_MS);
  const after = wakeEventsOf("occ", i, { seen: new Set([`target-route:2026-10-07`]), now: T0, serverResent: new Set(["D-1"]) });
  assert.equal(after.find((e) => e.key === "second-silence:D-1")?.menu, false);
});

test("MCC: INSPECTION은 판단, 막힘 없는 PR의 LAND·RTS는 메뉴(서버 자동이 먼저 3분)", () => {
  const q = { pulls: [{ pr: 5, head: "aaaaaaa", tier: "auto", landable: true }, { pr: 6, head: "bbbbbbb", inspection: null, blocks: [] }], rts: { due: true, why: "a → b" } };
  const ev = wakeEventsOf("mcc", { queue: q }, NO);
  assert.deepEqual(ev.map((e) => [e.kind, e.menu]), [["land", true], ["inspect", false], ["rts", true]]);
  assert.equal(actionable("mcc", { queue: q }).act, true);
});

const ev = (key: string, over: Partial<WakeEvent> = {}): WakeEvent => ({ key, kind: key.split(":")[0]!, text: key, flights: [], menu: false, ...over });

test("깨움 계획: 한꺼번에 생긴 일은 다음 패스에 한 번에, 같은 일은 한 번만, 풀린 것은 delta로, 30분 넘게 열리면 한 번만 다시", () => {
  let st = emptyRoleState();
  let p = planWake(st, [ev("a"), ev("b")], { now: at(0), busy: false, canSend: true });
  assert.equal(p.wake, null); // 처음 본 패스는 기다린다(SETTLE)
  p = planWake(p.next, [ev("a"), ev("b")], { now: at(0.5), busy: false, canSend: true });
  assert.deepEqual(p.wake!.fresh.map((e) => e.key), ["a", "b"]);
  st = delivered(p.next, p.wake!, "W-0001", at(0.5));
  // 같은 일은 다시 깨우지 않는다
  p = planWake(st, [ev("a"), ev("b")], { now: at(5), busy: false, canSend: true });
  assert.equal(p.wake, null);
  // b가 풀리고 c가 새로 생김: c를 싣고 b는 풀린 목록에
  p = planWake(p.next, [ev("a"), ev("c")], { now: at(6), busy: false, canSend: true });
  p = planWake(p.next, [ev("a"), ev("c")], { now: at(6.5), busy: false, canSend: true });
  assert.deepEqual([p.wake!.fresh.map((e) => e.key), p.wake!.resolved], [["c"], ["b"]]);
  st = delivered(p.next, p.wake!, "W-0002", at(6.5));
  assert.deepEqual(st.resolved, []);
  // a가 30분 넘게 열림: 한 번 다시
  p = planWake(st, [ev("a"), ev("c")], { now: at(0.5) + REMIND_MS + 1000, busy: false, canSend: true });
  assert.deepEqual(p.wake!.still.map((e) => e.key), ["a"]);
  st = delivered(p.next, p.wake!, "W-0003", at(0.5) + REMIND_MS + 1000);
  assert.equal(planWake(st, [ev("a"), ev("c")], { now: at(120), busy: false, canSend: true }).wake?.still.length ?? 0, 1); // c(W-0002)는 아직 한 번도 다시 싣지 않았다
});

test("깨움 계획: 앞 깨움이 끝나지 않았거나 보낼 수 없으면 깨우지 않고, 15분 넘게 깨움 없이 열린 일은 '깨우지 못함'으로 한 번 센다", () => {
  let p = planWake(emptyRoleState(), [ev("x")], { now: at(0), busy: false, canSend: false });
  p = planWake(p.next, [ev("x")], { now: at(1), busy: true, canSend: true });
  assert.equal(p.wake, null);
  p = planWake(p.next, [ev("x")], { now: at(0) + MISS_MS, busy: false, canSend: false });
  assert.deepEqual(p.missed.map((m) => m.key), ["x"]);
  p = planWake(p.next, [ev("x")], { now: at(0) + MISS_MS + 60_000, busy: false, canSend: false });
  assert.deepEqual(p.missed, []); // 한 번만
  // 서버가 먼저 할 일(grace)은 그만큼 늦게 센다
  const g = planWake(emptyRoleState(), [ev("y", { graceMs: SERVER_FIRST_MS })], { now: at(0), busy: false, canSend: true });
  assert.equal(planWake(g.next, [ev("y", { graceMs: SERVER_FIRST_MS })], { now: at(2), busy: false, canSend: true }).wake, null);
  assert.equal(planWake(g.next, [ev("y", { graceMs: SERVER_FIRST_MS })], { now: at(3), busy: false, canSend: true }).wake?.fresh.length, 1);
});

test("메뉴 오작동: 실은 일이 모두 메뉴일 때만", () => {
  assert.equal(allMenu({ fresh: [ev("l", { menu: true })], still: [], resolved: [] }), true);
  assert.equal(allMenu({ fresh: [ev("l", { menu: true }), ev("i")], still: [], resolved: [] }), false);
});

test("글: 머리·delta·관련 FLIGHT·할 일·결과 줄, 검사를 통과하고 같은 writer의 brand를 받는다", () => {
  const plan = { fresh: [ev("overdue:C-1", { kind: "overdue", text: "no READBACK for C-1", flights: ["ATC-9"], menu: true })], still: [], resolved: ["land:ATCC #7@abc"] };
  const flights = openFlightsOf("tower", { brief: tower({ landingQueue: [{ airport: "ATCC", pr: { number: 7 }, flight: "ATC-9", landing: "CLEARED", holders: [{ name: "TEAM_A" }] }] }) }, ["ATC-9"]);
  const text = wakePromptOf({ role: "tower", wakeId: "W-0042", plan, lastWakeId: "W-0041", lastWakeAt: new Date(at(-12)).toISOString(), flights, now: T0 });
  assert.match(text, /^\[ATC WAKE W-0042\] TOWER\n/);
  assert.match(text, /your last wake W-0041 \(12 min ago\)/);
  assert.match(text, /- overdue: no READBACK for C-1/);
  assert.match(text, /Resolved since then: land:ATCC #7@abc/);
  assert.match(text, /- ATC-9: PR ATCC #7 CLEARED · holders TEAM_A/);
  assert.match(text, /`node atcctl\.mjs tick tower --wake W-0042`/);
  assert.match(text, /WAKE RESULT: acted.*WAKE RESULT: nothing/s);
  const session = { id: "sess-t", name: "TOWER" };
  const ok = checkControlWake({ wakeId: "W-0042", role: "TOWER", session, expectedName: "TOWER", text, mode: "wake", launchedWake: false, now: T0 });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && isChecked(ok.send), true);
  assert.equal(ok.ok && ok.send.kind, "control-wake");
  // 막는 것: 스위치 loop(깨움 모드로 뜬 세션이 아니면), 다른 이름, 머리와 다른 id, 결과 줄 없음, 팀 머리
  const base = { wakeId: "W-0042", role: "TOWER", session, expectedName: "TOWER", text, mode: "wake", launchedWake: false, now: T0 };
  assert.match(controlWakeWhy({ ...base, mode: "loop" })!, /스위치가 loop/);
  assert.equal(controlWakeWhy({ ...base, mode: "loop", launchedWake: true }), null);
  assert.match(controlWakeWhy({ ...base, session: { id: "x", name: "TEAM_A" } })!, /이 TOWER이 아님/);
  assert.match(controlWakeWhy({ ...base, wakeId: "W-0043" })!, /다름/);
  assert.match(controlWakeWhy({ ...base, text: text.replace(/WAKE RESULT/g, "RESULT") })!, /결과 줄/);
  assert.match(controlWakeWhy({ ...base, text: `${text}\n[DISPATCH D-0001] FLIGHT PLAN` })!, /팀에 가는 머리/);
  assert.match(controlWakeWhy({ ...base, role: "CROSSCHECK" })!, /역할이 아님/); // 은퇴(ATC-371)
  assert.match(controlWakeWhy({ ...base, role: "REVIEW" })!, /머리\(W-0042 TOWER\)가 이 깨움\(W-0042 REVIEW\)과 다름/);
});

test("LAUNCH 프롬프트(wake)에는 /loop가 없고 한 번 둘러보라고 한다", () => {
  for (const r of ["tower", "occ", "mcc"] as const) {
    const p = wakeLaunchPromptOf(r);
    assert.doesNotMatch(p, /\/loop \d/);
    assert.match(p, new RegExp(`tick ${r} --wake boot`));
  }
});

test("결과 줄: 깨운 글 뒤의 assistant 줄에서만 찾는다(깨운 글 자신·다음 깨움 뒤는 아님)", () => {
  const user = (msg: string, id: string) => JSON.stringify({ type: "user", origin: { kind: "peer", msg_id: id }, message: { role: "user", content: msg } });
  const asst = (t: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
  const tail = [user("[ATC WAKE W-0001] TOWER … `WAKE RESULT: acted` or `WAKE RESULT: nothing`", "m1"), asst("done\nWAKE RESULT: nothing")].join("\n");
  assert.equal(wakeResultOf(tail, "m1"), "nothing");
  assert.equal(wakeResultOf(user("[ATC WAKE W-0001] TOWER … WAKE RESULT: acted", "m1"), "m1"), null);
  const two = [user("[ATC WAKE W-0001] TOWER x WAKE RESULT: acted", "m1"), user("[ATC WAKE W-0002] TOWER y WAKE RESULT: acted", "m2"), asst("WAKE RESULT: acted")].join("\n");
  assert.equal(wakeResultOf(two, "m1"), null);
  assert.equal(wakeResultOf(two, "m2"), "acted");
  assert.equal(wakeResultOf(tail, "nope"), null);
});

test("수: 역할마다 깨움과 오작동 셋(못 깨움·메뉴·할 일 없음), 7일 밖은 빼고", () => {
  const t = (min: number) => new Date(at(min)).toISOString();
  const lines = [
    { t: t(1), kind: "control-wake", op: "deliver", role: "tower", menu: true },
    { t: t(2), kind: "control-wake", op: "deliver", role: "occ", menu: false },
    { t: t(3), kind: "control-wake", op: "result", role: "tower", result: "nothing" },
    { t: t(4), kind: "control-wake", op: "result", role: "occ", result: "acted" },
    { t: t(5), kind: "control-wake", op: "missed", role: "mcc" },
    { t: t(6), kind: "control-wake", op: "confirm", role: "mcc", seen: false, why: "idle" },
    { t: t(6), kind: "control-wake", op: "transition", role: "mcc", ok: true },
    { t: new Date(at(-8 * 1440)).toISOString(), kind: "control-wake", op: "deliver", role: "tower", menu: true },
    { t: t(7), kind: "server-send", op: "deliver" },
  ];
  const c = wakeCountsOf(lines, at(10));
  assert.deepEqual([c.total.wakes, c.total.menu, c.total.nothing, c.total.missed, c.total.acted, c.total.unseen, c.total.transitions], [2, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual([c.roles.tower.menu, c.roles.occ.acted, c.roles.mcc.missed], [1, 1, 1]);
});

test("/loop ↔ wake 옮기기: LAUNCH 줄의 wake로 지금 모드를 알고(없으면 loop), 같은 안전 조건과 cooldown·업타임을 본다", () => {
  const lines = [
    { t: "x", kind: "control", op: "launch", jobId: "j1" },
    { t: "y", kind: "control", op: "launch", jobId: "j2", wake: true },
  ];
  assert.deepEqual([launchedModeOf(lines, "j1"), launchedModeOf(lines, "j2"), launchedModeOf(lines, "j3")], ["loop", "wake", "loop"]);
  const ok = { want: "wake" as const, launched: "loop" as const, single: true, idle: true, blocks: [], auto: true, lastTryAt: null, uptimeMs: TRANSITION_UPTIME_MS, now: T0, recycling: null };
  assert.deepEqual(transitionWhy(ok), { go: true });
  assert.equal(transitionWhy({ ...ok, launched: "wake" }).go, false);
  assert.equal(transitionWhy({ ...ok, idle: false }).go, false);
  assert.equal(transitionWhy({ ...ok, blocks: ["RTS: 진행 중"] }).go, false);
  assert.equal(transitionWhy({ ...ok, auto: false }).go, false);
  assert.equal(transitionWhy({ ...ok, recycleOff: true }).go, false); // CONTROL RECYCLE mode off면 스스로 다시 띄우지 않는다
  assert.equal(transitionWhy({ ...ok, uptimeMs: 60_000 }).go, false);
  assert.equal(transitionWhy({ ...ok, lastTryAt: T0 - 60 * 60_000 }).go, false);
  assert.equal(transitionWhy({ ...ok, recycling: "OCC" }).go, false);
  // BREAKER가 멈춰 loop로 돌리는 것(urgent)은 업타임·3시간 cooldown을 기다리지 않는다(10분 안 재시도만 막는다). 안전 조건은 그대로
  const fb = { ...ok, want: "loop" as const, launched: "wake" as const, urgent: true, uptimeMs: 0, lastTryAt: T0 - 60 * 60_000 };
  assert.deepEqual(transitionWhy(fb), { go: true });
  assert.equal(transitionWhy({ ...fb, lastTryAt: T0 - 5 * 60_000 }).go, false);
  assert.equal(transitionWhy({ ...fb, idle: false }).go, false);
  assert.equal(transitionWhy({ ...fb, blocks: ["RTS: 진행 중"] }).go, false);
});

// ── ATC-557 d: REVIEW와 하루 한 번 점검 턴 ──
const reviews = (pending: unknown[]) => ({ reviews: { pending, excluded: [], recent: [] } });
const rpr = (n: number) => ({ pr: `c10dev/vocado#${n}`, head: `beef${n}00`, title: `PR ${n}`, flight: `VOC-${n}` });

test("REVIEW 사건: actionable과 같은 기준(pending) — PR head 하나가 판단 사건 하나, 읽지 못하면 메뉴 밖 하나, CROSSCHECK는 깨움 역할이 아니다", () => {
  assert.deepEqual(wakeEventsOf("review", reviews([]), NO), []);
  assert.equal(actionable("review", reviews([]) as never).act, false);
  const es = wakeEventsOf("review", reviews([rpr(1), rpr(2)]), NO);
  assert.equal(actionable("review", reviews([rpr(1)]) as never).act, true);
  assert.deepEqual(es.map((e) => [e.key, e.kind, e.menu, e.flights]), [
    ["review:c10dev/vocado#1@beef100", "review-pending", false, ["VOC-1"]],
    ["review:c10dev/vocado#2@beef200", "review-pending", false, ["VOC-2"]],
  ]);
  // head가 바뀌면 새 사건(새 head는 다시 리뷰한다)
  assert.equal(wakeEventsOf("review", reviews([{ ...rpr(1), head: "cafe000" }]), NO)[0]!.key, "review:c10dev/vocado#1@cafe000");
  assert.deepEqual(wakeEventsOf("review", { reviews: { error: "x" } }, NO).map((e) => e.kind), ["outside-menu"]);
  assert.deepEqual([...WAKE_ROLES], ["tower", "occ", "mcc", "review"]);
  assert.deepEqual(openFlightsOf("review", reviews([rpr(1)]), ["VOC-1"]), [{ flight: "VOC-1", facts: ["PR c10dev/vocado#1@beef100 waits for a landing review"] }]);
});

test("REVIEW 깨움: 한 번에 2건까지(새 일 먼저), 나머지는 앞 깨움이 끝난 뒤 — 그동안 '깨우지 못함'으로 세지 않는다", () => {
  const cap = WAKE_CAP.review;
  assert.equal(cap, 2);
  const es = [ev("r1"), ev("r2"), ev("r3")];
  let p = planWake(emptyRoleState(), es, { now: at(0), busy: false, canSend: true, cap });
  p = planWake(p.next, es, { now: at(0.5), busy: false, canSend: true, cap });
  assert.deepEqual(p.wake!.fresh.map((e) => e.key), ["r1", "r2"]);
  let st = delivered(p.next, p.wake!, "W-0001", at(0.5));
  // 리뷰 중(busy) 16분: r3은 기다리고 오작동이 아니다
  p = planWake(st, es, { now: at(16.5), busy: true, canSend: true, cap });
  assert.deepEqual([p.wake, p.missed], [null, []]);
  // 끝남: r1·r2가 풀리고 r3을 싣는다. 이번 깨움에 실리는 일은 '깨우지 못함'이 아니다
  p = planWake(p.next, [ev("r3")], { now: at(17), busy: false, canSend: true, cap });
  assert.deepEqual([p.wake!.fresh.map((e) => e.key), p.wake!.resolved, p.missed], [["r3"], ["r1", "r2"], []]);
  st = delivered(p.next, p.wake!, "W-0002", at(17));
  // 제한이 없는 역할은 그대로(모두 한 번에)
  const q = planWake(planWake(emptyRoleState(), es, { now: at(0), busy: false, canSend: true }).next, es, { now: at(0.5), busy: false, canSend: true });
  assert.equal(q.wake!.fresh.length, 3);
  // 보낼 수 없는(세션 없음) 채 15분이면 cap이 있어도 센다
  const m = planWake(planWake(emptyRoleState(), [ev("z")], { now: at(0), busy: false, canSend: false, cap }).next, [ev("z")], { now: at(15), busy: false, canSend: false, cap });
  assert.deepEqual(m.missed.map((x) => x.key), ["z"]);
});

test("REVIEW 깨우는 글: 머리 REVIEW, `tick review --wake`, 2건 안내 — 같은 검사를 통과한다", () => {
  const plan = { fresh: wakeEventsOf("review", reviews([rpr(1)]), NO), still: [], resolved: [] };
  const text = wakePromptOf({ role: "review", wakeId: "W-0070", plan, lastWakeId: null, lastWakeAt: null, flights: [], now: T0 });
  assert.match(text, /^\[ATC WAKE W-0070\] REVIEW\n/);
  assert.match(text, /`node \.\.\/controller\/atcctl\.mjs tick review --wake W-0070`/);
  assert.match(text, /at most 2 per pass/);
  assert.doesNotMatch(text, /Team replies/); // REVIEW는 팀의 답을 받지 않는다
  const c = checkControlWake({ wakeId: "W-0070", role: "REVIEW", session: { id: "s", name: "REVIEW" }, expectedName: "REVIEW", text, mode: "wake", launchedWake: false, now: T0 });
  assert.equal(c.ok && c.send.role, "REVIEW");
  const boot = wakeLaunchPromptOf("review");
  assert.match(boot, /^\[ATC WAKE BOOT\] REVIEW\n/);
  assert.match(boot, /tick review --wake boot/);
});

test("하루 한 번 점검 턴의 시각: 역할마다 15분씩, 00:00Z(DUTY REVIEW)·00:30Z(OCC TARGET/ROUTE) 뒤, 그날 한 번, 놓치면 그날 안에", () => {
  assert.deepEqual(DAILY_AT_MIN, { tower: 60, occ: 75, mcc: 90, review: 105 });
  const mins = Object.values(DAILY_AT_MIN).sort((a, b) => a - b);
  assert.equal(mins.every((m, i) => m > 30 && (i === 0 || m - mins[i - 1]! >= 15)), true);
  const d = (iso: string) => Date.parse(iso);
  assert.equal(dailyDueOf("tower", d("2026-10-07T00:59:59Z"), new Set()), null);
  assert.equal(dailyDueOf("tower", d("2026-10-07T01:00:00Z"), new Set()), "2026-10-07");
  assert.equal(dailyDueOf("review", d("2026-10-07T01:30:00Z"), new Set()), null);
  assert.equal(dailyDueOf("review", d("2026-10-07T23:50:00Z"), new Set()), "2026-10-07"); // 서버가 꺼져 시각을 놓쳤다: 그날 안에 한 번
  assert.equal(dailyDueOf("tower", d("2026-10-07T05:00:00Z"), new Set(["2026-10-07"])), null);
  assert.equal(dailyDueOf("tower", d("2026-10-08T00:30:00Z"), new Set(["2026-10-07"])), null); // 날이 바뀌면 다음 날 시각까지
  const lines = [
    { t: "2026-10-07T01:00:30Z", kind: "control-wake", op: "deliver", role: "tower", daily: true },
    { t: "2026-10-07T01:15:30Z", kind: "control-wake", op: "deliver", role: "occ" },
  ];
  assert.deepEqual([...dailyDaysOf(lines, "tower")], ["2026-10-07"]);
  assert.deepEqual([...dailyDaysOf(lines, "occ")], []); // 점검 턴이 아닌 깨움은 세지 않는다
});

test("점검 턴의 글: 지난 24시간의 깨움과 오래 열린 일, 역할마다 적는 방법(MCC·REVIEW는 DECISION 카드 없음), 같은 검사를 통과한다", () => {
  const now = Date.parse("2026-10-07T01:00:30Z");
  const t = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const lines = [
    { t: t(30), kind: "control-wake", op: "deliver", id: "W-0001", role: "tower", msgId: "old", menu: false, events: [{ kind: "overdue" }] },
    { t: t(5), kind: "control-wake", op: "deliver", id: "W-0010", role: "tower", msgId: "a", menu: true, events: [{ kind: "overdue" }, { kind: "overdue" }], flights: ["ATC-9"] },
    { t: t(4.9), kind: "control-wake", op: "result", role: "tower", msgId: "a", result: "acted" },
    { t: t(2), kind: "control-wake", op: "deliver", id: "W-0011", role: "tower", msgId: "b", menu: false, events: [{ kind: "event:unable" }] },
    { t: t(1.9), kind: "control-wake", op: "result", role: "tower", msgId: "b", result: "nothing" },
    { t: t(1), kind: "control-wake", op: "missed", role: "tower" },
    { t: t(3), kind: "control-wake", op: "deliver", id: "W-0012", role: "occ", msgId: "c", menu: false, events: [] },
  ];
  const open = { k: { first: t(3), kind: "second-silence", text: "no answer to C-7", flights: [], menu: false, woke: t(2.5), wakeId: "W-0011" }, j: { first: t(0.5), kind: "x", text: "young", flights: [], menu: false } };
  const dg = dailyDigestOf(lines, "tower", now, open);
  assert.equal(dg.summary, "2 event wakes · acted 1 · nothing 1 · no result line 0 · missed events 1 · menu-only wakes 1");
  assert.deepEqual(dg.wakes, ["W-0011 23:00Z nothing: event:unable", "W-0010 20:00Z acted: overdue ×2 (ATC-9)"]);
  assert.deepEqual(dg.open, ["second-silence: no answer to C-7 (since 22:00Z, woken W-0011)"]);
  for (const role of WAKE_ROLES) {
    const text = dailyPromptOf({ role, wakeId: "W-0099", day: "2026-10-07", digest: dg });
    const name = role.toUpperCase();
    assert.match(text, new RegExp(`^\\[ATC WAKE W-0099\\] ${name}\\nDaily review turn \\(ATC-557\\)`));
    assert.match(text, new RegExp(`tick ${role} --wake W-0099`));
    assert.equal(/DECISION card/.test(text), role === "tower" || role === "occ", role);
    const c = checkControlWake({ wakeId: "W-0099", role: name, session: { id: "s", name }, expectedName: name, text, mode: "wake", launchedWake: false, now });
    assert.equal(c.ok, true, role);
  }
  assert.match(dailyPromptOf({ role: "mcc", wakeId: "W-0099", day: "2026-10-07", digest: dg }), /`mcc escalate` only for a PR/);
});

test("수: 점검 턴은 깨움과 따로 — 그 결과 nothing은 오작동 '할 일 없이 깨움'이 아니다", () => {
  const t = (min: number) => new Date(at(min)).toISOString();
  const c = wakeCountsOf(
    [
      { t: t(1), kind: "control-wake", op: "deliver", role: "review", menu: false, daily: true },
      { t: t(2), kind: "control-wake", op: "result", role: "review", result: "nothing", daily: true },
      { t: t(3), kind: "control-wake", op: "deliver", role: "review", menu: false },
      { t: t(4), kind: "control-wake", op: "result", role: "review", result: "nothing" },
      { t: t(5), kind: "control-wake", op: "deliver", role: "tower", daily: true },
      { t: t(6), kind: "control-wake", op: "result", role: "tower", result: "acted", daily: true },
    ],
    at(10),
  );
  assert.deepEqual([c.roles.review.daily, c.roles.review.dailyNothing, c.roles.review.wakes, c.roles.review.nothing], [1, 1, 1, 1]);
  assert.deepEqual([c.total.daily, c.total.dailyActed, c.total.dailyNothing, c.total.wakes, c.total.nothing, c.total.acted], [2, 1, 1, 1, 1, 0]);
});
