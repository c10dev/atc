import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { DEFAULT_DISPATCH_CONFIG, planDispatch } from "./dispatch.ts";
import type { Session, Snapshot, Ticket } from "./model.ts";
import {
  attestedCounts,
  attestedRelease,
  bulkTargets,
  chatReleaseKeys,
  foldReleases,
  NOT_RELEASED_WHY,
  releaseGateOn,
  releaseHashOf,
  releaseStateOf,
  sectionsOf,
  STALE_RELEASE_WHY,
  screenRelease,
  type ReleaseLine,
} from "./release.ts";
import { mountReleases, newProposalsOf, releaseFromChat, releaseView, type ReleaseDeps } from "./release-run.ts";

const BODY = "## Goal\n\nShip it.\n\n## Done when\n\n* A\n* B\n\n## K effects\n\n* K3: tightening\n\n## Context\n\nnotes";

test("본문 해시: 목표·완료 기준·K 효과만 본다. 맥락이 바뀌어도 같고, 목표가 바뀌면 다르다", () => {
  const h = releaseHashOf(BODY);
  assert.match(h!, /^[0-9a-f]{16}$/);
  assert.equal(releaseHashOf(BODY.replace("notes", "other notes")), h);
  assert.notEqual(releaseHashOf(BODY.replace("Ship it.", "Ship it twice.")), h);
  assert.notEqual(releaseHashOf(BODY.replace("K3: tightening", "K1: migration")), h);
  assert.deepEqual(sectionsOf(BODY), { goal: "Ship it.", doneWhen: "* A * B", k: "* K3: tightening" });
});

test("본문 해시: 절이 없으면 본문 전체, 본문이 없으면 null", () => {
  assert.notEqual(releaseHashOf("free text"), releaseHashOf("free text 2"));
  assert.equal(releaseHashOf(""), null);
  assert.equal(releaseHashOf(null), null);
});

const rel = (flight: string, hash: string, over: Partial<Extract<ReleaseLine, { op: "release" }>> = {}): ReleaseLine => ({ op: "release", flight, channel: "screen", at: "2026-10-02T00:00:00.000Z", hash, ...over });

test("접기: FLIGHT마다 가장 나중 발권, 첫 arm 시각", () => {
  const v = foldReleases([rel("A-1", "h1"), { op: "arm", at: "t1", flights: 1 }, rel("A-1", "h2", { channel: "attested", session: "ENG", words: "go" }), { op: "arm", at: "t2", flights: 1 }]);
  assert.equal(v.armedAt, "t1");
  assert.equal(v.records["A-1"]!.hash, "h2");
  assert.equal(v.records["A-1"]!.channel, "attested");
});

test("gate: auto는 arm 뒤부터, on은 항상, off는 끔", () => {
  assert.equal(releaseGateOn("auto", null), false);
  assert.equal(releaseGateOn("auto", "t"), true);
  assert.equal(releaseGateOn("on", null), true);
  assert.equal(releaseGateOn("off", "t"), false);
});

test("발권 상태: 기록 없음, 해시가 같음, 본문이 바뀜(stale)", () => {
  const v = foldReleases([rel("A-1", "h1")]);
  assert.equal(releaseStateOf("A-2", "h1", v), "unreleased");
  assert.equal(releaseStateOf("A-1", "h1", v), "released");
  assert.equal(releaseStateOf("A-1", "h9", v), "stale");
  assert.equal(releaseStateOf("A-1", null, v), "released");
});

const tk = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 2,
  url: null, updatedAt: null, project: "Beta", labels: [], createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [],
  releaseHash: `hash-${key}`, ...over,
});

test("화면 발권: 보인 해시와 지금 해시가 다르면 거절, Todo가 아니면 거절", () => {
  const at = new Date("2026-10-02T00:00:00Z");
  const ok = screenRelease(tk("ATC-1"), "ATC-1", "hash-ATC-1", "click", at);
  assert.ok(ok.ok && ok.value.op === "release" && ok.value.channel === "screen" && ok.value.via === "click");
  assert.equal(screenRelease(tk("ATC-1"), "ATC-1", "old", "click", at).ok, false);
  assert.equal(screenRelease(tk("ATC-1", { stateType: "started" }), "ATC-1", undefined, "click", at).ok, false);
  assert.equal(screenRelease(undefined, "ATC-1", undefined, "click", at).ok, false);
  assert.equal(screenRelease(tk("ATC-1", { releaseHash: null }), "ATC-1", undefined, "click", at).ok, false);
});

test("DUTY 채팅 글: RELEASE·발권 줄의 key만 읽는다", () => {
  assert.deepEqual(chatReleaseKeys("RELEASE ATC-362 ATC-363"), ["ATC-362", "ATC-363"]);
  assert.deepEqual(chatReleaseKeys("좋아요\n발권 ATC-5, ATC-6\n감사"), ["ATC-5", "ATC-6"]);
  assert.deepEqual(chatReleaseKeys("ATC-362를 release 해 줘"), []);
  assert.deepEqual(chatReleaseKeys("please release ATC-1 later"), []);
});

test("attested: 세션과 말이 필요하고 세션마다 센다", () => {
  const at = new Date("2026-10-02T00:00:00Z");
  assert.equal(attestedRelease(tk("ATC-1"), { flight: "ATC-1", session: "", words: "go" }, at).ok, false);
  assert.equal(attestedRelease(tk("ATC-1"), { flight: "ATC-1", session: "ENG" }, at).ok, false);
  const r = attestedRelease(tk("ATC-1"), { flight: "ATC-1", session: "ENGINEERING", words: "발권해 줘" }, at);
  assert.ok(r.ok && r.value.op === "release" && r.value.channel === "attested");
  assert.deepEqual(attestedCounts([r.ok ? r.value : rel("x", "y"), rel("A", "h")]), { ENGINEERING: 1 });
});

test("일괄 확인 대상: 시작 전이고 발권이 없거나 낡은 FLIGHT", () => {
  const v = foldReleases([rel("ATC-1", "hash-ATC-1"), rel("ATC-2", "old")]);
  assert.deepEqual(bulkTargets([tk("ATC-1"), tk("ATC-2"), tk("ATC-3"), tk("ATC-4", { stateType: "started" })], v).map((t) => t.key), ["ATC-2", "ATC-3"]);
});

// ── DISPATCH ──
const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const session = (): Session => ({ id: "a", agent: "claude", name: "TEAM_A", status: "idle", pid: 1, cwd: "/r", startedAt: "2026-10-01T00:00:00Z", lastActiveAt: "2026-10-02T11:00:00Z", repo: "/r", workspacePath: "/r" });
const snap = (tickets: Ticket[], releases?: Snapshot["releases"]): Snapshot => ({
  at: new Date(NOW).toISOString(), linear: { enabled: true, error: null, fetchedAt: null }, github: { enabled: true, error: null, fetchedAt: null }, pulls: [], atfm: { mains: [], groundStops: [] },
  sessions: [session()], workspaces: [], tickets, columns: [], claims: [], handoffs: [], alerts: [], clearances: [], airports: [{ id: "r", code: "ATCC", name: "atc", repo: "/r" }], ...(releases ? { releases } : {}),
});
const cfg = (releaseGate: "auto" | "on" | "off") => ({ ...DEFAULT_DISPATCH_CONFIG, releaseGate, candidateTeams: ["ATC"], projectAirports: { Beta: "ATCC" }, teamAirports: { ATC: "ATCC" } });
const plan = (s: Snapshot, mode: "auto" | "on" | "off") => planDispatch(s, new Map(), cfg(mode), NOW);

test("DISPATCH: gate가 꺼져 있으면(auto, arm 전) 발권 없이도 배정한다", () => {
  const p = plan(snap([tk("ATC-1")]), "auto");
  assert.equal(p.assign.length, 1);
});

test("DISPATCH: gate가 켜지면 발권 없는 FLIGHT는 이유와 함께 빠지고, 발권한 FLIGHT만 배정한다", () => {
  const releases = foldReleases([rel("ATC-1", "hash-ATC-1"), { op: "arm", at: "t", flights: 1 }]);
  const p = plan(snap([tk("ATC-1"), tk("ATC-2")], releases), "auto");
  assert.deepEqual(p.assign.map((a) => a.flight), ["ATC-1"]);
  assert.deepEqual(p.excluded.filter((e) => e.flight === "ATC-2").map((e) => e.reason), [NOT_RELEASED_WHY]);
});

test("DISPATCH: 발권 뒤 본문이 바뀐 FLIGHT는 다시 발권해야 한다. on은 arm 없이도 막고 off는 끈다", () => {
  const releases = foldReleases([rel("ATC-1", "old")]);
  const s = snap([tk("ATC-1")], releases);
  assert.deepEqual(plan(s, "on").excluded.map((e) => e.reason), [STALE_RELEASE_WHY]);
  assert.equal(plan(s, "off").assign.length, 1);
  assert.equal(plan(snap([tk("ATC-1")]), "on").assign.length, 0);
});

// ── 길 ──
function harness(tickets: Ticket[]) {
  const lines: ReleaseLine[] = [];
  const deps: ReleaseDeps = {
    snapshot: async () => snap(tickets),
    lines: () => lines,
    append: (l) => void lines.push(...l),
    now: () => new Date("2026-10-02T00:00:00Z"),
    gateMode: () => "auto",
    teams: () => new Set(["ATC"]),
  };
  const app = new Hono();
  mountReleases(app, deps.snapshot, deps);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { app, deps, lines, post };
}
const FROM_SCREEN = { origin: "http://localhost:7700" };

test("길: Origin 없는 요청(agent·CLI)은 화면 발권도 일괄 확인도 만들 수 없다", async () => {
  const h = harness([tk("ATC-1")]);
  assert.equal((await h.post("/api/releases", { flight: "ATC-1" })).status, 403);
  assert.equal((await h.post("/api/releases/bulk", { flights: [{ key: "ATC-1", hash: "hash-ATC-1" }] })).status, 403);
  assert.equal((await h.post("/api/releases", { flight: "ATC-1" }, { origin: "https://evil.example" })).status, 403);
  assert.equal(h.lines.length, 0);
});

test("길: 화면 클릭은 screen 채널로 한 줄 적는다", async () => {
  const h = harness([tk("ATC-1")]);
  const r = await h.post("/api/releases", { flight: "ATC-1", hash: "hash-ATC-1" }, FROM_SCREEN);
  assert.equal(r.status, 200);
  assert.deepEqual(h.lines.map((l) => (l.op === "release" ? [l.flight, l.channel, l.hash] : l.op)), [["ATC-1", "screen", "hash-ATC-1"]]);
});

test("길: 일괄 확인은 화면이 보여 준 목록만, 한 번에 발권하고 gate를 켠다(arm)", async () => {
  const h = harness([tk("ATC-1"), tk("ATC-2"), tk("ATC-3")]);
  const r = await h.post("/api/releases/bulk", { flights: [{ key: "ATC-1", hash: "hash-ATC-1" }, { key: "ATC-2", hash: "stale" }, { key: "ATC-9", hash: "x" }] }, FROM_SCREEN);
  assert.equal(r.status, 200);
  const j = (await r.json()) as { released: number; skipped: { key: string }[] };
  assert.equal(j.released, 1);
  assert.deepEqual(j.skipped.map((s) => s.key), ["ATC-2", "ATC-9"]);
  const v = foldReleases(h.lines);
  assert.ok(v.armedAt);
  assert.deepEqual(Object.keys(v.records), ["ATC-1"]);
  assert.equal(releaseView(snap([tk("ATC-1"), tk("ATC-2"), tk("ATC-3")]), h.deps).unreleased.length, 2);
});

test("길: attested는 Origin 없이도 되지만 attested로 표시되고 세션이 남는다", async () => {
  const h = harness([tk("ATC-1")]);
  assert.equal((await h.post("/api/releases/attest", { flight: "ATC-1", session: "ENGINEERING" })).status, 400);
  const r = await h.post("/api/releases/attest", { flight: "ATC-1", session: "ENGINEERING", words: "발권해 줘" });
  assert.equal(r.status, 200);
  const l = h.lines[0]!;
  assert.ok(l.op === "release" && l.channel === "attested" && l.session === "ENGINEERING");
  assert.deepEqual(releaseView(snap([tk("ATC-1")]), h.deps).attested, { ENGINEERING: 1 });
});

test("길: attest로 screen 채널을 흉내 낼 수 없다(channel 값은 읽지 않는다)", async () => {
  const h = harness([tk("ATC-1")]);
  await h.post("/api/releases/attest", { flight: "ATC-1", session: "S", words: "w", channel: "screen" });
  assert.ok(h.lines[0]!.op === "release" && (h.lines[0] as { channel: string }).channel === "attested");
});

test("접기: 거둔 발권은 제안으로 돌아오고 이유가 남으며, 다시 발권하면 지운다(ATC-368)", () => {
  const v = foldReleases([rel("A-1", "h1"), { op: "revoke", flight: "A-1", at: "t", reason: "리허설 멈춤", by: "migration-rehearsal" }]);
  assert.equal(releaseStateOf("A-1", "h1", v), "unreleased");
  assert.equal(v.revoked?.["A-1"]?.reason, "리허설 멈춤");
  const again = foldReleases([rel("A-1", "h1"), { op: "revoke", flight: "A-1", at: "t", reason: "x", by: "m" }, rel("A-1", "h1")]);
  assert.equal(releaseStateOf("A-1", "h1", again), "released");
  assert.equal(again.revoked?.["A-1"], undefined);
});

test("DUTY 채팅 글: RELEASE 줄이 있으면 duty-chat 채널로 적는다", async () => {
  const h = harness([tk("ATC-1"), tk("ATC-2", { stateType: "started" })]);
  const keys = await releaseFromChat("RELEASE ATC-1 ATC-2", h.deps.snapshot, h.deps);
  assert.deepEqual(keys, ["ATC-1"]);
  assert.ok(h.lines[0]!.op === "release" && (h.lines[0] as { channel: string }).channel === "duty-chat");
  assert.deepEqual(await releaseFromChat("ATC-1 어때요?", h.deps.snapshot, h.deps), []);
});

// ── RELEASE 화면(ATC-376) ──
const backlog = (key: string, over: Partial<Ticket> = {}) => tk(key, { state: "Backlog", stateType: "backlog", blockedBy: ["ATC-90"], ...over });
const done = (key: string) => tk(key, { state: "Done", stateType: "completed" });

test("화면 자료: READY Backlog(막는 FLIGHT가 모두 끝난 것)만 후보, K 효과를 클릭 전에 싣는다", () => {
  const h = harness([]);
  const s = snap([done("ATC-90"), backlog("ATC-1", { kEffects: "K3: tightening" }), backlog("ATC-2", { blockedBy: [] }), backlog("ATC-3", { blockedBy: ["ATC-91"] }), tk("ATC-91", { state: "Started", stateType: "started" })]);
  const v = releaseView(s, { ...h.deps, proposals: () => [] });
  assert.deepEqual(v.ready.map((r) => [r.key, r.kEffects, r.state]), [["ATC-1", "K3: tightening", "ready"]]);
});

test("화면 자료: 에이전트 제안(SCHEDULE NEW 초안)과 최근 발권·채널별 7일 수", () => {
  const h = harness([]);
  const s = snap([tk("ATC-5", { title: "Five" }), tk("ATC-6")]);
  const lines: ReleaseLine[] = [
    rel("ATC-5", "hash-ATC-5", { at: "2026-10-01T10:00:00.000Z" }),
    rel("ATC-6", "hash-ATC-6", { at: "2026-10-01T11:00:00.000Z", channel: "duty-chat" }),
    rel("ATC-7", "x", { at: "2026-09-01T00:00:00.000Z", channel: "attested", session: "ENGINEERING" }),
  ];
  const proposals = newProposalsOf([
    { id: "S-1", kind: "NEW", status: "agreed", reason: "r", payload: { title: "New thing", body: "## Goal\n\ng\n\n## K effects\n\nK2: switch", priority: 2 } },
    { id: "S-2", kind: "NEW", status: "rejected", reason: "r", payload: { title: "Gone", body: "" } },
    { id: "S-3", kind: "CLASSIFY", status: "draft", reason: "r", payload: {} },
  ]);
  const v = releaseView(s, { ...h.deps, lines: () => lines, proposals: () => proposals });
  assert.deepEqual(v.proposals.map((p) => [p.id, p.title, p.kEffects, p.priority]), [["S-1", "New thing", "K2: switch", 2]]);
  assert.deepEqual(v.recent.map((r) => [r.key, r.channel, r.title]), [["ATC-6", "duty-chat", "ATC-6"], ["ATC-5", "screen", "Five"], ["ATC-7", "attested", null]]);
  assert.deepEqual(v.channels, { screen: 1, "duty-chat": 1, attested: 0 });
});

function fireHarness(tickets: Ticket[], moveToTodo: NonNullable<ReleaseDeps["moveToTodo"]>) {
  const h = harness(tickets);
  h.deps.moveToTodo = moveToTodo;
  const app = new Hono();
  mountReleases(app, h.deps.snapshot, h.deps);
  const post = (body: unknown, headers: Record<string, string> = FROM_SCREEN) =>
    app.request("/api/releases/fire", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { h, post };
}

test("발권 fire: Origin 없으면 403, READY가 아니면 409, 우선순위 없으면 옮기지 않는다", async () => {
  const moved: string[] = [];
  const { h, post } = fireHarness([done("ATC-90"), backlog("ATC-1"), backlog("ATC-2", { priority: 0 }), backlog("ATC-3", { blockedBy: [] })], async (k) => (moved.push(k), { ok: true }));
  assert.equal((await post({ flight: "ATC-1" }, {})).status, 403);
  assert.equal((await post({ flight: "ATC-3" })).status, 409); // 막는 FLIGHT 없음 = READY 아님
  const noPrio = await post({ flight: "ATC-2" });
  assert.equal(noPrio.status, 409);
  assert.match(((await noPrio.json()) as { error: string }).error, /우선순위/);
  assert.equal((await post({ flight: "ATC-1", hash: "stale" })).status, 409);
  assert.deepEqual(moved, []);
  assert.equal(h.lines.length, 0);
});

test("발권 fire: Todo로 옮긴 뒤 screen 발권을 적는다. 옮기기가 실패하면 발권도 없다", async () => {
  const moves: [string, string][] = [];
  let fail = true;
  const { h, post } = fireHarness([done("ATC-90"), backlog("ATC-1")], async (k, from) => (moves.push([k, from]), fail ? { ok: false, status: 502, error: "linear down" } : { ok: true }));
  assert.equal((await post({ flight: "ATC-1", hash: "hash-ATC-1" })).status, 502);
  assert.equal(h.lines.length, 0);
  fail = false;
  assert.equal((await post({ flight: "ATC-1", hash: "hash-ATC-1" })).status, 200);
  assert.deepEqual(moves, [["ATC-1", "Backlog"], ["ATC-1", "Backlog"]]);
  assert.deepEqual(h.lines.map((l) => (l.op === "release" ? [l.flight, l.channel, l.via] : l.op)), [["ATC-1", "screen", "click"]]);
});

// ATC-391: attested 발권의 K 효과 확인(화면 클릭만)
const K3 = [{ label: "Security Weaken" as const, control: "hook for x", files: ["hooks/x.mjs"] }];

test("길: k-confirm은 Origin 없는 요청을 받지 않고, 화면 클릭만 attested 발권에 K 확인 한 줄을 적는다", async () => {
  const h = harness([tk("ATC-1", { k3: K3 })]);
  await h.post("/api/releases/attest", { flight: "ATC-1", session: "OCC", words: "release it" });
  assert.equal((await h.post("/api/releases/k-confirm", { flight: "ATC-1", hash: "hash-ATC-1" })).status, 403);
  assert.equal((await h.post("/api/releases/k-confirm", { flight: "ATC-1", hash: "hash-ATC-1" }, { origin: "https://evil.example" })).status, 403);
  assert.equal(h.lines.length, 1);
  const r = await h.post("/api/releases/k-confirm", { flight: "ATC-1", hash: "hash-ATC-1" }, FROM_SCREEN);
  assert.equal(r.status, 200);
  assert.deepEqual(h.lines.map((l) => l.op), ["release", "k-confirm"]);
  assert.equal(foldReleases(h.lines).records["ATC-1"]!.kConfirm?.hash, "hash-ATC-1");
  assert.equal((await h.post("/api/releases/k-confirm", { flight: "ATC-1", hash: "hash-ATC-1" }, FROM_SCREEN)).status, 409); // 이미 확인
});

test("길: K 선언이 없거나 attested가 아니거나 없는 FLIGHT의 발권은 K 확인을 받지 않는다", async () => {
  const h = harness([tk("ATC-1"), tk("ATC-2", { k3: K3 })]);
  await h.post("/api/releases/attest", { flight: "ATC-1", session: "OCC", words: "w" });
  assert.equal((await h.post("/api/releases/k-confirm", { flight: "ATC-1", hash: "hash-ATC-1" }, FROM_SCREEN)).status, 409); // 선언 없음
  await h.post("/api/releases", { flight: "ATC-2", hash: "hash-ATC-2" }, FROM_SCREEN);
  assert.equal((await h.post("/api/releases/k-confirm", { flight: "ATC-2", hash: "hash-ATC-2" }, FROM_SCREEN)).status, 409); // screen 발권은 확인이 필요 없다
  assert.equal((await h.post("/api/releases/k-confirm", { flight: "ATC-9", hash: "x" }, FROM_SCREEN)).status, 404);
});

test("RELEASE 화면 자료: K 효과를 선언한 attested 발권만 kPending에 오르고, 확인하면 빠진다", async () => {
  const tickets = [tk("ATC-1", { k3: K3, kEffects: "K3[Security Weaken]: hook for x | files: hooks/x.mjs" }), tk("ATC-2")];
  const h = harness(tickets);
  await h.post("/api/releases/attest", { flight: "ATC-1", session: "OCC", words: "release" });
  await h.post("/api/releases/attest", { flight: "ATC-2", session: "OCC", words: "release" });
  assert.deepEqual(releaseView(snap(tickets), h.deps).kPending.map((r) => r.key), ["ATC-1"]);
  await h.post("/api/releases/k-confirm", { flight: "ATC-1", hash: "hash-ATC-1" }, FROM_SCREEN);
  assert.deepEqual(releaseView(snap(tickets), h.deps).kPending, []);
});

// ── 제안(ATC-401): DUTY REVIEW·SCHEDULE NEW가 Backlog에 올린 이슈를 RELEASE 화면이 보이고 한 번의 클릭으로 쏘거나 버린다 ──
const SRC = (...keys: string[]) => () => new Map(keys.map((k) => [k, { by: "DUTY REVIEW R-0007", at: "2026-10-02T08:00:00.000Z" }]));

test("제안(ATC-401): 막는 이슈가 없는 DUTY REVIEW 제안은 목록에 들어 쏘면 Todo로 옮기고 screen 발권을 적는다", async () => {
  const moved: [string, string][] = [];
  const { h, post } = fireHarness([backlog("ATC-1", { blockedBy: [], kEffects: "K3: x" })], async (k, from) => (moved.push([k, from]), { ok: true }));
  h.deps.proposalSources = SRC("ATC-1");
  const v = releaseView(snap([backlog("ATC-1", { blockedBy: [], kEffects: "K3: x" })]), h.deps);
  assert.deepEqual(v.filed.map((f) => [f.key, f.by, f.at, f.priority, f.kEffects]), [["ATC-1", "DUTY REVIEW R-0007", "2026-10-02T08:00:00.000Z", 2, "K3: x"]]);
  assert.equal(v.ready.length, 0, "READY에 이중으로 오르지 않는다");
  assert.equal((await post({ flight: "ATC-1", hash: "hash-ATC-1" })).status, 200);
  assert.deepEqual(moved, [["ATC-1", "Backlog"]]);
  assert.deepEqual(h.lines.map((l) => (l.op === "release" ? [l.flight, l.channel] : l.op)), [["ATC-1", "screen"]]);
});

test("제안(ATC-401): 열린 이슈가 막는 제안은 목록에 없고 쏠 수도 없다. 막는 이슈가 끝나면 나타난다", async () => {
  const open = [tk("ATC-9", { state: "In Progress", stateType: "started" }), backlog("ATC-1", { blockedBy: ["ATC-9"] })];
  const { h, post } = fireHarness(open, async () => ({ ok: true }));
  h.deps.proposalSources = SRC("ATC-1");
  const v = releaseView(snap(open), h.deps);
  assert.deepEqual([v.filed.length, v.ready.length], [0, 0]);
  assert.equal((await post({ flight: "ATC-1" })).status, 409);
  assert.equal(h.lines.length, 0);
  const freed = releaseView(snap([done("ATC-9"), backlog("ATC-1", { blockedBy: ["ATC-9"] })]), h.deps);
  assert.deepEqual(freed.filed.map((f) => f.key), ["ATC-1"], "막는 이슈가 끝나면 제안으로 나타난다(READY와 이중이 아니다)");
  assert.equal(freed.ready.length, 0);
});

test("제안(ATC-401): SUPERVISOR가 만든 Backlog 이슈는 제안으로 나오지 않는다(막는 이슈가 끝난 것은 READY로만)", () => {
  const h = harness([]);
  h.deps.proposalSources = SRC("ATC-1");
  const mine = [done("ATC-90"), backlog("ATC-5", { blockedBy: ["ATC-90"] }), backlog("ATC-6", { blockedBy: [] }), backlog("ATC-1", { blockedBy: [] })];
  const v = releaseView(snap(mine), h.deps);
  assert.deepEqual(v.filed.map((f) => f.key), ["ATC-1"]);
  assert.deepEqual(v.ready.map((r) => r.key), ["ATC-5"]);
});

test("제안(ATC-401): 우선순위가 없는 제안은 옮기지 않고 사유를 말한다", async () => {
  const moved: string[] = [];
  const t = backlog("ATC-1", { blockedBy: [], priority: 0 });
  const { h, post } = fireHarness([t], async (k) => (moved.push(k), { ok: true }));
  h.deps.proposalSources = SRC("ATC-1");
  const r = await post({ flight: "ATC-1", hash: "hash-ATC-1" });
  assert.equal(r.status, 409);
  assert.match(((await r.json()) as { error: string }).error, /우선순위/);
  assert.deepEqual(moved, []);
  assert.equal(h.lines.length, 0);
  assert.equal(releaseView(snap([t]), h.deps).filed[0]!.priority, 0, "목록에는 있고 화면이 우선순위가 없다고 말한다");
});

function discardHarness(tickets: Ticket[], discard: NonNullable<ReleaseDeps["discard"]>) {
  const h = harness(tickets);
  h.deps.discard = discard;
  h.deps.proposalSources = SRC("ATC-1");
  const app = new Hono();
  mountReleases(app, h.deps.snapshot, h.deps);
  const post = (body: unknown, headers: Record<string, string> = FROM_SCREEN) =>
    app.request("/api/releases/discard", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { h, post };
}

test("제안 버리기(ATC-401): Origin이 있어야 하고, 제안이 아닌 이슈는 못 버리며, 사유를 줄여 넘긴다", async () => {
  const calls: [string, string, string][] = [];
  const { post } = discardHarness([backlog("ATC-1", { blockedBy: [] }), backlog("ATC-2", { blockedBy: [] })], async (k, from, reason) => (calls.push([k, from, reason]), { ok: true }));
  assert.equal((await post({ flight: "ATC-1" }, {})).status, 403);
  assert.equal((await post({ flight: "ATC-2" })).status, 409, "SUPERVISOR가 만든 이슈는 제안이 아니다");
  assert.equal((await post({ flight: "ATC-1", hash: "stale" })).status, 409);
  assert.deepEqual(calls, []);
  const ok = await post({ flight: "ATC-1", hash: "hash-ATC-1", reason: "  already\n covered   by ATC-12  " });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls, [["ATC-1", "Backlog", "already covered by ATC-12"]]);
  const none = await post({ flight: "ATC-1" });
  assert.equal(none.status, 200);
  assert.equal(calls[1]![2], "no reason given");
});

test("제안 버리기(ATC-401): 옮기기가 실패하면 실패를 그대로 돌려주고, 사유 댓글만 실패하면 경고와 함께 성공한다", async () => {
  const { post } = discardHarness([backlog("ATC-1", { blockedBy: [] })], async () => ({ ok: false, status: 502, error: "linear down" }));
  const bad = await post({ flight: "ATC-1" });
  assert.equal(bad.status, 502);
  assert.equal(((await bad.json()) as { error: string }).error, "linear down");
  const { post: p2 } = discardHarness([backlog("ATC-1", { blockedBy: [] })], async () => ({ ok: true, warning: "comment failed" }));
  const warn = await p2({ flight: "ATC-1" });
  assert.equal(warn.status, 200);
  assert.deepEqual(await warn.json(), { discarded: "ATC-1", warning: "comment failed" });
});
