import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { ROLES } from "./squelch.ts";
import { actionable, occKeysOf, persistentKeysOf } from "./tick.ts";
import { mountTick } from "./tick-run.ts";

// 실제 브리핑 모양(필요한 필드만). 조용한 것과 할 일이 있는 것을 역할마다 만든다
const emptyOpen = { conflicts: [], orphans: [], unattended: [], noContact: [], health: [], healthAlerts: [], fuel: [], fuelLeaks: [], coldCache: [], stranded: [] };
const tower = (over: Record<string, unknown> = {}, open: Record<string, unknown> = {}) => ({
  at: "2026-10-01T06:00:00Z",
  cursor: "42",
  reset: false,
  events: [],
  open: { ...emptyOpen, ...open },
  landingQueue: [],
  groundStops: [],
  clearances: { pending: [], overdue: [] },
  ...over,
});
const q = (over: Record<string, unknown>) => ({ airport: "ATCC", pr: { number: 7, head: "abc1234" }, landing: "APPROACH", blocks: [], ...over });

test("TOWER: 아무것도 없으면 조용하다", () => {
  assert.deepEqual(actionable("tower", { brief: tower() }), { act: false, reasons: [], info: 0 });
});

test("TOWER: 쌓인 APPROACH PR와 이미 한 번 보인(seen) 열린 항목(NORDO·UNIDENTIFIED·FUEL)만으로는 조용하다", () => {
  const b = tower(
    { landingQueue: [q({}), q({ pr: { number: 8, head: "def" }, landing: "APPROACH", blocks: [{ code: "stacked" }] })] },
    {
      health: [{ name: "TEAM_O", code: "PENDING", level: "info" }],
      healthAlerts: [{ message: "BLOCKED — …" }],
      orphans: [{ stand: "s", sessions: [] }],
      unattended: [{ stand: "t", message: "m" }],
      fuel: [{ key: "k" }],
    },
  );
  assert.equal(actionable("tower", { brief: b }, new Set(persistentKeysOf(b))).act, false); // 이미 보인 항목
  assert.equal(actionable("tower", { brief: b }).act, true); // 처음 보이면 새 것이라 act
});

test("TOWER: ATC LOG에 적기만 하는 사건(handoff, away.*)만 있으면 조용하고 ack되는 수를 알린다", () => {
  const a = actionable("tower", { brief: tower({ events: [{ id: 1, kind: "handoff" }, { id: 2, kind: "away.started" }] }) });
  assert.deepEqual(a, { act: false, reasons: [], info: 2 });
});

test("TOWER: 할 일이 있는 경우마다 act와 이유", () => {
  const cases: [string, unknown, string][] = [
    ["새 사건(LANDING 허가)", tower({ events: [{ id: 1, kind: "landing.cleared" }] }), "event:landing.cleared"],
    ["GROUND STOP", tower({ events: [{ id: 2, kind: "groundstop.started" }] }), "event:groundstop.started"],
    ["모르는 사건 종류도 할 일로", tower({ events: [{ id: 3 }] }), "event:unknown"],
    ["서버 재시작", tower({ reset: true }), "reset"],
    ["CLEARED, holder가 LAND를 낸다", tower({ landingQueue: [q({ landing: "CLEARED", landBy: "holder" })] }), "land"],
    ["CLEARED, landBy가 없는 옛 서버 모양", tower({ landingQueue: [q({ landing: "CLEARED" })] }), "land"],
    ["GO AROUND를 보내야 함", tower({ landingQueue: [q({ landing: "APPROACH", goAround: { action: "send", text: "t" } })] }), "go-around"],
    ["GO AROUND를 SUPERVISOR에게 보고", tower({ landingQueue: [q({ goAround: { action: "supervisor", why: "no-holder" } })] }), "go-around"],
    ["막힘 INFO를 보내야 함(ATC-270)", tower({ landingQueue: [q({ info: { action: "send", text: "PR #7 cannot land yet" } })] }), "approach-info"],
    ["리뷰 지적 FIX를 보내야 함(ATC-270)", tower({ landingQueue: [q({ fix: { action: "send", text: "FIX" } })] }), "fix"],
    ["FIX를 SUPERVISOR에게 보고", tower({ landingQueue: [q({ fix: { action: "supervisor", why: "repeat" } })] }), "fix"],
    ["READBACK 늦음", tower({ clearances: { pending: ["C-1"], overdue: ["C-1"] } }), "overdue-clearance"],
    ["충돌에 CLEARANCE가 아직 없음", tower({}, { conflicts: [{ stand: "s", sessions: ["A", "B"] }] }), "conflict"],
  ];
  for (const [name, brief, why] of cases) {
    const a = actionable("tower", { brief });
    assert.equal(a.act, true, name);
    assert.ok(a.reasons.includes(why), `${name}: ${a.reasons}`);
  }
});

test("TOWER: 할 일이 없는 CLEARED(MCC·SUPERVISOR 착륙, GROUND STOP, 슬롯, 이미 LAND를 낸 것, 이미 보낸 GO AROUND)는 조용하다", () => {
  const quiet = [
    q({ landing: "CLEARED", landBy: "mcc" }),
    q({ landing: "CLEARED", landBy: "supervisor" }),
    q({ landing: "CLEARED", landBy: "holder", groundStop: true }),
    q({ landing: "CLEARED", landBy: "holder", slotHold: true }),
    q({ landing: "CLEARED", landBy: "holder", landClearance: { id: "C-9", readBack: false } }),
    q({ goAround: { action: "sent" } }),
    q({ info: { action: "sent", text: "t" } }), // 이미 알렸다
    q({ info: { action: "log", text: "t" } }), // STAND를 쥔 세션이 없어 ATC LOG에만(매 바퀴 같다)
    q({ fix: { action: "sent", text: "t" } }),
    q({ info: null, fix: null, goAround: null }),
  ];
  for (const e of quiet) assert.equal(actionable("tower", { brief: tower({ landingQueue: [e] }) }).act, false, JSON.stringify(e));
  // 충돌이 있어도 이미 READBACK 대기 CLEARANCE가 있으면 새로 보내지 않는다
  assert.equal(actionable("tower", { brief: tower({ clearances: { pending: ["C-1"], overdue: [] } }, { conflicts: [{ stand: "s", sessions: ["A", "B"] }] }) }).act, false);
});

test("TOWER: 브리핑이 이상한 모양이면 할 일(조용하다고 잘못 말하지 않는다)", () => {
  for (const b of [null, undefined, "x", {}, { events: "no" }]) assert.deepEqual(actionable("tower", { brief: b }), { act: true, reasons: ["bad-brief"], info: 0 });
});

test("MCC: 검사·착륙·RTS가 필요하면 할 일, 모두 처리됐으면 조용하다", () => {
  const pull = (o: Record<string, unknown>) => ({ pr: 1, head: "a", error: false, tier: "auto", inspection: true, blocks: [], landable: false, ...o });
  const rts = { due: false, why: "서비스가 최신" };
  assert.equal(actionable("mcc", { queue: { mode: "land+rts", pulls: [pull({})], rts } }).act, false);
  assert.equal(actionable("mcc", { queue: { pulls: [], rts } }).act, false);
  assert.deepEqual(actionable("mcc", { queue: { pulls: [pull({ inspection: false })], rts } }).reasons, ["inspect"]);
  assert.deepEqual(actionable("mcc", { queue: { pulls: [pull({ landable: true })], rts } }).reasons, ["land"]);
  assert.deepEqual(actionable("mcc", { queue: { pulls: [], rts: { due: true, why: "x" } } }).reasons, ["rts"]);
  assert.equal(actionable("mcc", { queue: { pulls: [pull({ inspection: false, error: true })], rts } }).act, false); // 읽지 못한 PR은 할 수 있는 일이 없다
  assert.deepEqual(actionable("mcc", { queue: null }), { act: true, reasons: ["bad-brief"], info: 0 });
});

const occQuiet = () => ({
  dispatch: { mode: "on", open: [], held: [], inFlight: [], overdue: [], arrivalCandidates: [] },
  crewChange: { mode: "on", approved: [], overdue: [] },
  schedule: { mode: "on", open: [], inProgress: [], candidates: { classify: [], prioritize: [], close: [], tail: [], waypoint: [] }, waypointGaps: [], slips: [], routesWithoutWaypoints: [] },
  following: { items: [] },
});
const NOW = Date.parse("2026-10-01T06:00:00Z");
const OCC_SEEN = new Set(occKeysOf(occQuiet(), NOW)); // 오늘의 NETWORK 점검 key는 이미 본 것으로
test("OCC: 비어 있으면 조용하고, 목록마다 할 일이 생기면 act", () => {
  assert.equal(actionable("occ", occQuiet(), OCC_SEEN, NOW).act, false);
  const mk = (f: (b: ReturnType<typeof occQuiet>) => void) => {
    const b = occQuiet();
    f(b);
    return actionable("occ", b, OCC_SEEN, NOW);
  };
  assert.deepEqual(mk((b) => ((b.dispatch.open as unknown[]) = [{ id: "D-1", settled: true }])).reasons, ["needs-note"]);
  assert.deepEqual(mk((b) => ((b.dispatch.inFlight as unknown[]) = [{ id: "D-2", status: "approved" }])).reasons, ["send-plan"]);
  assert.deepEqual(mk((b) => ((b.dispatch.inFlight as unknown[]) = [{ id: "D-3", status: "readback" }])).reasons, []); // 이미 보낸 것
  assert.deepEqual(mk((b) => ((b.dispatch.overdue as unknown[]) = ["D-4"])).reasons, ["overdue"]);
  assert.deepEqual(mk((b) => ((b.crewChange.approved as unknown[]) = [{ id: "CC-1" }])).reasons, ["crew-change"]);
  assert.deepEqual(mk((b) => ((b.schedule.candidates.classify as unknown[]) = ["ATC-1"])).reasons, ["schedule-candidates"]);
  assert.deepEqual(mk((b) => ((b.schedule.slips as unknown[]) = [{ key: "ATC-2", fresh: true }])).reasons, ["slips"]);
  assert.deepEqual(mk((b) => ((b.following.items as unknown[]) = [{ issues: [{ key: "ATC-3", fresh: true }] }])).reasons, ["following"]);
  assert.equal(mk((b) => ((b.following.items as unknown[]) = [{ issues: [{ key: "ATC-3", fresh: false }] }])).act, false); // 이미 본 것
});

test("CROSSCHECK·REVIEW: 대기 중인 것이 있으면 act", () => {
  assert.equal(actionable("crosscheck", { dispatch: { crosscheck: { pending: [] } }, schedule: { crosscheck: { pending: [] } } }).act, false);
  assert.deepEqual(actionable("crosscheck", { dispatch: { crosscheck: { pending: [{ id: "D-1" }] } }, schedule: { crosscheck: { pending: [{ id: "S-1" }] } } }).reasons, ["dispatch", "schedule"]);
  assert.equal(actionable("review", { reviews: { pending: [], excluded: [], recent: [] } }).act, false);
  assert.deepEqual(actionable("review", { reviews: { pending: [{ pr: "atc#1", head: "a" }] } }), { act: true, reasons: ["pending"], info: 0 });
});

test("GET /api/tick/:role: 판정과 브리핑을 주고, 모르는 역할은 404, 오류는 act: true", async () => {
  const app = new Hono();
  mountTick(app, { get: async () => tower({ events: [{ id: 1, kind: "landing.cleared" }] }) });
  const r = await (await app.request("/api/tick/tower")).json();
  assert.equal(r.act, true);
  assert.deepEqual(r.reasons, ["event:landing.cleared"]);
  assert.equal(r.brief.cursor, "42"); // 세션이 ack할 cursor가 브리핑에 그대로 있다
  assert.equal((await app.request("/api/tick/nobody")).status, 404);
  const bad = new Hono();
  mountTick(bad, {
    get: async () => {
      throw new Error("브리핑 실패");
    },
  });
  const e = await (await bad.request("/api/tick/tower")).json();
  assert.equal(e.act, true);
  assert.deepEqual(e.reasons, ["error"]);
  // 다섯 역할 모두 라우트가 있다
  for (const role of ROLES) assert.notEqual((await app.request(`/api/tick/${role}`)).status, 404);
});

test("tower: 아직 안 보낸 SUPERVISOR RELAY가 있으면 할 일이다(ATC-271)", () => {
  const r = actionable("tower", { brief: tower({ relays: [{ id: "R-0001", to: "TEAM_G", type: "INFO", text: "hi" }] }) });
  assert.deepEqual([r.act, r.reasons], [true, ["relay"]]);
  assert.equal(actionable("tower", { brief: tower({ relays: [] }) }).act, false);
});
