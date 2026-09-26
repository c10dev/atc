import assert from "node:assert/strict";
import { test } from "node:test";
import { actionableBlocks } from "./events.ts";
import { buildPulls, checkBlocks, codexThumbsPass, type GhCheck, type GhPull, type GhReview, isCodexBot, landingBlocks, mergeBlocks, needsCodexSignal, reviewBlocks } from "./landing.ts";
import type { Alert, Workspace } from "./model.ts";
import { ticketKeyFromTitle } from "./sources/git.ts";
import { githubSlug } from "./sources/github.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const run = (name: string, status: string, conclusion: string | null = null, startedAt = "2026-09-26T07:00:00Z"): GhCheck => ({
  __typename: "CheckRun", name, workflowName: "CI", status, conclusion, startedAt,
});
const ctx = (context: string, state: string): GhCheck => ({ __typename: "StatusContext", context, state });
const review = (login: string, state: string, oid: string, at = "2026-09-26T08:00:00Z"): GhReview => ({
  author: { login }, state, submittedAt: at, commit: { oid },
});
const green = [run("Database security contract", "COMPLETED", "SUCCESS"), ctx("Vercel", "SUCCESS")];

const gh = (over: Partial<GhPull> = {}): GhPull => ({
  number: 389, title: "VOC-191 fix", url: "https://github.com/o/r/pull/389", headRefName: "claude/voc-191-fix",
  headRefOid: HEAD, baseRefName: "main", isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: "",
  createdAt: "2026-09-26T06:00:00Z", author: { login: "chaehy5665" }, statusCheckRollup: green,
  reviews: [review("president", "APPROVED", HEAD)], reactionGroups: [],
  ...over,
});
const codes = (bs: { code: string }[]) => bs.map((b) => b.code);

test("CI: 모두 통과·NEUTRAL·SKIPPED면 통과, 진행 중·실패·없음은 막는다", () => {
  assert.deepEqual(checkBlocks([...green, run("lint", "COMPLETED", "NEUTRAL"), run("e2e", "COMPLETED", "SKIPPED")]), []);
  assert.deepEqual(codes(checkBlocks([...green, run("e2e", "IN_PROGRESS"), ctx("Vercel preview", "PENDING")])), ["checks-pending"]);
  assert.match(checkBlocks([run("e2e", "QUEUED")])[0].text, /e2e/);
  assert.deepEqual(codes(checkBlocks([run("e2e", "COMPLETED", "FAILURE"), ctx("Vercel", "ERROR")])), ["checks-failed"]);
  assert.deepEqual(codes(checkBlocks([run("a", "COMPLETED", "CANCELLED"), run("b", "QUEUED")])), ["checks-pending", "checks-failed"]);
  assert.deepEqual(codes(checkBlocks([])), ["no-checks"]);
  assert.deepEqual(codes(checkBlocks(null)), ["no-checks"]);
  // 다시 돌린 체크는 마지막 것만 본다
  const rerun = [run("e2e", "COMPLETED", "FAILURE", "2026-09-26T07:00:00Z"), run("e2e", "COMPLETED", "SUCCESS", "2026-09-26T07:30:00Z")];
  assert.deepEqual(checkBlocks(rerun), []);
});

test("리뷰: head 커밋에 작성자도 Codex도 아닌 리뷰어의 리뷰가 있어야 한다", () => {
  // 사람의 APPROVED는 통과
  assert.deepEqual(reviewBlocks(gh({ reviews: [review("president", "APPROVED", HEAD)] })), []);
  // 결정: 사람(Codex 아닌 리뷰어)의 COMMENTED도 통과로 친다
  assert.deepEqual(reviewBlocks(gh({ reviews: [review("kim", "COMMENTED", HEAD)] })), []);
  // 작성자 자신의 COMMENTED(스레드 답글)는 세지 않는다
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [review("chaehy5665", "COMMENTED", HEAD)] }))), ["no-review"]);
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [] }))), ["no-review"]);
  // 이전 커밋의 리뷰뿐이면 review-stale
  const stale = reviewBlocks(gh({ reviews: [review("chatgpt-codex-connector", "COMMENTED", OLD), review("chaehy5665", "COMMENTED", HEAD)] }));
  assert.deepEqual(codes(stale), ["review-stale"]);
  assert.match(stale[0].text, /bbbbbbb/);
  // DISMISSED·PENDING은 리뷰로 치지 않는다
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [review("x", "DISMISSED", HEAD)] }))), ["no-review"]);
});

test("리뷰: Codex 👍가 head 커밋 뒤에 달렸으면 head 리뷰로 친다", () => {
  const signal = (thumbsAt: string | null, lastComment: { at: string; limit: boolean } | null = null) => ({
    headAt: "2026-09-26T14:30:33Z", thumbsAt, lastComment,
  });
  // PR 389: head 14:30:33, 👍 14:35:17
  assert.deepEqual(reviewBlocks(gh({ reviews: [], codex: signal("2026-09-26T14:35:17Z") })), []);
  // 이전 커밋의 리뷰만 있어도 👍가 head 뒤면 통과
  assert.deepEqual(reviewBlocks(gh({ reviews: [review("chatgpt-codex-connector", "COMMENTED", OLD)], codex: signal("2026-09-26T14:35:17Z") })), []);
  // 새 push 전에 달린 👍(남아 있는 것)는 세지 않는다
  const old = reviewBlocks(gh({ reviews: [], codex: signal("2026-09-26T14:07:00Z") }));
  assert.deepEqual(codes(old), ["no-review"]);
  assert.match(old[0].text, /Codex 👍는 이전 커밋 것/);
  // head 시각을 모르면 세지 않는다
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [], codex: { headAt: null, thumbsAt: "2026-09-26T14:35:17Z", lastComment: null } }))), ["no-review"]);
  // head 뒤 Codex 마지막 댓글이 한도 안내면 그렇게 적는다
  const limit = reviewBlocks(gh({ reviews: [], codex: signal(null, { at: "2026-09-26T14:40:00Z", limit: true }) }));
  assert.equal(limit[0].text, "리뷰 없음: Codex 한도 — 사람 리뷰 필요");
  const staleLimit = reviewBlocks(gh({ reviews: [review("x", "COMMENTED", OLD)], codex: signal(null, { at: "2026-09-26T14:40:00Z", limit: true }) }));
  assert.deepEqual(codes(staleLimit), ["review-stale"]);
  assert.match(staleLimit[0].text, /Codex 한도 — 사람 리뷰 필요/);
  // head 전의 한도 안내나, 한도 안내가 아닌 마지막 댓글은 무시
  assert.doesNotMatch(reviewBlocks(gh({ reviews: [], codex: signal(null, { at: "2026-09-25T17:21:03Z", limit: true }) }))[0].text, /한도/);
  assert.doesNotMatch(reviewBlocks(gh({ reviews: [], codex: signal(null, { at: "2026-09-26T15:00:00Z", limit: false }) }))[0].text, /한도/);
  // 봇 로그인 목록
  assert.ok(isCodexBot("chatgpt-codex-connector[bot]") && isCodexBot("chatgpt-codex-connector") && !isCodexBot("chaehy5665"));
});

test("리뷰: head의 Codex COMMENTED는 지적이라 통과가 아니고, 그 뒤 Codex 👍나 사람 APPROVED가 있어야 풀린다", () => {
  const HEAD_AT = "2026-09-26T07:50:00Z";
  const REVIEW_AT = "2026-09-26T08:00:00Z";
  const codex = review("chatgpt-codex-connector", "COMMENTED", HEAD, REVIEW_AT);
  const signal = (thumbsAt: string | null) => ({ headAt: HEAD_AT, thumbsAt, lastComment: null });

  // head에 Codex 지적만 있으면 review-findings
  const only = reviewBlocks(gh({ reviews: [codex] }));
  assert.deepEqual(codes(only), ["review-findings"]);
  assert.equal(only[0].text, "Codex 지적 있음(head aaaaaaa) — 반영 후 재리뷰 필요");
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [codex], codex: signal(null) }))), ["review-findings"]);
  // REST식 로그인([bot])도 같다
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [review("chatgpt-codex-connector[bot]", "COMMENTED", HEAD)] }))), ["review-findings"]);

  // 지적 뒤에 Codex 👍가 달리면 통과
  assert.deepEqual(reviewBlocks(gh({ reviews: [codex], codex: signal("2026-09-26T08:10:00Z") })), []);
  // 👍가 head 뒤라도 지적보다 먼저(또는 같은 시각)면 여전히 review-findings
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [codex], codex: signal("2026-09-26T07:55:00Z") }))), ["review-findings"]);
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: [codex], codex: signal(REVIEW_AT) }))), ["review-findings"]);
  // 같은 head에 지적이 두 번이면 마지막 지적보다 뒤여야 한다
  const twice = [codex, review("chatgpt-codex-connector", "COMMENTED", HEAD, "2026-09-26T08:20:00Z")];
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: twice, codex: signal("2026-09-26T08:10:00Z") }))), ["review-findings"]);

  // 지적 뒤 사람(Codex·작성자 아닌 리뷰어)의 head APPROVED는 지적을 판단한 것이라 풀린다(👍 없이도)
  const approvedAfter = [review("president", "APPROVED", HEAD, "2026-09-26T08:30:00Z"), codex];
  assert.deepEqual(reviewBlocks(gh({ reviews: approvedAfter })), []);
  // 지적 전 APPROVED는 세지 않는다. 그 뒤 👍가 있으면 풀린다
  const approvedBefore = [review("president", "APPROVED", HEAD, "2026-09-26T07:58:00Z"), codex];
  assert.deepEqual(codes(reviewBlocks(gh({ reviews: approvedBefore }))), ["review-findings"]);
  assert.deepEqual(reviewBlocks(gh({ reviews: approvedBefore, codex: signal("2026-09-26T08:10:00Z") })), []);
  // 지적 뒤라도 사람 COMMENTED, 이전 커밋의 APPROVED, 작성자 APPROVED로는 풀리지 않는다
  for (const r of [review("kim", "COMMENTED", HEAD, "2026-09-26T08:30:00Z"), review("president", "APPROVED", OLD, "2026-09-26T08:30:00Z"), review("chaehy5665", "APPROVED", HEAD, "2026-09-26T08:30:00Z")]) {
    assert.deepEqual(codes(reviewBlocks(gh({ reviews: [r, codex] }))), ["review-findings"], `${r.author!.login} ${r.state}`);
  }

  // 변경 요청과는 함께 뜬다
  const both = reviewBlocks(gh({ reviews: [review("kim", "CHANGES_REQUESTED", OLD, "2026-09-26T07:00:00Z"), codex] }));
  assert.deepEqual(codes(both), ["changes-requested", "review-findings"]);

  // Codex 신호를 읽을 PR: head 통과 리뷰가 없거나 head에 Codex 지적이 있을 때
  assert.equal(needsCodexSignal(gh({ reviews: [codex] })), true);
  assert.equal(needsCodexSignal(gh({ reviews: approvedBefore })), true);
  assert.equal(needsCodexSignal(gh({ reviews: approvedAfter })), false); // 사람 APPROVED가 풀었으면 읽지 않는다
  assert.equal(needsCodexSignal(gh({ reviews: [review("president", "APPROVED", HEAD)] })), false);
  assert.equal(needsCodexSignal(gh({ reviews: [] })), true);
  // 👍 캐시 판단: 지적보다 앞선 👍로는 통과하지 않는다
  assert.equal(codexThumbsPass(gh({ reviews: [] }), signal("2026-09-26T07:55:00Z")), true);
  assert.equal(codexThumbsPass(gh({ reviews: [codex] }), signal("2026-09-26T07:55:00Z")), false);

  // PR 목록에서는 APPROACH, CAPTAIN이 손써야 하는 막힘(landing.blocked·INFO 대상)
  const [pr] = buildPulls([{ repo: "/r/vocado", pulls: [gh({ reviews: [codex] })] }], [], [], new Map(), () => null);
  assert.equal(pr.landing, "APPROACH");
  assert.deepEqual(actionableBlocks(pr), ["review-findings"]);
});

test("FLIGHT: 브랜치에 없으면 PR 제목 끝의 (VOC-n)", () => {
  assert.equal(ticketKeyFromTitle("Ship Geist with the repository (VOC-170)", "VOC"), "VOC-170");
  assert.equal(ticketKeyFromTitle("Fix (voc-07) ", "VOC"), "VOC-7");
  assert.equal(ticketKeyFromTitle("Mentions (VOC-170) in the middle", "VOC"), null);
  assert.equal(ticketKeyFromTitle("Other team (ABC-1)", "VOC"), null);
});

test("리뷰: 누군가의 마지막 판정이 CHANGES_REQUESTED면 막는다(커밋과 상관없이)", () => {
  const req = reviewBlocks(gh({ reviews: [review("kim", "CHANGES_REQUESTED", OLD, "2026-09-26T07:00:00Z"), review("codex", "COMMENTED", HEAD)] }));
  assert.deepEqual(codes(req), ["changes-requested"]);
  assert.match(req[0].text, /kim/);
  // 나중에 승인하면 풀린다. 그 뒤 COMMENTED는 판정을 바꾸지 않는다
  const approved = gh({
    reviews: [
      review("kim", "CHANGES_REQUESTED", OLD, "2026-09-26T07:00:00Z"),
      review("kim", "APPROVED", HEAD, "2026-09-26T08:00:00Z"),
      review("kim", "COMMENTED", HEAD, "2026-09-26T09:00:00Z"),
    ],
  });
  assert.deepEqual(reviewBlocks(approved), []);
  assert.deepEqual(codes(reviewBlocks(gh({ reviewDecision: "CHANGES_REQUESTED" }))), ["changes-requested"]);
});

test("base: CLEAN·UNSTABLE·HAS_HOOKS 통과, BEHIND·DIRTY·BLOCKED·UNKNOWN은 막는다", () => {
  for (const s of ["CLEAN", "UNSTABLE", "HAS_HOOKS", "DRAFT"]) assert.deepEqual(mergeBlocks(s), [], s);
  assert.deepEqual(codes(mergeBlocks("BEHIND")), ["behind"]);
  assert.deepEqual(codes(mergeBlocks("DIRTY")), ["dirty"]);
  assert.deepEqual(codes(mergeBlocks("BLOCKED")), ["blocked"]);
  assert.deepEqual(mergeBlocks("UNKNOWN"), [{ code: "merge-unknown", text: "GitHub이 아직 계산 중(머지 가능 여부)" }]);
  assert.deepEqual(codes(mergeBlocks("")), ["merge-unknown"]);
});

test("조건 모음: 여러 막힘은 정해진 순서로, LOS와 Draft 포함", () => {
  assert.deepEqual(landingBlocks(gh(), false), []);
  const all = landingBlocks(
    gh({ isDraft: true, mergeStateStatus: "BEHIND", statusCheckRollup: [run("e2e", "COMPLETED", "FAILURE")], reviews: [] }),
    true,
  );
  assert.deepEqual(codes(all), ["draft", "checks-failed", "no-review", "behind", "los"]);
});

const WS: Workspace = {
  path: "/w/vocado-voc-191", name: "vocado-voc-191", repo: "/r/vocado", isMain: false, branch: "claude/voc-191-fix",
  head: "", dirty: 0, lastCommitAt: null, ticketKey: "VOC-191",
};
const keyOf = (p: GhPull) => {
  const m = p.headRefName.match(/voc-(\d+)/) ?? p.title.match(/\(VOC-(\d+)\)$/);
  return m ? `VOC-${Number(m[1])}` : null;
};

test("PR 목록: FLIGHT·STAND 연결, LOS, readyAt은 head별 첫 시각, 순서는 CLEARED(readyAt) 다음 APPROACH(연 순서)", () => {
  const ready = new Map<string, string>();
  const src = (pulls: GhPull[]) => [{ repo: "/r/vocado", pulls }];
  const a = gh({ number: 1, createdAt: "2026-09-26T01:00:00Z" });
  const b = gh({ number: 2, headRefName: "claude/voc-7", createdAt: "2026-09-26T02:00:00Z" });
  const c = gh({ number: 3, headRefName: "misc", title: "Misc (VOC-44)", reviews: [], createdAt: "2026-09-26T00:30:00Z" });
  const d = gh({ number: 4, headRefName: "docs", mergeStateStatus: "BEHIND", createdAt: "2026-09-26T00:10:00Z" });

  let out = buildPulls(src([a, c, d]), [WS], [], ready, keyOf, "2026-09-26T10:00:00Z");
  assert.deepEqual(out.map((p) => [p.number, p.landing]), [[1, "CLEARED"], [4, "APPROACH"], [3, "APPROACH"]]);
  assert.equal(out[0].ticketKey, "VOC-191");
  assert.equal(out[0].standPath, WS.path);
  assert.equal(out[0].readyAt, "2026-09-26T10:00:00Z");
  assert.equal(out[1].readyAt, null);
  assert.equal(out[2].ticketKey, "VOC-44");
  assert.equal(out[1].ticketKey, null);

  // 나중에 CLEARED가 된 PR은 뒤로. 먼저 된 PR의 readyAt은 그대로
  out = buildPulls(src([a, b, c]), [WS], [], ready, keyOf, "2026-09-26T10:05:00Z");
  assert.deepEqual(out.map((p) => [p.number, p.readyAt]), [[1, "2026-09-26T10:00:00Z"], [2, "2026-09-26T10:05:00Z"], [3, null]]);

  // STAND에 LOS가 열리면 APPROACH. 풀리면 같은 head라 첫 readyAt을 되찾는다
  const los: Alert = { kind: "conflict", message: "x", workspacePath: WS.path, sessionIds: ["s1", "s2"] };
  out = buildPulls(src([a, b]), [WS], [los], ready, keyOf, "2026-09-26T10:06:00Z");
  assert.deepEqual(out.map((p) => [p.number, p.landing]), [[2, "CLEARED"], [1, "APPROACH"]]);
  assert.deepEqual(codes(out[1].blocks), ["los"]);
  out = buildPulls(src([a, b]), [WS], [], ready, keyOf, "2026-09-26T10:07:00Z");
  assert.deepEqual(out.map((p) => [p.number, p.readyAt]), [[1, "2026-09-26T10:00:00Z"], [2, "2026-09-26T10:05:00Z"]]);

  // 새 push(head 변경)는 다시 센다
  const pushed = { ...a, headRefOid: "c".repeat(40), reviews: [review("codex", "COMMENTED", "c".repeat(40))] };
  out = buildPulls(src([pushed, b]), [WS], [], ready, keyOf, "2026-09-26T10:20:00Z");
  assert.deepEqual(out.map((p) => [p.number, p.readyAt]), [[2, "2026-09-26T10:05:00Z"], [1, "2026-09-26T10:20:00Z"]]);
  // 사라진 PR·head의 기록은 지운다
  assert.equal(ready.size, 2);
});

test("GitHub remote URL → owner/name", () => {
  assert.equal(githubSlug("git@github.com:chaehy5665/vocado_nextjs.git"), "chaehy5665/vocado_nextjs");
  assert.equal(githubSlug("https://github.com/chaehy5665/atc.git"), "chaehy5665/atc");
  assert.equal(githubSlug("https://github.com/chaehy5665/tennis-sim"), "chaehy5665/tennis-sim");
  assert.equal(githubSlug("ssh://git@github.com/o/r.git"), "o/r");
  assert.equal(githubSlug("git@gitlab.com:o/r.git"), null);
});
