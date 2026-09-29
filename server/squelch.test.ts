import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, decide, type DecideInput, fingerprint, naturalReason, project } from "./squelch.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-09-29T03:00:00Z");
const fp = (role: Parameters<typeof project>[0], inputs: Parameters<typeof project>[1]) => fingerprint(project(role, inputs));

// ── fingerprint ──

test("fingerprint: 키 순서가 달라도 같고, 값이 다르면 다르다", () => {
  assert.equal(fingerprint({ a: 1, b: { c: [1, 2], d: null } }), fingerprint({ b: { d: null, c: [1, 2] }, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1])); // 배열 순서는 뜻이 있다
  assert.match(fingerprint({}), /^[0-9a-f]{64}$/);
  assert.equal(canonical({ a: undefined, b: 1 }), canonical({ b: 1 }));
});

// ── project: TOWER ──

const towerBrief = (over: Record<string, unknown> = {}) => ({
  at: "2026-09-29T03:00:00Z",
  cursor: "e10",
  reset: false,
  events: [],
  open: { conflicts: [], orphans: [], unattended: [], noContact: [], health: [], healthAlerts: [], fuel: [], fuelLeaks: [], coldCache: [], stranded: [] },
  landingQueue: [
    { seq: 1, landing: "CLEARED", airport: "ATCC", pr: { number: 147, head: "f2389ce", title: "x" }, blocks: [], slotHold: null, groundStop: null, codex: null, extReview: { status: "pass", family: "opus" }, review: "OPUS", landClearance: { id: "C-0090", readBack: true }, holders: [{ name: "TEAM_A" }] },
  ],
  groundStops: [],
  clearances: { pending: [{ id: "C-0091", to: { name: "TEAM_A" }, ageMin: 3 }], overdue: [] },
  traffic: [],
  ...over,
});

test("project tower: 시각·나이·커서가 움직여도 지문은 같다", () => {
  const a = towerBrief();
  const b = towerBrief({ at: "2026-09-29T03:03:00Z", cursor: "e11", clearances: { pending: [{ id: "C-0091", to: { name: "TEAM_A" }, ageMin: 6 }], overdue: [] } });
  assert.equal(fp("tower", { brief: a }), fp("tower", { brief: b }));
});

test("project tower: reset, 이벤트, PR head, blocks, overdue, slotHold, 열린 것이 신호다", () => {
  const base = fp("tower", { brief: towerBrief() });
  const q = (over: Record<string, unknown>) => ({ ...(towerBrief().landingQueue[0] as object), ...over });
  const changed = [
    towerBrief({ reset: true }),
    towerBrief({ events: [{ id: "e11", kind: "pr.opened" }] }),
    towerBrief({ landingQueue: [q({ pr: { number: 147, head: "abcdef0" } })] }),
    towerBrief({ landingQueue: [q({ blocks: [{ code: "ci", text: "CI 실패" }] })] }),
    towerBrief({ landingQueue: [q({ slotHold: { text: "머지 슬롯 대기" } })] }),
    towerBrief({ landingQueue: [q({ extReview: { status: "waiting", family: null } })] }),
    towerBrief({ clearances: { pending: [{ id: "C-0091" }], overdue: ["C-0091"] } }),
    towerBrief({ open: { ...towerBrief().open, unattended: [{ stand: "atc-x", message: "STAND 무인" }] } }),
    towerBrief({ open: { ...towerBrief().open, fuelLeaks: [{ key: "leak|TEAM_A|2026-09-29" }] } }),
  ];
  for (const b of changed) assert.notEqual(fp("tower", { brief: b }), base);
});

// ── project: MCC (design 1의 끈끈한 경우) ──

const mccQueue = (over: Record<string, unknown> = {}) => ({
  mode: "shadow",
  gate: "SHADOW GATE 3/20",
  groundStop: null,
  rts: { due: true, why: "4cc5ac4 → c0ca22e", last: { at: "2026-09-29T01:00:00Z" } },
  pulls: [{ pr: 147, head: "f2389ce", tier: "auto", inspection: null, blocks: [], landable: true, ci: "success", title: "t" }],
  recent: [{ op: "land", at: "2026-09-29T02:00:00Z" }],
  ...over,
});

test("project mcc: 같은 head의 WOULD LAND와 같은 from → to의 WOULD RTS는 신호가 아니다", () => {
  const a = mccQueue();
  // 다음 tick: 최근 기록(shadow로 남은 줄)과 gate 문구가 달라져도 같은 지문
  const b = mccQueue({ gate: "SHADOW GATE 4/20", recent: [{ op: "land", at: "2026-09-29T03:05:00Z" }, { op: "land", at: "2026-09-29T02:00:00Z" }] });
  assert.equal(fp("mcc", { queue: a }), fp("mcc", { queue: b }));
});

test("project mcc: 새 head, 새 PR, 새 RTS 대상, INSPECTION, 모드는 신호다", () => {
  const base = fp("mcc", { queue: mccQueue() });
  const pull = (o: object) => ({ ...(mccQueue().pulls[0] as object), ...o });
  for (const q of [
    mccQueue({ pulls: [pull({ head: "0000000" })] }),
    mccQueue({ pulls: [pull({}), pull({ pr: 148, head: "1111111" })] }),
    mccQueue({ pulls: [pull({ inspection: { verdict: "pass" } })] }),
    mccQueue({ pulls: [pull({ blocks: ["L3 CI 진행 중"], landable: false })] }),
    mccQueue({ rts: { due: true, why: "c0ca22e → 9999999" } }),
    mccQueue({ rts: { due: false, why: "서비스가 최신" } }),
    mccQueue({ mode: "land" }),
    mccQueue({ groundStop: { trigger: "ci", since: "2026-09-29T03:00:00Z" } }),
  ])
    assert.notEqual(fp("mcc", { queue: q }), base);
  // RTS가 아닐 때의 사유 문구는 시각에 따라 바뀌어도 신호가 아니다
  assert.equal(fp("mcc", { queue: mccQueue({ rts: { due: false, why: "지난 RTS에서 5분이 안 지남" } }) }), fp("mcc", { queue: mccQueue({ rts: { due: false, why: "서비스가 최신" } }) }));
});

// ── project: OCC ──

const occ = (over: Record<string, any> = {}) => ({
  dispatch: {
    mode: "shadow",
    at: "2026-09-29T03:00:00Z",
    open: [{ id: "D-0060", note: "ok", briefing: { what: "w" } }],
    held: [],
    inFlight: [{ id: "D-0057", status: "sent" }],
    overdue: [],
    arrivalCandidates: [],
    ...over.dispatch,
  },
  crewChange: { mode: "shadow", at: "x", approved: [], waiting: [], sent: [], overdue: [], pending: [], ...over.crewChange },
  schedule: {
    mode: "shadow",
    open: [],
    inProgress: [],
    candidates: { classify: [], prioritize: [], close: [], tail: [], waypoint: [] },
    waypointGaps: [],
    slips: [{ key: "m1:eta", fresh: false, days: 3 }],
    routesWithoutWaypoints: [],
    ...over.schedule,
  },
  following: { at: "x", items: [{ flight: "ATC-1", issues: [{ key: "ATC-1|no-pr", fresh: false, text: "…" }] }], fresh: [], ...over.following },
});

test("project occ: 나이·시각과 이미 보고한 slips·following은 신호가 아니다", () => {
  const a = occ();
  const b = occ({ dispatch: { at: "later" }, schedule: { slips: [{ key: "m1:eta", fresh: false, days: 4 }] }, following: { at: "later" } });
  assert.equal(fp("occ", a), fp("occ", b));
});

test("project occ: 메모 없는 제안, 승인·RECALL, overdue, crew-change, 후보, fresh slips·following은 신호다", () => {
  const base = fp("occ", occ());
  for (const o of [
    occ({ dispatch: { open: [{ id: "D-0060", note: null, briefing: null }] } }),
    occ({ dispatch: { inFlight: [{ id: "D-0057", status: "recalling" }] } }),
    occ({ dispatch: { overdue: ["D-0057"] } }),
    occ({ dispatch: { arrivalCandidates: [{ flight: "ATC-9", aircraft: "TEAM_B", proposal: "D-0050" }] } }),
    occ({ crewChange: { approved: [{ id: "CC-0003" }] } }),
    occ({ crewChange: { overdue: ["CC-0002"] } }),
    occ({ schedule: { candidates: { classify: ["ATC-5"], prioritize: [], close: [], tail: [], waypoint: [] } } }),
    occ({ schedule: { open: [{ id: "S-0004" }] } }),
    occ({ schedule: { inProgress: [{ id: "S-0003", status: "released" }] } }),
    occ({ schedule: { slips: [{ key: "m1:eta", fresh: true }] } }),
    occ({ following: { items: [{ flight: "ATC-1", issues: [{ key: "ATC-1|no-pr", fresh: true }] }] } }),
  ])
    assert.notEqual(fp("occ", o), base);
});

// ── project: CROSSCHECK, REVIEW ──

test("project crosscheck: pending 제안·초안 ID만 본다", () => {
  const i = (d: string[], s: string[]) => ({
    dispatch: { crosscheck: { pending: d.map((id) => ({ id })), examples: [{ id: "old" }] } },
    schedule: { crosscheck: { pending: s.map((id) => ({ id })), examples: [] } },
  });
  assert.equal(fp("crosscheck", i(["D-1"], [])), fp("crosscheck", { ...i(["D-1"], []), dispatch: { crosscheck: { pending: [{ id: "D-1" }], examples: [] } } }));
  assert.notEqual(fp("crosscheck", i(["D-1"], [])), fp("crosscheck", i(["D-1", "D-2"], [])));
  assert.notEqual(fp("crosscheck", i([], ["S-1"])), fp("crosscheck", i([], [])));
});

test("project review: 같은 pending head는 신호가 아니고, 새 head나 새 PR은 신호다", () => {
  const r = (pending: object[], recent: object[] = []) => ({ silentHours: 6, pending, excluded: [], recent });
  const p = { pr: "atc#150", head: "abc1234", title: "t" };
  assert.equal(fp("review", { reviews: r([p]) }), fp("review", { reviews: r([p], [{ pr: "atc#149", verdict: "pass" }]) }));
  assert.notEqual(fp("review", { reviews: r([p]) }), fp("review", { reviews: r([{ ...p, head: "def5678" }]) }));
  assert.notEqual(fp("review", { reviews: r([p]) }), fp("review", { reviews: r([p, { pr: "atc#151", head: "1" }]) }));
  assert.equal(fp("review", { reviews: r([p, { pr: "atc#151", head: "1" }]) }), fp("review", { reviews: r([{ pr: "atc#151", head: "1" }, p]) })); // 순서 무관
});

test("project: 필드가 빠진 빈 입력도 죽지 않는다", () => {
  for (const role of ["tower", "mcc", "occ", "crosscheck", "review"] as const) assert.match(fp(role, {}), /^[0-9a-f]{64}$/);
});

// ── decide ──

const x = (over: Partial<DecideInput> = {}): DecideInput => ({ fp: "A", last: { fp: "A", openedAt: new Date(T0).toISOString() }, now: T0 + 10 * MIN, heartbeatMin: 50, manualChanged: false, mode: "on", ...over });

test("decide on: 이유마다 하나", () => {
  assert.deepEqual(decide(x({ last: null })), { open: true, reason: "first" });
  assert.deepEqual(decide(x({ manualChanged: true })), { open: true, reason: "manual" });
  assert.deepEqual(decide(x({ fp: "B" })), { open: true, reason: "signal" });
  assert.deepEqual(decide(x({ now: T0 + 50 * MIN })), { open: true, reason: "heartbeat" });
  assert.deepEqual(decide(x()), { open: false, reason: "quiet" });
});

test("decide: 하트비트 경계는 정확히 heartbeatMin분에 열린다", () => {
  assert.equal(decide(x({ now: T0 + 50 * MIN - 1 })).open, false);
  assert.equal(decide(x({ now: T0 + 50 * MIN })).reason, "heartbeat");
  assert.equal(decide(x({ now: T0 + 20 * MIN, heartbeatMin: 20 })).reason, "heartbeat"); // 역할별 값
});

test("decide: 이유가 겹치면 first → manual → signal → heartbeat 순", () => {
  assert.equal(decide(x({ last: null, manualChanged: true, fp: "B" })).reason, "first");
  assert.equal(decide(x({ manualChanged: true, fp: "B", now: T0 + 99 * MIN })).reason, "manual");
  assert.equal(decide(x({ fp: "B", now: T0 + 99 * MIN })).reason, "signal");
});

test("decide off: 늘 연다", () => {
  for (const o of [x(), x({ fp: "B" }), x({ last: null }), x({ manualChanged: true })]) assert.deepEqual(decide({ ...o, mode: "off" }), { open: true, reason: "off" });
});

test("decide shadow: 늘 열고, 이유에 on이었다면의 결과를 적는다", () => {
  assert.deepEqual(decide(x({ mode: "shadow" })), { open: true, reason: "shadow:quiet" });
  assert.deepEqual(decide(x({ mode: "shadow", fp: "B" })), { open: true, reason: "shadow:signal" });
  assert.deepEqual(decide(x({ mode: "shadow", last: null })), { open: true, reason: "shadow:first" });
  assert.deepEqual(decide(x({ mode: "shadow", manualChanged: true })), { open: true, reason: "shadow:manual" });
  assert.deepEqual(decide(x({ mode: "shadow", now: T0 + 60 * MIN })), { open: true, reason: "shadow:heartbeat" });
});

test("naturalReason: 깨진 openedAt은 하트비트로 본다", () => {
  assert.equal(naturalReason({ fp: "A", last: { fp: "A", openedAt: "nope" }, now: T0, heartbeatMin: 50, manualChanged: false }), "heartbeat");
});
