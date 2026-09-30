import assert from "node:assert/strict";
import { test } from "node:test";
import { codexFindingsEn, codexP3OpenEn, countsEn, gateReasonEn, infoTextOf, stackedEn } from "./landing-en.ts";
import { checkBlocks, type GhCheck, type GhPull, type GhReview, landingBlocks, mergeBlocks, reviewBlocks, stackedText } from "./landing.ts";
import type { LandingBlockCode } from "./model.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const run = (name: string, status: string, conclusion: string | null = null): GhCheck => ({ __typename: "CheckRun", name, workflowName: "CI", status, conclusion, startedAt: "2026-09-26T07:00:00Z" });
const review = (login: string, state: string, oid: string): GhReview => ({ author: { login }, state, submittedAt: "2026-09-26T08:00:00Z", commit: { oid } });
const green = [run("check", "COMPLETED", "SUCCESS")];
const gh = (over: Partial<GhPull> = {}): GhPull => ({
  number: 389, title: "ATC-1 fix", url: "https://github.com/o/r/pull/389", headRefName: "claude/atc-1-fix", headRefOid: HEAD, baseRefName: "main",
  isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: "", createdAt: "2026-09-26T06:00:00Z", author: { login: "me" }, statusCheckRollup: green,
  reviews: [review("kim", "APPROVED", HEAD)], reactionGroups: [], ...over,
});
const hangul = /[ㄱ-힝]/;
const seen = new Set<LandingBlockCode>();
// 모든 en은 비어 있지 않고 한글이 없다. 본 코드를 기록해 마지막 테스트가 전 코드를 다뤘는지 본다
const en = (bs: { code: LandingBlockCode; text: string; en: string }[]) => {
  for (const b of bs) {
    seen.add(b.code);
    assert.ok(b.en.length > 0, b.code);
    assert.doesNotMatch(b.en, hangul, `${b.code}: ${b.en}`);
    assert.doesNotMatch(b.en, /undefined|null/, b.code);
  }
  return bs.map((b) => b.en);
};

test("en: CI 코드 no-checks · checks-pending · checks-failed", () => {
  assert.deepEqual(en(checkBlocks([])), ["no CI checks on the head commit"]);
  assert.deepEqual(en(checkBlocks([run("e2e", "IN_PROGRESS")])), ["CI in progress: e2e"]);
  const failing = ["a", "b", "c", "d", "e"].map((n) => run(n, "COMPLETED", "FAILURE"));
  assert.deepEqual(en(checkBlocks(failing)), ["CI failed: a, b, c and 2 more"]);
});

test("en: 머지 상태 코드 behind · dirty · blocked · merge-unknown", () => {
  assert.deepEqual(en(mergeBlocks("BEHIND")), ["behind base: rebase needed"]);
  assert.deepEqual(en(mergeBlocks("DIRTY")), ["conflicts with base: resolve the conflicts"]);
  assert.deepEqual(en(mergeBlocks("BLOCKED")), ["GitHub branch protection blocks the merge"]);
  assert.deepEqual(en(mergeBlocks("BLOCKED", 1)), ["GitHub branch protection blocks the merge — 1 unresolved review thread (threads must be resolved before merging)"]);
  assert.match(en(mergeBlocks("BLOCKED", 3))[0], /3 unresolved review threads/);
  assert.deepEqual(en(mergeBlocks("UNKNOWN")), ["GitHub is still computing whether the PR can merge"]);
});

test("en: 리뷰 코드 no-review · review-stale · changes-requested · review-findings", () => {
  assert.equal(en(reviewBlocks(gh({ reviews: [] })))[0], "no review: head aaaaaaa needs a review");
  assert.match(en(reviewBlocks(gh({ reviews: [review("chatgpt-codex-connector", "COMMENTED", OLD)] })))[0], /^the only review is on an earlier commit bbbbbbb: head aaaaaaa needs a review/);
  assert.equal(en(reviewBlocks(gh({ reviews: [review("kim", "CHANGES_REQUESTED", HEAD)] })))[0], "changes requested (CHANGES_REQUESTED) by kim still stand");
  assert.equal(en(reviewBlocks(gh({ reviews: [], reviewDecision: "CHANGES_REQUESTED" })))[0], "a change request (CHANGES_REQUESTED) still stands");
  // Codex 지적(스레드를 못 읽어 등급 없음)
  const codexPr = gh({ reviews: [review("chatgpt-codex-connector", "COMMENTED", HEAD)] });
  assert.deepEqual(en(reviewBlocks(codexPr)), ["Codex findings on head aaaaaaa — fix and get a re-review"]);
  // MCC INSPECTION 지적
  const mcc = { review: { verdict: "findings" as const, text: "bug in x", p0: 0, p1: 1, p2: 2 } };
  assert.deepEqual(en(reviewBlocks(gh({ reviews: [] }), undefined, undefined, undefined, mcc)), ["MCC INSPECTION findings (head aaaaaaa, P0 0 · P1 1 · P2 2): bug in x — fix and re-inspect on the new head"]);
  // 이어받은 리뷰의 지적
  assert.deepEqual(en(reviewBlocks(gh({ reviews: [] }), undefined, undefined, { from: OLD, by: "codex", findings: true })), ["Codex findings remain on the earlier commit bbbbbbb (only main merges since) — fix and get a re-review"]);
  assert.match(en(reviewBlocks(gh({ reviews: [] }), undefined, undefined, { from: OLD, by: "human", findings: true }))[0], /^human APPROVED findings remain/);
  // MCC INSPECTION 대기(리뷰 없음의 사유)
  assert.equal(en(reviewBlocks(gh({ reviews: [] }), undefined, undefined, undefined, { review: null }))[0], "no review: waiting for the MCC INSPECTION of head aaaaaaa");
});

test("en: Codex 한도 때 제외·대기·한도·지적 변형에도 한글이 없다 (MCC P1)", () => {
  const unavailable = { why: "limit" as const, since: "2026-09-26T09:00:00Z" };
  const lr = (verdict: "pass" | "findings", p1: number) => ({ at: "t", repo: "o/r", number: 389, head: HEAD, model: "claude-sonnet-5-5", family: "claude-sonnet-5-5", verdict, p0: 0, p1, p2: 0, text: "x" }) as never;
  const none = gh({ reviews: [] });
  const first = (ext: Parameters<typeof reviewBlocks>[1]) => en(reviewBlocks(none, ext))[0];
  // 제외: 사유 종류마다
  assert.equal(first({ unavailable, exclusion: "FLIGHT 없음", review: null }), "no review: Codex limit — excluded from external review (no FLIGHT) — needs a Codex or SUPERVISOR review");
  assert.match(first({ unavailable, exclusion: "비밀·키 경로 .env.local", review: null }), /\(secret or key path \.env\.local\)/);
  assert.match(first({ unavailable, exclusion: "키워드 grant", review: null }), /\(security keyword grant\)/);
  assert.match(first({ unavailable, exclusion: "rating:SEC", review: null }), /\(rating:SEC\)/);
  assert.match(first({ unavailable, exclusion: "비밀·키 경로", review: null }), /\(secret or key path\)/);
  assert.match(first({ unavailable, exclusion: "알 수 없는 사유", review: null }), /\(see the screen\)/);
  // 대기: 보안 PR이면 사유, 아니면 없음
  assert.equal(first({ unavailable, exclusion: null, review: null }), "no review: Codex limit — waiting for the landing review (REVIEW session)");
  assert.match(first({ unavailable, exclusion: null, security: "키워드 auth", review: null }), /security PR: security keyword auth\)/);
  assert.match(first({ unavailable, exclusion: null, security: "Risk: High", review: null }), /security PR: Risk: High\)/);
  // 한도 때 착륙 리뷰 지적(REVIEW 세션), 보안 PR이면 "security, "
  assert.equal(
    first({ unavailable, exclusion: null, security: "auth", review: lr("findings", 1) }),
    "SONNET findings (security, Codex limit, head aaaaaaa, P0 0 · P1 1 · P2 0): x — fix and get a re-review on the new head",
  );
  assert.match(first({ unavailable: { why: "silent", since: "t" }, exclusion: null, review: lr("findings", 1) }), /Codex silent for 6 hours/);
  // Codex 한도 댓글: 사람 리뷰 필요
  const limited = gh({ reviews: [], codex: { headAt: "2026-09-26T14:30:33Z", thumbsAt: null, lastComment: { at: "2026-09-26T14:40:00Z", limit: true } } });
  assert.equal(en(reviewBlocks(limited))[0], "no review: Codex limit — needs a human review");
  // Codex 지적 등급 수: 미표시 건은 P2, P3만 남아 해결·답글 없음(1건과 여러 건)
  assert.equal(codexFindingsEn("aaaaaaa", countsEn("P1 1 · P2 2", 1)), "Codex findings on head aaaaaaa (P1 1 · P2 2 (1 without a severity mark counted as P2)) — fix and get a re-review");
  assert.match(codexP3OpenEn("aaaaaaa", 3, 1), /^1 of 3 Codex P3 findings on head aaaaaaa has no resolution/);
  assert.match(codexP3OpenEn("aaaaaaa", 3, 2), /^2 of 3 Codex P3 findings on head aaaaaaa have no resolution/);
  assert.match(codexP3OpenEn("aaaaaaa", 1, 1), /^1 of 1 Codex P3 finding on head aaaaaaa has no resolution/);
  assert.equal(gateReasonEn(null), "unspecified");
});

test("en: draft · los, 정렬된 landingBlocks", () => {
  const bs = landingBlocks(gh({ isDraft: true, mergeStateStatus: "DIRTY", reviews: [] }), true);
  assert.deepEqual(bs.map((b) => b.code), ["draft", "no-review", "dirty", "los"]);
  const texts = en(bs);
  assert.equal(texts[0], "the PR is a draft");
  assert.equal(texts.at(-1), "a LOSS OF SEPARATION is open on the STAND");
});

test("en: stacked", () => {
  const pr = { number: 2, baseRefName: "feat" };
  assert.equal(stackedEn(pr, null, "main"), "stacked PR — base is not main (feat); change the base to main before it can land");
  const stack = { base: 1, chain: [1, 2] };
  assert.equal(stackedEn(pr, stack, "main"), "stacked PR — after #1 lands in main, the base moves to main (#1 → #2)");
  assert.doesNotMatch(stackedEn(pr, stack, "main"), hangul);
  assert.match(stackedText(pr, stack, "main"), hangul); // 한국어 text는 그대로
  seen.add("stacked");
});

test("en: 모든 LandingBlockCode를 다뤘다", () => {
  const all: LandingBlockCode[] = ["stacked", "draft", "checks-pending", "checks-failed", "no-checks", "no-review", "review-stale", "review-findings", "changes-requested", "behind", "dirty", "blocked", "merge-unknown", "los"];
  assert.deepEqual([...seen].sort(), [...all].sort());
});

test("한국어 text는 그대로 두고 en을 나란히 낸다", () => {
  const b = mergeBlocks("DIRTY")[0];
  assert.equal(b.text, "base와 충돌: 충돌 해결 필요");
  assert.equal(b.en, "conflicts with base: resolve the conflicts");
});

test("infoTextOf: 막힘을 ' · '로 잇고 없으면 null", () => {
  assert.equal(infoTextOf(12, ["a", "b"]), "PR #12 cannot land yet: a · b");
  assert.equal(infoTextOf(12, []), null);
});
