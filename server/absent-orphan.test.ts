import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import { DEFAULT_DISPATCH_CONFIG, planDispatch } from "./dispatch.ts";
import type { Session, Snapshot, Ticket } from "./model.ts";

// ATC-548: 세션이 없는(ABSENT) AIRCRAFT도 ORPHAN FLIGHT를 살아 있는 AIRCRAFT와 같은 슬롯·WAKE 셈으로 센다.
// 2026-10-03 09:25–09:40의 TEAM_O: ORPHAN을 몰라 LAUNCH 카드를 냈다가, 세션이 뜨자 "AIRCRAFT 멈춤"으로 거둬 헛수고였다. 순수 함수만
const T = (hhmm: string) => Date.parse(`2026-10-03T${hhmm}:00.000Z`);
const iso = (hhmm: string) => new Date(T(hhmm)).toISOString();
const VOC = "/home/c10/projects/vocado_nextjs";

const dsess = (id: string, name: string): Session => ({ id, agent: "claude", name, status: "idle", pid: 1, cwd: VOC, startedAt: iso("09:20"), lastActiveAt: iso("09:30"), repo: VOC, workspacePath: VOC });
const dticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({ key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: iso("05:00"), project: "Beta Readiness", labels: [], createdAt: iso("04:00"), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], ...over });

// ORPHAN인 VOC-317(In Progress)과 새로 받을 VOC-352. TEAM_O는 세션이 없다(ABSENT)
const absentSnap = (orphan: Partial<Ticket> = {}, other: Partial<Ticket> = {}): Snapshot =>
  ({
    at: iso("09:25"), linear: { enabled: true, error: null, fetchedAt: iso("09:24") }, github: { enabled: true, error: null, fetchedAt: iso("09:24") }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [], workspaces: [], columns: [], claims: [], handoffs: [], alerts: [], clearances: [],
    tickets: [dticket("VOC-317", { state: "In Progress", stateType: "started", ...orphan }), dticket("VOC-352", other)],
    airports: [{ id: "r1", code: "VCDO", name: "vocado_nextjs", repo: VOC }],
    absent: [{ registration: "TEAM_O", launchedAt: iso("05:40"), jobId: null, cut: null }],
  }) as unknown as Snapshot;
const plan = (s: Snapshot, orphans: Map<string, string[]>, now = T("09:25"), resumes: never[] = []) =>
  planDispatch(s, new Map(), { ...DEFAULT_DISPATCH_CONFIG }, now, undefined, { ...DEFAULT_FLEET, aircraft: { TEAM_O: { base: "VCDO" } } }, undefined, undefined, undefined, undefined, resumes, undefined, undefined, undefined, orphans);
const ORPH = new Map([["TEAM_O", ["VOC-317"]]]);
const teamO = (p: ReturnType<typeof plan>) => p.aircraft.find((x) => x.registration === "TEAM_O")!;

test("A. ABSENT + an ORPHAN that fills the slot: stopped, no LAUNCH card, the reason names the ORPHAN FLIGHT, orphanOnly is set", () => {
  const p = plan(absentSnap(), ORPH);
  const a = teamO(p);
  assert.equal(a.launch, true);
  assert.equal(a.stopped, true);
  assert.equal(a.available, false);
  assert.match(a.reason, /VOC-317 ORPHAN FLIGHT/);
  assert.deepEqual(a.orphanOnly, ["VOC-317"]);
  assert.equal(p.assign.some((x) => x.aircraftName === "TEAM_O"), false);
  assert.match(p.excluded.find((e) => e.flight === "TEAM_O")?.reason ?? "", /TEAM_O — VOC-317 ORPHAN FLIGHT/);
});

test("B. ABSENT + an ORPHAN with room left: available with `room`; a WAKE L FLIGHT fits, a WAKE M one does not", () => {
  const fits = plan(absentSnap({ labels: ["wake:L"] }, { labels: ["wake:L"] }), ORPH);
  const a = teamO(fits);
  assert.equal(a.available, true);
  assert.equal(a.launch, true);
  assert.equal(a.room, 0.5);
  assert.equal(a.stopped, undefined);
  assert.match(a.reason, /VOC-317 ORPHAN FLIGHT.*남은 슬롯/);
  assert.deepEqual(fits.assign.map((x) => `${x.flight}→${x.aircraftName}`), ["VOC-352→TEAM_O"]);
  assert.equal(plan(absentSnap({ labels: ["wake:L"] }, { labels: ["wake:M"] }), ORPH).assign.some((x) => x.flight === "VOC-352"), false);
});

test("C. the 09:25–09:40 sequence: before and after the session appears DISPATCH reaches the same verdict, so no LAUNCH card is made and then superseded", () => {
  const before = plan(absentSnap(), ORPH);
  const afterSnap = { ...absentSnap(), absent: [], sessions: [dsess("eeafa5df", "TEAM_O")] } as unknown as Snapshot;
  const after = plan(afterSnap, ORPH, T("09:40"));
  const verdict = (p: ReturnType<typeof plan>) => [teamO(p).stopped, teamO(p).available, teamO(p).orphanOnly];
  assert.deepEqual(verdict(before), verdict(after));
  assert.equal(before.assign.some((x) => x.aircraftName === "TEAM_O"), false);
  assert.equal(after.assign.some((x) => x.aircraftName === "TEAM_O"), false);
});

test("D. switch off (no ORPHAN count): ABSENT is a LAUNCH candidate as before; the RESUME path still comes first for the ORPHAN FLIGHT itself", () => {
  assert.equal(teamO(plan(absentSnap(), new Map())).available, true);
  const resumed = teamO(plan(absentSnap(), ORPH, T("09:25"), [{ registration: "TEAM_O", flight: "VOC-317" } as never]));
  assert.match(resumed.reason, /^RESUME — VOC-317/);
});
