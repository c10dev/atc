import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { AircraftState, Plan } from "./dispatch.ts";
import { DEFAULT_DISPATCH_CONFIG } from "./dispatch.ts";
import type { LandingBlockCode, PullRequest } from "./model.ts";
import { fold, formatFlightPlan, syncOps } from "./proposals.ts";
import { holderKey, holderLines, type HolderAircraft, holderOf, holderPlansOf, type HolderPlanInput } from "./pr-holder.ts";
import { offerKey, relayOffersOf } from "./relay-offer.ts";

const REPO = "/srv/repo";
const T0 = Date.parse("2026-10-02T04:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ac = (registration: string, over: Partial<HolderAircraft> = {}): HolderAircraft => ({ registration, airport: "ATCC", free: true, ratings: ["UI", "DATA", "DOCS"], reason: "PARKED", ...over });
const tickets = [
  { key: "ATC-5", labels: [] as string[] },
  { key: "ATC-6", labels: ["rating:SEC"] },
  { key: "ATC-7", labels: ["Risk:Security"] },
];
const base = (over: Partial<Parameters<typeof holderOf>[0]> = {}): Parameters<typeof holderOf>[0] => ({
  pull: { number: 5, branch: "claude/atc-5", ticketKey: "ATC-5" },
  airport: "ATCC",
  tickets,
  aircraft: [ac("TEAM_A"), ac("TEAM_B")],
  lastAircraftOf: () => null,
  keyFromBranch: () => null,
  ...over,
});
const regOf = (c: ReturnType<typeof holderOf>) => (c.kind === "assign" ? c.registration : c.kind);

test("그 FLIGHT를 난 AIRCRAFT가 이어받을 수 있으면 그것(resumed)", () => {
  const c = holderOf(base({ lastAircraftOf: () => "TEAM_B" }));
  assert.deepEqual(c, { kind: "assign", flight: "ATC-5", registration: "TEAM_B", resumed: true, launch: false, why: "flew ATC-5" });
});

test("난 AIRCRAFT가 바쁘면 놀고 있는 AIRCRAFT, 세션이 살아 있는 것이 먼저", () => {
  const c = holderOf(base({ lastAircraftOf: () => "TEAM_B", aircraft: [ac("TEAM_B", { free: false, reason: "AIRBORNE" }), ac("TEAM_A", { launch: true }), ac("TEAM_C")] }));
  assert.equal(regOf(c), "TEAM_C");
  assert.equal(c.kind === "assign" && c.resumed, false);
});

test("rating:SEC와 Risk FLIGHT는 그 TYPE RATING이 있는 AIRCRAFT에만", () => {
  const sec = ac("TEAM_S", { ratings: ["SEC", "DATA", "DOCS"] });
  for (const key of ["ATC-6", "ATC-7"]) {
    const pull = { number: 6, branch: "x", ticketKey: key };
    assert.equal(regOf(holderOf(base({ pull, aircraft: [ac("TEAM_A"), sec] }))), "TEAM_S");
    assert.equal(regOf(holderOf(base({ pull, aircraft: [ac("TEAM_A")] }))), "relay");
    // 난 AIRCRAFT가 rating이 없으면 이어받지 못한다
    assert.equal(regOf(holderOf(base({ pull, aircraft: [ac("TEAM_A")], lastAircraftOf: () => "TEAM_A" }))), "relay");
  }
});

test("다른 AIRPORT·멈춘 AIRCRAFT만 있으면 relay", () => {
  assert.equal(regOf(holderOf(base({ aircraft: [ac("TEAM_A", { airport: "OTHR" }), ac("TEAM_B", { free: false })] }))), "relay");
  assert.equal(regOf(holderOf(base({ aircraft: [] }))), "relay");
});

test("FLIGHT 없는 PR: 브랜치 이름으로 이슈를 찾으면 그것, 못 찾으면 duty", () => {
  const pull = { number: 9, branch: "feature/atc-5-thing", ticketKey: null };
  const linked = holderOf(base({ pull, keyFromBranch: () => "ATC-5" }));
  assert.equal(linked.kind === "assign" && linked.flight, "ATC-5");
  assert.equal(holderOf(base({ pull, keyFromBranch: () => "ATC-999" })).kind, "duty"); // 없는 이슈
  assert.equal(holderOf(base({ pull })).kind, "duty");
});

// ── holderPlansOf ──
const pr = (number: number, codes: LandingBlockCode[], over: Partial<PullRequest> = {}): PullRequest => ({
  repo: REPO, number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, branch: `claude/atc-${number}`, head: `h${number}abcdef0`, base: "main",
  ticketKey: `ATC-${number}`, standPath: `/w/atc-${number}`, draft: false, landing: "APPROACH", blocks: codes.map((code) => ({ code, text: code, en: code })), readyAt: null, createdAt: iso(-100 + number), ...over,
});
const state = (name: string, over: Partial<AircraftState> = {}): AircraftState => ({ id: name, name, callsign: name, airport: "ATCC", available: true, reason: "PARKED", reserved: null, ...over });
const snap = (pulls: PullRequest[], claims: unknown[] = []) => ({ pulls, claims, workspaces: [{ path: "/w/atc-5", name: "atc-5" }], airports: [{ repo: REPO, code: "ATCC" }], tickets }) as unknown as Parameters<typeof holderPlansOf>[0];
const flew: HolderPlanInput["lastAircraft"] = { departures: [{ t: iso(-60), flight: "ATC-5", aircraft: "TEAM_B" }], proposals: [], reports: [], regOf: () => null };
const hin = (over: Partial<HolderPlanInput> = {}): HolderPlanInput => ({
  clearances: [], events: [], existing: [], lastAircraft: flew, fleet: DEFAULT_FLEET, aircraft: [state("TEAM_A"), state("TEAM_B")], keyFromBranch: () => null, now: T0, ...over,
});

test("쥔 세션이 없는 충돌 PR → 난 AIRCRAFT에게 PR HOLDER 카드(GO AROUND 글 실림)", () => {
  const { plans, routes } = holderPlansOf(snap([pr(5, ["dirty"])]), hin());
  assert.equal(plans.length, 1);
  assert.equal(plans[0]!.registration, "TEAM_B");
  assert.equal(plans[0]!.prHolder!.type, "GO AROUND");
  assert.equal(plans[0]!.prHolder!.resumed, true);
  assert.equal(plans[0]!.prHolder!.stand, "/w/atc-5");
  assert.match(plans[0]!.prHolder!.text, /^GO AROUND: PR #5/);
  assert.equal(routes.get(offerKey(pr(5, []), "GO AROUND"))!.kind, "assign");
});

test("쥔 세션이 있으면 카드가 없고, 하나뿐인 AIRCRAFT는 한 PR에만", () => {
  assert.equal(holderPlansOf(snap([pr(5, ["dirty"])], [{ state: "active", workspacePath: "/w/atc-5" }]), hin()).plans.length, 0);
  const two = holderPlansOf(snap([pr(5, ["dirty"]), pr(6, ["dirty"], { standPath: null })]), hin({ lastAircraft: { ...flew, departures: [] }, aircraft: [state("TEAM_A")] }));
  assert.equal(two.plans.length, 1);
  assert.equal([...two.routes.values()].filter((r) => r.kind === "relay").length, 1);
});

test("이미 같은 head·type의 카드가 있으면(거절 포함) 또 내지 않고, superseded면 다시", () => {
  const first = holderPlansOf(snap([pr(5, ["dirty"])]), hin()).plans[0]!;
  const create = { op: "create" as const, id: "D-0001", at: iso(0), kind: "ASSIGN" as const, flight: "ATC-5", aircraft: "TEAM_B", aircraftName: "TEAM_B", airport: "ATCC", score: 0, factors: [], prHolder: first.prHolder };
  assert.equal(holderPlansOf(snap([pr(5, ["dirty"])]), hin({ existing: fold([create, { op: "reject", id: "D-0001", at: iso(1), reason: null }]) })).plans.length, 0);
  assert.equal(holderPlansOf(snap([pr(5, ["dirty"])]), hin({ existing: fold([create, { op: "supersede", id: "D-0001", at: iso(1), reason: "x" }]) })).plans.length, 1);
});

test("RELAY 카드는 relay로 간 PR에만, DUTY·AIRCRAFT가 맡으면 없다", () => {
  const s = snap([pr(5, ["dirty"])]);
  const oin = { clearances: [], events: [], relays: [], lastAircraft: flew, now: T0 };
  const none = holderPlansOf(s, hin({ aircraft: [] }));
  assert.equal(none.routes.get(offerKey(pr(5, []), "GO AROUND"))!.kind, "relay");
  assert.equal(relayOffersOf(s, { ...oin, holderRoutes: none.routes }).length, 1);
  const taken = holderPlansOf(s, hin());
  assert.equal(relayOffersOf(s, { ...oin, holderRoutes: taken.routes }).length, 0);
  assert.equal(relayOffersOf(s, { ...oin, holderRoutes: new Map() }).length, 0); // 아직 계산 전
  assert.equal(relayOffersOf(s, oin).length, 1); // 안 주면 지금처럼
});

test("FLIGHT가 없는 PR은 duty 경로(카드도 RELAY도 없다)", () => {
  const { plans, routes } = holderPlansOf(snap([pr(8, ["dirty"], { ticketKey: null, branch: "feature/x" })]), hin());
  assert.equal(plans.length, 0);
  assert.equal([...routes.values()][0]!.kind, "duty");
});

// ── 카드(syncOps)·FLIGHT PLAN ──
test("syncOps: 계획의 holders는 진행 중인 FLIGHT에도 카드가 되고, 계획에서 빠지면 SUPERSEDED", () => {
  const h = holderPlansOf(snap([pr(5, ["dirty"])]), hin());
  const plan = { at: iso(0), assign: [], release: [], hold: [], excluded: [], slots: [], aircraft: [state("TEAM_A"), state("TEAM_B")], holders: h.plans } as unknown as Plan;
  const s = { tickets: [{ key: "ATC-5", state: "In Progress", stateType: "started" }], workspaces: [] } as never;
  const ops = syncOps([], plan, s, DEFAULT_DISPATCH_CONFIG, T0, 0);
  assert.equal(ops.filter((o) => o.op === "create").length, 1);
  const existing = fold(ops);
  assert.equal(existing[0]!.prHolder!.key, holderKey(5, pr(5, []).head, "GO AROUND"));
  // 같은 계획이면 또 만들지 않고 닫지도 않는다
  assert.deepEqual(syncOps(existing, plan, s, DEFAULT_DISPATCH_CONFIG, T0 + 60_000, 1), []);
  // 계획에서 빠지면(쥔 세션이 생김 등) SUPERSEDED
  const gone = syncOps(existing, { ...plan, holders: [] }, s, DEFAULT_DISPATCH_CONFIG, T0 + 60_000, 1);
  assert.equal(gone.length, 1);
  assert.equal(gone[0]!.op, "supersede");
});

test("FLIGHT PLAN에 보류 중인 글이 실리고 머지하지 말라고 적힌다", () => {
  const h = holderPlansOf(snap([pr(5, ["dirty"])]), hin()).plans[0]!;
  const [p] = fold([{ op: "create", id: "D-0001", at: iso(0), kind: "ASSIGN", flight: "ATC-5", aircraft: "TEAM_B", aircraftName: "TEAM_B", airport: "ATCC", score: 0, factors: [], prHolder: h.prHolder }]);
  const text = formatFlightPlan(p!, undefined, "TEAM_B");
  assert.match(text, /PR HOLDER — PR #5/);
  assert.match(text, /Do not merge/);
  assert.match(text, /^> GO AROUND: PR #5/m);
  assert.ok(holderLines(h.prHolder!).length >= 3);
});
