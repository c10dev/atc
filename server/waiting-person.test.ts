import assert from "node:assert/strict";
import { test } from "node:test";
import { supervisorQueueOf, type QueueInput } from "./supervisor-queue.ts";
import { summaryOf, type SummaryInput } from "./supervisor-summary.ts";
import { needsYouOf, waitingOnPersonOf, type WaitInput, type WaitSession } from "./waiting-person.ts";

// 사람을 기다리는 세션의 정의 하나(ATC-374): SUPERVISOR QUEUE의 NEEDS YOU·GO와 SUMMARY의 needsYou가 같은 것을 읽는다
const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const blockedJob = (min: number) => ({ state: "blocked", detail: "d", needs: "need a decision", since: ago(min), tempo: "blocked" }) as never;
const sess = (id: string, name: string, over: Partial<WaitSession> = {}): WaitSession => ({ id, name, status: "idle", job: null, lastActiveAt: ago(500), ...over });
const waits = (over: Partial<WaitInput> = {}) => waitingOnPersonOf({ sessions: [], proposals: [], now: NOW, blockedMin: 3, ...over });

test("blocked(blockedMin 넘게)·pending(도구 승인)·go(CAPTAIN이 go를 기다림) 세 가지만, 팀 AIRCRAFT 이름과 함께", () => {
  const w = waits({
    sessions: [sess("a", "TEAM_A", { job: blockedJob(10), status: "idle" }), sess("b", "TEAM_B", { status: "busy", health: { code: "PENDING", since: ago(2) } }), sess("c", "TEAM_C", { job: blockedJob(1) }), sess("d", "TEAM_D", { status: "busy" })],
    proposals: [{ id: "D-1", flight: "ATC-1", aircraftName: "TEAM_E", awaitSupervisor: { at: ago(5), reason: "go?" } }, { id: "D-2", flight: "ATC-2", aircraftName: "TEAM_F", awaitSupervisor: undefined }],
  });
  assert.deepEqual(w.map((x) => [x.kind, x.key, x.aircraft]), [["blocked", "a", "TEAM_A"], ["pending", "b", "TEAM_B"], ["go", "D-1", "TEAM_E"]]);
  assert.deepEqual(needsYouOf(w), ["TEAM_A", "TEAM_B", "TEAM_E"]);
});

test("판정을 기다리는 DISPATCH 카드는 AIRCRAFT가 기다리는 것이 아니다: ASSIGN·RELEASE 모두 needsYou에 없다(자동 운항이 켜져 있든 꺼져 있든)", () => {
  const items = [{ key: "pending|proposal|D-9", level: "advisory", cue: "call", aircraft: "TEAM_B" }, { key: "follow|approve|D-8", level: "advisory", cue: "call", aircraft: "TEAM_C" }] as SummaryInput["items"];
  const s = summaryOf({ items, waiting: waits(), fuelAccounts: [], rts: null, working: { aircraft: 0, control: 0 }, at: ago(0) });
  assert.deepEqual(s.needsYou, []);
  assert.equal(s.pending.dispatch, 2); // 센 수로만 있다
});

test("관제 세션은 큐에는 오르지만 needsYou에는 없다(AIRCRAFT가 아니라서)", () => {
  const w = waits({ sessions: [sess("t", "TOWER", { job: blockedJob(9) }), sess("a", "TEAM_A", { job: blockedJob(9) })] });
  assert.deepEqual(w.map((x) => [x.name, x.aircraft]), [["TOWER", null], ["TEAM_A", "TEAM_A"]]);
  assert.deepEqual(needsYouOf(w), ["TEAM_A"]);
});

test("blocked이면서 PENDING인 세션은 한 번만, 죽은 세션의 PENDING은 없다, 같은 AIRCRAFT는 needsYou에 한 번", () => {
  const w = waits({
    sessions: [sess("a", "TEAM_A", { job: blockedJob(9), status: "busy", health: { code: "PENDING", since: ago(1) } }), sess("x", "TEAM_X", { status: "dead", health: { code: "PENDING", since: ago(1) } })],
    proposals: [{ id: "D-1", flight: "ATC-1", aircraftName: "TEAM_A", awaitSupervisor: { at: ago(2), reason: "r" } }],
  });
  assert.deepEqual(w.map((x) => x.kind), ["blocked", "go"]);
  assert.deepEqual(needsYouOf(w), ["TEAM_A"]);
});

test("큐와 요약이 어긋나지 않는다: 큐의 NEEDS YOU·GO 줄이 같은 목록이고, needsYou는 그 가운데 팀 AIRCRAFT다", () => {
  const sessions = [sess("a", "TEAM_A", { job: blockedJob(10) }), sess("t", "TOWER", { job: blockedJob(10) }), sess("b", "TEAM_B", { status: "busy", health: { code: "PENDING", since: ago(2) } })];
  const proposals = [
    { id: "D-1", kind: "ASSIGN", status: "sent", flight: "ATC-1", aircraftName: "TEAM_C", holdAt: null, statusAt: ago(30), awaitSupervisor: { at: ago(5), reason: "go?" }, undelivered: undefined },
    { id: "D-2", kind: "RELEASE", status: "proposed", flight: "ATC-2", aircraftName: null, holdAt: null, statusAt: ago(20), awaitSupervisor: undefined, undelivered: undefined },
  ];
  const q = supervisorQueueOf({ proposals, schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions, blockedMin: 3 } as unknown as QueueInput, NOW);
  const queueWait = q.filter((i) => i.kind === "NEEDS YOU" || i.kind === "GO").map((i) => `${i.kind === "GO" ? "go" : "wait"}|${i.key}`).sort();
  const w = waitingOnPersonOf({ sessions, proposals: proposals as never, now: NOW, blockedMin: 3 });
  assert.deepEqual(w.map((x) => `${x.kind === "go" ? "go" : "wait"}|${x.key}`).sort(), queueWait);
  assert.deepEqual(needsYouOf(w), ["TEAM_A", "TEAM_B", "TEAM_C"]); // TOWER와 RELEASE 카드는 없다
});
