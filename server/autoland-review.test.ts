import assert from "node:assert/strict";
import { test } from "node:test";
import { CODEX_WAIT_MS, DEFAULT_AUTOLAND, EMPTY_STATE, escalateOf, fastTrackOf, planAutoland, type ReviewRequest, reviewRequestOf } from "./autoland.ts";
import { buildPulls, type GhPull } from "./landing.ts";
import type { LandingBlockCode, PullRequest } from "./model.ts";

// ATC-38: AUTOLAND가 갱신한 head에 리뷰가 이어지지 않으면 재리뷰를 요청한다.
// 2026-09-28 #401: 36f36a0(update-branch의 merge 커밋)에 리뷰가 이어지지 않았고 Codex도 리뷰하지 않았다.

const VCDO = "/p/vocado_nextjs";
const SLUG = "chaehy5665/vocado_nextjs";
const HEAD = "36f36a0".padEnd(40, "0");
const T0 = "2026-09-28T05:00:00.000Z";
const at = (min: number) => Date.parse(T0) + min * 60_000;

const pr = (blocks: LandingBlockCode[], over: Partial<PullRequest> = {}): PullRequest => ({
  repo: VCDO,
  number: 401,
  title: "Record the staging-only album artwork migrations (VOC-174)",
  url: `https://github.com/${SLUG}/pull/401`,
  branch: "claude/voc-174",
  head: HEAD,
  base: "main",
  ticketKey: "VOC-174",
  standPath: null,
  draft: false,
  landing: blocks.length ? "APPROACH" : "CLEARED",
  blocks: blocks.map((code) => ({ code, text: code })),
  readyAt: null,
  createdAt: "2026-09-27T00:00:00Z",
  codexUnavailable: null,
  externalExclusion: null,
  ...over,
});
const LIMIT = { why: "limit" as const, since: T0 };

test("carried: the update's review carried over (CLEARED, or no review block) → no request", () => {
  assert.equal(reviewRequestOf(pr([]), SLUG, [], T0), null);
  assert.equal(reviewRequestOf(pr(["checks-failed"]), SLUG, [], T0), null);
});

test("not carried, Codex available → one @codex review request (via codex)", () => {
  for (const code of ["no-review", "review-stale"] as const) {
    const r = reviewRequestOf(pr([code]), SLUG, [], T0);
    assert.equal(r?.via, "codex", code);
    assert.equal(r?.head, HEAD);
    assert.equal(r?.slug, SLUG);
  }
});

test("not carried, Codex limited → straight to the DeepSeek queue", () => {
  const r = reviewRequestOf(pr(["no-review"], { codexUnavailable: LIMIT }), SLUG, [], T0);
  assert.equal(r?.via, "deepseek");
  assert.equal(r?.reason, "Codex 한도");
});

test("no Codex response within 30 minutes → DeepSeek; before that, keep waiting", () => {
  const r = reviewRequestOf(pr(["no-review"]), SLUG, [], T0)!;
  assert.equal(escalateOf(r, pr(["no-review"]), at(29)), null);
  const e = escalateOf(r, pr(["no-review"]), at(30));
  assert.equal(e?.via, "deepseek");
  assert.equal(e?.reason, "Codex 30분 무응답");
  assert.equal(e?.escalatedAt, new Date(at(30)).toISOString());
  assert.equal(CODEX_WAIT_MS, 30 * 60_000);
  // 한도 댓글이 오면 30분을 기다리지 않는다
  assert.equal(escalateOf(r, pr(["no-review"], { codexUnavailable: LIMIT }), at(2))?.via, "deepseek");
});

test("Codex answered, head moved or PR closed → no escalation", () => {
  const r = reviewRequestOf(pr(["no-review"]), SLUG, [], T0)!;
  assert.equal(escalateOf(r, pr([]), at(40)), null); // 👍로 CLEARED
  assert.equal(escalateOf(r, pr(["review-findings"]), at(40)), null); // Codex 지적
  assert.equal(escalateOf(r, pr(["no-review"], { head: "f".repeat(40) }), at(40)), null);
  assert.equal(escalateOf(r, undefined, at(40)), null);
  assert.equal(escalateOf({ ...r, via: "deepseek" }, pr(["no-review"]), at(40)), null); // 이미 넘김
});

test("never twice for the same head; a new head can be asked again", () => {
  const r = reviewRequestOf(pr(["no-review"]), SLUG, [], T0)!;
  assert.equal(reviewRequestOf(pr(["no-review"]), SLUG, [r], T0), null);
  assert.equal(reviewRequestOf(pr(["review-stale"], { codexUnavailable: LIMIT }), SLUG, [{ ...r, via: "deepseek" }], T0), null);
  assert.equal(reviewRequestOf(pr(["no-review"], { head: "e".repeat(40) }), SLUG, [r], T0)?.via, "codex");
});

test("excluded from external review → not sent to DeepSeek; SUPERVISOR review", () => {
  const excluded = { externalExclusion: "migrations" };
  const r = reviewRequestOf(pr(["no-review"], { ...excluded, codexUnavailable: LIMIT }), SLUG, [], T0);
  assert.equal(r?.via, "supervisor");
  assert.match(r?.reason ?? "", /외부 리뷰 제외\(migrations\)/);
  const c = reviewRequestOf(pr(["no-review"], excluded), SLUG, [], T0)!;
  assert.equal(c.via, "codex"); // Codex는 보안 PR도 리뷰한다
  assert.equal(escalateOf(c, pr(["no-review"], excluded), at(31))?.via, "supervisor");
});

// ── buildPulls: DeepSeek로 넘긴 head는 6시간을 기다리지 않는다. 외부 리뷰 제외는 그대로 ──

const gh = (over: Partial<GhPull> = {}): GhPull => ({
  number: 401,
  title: "Record the staging-only album artwork (VOC-174)",
  url: `https://github.com/${SLUG}/pull/401`,
  headRefName: "claude/voc-174",
  headRefOid: HEAD,
  baseRefName: "main",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  createdAt: "2026-09-27T00:00:00Z",
  author: { login: "chaehy5665" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [],
  labels: [],
  body: "",
  files: ["src/app/album/page.tsx"],
  // head는 05:00에 생겼고 Codex는 그 뒤 말이 없다(6시간이 안 됨)
  codex: { headAt: T0, thumbsAt: null, lastComment: null },
  ...over,
});
const build = (g: GhPull, fast: string | null, now = at(45)) =>
  buildPulls([{ repo: VCDO, pulls: [g], defaultBranch: "main" }], [], [], new Map(), () => "VOC-174", new Date(now).toISOString(), {
    silentMs: 6 * 3_600_000,
    reviews: [],
    ticketLabelsOf: () => [],
    ticketTitleOf: () => null,
    fastTrack: () => fast,
  })[0];

test("buildPulls: a head AUTOLAND handed over goes to the REVIEW queue without the 6 h wait", () => {
  const before = build(gh(), null);
  assert.equal(before.codexUnavailable, null);
  assert.equal(before.extReview, null);
  assert.equal(before.externalExclusion, null);
  const p = build(gh(), new Date(at(31)).toISOString());
  assert.deepEqual(p.codexUnavailable, { why: "autoland", since: new Date(at(31)).toISOString() });
  assert.equal(p.extReview?.status, "waiting");
  assert.match(p.blocks.map((b) => b.text).join(" "), /AUTOLAND 재리뷰 — Codex 30분 무응답/);
});

test("buildPulls: if Codex answered after the head, the hand-over does nothing", () => {
  const thumbs = gh({ codex: { headAt: T0, thumbsAt: new Date(at(20)).toISOString(), lastComment: null } });
  const p = build(thumbs, new Date(at(31)).toISOString());
  assert.equal(p.codexUnavailable, null);
  assert.equal(p.landing, "CLEARED");
});

test("buildPulls: an excluded PR handed over is not queued for DeepSeek (ATC-27/30 unchanged)", () => {
  const p = build(gh({ files: ["supabase/migrations/20260928_album.sql"] }), new Date(at(31)).toISOString());
  assert.equal(p.externalExclusion, "migrations");
  assert.equal(p.extReview?.status, "excluded");
  assert.match(p.blocks.map((b) => b.text).join(" "), /외부 리뷰 제외\(migrations\) — Codex나 SUPERVISOR 리뷰 필요/);
});

test("fastTrackOf: only heads handed away from Codex", () => {
  const base: ReviewRequest = { repo: VCDO, slug: SLUG, number: 401, head: HEAD, at: T0, via: "codex" };
  assert.equal(fastTrackOf([base])(VCDO, 401, HEAD), null);
  assert.equal(fastTrackOf([{ ...base, via: "deepseek", escalatedAt: "x" }])(VCDO, 401, HEAD), "x");
  assert.equal(fastTrackOf([{ ...base, via: "supervisor" }])(VCDO, 401, HEAD), T0);
  assert.equal(fastTrackOf([{ ...base, via: "deepseek" }])(VCDO, 401, "other"), null);
});

// ── 착륙 스트립 ──

test("strip: 'AUTOLAND: review requested (codex|deepseek)', or SUPERVISOR review for an excluded PR", () => {
  const cfg = { ...DEFAULT_AUTOLAND, mode: "update" as const };
  const req: ReviewRequest = { repo: VCDO, slug: SLUG, number: 401, head: HEAD, at: T0, via: "codex" };
  const tag = (p: PullRequest, r: ReviewRequest) =>
    planAutoland({ cfg, airports: [{ code: "VCDO", repo: VCDO }], pulls: [p], st: { ...structuredClone(EMPTY_STATE), reviewRequests: [r] }, exclusionOf: () => null }).pulls[`${VCDO}#401`];
  assert.deepEqual(tag(pr(["no-review"]), req), { kind: "review", text: "AUTOLAND: review requested (codex)" });
  assert.deepEqual(tag(pr(["no-review"]), { ...req, via: "deepseek" }), { kind: "review", text: "AUTOLAND: review requested (deepseek)" });
  assert.deepEqual(tag(pr(["no-review"], { externalExclusion: "migrations" }), { ...req, via: "supervisor" }), {
    kind: "supervisor",
    text: "AUTOLAND: SUPERVISOR 리뷰 필요 — 외부 리뷰 제외(migrations)",
  });
  // 리뷰가 붙으면 표시가 사라진다
  assert.equal(tag(pr([]), req), undefined);
});
