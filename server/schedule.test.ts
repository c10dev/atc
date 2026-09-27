import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "./model.ts";
import { callsOf, candidatesOf, changesOf, CLOSE_RELEASE_WHY, closableOf, standFreeHint, draftOps, fold, gateOf, missingSections, type NewPayload, parseNew, parsePayload, ScheduleError, similarTickets, syncLines, titleTokens } from "./schedule.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (key: string, over: Partial<Ticket> = {}) =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", labels: [], priority: 3, project: "Beta Readiness", url: null, ...over }) as Ticket;

test("CLASSIFY·PRIORITIZE 입력 검사", () => {
  assert.deepEqual(parsePayload("CLASSIFY", { type: "maint", wake: "h", ratings: ["sec", "SEC"] }), { kind: "CLASSIFY", payload: { type: "MAINT", wake: "H", ratings: ["SEC"] } });
  assert.deepEqual(parsePayload("PRIORITIZE", { priority: "2" }), { kind: "PRIORITIZE", payload: { priority: 2 } });
  assert.throws(() => parsePayload("TAIL", {}), /모르는 SCHEDULE 작업/);
  assert.throws(() => parsePayload("CLOSE", {}), /LOGBOOK에서 채운다/);
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
  assert.deepEqual(gateOf(ops), { decided: 1, agreed: 0, agreement: 0, target: { decided: 20, agreement: 0.8 }, ready: false, crosscheck: { marked: 0, matched: 0, rate: null, byModel: {}, oneClick: { count: 0, decided: 0 } }, network: { TARGET: { decided: 0, agreed: 0, agreement: null }, ROUTE: { decided: 0, agreed: 0, agreement: null } } });
  const tickets = [t("VOC-41"), t("VOC-42", { labels: ["type:BUILD", "wake:M"], priority: 0 }), t("VOC-43", { state: "In Progress", stateType: "started" })];
  assert.deepEqual(candidatesOf(tickets, []), { classify: ["VOC-41"], prioritize: ["VOC-42"], close: [] });
});

test("분류 후보: SURVEY·CHECK로 보이는 제목(리서치·검토·비교·계획)을 앞에, 나머지는 원래 순서", () => {
  const tickets = [
    t("VOC-50", { title: "Finish the focus-colour sweep" }),
    t("VOC-51", { title: "Run beta comparison for Expression Lens" }),
    t("VOC-52", { title: "머리 줄 동작 맞추기" }),
    t("VOC-53", { title: "랜딩 데이터를 별도 프로젝트로 분리 (계획)" }),
    t("VOC-54", { title: "PR #400 exact-head review" }),
  ];
  assert.deepEqual(candidatesOf(tickets, []).classify, ["VOC-51", "VOC-53", "VOC-54", "VOC-50", "VOC-52"]);
  assert.equal(standFreeHint("Previewer fix"), false);
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
  assert.deepEqual(ops[0].crosscheck, { by: "CROSSCHECK", model: "unknown", verdict: "disagree", reason: "이미 완료됨", at: iso(15) });
  assert.equal(ops[1].status, "applied");
  assert.deepEqual(ops[1].decision, { verdict: "agree", at: iso(10) });
  assert.equal(ops[3].status, "draft");
  assert.equal(ops[5].crosscheck, null);
  const gate = gateOf(ops);
  assert.equal(gate.decided, 1);
  assert.deepEqual(gate.crosscheck, { marked: 3, matched: 2, rate: 2 / 3, byModel: { unknown: { marked: 3, matched: 2, rate: 2 / 3 } }, oneClick: { count: 0, decided: 0 } });
  const brief = crosscheckBriefOf(ops, { "S-0005": ["type:MAINT"] });
  assert.deepEqual(brief.pending, [{ id: "S-0005", kind: "CLASSIFY", flight: "VOC-5", reason: "OCC 근거", changes: ["type:MAINT"] }]);
  assert.deepEqual(brief.examples.map((e) => [e.id, e.verdict, e.reason]), [["S-0001", "disagree", "이미 완료됨"], ["S-0003", "disagree", "BUILD임"], ["S-0002", "agree", null]]);
});

test("CROSSCHECK 입력 검사: verdict, 이유 필수·500자 이내, by 기본값", async () => {
  const { parseCrosscheck } = await import("./crosscheck.ts");
  assert.throws(() => parseCrosscheck({ verdict: "maybe", reason: "x" }, iso(0)), /agree\|disagree/);
  assert.throws(() => parseCrosscheck({ verdict: "agree", reason: "  " }, iso(0)), /reason/);
  assert.throws(() => parseCrosscheck({ verdict: "agree", reason: "가".repeat(501) }, iso(0)), /500자/);
  assert.deepEqual(parseCrosscheck({ verdict: "agree", reason: " 본문상\n제약 없음 " }, iso(0)), { by: "CROSSCHECK", model: "unknown", verdict: "agree", reason: "본문상 제약 없음", at: iso(0) });
  assert.equal(parseCrosscheck({ verdict: "agree", reason: "x", model: " claude-ocx-opencode-go--muse-spark-1.3-contributor[1m] " }, iso(0)).model, "claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]");
});

test("판정 방식(via): verdict·approve·reject에서만 접고 뒤 상태로 넘어가도 남는다. oneClick은 판정 전 mark가 있고 via가 기록된 판정만", async () => {
  const { humanOf } = await import("./schedule.ts");
  const draft = (id: string, flight: string) => ({ op: "draft" as const, id, at: iso(30), kind: "CLASSIFY" as const, flight, payload: { type: "MAINT" as const }, reason: "r" });
  const xc = (id: string) => ({ op: "crosscheck" as const, id, at: iso(20), by: "CROSSCHECK", model: "muse", verdict: "agree" as const, reason: "r" });
  const ops = fold([
    draft("S-0001", "VOC-1"), xc("S-0001"), { op: "verdict" as const, id: "S-0001", at: iso(10), verdict: "agree" as const, reason: null, via: "crosscheck" as const },
    draft("S-0002", "VOC-2"), xc("S-0002"), { op: "approve" as const, id: "S-0002", at: iso(10), via: "manual" as const }, { op: "release" as const, id: "S-0002", at: iso(9), calls: [] },
    draft("S-0003", "VOC-3"), { op: "reject" as const, id: "S-0003", at: iso(10), reason: "BUILD임", via: "crosscheck" as const }, // mark 없음 → oneClick에 안 셈
    draft("S-0004", "VOC-4"), { op: "verdict" as const, id: "S-0004", at: iso(10), verdict: "disagree" as const, reason: "옛 기록" },
  ]);
  assert.deepEqual(ops.map((o) => o.via), ["crosscheck", "manual", "crosscheck", undefined]);
  assert.deepEqual(humanOf(ops[2]), { verdict: "disagree", at: iso(10), reason: "BUILD임", via: "crosscheck" });
  assert.deepEqual(humanOf(ops[3]), { verdict: "disagree", at: iso(10), reason: "옛 기록" });
  assert.deepEqual(gateOf(ops).crosscheck.oneClick, { count: 1, decided: 2 });
});

test("OCC 보정 예시: 사람 판정만, 사유 있는 것 먼저, OCC가 냈던 분류와 근거를 담고 NEW 본문은 뺀다", async () => {
  const { occExamplesOf } = await import("./schedule.ts");
  const draft = (id: string, flight: string, payload: object, reason = "OCC 근거") => ({ op: "draft" as const, id, at: iso(30), kind: "CLASSIFY" as const, flight, payload, reason });
  const ops = fold([
    draft("S-0001", "VOC-195", { type: "BUILD", wake: "M", ratings: ["SEC"] }, "락 조건 수정"),
    { op: "verdict" as const, id: "S-0001", at: iso(20), verdict: "disagree" as const, reason: "FLIGHT TYPE은 MAINT — fleet.md 4.1" },
    draft("S-0002", "VOC-179", { type: "BUILD", wake: "M", ratings: ["UI"] }),
    { op: "verdict" as const, id: "S-0002", at: iso(10), verdict: "agree" as const, reason: null },
    draft("S-0003", "VOC-181", { type: "BUILD" }), // 판정 없음 → 빠짐
    { op: "draft" as const, id: "S-0004", at: iso(30), kind: "NEW" as const, flight: null, payload: { title: "t", body: "## 목표\nx", project: "Web UX", type: "BUILD", wake: "M", similar: [{ key: "VOC-1", title: "a" }] }, reason: "중복 검색: 없음" },
    { op: "verdict" as const, id: "S-0004", at: iso(5), verdict: "disagree" as const, reason: "중복" },
  ]);
  const ex = occExamplesOf(ops);
  assert.deepEqual(ex.map((e) => e.id), ["S-0004", "S-0001", "S-0002"]); // 사유 있는 것(최근 순) 먼저
  assert.deepEqual(ex[1], { id: "S-0001", kind: "CLASSIFY", flight: "VOC-195", proposed: { type: "BUILD", wake: "M", ratings: ["SEC"] }, draft: "락 조건 수정", verdict: "disagree", reason: "FLIGHT TYPE은 MAINT — fleet.md 4.1" });
  assert.deepEqual(ex[0].proposed, { title: "t", project: "Web UX", type: "BUILD", wake: "M" });
});

// ── CLOSE ──
const arrived = (n: number, flight: string | null, over: Record<string, unknown> = {}) => ({
  key: `o/vocado_nextjs#${n}`, flight, pr: { repo: "o/vocado_nextjs", number: n, url: `https://github.com/o/vocado_nextjs/pull/${n}`, title: "" },
  arrivedAt: iso(60 * n), reverted: false, ...over,
}) as never;

test("CLOSE 후보: LOGBOOK ARRIVED(되돌림 아님)인데 Linear가 열린 FLIGHT. Fixes인 PR을 먼저, 본문을 모르면 link null", () => {
  const tickets = [
    t("VOC-1", { state: "In Review", stateType: "started" }),
    t("VOC-2", { state: "Done", stateType: "completed" }),
    t("VOC-3"),
    t("VOC-4", { state: "In Progress", stateType: "started" }),
    t("VOC-5"),
  ];
  const entries = [
    arrived(1, "VOC-1", { link: "part-of" }),
    arrived(2, "VOC-1", { link: "fixes" }), // 같은 FLIGHT의 다른 PR: Fixes가 먼저
    arrived(3, "VOC-2", { link: "fixes" }), // 이미 Done
    arrived(4, "VOC-3", { reverted: true }), // 되돌림뿐
    arrived(5, "VOC-4"), // 옛 줄: link 없음 → 본문으로
    arrived(6, "VOC-5"), // 본문을 아직 모름
    arrived(7, null),
  ];
  const bodies: Record<string, string> = { "o/vocado_nextjs#5": "Part of VOC-4" };
  const { closable, reverted } = closableOf(entries, tickets, (k) => bodies[k]);
  assert.deepEqual([...closable.values()].map((c) => `${c.flight}:${c.pr.number}:${c.link}`).sort(), ["VOC-1:2:fixes", "VOC-4:5:part-of", "VOC-5:6:null"]);
  assert.deepEqual([...reverted], ["VOC-3"]);
  // 후보: Part of와 본문 모름은 빼고, 열린 CLOSE 초안이 있는 것도 뺀다
  assert.deepEqual(candidatesOf(tickets, [], closable).close, ["VOC-1"]);
  const open = fold([{ op: "draft", id: "S-0001", at: iso(1), kind: "CLOSE", flight: "VOC-1", payload: { pr: { repo: "o/v", number: 2, url: "" }, mergedAt: iso(120) }, reason: "x" }]);
  assert.deepEqual(candidatesOf(tickets, open, closable).close, []);
  // 판정된 CLOSE(7일 안)가 있으면 다시 후보가 되지 않는다(승인했을 것은 "직접 Done" 목록에 있다)
  const decided = fold([
    { op: "draft", id: "S-0001", at: iso(10), kind: "CLOSE", flight: "VOC-1", payload: { pr: { repo: "o/v", number: 2, url: "" }, mergedAt: iso(120) }, reason: "x" },
    { op: "verdict", id: "S-0001", at: iso(5), verdict: "agree", reason: null },
  ]);
  assert.deepEqual(candidatesOf(tickets, decided, closable, NOW).close, []);
  assert.deepEqual(candidatesOf(tickets, decided, closable, NOW + 8 * 86_400_000).close, ["VOC-1"]);
});

test("CLOSE 초안: 닫히지 않았고 LOGBOOK에 있어야 하며, payload는 atc가 채운다. Part of는 표시한다", () => {
  const tickets = [t("VOC-1", { state: "In Review", stateType: "started" }), t("VOC-2", { state: "Done", stateType: "completed" }), t("VOC-4", { state: "Todo" }), t("VOC-9")];
  const { closable } = closableOf(
    [arrived(1, "VOC-1", { link: "fixes" }), arrived(2, "VOC-4", { link: "part-of" }), arrived(3, "VOC-9")],
    tickets,
    () => undefined,
  );
  const lines = draftOps([], { kind: "CLOSE", flight: "voc-1", reason: "PR 1 머지, Fixes VOC-1" }, tickets, iso(0), 0, { closable });
  assert.deepEqual(lines, [{ op: "draft", id: "S-0001", at: iso(0), kind: "CLOSE", flight: "VOC-1", payload: { pr: { repo: "o/vocado_nextjs", number: 1, url: "https://github.com/o/vocado_nextjs/pull/1" }, mergedAt: iso(60), fixes: true }, reason: "PR 1 머지, Fixes VOC-1" }]);
  const part = draftOps([], { kind: "CLOSE", flight: "VOC-4", reason: "x" }, tickets, iso(0), 0, { closable })[0] as { payload: unknown };
  assert.deepEqual(part.payload, { pr: { repo: "o/vocado_nextjs", number: 2, url: "https://github.com/o/vocado_nextjs/pull/2" }, mergedAt: iso(120), partOf: true });
  assert.throws(() => draftOps([], { kind: "CLOSE", flight: "VOC-2", reason: "x" }, tickets, iso(0), 0, { closable }), /이미 닫힘/);
  assert.throws(() => draftOps([], { kind: "CLOSE", flight: "VOC-9", reason: "x" }, tickets, iso(0), 0, { closable }), /본문을 아직 읽지 못함/);
  assert.throws(() => draftOps([], { kind: "CLOSE", flight: "VOC-1", reason: "x" }, tickets, iso(0), 0), /ARRIVED 기록이 없음/);
  assert.throws(() => draftOps([], { kind: "CLOSE", flight: "VOC-1", reason: " " }, tickets, iso(0), 0, { closable }), /근거/);
  // 바뀔 것: 상태 → Done, 닫혔으면 없음
  const payload = { pr: { repo: "o/vocado_nextjs", number: 400, url: "" }, mergedAt: "2026-09-26T13:41:00Z", fixes: true };
  assert.deepEqual(changesOf("CLOSE", payload, tickets[0]), ["In Review → Done · PR vocado_nextjs#400 머지 2026-09-26 · Fixes"]);
  assert.deepEqual(changesOf("CLOSE", payload, tickets[1]), []);
});

test("CLOSE 발부는 거절한다(vocado 규칙상 OCC는 상태를 바꾸지 않음)", () => {
  const [op] = fold([{ op: "draft", id: "S-0001", at: iso(1), kind: "CLOSE", flight: "VOC-1", payload: { pr: { repo: "o/v", number: 2, url: "" }, mergedAt: iso(120) }, reason: "x" }]);
  assert.throws(() => callsOf(op, undefined, "Vocado"), (e) => e instanceof ScheduleError && e.message === CLOSE_RELEASE_WHY && e.status === 409);
});

test("CLOSE 닫기: Linear가 Done·Canceled면 SUPERSEDED(발부 전)·APPLIED(발부됨), PR이 되돌려지면 SUPERSEDED, 3일이면 EXPIRED", () => {
  const draft = (id: string, flight: string, minAgo = 10) => ({ op: "draft" as const, id, at: iso(minAgo), kind: "CLOSE" as const, flight, payload: { pr: { repo: "o/v", number: 1, url: "" }, mergedAt: iso(500) }, reason: "x" });
  const ops = fold([
    draft("S-0001", "VOC-1"),
    draft("S-0002", "VOC-2"),
    { op: "approve", id: "S-0002", at: iso(5) },
    draft("S-0003", "VOC-3"),
    draft("S-0004", "VOC-4", 4 * 24 * 60),
    draft("S-0005", "VOC-5"),
    draft("S-0006", "VOC-6"),
  ]);
  const tickets = [
    t("VOC-1", { state: "Done", stateType: "completed" }),
    t("VOC-2", { state: "Canceled", stateType: "canceled" }),
    t("VOC-3", { state: "In Review", stateType: "started" }),
    t("VOC-4", { state: "In Review", stateType: "started" }),
    t("VOC-5", { state: "In Progress", stateType: "started" }), // 계획 단계가 아니어도 열린 CLOSE는 그대로
  ];
  const out = syncLines(ops, tickets, NOW, { reverted: new Set(["VOC-3"]) });
  assert.deepEqual(out.map((l) => `${l.op}:${l.id}:${"reason" in l ? l.reason : ""}`), [
    "supersede:S-0001:Linear에서 닫힘(Done)",
    "supersede:S-0002:Linear에서 닫힘(Canceled)",
    "supersede:S-0003:PR이 되돌려짐(LOGBOOK)",
    "expire:S-0004:",
    "supersede:S-0006:FLIGHT가 목록에 없음",
  ]);
  // 발부된(released) CLOSE는 APPLIED(나중에 발부를 켜면)
  const released = fold([draft("S-0007", "VOC-1"), { op: "approve", id: "S-0007", at: iso(5) }, { op: "release", id: "S-0007", at: iso(4), calls: [] }]);
  assert.deepEqual(syncLines(released, tickets, NOW), [{ op: "apply", id: "S-0007", at: new Date(NOW).toISOString(), ref: "VOC-1" }]);
});

test("linear-guard 한 번 쓰기: 발부된 호출은 한 번만 통과하고, 두 번째는 막힌다. 상태는 APPLIED 판정 전까지 released", async () => {
  const { claimOf } = await import("./schedule.ts");
  const draft = { op: "draft" as const, id: "S-0010", at: iso(30), kind: "CLASSIFY" as const, flight: "VOC-50", payload: { type: "MAINT" as const }, reason: "r" };
  const calls = [
    { tool: "save_issue" as const, input: { id: "VOC-50", labels: ["MAINT"] } },
    { tool: "save_comment" as const, input: { issueId: "VOC-50", body: "[OCC S-0010] 분류" } },
  ];
  const base = [draft, { op: "approve" as const, id: "S-0010", at: iso(20) }, { op: "release" as const, id: "S-0010", at: iso(19), calls }];
  let ops = fold(base);
  assert.deepEqual(claimOf(ops, "approval", "save_comment", { body: "[OCC S-0010] 분류", issueId: "VOC-50" }), { id: "S-0010", call: 1 }); // 키 순서 무관
  assert.match((claimOf(ops, "shadow", "save_comment", calls[1].input) as { error: string }).error, /S1\(shadow\)/);
  assert.match((claimOf(ops, "approval", "save_comment", { issueId: "VOC-50", body: "다른 글" }) as { error: string }).error, /다름/);
  ops = fold([...base, { op: "use", id: "S-0010", at: iso(18), call: 1 }]);
  assert.deepEqual([ops[0].status, ops[0].used], ["released", [1]]);
  assert.match((claimOf(ops, "approval", "save_comment", calls[1].input) as { error: string }).error, /이미 한 번 통과함/);
  assert.deepEqual(claimOf(ops, "approval", "save_issue", calls[0].input), { id: "S-0010", call: 0 }); // 다른 호출은 따로
  // 같은 호출을 다시 발부해도(재시도용 release) 쓴 표시는 남는다. 없는 번호·released가 아닌 작업의 use는 무시
  ops = fold([...base, { op: "use", id: "S-0010", at: iso(18), call: 1 }, { op: "release", id: "S-0010", at: iso(17), calls }, { op: "use", id: "S-0010", at: iso(16), call: 7 }]);
  assert.deepEqual(ops[0].used, [1]);
  assert.equal(fold([draft, { op: "use", id: "S-0010", at: iso(18), call: 0 }])[0].used, undefined);
  // APPLIED 뒤에는 발부 목록에서 빠지므로 어떤 호출도 통과하지 않는다
  ops = fold([...base, { op: "apply", id: "S-0010", at: iso(10), ref: "VOC-50" }]);
  assert.match((claimOf(ops, "approval", "save_issue", calls[0].input) as { error: string }).error, /다름/);
});

test("후보 팀이 아닌 FLIGHT(ATC)에는 초안을 쓰지 않는다. NEW는 주 팀에 만들므로 상관없음", () => {
  const tickets = [t("VOC-10"), t("ATC-1")];
  const teams = new Set(["VOC"]);
  assert.throws(
    () => draftOps([], { kind: "CLASSIFY", flight: "atc-1", type: "MAINT", reason: "r" }, tickets, iso(0), 0, { teams }),
    (e) => e instanceof ScheduleError && e.status === 409 && /ATC 팀은 SCHEDULE 후보가 아님/.test(e.message),
  );
  assert.equal(draftOps([], { kind: "CLASSIFY", flight: "VOC-10", type: "MAINT", reason: "r" }, tickets, iso(0), 0, { teams }).length, 1);
  assert.equal(draftOps([], { kind: "CLASSIFY", flight: "ATC-1", type: "MAINT", reason: "r" }, tickets, iso(0), 0, { teams: new Set(["VOC", "ATC"]) }).length, 1);
});

test("NEW milestone(ATC-8): 그 프로젝트의 마일스톤 이름·id만, changesOf와 S2 호출에 들어간다, gap은 비슷한 FLIGHT가 있으면 거절", () => {
  const ms = (id: string, name: string, project: string) => ({ id, name, project, description: "", targetDate: null, progress: 0, sortOrder: 1, status: "next", issues: [], truncated: false, teams: ["VOC"] });
  const milestones = [ms("m-1", "Beta Ready", "Web UX"), ms("m-2", "Launch", "Beta Readiness")];
  const ok = parseNew(newInput({ milestone: "beta ready" }), board, TAILS, milestones);
  assert.deepEqual(ok.milestone, { id: "m-1", name: "Beta Ready" });
  assert.deepEqual(parseNew(newInput({ milestone: "m-1" }), board, TAILS, milestones).milestone, { id: "m-1", name: "Beta Ready" });
  assert.throws(() => parseNew(newInput({ milestone: "Launch" }), board, TAILS, milestones), /Web UX의 마일스톤이 아님: Launch \(가능: Beta Ready\)/);
  assert.throws(() => parseNew(newInput({ milestone: "Beta Ready" }), board, TAILS, null), /마일스톤을 아직 읽지 못함/);
  assert.equal(parseNew(newInput(), board, TAILS, null).milestone, undefined);
  const payload = { ...ok, similar: [] };
  assert.match(changesOf("NEW", payload)[0], /^새 이슈: 재생 화면 버튼 정리 · Web UX · WAYPOINT Beta Ready · /);
  const base = { at: iso(10), status: "approved" as const, statusAt: iso(5), verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null, reason: "r" };
  const [call] = callsOf({ ...base, id: "S-0009", kind: "NEW", flight: null, payload }, undefined, "Vocado");
  assert.equal(call.input.milestone, "m-1");
  // gap: milestone이 있어야 하고, 비슷한 FLIGHT가 있으면 쓰지 않는다
  const gapOf = (over: Record<string, unknown>) => draftOps([], { ...newInput(over), gap: true }, board, iso(0), 0, { tails: TAILS, milestones });
  assert.throws(() => gapOf({}), /milestone이 필요함/);
  assert.throws(() => gapOf({ milestone: "Beta Ready", title: "Practice 시트 머리 줄 동작 맞추기" }), /비슷한 FLIGHT가 있어.*VOC-60/);
  const [line] = gapOf({ milestone: "Beta Ready", title: "재생 화면 버튼 정리" });
  assert.equal(line.op, "draft");
  assert.equal((line as { payload: NewPayload }).payload.gap, true);
});
