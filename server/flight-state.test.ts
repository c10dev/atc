import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { isReady, makeCache, movesOf, shapeIssue } from "./detail.ts";
import { type MoveIssue, moveVerdict, parseMoveBody } from "./flight-state.ts";
import { mountFlightState, type StateDeps } from "./flight-state-run.ts";
import type { RecordLine } from "./recorder.ts";

// DUTY G3: READY, 상태 버튼이 옮길 수 있는 곳, 쓰기 길. Linear에는 아무것도 쓰지 않는다: 쓰기는 모두 stub이다.

const STATES = [
  { name: "Backlog", type: "backlog" }, { name: "Todo", type: "unstarted" }, { name: "In Progress", type: "started" },
  { name: "Done", type: "completed" }, { name: "Canceled", type: "canceled" },
];

test("READY: Backlog이고 막는 FLIGHT가 하나 이상이며 모두 Done·Canceled일 때만. 상태를 모르는 blocker가 있으면 아니다", () => {
  assert.equal(isReady("backlog", ["completed"]), true);
  assert.equal(isReady("backlog", ["completed", "canceled"]), true);
  assert.equal(isReady("backlog", ["completed", "started"]), false);
  assert.equal(isReady("backlog", ["unstarted"]), false);
  assert.equal(isReady("backlog", []), false); // 막는 것이 없으면 풀린 것이 아니라 그냥 Backlog
  assert.equal(isReady("backlog", ["completed", null]), false);
  for (const t of ["unstarted", "started", "completed", "canceled", null]) assert.equal(isReady(t, ["completed"]), false);
});

test("movesOf: 이 팀의 Backlog·Todo·Canceled 중 지금 상태를 뺀 곳. Started·Done에서는 없다", () => {
  assert.deepEqual(movesOf({ name: "Backlog", type: "backlog" }, STATES).map((m) => m.name), ["Todo", "Canceled"]);
  assert.deepEqual(movesOf({ name: "Todo", type: "unstarted" }, STATES).map((m) => m.name), ["Backlog", "Canceled"]);
  assert.deepEqual(movesOf({ name: "Canceled", type: "canceled" }, STATES).map((m) => m.name), ["Backlog", "Todo"]);
  assert.deepEqual(movesOf({ name: "In Progress", type: "started" }, STATES), []);
  assert.deepEqual(movesOf({ name: "Done", type: "completed" }, STATES), []);
  assert.deepEqual(movesOf({ name: null, type: null }, STATES), []);
});

test("이슈: ready와 moves를 싣는다(팀 상태 목록은 team.states.nodes)", () => {
  const d = shapeIssue({
    identifier: "ATC-207", title: "T", state: { name: "Backlog", type: "backlog" },
    team: { states: { nodes: STATES } },
    inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "ATC-206", title: "q", state: { name: "Done", type: "completed" } } }] },
  });
  assert.equal(d.ready, true);
  assert.deepEqual(d.moves.map((m) => m.name), ["Todo", "Canceled"]);
  const stuck = shapeIssue({ identifier: "ATC-207", state: { name: "Backlog", type: "backlog" }, inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "ATC-206", state: { name: "Todo", type: "unstarted" } } }] } });
  assert.equal(stuck.ready, false);
  assert.deepEqual(shapeIssue(null).moves, []);
});

test("캐시: forget은 그 항목만 버린다", async () => {
  let n = 0;
  const cache = makeCache<number>(60_000);
  assert.equal(await cache("a", async () => ++n), 1);
  assert.equal(await cache("a", async () => ++n), 1);
  cache.forget("a");
  assert.equal(await cache("a", async () => ++n), 2);
});

test("본문: {from, to}는 둘 다 상태 이름 문자열", () => {
  assert.deepEqual(parseMoveBody({ from: " Backlog ", to: "Todo" }), { ok: true, move: { from: "Backlog", to: "Todo" } });
  for (const bad of [null, {}, { from: "Backlog" }, { to: "Todo" }, { from: "", to: "Todo" }, { from: 1, to: "Todo" }, { from: "a", to: "b\nc" }, { from: "x".repeat(65), to: "Todo" }]) {
    assert.equal(parseMoveBody(bad).ok, false, JSON.stringify(bad));
  }
});

const issue = (over: Partial<MoveIssue> = {}): MoveIssue => ({
  id: "uuid-1", key: "ATC-207", team: "ATC", state: { name: "Backlog", type: "backlog" },
  states: STATES.map((s, i) => ({ id: `s${i}`, ...s })), ...over,
});

test("판정: 지금 상태가 from 그대로이고 to가 이 팀의 Backlog·Todo·Canceled일 때만", () => {
  const ok = moveVerdict(issue(), { from: "Backlog", to: "Todo" }, ["ATC"]);
  assert.deepEqual(ok.ok && [ok.stateId, ok.to.name], ["s1", "Todo"]);
  assert.equal(moveVerdict(issue(), { from: "Backlog", to: "Canceled" }, ["ATC"]).ok, true);
  // 상태가 이미 바뀜
  const moved = moveVerdict(issue({ state: { name: "Todo", type: "unstarted" } }), { from: "Backlog", to: "Canceled" }, ["ATC"]);
  assert.deepEqual([moved.ok, !moved.ok && moved.status], [false, 409]);
  // Started·Done으로는 옮기지 않는다
  for (const to of ["In Progress", "Done"]) assert.equal((moveVerdict(issue(), { from: "Backlog", to }, ["ATC"]) as { status: number }).status, 400);
  // Started·Done에서는 옮기지 않는다(from이 맞아도)
  const started = moveVerdict(issue({ state: { name: "In Progress", type: "started" } }), { from: "In Progress", to: "Todo" }, ["ATC"]);
  assert.deepEqual([started.ok, !started.ok && started.status], [false, 409]);
  // 없는 상태, 같은 상태
  assert.equal((moveVerdict(issue(), { from: "Backlog", to: "Nope" }, ["ATC"]) as { status: number }).status, 400);
  assert.equal((moveVerdict(issue(), { from: "Backlog", to: "Backlog" }, ["ATC"]) as { status: number }).status, 400);
  // atc가 읽지 않는 팀
  assert.equal((moveVerdict(issue({ team: "VOC" }), { from: "Backlog", to: "Todo" }, ["ATC"]) as { status: number }).status, 403);
  assert.equal((moveVerdict(issue({ team: null }), { from: "Backlog", to: "Todo" }, ["ATC"]) as { status: number }).status, 403);
});

// ── 길(stub) ──

function harness(over: Partial<StateDeps> = {}) {
  const calls: { apply: [string, string][]; forget: string[] } = { apply: [], forget: [] };
  const lines: RecordLine[] = [];
  const deps: StateDeps = {
    fetchIssue: async () => issue(),
    apply: async (id, stateId) => (calls.apply.push([id, stateId]), { name: "Todo", type: "unstarted" }),
    record: (l) => void lines.push(l),
    forget: (k) => void calls.forget.push(k),
    teams: ["ATC"],
    now: () => new Date("2026-09-30T12:00:00Z"),
    ...over,
  };
  const app = new Hono();
  mountFlightState(app, deps);
  const post = (key: string, body: unknown, headers: Record<string, string> = { origin: "http://localhost:7700", "content-type": "application/json" }) =>
    app.request(`/api/flight/${key}/state`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { post, calls, lines };
}

test("길: 이 화면에서 온 JSON 요청만. Origin이 없거나 다른 사이트거나 JSON이 아니면 403이고 아무것도 쓰지 않는다", async () => {
  const h = harness();
  const body = { from: "Backlog", to: "Todo" };
  const bad: Record<string, string>[] = [{ "content-type": "application/json" }, { origin: "https://evil.example", "content-type": "application/json" }, { origin: "http://localhost:7700" }];
  for (const headers of bad) {
    assert.equal((await h.post("ATC-207", body, headers)).status, 403);
  }
  assert.deepEqual(h.calls.apply, []);
  assert.deepEqual(h.lines, []);
});

test("길: 옮긴다. Linear에는 상태 하나만 쓰고, 캐시를 버리고, FLIGHT RECORDER에 한 줄", async () => {
  const h = harness();
  const res = await h.post("atc-207", { from: "Backlog", to: "Todo" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, key: "ATC-207", from: "Backlog", to: "Todo", type: "unstarted" });
  assert.deepEqual(h.calls.apply, [["uuid-1", "s1"]]);
  assert.deepEqual(h.calls.forget, ["ATC-207"]);
  assert.deepEqual(h.lines, [{ t: "2026-09-30T12:00:00.000Z", kind: "flight", op: "state", flight: "ATC-207", by: "SUPERVISOR", ok: true, from: "Backlog", to: "Todo" }]);
});

test("길: 상태가 이미 바뀌었으면 409, 쓰지 않고 실패를 적는다", async () => {
  const h = harness({ fetchIssue: async () => issue({ state: { name: "Todo", type: "unstarted" } }) });
  const res = await h.post("ATC-207", { from: "Backlog", to: "Canceled" });
  assert.equal(res.status, 409);
  assert.deepEqual(h.calls.apply, []);
  assert.deepEqual(h.calls.forget, []);
  assert.deepEqual(h.lines.map((l) => l.kind === "flight" && [l.ok, l.from, l.to]), [[false, "Backlog", "Canceled"]]);
});

test("길: 잘못된 key·본문은 400, 없는 이슈는 404, Linear 오류는 502, 미연결은 503", async () => {
  const h = harness();
  assert.equal((await h.post("nope", { from: "a", to: "b" })).status, 400);
  assert.equal((await h.post("ATC-207", { from: "a" })).status, 400);
  assert.equal((await h.post("ATC-207", "{not json")).status, 400);
  assert.equal((await harness({ fetchIssue: async () => null }).post("ATC-999", { from: "a", to: "b" })).status, 404);
  const boom = harness({ apply: async () => { throw new Error("HTTP 500"); } });
  assert.equal((await boom.post("ATC-207", { from: "Backlog", to: "Todo" })).status, 502);
  assert.deepEqual(boom.lines.map((l) => l.kind === "flight" && [l.ok, l.error]), [[false, "HTTP 500"]]);
  assert.equal((await harness({ fetchIssue: async () => { throw new Error("Linear 미연결"); } }).post("ATC-207", { from: "a", to: "b" })).status, 503);
});
