import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { arrivedOpenOf, noWorkspaceKeysOf } from "./arrived-open.ts";
import { type MoveIssue, moveVerdict, parseMoveBody } from "./flight-state.ts";
import { mountFlightState, type StateDeps } from "./flight-state-run.ts";
import type { LogEntry } from "./logbook.ts";
import type { Ticket } from "./model.ts";
import type { RecordLine } from "./recorder.ts";
import { type QueueInput, supervisorQueueOf } from "./supervisor-queue.ts";

// ATC-473: STAND 없는 FLIGHT가 ARRIVED인데 Linear는 아직 In Progress. 알림은 빼고, SUPERVISOR 한 줄, 확인한 클릭 하나로 Done. Linear에는 아무것도 쓰지 않는다(stub)
const NOW = Date.parse("2026-10-03T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const tk = (key: string, o: Partial<Ticket> = {}): Ticket =>
  ({ key, title: `title ${key}`, state: "In Progress", stateType: "started", labels: ["type:SURVEY"], url: `https://linear.app/x/${key}`, parent: null, children: [], ...o }) as Ticket;
const arrival = (flight: string, o: Partial<LogEntry> = {}): LogEntry =>
  ({ key: `r#${flight}`, aircraft: "TEAM_B", flight, arrivedAt: ago(30), reverted: false, standFree: { arrivedVia: "report", evidence: { url: "https://example.com/report", note: "survey done, 4 findings" }, workDoneAt: null, proposal: null }, ...o }) as LogEntry;

test("arrivedOpenOf: STAND 없는 FLIGHT가 ARRIVED인데 아직 started일 때만. STAND가 필요한 FLIGHT·다른 상태·되돌려진 도착은 아니다", () => {
  const tickets = [tk("ATC-1"), tk("ATC-2", { labels: ["type:BUILD"] }), tk("ATC-3", { state: "Done", stateType: "completed" }), tk("ATC-4"), tk("ATC-5", { labels: ["type:CHECK"] }), tk("ATC-6")];
  const entries = [arrival("ATC-1"), arrival("ATC-2"), arrival("ATC-3"), arrival("ATC-4", { reverted: true }), arrival("ATC-5", { arrivedAt: ago(90), aircraft: "TEAM_C" })];
  const out = arrivedOpenOf(tickets, entries);
  assert.deepEqual(out.map((a) => a.flight), ["ATC-5", "ATC-1"]); // 도착이 오래된 것부터. ATC-6은 도착 기록이 없다
  assert.deepEqual(out[1], { flight: "ATC-1", title: "title ATC-1", state: "In Progress", aircraft: "TEAM_B", arrivedAt: ago(30), note: "survey done, 4 findings", result: "https://example.com/report", issueUrl: "https://linear.app/x/ATC-1" });
  // Linear 상태가 started를 벗어나면 사라진다
  assert.deepEqual(arrivedOpenOf([tk("ATC-1", { state: "Done", stateType: "completed" })], [arrival("ATC-1")]), []);
  // 가장 늦은 도착 줄을 쓴다
  assert.equal(arrivedOpenOf([tk("ATC-1")], [arrival("ATC-1", { arrivedAt: ago(500) }), arrival("ATC-1", { arrivedAt: ago(10) })])[0]!.arrivedAt, ago(10));
});

test("noWorkspaceKeysOf: STAND 없는 FLIGHT에는 '워크트리가 없음' 알림이 없다. STAND가 필요한 started FLIGHT는 그대로, 상위 이슈와 워크트리가 있는 것은 아니다", () => {
  const tickets = [tk("ATC-1"), tk("ATC-2", { labels: ["type:BUILD"] }), tk("ATC-3", { labels: ["type:BUILD"], children: ["ATC-4"] }), tk("ATC-4", { labels: ["type:BUILD"], parent: "ATC-3" }), tk("ATC-5", { labels: ["type:BUILD"] }), tk("ATC-6", { labels: ["type:BUILD"], state: "Todo", stateType: "unstarted" })];
  assert.deepEqual(noWorkspaceKeysOf(tickets, new Set(["ATC-5"])), ["ATC-2", "ATC-4"]);
  // 라벨이 없는 FLIGHT는 STAND가 필요한 쪽으로 본다(planner와 같다)
  assert.deepEqual(noWorkspaceKeysOf([tk("ATC-7", { labels: [] })], new Set()), ["ATC-7"]);
});

const empty = (): QueueInput => ({ proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 3 });

test("큐: ARRIVED 줄 하나(제목은 atc 말), primary는 done, 이미 큐 줄이 있는 FLIGHT는 더하지 않는다", () => {
  const arrived = arrivedOpenOf([tk("ATC-1")], [arrival("ATC-1")]);
  const [i] = supervisorQueueOf({ ...empty(), arrived }, NOW);
  assert.equal(i!.kind, "ARRIVED");
  assert.equal(i!.title, "ATC-1 → TEAM_B");
  assert.doesNotMatch(i!.title, /title/);
  assert.equal(i!.since, ago(30));
  assert.deepEqual(i!.primary, { action: "done", label: "Done…" });
  assert.equal(i!.arrived?.state, "In Progress");
  assert.match(i!.detail ?? "", /title ATC-1 · survey done/);
  const held = supervisorQueueOf({ ...empty(), arrived, proposals: [{ id: "D-1", kind: "ASSIGN", status: "proposed", flight: "ATC-1", aircraftName: "TEAM_B", holdAt: null, statusAt: ago(5) } as QueueInput["proposals"][number]] }, NOW);
  assert.equal(held.some((x) => x.kind === "ARRIVED"), false);
});

const STATES = [{ name: "Backlog", type: "backlog" }, { name: "Todo", type: "unstarted" }, { name: "In Progress", type: "started" }, { name: "Done", type: "completed" }, { name: "Canceled", type: "canceled" }];
const issue = (over: Partial<MoveIssue> = {}): MoveIssue => ({ id: "uuid-1", key: "ATC-1", team: "ATC", state: { name: "In Progress", type: "started" }, states: STATES.map((s, i) => ({ id: `s${i}`, ...s })), ...over });

test("본문·판정: toType completed는 STAND 없는 ARRIVED 목록에 든 started 이슈만. 다른 started → completed는 그대로 막힌다", () => {
  assert.deepEqual(parseMoveBody({ from: "In Progress", toType: "completed" }), { ok: true, move: { from: "In Progress", to: "", toType: "completed" } });
  for (const bad of [{ from: "In Progress", toType: "started" }, { toType: "completed" }, { from: "", toType: "completed" }]) assert.equal(parseMoveBody(bad).ok, false, JSON.stringify(bad));
  const move = { from: "In Progress", to: "", toType: "completed" as const };
  const ok = moveVerdict(issue(), move, ["ATC"], { arrivedClose: true });
  assert.deepEqual(ok.ok && [ok.stateId, ok.to.name], ["s3", "Done"]);
  // 목록에 없는 FLIGHT(STAND가 필요한 FLIGHT 등)
  const no = moveVerdict(issue(), move, ["ATC"]);
  assert.deepEqual([no.ok, !no.ok && no.status], [false, 409]);
  // started가 아니면(상태가 이미 바뀜)
  assert.equal((moveVerdict(issue({ state: { name: "Todo", type: "unstarted" } }), { ...move, from: "Todo" }, ["ATC"], { arrivedClose: true }) as { status: number }).status, 409);
  // 이름으로 Done을 달라고 해도 started에서는 막힌다(기존 규칙)
  assert.equal((moveVerdict(issue(), { from: "In Progress", to: "Done" }, ["ATC"], { arrivedClose: true }) as { status: number }).status, 409);
  // completed 상태가 없는 팀
  assert.equal((moveVerdict(issue({ states: STATES.filter((s) => s.type !== "completed").map((s, i) => ({ id: `s${i}`, ...s })) }), move, ["ATC"], { arrivedClose: true }) as { status: number }).status, 400);
  // 읽지 않는 팀
  assert.equal((moveVerdict(issue({ team: "VOC" }), move, ["ATC"], { arrivedClose: true }) as { status: number }).status, 403);
});

function harness(over: Partial<StateDeps> = {}) {
  const applied: [string, string][] = [];
  const lines: RecordLine[] = [];
  const deps: StateDeps = {
    fetchIssue: async () => issue(),
    apply: async (id, stateId) => (applied.push([id, stateId]), { name: "Done", type: "completed" }),
    record: (l) => void lines.push(l),
    forget: () => undefined,
    teams: ["ATC"],
    now: () => new Date("2026-10-03T12:00:00Z"),
    ...over,
  };
  const app = new Hono();
  mountFlightState(app, deps);
  const post = (key: string, body: unknown, headers: Record<string, string> = { origin: "http://localhost:7700", "content-type": "application/json" }) =>
    app.request(`/api/flight/${key}/state`, { method: "POST", headers, body: JSON.stringify(body) });
  return { post, applied, lines };
}
const DONE = { from: "In Progress", toType: "completed" };

test("길: 목록에 든 FLIGHT는 확인한 클릭 하나로 Done으로 옮기고 FLIGHT RECORDER에 한 줄(Done). 이 화면에서 온 요청만", async () => {
  const h = harness({ closable: async (k) => k === "ATC-1" });
  assert.equal((await h.post("ATC-1", DONE, { "content-type": "application/json" })).status, 403); // Origin 없음
  assert.deepEqual(h.applied, []);
  const res = await h.post("atc-1", DONE);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, key: "ATC-1", from: "In Progress", to: "Done", type: "completed" });
  assert.deepEqual(h.applied, [["uuid-1", "s3"]]);
  assert.deepEqual(h.lines, [{ t: "2026-10-03T12:00:00.000Z", kind: "flight", op: "state", flight: "ATC-1", by: "SUPERVISOR", ok: true, from: "In Progress", to: "Done" }]);
});

test("길: STAND가 필요한 FLIGHT나 목록에 없는 FLIGHT는 거절하고 Linear에 아무것도 쓰지 않는다. closable이 없으면 늘 거절", async () => {
  const stand = harness({ closable: async () => false });
  const r = await stand.post("ATC-2", DONE);
  assert.equal(r.status, 409);
  assert.deepEqual(stand.applied, []);
  assert.equal((stand.lines[0] as { ok?: boolean } | undefined)?.ok, false);
  const none = harness();
  assert.equal((await none.post("ATC-1", DONE)).status, 409);
  assert.deepEqual(none.applied, []);
  // 목록에 있어도 그 사이 Linear 상태가 바뀌었으면(from이 다르다) 거절
  const moved = harness({ closable: async () => true, fetchIssue: async () => issue({ state: { name: "Done", type: "completed" } }) });
  assert.equal((await moved.post("ATC-1", DONE)).status, 409);
  assert.deepEqual(moved.applied, []);
  // 기존 이동(from·to)은 그대로: started에서 Done으로 이름을 주는 것도 막힌다
  const named = harness({ closable: async () => true });
  assert.equal((await named.post("ATC-1", { from: "In Progress", to: "Done" })).status, 409);
});
