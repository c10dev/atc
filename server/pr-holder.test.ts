import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import type { AircraftState, Plan } from "./dispatch.ts";
import { DEFAULT_DISPATCH_CONFIG } from "./dispatch.ts";
import type { LandingBlockCode, PullRequest } from "./model.ts";
import { fold, formatFlightPlan, holderReadbackOf, syncOps } from "./proposals.ts";
import { holderKey, holderLines, type HolderAircraft, holderOf, holderPlansOf, type HolderPlanInput, MAX_TRIES, pendingSinceOf, RETRY_AFTER_MS } from "./pr-holder.ts";
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
  const rejected = holderPlansOf(snap([pr(5, ["dirty"])]), hin({ existing: fold([create, { op: "reject", id: "D-0001", at: iso(1), reason: null }]) }));
  assert.equal(rejected.plans.length, 0);
  assert.equal(rejected.routes.get(offerKey(pr(5, []), "GO AROUND"))!.kind, "wait"); // 거절하면 잠시 기다린다(SUPERVISOR 카드 없음, ATC-392)
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

test("두 번째 주기: 살아 있는 카드(판정 대기·승인됨)는 계획에 남아 SUPERSEDED되지 않는다", () => {
  const s = snap([pr(5, ["dirty"])]);
  const tk = { tickets: [{ key: "ATC-5", state: "In Progress", stateType: "started" }], workspaces: [] } as never;
  const run1 = holderPlansOf(s, hin());
  const mk = (plans: typeof run1.plans): Plan => ({ at: iso(0), assign: [], release: [], hold: [], excluded: [], slots: [], aircraft: [state("TEAM_A"), state("TEAM_B")], holders: plans }) as unknown as Plan;
  let existing = fold(syncOps([], mk(run1.plans), tk, DEFAULT_DISPATCH_CONFIG, T0, 0));
  assert.equal(existing.length, 1);
  for (const [min, extra] of [[5, []], [10, [{ op: "approve" as const, id: "D-0001", at: iso(6) }]], [15, []]] as const) {
    existing = fold([...existingOps(existing), ...extra]);
    const run = holderPlansOf(s, hin({ existing }));
    assert.equal(run.plans.length, 1, "살아 있는 카드가 계획에 남는다");
    assert.deepEqual(syncOps(existing, mk(run.plans), tk, DEFAULT_DISPATCH_CONFIG, T0 + min * 60_000, 1), []);
  }
});
// fold된 제안을 다시 ops로(테스트용): create 한 줄과 approve를 이어 붙이기 위해
const existingOps = (ps: ReturnType<typeof fold>) => ps.flatMap((p) => [{ op: "create" as const, id: p.id, at: p.at, kind: p.kind, flight: p.flight, aircraft: p.aircraft, aircraftName: p.aircraftName, registration: p.registration, airport: p.airport, score: p.score, factors: p.factors, prHolder: p.prHolder }, ...(p.status === "approved" ? [{ op: "approve" as const, id: p.id, at: p.statusAt }] : [])]);

test("열린 제안이나 이번 계획의 ASSIGN을 쥔 AIRCRAFT에는 카드를 얹지 않는다", () => {
  const s = snap([pr(5, ["dirty"])]);
  const none = hin({ lastAircraft: flew, aircraft: [state("TEAM_A"), state("TEAM_B")] });
  assert.equal(holderPlansOf(s, { ...none, assigned: ["TEAM_B"] }).plans[0]!.registration, "TEAM_A"); // 난 AIRCRAFT가 이번 계획에서 ASSIGN을 받음 → 다른 놀고 있는 것
  assert.equal(holderPlansOf(s, { ...none, assigned: ["TEAM_A", "TEAM_B"] }).plans.length, 0);
  const open = fold([{ op: "create", id: "D-0009", at: iso(0), kind: "ASSIGN", flight: "ATC-9", aircraft: "TEAM_B", aircraftName: "TEAM_B", registration: "TEAM_B", airport: "ATCC", score: 3, factors: [] }]);
  assert.equal(holderPlansOf(s, { ...none, existing: open }).plans[0]!.registration, "TEAM_A"); // 열린 ASSIGN 제안
  assert.equal(holderPlansOf(s, { ...none, existing: open, assigned: ["TEAM_A"] }).plans.length, 0);
  assert.equal(holderPlansOf(s, { ...none, existing: open, assigned: ["TEAM_A"] }).routes.get(offerKey(pr(5, []), "GO AROUND"))!.kind, "relay");
});

// ── ATC-392: 끝내고 나서 시작한다 ──
const ended = (first: ReturnType<typeof holderPlansOf>["plans"][number], n: number, endAt: number) =>
  fold(
    Array.from({ length: n }, (_, i) => [
      { op: "create" as const, id: `D-00${i + 1}`, at: iso(i), kind: "ASSIGN" as const, flight: "ATC-5", aircraft: "TEAM_B", aircraftName: "TEAM_B", airport: "ATCC", score: 0, factors: [], prHolder: first.prHolder },
      { op: "reject" as const, id: `D-00${i + 1}`, at: iso(endAt), reason: null },
    ]).flat(),
  );

test("거절·UNABLE로 끝난 카드는 같은 head에 일정 시간 뒤 다시 제안하고, 여러 번 끝나면 RELAY", () => {
  const first = holderPlansOf(snap([pr(5, ["dirty"])]), hin()).plans[0]!;
  const key = offerKey(pr(5, []), "GO AROUND");
  const existing = ended(first, 1, 1);
  const early = holderPlansOf(snap([pr(5, ["dirty"])]), hin({ existing, now: T0 + 10 * 60_000 }));
  assert.equal(early.plans.length, 0);
  assert.equal(early.routes.get(key)!.kind, "wait");
  assert.match(early.routes.get(key)!.why!, /retry in \d+m/);
  assert.equal(holderPlansOf(snap([pr(5, ["dirty"])]), hin({ existing, now: T0 + 60_000 + RETRY_AFTER_MS + 1 })).plans.length, 1, "시간이 지나면 다시");
  const many = holderPlansOf(snap([pr(5, ["dirty"])]), hin({ existing: ended(first, MAX_TRIES, 1), now: T0 + 10 * 3_600_000 }));
  assert.equal(many.plans.length, 0);
  assert.equal(many.routes.get(key)!.kind, "relay");
  assert.match(many.routes.get(key)!.why!, /ended/);
});

test("RELAY 사유: 그 AIRPORT에 AIRCRAFT 없음 → TYPE RATING 없음 → 못 받는 사유", () => {
  const why = (a: HolderAircraft[], flight = "ATC-5") => {
    const c = holderOf(base({ aircraft: a, pull: { number: 5, branch: "x", ticketKey: flight } }));
    return c.kind === "relay" ? c.why : "";
  };
  assert.equal(why([ac("TEAM_A", { airport: "OTHR" })]), "no AIRCRAFT at ATCC");
  assert.equal(why([ac("TEAM_A")], "ATC-6"), "no AIRCRAFT with SEC rating at ATCC");
  assert.equal(why([ac("TEAM_A", { free: false, reason: "LAUNCH 한도" })]), "none can take it now: TEAM_A LAUNCH 한도");
});

test("RELAY 카드는 사유를 싣는다", () => {
  const s = snap([pr(5, ["dirty"])]);
  const none = holderPlansOf(s, hin({ lastAircraft: { ...flew, departures: [] }, aircraft: [] }));
  const offers = relayOffersOf(s, { clearances: [], events: [], relays: [], lastAircraft: flew, now: T0, holderRoutes: none.routes });
  assert.equal(offers[0]!.noHolder, "no AIRCRAFT at ATCC");
});

test("필요해진 시각: GO AROUND는 그 head의 conflict 이벤트, FIX는 review-findings가 막힌 이벤트, 없으면 지금", () => {
  const p = { repo: REPO, number: 5, head: "abcdef1234" };
  const ev = (kind: string, at: string, over = {}) => ({ id: 1, at, kind, repo: "repo", pull: 5, ...over }) as never;
  assert.equal(pendingSinceOf(p, "GO AROUND", [ev("landing.conflict", iso(2), { head: "abcdef1" }), ev("landing.conflict", iso(3), { head: "other00" })], iso(9)), iso(2));
  assert.equal(pendingSinceOf(p, "FIX", [ev("landing.blocked", iso(4), { blocks: ["review-findings"] })], iso(9)), iso(4));
  assert.equal(pendingSinceOf(p, "FIX", [], iso(9)), iso(9));
});

test("holder READBACK 시간: 필요해진 시각부터 READBACK(accepted)까지, since 없는 카드는 세지 않는다", () => {
  const card = (id: string, since: string | undefined, accepted: string | undefined) => ({ id, prHolder: { pr: 5, type: "GO AROUND" as const, ...(since ? { since } : {}) } as never, timeline: accepted ? { accepted } : {} });
  const r = holderReadbackOf([card("D-1", iso(0), iso(6)), card("D-2", iso(0), iso(12)), card("D-3", undefined, iso(5)), card("D-4", iso(0), undefined)]);
  assert.equal(r.n, 2);
  assert.equal(r.medianMin, 9);
});
