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
import { mountReleases, releaseFromChat, releaseView, type ReleaseDeps } from "./release-run.ts";

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

test("DUTY 채팅 글: RELEASE 줄이 있으면 duty-chat 채널로 적는다", async () => {
  const h = harness([tk("ATC-1"), tk("ATC-2", { stateType: "started" })]);
  const keys = await releaseFromChat("RELEASE ATC-1 ATC-2", h.deps.snapshot, h.deps);
  assert.deepEqual(keys, ["ATC-1"]);
  assert.ok(h.lines[0]!.op === "release" && (h.lines[0] as { channel: string }).channel === "duty-chat");
  assert.deepEqual(await releaseFromChat("ATC-1 어때요?", h.deps.snapshot, h.deps), []);
});
