import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type Plan } from "./dispatch.ts";
import type { Ticket } from "./model.ts";
import { fold, gateOf, type Op, type Proposal, syncOps } from "./proposals.ts";
import { toTicket } from "./sources/linear.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (key: string, stateType: Ticket["stateType"] = "unstarted", state = "Todo") =>
  ({ key, state, stateType }) as Ticket;

const planOf = (over: Partial<Plan> = {}): Plan => ({
  at: iso(0), assign: [], release: [], hold: [], excluded: [], slots: [],
  aircraft: [
    { id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: true, reason: "PARKED" },
    { id: "c", name: "TEAM_C", callsign: "CHARLIE", airport: "VCDO", available: false, reason: "AIRBORNE" },
  ],
  ...over,
});
const assign = (flight: string, aircraft: string) => ({
  kind: "ASSIGN" as const, flight, aircraft, aircraftName: aircraft === "b" ? "TEAM_B" : "TEAM_C", airport: "VCDO", score: 9, factors: [],
});
const create = (id: string, flight: string, aircraft: string | null, minAgo: number, kind: "ASSIGN" | "RELEASE" = "ASSIGN"): Op => ({
  op: "create", id, at: iso(minAgo), kind, flight, aircraft, aircraftName: aircraft, airport: "VCDO", score: 1, factors: [],
});

test("접기: verdict·supersede·expire는 열린 제안에만, note는 언제나", () => {
  const ps = fold([
    create("D-0001", "VOC-1", "b", 30),
    { op: "note", id: "D-0001", at: iso(20), text: "DB 작업", caution: true },
    { op: "verdict", id: "D-0001", at: iso(10), verdict: "disagree", reason: "우선순위 낮음" },
    { op: "supersede", id: "D-0001", at: iso(5), reason: "무시되어야 함" },
  ]);
  assert.equal(ps[0].status, "disagreed");
  assert.equal(ps[0].reason, "우선순위 낮음");
  assert.equal(ps[0].caution, true);
  assert.equal(ps[0].decidedAt, iso(10));
});

test("동기화: 새 짝은 만들고, 빠진 짝은 사유와 함께 SUPERSEDED, 24시간 지난 것은 EXPIRED", () => {
  const existing = fold([
    create("D-0001", "VOC-1", "b", 30), // 계획에 그대로 → 유지
    create("D-0002", "VOC-2", "c", 30), // AIRCRAFT가 AIRBORNE → supersede
    create("D-0003", "VOC-3", "b", 30), // FLIGHT가 ENROUTE로 → supersede
    create("D-0004", "VOC-4", "b", 25 * 60), // 25시간 → expire
  ]);
  const plan = planOf({ assign: [assign("VOC-1", "b"), assign("VOC-5", "b")] });
  const tickets = [t("VOC-1"), t("VOC-2"), t("VOC-3", "started", "In Progress"), t("VOC-4"), t("VOC-5")];
  const ops = syncOps(existing, plan, { tickets }, DEFAULT_DISPATCH_CONFIG, NOW, 4);
  assert.deepEqual(
    ops.map((o) => `${o.op}:${o.id}${"reason" in o ? `:${o.reason}` : ""}${o.op === "create" ? `:${o.flight}` : ""}`),
    [
      "supersede:D-0002:AIRCRAFT 불가: AIRBORNE",
      "supersede:D-0003:FLIGHT 상태가 바뀜(In Progress)",
      "expire:D-0004",
      "create:D-0005:VOC-5",
    ],
  );
});

test("동기화: 24시간 안에 거절한 짝은 다시 제안하지 않고, 열린 제안 한도를 지킨다", () => {
  const existing = fold([create("D-0001", "VOC-1", "b", 60), { op: "verdict", id: "D-0001", at: iso(50), verdict: "disagree", reason: null }]);
  const many = ["VOC-1", "VOC-2", "VOC-3", "VOC-4"].map((f) => assign(f, "b"));
  const cfg = { ...DEFAULT_DISPATCH_CONFIG, slots: { ...DEFAULT_DISPATCH_CONFIG.slots, openProposals: 2 } };
  const ops = syncOps(existing, planOf({ assign: many }), { tickets: [] }, cfg, NOW, 1);
  assert.deepEqual(ops.map((o) => (o.op === "create" ? o.flight : o.op)), ["VOC-2", "VOC-3"]);
});

test("RELEASE 제안: 같은 FLIGHT는 한 번, 기준에서 벗어나면 SUPERSEDED", () => {
  const existing = fold([create("D-0001", "VOC-9", null, 30, "RELEASE")]);
  const release = [{ kind: "RELEASE" as const, flight: "VOC-8", airport: "VCDO", days: 4, score: 4, factors: [] }];
  const ops = syncOps(existing, planOf({ release }), { tickets: [t("VOC-9", "started", "In Progress")] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(
    ops.map((o) => `${o.op}:${o.op === "create" ? o.flight : o.id}`),
    ["supersede:D-0001", "create:VOC-8"],
  );
});

test("2b 진입 판정: 결정 20건 이상, 합의율 80% 이상", () => {
  const mk = (n: number, agreed: number): Proposal[] =>
    Array.from({ length: n }, (_, i) => ({ status: i < agreed ? "agreed" : "disagreed" }) as Proposal);
  assert.equal(gateOf(mk(19, 19)).ready, false);
  assert.equal(gateOf(mk(20, 16)).ready, true);
  assert.equal(gateOf(mk(20, 15)).ready, false);
  assert.equal(gateOf([]).agreement, null);
});

test("Linear 관계: relations의 blocks는 내가 막음, inverseRelations의 blocks는 내가 막힘, related는 양쪽", () => {
  const ticket = toTicket({
    identifier: "VOC-10", title: "x", url: "u", priority: 2, updatedAt: iso(0), createdAt: iso(100), startedAt: null,
    state: { name: "Todo", type: "unstarted", color: "#fff" }, assignee: null, project: { name: "Beta Readiness" },
    labels: { nodes: [{ name: "symphony-pilot" }] },
    relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "VOC-12" } }, { type: "related", relatedIssue: { identifier: "VOC-3" } }] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "VOC-7" } }, { type: "related", issue: { identifier: "VOC-3" } }, { type: "related", issue: { identifier: "VOC-1" } }] },
  });
  assert.deepEqual(
    { blocks: ticket.blocks, blockedBy: ticket.blockedBy, related: ticket.related, labels: ticket.labels, project: ticket.project },
    { blocks: ["VOC-12"], blockedBy: ["VOC-7"], related: ["VOC-1", "VOC-3"], labels: ["symphony-pilot"], project: "Beta Readiness" },
  );
});
