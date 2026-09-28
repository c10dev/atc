import assert from "node:assert/strict";
import { test } from "node:test";
import { delegationOf, foldLander, landerGateOf, outcomeOf, reviewOf, stateFormatHints, verdictOf } from "./lander.mjs";

const pr = (over = {}) => ({
  number: 7,
  head: "abc1234",
  base: "main",
  draft: false,
  crossRepo: false,
  author: "owner",
  labels: [],
  body: "",
  additions: 10,
  deletions: 2,
  files: ["web/src/views/Fleet.tsx", "docs/guide/fleet.md"],
  checks: [{ name: "check", conclusion: "SUCCESS" }],
  mergeable: "MERGEABLE",
  ...over,
});
const passed = { ok: true, verdict: "pass" };
const ctx = (over = {}) => ({ owner: "owner", diff: "", review: passed, ...over });
const codes = (d) => d.reasons.map((r) => r.code);
const allOk = { merge: true, test: true, tsc: true, build: true, note: null };

test("맡는 범위: auto 등급, 이 저장소, 소유자, CI 통과, 충돌 없음이면 사유 없음", () => {
  const d = delegationOf(pr(), ctx());
  assert.deepEqual(codes(d), []);
  assert.equal(d.tier, "auto");
  assert.deepEqual(verdictOf(d, allOk), { verdict: "would-merge", reasons: [], readyExceptReview: true });
});

test("맡지 않음: fork, 다른 작성자, draft, hold, base, CI, 충돌", () => {
  const d = delegationOf(
    pr({ crossRepo: true, author: "stranger", draft: true, labels: ["HOLD"], base: "dev", checks: [{ name: "check", conclusion: "FAILURE" }], mergeable: "CONFLICTING" }),
    ctx(),
  );
  assert.deepEqual(codes(d), ["base", "fork", "author", "draft", "hold", "ci", "conflict"]);
  assert.match(delegationOf(pr({ checks: [] }), ctx()).reasons[0].text, /CI check 없음/);
});

test("등급: flagged·user는 맡지 않는다(이유에 등급 근거)", () => {
  assert.match(delegationOf(pr({ files: ["occ/CLAUDE.md"] }), ctx()).reasons[0].text, /^등급 flagged/);
  assert.match(delegationOf(pr({ files: ["deploy/lander.mjs"] }), ctx()).reasons[0].text, /^등급 user\(배포·등급 규칙\)/);
});

test("제외 경로: 착륙·AUTOLAND·스위치·FLEET PLAN·세션 조종 코드는 auto 등급이어도 맡지 않는다", () => {
  const d = delegationOf(pr({ files: ["server/landing-review.ts", "server/autoland-run.ts", "server/fleet-plan.ts", "web/src/x.tsx"] }), ctx());
  assert.deepEqual(codes(d), ["excluded"]);
  assert.match(d.reasons[0].text, /착륙 판단, AUTOLAND, FLEET PLAN 승인/);
});

test("운영 상태 형식의 흔적: 상태 파일 경로, 기록 줄 타입. 테스트 파일과 server 밖은 보지 않는다", () => {
  const diff = [
    "+++ b/server/foo.ts",
    '+const FILE = join(config.stateDir, "foo.jsonl");',
    "+export type FooOp = { op: string };",
    "+++ b/server/foo.test.ts",
    '+const F = join(config.stateDir, "x.json");',
    "+++ b/web/src/a.ts",
    "+type BarOp = {};",
  ].join("\n");
  assert.deepEqual(stateFormatHints(diff), ["server/foo.ts: 상태 파일 경로", "server/foo.ts: 기록 줄 타입"]);
  assert.deepEqual(codes(delegationOf(pr(), ctx({ diff }))), ["state"]);
});

test("본문의 SELF-LANDING: no와 크기 제한", () => {
  assert.deepEqual(codes(delegationOf(pr({ body: "요약\n\nSELF-LANDING: no\n" }), ctx())), ["opt-out"]);
  assert.deepEqual(codes(delegationOf(pr({ additions: 1400, deletions: 101 }), ctx())), ["size"]);
});

test("리뷰: 정확한 head의 마지막 기록이 P0·P1 없는 pass여야", () => {
  const reviews = [
    { repo: "o/atc", number: 7, head: "abc1234", verdict: "findings", p0: 0, p1: 1 },
    { repo: "o/atc", number: 7, head: "abc1234", verdict: "pass", p0: 0, p1: 0, family: "deepseek-v4.1-flash" },
    { repo: "o/atc", number: 7, head: "old0000", verdict: "pass", p0: 0, p1: 0 },
  ];
  assert.equal(reviewOf(reviews, "o/atc", 7, "abc1234").ok, true);
  assert.deepEqual(reviewOf(reviews, "o/atc", 7, "zzz"), { ok: false, verdict: null, family: null });
  assert.equal(reviewOf(reviews.slice(0, 1), "o/atc", 7, "abc1234").ok, false);
});

test("verdictOf: 리뷰가 없으면 would-skip이지만 리뷰만 빠진 것은 readyExceptReview. 로컬 확인 실패도 사유", () => {
  const noReview = delegationOf(pr(), ctx({ review: { ok: false, verdict: null } }));
  assert.deepEqual(verdictOf(noReview, allOk), { verdict: "would-skip", reasons: [{ code: "review", text: "head에 착륙 리뷰 없음" }], readyExceptReview: true });
  const v = verdictOf(delegationOf(pr(), ctx()), { ...allOk, test: false, note: null });
  assert.equal(v.verdict, "would-skip");
  assert.equal(v.readyExceptReview, false);
  assert.equal(v.reasons[0].text, "로컬 확인 실패: test");
  // 다른 사유가 있으면 로컬 확인을 하지 않는다(checks null) — would-skip, 준비 아님
  assert.deepEqual(verdictOf(delegationOf(pr({ draft: true }), ctx()), null).verdict, "would-skip");
});

test("outcomeOf: 판정한 head 그대로 머지, 바뀐 뒤 머지, 닫힘, 아직 열림", () => {
  assert.equal(outcomeOf("MERGED", "abc", "abc"), "merged-as-is");
  assert.equal(outcomeOf("MERGED", "def", "abc"), "merged-changed");
  assert.equal(outcomeOf("CLOSED", "abc", "abc"), "closed");
  assert.equal(outcomeOf("OPEN", "abc", "abc"), null);
});

const ev = (pr, verdict, over = {}) => ({ op: "evaluate", pr, head: "h", tier: "auto", verdict, readyExceptReview: verdict === "would-merge", reasons: [], ...over });
const out = (pr, outcome) => ({ op: "outcome", pr, outcome });

test("foldLander: PR마다 마지막 판정, 결과 뒤의 판정은 무시", () => {
  const x = foldLander([ev(1, "would-skip"), ev(1, "would-merge", { head: "h2" }), out(1, "merged-as-is"), ev(1, "would-skip", { head: "h3" })]);
  assert.equal(x[0].last.head, "h2");
  assert.equal(x[0].outcome.outcome, "merged-as-is");
});

test("landerGateOf: 맞음·거절·리뷰만 빠짐을 세고 20건·90%·거절 0이면 준비", () => {
  const lines = [];
  for (let n = 1; n <= 18; n++) lines.push(ev(n, "would-merge"), out(n, "merged-as-is"));
  lines.push(ev(19, "would-skip", { tier: "user" }), out(19, "merged-as-is")); // 사람 등급 — 맞음
  lines.push(ev(20, "would-skip", { readyExceptReview: true }), out(20, "merged-as-is")); // 리뷰만 빠짐 — 틀림
  let g = landerGateOf(lines);
  assert.deepEqual([g.decided, g.agreed, g.refused, g.reviewOnly, g.ready], [20, 19, 0, 1, true]);
  lines.push(ev(21, "would-merge"), out(21, "merged-changed")); // structure가 고치게 한 PR에 would-merge — 거절
  g = landerGateOf(lines);
  assert.deepEqual([g.decided, g.refused, g.ready], [21, 1, false]);
});
