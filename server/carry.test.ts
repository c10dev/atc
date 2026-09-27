import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPulls, type CarryCandidate, carriedReviewOf, type GhPull, type LandingReview, mergeOnlyChain, sameChange } from "./landing.ts";

// vocado #394(2026-09-27)의 실제 커밋·부모·시각. c12b706·18700c1·7a78711은 origin/main 병합이다.
const full = (s: string) => s.padEnd(40, "0");
const C = (sha: string, parents: string[], at: string) => ({ sha: full(sha), parents: parents.map(full), at });
const COMMITS = [
  C("b1c684c", ["b25b164"], "2026-09-27T14:05:51Z"),
  C("adf6601", ["b1c684c"], "2026-09-27T14:17:27Z"),
  C("ccd3c40", ["adf6601"], "2026-09-27T14:41:47Z"), // 사람이 쓴 커밋("Stack the list fallback like the loaded Home view")
  C("18700c1", ["ccd3c40", "9a49e6c"], "2026-09-27T14:44:44Z"), // main 병합
  C("c12b706", ["18700c1", "6cf99ea"], "2026-09-27T16:26:17Z"), // main 병합
  C("7a78711", ["c12b706", "d8b72ee"], "2026-09-27T16:46:18Z"), // main 병합
];
const MAIN = new Set(["9a49e6c", "6cf99ea", "d8b72ee"].map(full));
const inMain = async (sha: string) => MAIN.has(sha);
// compare(main...X)의 바뀐 파일과 blob(실제 값). adf6601은 blob 4개가 다르고(그 뒤 ccd3c40이 고침), ccd3c40부터는 같다
const SAME = new Map([
  ["messages/en.json", "modified:d1f3ff9"], ["messages/ko.json", "modified:2805998"], ["src/app/[locale]/(web)/song/[slug]/loading.tsx", "modified:c784ac7"],
  ["src/app/[locale]/(web)/song/[slug]/song-route-skeleton.tsx", "added:8504833"], ["src/styles/seed.css", "modified:6f8511f"],
  ["tests/song-ko-fallbacks.test.ts", "modified:89c2ff4"], ["tooling/design-system/seed-safe-area.ts", "modified:a43e897"],
]);
const ADF = new Map([...SAME, ["src/app/[locale]/(web)/song/[slug]/song-route-skeleton.tsx", "added:3d91eb4"], ["src/styles/seed.css", "modified:c19a3e1"], ["tests/song-ko-fallbacks.test.ts", "modified:2c4fc1a"], ["tooling/design-system/seed-safe-area.ts", "modified:670a0de"]]);
const CHANGE: Record<string, Map<string, string>> = { [full("adf6601")]: ADF, [full("ccd3c40")]: SAME, [full("18700c1")]: SAME, [full("c12b706")]: SAME, [full("7a78711")]: SAME };
async function candidates(head: string, change = CHANGE): Promise<CarryCandidate[]> {
  const chain = await mergeOnlyChain(COMMITS, full(head), inMain);
  return chain.filter((r) => sameChange(change[r.sha] ?? null, change[full(head)] ?? null));
}

const pr = (head: string, carryFrom: CarryCandidate[], over: Partial<GhPull> = {}): GhPull => ({
  number: 394, title: "Match the song route's loading fallback to the view the page will render (VOC-171)", url: "https://github.com/chaehy5665/vocado_nextjs/pull/394",
  headRefName: "claude/voc-171-route-fallback-view", headRefOid: full(head), baseRefName: "main", isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: null,
  createdAt: "2026-09-26T02:13:24Z", author: { login: "chaehy5665" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [], labels: [], body: "", files: ["src/styles/seed.css"], carryFrom,
  // Codex 한도(착륙 리뷰가 쓰이는 때)
  codex: { headAt: "2026-09-27T16:26:17Z", thumbsAt: null, lastComment: { at: "2026-09-27T16:27:00Z", limit: true } },
  ...over,
});
const deepseek = (head: string, over: Partial<LandingReview> = {}): LandingReview => ({
  at: "2026-09-27T14:54:09Z", repo: "chaehy5665/vocado_nextjs", number: 394, head: full(head), verdict: "pass", text: "OK. P2 x", by: "REVIEW",
  model: "claude-ocx-opencode-go--deepseek-v4.1-flash", family: "deepseek-v4.1-flash", p0: 0, p1: 0, p2: 1, ...over,
});
const build = (g: GhPull, reviews: LandingReview[] = [], labels: string[] = []) =>
  buildPulls([{ repo: "/r/vocado_nextjs", pulls: [g], defaultBranch: "main" }], [], [], new Map(), () => "VOC-171", "2026-09-27T16:30:00Z", {
    silentMs: 6 * 3_600_000, reviews, ticketLabelsOf: () => labels, ticketTitleOf: () => null,
  })[0];

test("#394 실제 모양: c12b706(main 병합만)은 18700c1의 DeepSeek pass를 잇는다 — CLEARED, REVIEW 대기열에 넣지 않는다", async () => {
  const from = await candidates("c12b706");
  assert.deepEqual(from.map((r) => r.sha.slice(0, 7)), ["18700c1", "ccd3c40"]); // ccd3c40 뒤로는 main 병합뿐이고 변경이 같다
  const p = build(pr("c12b706", from), [deepseek("18700c1")]);
  assert.equal(p.landing, "CLEARED");
  assert.deepEqual(p.carried, { from: full("18700c1"), by: "deepseek", findings: false });
  assert.equal(p.extReview, null); // 한도여도 이어받았으니 REVIEW가 돌지 않는다
  // 7a78711(또 main 병합)도 c12b706의 pass를 잇는다
  assert.equal(build(pr("7a78711", await candidates("7a78711")), [deepseek("c12b706")]).landing, "CLEARED");
});

test("adf6601 → c12b706은 잇지 않는다: 사이에 사람이 쓴 커밋(ccd3c40)이 있고 바뀐 파일의 blob도 다르다", async () => {
  const from = await candidates("c12b706");
  assert.ok(!from.some((r) => r.sha === full("adf6601")));
  const p = build(pr("c12b706", from), [deepseek("adf6601")]);
  assert.equal(p.landing, "APPROACH");
  assert.equal(p.carried, null);
  assert.equal(p.extReview?.status, "waiting"); // 새 리뷰가 필요하다
});

test("사람이 쓴 커밋이 head면 잇지 않고(review-stale), 충돌을 풀어 PR 파일이 달라진 main 병합도 잇지 않는다", async () => {
  // head가 ccd3c40(사람이 쓴 커밋): 사슬이 없다
  assert.deepEqual(await mergeOnlyChain(COMMITS, full("ccd3c40"), inMain), []);
  const stale = build(pr("ccd3c40", [], { reviews: [{ author: { login: "reviewer" }, state: "APPROVED", submittedAt: "2026-09-27T14:30:00Z", commit: { oid: full("adf6601") } }], codex: undefined }));
  assert.equal(stale.blocks.find((b) => b.code === "review-stale")?.code, "review-stale");
  // 18700c1 병합에서 충돌을 풀어 seed.css의 blob이 바뀜 → ccd3c40의 리뷰를 잇지 않는다
  const conflicted = { ...CHANGE, [full("18700c1")]: new Map([...SAME, ["src/styles/seed.css", "modified:ffff000"]]), [full("c12b706")]: new Map([...SAME, ["src/styles/seed.css", "modified:ffff000"]]) };
  const from = await candidates("c12b706", conflicted);
  assert.deepEqual(from.map((r) => r.sha.slice(0, 7)), ["18700c1"]); // 병합 뒤 커밋만 같다
  assert.equal(build(pr("c12b706", from), [deepseek("ccd3c40")]).carried, null);
  // main이 아닌 곳을 병합했으면 사슬이 끊긴다
  assert.deepEqual(await mergeOnlyChain(COMMITS, full("c12b706"), async () => false), []);
  assert.equal(sameChange(null, SAME), false); // 300개 한도나 오류로 못 읽음
});

test("무엇을 잇나: 사람 APPROVED, R 뒤 Codex 👍, DeepSeek pass. R의 지적은 지적으로 남는다", async () => {
  const from = await candidates("c12b706");
  // 사람 APPROVED(작성자·Codex 아님)
  const human = build(pr("c12b706", from, { reviews: [{ author: { login: "reviewer" }, state: "APPROVED", submittedAt: "2026-09-27T15:00:00Z", commit: { oid: full("18700c1") } }] }));
  assert.deepEqual([human.landing, human.carried?.by], ["CLEARED", "human"]);
  // Codex 👍가 R(18700c1) 뒤에 달림
  const thumbs = pr("c12b706", from, { codex: { headAt: "2026-09-27T16:26:17Z", thumbsAt: "2026-09-27T15:10:00Z", lastComment: null } });
  assert.deepEqual(carriedReviewOf(thumbs, [], true), { from: full("18700c1"), by: "codex", findings: false });
  // R에 Codex 지적(뒤 👍 없음) → 지적으로 이어진다
  const codexFound = build(pr("c12b706", from, { reviews: [{ author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: "2026-09-27T15:05:00Z", commit: { oid: full("18700c1") } }] }));
  assert.equal(codexFound.landing, "APPROACH");
  assert.equal(codexFound.blocks.find((b) => b.code === "review-findings")!.text, "Codex 지적이 이전 커밋 18700c1에 남아 있음(그 뒤 main 병합만) — 반영 후 재리뷰 필요");
  // R의 DeepSeek 지적
  const dsFound = build(pr("c12b706", from), [deepseek("18700c1", { verdict: "findings", text: "P1 x", p1: 1, p2: 0 })]);
  assert.match(dsFound.blocks.find((b) => b.code === "review-findings")!.text, /^DEEPSEEK 지적이 이전 커밋 18700c1에 남아 있음/);
  // Muse 기록은 잇지 않는다(착륙 리뷰는 DeepSeek만)
  assert.equal(carriedReviewOf(pr("c12b706", from), [{ ...deepseek("18700c1"), family: "muse-spark-1.3" }], true), null);
});

test("외부 리뷰에서 빠진 보안 PR은 이전 DeepSeek pass를 잇지 않고 제외 그대로", async () => {
  const from = await candidates("c12b706");
  const p = build(pr("c12b706", from, { files: ["supabase/migrations/1.sql"] }), [deepseek("18700c1")]);
  assert.equal(p.carried, null);
  assert.deepEqual([p.extReview?.status, p.extReview?.reason, p.landing], ["excluded", "migrations", "APPROACH"]);
});
