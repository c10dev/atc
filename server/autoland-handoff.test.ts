import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type AutolandView, type MergeExclusionInput, mergeExclusionOf } from "./autoland.ts";
import { countHandoff, handoffNeedOf, handoffOf, type HandoffRecord, handoffView, landSentTo, MIGRATION_FIRST, needsMigrationFirst, observeHandoffs, parseHandoffRecords } from "./autoland-handoff.ts";
import { buildBrief } from "./controller.ts";
import { handoffInfoText } from "./fix.ts";
import { landByOf, landDecisionOf, type MccLandInfo } from "./land-by.ts";
import { pullKey } from "./landing.ts";
import type { Clearance, PullRequest, Snapshot } from "./model.ts";
import { destOf } from "./supervisor-alerts.ts";
import { type QueueInput, supervisorQueueOf } from "./supervisor-queue.ts";

// AUTOLAND가 SUPERVISOR에게 넘긴 PR(ATC-513): 착륙 판정, LANDING 줄, TOWER brief, 오작동 세기. 모두 순수 함수.
const ATC = "/home/c10/projects/atc";
const VCDO = "/home/c10/projects/vocado_nextjs";
const WT = "/home/c10/projects/worktrees";
const T0 = Date.parse("2026-10-03T07:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const pr = (number: number, over: Partial<PullRequest> = {}): PullRequest => ({
  repo: VCDO, number, title: `PR ${number}`, url: `https://github.com/o/vocado/pull/${number}`, branch: `claude/voc-${number}`, head: `head${number}abcdef`, base: "main",
  ticketKey: `VOC-${number}`, standPath: `${WT}/vocado-voc-${number}`, draft: false, landing: "CLEARED", blocks: [], readyAt: iso(-10), createdAt: iso(-100 + number), ...over,
});
// AUTOLAND merge 모드가 계산한 판정(스냅샷의 autoland). exclusions의 값이 문자열이면 SUPERVISOR 몫, null이면 위임
const view = (pulls: PullRequest[], reasons: Record<number, string | null>, over: Partial<AutolandView> = {}): AutolandView => ({
  mode: "merge", airports: [], pulls: {}, holds: [],
  exclusions: Object.fromEntries(pulls.filter((p) => p.number in reasons).map((p) => [pullKey(p), reasons[p.number]!])),
  exclusionHeads: Object.fromEntries(pulls.filter((p) => p.number in reasons).map((p) => [pullKey(p), p.head])),
  ...over,
});

test("landDecisionOf: 판정이 없으면 오늘과 같다(holder, teamsMerge false는 teams-merge-off)", () => {
  const p = pr(1);
  assert.deepEqual(landDecisionOf(p, null), { by: "holder", why: null });
  assert.deepEqual(landDecisionOf(p, null, true, null), { by: "holder", why: null });
  assert.deepEqual(landDecisionOf(p, null, false), { by: "supervisor", why: "teams-merge-off" });
});

test("landDecisionOf: AUTOLAND가 넘긴 PR은 supervisor/autoland와 AUTOLAND의 사유, 팀이 머지하지 않는 AIRPORT는 teams-merge-off가 먼저", () => {
  const p = pr(1);
  assert.deepEqual(landDecisionOf(p, null, true, { reason: "Risk:Migration" }), { by: "supervisor", why: "autoland", detail: "Risk:Migration" });
  assert.equal(landByOf(p, null, true, { reason: "x" }), "supervisor");
  assert.deepEqual(landDecisionOf(p, null, false, { reason: "x" }), { by: "supervisor", why: "teams-merge-off" });
});

test("landDecisionOf: MCC AIRPORT의 기존 순서가 그대로다(mcc·hold·escalate·mode·tier가 이기고, 넘김 판정은 쓰지 않는다)", () => {
  const h = { reason: "x" };
  const p = pr(1, { repo: ATC });
  const base: MccLandInfo = { repo: ATC, mode: "land+rts", holds: [], escalated: [], tiers: new Map([[1, { head: p.head, tier: "auto" }]]) };
  assert.deepEqual(landDecisionOf(p, base, true, h), { by: "mcc", why: null });
  assert.deepEqual(landDecisionOf(p, { ...base, holds: [1] }, true, h), { by: "supervisor", why: "hold" });
  assert.deepEqual(landDecisionOf(p, { ...base, escalated: [1] }, true, h), { by: "supervisor", why: "escalate" });
  assert.deepEqual(landDecisionOf(p, { ...base, mode: "shadow" }, true, h), { by: "supervisor", why: "mode" });
  // 다른 저장소의 PR은 MCC 정보가 있어도 넘김이 적용된다
  assert.deepEqual(landDecisionOf(pr(2), base, true, h), { by: "supervisor", why: "autoland", detail: "x" });
});

test("handoffOf: merge 모드, CLEARED, 이 head의 판정, 스위치 on일 때만. 그 밖은 null(오늘과 같다)", () => {
  const p = pr(1);
  const v = view([p], { 1: "Risk:Migration" });
  assert.deepEqual(handoffOf(v, true, p), { reason: "Risk:Migration" });
  assert.equal(handoffOf(v, false, p), null); // 스위치 off
  assert.equal(handoffOf(undefined, true, p), null); // AUTOLAND 자료 없음
  assert.equal(handoffOf({ ...v, mode: "update" }, true, p), null);
  assert.equal(handoffOf({ ...v, mode: "off" }, true, p), null);
  assert.equal(handoffOf(v, true, { ...p, landing: "APPROACH" }), null); // 아직 리뷰·CI 전
  assert.equal(handoffOf(v, true, { ...p, draft: true }), null);
  assert.equal(handoffOf(v, true, { ...p, head: "newhead9999999" }), null); // 옛 head의 판정
  assert.equal(handoffOf({ ...v, exclusionHeads: undefined }, true, p), null); // 어느 head의 판정인지 모름
  assert.equal(handoffOf(view([p], { 1: null }), true, p), null); // 위임된 PR은 AUTOLAND가 머지한다
  assert.equal(handoffOf({ ...v, exclusions: {} }, true, p), null); // 아직 계산하지 않음
});

test("마이그레이션이 이유면 호스티드에 먼저 적용한 뒤 머지라고 덧붙인다", () => {
  for (const r of ["Risk:Migration", "risk: migration", "보안 게이트: 마이그레이션·SQL 경로 supabase/migrations/0001.sql(위임 안 함)", "보안 게이트: migration path db/x.sql"]) assert.equal(needsMigrationFirst(r), true, r);
  for (const r of ["rating:SEC", "UI change 블록 없음 — 본문에 ## UI change를 적는다", "FLIGHT 없음", "SUPERVISOR HOLD"]) assert.equal(needsMigrationFirst(r), false, r);
  assert.equal(handoffNeedOf("Risk:Migration"), `AUTOLAND가 넘김 — Risk:Migration · ${MIGRATION_FIRST}`);
  assert.equal(handoffNeedOf("rating:SEC"), "AUTOLAND가 넘김 — rating:SEC");
});

// 2026-10-03의 다섯 모양: 진짜 mergeExclusionOf가 사유를 만든다
const FILES_MIG = ["supabase/migrations/20261003_add.sql", "src/a.ts"];
const input = (over: Partial<MergeExclusionInput> = {}): MergeExclusionInput => ({
  held: false, flight: "VOC-1", ticketLabels: [], prLabels: [], files: ["src/a.ts"], title: "t", body: "## UI change\nclass: NONE\n", flightTitle: "t", head: "h", carryFrom: [], reviewedSecurity: "off", mergeReviewPass: false, ...over,
}) as MergeExclusionInput;
const SHAPES: Record<string, MergeExclusionInput> = {
  "Risk:Migration 라벨": input({ ticketLabels: ["Risk:Migration"] }),
  "마이그레이션 경로, 위임 안 함(스위치 off)": input({ files: FILES_MIG }),
  "마이그레이션 경로, 위임했어도 막힘": input({ files: FILES_MIG, reviewedSecurity: "delegate", mergeReviewPass: true, migrationGate: { involved: true, ok: false, reason: "적용 안 됨", missing: ["20261003_add"], paths: ["supabase/migrations/20261003_add.sql"] } as MergeExclusionInput["migrationGate"] }),
  "UI change 블록 없음": input({ body: "그냥 설명" }),
  "rating:SEC 라벨": input({ ticketLabels: ["rating:SEC"] }),
};

test("다섯 모양: 각각 AUTOLAND 사유가 있고 supervisor/autoland가 되고 HOME에 LANDING 줄이 PR마다 정확히 하나, 알림은 queue로 간다", () => {
  const names = Object.keys(SHAPES);
  const pulls = names.map((_, i) => pr(i + 1));
  const reasons = Object.fromEntries(names.map((n, i) => [i + 1, mergeExclusionOf(SHAPES[n]!)]));
  for (const [i, n] of names.entries()) assert.ok(reasons[i + 1], `${n}: AUTOLAND가 사유를 줘야 한다`);
  const v = view(pulls, reasons as Record<number, string>);
  const qp = pulls.map((p) => {
    const d = landDecisionOf(p, null, true, handoffOf(v, true, p));
    assert.equal(d.by, "supervisor");
    assert.equal(d.why, "autoland");
    assert.equal(d.detail, reasons[p.number]);
    return { ...p, landBy: d.by, landWhy: d.why, landDetail: d.detail } as QueueInput["pulls"][number];
  });
  const rows = supervisorQueueOf({ proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: qp, update: null, sessions: [], blockedMin: 3 } as unknown as QueueInput, T0).filter((i) => i.kind === "LANDING");
  assert.equal(rows.length, pulls.length);
  for (const [i, p] of pulls.entries()) {
    const mine = rows.filter((r) => r.key.startsWith(`vocado_nextjs#${p.number}@`));
    assert.equal(mine.length, 1, `PR ${p.number}: LANDING 줄이 정확히 하나`);
    assert.ok(mine[0]!.need!.includes(reasons[i + 1]!), `PR ${p.number}: AUTOLAND 사유가 줄에 있다`);
    assert.equal(mine[0]!.need!.includes(MIGRATION_FIRST), i < 3, `PR ${p.number}: 마이그레이션이 이유일 때만 순서 안내`);
    // /api/status의 기다림은 알림의 dest가 queue인 것: land 알림이 queue로 간다
    assert.equal(destOf({ key: `land|${pullKey(p)}|${p.head}` }, new Map([[pullKey(p), "supervisor" as const]])), "queue");
  }
});

test("판정이 없는 CLEARED PR의 LANDING 줄은 오늘과 같다(need 없음), holder PR은 줄이 없다", () => {
  const p = pr(1);
  const mk = (landBy: "holder" | "supervisor", extra = {}) => ({ ...p, landBy, landWhy: landBy === "supervisor" ? ("user" as const) : null, ...extra }) as QueueInput["pulls"][number];
  const base = { proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], update: null, sessions: [], blockedMin: 3 };
  const user = supervisorQueueOf({ ...base, pulls: [mk("supervisor")] } as unknown as QueueInput, T0).filter((i) => i.kind === "LANDING");
  assert.equal(user.length, 1);
  assert.equal(user[0]!.need, undefined);
  assert.equal(supervisorQueueOf({ ...base, pulls: [mk("holder")] } as unknown as QueueInput, T0).filter((i) => i.kind === "LANDING").length, 0);
});

// TOWER brief
const snapshot = (pulls: PullRequest[]): Snapshot =>
  ({
    at: iso(0), linear: { enabled: true, error: null, fetchedAt: iso(0) }, github: { enabled: true, error: null, fetchedAt: iso(0) }, atfm: { mains: [], groundStops: [] }, pulls,
    sessions: [{ id: "s-b", agent: "claude", name: "TEAM_B", status: "idle", pid: 1, cwd: VCDO, startedAt: iso(-600), lastActiveAt: iso(0), repo: null, workspacePath: null }],
    workspaces: [{ path: `${WT}/vocado-voc-1`, name: "vocado-voc-1", repo: VCDO, isMain: false, branch: null, head: "", dirty: 0, lastCommitAt: null, ticketKey: "VOC-1" }],
    tickets: [], columns: [], airports: [], claims: [{ sessionId: "s-b", workspacePath: `${WT}/vocado-voc-1`, since: iso(-50), lastAt: iso(-1), source: "hook", tool: null, state: "active", handedOffTo: null }], handoffs: [], alerts: [], clearances: [],
  }) as unknown as Snapshot;
const brief = (pulls: PullRequest[], clearances: Clearance[], handoff?: (p: PullRequest) => { reason: string } | null) =>
  buildBrief(snapshot(pulls), { events: [], reset: false, cursor: "e:0" }, clearances, T0, undefined, null, null, [], handoff);
const q1 = (b: ReturnType<typeof brief>) => b.landingQueue[0]!;
const infoClearance = (id: string, text: string, over: Partial<Clearance> = {}): Clearance =>
  ({ id, to: "s-b", toName: "TEAM_B", type: "INFO", stand: `${WT}/vocado-voc-1`, flight: "VOC-1", text, at: iso(-5), readbackAt: null, cancelledAt: null, ...over }) as Clearance;

test("TOWER brief: 넘김 판정이 없으면 landBy holder에 landText가 있다(오늘과 같다)", () => {
  const item = q1(brief([pr(1)], []));
  assert.equal(item.landBy, "holder");
  assert.equal(item.landWhy, null);
  assert.ok(item.landText);
  assert.equal(item.info, null);
});

test("TOWER brief: 넘긴 PR은 landBy supervisor/autoland, landText null(LAND 없음), 팀에는 INFO 한 번만(send)", () => {
  const p = pr(1);
  const item = q1(brief([p], [], () => ({ reason: "Risk:Migration" })));
  assert.equal(item.landBy, "supervisor");
  assert.equal(item.landWhy, "autoland");
  assert.equal(item.landText, null);
  assert.ok(item.info);
  assert.equal(item.info!.action, "send");
  assert.ok(item.info!.text.startsWith(handoffInfoText(1)));
  assert.match(item.info!.text, /\[blocks: autoland-head1ab\]$/);
  assert.doesNotMatch(item.info!.text, /Risk:Migration|[가-힣]/); // 팀에 가는 글은 영어, AUTOLAND의 한국어 사유는 싣지 않는다
});

test("TOWER brief: 같은 head에는 INFO를 다시 보내지 않고(sent), 새 head에는 다시 한 번", () => {
  const p = pr(1);
  const sent = infoClearance("C-0001", `${handoffInfoText(1)} [blocks: autoland-head1ab]`);
  const again = q1(brief([p], [sent], () => ({ reason: "x" })));
  assert.deepEqual([again.info!.action, again.info!.clearance], ["sent", "C-0001"]);
  // 다른 INFO가 뒤에 나가도 같은 head는 다시 가지 않는다
  const later = infoClearance("C-0002", "PR #1 cannot land yet: x [blocks: no-review]", { at: iso(-2) });
  assert.equal(q1(brief([p], [sent, later], () => ({ reason: "x" }))).info!.action, "sent");
  // head가 바뀌면 새 표지라 다시 한 번
  assert.equal(q1(brief([pr(1, { head: "head9newabcdef" })], [sent], () => ({ reason: "x" }))).info!.action, "send");
});

test("TOWER brief: 이미 나가 있던 LAND는 다시 보내지 않고(landClearance), 답이 없어도 팀 탓(overdue)으로 세지 않는다", () => {
  const p = pr(1);
  const land = { id: "C-0007", to: "s-b", toName: "TEAM_B", type: "LAND", stand: `${WT}/vocado-voc-1`, flight: "VOC-1", text: "LAND", at: iso(-60), readbackAt: null, cancelledAt: null, standbyAt: null } as unknown as Clearance;
  const withoutHandoff = brief([p], [land]);
  assert.deepEqual(withoutHandoff.clearances.overdue, ["C-0007"]); // 오늘: 답 없는 LAND는 overdue
  assert.equal(q1(withoutHandoff).landClearance?.id, "C-0007");
  const handed = brief([p], [land], () => ({ reason: "x" }));
  assert.deepEqual(handed.clearances.overdue, []); // 넘긴 PR의 LAND는 팀 탓이 아니다
  assert.deepEqual(handed.clearances.pending.map((c) => c.id), ["C-0007"]); // 닫지는 않는다
  assert.equal(q1(handed).landClearance?.id, "C-0007"); // TOWER는 이미 나간 LAND라 다시 보내지 않는다
  assert.equal(q1(handed).landText, null);
});

// 오작동 세기
const R = (op: HandoffRecord["op"], pr: string, over: Partial<HandoffRecord> = {}): HandoffRecord => ({ t: iso(0), op, pr, number: Number(pr.split("#")[1]), ...over });

test("세기: 넘긴 (PR, head) 수, 머지 없이 닫힌 PR 수(새 head 뒤 닫혀도 PR 하나), 팀으로 나간 LAND 수", () => {
  const recs: HandoffRecord[] = [
    R("mark", "v#1", { head: "a" }), R("mark", "v#1", { head: "b" }), // 새 head로 다시 넘김
    R("mark", "v#2", { head: "c" }),
    R("done", "v#1", { result: "closed" }), // 닫힘(새 head 뒤)
    R("done", "v#2", { result: "merged" }), // 머지는 세지 않는다
    R("land-sent", "v#2", { head: "c", clearance: "C-1" }),
  ];
  assert.deepEqual(countHandoff(recs), { marked: 3, closedWithoutMerge: 1, landSent: 1 });
  assert.deepEqual(countHandoff([]), { marked: 0, closedWithoutMerge: 0, landSent: 0 });
  assert.equal(countHandoff([R("done", "v#1", { result: "closed", t: iso(-100_000) })], T0 - 1000).closedWithoutMerge, 0); // 기간 밖
  const v = handoffView(recs, T0);
  assert.equal(v.total.marked, 3);
  assert.equal(v.recent.length, 5);
  assert.equal(parseHandoffRecords(`${JSON.stringify(recs[0])}\n{"t":"x\n${JSON.stringify({ nope: 1 })}\n${JSON.stringify(recs[5])}\n`).length, 2);
});

test("관찰: 새 head마다 mark 한 번, 사라진 넘김 PR만 done 후보(새 head로 열려 있으면 아니다), 스위치 off면 mark 없음", () => {
  const p1 = pr(1);
  const s = { pulls: [p1], airports: [{ code: "VCDO", repo: VCDO }], autoland: view([p1], { 1: "rating:SEC" }) };
  const a = observeHandoffs(s, true, [], iso(0));
  assert.equal(a.marks.length, 1);
  assert.deepEqual([a.marks[0]!.pr, a.marks[0]!.head, a.marks[0]!.airport, a.marks[0]!.slug], [pullKey(p1), p1.head, "VCDO", "o/vocado"]);
  assert.deepEqual(a.gone, []);
  // 이미 적은 head는 다시 적지 않는다
  assert.equal(observeHandoffs(s, true, a.marks, iso(1)).marks.length, 0);
  // PR이 열린 목록에서 사라졌다: 아직 done이 없으니 후보
  const gone = observeHandoffs({ ...s, pulls: [] }, true, a.marks, iso(2));
  assert.deepEqual(gone.gone, [{ pr: pullKey(p1), number: 1, slug: "o/vocado" }]);
  // done을 이미 적었으면 다시 읽지 않는다
  assert.equal(observeHandoffs({ ...s, pulls: [] }, true, [...a.marks, R("done", pullKey(p1), { result: "closed" })], iso(3)).gone.length, 0);
  // 새 head로 열려 있으면 사라진 것이 아니다
  assert.equal(observeHandoffs({ ...s, pulls: [pr(1, { head: "newhead0000000" })], autoland: view([], {}) }, true, a.marks, iso(4)).gone.length, 0);
  assert.equal(observeHandoffs(s, false, [], iso(0)).marks.length, 0);
});

test("(b) LAND가 넘긴 head의 PR로 나가면 알아본다: 같은 STAND(없으면 같은 FLIGHT), 스위치 off·위임된 PR은 아니다", () => {
  const p = pr(1);
  const s = { pulls: [p], autoland: view([p], { 1: "rating:SEC" }) };
  assert.deepEqual(landSentTo({ stand: p.standPath }, s, true), { pr: pullKey(p), number: 1, head: p.head });
  assert.deepEqual(landSentTo({ stand: null, flight: "VOC-1" }, s, true), { pr: pullKey(p), number: 1, head: p.head });
  assert.equal(landSentTo({ stand: `${WT}/other` }, s, true), null);
  assert.equal(landSentTo({ stand: p.standPath }, s, false), null);
  assert.equal(landSentTo({ stand: p.standPath }, { pulls: [p], autoland: view([p], { 1: null }) }, true), null);
});
