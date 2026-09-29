import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { AircraftView } from "./fleet.ts";
import { fleetStatusOf } from "./fleet-status.ts";
import { type LiveSnapshot, liveViewOf, mergeLive } from "./fleet-live.ts";
import type { Health } from "./health.ts";
import { computeActuals } from "./logbook.ts";
import { DEFAULT_TEAM_PATTERN } from "./registration.ts";

// FLEET 라이브 부분(ATC-100): 스냅샷만으로 셈한다
const NOW = Date.parse("2026-09-29T06:00:00Z");
const session = (name: string, over: Record<string, unknown> = {}) =>
  ({ id: `s-${name}`, agent: "claude", name, status: "idle", pid: 1, cwd: "/w", startedAt: "2026-09-29T00:00:00Z", lastActiveAt: "2026-09-29T05:55:00Z", repo: null, workspacePath: null, ...over }) as LiveSnapshot["sessions"][number];
const snap = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  sessions: [],
  claims: [],
  workspaces: [{ path: "/w/atc-1", name: "atc-1", repo: "/r", isMain: false, branch: "claude/atc-1", head: "abcdef123", dirty: 0, lastCommitAt: null, ticketKey: "ATC-1" }],
  ...over,
});
const claim = (sessionId: string) => ({ sessionId, workspacePath: "/w/atc-1", since: "2026-09-29T05:00:00Z", lastAt: "2026-09-29T05:50:00Z", source: "hook", tool: null, state: "active", handedOffTo: null }) as LiveSnapshot["claims"][number];
const limit: Health = { code: "LIMIT", level: "alert", since: "2026-09-29T05:40:00Z", resetsAt: "2026-09-29T07:40:00Z", detail: "limit", next: "wait", holds: true };
const live = (s: LiveSnapshot, regs = ["TEAM_A"]) => liveViewOf(s, regs, DEFAULT_TEAM_PATTERN, () => null, NOW);

const view = (registration: string, over: Partial<AircraftView> = {}): AircraftView => ({
  registration,
  callsign: registration.replace("TEAM_", ""),
  status: "idle",
  base: "VCDO",
  complement: DEFAULT_FLEET.defaults.complement,
  complementIsDefault: true,
  ratings: ["UI"],
  ratingsIsDefault: true,
  routes: ["r1"],
  targets: { flightsPerWeek: 5 },
  note: "slow note",
  flying: [],
  flights: [],
  flyingSince: null,
  lastActiveAt: "2026-09-29T01:00:00Z",
  configuration: null,
  enteredAt: null,
  aog: null,
  retired: null,
  actuals: computeActuals([], registration, NOW),
  ...over,
});

test("busy → idle changes the status, and the last activity follows the session", () => {
  const busy = live(snap({ sessions: [session("TEAM_A", { status: "busy" })] })).get("TEAM_A")!;
  assert.equal(busy.status, "busy");
  const idle = live(snap({ sessions: [session("TEAM_A", { status: "idle", lastActiveAt: "2026-09-29T05:59:00Z" })] })).get("TEAM_A")!;
  assert.equal(idle.status, "idle");
  assert.equal(idle.lastActiveAt, "2026-09-29T05:59:00Z");
});

test("gaining and losing a FLYING FLIGHT (PARKED ↔ HOLDING)", () => {
  const s = session("TEAM_A");
  const parked = live(snap({ sessions: [s] })).get("TEAM_A")!;
  assert.deepEqual(parked.flying, []);
  assert.equal(fleetStatusOf({ retired: null, aog: null, ...parked }), "PARKED");
  const holding = live(snap({ sessions: [s], claims: [claim(s.id)], tickets: [{ key: "ATC-1", title: "one" } as never] })).get("TEAM_A")!;
  assert.deepEqual(holding.flying, ["ATC-1"]);
  assert.equal(holding.flights[0].title, "one");
  assert.equal(holding.flyingSince, "2026-09-29T05:00:00Z");
  assert.equal(fleetStatusOf({ retired: null, aog: null, ...holding }), "HOLDING");
  const lost = live(snap({ sessions: [s] })).get("TEAM_A")!;
  assert.deepEqual(lost.flying, []);
  assert.equal(lost.flyingSince, null);
});

test("a health code appears and disappears", () => {
  assert.equal(live(snap({ sessions: [session("TEAM_A")] })).get("TEAM_A")!.health, null);
  assert.equal(live(snap({ sessions: [session("TEAM_A", { health: limit })] })).get("TEAM_A")!.health?.code, "LIMIT");
  assert.equal(live(snap({ sessions: [session("TEAM_A", { health: null })] })).get("TEAM_A")!.health, null);
});

test("account hold reaches a sibling on the same ACCOUNT", () => {
  const s = snap({ sessions: [session("TEAM_A", { health: limit }), session("TEAM_B")] });
  const v = liveViewOf(s, ["TEAM_A", "TEAM_B"], DEFAULT_TEAM_PATTERN, () => "pro-2", NOW);
  assert.equal(v.get("TEAM_A")!.accountHold, null);
  assert.ok(v.get("TEAM_B")!.accountHold);
});

test("merge: live values override, slow values stay, a missing AIRCRAFT is NOT IN SERVICE", () => {
  const slow = [view("TEAM_A", { status: "idle" }), view("TEAM_B", { status: "busy", flying: ["ATC-9"], flights: [{ key: "ATC-9", title: null }] })];
  const s = snap({ sessions: [session("TEAM_A", { status: "busy", lastActiveAt: "2026-09-29T05:59:00Z", health: limit })] });
  const [a, b] = mergeLive(slow, s, DEFAULT_TEAM_PATTERN, NOW);
  assert.equal(a.status, "busy");
  assert.equal(a.lastActiveAt, "2026-09-29T05:59:00Z");
  assert.equal(a.health?.code, "LIMIT");
  assert.deepEqual([a.routes, a.targets, a.note, a.base], [["r1"], { flightsPerWeek: 5 }, "slow note", "VCDO"]);
  assert.equal(b.status, "absent");
  assert.deepEqual(b.flying, []);
  assert.equal(b.lastActiveAt, null);
  assert.equal(fleetStatusOf(b), "NOT IN SERVICE");
  assert.equal(b.note, "slow note");
});

test("merge matches a `Team A` session name to TEAM_A and ignores dead sessions", () => {
  const [a] = mergeLive([view("TEAM_A")], snap({ sessions: [session("Team A", { status: "busy" })] }), DEFAULT_TEAM_PATTERN, NOW);
  assert.equal(a.status, "busy");
  const [dead] = mergeLive([view("TEAM_A", { status: "busy" })], snap({ sessions: [session("TEAM_A", { status: "dead" })] }), DEFAULT_TEAM_PATTERN, NOW);
  assert.equal(dead.status, "absent");
});
