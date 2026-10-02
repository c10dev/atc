import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewLine } from "./duty-review.ts";
import type { Ticket } from "./model.ts";
import { filedProposalsOf, proposalSourcesOf } from "./release-proposals.ts";

const tk = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Backlog", stateType: "backlog", stateColor: null, assignee: null, takenBy: null, priority: 2,
  url: null, updatedAt: null, project: "Beta", labels: [], createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [],
  releaseHash: `hash-${key}`, kEffects: null, ...over,
});
const review = (key: string, id = "R-0007", at = "2026-10-02T08:00:00Z"): ReviewLine => ({ v: 1, ev: "proposal", at, review: id, key, title: "t" });
const newOp = (id: string, ref: string | null, over: Partial<{ kind: string; status: string }> = {}) => ({ id, kind: "NEW", status: "applied", statusAt: "2026-10-02T09:00:00Z", appliedRef: ref, ...over });
const TEAMS = new Set(["ATC"]);

test("제안 출처: DUTY REVIEW의 proposal 줄과 반영된 SCHEDULE NEW. 둘 다면 이른 쪽, 반영 전이거나 다른 종류는 아니다", () => {
  const src = proposalSourcesOf(
    [review("ATC-1"), review("ATC-2", "R-0008", "2026-10-02T10:00:00Z"), { v: 1, ev: "review", id: "R-0007", at: "2026-10-02T07:59:00Z", trigger: "leak", detail: "" }],
    [newOp("S-0003", "ATC-2"), newOp("S-0004", "ATC-3"), newOp("S-0005", null), newOp("S-0006", "ATC-4", { status: "released" }), newOp("S-0007", "ATC-5", { kind: "CLASSIFY" })],
  );
  assert.deepEqual([...src.keys()].sort(), ["ATC-1", "ATC-2", "ATC-3"]);
  assert.deepEqual(src.get("ATC-1"), { by: "DUTY REVIEW R-0007", at: "2026-10-02T08:00:00Z" });
  assert.deepEqual(src.get("ATC-2"), { by: "SCHEDULE S-0003", at: "2026-10-02T09:00:00Z" }, "같은 이슈가 둘에 있으면 이른 쪽");
  assert.deepEqual(src.get("ATC-3"), { by: "SCHEDULE S-0004", at: "2026-10-02T09:00:00Z" });
});

test("제안 목록: 막는 이슈가 없는 DUTY REVIEW 제안은 목록에 든다(누가·언제·우선순위·K 효과)", () => {
  const src = proposalSourcesOf([review("ATC-1")], []);
  const rows = filedProposalsOf([tk("ATC-1", { priority: 3, kEffects: "K3: x" })], src, TEAMS);
  assert.deepEqual(rows, [{ key: "ATC-1", title: "ATC-1", state: "Backlog", hash: "hash-ATC-1", priority: 3, kEffects: "K3: x", by: "DUTY REVIEW R-0007", at: "2026-10-02T08:00:00Z" }]);
});

test("제안 목록: 열린 이슈가 막고 있으면 없고, 막는 이슈가 끝나면 나타난다. 알 수 없는 막는 이슈는 열린 것이다", () => {
  const src = proposalSourcesOf([review("ATC-1")], []);
  const blocker = (stateType: Ticket["stateType"]) => tk("ATC-9", { stateType, state: stateType });
  const mine = tk("ATC-1", { blockedBy: ["ATC-9"] });
  assert.deepEqual(filedProposalsOf([mine, blocker("started")], src, TEAMS), []);
  assert.deepEqual(filedProposalsOf([mine, blocker("unstarted")], src, TEAMS), []);
  assert.deepEqual(filedProposalsOf([mine], src, TEAMS), [], "막는 이슈를 읽지 못했다");
  assert.deepEqual(filedProposalsOf([mine, blocker("completed")], src, TEAMS).map((r) => r.key), ["ATC-1"]);
  assert.deepEqual(filedProposalsOf([mine, blocker("canceled")], src, TEAMS).map((r) => r.key), ["ATC-1"]);
});

test("제안 목록: SUPERVISOR가 직접 만든 Backlog 이슈는 제안이 아니다. 쏘았거나(Todo) 버렸거나(Canceled) 상위 이슈이거나 다른 팀이면 없다", () => {
  const src = proposalSourcesOf([review("ATC-1"), review("ATC-2"), review("ATC-3"), review("ATC-4"), review("ATC-5"), review("VOC-1")], []);
  const rows = filedProposalsOf(
    [
      tk("ATC-1"),
      tk("ATC-2", { stateType: "unstarted", state: "Todo" }),
      tk("ATC-3", { stateType: "canceled", state: "Canceled" }),
      tk("ATC-4", { children: ["ATC-40"] }),
      tk("ATC-5", { stateType: "started", state: "In Progress" }),
      tk("VOC-1"),
      tk("ATC-77"), // 출처 없음 = SUPERVISOR가 만든 것
    ],
    src,
    TEAMS,
  );
  assert.deepEqual(rows.map((r) => r.key), ["ATC-1"]);
});

test("제안 목록: 오래된 제안이 위", () => {
  const src = proposalSourcesOf([review("ATC-10", "R-0002", "2026-10-02T09:00:00Z"), review("ATC-9", "R-0001", "2026-10-02T08:00:00Z"), review("ATC-11", "R-0003", "2026-10-02T09:00:00Z")], []);
  assert.deepEqual(filedProposalsOf([tk("ATC-11"), tk("ATC-10"), tk("ATC-9")], src, TEAMS).map((r) => r.key), ["ATC-9", "ATC-10", "ATC-11"]);
});
