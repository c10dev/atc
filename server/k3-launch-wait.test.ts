import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutoLine } from "./auto-approve.ts";
import { type AutoDeps, type AutoIO, runK3LaunchRetry } from "./auto-approve-run.ts";
import { approveLaunch, launchMissingWhy, launchViewOf } from "./dispatch-launch.ts";
import { DEFAULT_DISPATCH_CONFIG } from "./dispatch.ts";
import { k3CheckOf, k3LaunchWaitOf, K3_LAUNCH_WAIT_WHY } from "./k3-allow.ts";
import { k3WaitClear, k3WaitSet, k3LaunchWaits } from "./k3-launch-wait.ts";
import { k3MisfiresOf } from "./k3-hold.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { fold, type Op } from "./proposals.ts";
import { type ReleaseChannel, type ReleaseView, releaseHashOf } from "./release.ts";

// ATC-506: 승인된 launch 카드는 LAUNCH 직전에 K3 entries를 다시 확인하고, 못 만들면 기다린다
const DECLARED = "## Goal\nx\n\n## K effects\n\n* K3[Security Weaken]: CROSSCHECK condition in the auto approve | files: server/auto-approve-run.ts\n";
const PLAIN = "## Goal\nx\n\n## K effects\n\n* None\n";
const ticket = (key: string, body: string): Ticket => {
  const k = k3CheckOf(body);
  return { key, releaseHash: releaseHashOf(body), ...(k.declared.length ? { k3: k.declared } : {}), ...(k.check ? { k3Check: k.check } : {}) } as unknown as Ticket;
};
const releasedBy = (t: Ticket, channel: ReleaseChannel): ReleaseView => ({ armedAt: "2026-10-02T00:00:00Z", records: { [t.key]: { flight: t.key, channel, at: "2026-10-02T01:00:00Z", hash: t.releaseHash! } } });
const none: ReleaseView = { armedAt: "2026-10-02T00:00:00Z", records: {} };
const CAP = { launched: 0, pending: 0, max: 6, full: false, holders: "" } as never;
const WAIT = "K3 entries not ready — waiting";

test("K3 FLIGHT with empty releases waits", () => {
  const t = ticket("ATC-1", DECLARED);
  assert.ok(k3LaunchWaitOf({ tickets: [t], releases: none }, "ATC-1", "on")?.startsWith(K3_LAUNCH_WAIT_WHY));
});

test("the same FLIGHT with a screen release does not wait", () => {
  const t = ticket("ATC-1", DECLARED);
  assert.equal(k3LaunchWaitOf({ tickets: [t], releases: releasedBy(t, "screen") }, "ATC-1", "on"), null);
});

test("a changed body (hash) waits again", () => {
  const t = ticket("ATC-1", DECLARED);
  const edited = { ...t, releaseHash: releaseHashOf(DECLARED + "more\n") } as Ticket;
  assert.ok(k3LaunchWaitOf({ tickets: [edited], releases: releasedBy(t, "screen") }, "ATC-1", "on"));
});

test("a ticket missing from the snapshot waits (cannot tell)", () => {
  assert.ok(k3LaunchWaitOf({ tickets: [], releases: none }, "ATC-9", "on")?.includes("not in the snapshot"));
});

test("a FLIGHT without K3 effects launches as before", () => {
  assert.equal(k3LaunchWaitOf({ tickets: [ticket("ATC-2", PLAIN)], releases: none }, "ATC-2", "on"), null);
});

test("k3Hold off: no wait, even for a missing ticket", () => {
  assert.equal(k3LaunchWaitOf({ tickets: [ticket("ATC-1", DECLARED)], releases: none }, "ATC-1", "off"), null);
  assert.equal(k3LaunchWaitOf({ tickets: [], releases: none }, "ATC-9", "off"), null);
});

test("approveLaunch: a wait writes the approval only — no launch line, no supersede", async () => {
  const ops: Op[] = [];
  const r = await approveLaunch("D-0001", {
    live: false,
    cap: CAP,
    approve: { op: "approve", id: "D-0001", at: "2026-10-03T00:00:00Z" },
    append: (o) => void ops.push(...o),
    launch: async () => ({ ok: false, wait: WAIT }),
    now: () => "2026-10-03T00:00:01Z",
  });
  assert.deepEqual([r.ok, r.status, r.wait], [true, 200, WAIT]);
  assert.deepEqual(ops.map((o) => o.op), ["approve"]);
});

const base = (): Op[] => [
  { op: "create", id: "D-0001", at: "2026-10-03T00:00:00Z", kind: "ASSIGN", flight: "ATC-1", aircraft: null, aircraftName: "TEAM_K", airport: "ATCC", score: 1, factors: [], launch: true } as Op,
  { op: "approve", id: "D-0001", at: "2026-10-03T00:00:01Z" },
];

test("the card shows the wait reason; the timeout close names K3", () => {
  const p = fold(base());
  assert.equal(launchViewOf(p, CAP, new Map([["D-0001", WAIT]]))["D-0001"], WAIT);
  assert.ok(launchMissingWhy(30, WAIT).includes("K3"));
  assert.ok(!launchMissingWhy(30).includes("K3"));
});

const fakeIO = (ops: Op[], lines: AutoLine[]): AutoIO => ({
  cfg: () => ({ ...DEFAULT_DISPATCH_CONFIG, mode: "approval" }),
  proposals: () => fold(ops),
  scheduleOps: () => [],
  scheduleMode: () => "approval",
  lines: () => lines,
  addLine: (l) => void lines.push(l),
  appendOps: (o) => void ops.push(...o),
  approveSchedule: () => {},
  stamp: () => "2026-10-03T00:05:00Z",
});

test("retry: still not ready → nothing written; ready → launch line", async () => {
  const ops = base();
  const lines: AutoLine[] = [];
  const snap = { sessions: [] } as unknown as Snapshot;
  k3WaitSet("D-0001", WAIT);
  let ready = false;
  const deps: AutoDeps = { max: 6, launch: async () => (ready ? { ok: true, jobId: "j1" } : { ok: false, wait: WAIT }) };
  assert.deepEqual(await runK3LaunchRetry(snap, deps, fakeIO(ops, lines)), { launched: 0, waiting: 1 });
  assert.equal(ops.length, 2);
  assert.equal(lines.length, 0);
  ready = true;
  assert.deepEqual(await runK3LaunchRetry(snap, deps, fakeIO(ops, lines)), { launched: 1, waiting: 0 });
  assert.deepEqual(ops.slice(2).map((o) => o.op), ["launch"]);
  assert.equal(k3LaunchWaits().has("D-0001"), false);
});

test("retry: a card that is no longer approved drops out of the wait list", async () => {
  const ops = [...base(), { op: "supersede", id: "D-0001", at: "2026-10-03T00:02:00Z", reason: "x" } as Op];
  k3WaitSet("D-0001", "w");
  const deps: AutoDeps = { max: 6, launch: async () => assert.fail("must not launch") };
  await runK3LaunchRetry({ sessions: [] } as unknown as Snapshot, deps, fakeIO(ops, []));
  assert.equal(k3LaunchWaits().has("D-0001"), false);
  k3WaitClear("D-0001");
});

test("misfire counter carries the waits", () => {
  const r = k3MisfiresOf({ tickets: [], launches: [], denied: new Set(), waits: [{ flight: "ATC-1", id: "D-0001", t: "2026-10-03T00:00:00Z" }] });
  assert.equal(r.waits.length, 1);
});
