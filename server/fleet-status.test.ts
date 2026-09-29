import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { AircraftView } from "./fleet.ts";
import { elapsedText, fleetRows, fleetStatusOf, flightDetailText } from "./fleet-status.ts";
import { ACCOUNT_HOLD_NEXT } from "./health.ts";
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

test("운항 상태 줄에 ACCOUNT와 같은 ACCOUNT의 LIMIT HOLD 표시(ATC-51)", () => {
  const accountHold = { account: "pro-2", resetsAt: "2026-09-28T06:40:00.000Z", by: ["TEAM_K"] };
  const [r] = fleetRows([view("TEAM_L", { account: "pro-2", accountIsDefault: false, accountHold })], NOW);
  assert.equal(r!.health, null);
  assert.equal(r!.account, "pro-2");
  assert.deepEqual(r!.accountHold, { label: "HOLD · LIMIT (account pro-2) until 06:40Z", detail: "같은 ACCOUNT의 TEAM_K가 사용 한도에 걸림", next: ACCOUNT_HOLD_NEXT });
  const [bare] = fleetRows([view("TEAM_A")], NOW);
  assert.deepEqual([bare!.account, bare!.accountIsDefault, bare!.accountHold], [null, false, null]);
});

test("운항 상태 줄에는 ACCOUNT 사용 %가 없다. hold 수준일 때만 HOLD · FUEL 꼬리표(ATC-81)", () => {
  const top = { name: "five_hour" as const, pct: 82.4, resetsAt: "2026-09-28T09:00:00.000Z" };
  const fuel = { group: "pro-2", account: "pro-2", at: "2026-09-28T05:30:00Z", from: "TEAM_K", fromKind: "aircraft" as const, windows: [top], top, level: "info" as const, aircraft: ["TEAM_K", "TEAM_L"], control: [] };
  const [r] = fleetRows([view("TEAM_L", { fuel })], NOW);
  assert.equal(r!.fuelHold, null);
  assert.equal("fuel" in r!, false); // 줄에 ACCOUNT %를 싣는 자리가 없다
  const held = { ...fuel, top: { ...top, pct: 96.2 }, windows: [{ ...top, pct: 96.2 }], level: "hold" as const };
  const [h] = fleetRows([view("TEAM_L", { fuel: held })], NOW);
  assert.deepEqual(h!.fuelHold, { label: "HOLD · FUEL (account pro-2) until 09:00Z", title: "ACCOUNT pro-2 · 사용 5h 96% (reset 09:00Z) · TEAM_K statusline 05:30Z" });
  assert.equal(h!.fuelHold!.label.includes("%"), false);
  assert.equal(fleetRows([view("TEAM_A")], NOW)[0]!.fuelHold, null);
});

test("ATC-86: 점유는 지났지만 멈춘 채 FLIGHT를 쥔 AIRCRAFT(kept)는 HOLDING이고, 줄에 그 FLIGHT와 마지막 커밋·push·PR이 남는다", () => {
  const detail = { commit: { sha: "59a9fdc", at: "2026-09-28T18:10:00Z" }, pushed: true, pr: null };
  const kept = view("TEAM_G", { flights: [{ key: "ATC-72", title: "STAND-free FLIGHTs ARRIVED", kept: true, detail }], flying: [], health: { code: "LIMIT", level: "alert", since: "2026-09-28T18:10:48Z", detail: "d", next: "n", holds: true, cut: true, cutAt: "2026-09-28T18:10:48Z" } });
  assert.equal(fleetStatusOf(kept), "HOLDING");
  assert.equal(fleetStatusOf(view("TEAM_H")), "PARKED"); // FLIGHT가 없으면 그대로
  const [row] = fleetRows([kept], NOW);
  assert.deepEqual(row!.flight, { key: "ATC-72", title: "STAND-free FLIGHTs ARRIVED", kept: true, detail });
  assert.equal(row!.health?.label, "HOLD · LIMIT (cut 18:10Z)");
  assert.equal(row!.elapsedMin, null); // STAND를 쥔 시각이 없으면 경과도 없다
});

test("flightDetailText: 마지막 커밋과 나이, origin에 있나, PR(없으면 no PR). 워크트리를 모르면 no worktree", () => {
  const at = "2026-09-28T04:55:00Z"; // NOW보다 65분 앞
  assert.deepEqual(flightDetailText({ commit: { sha: "59a9fdc", at }, pushed: true, pr: null }, NOW), { text: "59a9fdc 1h05m ago · pushed · no PR", unpushed: false });
  assert.deepEqual(flightDetailText({ commit: { sha: "7955be6", at }, pushed: false, pr: { number: 147, url: "u", draft: true } }, NOW), { text: "7955be6 1h05m ago · not pushed · PR #147 draft", unpushed: true });
  assert.deepEqual(flightDetailText({ commit: { sha: "7955be6", at: null }, pushed: null, pr: { number: 9, url: "u", draft: false } }, NOW), { text: "7955be6 · PR #9", unpushed: false });
  assert.deepEqual(flightDetailText({ commit: null, pushed: null, pr: null }, NOW), { text: "no worktree · no PR", unpushed: false });
});
