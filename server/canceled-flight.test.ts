import assert from "node:assert/strict";
import { test } from "node:test";
import { type ApplyAircraft, applyNowPlanOf } from "./apply-now.ts";
import { aircraftWithLivePrOf, canceledKeysOf, canceledPrsOf, liveFlightsOf, standHoldersOf } from "./canceled-flight.ts";
import { DEFAULT_FLEET } from "./crew.ts";
import type { AircraftView } from "./fleet.ts";
import { type LiveSnapshot, liveViewOf } from "./fleet-live.ts";
import { fleetRows, fleetStatusOf } from "./fleet-status.ts";
import { computeActuals } from "./logbook.ts";
import { DEFAULT_TEAM_PATTERN } from "./registration.ts";
import { type AlertsInput, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { destOf } from "./supervisor-alerts.ts";
import { supervisorQueueOf } from "./supervisor-queue.ts";

// 취소된 FLIGHT는 AIRCRAFT를 붙들지 않는다(ATC-460)
const NOW = Date.parse("2026-10-03T06:00:00Z");
const tickets = [
  { key: "ATC-1", stateType: "canceled" },
  { key: "ATC-2", stateType: "started" },
] as const;
const pr = (number: number, ticketKey: string | null, standPath: string | null, over: Record<string, unknown> = {}) =>
  ({ repo: "/r/atc", number, url: `https://github.com/o/atc/pull/${number}`, draft: false, ticketKey, standPath, ...over }) as Parameters<typeof canceledPrsOf>[0][number];

test("canceledKeysOf는 canceled만 센다", () => {
  assert.deepEqual([...canceledKeysOf(tickets as never)], ["ATC-1"]);
  assert.deepEqual([...canceledKeysOf(undefined)], []);
  assert.deepEqual(liveFlightsOf(["ATC-1", "ATC-2"], canceledKeysOf(tickets as never)), ["ATC-2"]);
});

test("열린 PR: 취소된 FLIGHT의 PR은 AIRCRAFT를 붙들지 않고, 진행 중인 FLIGHT의 PR은 붙든다", () => {
  const holders = standHoldersOf(
    [
      { sessionId: "sa", workspacePath: "/w/atc-1", state: "active" },
      { sessionId: "sb", workspacePath: "/w/atc-2", state: "active" },
      { sessionId: "sc", workspacePath: "/w/old", state: "released" },
    ],
    (id) => ({ sa: "TEAM_A", sb: "TEAM_B", sc: "TEAM_C" })[id],
  );
  const pulls = [pr(10, "ATC-1", "/w/atc-1", { draft: true }), pr(11, "ATC-2", "/w/atc-2"), pr(12, null, "/w/old")];
  const live = aircraftWithLivePrOf(pulls, holders, canceledKeysOf(tickets as never));
  assert.deepEqual([...live], ["TEAM_B"]); // TEAM_A는 취소된 FLIGHT의 Draft PR뿐, TEAM_C는 점유가 풀림
});

test("APPLY NOW: 취소된 FLIGHT뿐인 AIRCRAFT는 move-now, 진행 중인 FLIGHT가 있으면 after-flight", () => {
  const canceled = canceledKeysOf(tickets as never);
  const holders = standHoldersOf(
    [
      { sessionId: "sa", workspacePath: "/w/atc-1", state: "active" },
      { sessionId: "sb", workspacePath: "/w/atc-2", state: "active" },
    ],
    (id) => ({ sa: "TEAM_A", sb: "TEAM_B" })[id],
  );
  const pulls = [pr(10, "ATC-1", "/w/atc-1", { draft: true }), pr(11, "ATC-2", "/w/atc-2")];
  const livePr = aircraftWithLivePrOf(pulls, holders, canceled);
  const fact = (registration: string, keys: string[]): ApplyAircraft => ({
    registration, current: "acct-2", session: "background", idle: true, retired: false, aog: false,
    flights: liveFlightsOf(keys, canceled), openPr: livePr.has(registration), assigned: false, launchedRecently: false, limitCut: false,
  });
  const rows = applyNowPlanOf({
    aircraft: [fact("TEAM_A", ["ATC-1"]), fact("TEAM_B", ["ATC-2"])],
    control: [],
    launchAccount: { aircraft: "acct-3", control: null },
    targets: [{ label: "acct-3", refused: null, maxLaunched: null, running: 0 }],
  });
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, r.action])), { TEAM_A: "move-now", TEAM_B: "after-flight" });
  assert.match(rows.find((r) => r.name === "TEAM_B")!.reason, /ATC-2/);
});

test("남은 PR: 취소된 FLIGHT의 열린 PR(Draft 포함)이 PR마다 한 번, 쥔 AIRCRAFT와 함께", () => {
  const holders = standHoldersOf([{ sessionId: "sa", workspacePath: "/w/atc-1", state: "active" }], () => "TEAM_A");
  const list = canceledPrsOf([pr(11, "ATC-2", "/w/atc-2"), pr(10, "ATC-1", "/w/atc-1", { draft: true }), pr(9, "ATC-1", null)], canceledKeysOf(tickets as never), holders, () => "ATCC");
  assert.deepEqual(list.map((p) => [p.number, p.flight, p.aircraft, p.draft]), [[9, "ATC-1", null, false], [10, "ATC-1", "TEAM_A", true]]);

  const alerts = supervisorAlertsOf({ sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null, canceledPrs: list } as AlertsInput);
  assert.equal(alerts.length, 2);
  const a = alerts.find((x) => x.key === "alert|canceled-pr|atc#10")!;
  assert.equal(a.level, "caution");
  assert.equal(a.aircraft, "TEAM_A");
  assert.equal(a.flight, "ATC-1");
  assert.equal(a.link, "#pr/ATCC/10");
  assert.match(a.text, /PR #10\(Draft\)/);
  assert.match(a.text, /TEAM_A/);
  assert.match(a.next, /닫지 않는다/);
  assert.equal(destOf(a), "alerts");

  // HOME 목록의 ALERT 한 줄로 올라온다(PR당 한 번)
  const q = supervisorQueueOf(
    { proposals: [], schedule: { mode: "shadow", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 30, alerts: alerts.map((x) => ({ ...x, dest: destOf(x) })) },
    NOW,
  );
  assert.deepEqual(q.filter((i) => i.kind === "ALERT").map((i) => i.key), ["alert|canceled-pr|atc#10", "alert|canceled-pr|atc#9"]); // 같은 시각이면 key 순
});

const session = (name: string) => ({ id: `s-${name}`, agent: "claude", name, status: "idle", pid: 1, cwd: "/w", startedAt: "2026-10-03T00:00:00Z", lastActiveAt: "2026-10-03T05:55:00Z", repo: null, workspacePath: null }) as LiveSnapshot["sessions"][number];
const view = (registration: string, over: Partial<AircraftView> = {}): AircraftView => ({
  registration, callsign: registration.replace("TEAM_", ""), status: "idle", base: "VCDO", complement: DEFAULT_FLEET.defaults.complement, complementIsDefault: true, ratings: ["UI"], ratingsIsDefault: true,
  routes: [], targets: {}, note: null, flying: [], flights: [], flyingSince: null, lastActiveAt: null, configuration: null, enteredAt: null, aog: null, retired: null, actuals: computeActuals([], registration, NOW), ...over,
});

test("FLEET: 취소된 FLIGHT는 날고 있다고 하지 않고 취소됨으로 보인다", () => {
  const snap: LiveSnapshot = {
    sessions: [session("TEAM_A")],
    claims: [{ sessionId: "s-TEAM_A", workspacePath: "/w/atc-1", since: "2026-10-03T05:00:00Z", lastAt: "2026-10-03T05:50:00Z", source: "hook", tool: null, state: "active", handedOffTo: null }] as LiveSnapshot["claims"],
    workspaces: [{ path: "/w/atc-1", name: "atc-1", repo: "/r", isMain: false, branch: "b", head: "abc", dirty: 0, lastCommitAt: null, ticketKey: "ATC-1" }] as LiveSnapshot["workspaces"],
    tickets: [{ key: "ATC-1", title: "t", stateType: "canceled" }] as LiveSnapshot["tickets"],
  };
  const l = liveViewOf(snap, ["TEAM_A"], DEFAULT_TEAM_PATTERN, () => null, NOW).get("TEAM_A")!;
  assert.equal(l.flights[0].canceled, true);
  const a = view("TEAM_A", { flying: l.flying, flights: l.flights, flyingSince: l.flyingSince });
  assert.equal(fleetStatusOf(a), "PARKED");
  const row = fleetRows([a], NOW)[0];
  assert.equal(row.flight?.canceled, true);
  assert.equal(row.elapsedMin, null);

  // 진행 중인 FLIGHT가 있으면 그것이 먼저, 취소된 것은 뒤에
  const live = view("TEAM_B", { flying: ["ATC-1", "ATC-2"], flights: [{ key: "ATC-1", title: null, canceled: true }, { key: "ATC-2", title: null }], flyingSince: "2026-10-03T05:00:00Z" });
  assert.equal(fleetStatusOf(live), "HOLDING");
  const r2 = fleetRows([live], NOW)[0];
  assert.equal(r2.flight?.key, "ATC-2");
  assert.equal(r2.more, 1);
});
