import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { AircraftView } from "./fleet.ts";
import { elapsedText, fleetRows, fleetStatusOf } from "./fleet-status.ts";
import { computeActuals } from "./logbook.ts";

// FLEET 운항 상태 목록(ATC-44, UI report #99)
const NOW = Date.parse("2026-09-28T06:00:00Z");
const view = (registration: string, over: Partial<AircraftView> = {}): AircraftView => ({
  registration,
  callsign: registration.replace("TEAM_", ""),
  status: "idle",
  base: "VCDO",
  complement: DEFAULT_FLEET.defaults.complement,
  complementIsDefault: true,
  ratings: ["UI"],
  ratingsIsDefault: true,
  routes: [],
  targets: {},
  note: null,
  flying: [],
  flights: [],
  flyingSince: null,
  lastActiveAt: null,
  configuration: null,
  enteredAt: null,
  aog: null,
  retired: null,
  actuals: computeActuals([], registration, NOW),
  ...over,
});
const flying = (keys: string[], since = "2026-09-28T04:30:00Z") => ({ flying: keys, flights: keys.map((key) => ({ key, title: `${key} title` })), flyingSince: since });

test("status: AIRBORNE, HOLDING (idle with a STAND), PARKED, AOG, NORDO, NOT IN SERVICE, RETIRED", () => {
  assert.equal(fleetStatusOf(view("A", { status: "busy" })), "AIRBORNE");
  assert.equal(fleetStatusOf(view("A", flying(["VOC-1"]))), "HOLDING");
  assert.equal(fleetStatusOf(view("A")), "PARKED");
  assert.equal(fleetStatusOf(view("A", { status: "busy", aog: { reason: "x", until: null, at: "t" } as AircraftView["aog"] })), "AOG");
  assert.equal(fleetStatusOf(view("A", { status: "dead" })), "NORDO");
  assert.equal(fleetStatusOf(view("A", { status: "absent" })), "NOT IN SERVICE");
  assert.equal(fleetStatusOf(view("A", { retired: { at: "t" } as AircraftView["retired"] })), "RETIRED");
});

test("order: AIRBORNE → HOLDING → PARKED, then by AIRPORT inside a status, then REGISTRATION", () => {
  const rows = fleetRows(
    [
      view("TEAM_A"),
      view("TEAM_B", { status: "busy", base: "VCDO" }),
      view("TEAM_C", { ...flying(["VOC-3"]) }),
      view("TEAM_D", { status: "busy", base: "ATCC" }),
      view("TEAM_E", { status: "absent", base: null }),
      view("TEAM_F", { base: "ATCC" }),
      view("TEAM_G", { base: null }),
    ],
    NOW,
  );
  assert.deepEqual(
    rows.map((r) => `${r.registration}:${r.status}:${r.airport}`),
    ["TEAM_D:AIRBORNE:ATCC", "TEAM_B:AIRBORNE:VCDO", "TEAM_C:HOLDING:VCDO", "TEAM_F:PARKED:ATCC", "TEAM_A:PARKED:VCDO", "TEAM_G:PARKED:null", "TEAM_E:NOT IN SERVICE:null"],
  );
});

test("row: first FLYING FLIGHT with its title, how many more, elapsed since the STAND was taken, last activity, on-time this week", () => {
  const [r] = fleetRows(
    [
      view("TEAM_B", {
        status: "busy",
        ...flying(["VOC-193", "VOC-194", "VOC-195"]),
        lastActiveAt: "2026-09-28T05:58:00Z",
        actuals: { ...computeActuals([], "TEAM_B", NOW), week: 3, weekOnTime: { rate: 2 / 3, within: 2, measured: 3 } },
      }),
    ],
    NOW,
  );
  assert.deepEqual(r.flight, { key: "VOC-193", title: "VOC-193 title" });
  assert.equal(r.more, 2);
  assert.equal(r.elapsedMin, 90);
  assert.equal(r.lastActiveAt, "2026-09-28T05:58:00Z");
  assert.equal(r.week, 3);
  assert.equal(r.weekOnTime, 2 / 3);
  // FLYING이 없으면 경과 시간도 없다
  const [p] = fleetRows([view("TEAM_A")], NOW);
  assert.equal(p.flight, null);
  assert.equal(p.elapsedMin, null);
  assert.equal(p.weekOnTime, null);
});

test("elapsed text", () => {
  assert.equal(elapsedText(45), "45m");
  assert.equal(elapsedText(60), "1h");
  assert.equal(elapsedText(185), "3h05m");
  assert.equal(elapsedText(52 * 60), "2d4h");
});

test("운항 상태 줄에 AIRCRAFT health 표시(ATC-45)", () => {
  const health = { code: "LIMIT" as const, level: "alert" as const, since: "2026-09-28T05:50:00Z", resetsAt: "2026-09-28T06:40:00.000Z", detail: "You've hit your session limit", next: "reset까지 기다린다", holds: true };
  const [r] = fleetRows([view("TEAM_H", { health })], NOW);
  assert.deepEqual(r!.health, { code: "LIMIT", level: "alert", label: "HOLD · LIMIT until 06:40Z", detail: "You've hit your session limit", next: "reset까지 기다린다" });
  assert.equal(fleetRows([view("TEAM_A")], NOW)[0]!.health, null);
});
