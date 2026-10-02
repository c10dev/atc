import assert from "node:assert/strict";
import { test } from "node:test";
import { landTextOf } from "./controller.ts";
import { codexFindingSummaryOf, codexHeadFindingsOf, findingSeverityOf, type GhPull, type GhThread, landingBlocks, mergeBlocks } from "./landing.ts";

// vocado #394(2026-09-27) 모양 그대로: Codex가 리뷰할 때마다 더 작은 지적(P2 → P3)을 새로 찾았다
const H = {
  c1: "946aa264bafc6f7b2d2abd98d47c7265148e5593",
  c2: "2d4aca99821e069a408d582c4f83fae6990ca958",
  c3: "b25b164031e1fc5c66fc16622ee93ed09147d91d",
  head: "b1c684ca835ba2f009f879df276ed3f987d7897b",
};
const CODEX = "chatgpt-codex-connector";
const badge = (p: string) => `**<sub><sub>![${p} Badge](https://img.shields.io/badge/${p}-${p === "P2" ? "yellow" : "lightgrey"}?style=flat)</sub></sub>  `;
const thread = (resolved: boolean, commit: string, first: string, reply?: string, outdated = false, path = "src/styles/seed.css"): GhThread => ({
  resolved,
  outdated,
  path,
  comments: [
    { author: CODEX, at: "2026-09-27T14:09:03Z", commit, body: first },
    ...(reply ? [{ author: "chaehy5665", at: "2026-09-27T14:20:00Z", commit, body: reply }] : []),
  ],
});
const REAL_THREADS: GhThread[] = [
  thread(true, H.c1, `${badge("P3")}Resolve duplicate view parameters consistently`, "Fixed in e644ee5", true, "src/app/[locale]/(web)/song/[slug]/loading.tsx"),
  thread(true, H.c2, `${badge("P2")}Match the list fallback's content width`, "Fixed in b25b164"),
  thread(true, H.c3, `${badge("P3")}Align the list fallback with the mobile gutters`, "Fixed in b1c684c"),
  thread(false, H.head, `${badge("P2")}Keep unavailable songs on the song-shaped fallback`, undefined, false, "src/app/[locale]/(web)/song/[slug]/loading.tsx"),
  thread(false, H.head, `${badge("P3")}Include safe-area insets in the mobile list gutter`),
];
const review = (commit: string, at: string, login = CODEX) => ({ author: { login }, state: "COMMENTED", submittedAt: at, commit: { oid: commit } });
const pr394 = (threads: GhThread[] | undefined, over: Partial<GhPull> = {}): GhPull => ({
  number: 394,
  title: "Match the song route's loading fallback to the view the page will render (VOC-178)",
  url: "https://github.com/chaehy5665/vocado_nextjs/pull/394",
  headRefName: "claude/voc-178-loading-fallback",
  headRefOid: H.head,
  baseRefName: "main",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  createdAt: "2026-09-27T10:00:00Z",
  author: { login: "chaehy5665" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [
    review(H.c1, "2026-09-27T11:09:52Z"), review(H.c2, "2026-09-27T13:03:26Z", "chaehy5665"), review(H.c2, "2026-09-27T13:35:08Z"),
    review(H.c3, "2026-09-27T13:59:47Z"), review(H.c3, "2026-09-27T14:05:53Z", "chaehy5665"), review(H.head, "2026-09-27T14:09:03Z"),
  ],
  codex: { headAt: "2026-09-27T14:05:00Z", thumbsAt: null, lastComment: null },
  threads,
  ...over,
});
const codes = (pr: GhPull) => landingBlocks(pr, false).map((b) => b.code);
const text = (pr: GhPull, code: string) => landingBlocks(pr, false).find((b) => b.code === code)?.text ?? "";

test("등급 배지: Codex 인라인 지적의 P0~P3을 읽고, 없으면 null(요약에서 P2로 본다)", () => {
  for (const p of ["P0", "P1", "P2", "P3"]) assert.equal(findingSeverityOf(`${badge(p)}제목`), Number(p[1]));
  assert.equal(findingSeverityOf("see https://img.shields.io/badge/P1-orange?style=flat"), 1);
  assert.equal(findingSeverityOf("**Consider caching this value**"), null);
  assert.equal(findingSeverityOf("P3 in plain words is not a badge"), null);
});

test("#394 실제 모양: head에 P2 1건·P3 1건(둘 다 미해결) — P2가 있으니 막고, 이전 커밋 지적은 세지 않는다. BLOCKED면 해결 안 된 스레드 수를 보인다", () => {
  const found = codexHeadFindingsOf(pr394(REAL_THREADS))!;
  assert.deepEqual(found.map((f) => [f.severity, f.resolved, f.answered]), [[2, false, false], [3, false, false]]);
  const pr = pr394(REAL_THREADS, { mergeStateStatus: "BLOCKED" });
  assert.deepEqual(codes(pr), ["review-findings", "blocked"]);
  assert.equal(text(pr, "review-findings"), "Codex 지적 있음(head b1c684c, P2 1 · P3 1) — 반영 후 재리뷰 필요");
  assert.equal(text(pr, "blocked"), "GitHub 보호 규칙이 머지를 막음 — 해결 안 된 리뷰 스레드 2개(스레드 해결 필수: resolve해야 머지된다)");
  assert.equal(mergeBlocks("BLOCKED")[0].text, "GitHub 보호 규칙이 머지를 막음"); // 스레드를 못 읽었으면 예전 글
});

test("P3만: 모두 해결·답글이면 CLEARED(요약 ok, LAND 글에 남은 P3), 해결도 답글도 없는 P3가 있으면 막는다", () => {
  const p3 = (resolved: boolean, reply?: string) => thread(resolved, H.head, `${badge("P3")}Include safe-area insets`, reply);
  // 해결됨 2건
  const cleared = pr394([...REAL_THREADS.slice(0, 3), p3(true, "Will follow up in VOC-190"), p3(true)]);
  assert.deepEqual(codes(cleared), []);
  const sum = codexFindingSummaryOf(codexHeadFindingsOf(cleared)!);
  assert.deepEqual(sum, { p0: 0, p1: 0, p2: 0, p3: 2, unmarked: 0, open: 0, ok: true });
  assert.equal(landTextOf(1, "VCDO", 394, "VOC178", null, sum.p3), "LANDING sequence 1 (VCDO): PR #394 (VOC178). Clear to LAND now. Check that base is current before you merge. Codex P3 findings left: 2. They are resolved or answered. They do not block landing.");
  // 답글만 있고 미해결: atc는 막지 않지만 GitHub "스레드 해결 필수"가 BLOCKED로 막는다 — 그 까닭을 보인다
  const answered = pr394([p3(false, "Out of scope; tracked in VOC-190")], { mergeStateStatus: "BLOCKED" });
  assert.deepEqual(codes(answered), ["blocked"]);
  assert.match(text(answered, "blocked"), /해결 안 된 리뷰 스레드 1개/);
  // 해결도 답글도 없음
  const open = pr394([p3(false), p3(true)]);
  assert.deepEqual(codes(open), ["review-findings"]);
  assert.equal(text(open, "review-findings"), "Codex P3 지적 2건 중 1건이 해결·답글 없음(head b1c684c) — 스레드를 resolve하거나 답글을 달면 P3는 착륙을 막지 않음");
});

test("섞임·등급 없음·스레드 못 읽음: P2+P3(모두 해결)도 막고, 표시 없는 지적은 P2로 보고, 스레드를 못 읽었거나 인라인 지적이 없으면 예전처럼 막는다", () => {
  const mixed = pr394([thread(true, H.head, `${badge("P2")}a`, "fixed?"), thread(true, H.head, `${badge("P3")}b`)]);
  assert.deepEqual(codes(mixed), ["review-findings"]);
  assert.match(text(mixed, "review-findings"), /P2 1 · P3 1/);
  const p1 = pr394([thread(true, H.head, `${badge("P1")}x`)]);
  assert.match(text(p1, "review-findings"), /P1 1/);
  const unmarked = pr394([thread(true, H.head, "**Consider caching this value**", "done"), thread(true, H.head, `${badge("P3")}b`)]);
  assert.deepEqual(codes(unmarked), ["review-findings"]);
  assert.equal(text(unmarked, "review-findings"), "Codex 지적 있음(head b1c684c, P2 1 · P3 1 (등급 표시 없는 1건은 P2로 봄)) — 반영 후 재리뷰 필요");
  assert.deepEqual(codexFindingSummaryOf(codexHeadFindingsOf(unmarked)!).unmarked, 1);
  // 스레드를 아직 못 읽음 / 이전 커밋 스레드만 있음(head 리뷰는 본문뿐)
  for (const pr of [pr394(undefined), pr394(REAL_THREADS.slice(0, 3))]) assert.equal(text(pr, "review-findings"), "Codex 지적 있음(head b1c684c) — 반영 후 재리뷰 필요");
  // Codex 👍가 지적 뒤에 오면 예전처럼 통과(등급과 상관없이)
  const thumbs = pr394(REAL_THREADS, { codex: { headAt: "2026-09-27T14:05:00Z", thumbsAt: "2026-09-27T14:30:00Z", lastComment: null } });
  assert.deepEqual(codes(thumbs), []);
});
