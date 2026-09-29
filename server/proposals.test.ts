import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig, type Plan } from "./dispatch.ts";
import type { Ticket, Workspace } from "./model.ts";
import { parentKeysOf } from "./model.ts";
import { canApply, crosscheckBriefOf, NO_VERDICT_WHY, DEFAULT_SETTLE_MIN, fold, settledItemsOf, settledOf, settlesInMin, withSettled, formatFlightPlan, gate3Of, gateOf, isHeld, isInFlight, type Op, overdueOf, type Proposal, reasonStatsOf, recentFlightsOf, recentPairsOf, reservedOf, syncOps } from "./proposals.ts";
import { takenByOf, toTicket } from "./sources/linear.ts";

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
// 세션 id → 세션 이름. 짝·예약은 REGISTRATION(이름)으로 짝짓는다(ATC-91)
const NAME_OF: Record<string, string> = { a: "TEAM_A", b: "TEAM_B", c: "TEAM_C", d: "TEAM_D" };
const create = (id: string, flight: string, aircraft: string | null, minAgo: number, kind: "ASSIGN" | "RELEASE" = "ASSIGN"): Op => ({
  op: "create", id, at: iso(minAgo), kind, flight, aircraft, aircraftName: aircraft ? (NAME_OF[aircraft] ?? aircraft) : null, airport: "VCDO", score: 1, factors: [],
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
      "expire:D-0004:24시간 판정 없음",
      "create:D-0005:VOC-5",
    ],
  );
});

test("동기화(ATC-90): 멈춘 AIRCRAFT의 열린 제안은 AIRCRAFT 멈춤으로 닫고, 그 짝은 24시간 규칙에 걸리지 않는다", () => {
  const existing = fold([create("D-0001", "VOC-1", "c", 30)]);
  const stopped = { id: "c", name: "TEAM_C", callsign: "CHARLIE", airport: "VCDO", available: false, resting: true, stopped: true as const, reason: "VOC-72 아직 진행 중(PR 없음)", reserved: null };
  const tickets = [{ ...t("VOC-1"), labels: [], project: "Beta Readiness", priority: 3 } as Ticket];
  const plan = planOf({ aircraft: [stopped] });
  const ops = syncOps(existing, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 2);
  assert.deepEqual(ops.map((o) => `${o.op}:${o.id}${"reason" in o ? `:${o.reason}` : ""}`), ["supersede:D-0001:AIRCRAFT 멈춤 — TEAM_C — VOC-72 아직 진행 중(PR 없음)"]);
  // 판정이 아니라서 같은 짝은 바로 다시 후보가 된다
  const closed = fold([create("D-0001", "VOC-1", "c", 30), { op: "supersede", id: "D-0001", at: iso(5), reason: "AIRCRAFT 멈춤 — TEAM_C — VOC-72 아직 진행 중(PR 없음)" }]);
  const back = syncOps(closed, planOf({ assign: [assign("VOC-1", "b")], aircraft: [{ ...stopped, available: true, stopped: undefined, reason: "PARKED" }] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 2);
  assert.equal(back.filter((o) => o.op === "create").length, 1);
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
    Array.from({ length: n }, (_, i) => ({ status: i < agreed ? "agreed" : "disagreed", timeline: {} }) as Proposal);
  assert.equal(gateOf(mk(19, 19)).ready, false);
  assert.equal(gateOf(mk(20, 16)).ready, true);
  assert.equal(gateOf(mk(20, 15)).ready, false);
  assert.equal(gateOf([]).agreement, null);
});

test("Linear 관계: relations의 blocks는 내가 막음, inverseRelations의 blocks는 내가 막힘, related는 양쪽", () => {
  const ticket = toTicket({
    identifier: "VOC-10", title: "x", url: "u", priority: 2, updatedAt: iso(0), createdAt: iso(100), startedAt: null,
    state: { name: "Todo", type: "unstarted", color: "#fff" }, assignee: null, project: { name: "Beta Readiness" },
    labels: { nodes: [{ name: "symphony-pilot" }, { name: "Security", parent: { name: "Risk" } }] },
    relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "VOC-12" } }, { type: "related", relatedIssue: { identifier: "VOC-3" } }] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "VOC-7" } }, { type: "related", issue: { identifier: "VOC-3" } }, { type: "related", issue: { identifier: "VOC-1" } }] },
  });
  assert.deepEqual(
    { blocks: ticket.blocks, blockedBy: ticket.blockedBy, related: ticket.related, labels: ticket.labels, project: ticket.project },
    { blocks: ["VOC-12"], blockedBy: ["VOC-7"], related: ["VOC-1", "VOC-3"], labels: ["symphony-pilot", "Risk:Security"], project: "Beta Readiness" },
  );
});

test("Linear 담당·위임: API 키 주인(viewer)이 아닌 담당자나 위임 대상이면 takenBy, viewer를 모르면 없음", () => {
  const me = { id: "u-me", displayName: "me" };
  const kim = { id: "u-kim", displayName: "kim" };
  const codex = { id: "u-codex", displayName: "codex" };
  assert.equal(takenByOf({ assignee: null }, "u-me"), null);
  assert.equal(takenByOf({ assignee: me }, "u-me"), null);
  assert.equal(takenByOf({ assignee: kim }, "u-me"), "kim");
  assert.equal(takenByOf({ assignee: me, delegate: codex }, "u-me"), "codex");
  assert.equal(takenByOf({ assignee: null, delegate: codex }, "u-me"), "codex");
  assert.equal(takenByOf({ assignee: kim, delegate: codex }, null), null);
  // 이름만 있고 id가 없으면(옛 응답) 판단하지 않는다
  assert.equal(takenByOf({ assignee: { displayName: "kim" } }, "u-me"), null);
  const ticket = toTicket({
    identifier: "VOC-11", title: "x", url: "u", priority: 2, updatedAt: iso(0),
    state: { name: "Todo", type: "unstarted", color: "#fff" }, assignee: me, delegate: codex,
  }, "u-me");
  assert.deepEqual({ assignee: ticket.assignee, takenBy: ticket.takenBy }, { assignee: "me", takenBy: "codex" });
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
  assert.deepEqual([...r.aircraft], [["TEAM_B", "D-0001"]]); // 세션 id가 아니라 REGISTRATION(ATC-91)
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

test("동기화(2b): 승인 뒤 Linear에서 다른 사람·agent가 맡으면 SUPERSEDED", () => {
  const existing = fold([create("D-0001", "VOC-1", "b", 90), { op: "approve", id: "D-0001", at: iso(80) }]);
  const tickets = [{ ...t("VOC-1"), priority: 3, project: "Beta Readiness", labels: [], takenBy: "codex" } as Ticket];
  const ops = syncOps(existing, planOf(), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(ops.map((o) => `${o.op}:${o.id}:${"reason" in o ? o.reason : ""}`), ["supersede:D-0001:Linear 담당 codex — atc 밖에서 맡음"]);
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

test("SUPERSEDED 사유: 계획의 제외 목록에 없어도 planner 규칙을 확인해 밝힌다", () => {
  // plan.excluded에는 "지금 후보인" FLIGHT의 사유만 담긴다. 이미 후보에서 빠진 FLIGHT가
  // "더 나은 배정으로 바뀜"으로 뭉뚱그려지면 화면에서 실제 이유를 알 수 없다.
  const mk = (key: string, over: Partial<Ticket> = {}) => ({ ...t(key), project: "Beta Readiness", priority: 3, labels: [], ...over }) as Ticket;
  const ac = { id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: true, reason: "PARKED", reserved: null };
  const cases: [string, Ticket[], string][] = [
    // STAND가 이미 있음 (배정할 필요가 없어진 것)
    ["VOC-30", [mk("VOC-30")], "이미 STAND가 있음"],
    // 우선순위 없음 (사람이 정할 때까지)
    ["VOC-31", [mk("VOC-31", { priority: 0 })], "우선순위 없음 — 사람이 정할 때까지 배정하지 않음"],
    // 프로젝트가 매핑 밖
    ["VOC-32", [mk("VOC-32", { project: "Somewhere Else" })], "배정 제외 프로젝트: Somewhere Else"],
    // 다른 운항사 라벨
    ["VOC-33", [mk("VOC-33", { labels: ["symphony-pilot"] })], "라벨 symphony-pilot (다른 운항사)"],
    // Linear에서 다른 사람·agent가 맡음
    ["VOC-34", [mk("VOC-34", { takenBy: "codex" })], "Linear 담당 codex — atc 밖에서 맡음"],
  ];
  for (const [flight, tickets, want] of cases) {
    const p = fold([create("D-0009", flight, "b", 30)]);
    const workspaces = flight === "VOC-30" ? [ws(flight)] : [];
    const ops = syncOps(p, planOf({ aircraft: [ac] }), { tickets, workspaces }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
    assert.deepEqual(ops.map((o) => `${o.op}:${o.id}:${"reason" in o ? o.reason : ""}`), [`supersede:D-0009:${want}`], flight);
  }
});

test("FLIGHT PLAN 문구(DIRECT): BRIEF 줄·콜사인·FLIGHT·AIRPORT·PRIORITY·제목·URL·메모·READBACK 요청, 끝은 끝까지 진행", () => {
  const [p] = fold([create("D-0007", "VOC-193", "b", 10), { op: "note", id: "D-0007", at: iso(5), text: "DB 권한 작업", caution: true }]);
  const msg = formatFlightPlan({ ...p, airport: "VCDO" }, { title: "권한 정리", url: "https://linear.app/x/VOC-193", priority: 2 }, "TEAM_B");
  assert.equal(
    msg,
    [
      "[DISPATCH D-0007] FLIGHT PLAN · BRAVO (TEAM_B)",
      "BRIEF: DIRECT",
      "FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High",
      "권한 정리",
      "https://linear.app/x/VOC-193",
      "Done when: Follow the done criteria in the issue body (link).",
      "DISPATCH note: CAUTION · DB 권한 작업",
      "Where it is ambiguous, use PILOT'S DISCRETION: pick a reasonable default and record it in the PR.",
      '— Reply to this message with "READBACK D-0007" if you take it, "UNABLE D-0007 — reason" if you cannot, or "STANDBY D-0007" if you need time.',
      "Carry it through to the end; stop and ask only for what needs a SUPERVISOR decision.",
    ].join("\n"),
  );
});

test("FLIGHT PLAN 문구(DIRECT): 이슈 본문에서 목표·완료 기준·이 작업만의 제약만 옮기고, 허용 범위 같은 나머지는 링크에 둔다", () => {
  const [p] = fold([create("D-0009", "VOC-200", "b", 10)]);
  const body = ["## 목표", "재생 버튼 정리", "## 수정 허용 범위", "- src/app/song/**", "## 금지 사항", "- DB 변경", "## 완료 기준", "- 테스트 통과", "- 화면 확인"].join("\n");
  const msg = formatFlightPlan({ ...p, airport: "VCDO" }, { title: "버튼", url: "u", priority: 3 }, "TEAM_F", body);
  assert.ok(msg.includes("Goal: 재생 버튼 정리\nDone when:\n- 테스트 통과\n- 화면 확인\nConstraints:\n- DB 변경"), msg);
  assert.ok(!msg.includes("src/app/song"));
  assert.ok(msg.split("\n")[1] === "BRIEF: DIRECT");
});

test("FLIGHT PLAN 문구: HOLD가 있으면 선행 FLIGHT 줄이 들어간다", () => {
  const [p] = fold([create("D-0008", "VOC-192", "b", 10), { op: "hold", id: "D-0008", at: iso(9), blockedBy: ["VOC-180"] }]);
  const msg = formatFlightPlan({ ...p, airport: "VCDO" }, { title: "별도 이슈", url: "u", priority: 2 }, "TEAM_F");
  assert.ok(msg.includes("HOLD — start after the preceding FLIGHT VOC180 is done"));
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

test("CROSSCHECK: 열린 제안에만, 나중 mark가 대신하고, HOLD·판정 뒤에는 무시, 상태는 그대로", () => {
  const xc = (id: string, min: number, verdict: "agree" | "disagree", reason: string): Op => ({ op: "crosscheck", id, at: iso(min), by: "CROSSCHECK", verdict, reason });
  const ps = fold([
    create("D-0001", "VOC-1", "b", 30),
    xc("D-0001", 25, "agree", "첫 판단"),
    xc("D-0001", 20, "disagree", "이미 완료됨"),
    create("D-0002", "VOC-2", "b", 30),
    { op: "hold", id: "D-0002", at: iso(25), blockedBy: ["VOC-9"] },
    xc("D-0002", 20, "agree", "HOLD라 무시"),
    create("D-0003", "VOC-3", "b", 30),
    { op: "verdict", id: "D-0003", at: iso(25), verdict: "agree", reason: null },
    xc("D-0003", 20, "agree", "판정 뒤라 무시"),
  ]);
  const [a, b, c] = ps;
  assert.equal(a.status, "proposed");
  assert.deepEqual(a.crosscheck, { by: "CROSSCHECK", model: "unknown", verdict: "disagree", reason: "이미 완료됨", at: iso(20) }); // 옛 기록(model 없음)은 unknown
  assert.equal(b.crosscheck, null);
  assert.equal(c.crosscheck, null);
});

test("CROSSCHECK 일치율: 판정 전에 mark가 있던 사람 판정만, agree↔agreed/approved, disagree↔disagreed/rejected", async () => {
  const { crosscheckBriefOf, humanOf } = await import("./proposals.ts");
  const xc = (id: string, verdict: "agree" | "disagree", model = "muse"): Op => ({ op: "crosscheck", id, at: iso(20), by: "CROSSCHECK", model, verdict, reason: "r" });
  const ps = fold([
    create("D-0001", "VOC-1", "b", 30), xc("D-0001", "agree"), { op: "verdict", id: "D-0001", at: iso(10), verdict: "agree", reason: null }, // 일치
    create("D-0002", "VOC-2", "b", 30), xc("D-0002", "agree"), { op: "verdict", id: "D-0002", at: iso(10), verdict: "disagree", reason: "PR #393 머지 전이면 HOLD" }, // 불일치
    create("D-0003", "VOC-3", "b", 30), xc("D-0003", "agree"), { op: "approve", id: "D-0003", at: iso(10) }, { op: "send", id: "D-0003", at: iso(9), message: "m" }, // approval 일치
    create("D-0004", "VOC-4", "b", 30), xc("D-0004", "disagree", "terra"), { op: "reject", id: "D-0004", at: iso(10), reason: "우선순위가 미정" }, // 일치
    create("D-0005", "VOC-5", "b", 30), { op: "verdict", id: "D-0005", at: iso(10), verdict: "agree", reason: null }, // mark 없음 → 안 셈
    create("D-0006", "VOC-6", "b", 30), xc("D-0006", "agree"), // 아직 판정 없음 → 안 셈, pending도 아님
    create("D-0007", "VOC-7", "b", 30), // pending
    create("D-0008", "VOC-8", "b", 30), xc("D-0008", "agree"), { op: "supersede", id: "D-0008", at: iso(10), reason: "x" }, // 사람 판정 아님
  ]);
  assert.deepEqual(gateOf(ps).crosscheck, {
    marked: 4, matched: 3, rate: 0.75,
    byModel: { muse: { marked: 3, matched: 2, rate: 2 / 3 }, terra: { marked: 1, matched: 1, rate: 1 } },
    oneClick: { count: 0, decided: 0 }, // 옛 기록(via 없음)은 세지 않는다
  });
  assert.equal(gateOf(ps).decided, 3); // 게이트는 그대로 사람 그림자 판정만
  assert.deepEqual(humanOf(ps[2]), { verdict: "agree", at: iso(10), reason: null });
  const brief = crosscheckBriefOf(ps);
  assert.deepEqual(brief.pending.map((p) => p.id), ["D-0007"]);
  // 사유 있는 판정 먼저
  assert.deepEqual(brief.examples.slice(0, 2).map((e) => [e.id, e.verdict, e.reason]), [["D-0002", "disagree", "PR #393 머지 전이면 HOLD"], ["D-0004", "disagree", "우선순위가 미정"]]);
  assert.equal(brief.examples.length, 5);
});

test("판정 방식(via)과 거절 사유 칩: 판정 op에서만 접고, oneClick은 판정 전 mark가 있고 via가 기록된 판정만, reasonCounts는 거절만", () => {
  const xc = (id: string): Op => ({ op: "crosscheck", id, at: iso(20), by: "CROSSCHECK", model: "muse", verdict: "agree", reason: "r" });
  const ps = fold([
    create("D-0001", "VOC-1", "b", 30), xc("D-0001"), { op: "verdict", id: "D-0001", at: iso(10), verdict: "agree", reason: null, via: "crosscheck" },
    create("D-0002", "VOC-2", "b", 30), xc("D-0002"),
    { op: "verdict", id: "D-0002", at: iso(10), verdict: "disagree", reason: "이미 완료됨 · 기타 — ruleset 켜짐", via: "manual", reasonCodes: ["already-done", "other"] },
    create("D-0003", "VOC-3", "b", 30), { op: "reject", id: "D-0003", at: iso(10), reason: "우선순위 미정", via: "crosscheck", reasonCodes: ["no-priority"] }, // mark 없음 → oneClick에 안 셈
    create("D-0004", "VOC-4", "b", 30), xc("D-0004"), { op: "verdict", id: "D-0004", at: iso(10), verdict: "disagree", reason: "옛 기록" }, // via 없음
    create("D-0005", "VOC-5", "b", 30), { op: "supersede", id: "D-0005", at: iso(10), reason: "x" }, // 사람 판정 아님
  ]);
  assert.equal(ps[0].via, "crosscheck");
  assert.equal(ps[0].reasonCodes, undefined);
  assert.deepEqual(ps[1].reasonCodes, ["already-done", "other"]);
  assert.equal(ps[3].via, undefined); // 채워 넣지 않는다
  assert.equal("via" in ps[3], false);
  const gate = gateOf(ps);
  assert.deepEqual(gate.crosscheck.oneClick, { count: 1, decided: 2 });
  assert.equal(gate.reasonCounts["already-done"], 1);
  assert.equal(gate.reasonCounts["no-priority"], 1);
  assert.equal(gate.reasonCounts.other, 1);
  assert.equal(gate.reasonCounts["needs-human"], 0);
});

test("SUPERSEDED 사유: LOGBOOK ARRIVED·열린 PR인 FLIGHT는 열린 제안, 승인된 ASSIGN, HOLD 모두 그 사유로 닫는다", () => {
  const landed = new Map([["VOC-40", "vocado_nextjs#400"]]);
  const pulls = [{ ticketKey: "VOC-41", number: 411 }, { ticketKey: "VOC-42", number: 412 }] as never;
  const existing = fold([
    create("D-0001", "VOC-40", "c", 30), // 열린 제안, 이미 완료됨(AIRCRAFT가 AIRBORNE이어도 이 사유가 먼저)
    create("D-0002", "VOC-41", "b", 60),
    { op: "approve", id: "D-0002", at: iso(50) }, // 승인됐지만 아직 안 보냄, 열린 PR 있음
    create("D-0003", "VOC-42", null, 30),
    { op: "hold", id: "D-0003", at: iso(20), blockedBy: ["VOC-99"] }, // HOLD, 열린 PR 있음
  ]);
  const tickets = [t("VOC-40"), t("VOC-41"), t("VOC-42"), t("VOC-99", "started", "In Progress")];
  const ops = syncOps(existing, planOf(), { tickets, workspaces: [], pulls }, DEFAULT_DISPATCH_CONFIG, NOW, 3, landed);
  assert.deepEqual(ops.map((o) => `${o.op}:${o.id}:${"reason" in o ? o.reason : ""}`), [
    "supersede:D-0001:이미 완료됨 — PR vocado_nextjs#400 머지됨(LOGBOOK)",
    "supersede:D-0002:열린 PR #411 있음",
    "supersede:D-0003:열린 PR #412 있음",
  ]);
  // LOGBOOK·열린 PR이 없으면 승인된 ASSIGN은 그대로
  assert.deepEqual(syncOps(existing.slice(1, 2), planOf(), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 3), []);
});

test("거절 사유 집계: 칩별 건수와 최근 예시 FLIGHT, planner가 그 사유를 스스로 거르나", () => {
  const ps = fold([
    create("D-0001", "VOC-1", "b", 60),
    { op: "verdict", id: "D-0001", at: iso(50), verdict: "disagree", reason: "이미 완료됨", reasonCodes: ["already-done"] },
    create("D-0002", "VOC-2", "b", 60),
    { op: "verdict", id: "D-0002", at: iso(40), verdict: "disagree", reason: "이미 완료됨 · 우선순위 미정", reasonCodes: ["already-done", "no-priority"] },
    create("D-0003", "VOC-3", "b", 60),
    { op: "verdict", id: "D-0003", at: iso(30), verdict: "agree", reason: null },
    create("D-0004", "VOC-4", "b", 60),
    { op: "verdict", id: "D-0004", at: iso(20), verdict: "disagree", reason: "옛 기록 — 칩 없음" },
  ]);
  const stats = Object.fromEntries(reasonStatsOf(ps).map((r) => [r.code, r]));
  assert.deepEqual(stats["already-done"], {
    code: "already-done", label: "이미 완료됨", count: 2, examples: ["VOC-2", "VOC-1"], auto: "auto", scope: "flight",
    how: "LOGBOOK ARRIVED·열린 PR 규칙, STAND 없는 FLIGHT의 ARRIVED 보고, Linear Done 상태 · 거절하면 FLIGHT 전체 보류(24시간, 이슈가 바뀌면 그 전에 풀림)",
  });
  assert.equal(stats["wrong-aircraft"].scope, "pair");
  assert.equal(stats["no-priority"].count, 1);
  assert.equal(stats["no-priority"].auto, "auto");
  assert.equal(stats["waiting-on-prior"].auto, "partial");
  assert.equal(stats["needs-human"].auto, "partial"); // 본문의 "사용자가 정한다"류는 OCC HOLD
  assert.equal(stats.other.count, 0);
});

test("ATFM 자동 판정(via: atfm)은 사람 판정·게이트·2b 점검에 세지 않는다", async () => {
  const { humanOf } = await import("./proposals.ts");
  const ps = fold([
    create("D-0001", "VOC-1", "b", 30),
    { op: "approve", id: "D-0001", at: iso(20), via: "atfm" },
    { op: "send", id: "D-0001", at: iso(19), message: "m" },
    create("D-0002", "VOC-2", "b", 30),
    { op: "approve", id: "D-0002", at: iso(20), via: "manual" },
    { op: "send", id: "D-0002", at: iso(19), message: "m" },
  ]);
  assert.equal(humanOf(ps[0]), null);
  assert.equal(humanOf(ps[1])?.verdict, "agree");
  assert.equal(gate3Of(ps).dispatched, 1);
});

test("RECALL: sent·accepted → recalling → recalled, departed·approved에서는 안 됨, recalling은 AIRCRAFT를 잡아 두고 10분 넘으면 overdue", async () => {
  const { formatRecall } = await import("./proposals.ts");
  const base = [create("D-0001", "VOC-1", "b", 60), { op: "approve" as const, id: "D-0001", at: iso(50) }, { op: "send" as const, id: "D-0001", at: iso(40), message: "m" }];
  const recall = (min: number): Op => ({ op: "recall", id: "D-0001", at: iso(min), reason: "우선순위 바뀜", message: "R" });
  let [p] = fold([...base, recall(30)]);
  assert.equal(p.status, "recalling");
  assert.equal(p.recallReason, "우선순위 바뀜");
  assert.equal(p.recallMessage, "R");
  assert.equal(isInFlight(p), true);
  assert.equal(reservedOf([p]).aircraft.get("TEAM_B"), "D-0001");
  assert.deepEqual(overdueOf([p], NOW), ["D-0001"]); // 30분 전 RECALL, READBACK 없음
  [p] = fold([...base, recall(30), { op: "recalled", id: "D-0001", at: iso(20) }]);
  assert.equal(p.status, "recalled");
  assert.equal(isInFlight(p), false);
  // accepted에서도 되고, departed·approved에서는 무시
  assert.equal(fold([...base, { op: "accept", id: "D-0001", at: iso(35) }, recall(30)])[0].status, "recalling");
  assert.equal(fold([...base, { op: "accept", id: "D-0001", at: iso(35) }, { op: "depart", id: "D-0001", at: iso(33), stand: "/wt/x" }, recall(30)])[0].status, "departed");
  assert.equal(fold([...base.slice(0, 2), recall(30)])[0].status, "approved");
  assert.equal(canApply(fold([...base])[0], "recall"), true);
  // 문구: 머리, FLIGHT, 사유, STAND를 두라는 말, READBACK 방법
  const text = formatRecall(fold(base)[0], { title: "권한 정리" }, "TEAM_B", "우선순위 바뀜");
  assert.equal(text.split("\n")[0], "[DISPATCH D-0001] RECALL · BRAVO (TEAM_B)");
  assert.match(text, /FLIGHT VOC1 · AIRPORT VCDO — this FLIGHT PLAN is withdrawn/);
  assert.match(text, /Reason: 우선순위 바뀜/);
  assert.match(text, /Do not clean up the STAND \(worktree\)/);
  assert.match(text, /"READBACK D-0001 RECALL"/);
});

test("RECALL 동기화: recalling은 STAND가 생겨도 DEPARTED로 바꾸지 않고 24시간 뒤 EXPIRED, recalled 짝은 READBACK부터 24시간 다시 제안하지 않는다", () => {
  const sentAt = (min: number): Op[] => [create("D-0001", "VOC-1", "b", 30 * 60), { op: "approve", id: "D-0001", at: iso(min + 2) }, { op: "send", id: "D-0001", at: iso(min + 1), message: "m" }];
  const stand = { path: "/wt/voc-1", ticketKey: "VOC-1" } as Workspace;
  const recalling = fold([...sentAt(60), { op: "recall", id: "D-0001", at: iso(60), reason: "r", message: "R" }]);
  const tickets = [t("VOC-1")];
  const plan = planOf({ assign: [assign("VOC-1", "b")] });
  assert.deepEqual(syncOps(recalling, plan, { tickets, workspaces: [stand] }, DEFAULT_DISPATCH_CONFIG, NOW, 1).filter((o) => o.id === "D-0001"), []);
  const old = fold([...sentAt(25 * 60), { op: "recall", id: "D-0001", at: iso(25 * 60), reason: "r", message: "R" }]);
  assert.deepEqual(syncOps(old, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1).filter((o) => o.id === "D-0001").map((o) => o.op), ["expire"]);
  // 30시간 전에 만든 제안이 1시간 전에 RECALLED → 같은 짝은 아직 제안하지 않고, 다른 AIRCRAFT에는 제안한다
  const recalled = fold([...sentAt(120), { op: "recall", id: "D-0001", at: iso(90), reason: "r", message: "R" }, { op: "recalled", id: "D-0001", at: iso(60) }]);
  const again = syncOps(recalled, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(again.filter((o) => o.op === "create"), []);
  const other = syncOps(recalled, planOf({ assign: [assign("VOC-1", "c")] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(other.filter((o) => o.op === "create").map((o) => o.op === "create" && `${o.flight}|${o.aircraft}`), ["VOC-1|c"]);
  // RECALLED 뒤 25시간이면 다시 제안
  const later = fold([...sentAt(50 * 60), { op: "recall", id: "D-0001", at: iso(49 * 60), reason: "r", message: "R" }, { op: "recalled", id: "D-0001", at: iso(25 * 60) }]);
  assert.deepEqual(syncOps(later, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1).filter((o) => o.op === "create").length, 1);
});

// 점수를 정한 ASSIGN 제안·계획
const scored = (id: string, flight: string, aircraft: string, minAgo: number, score: number): Op => ({ ...create(id, flight, aircraft, minAgo), score } as Op);
const planned = (flight: string, aircraft: string, score: number) => ({ ...assign(flight, aircraft), score });
const pairOps = (ops: Op[]) => ops.map((o) => `${o.op}:${o.id}${o.op === "create" ? `:${o.flight}>${o.aircraft}` : ""}${"reason" in o && o.reason ? `:${o.reason}` : ""}`);

test("24시간 짝: 닫힌 짝만(거절·SUPERSEDED·EXPIRED·RECALLED …), 열린 제안과 '더 나은 배정'으로 닫힌 것은 빼고, 24시간 지나면 풀린다", () => {
  const ps = fold([
    create("D-0001", "VOC-1", "b", 60), { op: "verdict", id: "D-0001", at: iso(50), verdict: "disagree", reason: "x" },
    create("D-0002", "VOC-2", "b", 60), { op: "supersede", id: "D-0002", at: iso(50), reason: "FLIGHT 상태가 바뀜(In Progress)" },
    create("D-0003", "VOC-3", "b", 60), { op: "supersede", id: "D-0003", at: iso(50), reason: "더 나은 배정으로 바뀜" },
    create("D-0004", "VOC-4", "b", 60), // 열린 제안
    create("D-0005", "VOC-5", "b", 25 * 60), { op: "expire", id: "D-0005", at: iso(60) }, // 25시간 전: 풀림
    create("D-0006", "VOC-6", "b", 30 * 60), { op: "approve", id: "D-0006", at: iso(29 * 60) }, { op: "send", id: "D-0006", at: iso(29 * 60), message: "m" },
    { op: "recall", id: "D-0006", at: iso(70), reason: "r", message: "m" }, { op: "recalled", id: "D-0006", at: iso(60) }, // RECALL READBACK부터 24시간
  ]);
  const pairs = recentPairsOf(ps, NOW);
  assert.deepEqual([...pairs.keys()].sort(), ["VOC-1|TEAM_B", "VOC-2|TEAM_B", "VOC-6|TEAM_B"]);
  assert.equal(pairs.get("VOC-1|TEAM_B")!.until, new Date(Date.parse(iso(60)) + 86_400_000).toISOString());
  assert.equal(pairs.get("VOC-6|TEAM_B")!.until, new Date(Date.parse(iso(60)) + 86_400_000).toISOString());
  assert.deepEqual(reservedOf(ps, NOW).recentPairs, pairs);
});

test("판정 대기 제안: 새 제안이 실제로 만들어지지 않으면 '더 나은 배정'으로 닫지 않는다(D-0017 사례)", () => {
  // D-0017(VOC-196 → b)이 열려 있고, 계획은 b에 VOC-177을 준다. 그러나 VOC-177 → b는 D-0010에서 거절돼 다시 제안할 수 없다
  const existing = fold([
    create("D-0010", "VOC-177", "b", 20 * 60), { op: "verdict", id: "D-0010", at: iso(19 * 60), verdict: "disagree", reason: "x" },
    scored("D-0017", "VOC-196", "b", 30, 10.3),
  ]);
  const tickets = [{ ...t("VOC-177"), priority: 2, project: "Beta Readiness", labels: [] }, { ...t("VOC-196"), priority: 3, project: "Beta Readiness", labels: [] }] as Ticket[];
  const ops = syncOps(existing, planOf({ assign: [planned("VOC-177", "b", 10.8)] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 17);
  assert.deepEqual(ops, []); // D-0017은 판정을 기다린다
});

test("판정 대기 제안: 같은 FLIGHT·AIRCRAFT에 20% 이상 높은 새 제안이 만들어질 때만 바꾼다", () => {
  const existing = fold([scored("D-0001", "VOC-1", "b", 30, 10)]);
  const tickets = [t("VOC-1"), t("VOC-2")].map((x) => ({ ...x, priority: 3, project: "Beta Readiness", labels: [] })) as Ticket[];
  const run = (score: number) => syncOps(existing, planOf({ assign: [planned("VOC-2", "b", score)] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(pairOps(run(11.9)), []); // 19% 높음: 그대로
  assert.deepEqual(pairOps(run(12)), ["supersede:D-0001:더 나은 배정으로 바뀜 — D-0002 (10 → 12)", "create:D-0002:VOC-2>b"]);
  // 같은 FLIGHT를 다른 AIRCRAFT에 줄 때도 같은 기준
  const other = syncOps(existing, planOf({ assign: [planned("VOC-1", "c", 13)] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1);
  assert.deepEqual(pairOps(other), ["supersede:D-0001:더 나은 배정으로 바뀜 — D-0002 (10 → 13)", "create:D-0002:VOC-1>c"]);
});

test("판정 대기 제안: 상태가 바뀐 경우(Todo 아님, AIRCRAFT 불가, 제외 규칙)는 지금처럼 바로 닫는다", () => {
  const existing = fold([scored("D-0001", "VOC-1", "b", 30, 10), scored("D-0002", "VOC-2", "c", 30, 10), scored("D-0003", "VOC-3", "b", 30, 10)]);
  const tickets = [t("VOC-1", "started", "In Progress"), { ...t("VOC-2"), priority: 3, project: "Beta Readiness", labels: [] }, { ...t("VOC-3"), priority: 0, project: "Beta Readiness", labels: [] }] as Ticket[];
  const ops = syncOps(existing, planOf(), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 3);
  assert.deepEqual(pairOps(ops), [
    "supersede:D-0001:FLIGHT 상태가 바뀜(In Progress)",
    "supersede:D-0002:AIRCRAFT 불가: AIRBORNE",
    "supersede:D-0003:우선순위 없음 — 사람이 정할 때까지 배정하지 않음",
  ]);
});

test("'더 나은 배정'으로 닫힌 짝은 판정받지 못한 것이라 24시간 안이라도 다시 제안된다", () => {
  const existing = fold([create("D-0017", "VOC-196", "b", 60), { op: "supersede", id: "D-0017", at: iso(50), reason: "더 나은 배정으로 바뀜" }]);
  const tickets = [{ ...t("VOC-196"), priority: 3, project: "Beta Readiness", labels: [] }] as Ticket[];
  const ops = syncOps(existing, planOf({ assign: [planned("VOC-196", "b", 10.3)] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 17);
  assert.deepEqual(pairOps(ops), ["create:D-0018:VOC-196>b"]);
});

// ── STAND 없는 FLIGHT(SURVEY·CHECK): READBACK = DEPARTED, CAPTAIN 보고 = ARRIVED ──

const lt = (key: string, type: string, stateType: Ticket["stateType"] = "unstarted", state = "Todo") =>
  ({ key, state, stateType, labels: [`type:${type}`] }) as unknown as Ticket;
const sentOps = (id: string, flight: string, minAgo: number, aircraft = "b"): Op[] => [
  create(id, flight, aircraft, minAgo + 3),
  { op: "approve", id, at: iso(minAgo + 2) },
  { op: "send", id, at: iso(minAgo + 1), message: "m" },
];

test("READBACK: SURVEY·CHECK는 같은 시각에 DEPARTED(stand null, via readback), STAND가 필요하거나 모르는 FLIGHT는 accept만", async () => {
  const { readbackOps } = await import("./proposals.ts");
  const at = iso(0);
  assert.deepEqual(readbackOps({ id: "D-0001" }, lt("VOC-1", "SURVEY"), at), [
    { op: "accept", id: "D-0001", at },
    { op: "depart", id: "D-0001", at, stand: null, via: "readback" },
  ]);
  assert.equal(readbackOps({ id: "D-0001" }, lt("VOC-1", "CHECK"), at).length, 2);
  assert.deepEqual(readbackOps({ id: "D-0001" }, lt("VOC-1", "BUILD"), at), [{ op: "accept", id: "D-0001", at }]);
  assert.deepEqual(readbackOps({ id: "D-0001" }, { labels: [] }, at), [{ op: "accept", id: "D-0001", at }]); // 기본값 BUILD
  assert.deepEqual(readbackOps({ id: "D-0001" }, undefined, at), [{ op: "accept", id: "D-0001", at }]); // 모르는 FLIGHT
});

test("STAND 없는 FLIGHT 전이: accepted → departed(readback) → arrived, 보고와 링크가 남고 ARRIVED에서 예약이 풀린다", async () => {
  const { readbackOps } = await import("./proposals.ts");
  const flying = [...sentOps("D-0001", "VOC-1", 60), ...readbackOps({ id: "D-0001" }, lt("VOC-1", "SURVEY"), iso(50))];
  let [p] = fold(flying);
  assert.equal(p.status, "departed");
  assert.equal(p.departedStand, null);
  assert.equal(p.departedVia, "readback");
  assert.deepEqual(Object.keys(p.timeline), ["proposed", "approved", "sent", "accepted", "departed"]);
  assert.equal(isInFlight(p), true);
  const r = reservedOf([p], NOW);
  assert.equal(r.aircraft.get("TEAM_B"), "D-0001");
  assert.equal(r.flights.get("VOC-1"), "D-0001");
  assert.deepEqual(r.aircraftFlights?.get("TEAM_B"), ["VOC-1"]);
  assert.equal(canApply(p, "arrived"), true);
  assert.equal(canApply(p, "recall"), true);
  assert.equal(canApply(p, "expire"), false);
  assert.equal(canApply(p, "supersede"), false);

  [p] = fold([...flying, { op: "arrived", id: "D-0001", at: iso(10), note: "결과 https://github.com/o/r/issues/5#issuecomment-9 에 정리" }]);
  assert.equal(p.status, "arrived");
  assert.equal(p.timeline.arrived, iso(10));
  assert.equal(p.arrivedNote, "결과 https://github.com/o/r/issues/5#issuecomment-9 에 정리");
  assert.equal(p.arrivedUrl, "https://github.com/o/r/issues/5#issuecomment-9");
  assert.equal(isInFlight(p), false);
  const after = reservedOf([p], NOW);
  assert.equal(after.aircraft.size, 0);
  assert.equal(after.flights.size, 0);
  assert.equal(after.arrived?.get("VOC-1"), "D-0001");
  // 링크 없는 한 줄
  const [q] = fold([...flying, { op: "arrived", id: "D-0001", at: iso(10), note: "조사 끝, 결론은 이슈 댓글" }]);
  assert.equal(q.arrivedUrl, undefined);
});

test("ARRIVED는 STAND 없이 DEPARTED한 것에만: STAND DEPARTED·accepted·sent에서는 무시, STAND DEPARTED는 RECALL도 안 됨", () => {
  const arrived: Op = { op: "arrived", id: "D-0001", at: iso(5), note: "n" };
  const standDeparted = fold([...sentOps("D-0001", "VOC-1", 60), { op: "accept", id: "D-0001", at: iso(50) }, { op: "depart", id: "D-0001", at: iso(40), stand: "/w/VOC-1" }, arrived])[0];
  assert.equal(standDeparted.status, "departed");
  assert.equal(standDeparted.departedVia, "stand");
  assert.equal(isInFlight(standDeparted), false);
  assert.equal(canApply(standDeparted, "arrived"), false);
  assert.equal(canApply(standDeparted, "recall"), false);
  assert.equal(fold([...sentOps("D-0001", "VOC-1", 60), { op: "accept", id: "D-0001", at: iso(50) }, arrived])[0].status, "accepted");
  assert.equal(fold([...sentOps("D-0001", "VOC-1", 60), arrived])[0].status, "sent");
});

test("동기화: STAND 없이 DEPARTED한 제안은 만료·SUPERSEDED 없이 ARRIVED까지 둔다(30일, FLIGHT 상태가 바뀌어도, AIRCRAFT가 AIRBORNE이어도)", () => {
  const ops = [...sentOps("D-0001", "VOC-1", 30 * 24 * 60), { op: "accept" as const, id: "D-0001", at: iso(30 * 24 * 60 - 1) }, { op: "depart" as const, id: "D-0001", at: iso(30 * 24 * 60 - 1), stand: null, via: "readback" as const }];
  const existing = fold(ops);
  const plan = planOf({ aircraft: [{ id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: false, reason: "AIRBORNE", reserved: null }] });
  for (const tickets of [[lt("VOC-1", "SURVEY")], [lt("VOC-1", "SURVEY", "started", "In Progress")], [lt("VOC-1", "SURVEY", "canceled", "Canceled")], []]) {
    assert.deepEqual(syncOps(existing, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1), []);
  }
  // STAND가 나중에 생겨도 departed(readback)는 그대로
  assert.deepEqual(syncOps(existing, plan, { tickets: [lt("VOC-1", "SURVEY")], workspaces: [ws("VOC-1")] }, DEFAULT_DISPATCH_CONFIG, NOW, 1), []);
});

test("동기화: accepted에 남은 STAND 없는 FLIGHT(옛 기록, READBACK 때 FLIGHT를 몰랐음)는 다음 바퀴에 DEPARTED(readback), STAND 필요한 것은 그대로", () => {
  const accepted = (id: string, flight: string) => [...sentOps(id, flight, 60), { op: "accept" as const, id, at: iso(50) }];
  const existing = fold([...accepted("D-0001", "VOC-1"), ...accepted("D-0002", "VOC-2")]);
  const ops = syncOps(existing, planOf(), { tickets: [lt("VOC-1", "CHECK"), lt("VOC-2", "BUILD")], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 2);
  assert.deepEqual(ops, [{ op: "depart", id: "D-0001", at: iso(0), stand: null, via: "readback" }]);
  // 실제 STAND가 있으면 그 STAND로 DEPARTED
  const withStand = syncOps(existing, planOf(), { tickets: [lt("VOC-1", "CHECK")], workspaces: [ws("VOC-1")] }, DEFAULT_DISPATCH_CONFIG, NOW, 2);
  assert.deepEqual(withStand.filter((o) => o.id === "D-0001"), [{ op: "depart", id: "D-0001", at: iso(0), stand: "/w/VOC-1" }]);
});

test("RECALL: STAND 없이 DEPARTED한 FLIGHT도 RECALL되고, RECALLED면 STAND 경우처럼 예약이 풀리고 짝은 24시간 막힌다", async () => {
  const { formatRecall } = await import("./proposals.ts");
  const flying: Op[] = [...sentOps("D-0001", "VOC-1", 120), { op: "accept", id: "D-0001", at: iso(110) }, { op: "depart", id: "D-0001", at: iso(110), stand: null, via: "readback" }];
  let [p] = fold([...flying, { op: "recall", id: "D-0001", at: iso(60), reason: "r", message: "R" }]);
  assert.equal(p.status, "recalling");
  assert.equal(isInFlight(p), true);
  assert.equal(reservedOf([p], NOW).aircraft.get("TEAM_B"), "D-0001");
  // STAND 없는 FLIGHT의 RECALL 문구는 STAND 대신 중간 결과를 남기라고 한다
  const text = formatRecall(fold(flying)[0], { title: "t" }, "TEAM_B", "r");
  assert.match(text, /interim results, leave a link or one line/);
  assert.doesNotMatch(text, /STAND \(worktree\)/);
  [p] = fold([...flying, { op: "recall", id: "D-0001", at: iso(60), reason: "r", message: "R" }, { op: "recalled", id: "D-0001", at: iso(30) }]);
  assert.equal(p.status, "recalled");
  assert.equal(isInFlight(p), false);
  const r = reservedOf([p], NOW);
  assert.equal(r.aircraft.size, 0);
  assert.equal(r.flights.size, 0);
  assert.equal(r.arrived?.size, 0);
  assert.equal(recentPairsOf([p], NOW).get("VOC-1|TEAM_B")?.until, new Date(Date.parse(iso(30)) + 86_400_000).toISOString());
  // 같은 짝은 다시 제안하지 않고, 다른 AIRCRAFT에는 제안한다
  const tickets = [lt("VOC-1", "SURVEY")];
  assert.deepEqual(syncOps([p], planOf({ assign: [assign("VOC-1", "b")] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1), []);
  assert.equal(syncOps([p], planOf({ assign: [assign("VOC-1", "c")] }), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1)[0]?.op, "create");
});

test("overdue: STAND 없이 DEPARTED하고 24시간 넘게 ARRIVED 보고가 없으면 올린다(만료는 하지 않는다)", () => {
  const flying = (id: string, minAgo: number): Op[] => [...sentOps(id, `VOC-${id.slice(-1)}`, minAgo + 5), { op: "accept", id, at: iso(minAgo) }, { op: "depart", id, at: iso(minAgo), stand: null, via: "readback" }];
  const ps = fold([...flying("D-0001", 25 * 60), ...flying("D-0002", 120)]);
  assert.deepEqual(overdueOf(ps, NOW), ["D-0001"]);
});

test("gate3: STAND 없는 FLIGHT는 READBACK 비율에는 넣고 DEPARTED 비율에서는 뺀다(standFree로 따로)", () => {
  const ops: Op[] = [];
  // 10건 보냄, 9건 READBACK: 그중 3건 SURVEY(READBACK = DEPARTED, 1건 ARRIVED), 6건 BUILD 중 5건 STAND
  for (let i = 1; i <= 10; i++) {
    const id = `D-${String(i).padStart(4, "0")}`;
    ops.push(...sentOps(id, `VOC-${i}`, 100));
    if (i > 9) continue;
    ops.push({ op: "accept", id, at: iso(95) });
    if (i <= 3) ops.push({ op: "depart", id, at: iso(95), stand: null, via: "readback" });
    else if (i <= 8) ops.push({ op: "depart", id, at: iso(60), stand: `/w/${i}` });
  }
  ops.push({ op: "arrived", id: "D-0001", at: iso(10), note: "n" });
  const g = gate3Of(fold(ops));
  assert.equal(g.dispatched, 10);
  assert.equal(g.readBack, 9);
  assert.equal(g.readbackRate, 0.9);
  assert.equal(g.departed, 5);
  assert.equal(g.departedRate, 5 / 6);
  assert.deepEqual(g.standFree, { readBack: 3, arrived: 1, timely: null });
  assert.equal(g.ready, true);
  // STAND 없는 것만 있으면 DEPARTED 비율을 잴 수 없다(저절로 100%가 되지 않는다)
  const onlyLight = gate3Of(fold(ops.filter((o) => ["D-0001", "D-0002", "D-0003"].includes(o.id))));
  assert.equal(onlyLight.departedRate, null);
  assert.equal(onlyLight.ready, false);
});

test("planner: 날고 있는 STAND 없는 FLIGHT는 '진행 중인 제안', ARRIVED 뒤 7일은 '이미 완료됨', 그 AIRCRAFT는 STAND FLIGHT는 받는다", async () => {
  const { planDispatch, arrivedWhy } = await import("./dispatch.ts");
  const VCDO = "/r/vocado";
  const tk = (key: string, labels: string[]) =>
    ({ key, title: key, state: "Todo", stateType: "unstarted", priority: 2, project: "Beta Readiness", labels, blocks: [], blockedBy: [], related: [], parent: null, children: [], createdAt: iso(60), updatedAt: iso(60) }) as unknown as Ticket;
  const s = {
    at: iso(0), sessions: [{ id: "b", name: "TEAM_B", status: "idle", repo: VCDO }], workspaces: [], claims: [], pulls: [],
    tickets: [tk("VOC-1", ["type:SURVEY"]), tk("VOC-2", ["type:BUILD"]), tk("VOC-3", ["type:CHECK"])],
    airports: [{ id: "r", code: "VCDO", name: "vocado", repo: VCDO }], atfm: { mains: [], groundStops: [] },
  } as unknown as import("./model.ts").Snapshot;
  const flying = fold([...sentOps("D-0001", "VOC-1", 60), { op: "accept", id: "D-0001", at: iso(50) }, { op: "depart", id: "D-0001", at: iso(50), stand: null, via: "readback" }]);
  let plan = planDispatch(s, new Map(), DEFAULT_DISPATCH_CONFIG, NOW, reservedOf(flying, NOW));
  assert.equal(plan.excluded.find((e) => e.flight === "VOC-1")?.reason, "진행 중인 제안 D-0001");
  assert.deepEqual(plan.assign.map((a) => a.flight), ["VOC-2"]); // STAND 없는 것은 AIRCRAFT당 1건이라 VOC-3은 못 받는다
  assert.equal(plan.aircraft[0].reservedLight, "D-0001");
  const arrived = fold([...sentOps("D-0001", "VOC-1", 60), { op: "accept", id: "D-0001", at: iso(50) }, { op: "depart", id: "D-0001", at: iso(50), stand: null, via: "readback" }, { op: "arrived", id: "D-0001", at: iso(40), note: "n" }]);
  plan = planDispatch(s, new Map(), DEFAULT_DISPATCH_CONFIG, NOW, reservedOf(arrived, NOW));
  assert.equal(plan.excluded.find((e) => e.flight === "VOC-1")?.reason, arrivedWhy("D-0001"));
  assert.equal(plan.aircraft[0].reservedLight, null);
  // 7일 넘게 지난 ARRIVED는 Linear 상태를 믿는다
  plan = planDispatch(s, new Map(), DEFAULT_DISPATCH_CONFIG, NOW + 8 * 86_400_000, reservedOf(arrived, NOW + 8 * 86_400_000));
  assert.equal(plan.excluded.find((e) => e.flight === "VOC-1"), undefined);
});

test("2b 점검표 코드 사실(selfCheck2b): 지금 코드는 RECALL·STAND 없는 FLIGHT 모두 갖춰짐, atcctl에 명령이 없으면 빠진 것으로", async () => {
  const { readFileSync } = await import("node:fs");
  const { selfCheck2b } = await import("./proposals.ts");
  const src = readFileSync(new URL("../controller/atcctl.mjs", import.meta.url), "utf8");
  assert.deepEqual(selfCheck2b(src, NOW), { recallMissing: [], standFreeMissing: [] });
  assert.deepEqual(selfCheck2b(null, NOW), { recallMissing: ["atcctl dispatch recall-send", "atcctl dispatch recalled"], standFreeMissing: ["atcctl dispatch arrived"] });
});

test("FLIGHT 보류 목록: FLIGHT 자체의 칩으로 거절된 ASSIGN만(24시간), wrong-aircraft·other·칩 없음은 짝 차단만", () => {
  const ps = fold([
    create("D-0022", "VOC-177", "d", 60), { op: "verdict", id: "D-0022", at: iso(50), verdict: "disagree", reason: "x", reasonCodes: ["waiting-on-prior"], via: "crosscheck" },
    create("D-0023", "VOC-125", "a", 60), { op: "verdict", id: "D-0023", at: iso(40), verdict: "disagree", reason: "x", reasonCodes: ["wrong-aircraft", "needs-human"] },
    create("D-0030", "VOC-30", "b", 60), { op: "verdict", id: "D-0030", at: iso(40), verdict: "disagree", reason: "x", reasonCodes: ["wrong-aircraft"] },
    create("D-0031", "VOC-31", "b", 60), { op: "verdict", id: "D-0031", at: iso(40), verdict: "disagree", reason: "옛 판정 — 칩 없음" },
    create("D-0032", "VOC-32", "b", 60), { op: "verdict", id: "D-0032", at: iso(40), verdict: "disagree", reason: "x", reasonCodes: ["other"] },
    create("D-0033", "VOC-33", "b", 26 * 60), { op: "verdict", id: "D-0033", at: iso(25 * 60), verdict: "disagree", reason: "x", reasonCodes: ["no-priority"] }, // 24시간 지남
    create("D-0034", "VOC-34", "b", 60), { op: "reject", id: "D-0034", at: iso(30), reason: "x", reasonCodes: ["parent-issue"] }, // approval 거절도
  ]);
  const held = recentFlightsOf(ps, NOW);
  assert.deepEqual(
    [...held].map(([f, h]) => `${f}:${h.id}:${h.codes.join("+")}`).sort(),
    ["VOC-125:D-0023:needs-human", "VOC-177:D-0022:waiting-on-prior", "VOC-34:D-0034:parent-issue"],
  );
  assert.equal(held.get("VOC-177")!.decidedAt, iso(50));
  assert.equal(held.get("VOC-177")!.until, new Date(Date.parse(iso(50)) + 86_400_000).toISOString());
  assert.deepEqual(reservedOf(ps, NOW).recentFlights, held);
});

test("FLIGHT 보류: 같은 FLIGHT의 다른 AIRCRAFT 열린 제안은 보류 사유로 닫힌다(D-0023 뒤 D-0024 사례)", () => {
  const ps = fold([
    create("D-0023", "VOC-125", "b", 60), { op: "verdict", id: "D-0023", at: iso(40), verdict: "disagree", reason: "x", reasonCodes: ["needs-human"] },
    create("D-0024", "VOC-125", "c", 30),
  ]);
  const why = "FLIGHT 보류 — 사람 결정 필요 (D-0023 판정) — 이슈가 바뀌거나 …";
  const c = { id: "c", name: "TEAM_C", callsign: "CHARLIE", airport: "VCDO", available: true, reason: "PARKED", reserved: null };
  const ops = syncOps(ps, planOf({ aircraft: [c], excluded: [{ flight: "VOC-125", reason: why }] }), { tickets: [t("VOC-125")], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 24);
  assert.deepEqual(ops.map((o) => `${o.op}:${o.id}:${"reason" in o ? o.reason : ""}`), [`supersede:D-0024:${why}`]);
});

test("한 번 클릭 판정(via crosscheck)도 사유 칩이 남는다", () => {
  const [p] = fold([create("D-0022", "VOC-177", "d", 60), { op: "verdict", id: "D-0022", at: iso(10), verdict: "disagree", reason: "사람 결정 필요 — 사용자 지시를 기다림", reasonCodes: ["needs-human"], via: "crosscheck" }]);
  assert.deepEqual(p.reasonCodes, ["needs-human"]);
  assert.equal(p.via, "crosscheck");
  assert.deepEqual(gateOf([p]).reasonCounts?.["needs-human"], 1);
});

test("접기: brief는 BRIEFING 세 줄을 덮어쓰고 상태는 바꾸지 않는다", () => {
  const [p] = fold([
    create("D-0001", "VOC-1", "TEAM_B", 30),
    { op: "brief", id: "D-0001", at: iso(20), what: "a", why: "b", risk: "c" },
    { op: "brief", id: "D-0001", at: iso(10), what: "a2", why: "b2", risk: "c2" },
  ]);
  assert.equal(p.status, "proposed");
  assert.deepEqual(p.briefing, { what: "a2", why: "b2", risk: "c2", at: iso(10) });
  assert.equal(fold([create("D-0002", "VOC-2", "TEAM_B", 5)])[0].briefing, undefined);
});

test("접기: blind 판정은 제안에 blind를 남기고, gateOf가 blind 합의율을 따로 센다", () => {
  const ps = fold([
    create("D-0001", "VOC-1", "TEAM_B", 30),
    create("D-0002", "VOC-2", "TEAM_B", 30),
    create("D-0003", "VOC-3", "TEAM_B", 30),
    { op: "verdict", id: "D-0001", at: iso(10), verdict: "agree", reason: null, via: "manual", blind: true },
    { op: "verdict", id: "D-0002", at: iso(10), verdict: "disagree", reason: null, via: "manual", blind: true },
    { op: "verdict", id: "D-0003", at: iso(10), verdict: "agree", reason: null, via: "crosscheck" },
  ]);
  assert.deepEqual(ps.map((p) => p.blind), [true, true, undefined]);
  const g = gateOf(ps);
  assert.equal(g.decided, 3);
  assert.deepEqual(g.blind, { decided: 2, agreed: 1, agreement: 0.5 });
});

test("gateOf: 한 번 클릭 비율에서 blind 판정은 뺀다(한 번 클릭이 막혀 있다)", () => {
  const mark = { op: "crosscheck" as const, by: "CROSSCHECK", model: "muse-spark-1.3", verdict: "agree" as const, reason: "ok" };
  const ps = fold([
    create("D-0001", "VOC-1", "TEAM_B", 30),
    create("D-0002", "VOC-2", "TEAM_B", 30),
    create("D-0003", "VOC-3", "TEAM_B", 30),
    { ...mark, id: "D-0001", at: iso(20) },
    { ...mark, id: "D-0002", at: iso(20) },
    { ...mark, id: "D-0003", at: iso(20) },
    { op: "verdict", id: "D-0001", at: iso(10), verdict: "agree", reason: null, via: "crosscheck" },
    { op: "verdict", id: "D-0002", at: iso(10), verdict: "agree", reason: null, via: "manual" },
    { op: "verdict", id: "D-0003", at: iso(10), verdict: "agree", reason: null, via: "manual", blind: true },
  ]);
  assert.deepEqual(gateOf(ps).crosscheck.oneClick, { count: 1, decided: 2 });
});

test("FLIGHT PLAN 문구(DIRECT): 긴 이슈(ATC-34)도 완료 기준·제약을 끝까지 싣는다(ATC-35)", () => {
  const [p] = fold([create("D-0035", "ATC-34", "h", 10)]);
  const body = readFileSync(new URL("./fixtures/atc-34-body.md", import.meta.url), "utf8");
  const msg = formatFlightPlan({ ...p, airport: "ATCC" }, { title: "AUTOLAND", url: "u", priority: 2 }, "TEAM_H", body);
  assert.ok(msg.includes("any PR the SUPERVISOR marks \"hold\""));
  assert.ok(msg.includes("puts AUTOLAND in GROUND STOP"));
  assert.ok(msg.includes("The atc repo's own landing (structure merges auto/flagged) is out of scope."));
  assert.ok(msg.endsWith("Carry it through to the end; stop and ask only for what needs a SUPERVISOR decision."));
});

test("STANDBY D-xxxx(ATC-122): sent에서만 받고, 첫 STANDBY부터 READBACK overdue 10분을 한 번 다시 센다", () => {
  const sent: Op[] = [create("D-0001", "VOC-1", "b", 60), { op: "approve", id: "D-0001", at: iso(40) }, { op: "send", id: "D-0001", at: iso(12), message: "m" }];
  // 보낸 지 12분: overdue
  assert.deepEqual(overdueOf(fold(sent), NOW), ["D-0001"]);
  // 4분 전 STANDBY: 아직 아님. 상태는 sent 그대로
  const standby = fold([...sent, { op: "standby", id: "D-0001", at: iso(4) }]);
  assert.equal(standby[0].status, "sent");
  assert.equal(standby[0].standbyAt, iso(4));
  assert.equal(standby[0].standbys, 1);
  assert.deepEqual(overdueOf(standby, NOW), []);
  // 두 번째 STANDBY는 세기만 하고 기준을 옮기지 않는다
  const twice = fold([...sent, { op: "standby", id: "D-0001", at: iso(11) }, { op: "standby", id: "D-0001", at: iso(1) }]);
  assert.equal(twice[0].standbyAt, iso(11));
  assert.equal(twice[0].standbys, 2);
  assert.deepEqual(overdueOf(twice, NOW), ["D-0001"]);
  // sent가 아닌 제안(approved, accepted)의 STANDBY는 무시한다
  const approved = fold([create("D-0002", "VOC-2", "c", 60), { op: "approve", id: "D-0002", at: iso(40) }, { op: "standby", id: "D-0002", at: iso(4) }]);
  assert.equal(approved[0].standbyAt, undefined);
  // UNABLE D-xxxx는 decline이다: 사유와 함께 declined로 닫힌다
  const unable = fold([...sent, { op: "decline", id: "D-0001", at: iso(2), reason: "다른 FLIGHT가 먼저" }]);
  assert.equal(unable[0].status, "declined");
  assert.equal(unable[0].reason, "다른 FLIGHT가 먼저");
  assert.deepEqual(overdueOf(unable, NOW), []);
});

// ── SETTLED(ATC-117) ──
const settleAt = (o: Op[], id: string) => fold(o).find((p) => p.id === id)!;

test("settledOf: 승인은 바로, 열린·HELD는 W분 뒤에, 그 밖의 상태는 아니다, W=0은 곧장", () => {
  const young = settleAt([create("D-0001", "VOC-1", "b", 3)], "D-0001");
  const old = settleAt([create("D-0002", "VOC-2", "b", 10)], "D-0002");
  const held = settleAt([create("D-0003", "VOC-3", "b", 12), { op: "hold", id: "D-0003", at: iso(11), blockedBy: ["VOC-9"] }], "D-0003");
  const heldYoung = settleAt([create("D-0004", "VOC-4", "b", 2), { op: "hold", id: "D-0004", at: iso(1), blockedBy: [] }], "D-0004");
  const approvedAtOnce = settleAt([create("D-0005", "VOC-5", "b", 1), { op: "approve", id: "D-0005", at: iso(0.5) }], "D-0005");
  const superseded = settleAt([create("D-0006", "VOC-6", "b", 30), { op: "supersede", id: "D-0006", at: iso(5), reason: "x" }], "D-0006");
  assert.equal(DEFAULT_SETTLE_MIN, 10);
  assert.equal(settledOf(young, NOW, 10), false);
  assert.equal(settledOf(old, NOW, 10), true); // 정확히 W분
  assert.equal(settledOf(held, NOW, 10), true);
  assert.equal(isHeld(heldYoung), true);
  assert.equal(settledOf(heldYoung, NOW, 10), false);
  assert.equal(settledOf(approvedAtOnce, NOW, 10), true);
  assert.equal(settledOf(superseded, NOW, 10), false); // 닫힌 제안은 SETTLED가 아니다
  for (const p of [young, heldYoung, approvedAtOnce]) assert.equal(settledOf(p, NOW, 0), true); // W=0: 예전처럼 곧장
  assert.equal(settledOf(superseded, NOW, 0), false);
});

test("settlesInMin·withSettled: 남은 분은 올림, SETTLED이거나 닫혔으면 0, 브리핑 항목에 settled가 붙는다", () => {
  const young = settleAt([create("D-0001", "VOC-1", "b", 3.5)], "D-0001");
  assert.equal(settlesInMin(young, NOW, 10), 7); // 6.5분 → 7
  assert.equal(settlesInMin(settleAt([create("D-0002", "VOC-2", "b", 11)], "D-0002"), NOW, 10), 0);
  assert.equal(settlesInMin(settleAt([create("D-0003", "VOC-3", "b", 1), { op: "supersede", id: "D-0003", at: iso(0), reason: "x" }], "D-0003"), NOW, 10), 0);
  const item = withSettled(young, NOW, 10);
  assert.equal(item.settled, false);
  assert.equal(item.settlesInMin, 7);
  assert.equal(item.id, "D-0001");
  assert.equal(withSettled(young, NOW, 0).settled, true);
});

test("crosscheckBriefOf(ATC-117): SETTLED인 제안만 pending, 나머지는 unsettledMarks 수, W=0이면 전부", () => {
  const ps = fold([
    create("D-0001", "VOC-1", "b", 30), // SETTLED
    create("D-0002", "VOC-2", "b", 4), // 어림
    create("D-0003", "VOC-3", "b", 20), { op: "hold", id: "D-0003", at: iso(19), blockedBy: [] }, // HELD는 원래 mark 대상이 아니다
    create("D-0004", "VOC-4", "b", 2),
    create("D-0005", "VOC-5", "b", 30), { op: "crosscheck", id: "D-0005", at: iso(5), by: "CROSSCHECK", model: "muse", verdict: "agree", reason: "r" }, // 이미 mark: 세지 않음
  ]);
  const b = crosscheckBriefOf(ps, NOW, 10);
  assert.deepEqual(b.pending.map((p) => p.id), ["D-0001"]);
  assert.equal(b.unsettledMarks, 2);
  const all = crosscheckBriefOf(ps, NOW, 0);
  assert.deepEqual(all.pending.map((p) => p.id), ["D-0001", "D-0002", "D-0004"]);
  assert.equal(all.unsettledMarks, 0);
});

test("replay(ATC-117): 로그와 같은 모양의 고정 자료에서 W=10이면 헛된 메모+BRIEFING 세트가 29건 중 17건 줄고, 승인된 제안은 하나도 늦지 않는다", () => {
  // 메모까지 받고 SUPERSEDED된 29건의 살아 있던 분. 5분 미만 1, 5–10 16, 10–15 5, 15–20 2, 20 이상 5
  const lifetimes = [3, 5.1, 5.5, 6, 6.1, 6.5, 7, 7.1, 7.5, 8, 8.5, 9, 9.2, 9.4, 9.6, 9.8, 9.9, 10.5, 11, 12, 13, 14, 15.5, 18, 20, 25, 40, 90, 200];
  assert.equal(lifetimes.length, 29);
  const ops: Op[] = [];
  lifetimes.forEach((life, i) => {
    const id = `D-${String(i + 1).padStart(4, "0")}`;
    const created = 400 - i * 10; // 분 전. 서로 겹치지 않게 흩는다
    ops.push(create(id, `ATC-${i + 1}`, "b", created));
    ops.push({ op: "note", id, at: iso(created - 1), text: "note", caution: false });
    ops.push({ op: "brief", id, at: iso(created - 1), what: "w", why: "y", risk: "r" } as Op);
    ops.push({ op: "supersede", id, at: iso(created - life), reason: "더 나은 배정으로 바뀜" });
  });
  // 승인된 20건(만든 지 3.9분 뒤 승인 같은 것)은 W와 상관없이 SETTLED
  for (let i = 0; i < 20; i++) {
    const id = `D-${String(100 + i).padStart(4, "0")}`;
    ops.push(create(id, `ATC-${200 + i}`, "b", 1000 - i * 5), { op: "approve", id, at: iso(1000 - i * 5 - 3.9) });
  }
  const ps = fold(ops);
  const superseded = ps.filter((p) => p.status === "superseded" && p.note);
  const avoided = (w: number) =>
    superseded.filter((p) => !settledOf({ status: "proposed", at: p.at }, Date.parse(p.statusAt), w)).length;
  assert.equal(superseded.length, 29);
  assert.deepEqual([5, 10, 15, 20].map(avoided), [1, 17, 22, 24]);
  assert.equal(avoided(0), 0); // W=0은 오늘과 같다
  const approved = ps.filter((p) => p.status === "approved");
  assert.equal(approved.length, 20);
  assert.equal(approved.filter((p) => !settledOf(p, NOW, 10)).length, 0);
});

test("dispatch.json settleMin(ATC-117): 기본 10, 0은 받고, 음수·숫자가 아닌 값은 기본으로", () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-"));
  const file = join(dir, "dispatch.json");
  assert.equal(loadDispatchConfig(file).settleMin, 10); // 파일 없음
  for (const [v, want] of [[0, 0], [15, 15], [-1, 10], ["5", 10], [null, 10]] as const) {
    writeFileSync(file, JSON.stringify({ settleMin: v }));
    assert.equal(loadDispatchConfig(file).settleMin, want, String(v));
  }
});

test("settledItemsOf(ATC-117): dispatch brief의 open·held에 settled·settlesInMin이 붙고 unsettled는 아직 SETTLED가 아닌 열린·HELD 수(메모가 있어도)", () => {
  const ps = fold([
    create("D-0001", "VOC-1", "b", 30), // SETTLED
    create("D-0002", "VOC-2", "b", 4), { op: "note", id: "D-0002", at: iso(3), text: "n", caution: false }, // 어림, 메모가 있어도 센다
    create("D-0003", "VOC-3", "b", 2), { op: "hold", id: "D-0003", at: iso(1), blockedBy: [] }, // 어린 HELD
    create("D-0004", "VOC-4", "b", 20), { op: "hold", id: "D-0004", at: iso(19), blockedBy: [] }, // 오래된 HELD
    create("D-0005", "VOC-5", "b", 1), { op: "approve", id: "D-0005", at: iso(0.5) }, // 승인: open·held에 없다
  ]);
  const r = settledItemsOf(ps, NOW, 10);
  assert.deepEqual(r.open.map((p) => [p.id, p.settled, p.settlesInMin]), [["D-0001", true, 0], ["D-0002", false, 6]]);
  assert.deepEqual(r.held.map((p) => [p.id, p.settled, p.settlesInMin]), [["D-0003", false, 8], ["D-0004", true, 0]]);
  assert.equal(r.unsettled, 2);
  assert.equal(settledItemsOf(ps, NOW, 0).unsettled, 0); // W=0
});

test("DEFAULT_SETTLE_MIN(ATC-117): 설정 기본값과 같은 상수를 쓴다", () => {
  assert.equal(DEFAULT_DISPATCH_CONFIG.settleMin, DEFAULT_SETTLE_MIN);
});

test("만료(ATC-152): 24시간 넘게 proposed·agreed·disagreed면 '24시간 판정 없음'으로 EXPIRED, HOLD·승인된 제안은 아니다", () => {
  const verdict = (id: string, v: "agree" | "disagree", minAgo: number): Op => ({ op: "verdict", id, at: iso(minAgo), verdict: v, reason: "shadow" });
  const existing = fold([
    create("D-0001", "VOC-1", "b", 30 * 60), verdict("D-0001", "disagree", 25 * 60), // 표시한 지 25시간 → expire
    create("D-0002", "VOC-2", "b", 30 * 60), verdict("D-0002", "disagree", 23 * 60), // 23시간 → 그대로
    create("D-0003", "VOC-3", "b", 30 * 60), verdict("D-0003", "agree", 25 * 60), // 나라면 승인도
    create("D-0004", "VOC-4", null, 30 * 60, "RELEASE"), verdict("D-0004", "disagree", 26 * 60), // RELEASE도
    create("D-0005", "VOC-5", "b", 25 * 60), // proposed 25시간
    create("D-0006", "VOC-6", "b", 30 * 60), { op: "hold", id: "D-0006", at: iso(29 * 60), blockedBy: ["VOC-1"] }, // HOLD는 만료 없음
    create("D-0007", "VOC-7", "b", 30 * 60), { op: "approve", id: "D-0007", at: iso(5 * 60) }, // 승인된 제안(전달 전 5시간)
    create("D-0008", "VOC-8", "b", 30 * 60), verdict("D-0008", "disagree", 24 * 60 + 1), // 경계: 24시간 1분
    create("D-0009", "VOC-9", "b", 30 * 60), verdict("D-0009", "disagree", 24 * 60), // 경계: 정확히 24시간은 아직
    create("D-0010", "VOC-10", "b", 30 * 60), { op: "hold", id: "D-0010", at: iso(29 * 60), blockedBy: [] }, verdict("D-0010", "disagree", 26 * 60), // HOLD가 걸린 채 표시된 것도 만료 없음
  ]);
  assert.equal(existing.find((p) => p.id === "D-0001")!.status, "disagreed");
  const tickets = ["VOC-1", "VOC-2", "VOC-3", "VOC-4", "VOC-5", "VOC-6", "VOC-7", "VOC-8", "VOC-9", "VOC-10"].map((k) => t(k));
  const plan = planOf({ assign: tickets.filter((x) => x.key !== "VOC-4").map((x) => assign(x.key, "b")), release: [{ kind: "RELEASE", flight: "VOC-4", airport: "VCDO", score: 1, factors: [] } as never] });
  const ops = syncOps(existing, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 10).filter((o) => o.op === "expire");
  assert.deepEqual(ops.map((o) => `${o.id}:${"reason" in o ? o.reason : ""}`), ["D-0001", "D-0003", "D-0004", "D-0005", "D-0008"].map((id) => `${id}:${NO_VERDICT_WHY}`));
  // 접으면 EXPIRED와 사유가 남고, 닫힌 것은 다시 만료되지 않는다
  const closed = fold([create("D-0001", "VOC-1", "b", 30 * 60), verdict("D-0001", "disagree", 25 * 60), { op: "expire", id: "D-0001", at: iso(0), reason: NO_VERDICT_WHY }]);
  assert.equal(closed[0].status, "expired");
  assert.equal(closed[0].reason, NO_VERDICT_WHY);
  assert.equal(closed[0].timeline.disagreed, iso(25 * 60));
  assert.deepEqual(syncOps(closed, planOf(), { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1).filter((o) => o.op === "expire"), []);
  // 승인된 제안과 HOLD는 canApply 밖: 승인된 제안의 전달 만료는 따로 있는 규칙이다
  assert.equal(canApply(existing.find((p) => p.id === "D-0007")!, "expire"), true);
  assert.equal(existing.find((p) => p.id === "D-0006")!.holdAt !== null, true);
});
