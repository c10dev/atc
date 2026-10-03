import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWrite, reconcileFetch } from "./linear-overlay.ts";
import type { Ticket } from "./model.ts";

const tk = (key: string, state = "Backlog", stateType: Ticket["stateType"] = "backlog"): Ticket => ({
  key, title: key, state, stateType, stateColor: "#aaa", assignee: null, takenBy: null, priority: 2, url: null, updatedAt: null, project: null, labels: [],
  createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [],
});
const todo = { name: "Todo", type: "unstarted" };

test("쓰기 성공: 캐시의 그 티켓만 새 상태로, 다른 티켓은 그대로", () => {
  const r = applyWrite([tk("ATC-1"), tk("ATC-2")], new Map(), "ATC-1", todo, 5);
  assert.deepEqual(r.tickets.map((t) => [t.key, t.state, t.stateType]), [["ATC-1", "Todo", "unstarted"], ["ATC-2", "Backlog", "backlog"]]);
  assert.equal(r.overlays.get("ATC-1")!.seq, 5);
});

test("쓰기보다 먼저 시작한 가져오기(옛 상태)가 도착해도 되돌리지 않고, 덮어쓰기는 남는다", () => {
  const w = applyWrite([tk("ATC-1")], new Map(), "ATC-1", todo, 5);
  const r = reconcileFetch([tk("ATC-1")], w.overlays, 3);
  assert.equal(r.tickets[0]!.state, "Todo");
  assert.equal(r.overlays.size, 1);
});

test("쓰기보다 나중에 시작한 가져오기가 도착하면 덮어쓰기를 버리고 Linear의 답이 이긴다", () => {
  const w = applyWrite([tk("ATC-1")], new Map(), "ATC-1", todo, 5);
  const r = reconcileFetch([tk("ATC-1", "In Progress", "started")], w.overlays, 6);
  assert.equal(r.tickets[0]!.state, "In Progress"); // Linear에서 따로 바뀐 것이 가려지지 않는다
  assert.equal(r.overlays.size, 0);
});

test("실패한 쓰기는 이 함수를 부르지 않는다: 덮어쓰기가 없으면 가져오기 결과 그대로", () => {
  const r = reconcileFetch([tk("ATC-1")], new Map(), 1);
  assert.equal(r.tickets[0]!.state, "Backlog");
});

test("같은 키는 가장 나중 쓰기가 이기고, 캐시에 없던 티켓은 다음 가져오기에 입힌다", () => {
  const a = applyWrite([], new Map(), "ATC-9", todo, 2);
  assert.deepEqual(a.tickets, []);
  const b = applyWrite(a.tickets, a.overlays, "ATC-9", { name: "Canceled", type: "canceled" }, 4);
  assert.equal(reconcileFetch([tk("ATC-9")], b.overlays, 3).tickets[0]!.state, "Canceled");
});
