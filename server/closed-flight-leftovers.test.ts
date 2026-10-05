import assert from "node:assert/strict";
import test from "node:test";
import { closedFlightStandsOf, removeCommandOf } from "./cleanup-stands.ts";
import { followingOf, type FollowInput } from "./following.ts";
import type { Ticket } from "./model.ts";
import { orphansOf, type OrphanInput } from "./orphan-flight.ts";
import type { Proposal } from "./proposals.ts";
import { type QueueInput, supervisorQueueOf } from "./supervisor-queue.ts";
import { type AlertsInput, CLEANUP_KEY, supervisorAlertsOf } from "./supervisor-alerts.ts";

// ATC-543: 닫힌 FLIGHT는 남은 흔적으로 알리지 않는다. 남은 STAND는 정리 줄에, 쓸모없는 DECISION 카드는 큐에서 빠진다
const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const MIN = 60_000;
const ago = (min: number) => new Date(NOW - min * MIN).toISOString();
const STAND = "/repo/.claude/worktrees/atc-9-x";
const REPO = "/repo";

const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({ key, title: key, state: "In Progress", stateType: "started", stateColor: null, priority: 2, url: "", updatedAt: ago(30), project: "p", labels: ["type:BUILD", "wake:M"], createdAt: ago(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null, ...over }) as Ticket;
const done = (key: string) => ticket(key, { state: "Done", stateType: "completed" });
const canceled = (key: string) => ticket(key, { state: "Canceled", stateType: "canceled" });
const departed = (flight: string): Proposal =>
  ({ id: "D-1", at: ago(2000), kind: "ASSIGN", flight, aircraft: "b", aircraftName: "TEAM_B", airport: "A", score: 1, factors: [], status: "departed", decidedAt: null, statusAt: ago(10), timeline: { accepted: ago(500), departed: ago(450) }, reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: STAND, crosscheck: null }) as Proposal;

const follow = (tickets: Ticket[]): FollowInput => ({ proposals: [departed("ATC-9")], tickets, workspaces: [{ path: STAND, ticketKey: "ATC-9" }], pulls: [], logbook: [], departures: [], now: NOW });
const codes = (tickets: Ticket[]) => followingOf(follow(tickets)).flatMap((f) => f.issues.map((i) => i.code));

test("a Done or Canceled FLIGHT with a STAND and no PR gives no no-pr (nor review-no-pr)", () => {
  assert.ok(codes([ticket("ATC-9")]).includes("no-pr")); // an open FLIGHT keeps its line
  assert.deepEqual(codes([done("ATC-9")]), []);
  assert.deepEqual(codes([canceled("ATC-9")]), []);
});

test("a closed FLIGHT has no no-arrival, no-departure or stranded line", () => {
  const input = (t: Ticket): FollowInput => ({ ...follow([t]), stranded: [{ flight: "ATC-9", number: 5, title: "x", url: "u", merged: ago(60), mergedAt: ago(60) } as never] });
  assert.deepEqual(followingOf(input(done("ATC-9"))), []);
  assert.ok(followingOf(input(ticket("ATC-9"))).flatMap((f) => f.issues.map((i) => i.code)).includes("stranded")); // open: kept
});

test("a Canceled FLIGHT gives no ORPHAN FLIGHT, a started one does", () => {
  const sess = { id: "old", name: "TEAM_B", status: "dead", startedAt: ago(900), lastActiveAt: ago(300) };
  const base = (t: Ticket): OrphanInput => ({ now: NOW, sessions: [sess], tickets: [t], proposals: [departed("ATC-9") as never], departures: [], workspaces: [{ path: STAND, ticketKey: "ATC-9" }], claims: [], landed: new Set<string>(), owned: new Set<string>() }) as unknown as OrphanInput;
  assert.equal(orphansOf(base(ticket("ATC-9"))).length, 1);
  assert.equal(orphansOf(base(canceled("ATC-9"))).length, 0);
  assert.equal(orphansOf(base(done("ATC-9"))).length, 0);
});

const ws = (over: Record<string, unknown> = {}) => ({ path: STAND, name: "atc-9-x", repo: REPO, isMain: false, ticketKey: "ATC-9", dirty: 0, unpushed: 0, ...over });
const alertsIn = (over: Partial<AlertsInput> = {}): AlertsInput => ({ sessions: [], alerts: [], workspaces: [ws()], tickets: [done("ATC-9")], following: [], proposals: [], pulls: [], rts: null, heldStands: new Set<string>(), ...over });

test("a clean leftover STAND of a closed FLIGHT is on the cleanup line with the remove command", () => {
  const line = supervisorAlertsOf(alertsIn()).find((a) => a.key === CLEANUP_KEY)!;
  assert.ok(line);
  assert.equal(line.cleanup?.[0]?.command, `git -C '/repo' worktree remove '${STAND}'`);
  assert.match(line.next, /변경 0 · 미푸시 0 → git -C '\/repo' worktree remove/);
  assert.match(line.text, /닫힌 FLIGHT의 STAND 1곳/);
});

test("a dirty or unpushed leftover STAND gets no command and says what would be lost", () => {
  for (const [over, lost] of [[{ dirty: 3 }, /변경 3개/], [{ unpushed: 2 }, /커밋 2개/], [{ dirty: null }, /변경 수를 모름/]] as const) {
    const line = supervisorAlertsOf(alertsIn({ workspaces: [ws(over)] })).find((a) => a.key === CLEANUP_KEY)!;
    assert.equal(line.cleanup?.[0]?.command, null);
    assert.match(line.next, lost);
    assert.doesNotMatch(line.next, /worktree remove/);
  }
  assert.equal(removeCommandOf({ path: STAND, dirty: 0, unpushed: 0 }).command, null); // checkout unknown
});

test("an open FLIGHT's STAND, a held STAND and the main checkout are not leftovers", () => {
  const find = (x: Partial<AlertsInput>) => supervisorAlertsOf(alertsIn(x)).some((a) => a.key === CLEANUP_KEY);
  assert.equal(find({ tickets: [ticket("ATC-9")] }), false);
  assert.equal(find({ heldStands: new Set([STAND]) }), false);
  assert.equal(find({ workspaces: [ws({ isMain: true })] }), false);
  assert.deepEqual(closedFlightStandsOf({ workspaces: [ws()], tickets: [done("ATC-9")], held: new Set() }).map((s) => s.path), [STAND]);
});

const qin = (over: Partial<QueueInput> = {}): QueueInput => ({ proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 3, githubKnown: true, tickets: [ticket("ATC-9")], ...over });
const decision = (over: Record<string, unknown> = {}) => ({ id: "DC-0001", key: "tower|ATC-9|merge", role: "tower", at: ago(10), ask: "Merge ATC-9?", options: ["yes", "no"], pr: null, status: "open", ...over }) as NonNullable<QueueInput["decisions"]>[number];
const decisions = (inp: QueueInput) => supervisorQueueOf(inp, NOW).filter((i) => i.kind === "DECISION");

test("a DECISION on a Done FLIGHT or a merged PR gives no queue row; an open one keeps it", () => {
  assert.equal(decisions(qin({ decisions: [decision()] })).length, 1);
  assert.equal(decisions(qin({ tickets: [done("ATC-9")], decisions: [decision()] })).length, 0);
  assert.equal(decisions(qin({ tickets: [canceled("ATC-9")], decisions: [decision()] })).length, 0);
  const open = { repo: "/x", number: 7, head: "a", draft: false, landing: "APPROACH", humanCheck: null, ticketKey: "ATC-9", landBy: "mcc" } as QueueInput["pulls"][number];
  const withPr = decision({ pr: { number: 7, head: "a" } });
  assert.equal(decisions(qin({ pulls: [open], decisions: [withPr] })).length, 1);
  assert.equal(decisions(qin({ pulls: [], decisions: [withPr] })).length, 0); // PR merged or closed
  assert.equal(decisions(qin({ githubKnown: false, pulls: [], decisions: [withPr] })).length, 1); // GitHub not read: do not guess
});
