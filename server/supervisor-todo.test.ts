import assert from "node:assert/strict";
import test from "node:test";
import { closeManualOf } from "./close-manual.ts";
import type { EffectVerdict } from "./effect-check.ts";
import { classify } from "./leaks.ts";
import type { ScheduleOp } from "./schedule.ts";
import { queueGroupOf, queueOrderOf, type QueueInput, type QueueItem, supervisorQueueOf } from "./supervisor-queue.ts";

// HOME의 한 목록(ATC-454, S1a): ALERT·STUCK·EFFECT·CLOSE 줄, 같은 사실은 한 번, primary, 한 순서
const NOW = Date.parse("2026-10-03T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const empty = (): QueueInput => ({ proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 3 });
const alert = (key: string, level: "warning" | "caution" | "advisory", dest: "alerts" | "queue" | "log", o: Record<string, unknown> = {}) =>
  ({ key, level, dest, group: "alert", aircraft: null, flight: null, text: `text ${key}`, next: "look", link: "#fleet", since: ago(5), ...o }) as NonNullable<QueueInput["alerts"]>[number];
const stuckRow = (key: string, o: Record<string, unknown> = {}) =>
  ({ key, finished: false, stuck: { stage: "sent", code: "sent-no-readback", text: `stuck ${key}`, since: ago(30) }, next: null, proposalInfo: null, ...o }) as never;
const verdict = (flight: string, v: EffectVerdict["verdict"], wrong = false): EffectVerdict =>
  ({ flight, release: null, at: ago(60), deployedAt: ago(600), metric: "leak:PROPOSAL", direction: "down", windowDays: 3, before: 5, after: 6, verdict: v, reason: "r", wrong }) as EffectVerdict;
const proposal = (o: Record<string, unknown> = {}) => ({ id: "D-1", kind: "ASSIGN", status: "proposed", flight: "ATC-1", aircraftName: "TEAM_A", holdAt: null, statusAt: ago(10), ...o }) as QueueInput["proposals"][number];

test("ALERT: only WARNING and CAUTION the SUPERVISOR can act on (dest alerts); queue-bound, log, advisory and follow|stuck stay out", () => {
  const q = supervisorQueueOf(
    { ...empty(), alerts: [alert("alert|a", "warning", "alerts"), alert("alert|b", "caution", "alerts"), alert("follow|stuck|ATC-1|x", "caution", "alerts"), alert("pending|proposal|D-1", "caution", "queue"), alert("rts|x", "warning", "log"), alert("alert|c", "advisory", "alerts")] },
    NOW,
  );
  assert.deepEqual(q.map((i) => `${i.kind}:${i.key}`), ["ALERT:alert|a", "ALERT:alert|b"]);
  assert.equal(q[0]!.level, "warning");
  assert.deepEqual(q[0]!.primary, { action: "open", label: "열기", hash: "#fleet" });
  assert.equal(q[0]!.need, "look");
});

test("STUCK: unfinished stuck rows once each; a brake primary when the FLIGHT has a cancellable or recallable card", () => {
  const bundles = [{ rows: [stuckRow("ATC-1"), stuckRow("ATC-2", { stuck: null }), stuckRow("ATC-3", { finished: true })] }, { rows: [stuckRow("ATC-1"), stuckRow("ATC-4", { proposalInfo: { id: "D-4", status: "approved", aircraftName: "TEAM_A", departedStand: null, departedVia: null } }), stuckRow("ATC-5", { proposalInfo: { id: "D-5", status: "sent", aircraftName: "TEAM_B", departedStand: null, departedVia: null } })] }];
  const q = supervisorQueueOf({ ...empty(), follow: { bundles, dispatchMode: "approval" } }, NOW);
  assert.deepEqual(q.map((i) => i.key).sort(), ["ATC-1", "ATC-4", "ATC-5"]);
  const by = Object.fromEntries(q.map((i) => [i.key, i]));
  assert.equal(by["ATC-1"]!.primary.action, "open");
  assert.deepEqual(by["ATC-4"]!.primary, { action: "brake", label: "CANCEL" });
  assert.equal(by["ATC-5"]!.primary.label, "RECALL");
  assert.equal(by["ATC-4"]!.brake?.mode, "approval");
  assert.equal(by["ATC-1"]!.detail, "stuck ATC-1");
});

test("EFFECT: deployed FLIGHTs whose verdict is not improved or worse and not marked wrong", () => {
  const q = supervisorQueueOf({ ...empty(), effects: [verdict("ATC-1", "improved"), verdict("ATC-2", "not improved"), verdict("ATC-3", "worse"), verdict("ATC-4", "worse", true), verdict("ATC-5", "too little data")] }, NOW);
  assert.deepEqual(q.map((i) => i.key).sort(), ["ATC-2", "ATC-3"]);
  assert.equal(q.find((i) => i.key === "ATC-2")!.primary.hash, "#flight/ATC-2");
});

test("CLOSE: approved closes to set Done by hand, with the Linear URL as the primary link", () => {
  const closes = [{ id: "S-1", flight: "VOC-1", statusAt: ago(90), url: "https://linear.app/x/VOC-1", pr: { repo: "o/vocado_nextjs", number: 4, url: "https://github.com/o/vocado_nextjs/pull/4" } }];
  const [i] = supervisorQueueOf({ ...empty(), closes }, NOW);
  assert.equal(i!.kind, "CLOSE");
  assert.equal(i!.primary.url, "https://linear.app/x/VOC-1");
  assert.match(i!.detail ?? "", /vocado_nextjs#4/);
  assert.doesNotMatch(i!.title, /Linear|PR /); // atc 말만
});

test("closeManualOf: approved, and agreed within 7 days, while the issue is still open", () => {
  const op = (id: string, status: string, ageDays: number, flight: string) => ({ id, kind: "CLOSE", status, statusAt: new Date(NOW - ageDays * 86_400_000).toISOString(), flight }) as unknown as ScheduleOp;
  const ops = [op("S-1", "approved", 10, "A-1"), op("S-2", "agreed", 3, "A-2"), op("S-3", "agreed", 9, "A-3"), op("S-4", "approved", 1, "A-4"), op("S-5", "draft", 1, "A-5")];
  const tickets = [{ key: "A-1", stateType: "started" }, { key: "A-2", stateType: "started" }, { key: "A-3", stateType: "started" }, { key: "A-4", stateType: "completed" }, { key: "A-5", stateType: "started" }];
  assert.deepEqual(closeManualOf(ops, tickets, NOW).map((x) => x.id), ["S-1", "S-2"]);
});

test("no fact twice: a FLIGHT that already has a queue row gets no ALERT or STUCK line", () => {
  const q = supervisorQueueOf(
    {
      ...empty(),
      proposals: [proposal({ id: "D-1", flight: "ATC-1" })],
      pulls: [{ repo: "/x/atc", number: 7, head: "abc", draft: false, landing: "CLEARED", humanCheck: null, ticketKey: "ATC-7", landBy: "supervisor" } as QueueInput["pulls"][number]],
      alerts: [alert("alert|a", "warning", "alerts", { flight: "ATC-1" }), alert("alert|b", "caution", "alerts", { flight: "ATC-9" }), alert("alert|c", "caution", "alerts", { flight: "ATC-7" })],
      follow: { bundles: [{ rows: [stuckRow("ATC-1"), stuckRow("ATC-7"), stuckRow("ATC-8")] }], dispatchMode: "approval" },
    },
    NOW,
  );
  assert.deepEqual(q.filter((i) => i.kind === "ALERT" || i.kind === "STUCK").map((i) => `${i.kind}:${i.key}`).sort(), ["ALERT:alert|b", "STUCK:ATC-8"]);
});

test("every item carries a primary: inline approve for the decision cards, open for the rest", () => {
  const q = supervisorQueueOf(
    {
      ...empty(),
      proposals: [proposal()],
      schedule: { mode: "approval", ops: [{ id: "S-9", kind: "TAIL", flight: "ATC-2", status: "draft", statusAt: ago(5) }] },
      fleetPlan: [{ id: "FP-1", kind: "PARK", aircraft: "TEAM_A", status: "open", at: ago(5), stale: false }] as unknown as QueueInput["fleetPlan"],
      update: { kind: "available", deployed: "aaaaaaa", main: "bbbbbbb", mainCi: "ok", at: ago(2) },
      backlog: [{ key: "ATC-30", by: "DUTY", at: ago(7) }],
    },
    NOW,
  );
  assert.ok(q.length >= 5 && q.every((i) => i.primary && i.primary.label));
  assert.deepEqual(q.filter((i) => i.primary.action === "approve").map((i) => i.primary.op).sort(), ["fleet-plan", "proposal", "schedule", "update"]);
  assert.equal(q.find((i) => i.kind === "BACKLOG")!.primary.hash, "#release");
});

const it = (kind: QueueItem["kind"], key: string, since: string | null, level?: "warning" | "caution"): QueueItem => ({ kind, key, since, title: key, hash: "#x", primary: { action: "open", label: "x" }, ...(level ? { level } : {}) });

test("order: WARNING first, then what holds a team (PROPOSAL, STUCK, NEEDS YOU, GO), then the rest; oldest wait first in each group; no since goes last", () => {
  const items = [
    it("BACKLOG", "b-old", ago(500)),
    it("PROPOSAL", "p-new", ago(5)),
    it("ALERT", "caution", ago(900), "caution"),
    it("STUCK", "s-old", ago(100)),
    it("ALERT", "warn-new", ago(1), "warning"),
    it("ALERT", "warn-old", ago(50), "warning"),
    it("GO", "g-none", null),
    it("NEEDS YOU", "n-mid", ago(40)),
    it("UPDATE", "u-none", null),
    it("EFFECT", "e", ago(30)),
  ];
  const out = queueOrderOf(items).map((i) => i.key);
  assert.deepEqual(out, ["warn-old", "warn-new", "s-old", "n-mid", "p-new", "g-none", "caution", "b-old", "e", "u-none"]);
  assert.equal(queueGroupOf(it("ALERT", "c", null, "caution")), 2);
  assert.equal(queueGroupOf(it("HUMAN CHECK", "h", null)), 2);
});

test("order is stable for equal waits (kind, then key) and does not change the input", () => {
  const items = [it("GO", "b", ago(5)), it("GO", "a", ago(5)), it("PROPOSAL", "z", ago(5))];
  const copy = [...items];
  assert.deepEqual(queueOrderOf(items).map((i) => i.key), ["z", "a", "b"]);
  assert.deepEqual(items, copy);
});

test("leaks: the four new kinds are signals, not human steps", () => {
  for (const kind of ["ALERT", "STUCK", "EFFECT", "CLOSE"] as const) {
    const v = classify({ ...it(kind, "k", null), flight: null } as never);
    assert.equal(v.leak, false);
  }
});
