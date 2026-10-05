import assert from "node:assert/strict";
import test from "node:test";
import { type QueueInput, supervisorQueueOf } from "./supervisor-queue.ts";

// ATC-540: 손으로 전할 글이 쓸모없어지면 UNDELIVERED 줄이 스스로 빠진다
const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const DAY = 24 * 60;

const base = (): QueueInput => ({ proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 3, githubKnown: true, tickets: [{ key: "ATC-9", stateType: "started" }] });
const rows = (inp: QueueInput) => supervisorQueueOf(inp, NOW).filter((i) => i.kind === "UNDELIVERED");
const pr = (number: number, ticketKey = "ATC-9") => ({ repo: "/x/atc", number, head: "abc", draft: false, landing: "APPROACH", humanCheck: null, ticketKey, landBy: "mcc" }) as QueueInput["pulls"][number];
const clr = (o: Partial<NonNullable<QueueInput["clearances"]>[number]> = {}): NonNullable<QueueInput["clearances"]>[number] => ({
  id: "C-0001", toName: "TEAM_A", type: "GO AROUND", text: "GO AROUND PR #7", at: ago(30), flight: "ATC-9", undeliverableAt: ago(20), cancelledAt: ago(20), undeliverableReason: "no session", undeliverableCause: "absent", handAt: null, ...o,
});
const rel = (o: Partial<NonNullable<QueueInput["relays"]>[number]> = {}): NonNullable<QueueInput["relays"]>[number] => ({
  id: "R-0001", to: "TEAM_A", kind: "info", text: "status please", status: "undeliverable", statusAt: ago(20), at: ago(30), flight: "ATC-9", reason: "no session", ...o,
});

test("fresh undeliverable messages to a live FLIGHT still give a row", () => {
  assert.equal(rows({ ...base(), pulls: [pr(7)], clearances: [clr()] }).length, 1);
  assert.equal(rows({ ...base(), relays: [rel()] }).length, 1);
});

test("a canceled (after delivery failed) or answered clearance gives no row", () => {
  assert.equal(rows({ ...base(), pulls: [pr(7)], clearances: [clr({ cancelledAt: ago(5) })] }).length, 0);
  assert.equal(rows({ ...base(), pulls: [pr(7)], clearances: [clr({ readbackAt: ago(5) })] }).length, 0);
  assert.equal(rows({ ...base(), pulls: [pr(7)], clearances: [clr({ unableAt: ago(5) })] }).length, 0);
});

test("a clearance whose PR is merged or closed gives no row", () => {
  assert.equal(rows({ ...base(), pulls: [pr(8)], clearances: [clr()] }).length, 0); // #7 is not open anymore
  // a GO AROUND with no number in the text: its FLIGHT has no open PR left
  assert.equal(rows({ ...base(), pulls: [], clearances: [clr({ text: "merge main" })] }).length, 0);
  // GitHub not read: do not guess
  assert.equal(rows({ ...base(), githubKnown: false, pulls: [], clearances: [clr()] }).length, 1);
});

test("a RELAY older than 3 days gives no row, a younger one does", () => {
  assert.equal(rows({ ...base(), relays: [rel({ statusAt: ago(3 * DAY + 1) })] }).length, 0);
  assert.equal(rows({ ...base(), relays: [rel({ statusAt: ago(3 * DAY - 60) })] }).length, 1);
});

test("a RELAY or clearance whose FLIGHT is Done or Canceled gives no row", () => {
  for (const stateType of ["completed", "canceled"]) {
    const tickets = [{ key: "ATC-9", stateType }];
    assert.equal(rows({ ...base(), tickets, relays: [rel()] }).length, 0);
    assert.equal(rows({ ...base(), tickets, pulls: [pr(7)], clearances: [clr()] }).length, 0);
  }
});

test("a newer delivered message of the same type for the same FLIGHT closes the row", () => {
  assert.equal(rows({ ...base(), relays: [rel(), rel({ id: "R-0002", status: "delivered", at: ago(10) })] }).length, 0);
  assert.equal(rows({ ...base(), relays: [rel(), rel({ id: "R-0002", kind: "instruction", status: "delivered", at: ago(10) })] }).length, 1); // other kind
  const p = { ...base(), pulls: [pr(7)] };
  assert.equal(rows({ ...p, clearances: [clr(), clr({ id: "C-0002", at: ago(10), undeliverableAt: null, cancelledAt: null })] }).length, 0);
});

test("a FLIGHT PLAN row goes away when its FLIGHT is Done or a newer plan was sent", () => {
  const prop = (o: Record<string, unknown> = {}) => ({ id: "D-0001", kind: "ASSIGN", status: "approved", flight: "ATC-9", aircraftName: "TEAM_A", holdAt: null, statusAt: ago(20), awaitSupervisor: undefined, undelivered: { at: ago(20), reason: "no session", n: 1, cause: "absent" }, ...o }) as QueueInput["proposals"][number];
  assert.equal(rows({ ...base(), proposals: [prop()] }).length, 1);
  assert.equal(rows({ ...base(), tickets: [{ key: "ATC-9", stateType: "completed" }], proposals: [prop()] }).length, 0);
  assert.equal(rows({ ...base(), proposals: [prop(), prop({ id: "D-0002", status: "sent", undelivered: undefined, statusAt: ago(5) })] }).length, 0);
});
