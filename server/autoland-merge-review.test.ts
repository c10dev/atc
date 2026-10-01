import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_AUTOLAND, mergeExclusionOf, type MergeExclusionInput, parseAutoland } from "./autoland.ts";
import { mergeReviewPassOn } from "./autoland-run.ts";
import { buildPulls, type GhPull, type MergeReview } from "./landing.ts";
import { autolandAirportOf, parseReview, ReviewError, readMergeReviews } from "./landing-review.ts";
import type { PullRequest } from "./model.ts";

// ATC-328: AUTOLAND AIRPORT에서 atc에 기록한 머지 리뷰가 이 head의 착륙 리뷰다. 시험은 가짜 저장소·가짜 기록만 쓴다.

const REPO = "/r/app";
const SLUG = "owner/app";
const HEAD = "b".repeat(40);
const OLD = "c".repeat(40);
const NOW = "2026-10-01T12:00:00Z";
const T = "2026-10-01T10:00:00Z";

const gh = (over: Partial<GhPull> = {}): GhPull => ({
  number: 7,
  title: "Pause the video when the dialog opens (APP-7)",
  url: `https://github.com/${SLUG}/pull/7`,
  headRefName: "claude/app-7",
  headRefOid: HEAD,
  baseRefName: "main",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  createdAt: T,
  author: { login: "someone" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [],
  labels: [],
  // Codex는 쓸 수 있는 상태(한도도 무응답도 아님): 머지 리뷰가 없으면 no-review
  codex: { headAt: T, thumbsAt: null, lastComment: null },
  files: ["src/player.tsx"],
  body: "Pause on dialog open.",
  ...over,
});
const rev = (over: Partial<MergeReview> = {}): MergeReview => ({
  at: "2026-10-01T11:00:00Z", repo: SLUG, number: 7, head: HEAD, verdict: "pass", text: "Meets the criteria. P2 naming", by: "REVIEW",
  model: "claude-sonnet-5-5", family: "claude-sonnet-5-5", p0: 0, p1: 0, p2: 1, ...over,
});
const build = (g: GhPull, o: { reviews?: MergeReview[]; labels?: string[]; reviewedSecurity?: "off" | "delegate"; repos?: string[] } = {}) =>
  buildPulls([{ repo: REPO, pulls: [g], defaultBranch: "main" }], [], [], new Map(), () => "APP-7", NOW, {
    silentMs: 6 * 3_600_000,
    reviews: [],
    ticketLabelsOf: () => o.labels ?? [],
    ticketTitleOf: () => null,
    autoland: { repos: o.repos ?? [REPO], reviewedSecurity: o.reviewedSecurity ?? "off", reviews: o.reviews ?? [] },
  })[0];

const codes = (p: PullRequest) => p.blocks.map((b) => b.code);

test("no record: no-review. A pass for this head clears it (CLEARED) and the line says who and the verdict", () => {
  assert.deepEqual(codes(build(gh())), ["no-review"]);
  const p = build(gh(), { reviews: [rev()] });
  assert.equal(p.landing, "CLEARED");
  assert.deepEqual(p.mergeReview, { by: "REVIEW", verdict: "pass", at: "2026-10-01T11:00:00Z", p0: 0, p1: 0, p2: 1, pass: true, carriedFrom: null });
});

test("a pass for another head does not clear it; another PR's record does not either", () => {
  assert.deepEqual(codes(build(gh(), { reviews: [rev({ head: OLD })] })), ["no-review"]);
  assert.deepEqual(codes(build(gh(), { reviews: [rev({ number: 8 })] })), ["no-review"]);
  assert.deepEqual(codes(build(gh(), { reviews: [rev({ repo: "owner/other" })] })), ["no-review"]);
});

test("findings on this head show as review-findings with the counts; the latest record for the head wins", () => {
  const f = rev({ verdict: "findings", text: "P1 race in the dialog handler", p0: 0, p1: 1, p2: 0 });
  const p = build(gh(), { reviews: [f] });
  assert.deepEqual(codes(p), ["review-findings"]);
  assert.deepEqual(p.blocks[0].findings, { source: "review", by: "REVIEW", counts: [0, 1, 0], text: "P1 race in the dialog handler", from: null });
  assert.match(p.blocks[0].en, /REVIEW merge-review findings \(head bbbbbbb, P0 0 · P1 1 · P2 0\)/);
  assert.equal(p.mergeReview?.pass, false);
  assert.equal(build(gh(), { reviews: [f, rev({ at: "2026-10-01T11:30:00Z" })] }).landing, "CLEARED");
  assert.deepEqual(codes(build(gh(), { reviews: [rev(), { ...f, at: "2026-10-01T11:30:00Z" }] })), ["review-findings"]);
});

test("only AUTOLAND AIRPORT repos: elsewhere the record is ignored", () => {
  assert.deepEqual(codes(build(gh(), { reviews: [rev()], repos: [] })), ["no-review"]);
  assert.equal(build(gh(), { reviews: [rev()], repos: [] }).mergeReview, null);
});

test("a Draft PR is not reviewed through this path", () => {
  assert.equal(build(gh({ isDraft: true }), { reviews: [rev()] }).mergeReview, null);
});

test("review carry (ATC-31): a head that only merged main keeps the review; otherwise the review is stale", () => {
  // carryFrom에는 호출한 쪽이 이미 "main 병합뿐이고 PR 자신의 변경이 같음"을 확인한 커밋만 들어온다
  const carried = build(gh({ carryFrom: [{ sha: OLD, at: "2026-10-01T09:00:00Z" }] }), { reviews: [rev({ head: OLD })] });
  assert.equal(carried.landing, "CLEARED");
  assert.deepEqual(carried.carried, { from: OLD, by: "review", findings: false });
  assert.equal(carried.mergeReview?.carriedFrom, OLD);
  assert.equal(carried.mergeReview?.pass, true);
  // main이 PR 자신의 파일을 바꿨으면 carryFrom이 비어 이어받지 않는다
  assert.deepEqual(codes(build(gh({ carryFrom: [] }), { reviews: [rev({ head: OLD })] })), ["no-review"]);
  // 이어받은 리뷰가 지적이면 지적으로 막는다
  const f = build(gh({ carryFrom: [{ sha: OLD, at: null }] }), { reviews: [rev({ head: OLD, verdict: "findings", p1: 1, p2: 0, text: "P1 x" })] });
  assert.deepEqual(codes(f), ["review-findings"]);
  assert.equal(f.mergeReview?.pass, false);
  // 이 head의 새 기록이 이어받은 지적보다 앞선다
  assert.equal(build(gh({ carryFrom: [{ sha: OLD, at: null }] }), { reviews: [rev({ head: OLD, verdict: "findings", p1: 1, text: "P1 x" }), rev()] }).landing, "CLEARED");
});

test("security gate PRs: with reviewedSecurity off the record does not count (today's exclusion); delegate counts it; secret paths never do", () => {
  const sec = ["rating:SEC"];
  assert.deepEqual(codes(build(gh(), { reviews: [rev()], labels: sec })), ["no-review"]);
  assert.equal(build(gh(), { reviews: [rev()], labels: sec, reviewedSecurity: "delegate" }).landing, "CLEARED");
  const key = gh({ files: ["src/player.tsx", "config/secrets/app.json"] });
  assert.deepEqual(codes(build(key, { reviews: [rev()], reviewedSecurity: "delegate" })), ["no-review"]);
  assert.deepEqual(codes(build(gh({ files: ["src/player.tsx"] }), { reviews: [rev()], labels: [], reviewedSecurity: "off" })), []);
});

// ── merge exclusion ──

const BASE: MergeExclusionInput = {
  held: false,
  flight: "APP-7",
  ticketLabels: ["type:bug"],
  prLabels: [],
  files: ["src/player.tsx"],
  title: "Pause the video",
  body: "## UI change\n\n- UI impact: `changes rendered UI`\n- Human check class (any that apply): `none`\n- Human check: `not needed`",
  flightTitle: "Pause the video",
  head: HEAD,
};

test("reviewedSecurity off: today's exclusions are unchanged, a review pass changes nothing", () => {
  for (const over of [{ ticketLabels: ["rating:SEC"] }, { files: ["src/lib/auth/session.ts"] }, { files: ["supabase/migrations/1.sql"] }, { files: [".env"] }, { title: "Tighten auth checks" }]) {
    const off = mergeExclusionOf({ ...BASE, ...over });
    assert.ok(off, JSON.stringify(over));
    assert.equal(mergeExclusionOf({ ...BASE, ...over, reviewedSecurity: "off", mergeReviewPass: true }), off, JSON.stringify(over));
  }
  assert.equal(mergeExclusionOf({ ...BASE, reviewedSecurity: "off", mergeReviewPass: true }), null);
});

test("delegate: a rating:SEC PR with a pass on its head and nothing else excluding it is delegated", () => {
  const sec = { ...BASE, ticketLabels: ["rating:SEC"], reviewedSecurity: "delegate" as const };
  assert.match(mergeExclusionOf({ ...sec, mergeReviewPass: false }) ?? "", /rating:SEC/); // 리뷰가 없으면 그대로
  assert.equal(mergeExclusionOf({ ...sec, mergeReviewPass: true }), null);
  assert.equal(mergeExclusionOf({ ...BASE, reviewedSecurity: "delegate", mergeReviewPass: true, files: ["src/lib/auth/session.ts"] }), null);
  assert.equal(mergeExclusionOf({ ...BASE, reviewedSecurity: "delegate", mergeReviewPass: true, title: "Tighten auth checks" }), null);
});

test("delegate: .env, key, migration and SQL paths, Risk labels, a missing FLIGHT, HOLD and HUMAN CHECK still keep the PR", () => {
  const ok = { ...BASE, ticketLabels: ["rating:SEC"], reviewedSecurity: "delegate" as const, mergeReviewPass: true };
  assert.equal(mergeExclusionOf(ok), null);
  const cases: [Partial<MergeExclusionInput>, RegExp][] = [
    [{ files: [".env.production"] }, /비밀·키/],
    [{ files: ["certs/server.pem"] }, /비밀·키/],
    [{ files: ["config/secrets/app.json"] }, /비밀·키/],
    [{ files: ["supabase/migrations/20261001_x.sql"] }, /마이그레이션/],
    [{ files: ["db/seed.sql"] }, /마이그레이션/],
    [{ files: ["db/migrations/001_init.ts"] }, /마이그레이션/],
    [{ ticketLabels: ["rating:SEC", "Risk: Rights"] }, /Risk: Rights/],
    [{ prLabels: ["Risk: Contract"] }, /Risk: Contract/],
    [{ flight: null }, /FLIGHT 없음/],
    [{ held: true }, /HOLD/],
    [{ files: null }, /파일/],
    [{ body: "## UI change\n- UI impact: `changes rendered UI`\n- Human check class (any that apply): `DEVICE`\n- Human check: `pending`" }, /HUMAN CHECK DEVICE/],
  ];
  for (const [over, re] of cases) assert.match(mergeExclusionOf({ ...ok, ...over }) ?? "", re, JSON.stringify(over));
});

// ── config ──

test("reviewedSecurity defaults to off; an unknown value falls back to off", () => {
  assert.equal(DEFAULT_AUTOLAND.reviewedSecurity, "off");
  assert.equal(parseAutoland({}).reviewedSecurity, "off");
  assert.equal(parseAutoland({ reviewedSecurity: "yes" }).reviewedSecurity, "off");
  assert.equal(parseAutoland({ reviewedSecurity: "delegate" }).reviewedSecurity, "delegate");
});

// ── record ──

const PULL = { url: `https://github.com/${SLUG}/pull/7`, number: 7, head: HEAD };
test("parseReview for a merge record: current head only, Claude Sonnet only, severities counted", () => {
  const ok = parseReview({ head: HEAD.slice(0, 7), verdict: "pass", text: "Fine. P2 nit", model: "claude-sonnet-5-5" }, PULL, NOW);
  assert.deepEqual([ok.repo, ok.number, ok.head, ok.verdict, ok.p0, ok.p1, ok.p2], [SLUG, 7, HEAD, "pass", 0, 0, 1]);
  assert.throws(() => parseReview({ head: OLD, verdict: "pass", text: "x", model: "claude-sonnet-5-5" }, PULL, NOW), (e) => e instanceof ReviewError && e.status === 409);
  assert.throws(() => parseReview({ head: HEAD, verdict: "pass", text: "x" }, PULL, NOW), (e) => e instanceof ReviewError && e.status === 400); // 모델 없음
  assert.throws(() => parseReview({ head: HEAD, verdict: "pass", text: "x", model: "claude-opus-5-5" }, PULL, NOW), (e) => e instanceof ReviewError); // Sonnet만
  assert.throws(() => parseReview({ head: HEAD, verdict: "pass", text: "P1 bug", model: "claude-sonnet-5-5" }, PULL, NOW), (e) => e instanceof ReviewError); // pass에 P1
});

test("readMergeReviews reads the append-only JSONL, skips broken lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-merge-review-"));
  try {
    const file = join(dir, "autoland-reviews.jsonl");
    assert.deepEqual(readMergeReviews(file), []);
    writeFileLines(file, [JSON.stringify(rev()), "{broken", JSON.stringify(rev({ number: 9 }))]);
    assert.deepEqual(readMergeReviews(file).map((r) => r.number), [7, 9]);
    assert.ok(readFileSync(file, "utf8").endsWith("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const writeFileLines = (file: string, lines: string[]) => writeFileSync(file, `${lines.join("\n")}\n`);

// ── the pre-merge re-check ──

test("mergeReviewPassOn: the record file must still say pass for the head (or the carried-from commit)", () => {
  const pass = rev();
  const pr = { number: 7, head: HEAD, mergeReview: { by: "REVIEW", verdict: "pass" as const, at: pass.at, p0: 0, p1: 0, p2: 1, pass: true, carriedFrom: null } };
  assert.equal(mergeReviewPassOn(SLUG, pr, [pass]), true);
  // 나중에 같은 head에 findings가 기록되면 머지 직전 확인에서 막힌다
  assert.equal(mergeReviewPassOn(SLUG, pr, [pass, rev({ verdict: "findings", p1: 1, p2: 0, text: "P1 x", at: "2026-10-01T11:40:00Z" })]), false);
  assert.equal(mergeReviewPassOn(SLUG, pr, []), false);
  assert.equal(mergeReviewPassOn(SLUG, { ...pr, mergeReview: null }, [pass]), false);
  const carried = { ...pr, mergeReview: { ...pr.mergeReview, carriedFrom: OLD } };
  assert.equal(mergeReviewPassOn(SLUG, carried, [rev({ head: OLD })]), true);
  assert.equal(mergeReviewPassOn(SLUG, carried, [pass]), false); // 이어받은 커밋의 기록이 아니다
});

// ── 기록을 받는 경로는 buildPulls와 같은 조건(mergeReviewGateOk)을 쓴다 ──

test("records are diverted to the merge-review file only for PRs buildPulls counts them for (off: no security-gate PRs; delegate: yes; hard gate: never)", () => {
  const snap = { airports: [{ code: "VCDO", repo: REPO }] } as Parameters<typeof autolandAirportOf>[0];
  const target = (g: GhPull, o: Parameters<typeof build>[1] = {}) => autolandAirportOf(snap, build(g, o));
  assert.equal(target(gh()), "VCDO");
  // off: 보안 게이트 PR은 옛 경로(assertReviewTarget, landing-reviews.jsonl) — 오늘과 같다
  assert.equal(target(gh(), { labels: ["rating:SEC"] }), null);
  assert.equal(target(gh({ files: ["src/lib/auth/session.ts"] })), null);
  assert.equal(target(gh({ body: "Tighten auth checks" })), null);
  // delegate: 보안 게이트 PR도 머지 리뷰 기록
  assert.equal(target(gh(), { labels: ["rating:SEC"], reviewedSecurity: "delegate" }), "VCDO");
  assert.equal(target(gh({ files: ["src/lib/auth/session.ts"] }), { reviewedSecurity: "delegate" }), "VCDO");
  // hard(비밀·키 경로, FLIGHT 없음)는 어느 모드에서든 아님
  assert.equal(target(gh({ files: ["config/secrets/app.json"] }), { reviewedSecurity: "delegate" }), null);
  // AUTOLAND 밖 저장소, Draft
  assert.equal(target(gh(), { repos: [] }), null);
  assert.equal(target(gh({ isDraft: true })), null);
  // 지금 PR이 그 AIRPORT 코드가 아닌 목록에 없으면(스냅샷에 AIRPORT가 없음) 아님
  assert.equal(autolandAirportOf({ airports: [] } as unknown as Parameters<typeof autolandAirportOf>[0], build(gh())), null);
});
