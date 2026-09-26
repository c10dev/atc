import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "./model.ts";
import { candidatesOf, changesOf, draftOps, fold, gateOf, missingSections, type NewPayload, parseNew, parsePayload, ScheduleError, similarTickets, syncLines, titleTokens } from "./schedule.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (key: string, over: Partial<Ticket> = {}) =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", labels: [], priority: 3, project: "Beta Readiness", url: null, ...over }) as Ticket;

test("CLASSIFY·PRIORITIZE 입력 검사", () => {
  assert.deepEqual(parsePayload("CLASSIFY", { type: "maint", wake: "h", ratings: ["sec", "SEC"] }), { kind: "CLASSIFY", payload: { type: "MAINT", wake: "H", ratings: ["SEC"] } });
  assert.deepEqual(parsePayload("PRIORITIZE", { priority: "2" }), { kind: "PRIORITIZE", payload: { priority: 2 } });
  assert.throws(() => parsePayload("CLOSE", {}), /모르는 SCHEDULE 작업/);
  assert.throws(() => parsePayload("CLASSIFY", {}), /하나 이상/);
  assert.throws(() => parsePayload("CLASSIFY", { type: "PILOT" }), /FLIGHT TYPE/);
  assert.throws(() => parsePayload("PRIORITIZE", { priority: 0 }), /priority/);
});

test("changesOf: 지금 라벨·우선순위와 다른 것만", () => {
  assert.deepEqual(changesOf("CLASSIFY", { type: "BUILD", wake: "M" }, t("VOC-1")), ["type:BUILD", "wake:M"]);
  assert.deepEqual(changesOf("CLASSIFY", { type: "BUILD", ratings: ["SEC"] }, t("VOC-1", { labels: ["type:BUILD", "Risk:Security"] })), []);
  assert.deepEqual(changesOf("PRIORITIZE", { priority: 2 }, t("VOC-1", { priority: 0 })), ["priority 없음 → High"]);
  assert.deepEqual(changesOf("PRIORITIZE", { priority: 2 }, t("VOC-1", { priority: 2 })), []);
});

test("초안: 번호를 매기고, 같은 FLIGHT·종류의 열린 초안은 대신하며, 계획 단계가 아니거나 바꿀 게 없으면 거절", () => {
  const tickets = [t("VOC-10"), t("VOC-11", { state: "In Progress", stateType: "started" }), t("VOC-12", { labels: ["type:MAINT", "wake:M"] })];
  const first = draftOps([], { kind: "CLASSIFY", flight: "voc-10", type: "MAINT", wake: "M", reason: "리팩터링만" }, tickets, iso(10), 0);
  assert.deepEqual(first.map((l) => `${l.op}:${l.id}`), ["draft:S-0001"]);
  const ops = fold(first);
  const second = draftOps(ops, { kind: "CLASSIFY", flight: "VOC-10", type: "MAINT", wake: "H", reason: "마이그레이션 포함" }, tickets, iso(5), ops.length);
  assert.deepEqual(second.map((l) => `${l.op}:${l.id}`), ["supersede:S-0001", "draft:S-0002"]);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-11", type: "BUILD", reason: "x" }, tickets, iso(0), 0), /Todo·Backlog가 아님/);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-12", type: "MAINT", wake: "M", reason: "x" }, tickets, iso(0), 0), /이미 그렇게/);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-99", type: "BUILD", reason: "x" }, tickets, iso(0), 0), /목록에 없음/);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-10", type: "BUILD", reason: " " }, tickets, iso(0), 0), /근거/);
});

test("초안 한도: 열린 초안이 5건이면 더 받지 않는다", () => {
  const tickets = Array.from({ length: 6 }, (_, i) => t(`VOC-${20 + i}`));
  let lines = [] as ReturnType<typeof draftOps>;
  for (let i = 0; i < 5; i++) lines = [...lines, ...draftOps(fold(lines), { kind: "CLASSIFY", flight: `VOC-${20 + i}`, type: "BUILD", reason: "r" }, tickets, iso(0), i)];
  assert.throws(
    () => draftOps(fold(lines), { kind: "CLASSIFY", flight: "VOC-25", type: "BUILD", reason: "r" }, tickets, iso(0), 5),
    (e) => e instanceof ScheduleError && e.status === 409,
  );
});

test("동기화: FLIGHT가 계획 단계를 벗어나거나 이미 반영됐으면 SUPERSEDED, 3일 지나면 EXPIRED", () => {
  const lines = [
    { op: "draft" as const, id: "S-0001", at: iso(10), kind: "CLASSIFY" as const, flight: "VOC-30", payload: { type: "MAINT" as const }, reason: "r" },
    { op: "draft" as const, id: "S-0002", at: iso(10), kind: "CLASSIFY" as const, flight: "VOC-31", payload: { type: "MAINT" as const }, reason: "r" },
    { op: "draft" as const, id: "S-0003", at: iso(4 * 24 * 60), kind: "PRIORITIZE" as const, flight: "VOC-32", payload: { priority: 2 as const }, reason: "r" },
    { op: "draft" as const, id: "S-0004", at: iso(10), kind: "PRIORITIZE" as const, flight: "VOC-33", payload: { priority: 2 as const }, reason: "r" },
  ];
  const tickets = [t("VOC-30", { state: "Done", stateType: "completed" }), t("VOC-31", { labels: ["type:MAINT"] }), t("VOC-32", { priority: 0 }), t("VOC-33", { priority: 0 })];
  const out = syncLines(fold(lines), tickets, NOW);
  assert.deepEqual(out.map((l) => `${l.op}:${l.id}:${"reason" in l ? l.reason : ""}`), [
    "supersede:S-0001:FLIGHT 상태가 바뀜(Done)",
    "supersede:S-0002:Linear에 이미 반영됨",
    "expire:S-0003:",
  ]);
});

test("판정과 2단계 점검, 후보 목록", () => {
  const lines = [
    { op: "draft" as const, id: "S-0001", at: iso(10), kind: "CLASSIFY" as const, flight: "VOC-40", payload: { type: "MAINT" as const }, reason: "r" },
    { op: "verdict" as const, id: "S-0001", at: iso(5), verdict: "disagree" as const, reason: "BUILD임" },
    { op: "verdict" as const, id: "S-0001", at: iso(4), verdict: "agree" as const, reason: null }, // 닫힌 뒤라 무시
  ];
  const ops = fold(lines);
  assert.equal(ops[0].status, "disagreed");
  assert.equal(ops[0].verdictReason, "BUILD임");
  assert.deepEqual(gateOf(ops), { decided: 1, agreed: 0, agreement: 0, target: { decided: 20, agreement: 0.8 }, ready: false, crosscheck: { marked: 0, matched: 0, rate: null } });
  const tickets = [t("VOC-41"), t("VOC-42", { labels: ["type:BUILD", "wake:M"], priority: 0 }), t("VOC-43", { state: "In Progress", stateType: "started" })];
  assert.deepEqual(candidatesOf(tickets, []), { classify: ["VOC-41"], prioritize: ["VOC-42"] });
});

// ── NEW(새 이슈 초안) ──

const BODY = ["## 목표", "재생 화면 버튼 정리", "## 수정 허용 범위", "- src/app/song/**", "## 금지 사항", "- DB 변경", "## 완료 기준", "- 테스트 통과"].join("\n");
// Linear의 Codex Engineering Task 템플릿 제목 그대로
const CODEX = [
  "## Outcome", "anon 쓰기 거부", "## Context", "VOC-191", "## Scope", "### In scope", "- RLS", "### Allowed files / surfaces", "- supabase/migrations/**",
  "### Out of scope", "- UI", "## Forbidden changes", "- 다른 테이블", "## Invariants", "- service role 경로 유지", "## Acceptance Criteria", "- anon 쓰기 거부",
  "## Verification", "- pgTAP", "## Risks / Rollback", "- 마이그레이션 되돌리기", "## Review Readiness", "- Codex 리뷰",
].join("\n");
const TAILS = ["TEAM_A", "TEAM_E"];
const board = [
  t("VOC-60", { title: "Practice 시트 머리 줄 동작 맞추기", project: "Web UX" }),
  t("VOC-61", { project: "Beta Readiness" }),
  t("VOC-62", { title: "Song workspace focus colour sweep", state: "Done", stateType: "completed", updatedAt: iso(60 * 24 * 60), createdAt: iso(90 * 24 * 60) }),
  t("VOC-63", { title: "Song workspace focus colour cleanup", state: "Done", stateType: "completed", updatedAt: iso(24 * 60), createdAt: iso(90 * 24 * 60) }),
];
const newInput = (over: Record<string, unknown> = {}) => ({ kind: "NEW", title: "재생 화면 버튼 정리", body: BODY, project: "web ux", reason: "사용자 요청. 중복 검색: VOC-60 비슷하지 않음", ...over });

test("NEW 본문 칸: 제목 줄·굵은 줄, 한국어·영어, 번호와 콜론은 무시", () => {
  assert.deepEqual(missingSections(BODY), []);
  assert.deepEqual(missingSections(CODEX), []);
  assert.deepEqual(missingSections(CODEX, true), []);
  assert.deepEqual(missingSections(CODEX.replace("## Invariants", "## Notes").replace("## Verification", "## Checks"), true), ["Invariants", "Verification"]);
  assert.deepEqual(missingSections("**Goal:** x\n### 1. Allowed files\n### 2. Forbidden changes:\n### 3. Acceptance Criteria"), []);
  assert.deepEqual(missingSections("**목표**\nx\n**Allowed changes**\n# Forbidden\n## Done criteria"), []);
  assert.deepEqual(missingSections("## 목표\n본문에 금지 사항이라고만 씀\n완료 기준: 없음"), ["수정 허용 범위", "금지 사항", "완료 기준"]);
  assert.deepEqual(missingSections(BODY, true), ["Allowed files", "Forbidden changes", "Invariants", "Acceptance Criteria", "Verification"]);
});

test("NEW 입력 검사", () => {
  const ok = parseNew(newInput({ priority: "2", type: "build", ratings: ["ui"], tail: "tail:team_e", parent: "voc-61", related: "VOC-60", blockedBy: ["VOC-60", "voc-60"] }), board, TAILS);
  assert.deepEqual(ok, {
    title: "재생 화면 버튼 정리", body: BODY, project: "Web UX", type: "BUILD", ratings: ["UI"], priority: 2, tail: "TEAM_E", parent: "VOC-61", related: ["VOC-60"], blockedBy: ["VOC-60"],
  });
  assert.throws(() => parseNew(newInput({ title: "  " }), board, TAILS), /1~120자/);
  assert.throws(() => parseNew(newInput({ title: "x".repeat(121) }), board, TAILS), /1~120자/);
  assert.throws(() => parseNew(newInput({ body: "## 목표\nx" }), board, TAILS), /빠진 칸: 수정 허용 범위, 금지 사항, 완료 기준/);
  assert.throws(() => parseNew(newInput({ ratings: ["SEC"] }), board, TAILS), /Codex Engineering Task.*Allowed files/);
  assert.equal(parseNew(newInput({ body: CODEX, ratings: ["SEC"] }), board, TAILS).ratings?.[0], "SEC");
  assert.throws(() => parseNew(newInput({ project: "Mobile" }), board, TAILS), /모르는 프로젝트: Mobile/);
  assert.throws(() => parseNew(newInput({ tail: "TEAM_Z" }), board, TAILS), /FLEET에 없거나 퇴역/);
  assert.throws(() => parseNew(newInput({ parent: "VOC-99" }), board, TAILS), /parent가 FLIGHT 목록에 없음/);
  assert.throws(() => parseNew(newInput({ related: ["VOC-60", "VOC-98"] }), board, TAILS), /related가 FLIGHT 목록에 없음: VOC-98/);
  assert.throws(() => parseNew(newInput({ blockedBy: "VOC-97" }), board, TAILS), /blockedBy가/);
  assert.throws(() => parseNew(newInput({ type: "PILOT" }), board, TAILS), /FLIGHT TYPE/);
  assert.throws(() => parseNew(newInput({ priority: 5 }), board, TAILS), /priority/);
});

test("비슷한 제목: 같은 제목이거나 토큰 2개 이상·겹침 0.5 이상, 닫힌 것은 45일 안에 바뀐 것만", () => {
  assert.deepEqual([...titleTokens("랜딩 사이트 데이터를 beta DB에서 분리")], ["랜딩", "사이트", "데이터", "beta", "db", "분리"]);
  assert.deepEqual(similarTickets("Practice 시트의 머리 줄 동작을 맞추기", board, NOW), [{ key: "VOC-60", title: "Practice 시트 머리 줄 동작 맞추기" }]);
  assert.deepEqual(similarTickets("song workspace: focus colour", board, NOW), [{ key: "VOC-63", title: "Song workspace focus colour cleanup" }]);
  assert.deepEqual(similarTickets("VOC 61", board, NOW), [{ key: "VOC-61", title: "VOC-61" }]);
  assert.deepEqual(similarTickets("전혀 다른 일", board, NOW), []);
});

test("NEW 초안: flight는 null, similar를 채우고, 근거에 중복 검색 필요, 다른 NEW를 대신하지 않고 한도에 든다", () => {
  const a = draftOps([], newInput({ title: "Practice 시트 머리 줄 동작 맞추기 (2)" }), board, iso(10), 0, { tails: TAILS });
  assert.equal(a.length, 1);
  const line = a[0] as Extract<(typeof a)[number], { op: "draft" }>;
  assert.equal(line.flight, null);
  assert.deepEqual((line.payload as NewPayload).similar, [{ key: "VOC-60", title: "Practice 시트 머리 줄 동작 맞추기" }]);
  assert.throws(() => draftOps([], newInput({ reason: "사용자 요청" }), board, iso(0), 0), /중복 검색:/);
  assert.throws(() => draftOps([], newInput({ reason: " " }), board, iso(0), 0), /근거/);
  let lines = a;
  for (let i = 1; i < 5; i++) lines = [...lines, ...draftOps(fold(lines), newInput(), board, iso(0), i)];
  assert.equal(fold(lines).filter((o) => o.status === "draft").length, 5); // 같은 제목이어도 서로 대신하지 않음
  assert.throws(() => draftOps(fold(lines), newInput(), board, iso(0), 5), (e) => e instanceof ScheduleError && e.status === 409);
  assert.throws(() => draftOps(fold(lines), { kind: "CLASSIFY", flight: "VOC-61", type: "BUILD", reason: "r" }, board, iso(0), 5), (e) => e instanceof ScheduleError && e.status === 409);
});

test("NEW changesOf: 설정된 것만", () => {
  const base = { title: "재생 화면 버튼 정리", body: BODY, project: "Web UX", similar: [] };
  assert.deepEqual(changesOf("NEW", base), ["새 이슈: 재생 화면 버튼 정리 · Web UX · 없음"]);
  assert.deepEqual(changesOf("NEW", { ...base, priority: 2, type: "BUILD", wake: "M", ratings: ["SEC", "UI"], tail: "TEAM_E" }), [
    "새 이슈: 재생 화면 버튼 정리 · Web UX · High · type:BUILD wake:M rating:SEC rating:UI tail:TEAM_E",
  ]);
});

test("NEW 동기화: 초안 뒤에 같은 제목 이슈가 생기면 SUPERSEDED, 전부터 있던 것은 아님, 3일 지나면 EXPIRED", () => {
  const payload = (title: string) => ({ title, body: BODY, project: "Web UX", similar: [] });
  const lines = [
    { op: "draft" as const, id: "S-0001", at: iso(60), kind: "NEW" as const, flight: null, payload: payload("재생 화면 버튼 정리"), reason: "중복 검색: 없음" },
    { op: "draft" as const, id: "S-0002", at: iso(60), kind: "NEW" as const, flight: null, payload: payload("Practice 시트 머리 줄 동작 맞추기"), reason: "중복 검색: VOC-60" },
    { op: "draft" as const, id: "S-0003", at: iso(4 * 24 * 60), kind: "NEW" as const, flight: null, payload: payload("오래된 요청"), reason: "중복 검색: 없음" },
  ];
  const tickets = [...board, t("VOC-70", { title: "재생 화면: 버튼 정리", createdAt: iso(5) }), t("VOC-60", { title: "Practice 시트 머리 줄 동작 맞추기", createdAt: iso(24 * 60) })];
  const out = syncLines(fold(lines), tickets, NOW);
  assert.deepEqual(out.map((l) => `${l.op}:${l.id}:${"reason" in l ? l.reason : ""}`), ["supersede:S-0001:Linear에 이미 만들어짐 VOC-70", "expire:S-0003:"]);
});

test("S2 전이: draft → approve → release → apply, 거절은 사유와 함께, 순서를 건너뛴 op는 무시", async () => {
  const { canApplyOp } = await import("./schedule.ts");
  const draft = { op: "draft" as const, id: "S-0010", at: iso(30), kind: "PRIORITIZE" as const, flight: "VOC-50", payload: { priority: 2 as const }, reason: "r" };
  const calls = [{ tool: "save_issue" as const, input: { id: "VOC-50", priority: 2 } }];
  // release·apply는 approve 전이라 무시된다
  let ops = fold([draft, { op: "release", id: "S-0010", at: iso(29), calls }, { op: "apply", id: "S-0010", at: iso(28), ref: "VOC-50" }]);
  assert.equal(ops[0].status, "draft");
  ops = fold([draft, { op: "approve", id: "S-0010", at: iso(20) }, { op: "release", id: "S-0010", at: iso(19), calls }, { op: "apply", id: "S-0010", at: iso(10), ref: "VOC-50" }]);
  assert.deepEqual([ops[0].status, ops[0].calls, ops[0].appliedRef], ["applied", calls, "VOC-50"]);
  ops = fold([draft, { op: "reject", id: "S-0010", at: iso(20), reason: "근거 없음" }]);
  assert.deepEqual([ops[0].status, ops[0].verdictReason], ["rejected", "근거 없음"]);
  assert.equal(canApplyOp({ status: "rejected" }, "approve"), false);
  assert.equal(canApplyOp({ status: "released" }, "release"), true); // 재발부(같은 호출 다시 받기)
});

test("S2 Linear 호출: 계획 필드만, 라벨 그룹 하위 이름으로, 근거 댓글을 붙인다", async () => {
  const { callsOf } = await import("./schedule.ts");
  const base = { at: iso(10), status: "approved" as const, statusAt: iso(5), verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null, reason: "락 조건 수정" };
  const cls = callsOf({ ...base, id: "S-0001", kind: "CLASSIFY", flight: "VOC-195", payload: { type: "MAINT", wake: "M", ratings: ["SEC"] } }, t("VOC-195", { labels: ["type:BUILD", "Risk:Security"] }), "Vocado");
  assert.deepEqual(cls[0], { tool: "save_issue", input: { id: "VOC-195", addLabels: ["MAINT", "M"], removeLabels: ["BUILD"] } });
  assert.equal(cls[1].tool, "save_comment");
  assert.equal(cls[1].input.issueId, "VOC-195");
  assert.match(String(cls[1].input.body), /^\[OCC S-0001\] 분류 type:MAINT wake:M — 근거: 락 조건 수정 \(SCHEDULE S-0001, SUPERVISOR 승인\)$/);
  const pri = callsOf({ ...base, id: "S-0002", kind: "PRIORITIZE", flight: "VOC-177", payload: { priority: 2 } }, t("VOC-177", { priority: 0 }), "Vocado");
  assert.deepEqual(pri[0], { tool: "save_issue", input: { id: "VOC-177", priority: 2 } });
  const payload = { title: "추천 곡 카드", body: "## 목표\nx", project: "Song Experience", priority: 3 as const, type: "BUILD" as const, wake: "M" as const, ratings: ["UI" as const], tail: "TEAM_F", related: ["VOC-179"], similar: [] };
  const nu = callsOf({ ...base, id: "S-0003", kind: "NEW", flight: null, payload }, undefined, "Vocado");
  assert.deepEqual(nu, [{ tool: "save_issue", input: {
    team: "Vocado", title: "추천 곡 카드", description: "## 목표\nx\n\n— OCC S-0003 · CHARTER REQUEST (SCHEDULE S-0003, SUPERVISOR 승인)",
    project: "Song Experience", priority: 3, labels: ["BUILD", "M", "rating:UI", "tail:TEAM_F"], relatedTo: ["VOC-179"],
  } }]);
  for (const c of [...cls, ...pri, ...nu]) assert.ok(!("state" in c.input) && !("assignee" in c.input), "상태·담당은 쓰지 않는다");
});

test("S2 동기화: 발부된 작업이 Linear에 보이면 APPLIED, 승인만 된 것은 SUPERSEDED, 오래되면 EXPIRED", () => {
  const draft = (id: string, flight: string | null, kind: "CLASSIFY" | "NEW", payload: object, minAgo = 30) => ({ op: "draft" as const, id, at: iso(minAgo), kind, flight, payload: payload as never, reason: "r" });
  const lines = [
    draft("S-0001", "VOC-60", "CLASSIFY", { type: "MAINT" }), { op: "approve" as const, id: "S-0001", at: iso(20) }, { op: "release" as const, id: "S-0001", at: iso(19), calls: [] },
    draft("S-0002", "VOC-61", "CLASSIFY", { type: "MAINT" }), { op: "approve" as const, id: "S-0002", at: iso(20) },
    draft("S-0003", null, "NEW", { title: "새 카드", body: "b", project: "P", similar: [] }), { op: "approve" as const, id: "S-0003", at: iso(20) }, { op: "release" as const, id: "S-0003", at: iso(19), calls: [] },
    draft("S-0004", "VOC-62", "CLASSIFY", { type: "MAINT" }, 5 * 24 * 60), { op: "approve" as const, id: "S-0004", at: iso(4 * 24 * 60) },
  ];
  const tickets = [
    t("VOC-60", { labels: ["type:MAINT"] }),
    t("VOC-61", { labels: ["type:MAINT"] }),
    t("VOC-70", { title: "새 카드", createdAt: iso(5) }),
    t("VOC-62"),
  ];
  const out = syncLines(fold(lines), tickets, NOW);
  assert.deepEqual(out.map((l) => `${l.op}:${l.id}:${"ref" in l ? l.ref : "reason" in l ? l.reason : ""}`), [
    "apply:S-0001:VOC-60",
    "supersede:S-0002:Linear에 이미 반영됨",
    "apply:S-0003:VOC-70",
    "expire:S-0004:승인 뒤 3일 동안 발부되지 않음",
  ]);
});

test("S2: 진행 중인 같은 FLIGHT·종류가 있으면 새 초안을 받지 않는다", () => {
  const lines = [{ op: "draft" as const, id: "S-0001", at: iso(30), kind: "CLASSIFY" as const, flight: "VOC-80", payload: { type: "MAINT" as const }, reason: "r" }, { op: "approve" as const, id: "S-0001", at: iso(20) }];
  assert.throws(() => draftOps(fold(lines), { kind: "CLASSIFY", flight: "VOC-80", type: "BUILD", reason: "x" }, [t("VOC-80")], iso(0), 1), /진행 중인 CLASSIFY S-0001/);
});

test("CROSSCHECK: 열린 초안에만 달리고 상태를 바꾸지 않는다. 일치율은 S1 판정과 S2 승인·거절, 브리핑은 mark 없는 초안과 예시", async () => {
  const { crosscheckBriefOf } = await import("./schedule.ts");
  const draft = (id: string, flight: string) => ({ op: "draft" as const, id, at: iso(30), kind: "CLASSIFY" as const, flight, payload: { type: "MAINT" as const }, reason: "OCC 근거" });
  const xc = (id: string, verdict: "agree" | "disagree", min = 20) => ({ op: "crosscheck" as const, id, at: iso(min), by: "CROSSCHECK", verdict, reason: "이미 완료됨" });
  const ops = fold([
    draft("S-0001", "VOC-1"), xc("S-0001", "agree"), xc("S-0001", "disagree", 15), { op: "verdict" as const, id: "S-0001", at: iso(10), verdict: "disagree" as const, reason: "이미 완료됨" },
    draft("S-0002", "VOC-2"), xc("S-0002", "agree"), { op: "approve" as const, id: "S-0002", at: iso(10) }, { op: "release" as const, id: "S-0002", at: iso(9), calls: [] }, { op: "apply" as const, id: "S-0002", at: iso(8), ref: "VOC-2" },
    draft("S-0003", "VOC-3"), xc("S-0003", "agree"), { op: "reject" as const, id: "S-0003", at: iso(10), reason: "BUILD임" },
    draft("S-0004", "VOC-4"), xc("S-0004", "agree"),
    draft("S-0005", "VOC-5"),
    draft("S-0006", "VOC-6"), { op: "supersede" as const, id: "S-0006", at: iso(10), reason: "x" }, xc("S-0006", "agree", 5),
  ]);
  assert.equal(ops[0].status, "disagreed");
  assert.deepEqual(ops[0].crosscheck, { by: "CROSSCHECK", verdict: "disagree", reason: "이미 완료됨", at: iso(15) });
  assert.equal(ops[1].status, "applied");
  assert.deepEqual(ops[1].decision, { verdict: "agree", at: iso(10) });
  assert.equal(ops[3].status, "draft");
  assert.equal(ops[5].crosscheck, null);
  const gate = gateOf(ops);
  assert.equal(gate.decided, 1);
  assert.deepEqual(gate.crosscheck, { marked: 3, matched: 2, rate: 2 / 3 });
  const brief = crosscheckBriefOf(ops, { "S-0005": ["type:MAINT"] });
  assert.deepEqual(brief.pending, [{ id: "S-0005", kind: "CLASSIFY", flight: "VOC-5", reason: "OCC 근거", changes: ["type:MAINT"] }]);
  assert.deepEqual(brief.examples.map((e) => [e.id, e.verdict, e.reason]), [["S-0001", "disagree", "이미 완료됨"], ["S-0003", "disagree", "BUILD임"], ["S-0002", "agree", null]]);
});

test("CROSSCHECK 입력 검사: verdict, 이유 필수·500자 이내, by 기본값", async () => {
  const { parseCrosscheck } = await import("./crosscheck.ts");
  assert.throws(() => parseCrosscheck({ verdict: "maybe", reason: "x" }, iso(0)), /agree\|disagree/);
  assert.throws(() => parseCrosscheck({ verdict: "agree", reason: "  " }, iso(0)), /reason/);
  assert.throws(() => parseCrosscheck({ verdict: "agree", reason: "가".repeat(501) }, iso(0)), /500자/);
  assert.deepEqual(parseCrosscheck({ verdict: "agree", reason: " 본문상\n제약 없음 " }, iso(0)), { by: "CROSSCHECK", verdict: "agree", reason: "본문상 제약 없음", at: iso(0) });
});
