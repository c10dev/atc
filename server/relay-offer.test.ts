import assert from "node:assert/strict";
import { test } from "node:test";
import type { Clearance, LandingBlockCode, PullRequest, Snapshot } from "./model.ts";
import { offerKey, relayOffersOf, type OfferInput } from "./relay-offer.ts";
import { supervisorQueueOf, type QueueInput } from "./supervisor-queue.ts";
import { clearanceTypeOf, lastAircraftOf, relayBriefOf, relayInputOf, type LastAircraftInput, type Relay } from "./relay.ts";

const REPO = "/home/c10/projects/atc";
const WT = "/home/c10/projects/worktrees";
const T0 = Date.parse("2026-10-01T04:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const pr = (number: number, codes: LandingBlockCode[] = [], over: Partial<PullRequest> = {}): PullRequest => ({
  repo: REPO, number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, branch: `claude/atc-${number}`,
  head: `h${number}abcdef0`, base: "main", ticketKey: `ATC-${number}`, standPath: `${WT}/atc-${number}`, draft: false,
  landing: codes.length ? "APPROACH" : "CLEARED", blocks: codes.map((code) => ({ code, text: code, en: code })),
  readyAt: codes.length ? null : iso(-10), createdAt: iso(-100 + number), ...over,
});
const snap = (pulls: PullRequest[], claims: unknown[] = []) =>
  ({ pulls, claims, workspaces: [{ path: `${WT}/atc-5`, name: "atc-5" }], airports: [{ repo: REPO, code: "ATCC" }] }) as unknown as Pick<Snapshot, "pulls" | "claims" | "workspaces" | "airports">;
const holder = (n: number) => ({ state: "active", workspacePath: `${WT}/atc-${n}`, sessionId: "s1" });

const NONE: LastAircraftInput = { departures: [], proposals: [], reports: [], regOf: () => null };
const input = (over: Partial<OfferInput> = {}): OfferInput => ({ clearances: [], events: [], relays: [], lastAircraft: NONE, now: T0, ...over });
const findings = { source: "review", items: [{ n: 1, text: "bug" }] } as unknown;
const fixPr = (n: number, over: Partial<PullRequest> = {}) => pr(n, [], { ...over, landing: "APPROACH", blocks: [{ code: "review-findings", text: "f", en: "f", findings } as never] });

test("충돌 PR에 쥔 세션이 없으면 GO AROUND 카드 하나(TOWER의 글, 그 head)", () => {
  const [o, ...rest] = relayOffersOf(snap([pr(5, ["dirty"])]), input());
  assert.equal(rest.length, 0);
  assert.equal(o!.type, "GO AROUND");
  assert.equal(o!.pr, 5);
  assert.equal(o!.stand, `${WT}/atc-5`);
  assert.equal(o!.standName, "atc-5");
  assert.equal(o!.airport, "ATCC");
  assert.match(o!.text, /^GO AROUND: PR #5 \(ATC-5\) head h5abcde/);
  assert.equal(o!.key, offerKey(pr(5), "GO AROUND"));
});

test("쥔 세션이 있으면 카드가 없다(TOWER가 보낸다). head가 바뀌면 key가 바뀐다", () => {
  assert.deepEqual(relayOffersOf(snap([pr(5, ["dirty"])], [holder(5)]), input()), []);
  const a = relayOffersOf(snap([pr(5, ["dirty"])]), input())[0]!;
  const b = relayOffersOf(snap([pr(5, ["dirty"], { head: "new1234567" })]), input())[0]!;
  assert.notEqual(a.key, b.key);
});

test("충돌이 풀리거나 PR이 닫히거나 Draft이면 카드가 없다", () => {
  assert.deepEqual(relayOffersOf(snap([pr(5)]), input()), []);
  assert.deepEqual(relayOffersOf(snap([]), input()), []);
  assert.deepEqual(relayOffersOf(snap([pr(5, ["draft", "dirty"], { draft: true })]), input()), []);
});

test("FIX만 있는 PR은 FIX 카드", () => {
  const [o] = relayOffersOf(snap([fixPr(5)]), input());
  assert.equal(o!.type, "FIX");
  assert.match(o!.text, /PR #5/);
});

test("같은 PR·type·head의 relay가 이미 있으면(어느 상태든) 카드를 또 내지 않는다", () => {
  const first = relayOffersOf(snap([pr(5, ["dirty"])]), input())[0]!;
  const relays = [{ type: "GO AROUND", pr: 5, text: first.text, status: "undeliverable" }] as OfferInput["relays"];
  assert.deepEqual(relayOffersOf(snap([pr(5, ["dirty"])]), input({ relays })), []);
  // 다른 head의 같은 type은 새 카드
  assert.equal(relayOffersOf(snap([pr(5, ["dirty"], { head: "new1234567" })]), input({ relays })).length, 1);
});

test("GO AROUND가 나갔으면(그 STAND의 CLEARANCE) 카드가 없다", () => {
  const first = relayOffersOf(snap([pr(5, ["dirty"])]), input())[0]!;
  const c = { id: "C-1", type: "GO AROUND", text: first.text, at: iso(-1), stand: `${WT}/atc-5`, flight: "ATC-5" } as Clearance;
  assert.deepEqual(relayOffersOf(snap([pr(5, ["dirty"])]), input({ clearances: [c] })), []);
});

test("제안하는 AIRCRAFT는 lastAircraftOf의 것(모르면 null)", () => {
  const la: LastAircraftInput = { ...NONE, departures: [{ t: iso(-50), flight: "ATC-5", aircraft: "TEAM_E" }] };
  assert.equal(relayOffersOf(snap([pr(5, ["dirty"])]), input({ lastAircraft: la }))[0]!.to, "TEAM_E");
  assert.equal(relayOffersOf(snap([pr(5, ["dirty"])]), input())[0]!.to, null);
});

test("lastAircraftOf: DEPARTURE LOG 최신, 없으면 departed 제안, 없으면 마지막 ARRIVED 보고, 아니면 null", () => {
  const dep = (t: string, aircraft: string | null) => ({ t, flight: "ATC-5", aircraft });
  assert.equal(lastAircraftOf("ATC-5", { ...NONE, departures: [dep(iso(-60), "TEAM_A"), dep(iso(-30), "team_b"), dep(iso(-10), null)] }), "TEAM_B");
  const prop = (id: string, over: object) => ({ id, kind: "ASSIGN", flight: "ATC-5", status: "approved", registration: null, aircraftName: null, statusAt: iso(0), timeline: {}, ...over });
  const withProps: LastAircraftInput = {
    ...NONE,
    regOf: (n) => (n === "Team C" ? "TEAM_C" : null),
    proposals: [prop("D-1", { registration: "TEAM_X" }), prop("D-2", { aircraftName: "Team C", timeline: { departed: iso(-40) } })],
  };
  assert.equal(lastAircraftOf("ATC-5", withProps), "TEAM_C");
  const rep: LastAircraftInput = { ...NONE, proposals: [prop("D-3", { registration: "TEAM_D" })], reports: [{ flight: "ATC-5", at: iso(-5), proposal: "D-3" }] };
  assert.equal(lastAircraftOf("ATC-5", rep), "TEAM_D");
  assert.equal(lastAircraftOf("ATC-5", NONE), null);
  assert.equal(lastAircraftOf(null, withProps), null);
  assert.equal(lastAircraftOf("ATC-9", withProps), null);
});

test("relayInputOf: type은 지시·pr·flight가 있어야 하고 stand는 type과만", () => {
  const ok = relayInputOf({ to: "TEAM_E", kind: "instruction", text: "GO AROUND: x", flight: "ATC-5", pr: 5, type: "GO AROUND", stand: `${WT}/atc-5` });
  assert.ok(!("error" in ok));
  if (!("error" in ok)) assert.deepEqual([ok.type, ok.stand], ["GO AROUND", `${WT}/atc-5`]);
  assert.ok("error" in relayInputOf({ to: "TEAM_E", kind: "info", text: "x", flight: "ATC-5", pr: 5, type: "FIX" }));
  assert.ok("error" in relayInputOf({ to: "TEAM_E", kind: "instruction", text: "x", flight: null, pr: null, type: "FIX" }));
  assert.ok("error" in relayInputOf({ to: "TEAM_E", kind: "instruction", text: "x", flight: "ATC-5", pr: 5, type: "LAND" }));
  assert.ok("error" in relayInputOf({ to: "TEAM_E", kind: "instruction", text: "x", flight: "ATC-5", pr: 5, stand: `${WT}/atc-5` }));
});

test("clearanceTypeOf와 brief: type이 있으면 그 type, stand를 싣는다", () => {
  assert.equal(clearanceTypeOf({ kind: "instruction", pr: 5, type: "GO AROUND" }), "GO AROUND");
  assert.equal(clearanceTypeOf({ kind: "instruction", pr: 5 }), "FIX");
  const r = { id: "R-0001", to: "TEAM_E", kind: "instruction", type: "GO AROUND", stand: `${WT}/atc-5`, flight: "ATC-5", pr: 5, text: "GO AROUND: x", status: "queued", at: iso(0), statusAt: iso(0) } as Relay;
  const [b] = relayBriefOf([r], T0);
  assert.equal(b!.type, "GO AROUND");
  assert.equal((b as { stand?: string }).stand, `${WT}/atc-5`);
  assert.equal("stand" in relayBriefOf([{ ...r, stand: undefined, type: undefined }], T0)[0]!, false);
});

test("SUPERVISOR QUEUE: RELAY 카드 하나, offer가 없어지면 사라진다", () => {
  const base = { proposals: [], schedule: { mode: "off", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 30 } as unknown as QueueInput;
  const offers = relayOffersOf(snap([pr(5, ["dirty"])]), input());
  const items = supervisorQueueOf({ ...base, relayOffers: offers }, T0);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind, "RELAY");
  assert.equal(items[0]!.hash, "#pr/ATCC/5");
  assert.equal(items[0]!.offer!.text, offers[0]!.text);
  assert.equal(supervisorQueueOf({ ...base, relayOffers: [] }, T0).length, 0);
});
