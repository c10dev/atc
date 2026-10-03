import assert from "node:assert/strict";
import test from "node:test";
import { type QueueInput, queueCountsOf, supervisorQueueOf, supervisorQueueView } from "./supervisor-queue.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const empty = (): QueueInput => ({
  proposals: [],
  schedule: { mode: "approval", ops: [] },
  fleetPlan: [],
  pulls: [],
  update: null,
  sessions: [],
  blockedMin: 3,
});

const proposal = (o: Partial<QueueInput["proposals"][number]> = {}): QueueInput["proposals"][number] => ({
  id: "D-0001", kind: "ASSIGN", status: "proposed", flight: "ATC1", aircraftName: "TEAM_A", holdAt: null, statusAt: ago(10), awaitSupervisor: undefined, ...o,
});
const pull = (o: Partial<QueueInput["pulls"][number]> = {}): QueueInput["pulls"][number] =>
  ({ repo: "/x/atc", number: 7, head: "abc1234def", draft: false, landing: "APPROACH", humanCheck: null, ticketKey: "ATC-7", landBy: "mcc", ...o }) as QueueInput["pulls"][number];

test("UNDELIVERED (ATC-353): the hand-delivery card shows at once, as before (no stage holds it back)", () => {
  const p = proposal({ id: "D-0001", status: "approved", aircraftName: "TEAM_A", undelivered: { at: ago(1), reason: "no live session", n: 1, cause: "absent" } });
  assert.equal(supervisorQueueOf({ ...empty(), proposals: [p] }, NOW).filter((i) => i.kind === "UNDELIVERED").length, 1);
});

test("empty input gives an empty queue and zero counts for every kind", () => {
  const v = supervisorQueueView(empty(), NOW);
  assert.equal(v.count, 0);
  assert.deepEqual(v.items, []);
  assert.equal(Object.keys(v.counts).length, 11);
  assert.ok(Object.values(v.counts).every((n) => n === 0));
});

test("PROPOSAL: only proposed and not held; judged, sent and held proposals stay out", () => {
  const q = supervisorQueueOf({
    ...empty(),
    proposals: [
      proposal({ id: "D-1" }),
      proposal({ id: "D-2", status: "agreed" }),
      proposal({ id: "D-3", status: "sent" }),
      proposal({ id: "D-4", holdAt: ago(5) }),
      proposal({ id: "D-5", kind: "RELEASE", aircraftName: null }),
    ],
  }, NOW);
  assert.deepEqual(q.map((i) => i.key).sort(), ["D-1", "D-5"]);
  assert.equal(q.find((i) => i.key === "D-1")!.title, "ASSIGN ATC1 → TEAM_A");
  assert.equal(q.find((i) => i.key === "D-5")!.title, "RELEASE ATC1");
  assert.ok(q.every((i) => i.hash === "#home"));
});

test("SCHEDULE: draft ops in approval mode only", () => {
  const ops = [
    { id: "S-1", kind: "TAIL", flight: "ATC2", status: "draft", statusAt: ago(3) },
    { id: "S-2", kind: "TAIL", flight: "ATC3", status: "approved", statusAt: ago(3) },
  ] as QueueInput["schedule"]["ops"];
  assert.deepEqual(supervisorQueueOf({ ...empty(), schedule: { mode: "approval", ops } }, NOW).map((i) => i.key), ["S-1"]);
  assert.deepEqual(supervisorQueueOf({ ...empty(), schedule: { mode: "shadow", ops } }, NOW), []);
});

test("SCHEDULE(ATC-378): 줄은 HOME을 가리키고, OCC의 근거 한 줄(240자까지)을 detail로 싣는다", () => {
  const long = "근거 ".repeat(200);
  const ops = [
    { id: "S-1", kind: "NEW", flight: null, status: "draft", statusAt: ago(3), reason: "중복 아님: 요청이 새 화면" },
    { id: "S-2", kind: "TAIL", flight: "ATC2", status: "draft", statusAt: ago(3), reason: long },
    { id: "S-3", kind: "TAIL", flight: "ATC3", status: "draft", statusAt: ago(3) },
  ] as QueueInput["schedule"]["ops"];
  const out = supervisorQueueOf({ ...empty(), schedule: { mode: "approval", ops } }, NOW);
  assert.deepEqual(out.map((i) => i.hash), ["#home", "#home", "#home"]);
  assert.equal(out[0].detail, "중복 아님: 요청이 새 화면");
  assert.equal(out[1].detail!.length, 240);
  assert.equal(out[2].detail, undefined, "근거가 없으면 칸도 없다");
});

test("FLEET PLAN: open and not stale", () => {
  const p = (id: string, o: object = {}) => ({ id, kind: "LAUNCH", aircraft: "TEAM_B", status: "open", at: ago(20), stale: false, ...o }) as QueueInput["fleetPlan"][number];
  const q = supervisorQueueOf({ ...empty(), fleetPlan: [p("F-1"), p("F-2", { stale: true }), p("F-3", { status: "executing" })] }, NOW);
  assert.deepEqual(q.map((i) => i.key), ["F-1"]);
  assert.equal(q[0].hash, "#fleet");
});

test("HUMAN CHECK: waiting PR that is not draft; done or none stays out", () => {
  const hc = (state: string) => ({ required: true, state, classes: ["CHOICE"] }) as never;
  const q = supervisorQueueOf({
    ...empty(),
    pulls: [pull({ number: 1, humanCheck: hc("pending") }), pull({ number: 2, humanCheck: hc("done") }), pull({ number: 3, humanCheck: hc("pending"), draft: true }), pull({ number: 4 })],
  }, NOW);
  assert.deepEqual(q.map((i) => [i.kind, i.key]), [["HUMAN CHECK", "atc#1@abc1234def"]]);
  assert.equal(q[0].title, "PR #1 ATC-7");
  assert.equal(q[0].since, null);
});

test("LANDING: CLEARED and the SUPERVISOR lands it; MCC or team landing, APPROACH and drafts stay out", () => {
  const q = supervisorQueueOf({
    ...empty(),
    pulls: [
      pull({ number: 1, landing: "CLEARED", landBy: "supervisor" }),
      pull({ number: 2, landing: "CLEARED", landBy: "mcc" }),
      pull({ number: 3, landing: "CLEARED", landBy: "holder" }),
      pull({ number: 4, landing: "APPROACH", landBy: "supervisor" }),
      pull({ number: 5, landing: "CLEARED", landBy: "supervisor", draft: true }),
    ],
  }, NOW);
  assert.deepEqual(q.map((i) => [i.kind, i.title]), [["LANDING", "PR #1 ATC-7"]]);
});

test("one PR can be both HUMAN CHECK and LANDING", () => {
  const q = supervisorQueueOf({ ...empty(), pulls: [pull({ landing: "CLEARED", landBy: "supervisor", humanCheck: { required: true, state: "pending", classes: ["DEVICE"] } as never })] }, NOW);
  assert.deepEqual(q.map((i) => i.kind), ["HUMAN CHECK", "LANDING"]);
});

test("UPDATE: only when available and main CI passed", () => {
  const u = (kind: string, mainCi: string) => ({ kind, deployed: "1111111aaaa", main: "2222222bbbb", mainCi, at: ago(1) }) as QueueInput["update"];
  const q = supervisorQueueOf({ ...empty(), update: u("available", "ok") }, NOW);
  assert.deepEqual(q.map((i) => [i.kind, i.key, i.title]), [["UPDATE", "2222222", "1111111 → 2222222"]]);
  assert.deepEqual(supervisorQueueOf({ ...empty(), update: u("available", "pending") }, NOW), []);
  assert.deepEqual(supervisorQueueOf({ ...empty(), update: u("current", "ok") }, NOW), []);
  assert.deepEqual(supervisorQueueOf({ ...empty(), update: u("running", "ok") }, NOW), []);
  assert.deepEqual(supervisorQueueOf({ ...empty(), update: null }, NOW), []);
});

test("NEEDS YOU: a blocked background job past blockedMin, and only then", () => {
  const s = (id: string, name: string, min: number, state = "blocked") =>
    ({ id, name, job: { state, since: ago(min), needs: "answer" }, lastActiveAt: ago(min) }) as never;
  const q = supervisorQueueOf({ ...empty(), sessions: [s("a", "TEAM_A", 5), s("b", "TEAM_B", 1), s("c", "TEAM_C", 9, "working")] }, NOW);
  assert.deepEqual(q.map((i) => [i.kind, i.key, i.title, i.hash]), [["NEEDS YOU", "a", "TEAM_A", "#fleet"]]);
});

test("GO: a CAPTAIN waits for the SUPERVISOR's go", () => {
  const q = supervisorQueueOf({ ...empty(), proposals: [proposal({ id: "D-9", status: "sent", awaitSupervisor: { at: ago(7), reason: "x" } })] }, NOW);
  assert.deepEqual(q.map((i) => [i.kind, i.key, i.title, i.since]), [["GO", "D-9", "ATC1 TEAM_A", ago(7)]]);
});

test("sorted oldest first; unknown since goes last; ties break by kind", () => {
  const q = supervisorQueueOf({
    ...empty(),
    proposals: [proposal({ id: "D-new", statusAt: ago(1) }), proposal({ id: "D-old", statusAt: ago(60) })],
    schedule: { mode: "approval", ops: [{ id: "S-mid", kind: "TAIL", flight: null, status: "draft", statusAt: ago(30) }] as never },
    pulls: [pull({ landing: "CLEARED", landBy: "supervisor" })],
  }, NOW);
  assert.deepEqual(q.map((i) => i.key), ["D-old", "S-mid", "D-new", "atc#7@abc1234def"]);
});

test("titles carry atc terms only, never a ticket or PR title", () => {
  const p = { ...pull({ landing: "CLEARED", landBy: "supervisor" }), title: "SECRET TICKET WORDS" } as never;
  assert.ok(!JSON.stringify(supervisorQueueOf({ ...empty(), pulls: [p] }, NOW)).includes("SECRET"));
});

test("view: count, per-kind counts and the timestamp", () => {
  const v = supervisorQueueView({ ...empty(), proposals: [proposal({ id: "D-1" }), proposal({ id: "D-2" })], pulls: [pull({ landing: "CLEARED", landBy: "supervisor" })] }, NOW);
  assert.equal(v.v, 1);
  assert.equal(v.at, new Date(NOW).toISOString());
  assert.equal(v.count, 3);
  assert.equal(v.counts.PROPOSAL, 2);
  assert.equal(v.counts.LANDING, 1);
  assert.equal(queueCountsOf(v.items).GO, 0);
});

test("auto dispatch (ATC-367): ASSIGN and launch cards stay off the queue, RELEASE still shows", () => {
  const inp = { ...empty(), proposals: [proposal({ id: "D-1" }), proposal({ id: "D-2", kind: "RELEASE", aircraftName: null })] };
  assert.deepEqual(supervisorQueueOf(inp, NOW).map((i) => i.key), ["D-1", "D-2"]);
  assert.deepEqual(supervisorQueueOf({ ...inp, autoDispatch: true }, NOW).map((i) => i.key), ["D-2"]);
});

test("BACKLOG(ATC-401): 쏘거나 버리지 않은 제안이 RELEASE 화면을 가리키는 줄로 선다. 오래 기다린 것이 먼저", () => {
  const items = supervisorQueueOf({ ...empty(), backlog: [{ key: "ATC-9", by: "SCHEDULE S-0004", at: ago(5) }, { key: "ATC-3", by: "DUTY REVIEW R-0007", at: ago(50) }] }, NOW);
  assert.deepEqual(
    items.map((i) => [i.kind, i.key, i.title, i.hash]),
    [["BACKLOG", "ATC-3", "ATC-3 ← DUTY REVIEW R-0007", "#release"], ["BACKLOG", "ATC-9", "ATC-9 ← SCHEDULE S-0004", "#release"]],
  );
  assert.equal(items[0]!.since, ago(50));
  assert.equal(queueCountsOf(items).BACKLOG, 2);
  assert.equal(supervisorQueueOf(empty(), NOW).filter((i) => i.kind === "BACKLOG").length, 0, "제안이 없으면 줄이 없다");
});
