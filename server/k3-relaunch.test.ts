import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_FLEET, type FleetFile } from "./crew.ts";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig, planDispatch, saveK3Relaunch, type Unserved } from "./dispatch.ts";
import type { AircraftView } from "./fleet.ts";
import { type ExecContext, executionOf, type FleetInputs, FLEET_PLAN_DEFAULTS, fleetPlanOf, foldFleetPlan, fuelExpiryOf, PlanError } from "./fleet-plan.ts";
import { computeActuals } from "./logbook.ts";
import { K3_FRESH_WHY, k3CheckOf } from "./k3-allow.ts";
import { k3RelaunchMisfiresOf } from "./k3-relaunch.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { type ReleaseChannel, type ReleaseView, releaseHashOf } from "./release.ts";
import { k3OfFlight } from "./session-control.ts";

// K3 RELAUNCH(ATC-509): K3 FLIGHT를 받을 새 세션이 없을 때 쉬는 AIRCRAFT를 멈추고 그 FLIGHT로 다시 띄우는 카드. 순수 부분만 — 세션을 멈추거나 띄우지 않는다
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const view = (registration: string, over: Partial<AircraftView> = {}): AircraftView => ({
  registration, callsign: registration, status: "idle", base: "ATCC",
  complement: DEFAULT_FLEET.defaults.complement, complementIsDefault: true, ratings: ["UI", "DATA", "DOCS"], ratingsIsDefault: true,
  routes: [], targets: {}, note: null, flying: [], flights: [], flyingSince: null, lastActiveAt: null, configuration: null, enteredAt: ago(60 * DAY), aog: null, retired: null,
  actuals: computeActuals([], registration, NOW), ...over,
});
const bg = (reg: string) => ({ registration: reg, kind: "background", id: reg.slice(-1).toLowerCase(), startedAt: NOW - DAY });
const need = (flight: string, over: Partial<Unserved> = {}): Unserved => ({ flight, airport: "ATCC", type: "BUILD", ratings: [], labeled: true, why: "no-aircraft", tails: [], k3: true, ...over });
const fuel = (level: "ok" | "hold", account = "acct-1") => ({ account, group: `account:${account}`, level, top: { pct: level === "hold" ? 100 : 10, resetsAt: ago(-HOUR) } }) as unknown as NonNullable<FleetInputs["fuelAccounts"]>[number];

const inputs = (over: Partial<FleetInputs> = {}): FleetInputs => ({
  aircraft: [view("TEAM_H")],
  plan: { assign: [], unserved: [need("ATC-509")] },
  sessions: [bg("TEAM_H")],
  lastActive: new Map([["TEAM_H", ago(5 * HOUR)]]),
  nordo: new Set(),
  los: new Map(),
  logbook: [..."ABCDEFGHIJK"].map((c) => ({ aircraft: `TEAM_${c}`, airport: "ATCC", arrivedAt: ago(DAY), blockMin: 60, landingWaitMin: 3 })),
  openPrs: new Set(),
  groundStops: new Set(),
  dwell: new Map(),
  maxLaunched: 6,
  nextRegistration: "TEAM_L",
  defaults: DEFAULT_FLEET.defaults,
  config: FLEET_PLAN_DEFAULTS,
  now: NOW,
  k3Relaunch: true,
  ...over,
});
const k3Cards = (i: FleetInputs) => fleetPlanOf(i).candidates.filter((c) => c.kind === "K3 RELAUNCH");

test("one idle AIRCRAFT is chosen: PARKED, no PR, no STAND, not at LIMIT, not under a FUEL hold", () => {
  const [card] = k3Cards(inputs());
  assert.equal(card.kind, "K3 RELAUNCH");
  assert.equal(card.aircraft, "TEAM_H");
  assert.equal(card.airport, "ATCC");
  assert.equal(card.key, "K3 RELAUNCH|ATC-509");
  assert.equal(card.reasons.find((r) => r.code === "flight")?.value, "ATC-509");
  assert.ok(card.reasons.some((r) => r.detail.includes(K3_FRESH_WHY)));
});

test("each of the four exclusions removes the AIRCRAFT; the next eligible one is taken instead", () => {
  const spare = view("TEAM_I");
  const sessions = [bg("TEAM_H"), bg("TEAM_I")];
  const lastActive = new Map([["TEAM_H", ago(9 * HOUR)], ["TEAM_I", ago(2 * HOUR)]]);
  const excluded: Record<string, Partial<FleetInputs> & { h?: Partial<AircraftView> }> = {
    "open PR": { openPrs: new Set(["TEAM_H"]) },
    STAND: { h: { flying: ["ATC-9"] } },
    LIMIT: { h: { health: { code: "LIMIT", level: "alert", detail: "", since: ago(HOUR), next: "" } as AircraftView["health"] } },
    "FUEL hold": { h: { account: "acct-1" }, fuelAccounts: [fuel("hold")] },
  };
  // 기준: 아무것도 막지 않으면 가장 오래 쉰 TEAM_H
  assert.equal(k3Cards(inputs({ aircraft: [view("TEAM_H"), spare], sessions, lastActive }))[0].aircraft, "TEAM_H");
  for (const [name, x] of Object.entries(excluded)) {
    const { h, ...rest } = x;
    // 둘 중 TEAM_H만 막힌다 → TEAM_I가 카드를 받고, TEAM_I 혼자일 때는 TEAM_H가 막혀 카드가 없다
    const both = k3Cards(inputs({ aircraft: [view("TEAM_H", h), spare], sessions, lastActive, ...rest }));
    assert.deepEqual(both.map((c) => c.aircraft), ["TEAM_I"], name);
    assert.deepEqual(k3Cards(inputs({ aircraft: [view("TEAM_H", h)], ...rest })), [], name);
  }
  // 세션이 쉬지 않거나(busy·NORDO) 백그라운드가 아니면 멈추지 않는다
  assert.deepEqual(k3Cards(inputs({ aircraft: [view("TEAM_H", { status: "busy" })] })), []);
  assert.deepEqual(k3Cards(inputs({ nordo: new Set(["TEAM_H"]) })), []);
  assert.deepEqual(k3Cards(inputs({ sessions: [{ ...bg("TEAM_H"), kind: "interactive" }] })), []);
});

test("only one AIRCRAFT is chosen per FLIGHT: the longest idle", () => {
  const cards = k3Cards(inputs({ aircraft: [view("TEAM_H"), view("TEAM_I"), view("TEAM_J")], sessions: [bg("TEAM_H"), bg("TEAM_I"), bg("TEAM_J")], lastActive: new Map([["TEAM_H", ago(HOUR)], ["TEAM_I", ago(8 * HOUR)], ["TEAM_J", ago(3 * HOUR)]]) }));
  assert.deepEqual(cards.map((c) => c.aircraft), ["TEAM_I"]);
});

test("the card is proposed only with k3Relaunch on", () => {
  assert.equal(k3Cards(inputs({ k3Relaunch: false })).length, 0);
  assert.equal(k3Cards(inputs({ k3Relaunch: undefined })).length, 0);
  assert.equal(k3Cards(inputs()).length, 1);
});

test("no card when the AIRPORT has a usable ABSENT AIRCRAFT, for a non-K3 FLIGHT, or under a GROUND STOP", () => {
  assert.equal(k3Cards(inputs({ aircraft: [view("TEAM_H"), view("TEAM_I", { status: "absent" })] })).length, 0);
  assert.equal(k3Cards(inputs({ plan: { assign: [], unserved: [need("ATC-9", { k3: undefined })] } })).length, 0);
  assert.equal(k3Cards(inputs({ groundStops: new Set(["ATCC"]) })).length, 0);
  // 다른 AIRPORT 소속 AIRCRAFT는 고르지 않는다
  assert.equal(k3Cards(inputs({ aircraft: [view("TEAM_H", { base: "RNPU" })] })).length, 0);
  // 그 FLIGHT를 날 수 없는 AIRCRAFT(TYPE RATING)도 아니다
  assert.equal(k3Cards(inputs({ plan: { assign: [], unserved: [need("ATC-509", { ratings: ["SEC"] })] } })).length, 0);
});

test("a FUEL hold on the ACCOUNT expires an open card", () => {
  assert.equal(fuelExpiryOf({ aircraft: [view("TEAM_H", { account: "acct-1" })], fuelAccounts: [fuel("hold")], now: NOW }, { kind: "K3 RELAUNCH", aircraft: "TEAM_H" })?.includes("FUEL"), true);
  assert.equal(fuelExpiryOf({ aircraft: [view("TEAM_H", { account: "acct-1" })], fuelAccounts: [fuel("ok")], now: NOW }, { kind: "K3 RELAUNCH", aircraft: "TEAM_H" }), null);
});

const created = (id = "F-0001") => foldFleetPlan([{ op: "create", id, key: "K3 RELAUNCH|ATC-509", kind: "K3 RELAUNCH", aircraft: "TEAM_H", airport: "ATCC", reasons: k3Cards(inputs())[0].reasons, at: ago(20 * MIN) }])[0];
const ctx = (over: Partial<ExecContext> = {}): ExecContext => {
  const p = created();
  return {
    mode: "approval", latest: [{ key: p.key, kind: p.kind, aircraft: p.aircraft, airport: p.airport, reasons: [] }], ranAt: ago(MIN),
    aircraft: [view("TEAM_H")], sessions: [bg("TEAM_H")], taken: ["TEAM_H"], lastLaunch: new Map(), maxLaunched: 6, now: NOW, ...over,
  };
};

test("approving STOPs the AIRCRAFT then LAUNCHes it for the FLIGHT, both tied to the card id", () => {
  const { steps } = executionOf(created(), {}, ctx());
  assert.deepEqual(steps.map((s) => s.action), ["stop", "launch"]);
  assert.deepEqual(steps.map((s) => (s as { proposal?: string }).proposal), ["F-0001", "F-0001"]);
  assert.equal((steps[1] as { flight?: string }).flight, "ATC-509");
  assert.ok(steps.every((s) => s.registration === "TEAM_H"));
});

test("the approval refuses before STOP when the AIRCRAFT is no longer idle, or the switch is off", () => {
  assert.throws(() => executionOf(created(), {}, ctx({ aircraft: [view("TEAM_H", { status: "busy", flying: ["ATC-1"] })] })), PlanError);
  assert.throws(() => executionOf(created(), {}, ctx({ sessions: [] })), PlanError); // 세션이 없다
  assert.throws(() => executionOf(created(), {}, ctx({ mode: "shadow" })), /그림자/);
});

// DISPATCH의 이유
const DECLARED = "## Goal\nx\n\n## K effects\n\n* K3[Security Weaken]: CROSSCHECK condition in the auto approve | files: server/auto-approve-run.ts\n";
const ATCC = "/home/c10/projects/atc";
const ticket = (key: string, body: string): Ticket => {
  const k = k3CheckOf(body);
  return {
    key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: "2026-10-03T00:00:00Z",
    project: null, labels: [], createdAt: "2026-10-03T00:00:00Z", startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], releaseHash: releaseHashOf(body),
    ...(k.declared.length ? { k3: k.declared } : {}), ...(k.check ? { k3Check: k.check } : {}),
  };
};
const releasedBy = (t: Ticket, channel: ReleaseChannel, hash = t.releaseHash!): ReleaseView => ({ armedAt: "2026-10-03T00:00:00Z", records: { [t.key]: { flight: t.key, channel, at: "2026-10-03T01:00:00Z", hash } } });
const snap = (t: Ticket, releases: ReleaseView): Snapshot =>
  ({
    at: new Date(NOW).toISOString(), linear: { enabled: true, error: null, fetchedAt: null }, github: { enabled: true, error: null, fetchedAt: null }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [], workspaces: [], tickets: [t], columns: [], claims: [], handoffs: [], alerts: [], clearances: [], airports: [{ id: "r", code: "ATCC", name: "atc", repo: ATCC }], releases, absent: [],
  }) as unknown as Snapshot;
const fleet: FleetFile = { ...DEFAULT_FLEET, aircraft: { TEAM_H: { base: "ATCC" } } };
const cfg = { ...DEFAULT_DISPATCH_CONFIG, candidateTeams: ["ATC"] };

test("a released K3 FLIGHT with no ABSENT AIRCRAFT reads 'K3: needs a fresh LAUNCH' in the exclusion text and on unserved", () => {
  const t = ticket("ATC-509", DECLARED);
  const p = planDispatch(snap(t, releasedBy(t, "screen")), new Map(), cfg, NOW, undefined, fleet);
  assert.deepEqual(p.assign, []);
  const u = p.unserved!.find((x) => x.flight === "ATC-509")!;
  assert.deepEqual([u.why, u.k3], ["no-aircraft", true]);
  const why = p.excluded.find((e) => e.flight === "ATC-509")!.reason;
  assert.ok(why.includes("K3: needs a fresh LAUNCH") && why.includes("k3Relaunch") && why.includes("STOP"), why);
});

test("a FLIGHT without K3 entries keeps the plain no-aircraft", () => {
  const t = ticket("ATC-8", "## Goal\nx\n");
  const p = planDispatch(snap(t, { armedAt: null, records: {} }), new Map(), cfg, NOW, undefined, fleet);
  const u = p.unserved!.find((x) => x.flight === "ATC-8")!;
  assert.deepEqual([u.why, u.k3], ["no-aircraft", undefined]);
  assert.equal(p.excluded.some((e) => e.flight === "ATC-8" && e.reason.includes(K3_FRESH_WHY)), false);
});

test("the switch defaults to off, is on only when the file says on, and is saved without touching other settings", () => {
  assert.equal(DEFAULT_DISPATCH_CONFIG.k3Relaunch, "off");
  const dir = mkdtempSync(join(tmpdir(), "k3relaunch-"));
  try {
    const f = join(dir, "dispatch.json");
    assert.equal(loadDispatchConfig(f).k3Relaunch, "off"); // 파일 없음
    writeFileSync(f, JSON.stringify({ k3Hold: "off", k3Relaunch: "yes" }));
    assert.equal(loadDispatchConfig(f).k3Relaunch, "off"); // 모르는 값
    saveK3Relaunch("on", f);
    const c = loadDispatchConfig(f);
    assert.deepEqual([c.k3Relaunch, c.k3Hold], ["on", "off"]);
    saveK3Relaunch("off", f);
    assert.equal(loadDispatchConfig(f).k3Relaunch, "off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("misfire counter: approved vs expired and rejected cards, and STOPs with no LAUNCH within the launch-card timeout", () => {
  const card = (id: string, status: "executed" | "expired" | "disagreed" | "open", approved: boolean) => ({ id, kind: "K3 RELAUNCH" as const, status, approval: approved ? { by: "SUPERVISOR", at: ago(HOUR), options: {} } : null });
  const proposals = [card("F-1", "executed", true), card("F-2", "executed", true), card("F-3", "expired", false), card("F-4", "disagreed", false), card("F-5", "executed", true), { id: "F-6", kind: "STOP" as const, status: "expired" as const, approval: null }];
  const rec = (op: string, proposal: string, minAgo: number, ok = true) => ({ t: ago(minAgo * MIN), op, aircraft: "TEAM_H", proposal, ok });
  const m = k3RelaunchMisfiresOf({
    proposals,
    records: [
      rec("stop", "F-1", 60), rec("launch", "F-1", 59), // 시한 안에 LAUNCH
      rec("stop", "F-2", 120), // LAUNCH 없음 → STOP만
      rec("stop", "F-5", 10), // 아직 시한(30분) 안이라 기다리는 중
      rec("stop", "F-9", 300), // K3 카드가 아님
    ],
    timeoutMin: 30,
    now: NOW,
  });
  assert.deepEqual([m.approved, m.expired, m.rejected], [3, 1, 1]); // F-6(STOP 카드)은 세지 않는다
  assert.deepEqual(m.stopOnly.map((x) => x.proposal), ["F-2"]);
  // LAUNCH가 시한 뒤에 늦게 나왔거나 실패면 그 STOP은 짝이 없다
  const late = k3RelaunchMisfiresOf({ proposals, records: [rec("stop", "F-1", 120), rec("launch", "F-1", 60), rec("stop", "F-2", 120), rec("launch", "F-2", 119, false)], timeoutMin: 30, now: NOW });
  assert.deepEqual(late.stopOnly.map((x) => x.proposal).sort(), ["F-1", "F-2"]);
});

test("the FLEET LAUNCH route builds the same K3 entries as a launch card (same k3LaunchOf, same hash check)", () => {
  const t = ticket("ATC-509", DECLARED);
  const entries = k3OfFlight(snap(t, releasedBy(t, "screen")), "ATC-509")!(ATCC);
  assert.equal(entries?.flight, "ATC-509");
  assert.equal(entries?.entries.length, 1);
  assert.deepEqual(JSON.parse(entries!.settings).autoMode.allow[0], "$defaults");
  assert.equal(k3OfFlight(snap(t, releasedBy(t, "duty-chat")), "ATC-509")!(ATCC)?.entries.length, 1); // DUTY 채팅 발권도
  // 발권 없음·본문이 바뀐 발권·세션이 증언한 발권·모르는 FLIGHT는 entries 없이 전과 같다
  assert.equal(k3OfFlight(snap(t, { armedAt: null, records: {} }), "ATC-509")!(ATCC), null);
  assert.equal(k3OfFlight(snap(t, releasedBy(t, "screen", "stale-hash")), "ATC-509")!(ATCC), null);
  assert.equal(k3OfFlight(snap(t, releasedBy(t, "attested")), "ATC-509")!(ATCC), null);
  assert.equal(k3OfFlight(snap(t, releasedBy(t, "screen")), "ATC-999"), undefined);
});
