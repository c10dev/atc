import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type Plan } from "./dispatch.ts";
import type { Ticket } from "./model.ts";
import { parentKeysOf } from "./model.ts";
import { canApply, fold, formatFlightPlan, gate3Of, gateOf, isHeld, isInFlight, type Op, overdueOf, type Proposal, reservedOf, syncOps } from "./proposals.ts";
import { toTicket } from "./sources/linear.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (key: string, stateType: Ticket["stateType"] = "unstarted", state = "Todo") =>
  ({ key, state, stateType }) as Ticket;

const planOf = (over: Partial<Plan> = {}): Plan => ({
  at: iso(0), assign: [], release: [], hold: [], excluded: [], slots: [],
  aircraft: [
    { id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: true, reason: "PARKED", reserved: null },
    { id: "c", name: "TEAM_C", callsign: "CHARLIE", airport: "VCDO", available: false, reason: "AIRBORNE", reserved: null },
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
  const ops = syncOps(existing, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 4);
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
  const ops = syncOps(existing, planOf({ assign: many }), { tickets: [], workspaces: [] }, cfg, NOW, 1);
  assert.deepEqual(ops.map((o) => (o.op === "create" ? o.flight : o.op)), ["VOC-2", "VOC-3"]);
});

test("RELEASE 제안: 같은 FLIGHT는 한 번, 기준에서 벗어나면 SUPERSEDED", () => {
  const existing = fold([create("D-0001", "VOC-9", null, 30, "RELEASE")]);
  const release = [{ kind: "RELEASE" as const, flight: "VOC-8", airport: "VCDO", days: 4, score: 4, factors: [] }];
  const ops = syncOps(existing, planOf({ release }), { tickets: [t("VOC-9", "started", "In Progress")], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
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

test("Linear parent/children: 상위·하위 이슈 관계를 Ticket에 담는다", () => {
  const parent = toTicket({
    identifier: "VOC-34", title: "상위", url: "u", priority: 0, updatedAt: iso(0),
    state: { name: "In Progress", type: "started", color: "#fff" }, assignee: null,
    children: { nodes: [{ identifier: "VOC-40" }, { identifier: "VOC-41" }, { identifier: "VOC-40" }] },
  });
  const child = toTicket({
    identifier: "VOC-40", title: "하위", url: "u", priority: 0, updatedAt: iso(0),
    state: { name: "Todo", type: "unstarted", color: "#fff" }, assignee: null,
    parent: { identifier: "VOC-34" },
  });
  assert.equal(parent.parent, null);
  assert.deepEqual(parent.children, ["VOC-40", "VOC-41"]);
  assert.equal(child.parent, "VOC-34");
  assert.deepEqual([...parentKeysOf([parent, child])], ["VOC-34"]);
  // 하위만 있고 상위 이슈가 목록에 없어도, parent로 지목된 key는 상위로 본다
  assert.equal(child.parent, "VOC-34");
  assert.deepEqual([...parentKeysOf([child])], ["VOC-34"]);
});

// ── 2b 승인 운용 ──

const ws = (ticketKey: string) => ({ path: `/w/${ticketKey}`, ticketKey }) as import("./model.ts").Workspace;

test("전이: approve → send → accept → depart 순서만, 건너뛰거나 되돌리는 op는 무시", () => {
  const [p] = fold([
    create("D-0001", "VOC-1", "b", 60),
    { op: "send", id: "D-0001", at: iso(59), message: "건너뜀" }, // proposed에서 send 불가
    { op: "approve", id: "D-0001", at: iso(50) },
    { op: "verdict", id: "D-0001", at: iso(49), verdict: "agree", reason: null }, // approved에서 verdict 불가
    { op: "send", id: "D-0001", at: iso(40), message: "FLIGHT PLAN" },
    { op: "accept", id: "D-0001", at: iso(35) },
    { op: "decline", id: "D-0001", at: iso(34), reason: "늦음" }, // accepted에서 decline 불가
    { op: "depart", id: "D-0001", at: iso(20), stand: "/w/VOC-1" },
  ]);
  assert.equal(p.status, "departed");
  assert.equal(p.message, "FLIGHT PLAN");
  assert.equal(p.departedStand, "/w/VOC-1");
  assert.equal(p.decidedAt, iso(50));
  assert.deepEqual(Object.keys(p.timeline), ["proposed", "approved", "sent", "accepted", "departed"]);
  assert.equal(p.reason, null);
});

test("RELEASE는 승인해도 보내지 않는다(send 불가)", () => {
  const [p] = fold([create("D-0001", "VOC-9", null, 30, "RELEASE"), { op: "approve", id: "D-0001", at: iso(20) }]);
  assert.equal(p.status, "approved");
  assert.equal(canApply(p, "send"), false);
});

test("예약: 진행 중인 ASSIGN의 AIRCRAFT·FLIGHT는 reservedOf에 잡힌다", () => {
  const ps = fold([
    create("D-0001", "VOC-1", "b", 60), { op: "approve", id: "D-0001", at: iso(50) },
    create("D-0002", "VOC-2", "c", 60), { op: "reject", id: "D-0002", at: iso(50), reason: null },
    create("D-0003", "VOC-3", null, 60, "RELEASE"), { op: "approve", id: "D-0003", at: iso(50) },
  ]);
  const r = reservedOf(ps);
  assert.deepEqual([...r.aircraft], [["b", "D-0001"]]);
  assert.deepEqual([...r.flights], [["VOC-1", "D-0001"]]);
});

test("동기화(2b): 승인 후 무효면 SUPERSEDED, 보낸 것은 그대로, STAND가 생기면 DEPARTED, 오래되면 EXPIRED", () => {
  const existing = fold([
    create("D-0001", "VOC-1", "b", 90), { op: "approve", id: "D-0001", at: iso(80) }, // FLIGHT가 ENROUTE로 → supersede
    create("D-0002", "VOC-2", "c", 90), { op: "approve", id: "D-0002", at: iso(80) }, { op: "send", id: "D-0002", at: iso(70), message: "m" }, // c는 AIRBORNE이지만 보냈으니 유지
    create("D-0003", "VOC-3", "b", 90), { op: "approve", id: "D-0003", at: iso(80) }, { op: "send", id: "D-0003", at: iso(70), message: "m" }, { op: "accept", id: "D-0003", at: iso(60) }, // STAND 생김 → depart
    create("D-0004", "VOC-4", "b", 26 * 60), { op: "approve", id: "D-0004", at: iso(25 * 60) }, { op: "send", id: "D-0004", at: iso(25 * 60) , message: "m" }, // 25시간 READBACK 없음 → expire
  ]);
  const tickets = [t("VOC-1", "started", "In Progress"), t("VOC-2"), t("VOC-3"), t("VOC-4")];
  const ops = syncOps(existing, planOf(), { tickets, workspaces: [ws("VOC-3")] }, DEFAULT_DISPATCH_CONFIG, NOW, 4);
  assert.deepEqual(
    ops.map((o) => `${o.op}:${o.id}${"reason" in o && o.reason ? `:${o.reason}` : ""}`),
    ["supersede:D-0001:FLIGHT 상태가 바뀜(In Progress)", "depart:D-0003", "expire:D-0004:24시간 동안 READBACK 없음"],
  );
});

test("SUPERSEDED 사유: 계획이 그 FLIGHT를 뺀 이유가 있으면 그대로 쓴다(더 나은 배정으로 바뀜 대신)", () => {
  const existing = fold([create("D-0001", "VOC-1", "b", 30)]);
  const plan = planOf({
    aircraft: [{ id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: true, reason: "PARKED", reserved: null }],
    excluded: [{ flight: "VOC-1", reason: "HOLD D-0002 — 선행 FLIGHT 대기" }],
  });
  const ops = syncOps(existing, plan, { tickets: [t("VOC-1")], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(ops.map((o) => `${o.op}:${o.id}:${"reason" in o ? o.reason : ""}`), [
    "supersede:D-0001:HOLD D-0002 — 선행 FLIGHT 대기",
  ]);
});

test("FLIGHT PLAN 문구: 콜사인·FLIGHT·AIRPORT·PRIORITY·제목·URL·메모·READBACK 요청", () => {
  const [p] = fold([create("D-0007", "VOC-193", "b", 10), { op: "note", id: "D-0007", at: iso(5), text: "DB 권한 작업", caution: true }]);
  const msg = formatFlightPlan({ ...p, airport: "VCDO" }, { title: "권한 정리", url: "https://linear.app/x/VOC-193", priority: 2 }, "TEAM_B");
  assert.equal(
    msg,
    [
      "[DISPATCH D-0007] FLIGHT PLAN · BRAVO (TEAM_B)",
      "FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High",
      "권한 정리",
      "https://linear.app/x/VOC-193",
      "DISPATCH 메모: CAUTION · DB 권한 작업",
      '— 맡으면 이 메시지에 "READBACK D-0007", 못 맡으면 사유로 답장해 주세요.',
    ].join("\n"),
  );
});

test("FLIGHT PLAN 문구: HOLD가 있으면 선행 FLIGHT 줄이 들어간다", () => {
  const [p] = fold([create("D-0008", "VOC-192", "b", 10), { op: "hold", id: "D-0008", at: iso(9), blockedBy: ["VOC-180"] }]);
  const msg = formatFlightPlan({ ...p, airport: "VCDO" }, { title: "별도 이슈", url: "u", priority: 2 }, "TEAM_F");
  assert.ok(msg.includes("HOLD — 선행 FLIGHT VOC180가 끝난 뒤 착수"));
});

test("HOLD: 제안은 열린 목록에서 빠지고, AIRCRAFT는 놓아 주되 FLIGHT는 잡아 둔 채 선행이 끝나면 풀린다", () => {
  const [p] = fold([create("D-0003", "VOC-192", "b", 30), { op: "hold", id: "D-0003", at: iso(20), blockedBy: ["VOC-180"] }]);
  assert.deepEqual(p.hold, ["VOC-180"]);
  assert.equal(isHeld(p), true);
  assert.equal(isInFlight(p), false);
  // AIRCRAFT는 아직 아무도 안 쥐었다 — 다른 FLIGHT에 쓸 수 있다
  assert.deepEqual([...reservedOf([{ ...p, status: "approved" }]).aircraft], []);
  // FLIGHT는 잡아 둔다 — 안 그러면 다음 바퀴에 같은 FLIGHT가 다른 AIRCRAFT로 다시 나온다
  const r = reservedOf([p]);
  assert.deepEqual([...r.flights], [["VOC-192", "D-0003"]]);
  assert.deepEqual([...r.held!], [["VOC-192", "D-0003 — 선행 FLIGHT 대기"]]);

  // 선행 VOC-180이 아직 In Progress면 HOLD 유지
  const running = [t("VOC-180", "started", "In Progress"), t("VOC-192")];
  assert.deepEqual(syncOps([p], planOf(), { tickets: running, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1), []);

  // 선행이 끝나면 후보로 되돌린다
  const done = [t("VOC-180", "completed", "Done"), t("VOC-192")];
  const ops = syncOps([p], planOf(), { tickets: done, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(ops.map((o) => `${o.op}:${o.id}:${"reason" in o ? o.reason : ""}`), ["supersede:D-0003:선행 FLIGHT(VOC-180)가 끝남 — 다시 후보"]);
  // 선행이 끝나면 FLIGHT도 놓아 준다
  assert.deepEqual([...reservedOf([{ ...p, status: "superseded" }]).flights], []);
});

test("선행 FLIGHT 없는 HOLD: 사람 결정 대기로 잡아 두고, HOLD 뒤에 FLIGHT가 수정되면 다시 검토", () => {
  const [p] = fold([
    create("D-0010", "VOC-177", "b", 30),
    { op: "note", id: "D-0010", at: iso(21), text: "구현은 사용자 지시 대기", caution: true },
    { op: "hold", id: "D-0010", at: iso(20), blockedBy: [] },
  ]);
  assert.deepEqual(p.hold, []);
  assert.equal(p.holdAt, iso(20));
  assert.equal(isHeld(p), true);
  assert.deepEqual([...reservedOf([p]).held!], [["VOC-177", "D-0010 — 사람 결정 대기"]]);

  const ticket = (updatedMinAgo: number) => ({ ...t("VOC-177"), updatedAt: iso(updatedMinAgo) });
  // HOLD 전에 수정된 것은 그대로
  assert.deepEqual(syncOps([p], planOf(), { tickets: [ticket(25)], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1), []);
  // HOLD 뒤에 수정되면 풀어서 다시 검토
  const ops = syncOps([p], planOf(), { tickets: [ticket(5)], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(ops.map((o) => `${o.op}:${"reason" in o ? o.reason : ""}`), ["supersede:HOLD 뒤에 FLIGHT가 수정됨 — 다시 검토"]);
});

test("HOLD는 24시간이 지나도 만료되지 않고, FLIGHT 자체가 Todo가 아니게 되면 닫힌다", () => {
  const [p] = fold([create("D-0007", "VOC-193", "b", 3 * 24 * 60), { op: "hold", id: "D-0007", at: iso(3 * 24 * 60 - 1), blockedBy: ["VOC-191"] }]);
  const review = t("VOC-191", "started", "In Review");
  assert.deepEqual(syncOps([p], planOf(), { tickets: [review, t("VOC-193")], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1), []);
  const started = [review, t("VOC-193", "started", "In Progress")];
  const ops = syncOps([p], planOf(), { tickets: started, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(ops.map((o) => `${o.op}:${"reason" in o ? o.reason : ""}`), ["supersede:FLIGHT 상태가 바뀜(In Progress)"]);
});

test("늦음과 3단계 점검: READBACK 비율·중앙값·DEPARTED 비율", () => {
  const ops: Op[] = [];
  for (let i = 1; i <= 10; i++) {
    const id = `D-${String(i).padStart(4, "0")}`;
    ops.push(create(id, `VOC-${i}`, "b", 120), { op: "approve", id, at: iso(110) }, { op: "send", id, at: iso(100), message: "m" });
    if (i <= 9) ops.push({ op: "accept", id, at: iso(100 - i) });
    if (i <= 8) ops.push({ op: "depart", id, at: iso(50), stand: "/w" });
  }
  const ps = fold(ops);
  const g = gate3Of(ps);
  assert.equal(g.dispatched, 10);
  assert.equal(g.readbackRate, 0.9);
  assert.equal(g.readbackMedianMin, 5);
  assert.equal(g.departedRate, 8 / 9);
  assert.equal(g.ready, true);
  // D-0010은 100분째 READBACK 없음, D-0009는 READBACK 뒤 91분째 STAND 없음
  assert.deepEqual(overdueOf(ps, NOW), ["D-0009", "D-0010"]);
});
