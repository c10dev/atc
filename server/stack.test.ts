import assert from "node:assert/strict";
import { test } from "node:test";
import { landTextOf } from "./controller.ts";
import { followingOf } from "./following.ts";
import { buildPulls, firstReach, fixesKeyOf, type GhPull, MERGED_TARGET_MAX, type MergedElsewhere, reachTargetsOf, stackOf, strandedMessage, strandedOf } from "./landing.ts";
import type { Ticket } from "./model.ts";

// 2026-09-27 vocado VOC-189/190 스택 그대로: #395(→ main) ← #396 ← #397 ← #398. 14:41에 아래에서부터 각자 바로 아래 브랜치로 squash 머지
const B = {
  s395: "claude/voc-189-replay-seeds-hosted-function-default",
  s396: "claude/voc-189-revoke-hosted-function-default",
  s397: "claude/voc-189-close-legacy-public-function-execute",
  s398: "claude/voc-190-lyric-learning-function-execute-gate",
};
const HEAD = { p395: "3828054648".padEnd(40, "0"), p396: "7c0fea1c22".padEnd(40, "0"), p397: "806ec34997".padEnd(40, "0"), p398: "0c92e8ad09".padEnd(40, "0") };
const SQUASH = { p396: "1057b3042b".padEnd(40, "0"), p397: "6a18b1a08c".padEnd(40, "0"), p398: "8a05eba2fb".padEnd(40, "0") };
const MAIN = "e".repeat(40);
const TITLES: Record<number, string> = {
  395: "Replay migrations under the hosted public-function default (VOC-189)",
  396: "Revoke the hosted public-function default from the API roles (VOC-189)",
  397: "Close direct EXECUTE on 30 legacy public functions (VOC-189)",
  398: "Enforce the lyric_learning function EXECUTE invariant in the gates (VOC-190)",
};
// 착륙 조건은 모두 맞은 PR(CI 통과, head에 사람 리뷰, CLEAN): 쌓인 것만 막혀야 한다
const pull = (n: 395 | 396 | 397 | 398, base: string, head: string): GhPull => ({
  number: n,
  title: TITLES[n],
  url: `https://github.com/chaehy5665/vocado_nextjs/pull/${n}`,
  headRefName: B[`s${n}`],
  headRefOid: HEAD[`p${n}`],
  baseRefName: base,
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  createdAt: "2026-09-26T02:00:00Z",
  author: { login: "chaehy5665" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [{ author: { login: "reviewer" }, state: "APPROVED", submittedAt: "2026-09-27T12:00:00Z", commit: { oid: head } }],
});
const STACK = [pull(395, "main", HEAD.p395), pull(396, B.s395, HEAD.p396), pull(397, B.s396, HEAD.p397), pull(398, B.s397, HEAD.p398)];
const build = (pulls: GhPull[], defaultBranch: string | null = "main") =>
  buildPulls([{ repo: "/r/vocado_nextjs", pulls, defaultBranch }], [], [], new Map(), (g) => /VOC-\d+/.exec(g.title)?.[0] ?? null, "2026-09-27T14:00:00Z");

test("쌓인 PR(14:41 전): base가 main이 아닌 #396~#398은 조건이 모두 맞아도 CLEARED가 아니고 STACKED, 사슬은 #395 → #396 → #397 → #398", () => {
  const out = new Map(build(STACK).map((p) => [p.number, p]));
  assert.equal(out.get(395)!.landing, "CLEARED"); // 맨 아래는 main으로 간다
  assert.deepEqual(out.get(395)!.stack, { base: null, chain: [395, 396, 397, 398] });
  for (const n of [396, 397, 398]) {
    const p = out.get(n)!;
    assert.equal(p.landing, "APPROACH", `#${n}`);
    assert.deepEqual(p.blocks.map((b) => b.code), ["stacked"], `#${n}`);
    assert.deepEqual(p.stack!.chain, [395, 396, 397, 398]);
  }
  assert.equal(out.get(396)!.blocks[0].text, "쌓인 PR — #395가 먼저 main에 들어간 뒤 base를 main으로 바꿈 (#395 → #396 → #397 → #398)");
  assert.equal(out.get(398)!.blocks[0].text, "쌓인 PR — #395, #396, #397가 먼저 main에 들어간 뒤 base를 main으로 바꿈 (#395 → #396 → #397 → #398)");
  assert.equal(out.get(397)!.stack!.base, 396);
  // base 브랜치의 PR이 이미 닫혔으면(아래 PR이 없음) base를 바꾸라고만 한다
  const orphan = build([pull(397, B.s396, HEAD.p397)])[0];
  assert.equal(orphan.blocks[0].text, `쌓인 PR — base가 main이 아님(${B.s396}) — base를 main으로 바꿔야 착륙할 수 있음`);
  assert.equal(orphan.stack, null);
  // 기본 브랜치를 모르면(아직 못 읽음) 가리지 않는다
  assert.equal(build(STACK, null).find((p) => p.number === 396)!.landing, "CLEARED");
  // CLEARED인 #395만 LAND 글을 받는다(쌓인 PR에는 repoSeq가 없다)
  assert.match(landTextOf(1, "VCDO", 395, "VOC189", null), /^LANDING sequence 1 \(VCDO\): PR #395/);
});

test("사슬 모양: 갈래가 있으면 번호가 작은 쪽으로 오르고, 순환 base도 멈춘다", () => {
  const p = (number: number, base: string, head: string) => ({ number, baseRefName: base, headRefName: head });
  const pulls = [p(1, "main", "a"), p(2, "a", "b"), p(3, "a", "c"), p(4, "b", "d")];
  assert.deepEqual(stackOf(pulls[3], pulls, "main"), { base: 2, chain: [1, 2, 4] });
  assert.deepEqual(stackOf(pulls[2], pulls, "main"), { base: 1, chain: [1, 2, 4, 3] }); // 옆 갈래는 끝에 붙는다
  assert.equal(stackOf(p(9, "main", "z"), pulls, "main"), null); // 혼자
  const loop = [p(5, "y", "x"), p(6, "x", "y")];
  assert.ok(stackOf(loop[0], loop, "main")!.chain.length === 2);
});

// 14:41 뒤: #396·#397·#398은 MERGED(각자 바로 아래 브랜치로), #395만 열림. compare로 확인한 실제 조상 관계:
// #396의 squash 1057b30은 #395 head에 들어 있고, #397의 6a18b1a·#398의 8a05eba는 main에도 #395에도 없다
const ANCESTORS = new Map<string, Set<string>>([
  [MAIN, new Set()],
  [HEAD.p395, new Set([SQUASH.p396, HEAD.p396])],
]);
const contains = async (target: string, commit: string) => ANCESTORS.get(target)?.has(commit) ?? false;
const merged = (n: 396 | 397 | 398, base: string, at: string): Omit<MergedElsewhere, "reached"> => ({
  repo: "/r/vocado_nextjs", number: n, title: TITLES[n], url: `https://github.com/chaehy5665/vocado_nextjs/pull/${n}`,
  base, mergedAt: at, mergeCommit: SQUASH[`p${n}`], head: HEAD[`p${n}`], flight: /VOC-\d+/.exec(TITLES[n])![0],
});
const TARGETS = [{ label: "main", ref: MAIN }, { label: "#395", ref: HEAD.p395 }];

test("STRANDED(14:41 뒤): #396은 #395를 거쳐 main으로 가니 아님, #397·#398은 main에도 #395에도 닿지 않아 STRANDED", async () => {
  const rows: MergedElsewhere[] = [];
  for (const m of [merged(396, B.s395, "2026-09-27T14:41:13Z"), merged(397, B.s396, "2026-09-27T14:41:22Z"), merged(398, B.s397, "2026-09-27T14:41:27Z")]) {
    rows.push({ ...m, reached: await firstReach([m.mergeCommit!, m.head], TARGETS, contains) });
  }
  assert.deepEqual(rows.map((r) => [r.number, r.reached]), [[396, "#395"], [397, null], [398, null]]);
  const stranded = strandedOf(rows);
  assert.deepEqual(stranded.map((x) => [x.number, x.flight, x.base]), [[397, "VOC-189", B.s396], [398, "VOC-190", B.s397]]);
  assert.equal(
    strandedMessage(stranded[1], "main", "Done"),
    `STRANDED — #398(VOC-190)이 main에 닿지 않음 — ${B.s397}에 머지됐고 그 커밋이 main으로 가는 PR에도 없음 (Linear는 Done)`,
  );
  // #395가 main에 머지돼 main이 1057b30을 품으면 #396도 main에 닿는다. 모름(undefined)과 FLIGHT 없음은 경보가 아니다
  ANCESTORS.set(MAIN, new Set([SQUASH.p396]));
  assert.equal(await firstReach([SQUASH.p396], TARGETS, contains), "main");
  assert.deepEqual(strandedOf([{ ...merged(397, B.s396, "2026-09-27T14:41:22Z"), flight: null, reached: null }]), []);
});

test("Fixes 키와 FLIGHT FOLLOWING: 본문 Fixes로 FLIGHT를 찾고, Linear가 Done이어도 STRANDED 문제를 남긴다", () => {
  assert.equal(fixesKeyOf("Some text\n\nFixes VOC-190"), "VOC-190");
  assert.equal(fixesKeyOf("closes voc-12 and more"), "VOC-12");
  assert.equal(fixesKeyOf("Part of VOC-189"), null);
  const done = { key: "VOC-190", title: "lyric_learning schema-level public revoke", state: "Done", stateType: "completed", labels: [], url: null, updatedAt: "2026-09-27T14:42:00Z", startedAt: null } as unknown as Ticket;
  const items = followingOf({
    proposals: [], tickets: [done], workspaces: [], pulls: [], logbook: [], departures: [], now: Date.parse("2026-09-29T00:00:00Z"),
    stranded: [{ repo: "/r", number: 398, url: "u", title: TITLES[398], flight: "VOC-190", base: B.s397, mergedAt: "2026-09-27T14:41:27Z", mergeCommit: SQUASH.p398 }],
  });
  const f = items.find((x) => x.flight === "VOC-190")!;
  const issue = f.issues.find((i) => i.code === "stranded")!;
  assert.equal(issue.text, `STRANDED — PR #398이 ${B.s397}에 머지돼 기본 브랜치에 닿지 않음 (Linear는 Done이지만 변경은 main에 없음)`);
  assert.equal(issue.key, "VOC-190|stranded|398");
  assert.equal(issue.severity, "warn");
});

// ── ATC-216: squash 머지된 PR이 실어 간 쌓인 머지는 STRANDED가 아니다. 번호·이름은 모두 일반값 ──
// P1(#201, base main) ← P2(#202) ← P3(#203) ← P4(#204). P2·P3·P4는 각자 바로 아래 브랜치로 squash 머지됐고, P1의 브랜치에 P3·P4의 squash 커밋을 머지해 실었다.
const S = { main: "a".repeat(40), h201: "1".repeat(40), sq202: "2".repeat(40), sq203: "3".repeat(40), sq204: "4".repeat(40), head203: "5".repeat(40), head204: "6".repeat(40), head202: "7".repeat(40) };
const stackRow = (number: 202 | 203 | 204, base: string, at: string): Omit<MergedElsewhere, "reached"> => ({
  repo: "/r/x", number, title: `Stack PR ${number} (ATC-${number})`, url: `https://example.test/pull/${number}`, base, mergedAt: at,
  mergeCommit: S[`sq${number}`], head: S[`head${number}`], flight: `ATC-${number}`,
});
const STACK_ROWS = [stackRow(202, "b1", "2026-09-30T10:00:00Z"), stackRow(203, "b2", "2026-09-30T10:00:03Z"), stackRow(204, "b3", "2026-09-30T10:00:09Z")];
// P1의 head가 품은 것(P3·P4의 squash와 head를 P1에 병합했다). P2의 squash도 P1 브랜치 위에 있다
const carrierAncestors = new Set([S.sq202, S.sq203, S.sq204, S.head203, S.head204, S.head202]);
const cont = (ancestors: Map<string, Set<string>>) => async (target: string, commit: string) => ancestors.get(target)?.has(commit) ?? false;
const reachOf = async (m: (typeof STACK_ROWS)[number], open: { number: number; headRefName: string; headRefOid: string }[], merged: { number: number; headRefName: string; headRefOid: string; mergedAt: string | null }[], ancestors: Map<string, Set<string>>) =>
  firstReach([m.mergeCommit!, m.head], reachTargetsOf({ base: "main", mainSha: S.main, open, merged, prBaseRef: m.base, prMergedAt: m.mergedAt, selfNumber: m.number }), cont(ancestors));

test("reachTargetsOf: main, 열린 PR(이 PR의 base를 head로 가진 것 먼저), 이 PR 뒤에 머지된 PR 순. 자기 자신과 앞서 머지된 PR은 뺀다", () => {
  const open = [{ number: 301, headRefName: "other", headRefOid: "b".repeat(40) }, { number: 302, headRefName: "b2", headRefOid: "c".repeat(40) }];
  const merged = [
    { number: 401, headRefName: "early", headRefOid: "d".repeat(40), mergedAt: "2026-09-30T09:00:00Z" }, // 이 PR보다 앞: 뺀다
    { number: 402, headRefName: "late", headRefOid: "e".repeat(40), mergedAt: "2026-09-30T10:05:00Z" },
    { number: 403, headRefName: "b2", headRefOid: "f".repeat(40), mergedAt: "2026-09-30T10:20:00Z" }, // 이 PR의 base가 head: 먼저
    { number: 203, headRefName: "self", headRefOid: "9".repeat(40), mergedAt: "2026-09-30T10:00:03Z" }, // 자기 자신
    { number: 404, headRefName: "nulled", headRefOid: "8".repeat(40), mergedAt: null },
  ];
  const t = reachTargetsOf({ base: "main", mainSha: S.main, open, merged, prBaseRef: "b2", prMergedAt: "2026-09-30T10:00:03Z", selfNumber: 203 });
  assert.deepEqual(t.map((x) => x.label), ["main", "#302", "#301", "#403 (merged)", "#402 (merged)"]);
  assert.equal(t[0]!.ref, S.main);
  assert.equal(t[3]!.ref, "f".repeat(40));
  // main SHA를 모르면 브랜치 이름으로
  assert.equal(reachTargetsOf({ base: "main", mainSha: null, open: [], merged: [], prBaseRef: "x", prMergedAt: "2026-09-30T10:00:00Z" })[0]!.ref, "main");
  // compare 호출 수: 머지된 대상은 MERGED_TARGET_MAX개까지
  const many = Array.from({ length: MERGED_TARGET_MAX + 10 }, (_, k) => ({ number: 500 + k, headRefName: `m${k}`, headRefOid: String(k).padStart(40, "0"), mergedAt: "2026-09-30T11:00:00Z" }));
  assert.equal(reachTargetsOf({ base: "main", mainSha: S.main, open: [], merged: many, prBaseRef: "x", prMergedAt: "2026-09-30T10:00:00Z" }).length, 1 + MERGED_TARGET_MAX);
});

test("STRANDED(ATC-216): 열린 P1이 실어 나르는 동안은 닿음, P1이 squash로 main에 머지된 뒤에도 P1의 head(머지됨)에 닿아 STRANDED가 아니다", async () => {
  const p1 = { number: 201, headRefName: "b1", headRefOid: S.h201 };
  // 1) P1이 열려 있다: main에는 없고 P1 head에는 있다
  const ancestors = new Map<string, Set<string>>([[S.main, new Set()], [S.h201, carrierAncestors]]);
  for (const m of STACK_ROWS) assert.equal(await reachOf(m, [p1], [], ancestors), "#201", String(m.number));
  // 2) P1이 squash 머지됐다: 열린 PR은 없고, main은 squash 커밋뿐이라 조상이 없다. 머지된 P1의 head가 커밋을 품는다
  const p1Merged = { ...p1, mergedAt: "2026-09-30T10:30:00Z" };
  const rows = [];
  for (const m of STACK_ROWS) rows.push({ ...m, reached: await reachOf(m, [], [p1Merged], ancestors) });
  assert.deepEqual(rows.map((r) => [r.number, r.reached]), [[202, "#201 (merged)"], [203, "#201 (merged)"], [204, "#201 (merged)"]]);
  assert.deepEqual(strandedOf(rows), []);
});

test("STRANDED(ATC-216): 실어 나른 PR이 없으면 그대로 STRANDED, 앞서 머지된 PR과 머지 안 된 것은 대상이 아니다", async () => {
  const ancestors = new Map<string, Set<string>>([[S.main, new Set()]]);
  // 실어 나른 PR 없음
  const rows = [];
  for (const m of STACK_ROWS.slice(1)) rows.push({ ...m, reached: await reachOf(m, [], [], ancestors) });
  assert.deepEqual(strandedOf(rows).map((x) => x.number), [203, 204]);
  // 커밋을 품은 PR이 이 PR보다 앞서 머지됐다면 그 PR은 대상이 아니다(그때 이 커밋은 아직 없었다)
  ancestors.set(S.h201, carrierAncestors);
  const early = { number: 201, headRefName: "b1", headRefOid: S.h201, mergedAt: "2026-09-30T09:00:00Z" };
  assert.equal(await reachOf(STACK_ROWS[1]!, [], [early], ancestors), null);
  // 다른 PR의 head는 커밋을 품지 않으니 STRANDED 그대로
  const unrelated = { number: 210, headRefName: "z", headRefOid: "0".repeat(40), mergedAt: "2026-09-30T10:30:00Z" };
  assert.equal(await reachOf(STACK_ROWS[1]!, [], [unrelated], ancestors), null);
  // main이 품으면 main
  ancestors.set(S.main, new Set([S.sq203]));
  assert.equal(await reachOf(STACK_ROWS[1]!, [], [], ancestors), "main");
});

test("STRANDED(ATC-216): compare가 실패하면 경보를 내지 않는 fail-safe는 firstReach가 던지면 그대로 던진다(호출하는 쪽이 catch해 경보를 내지 않는다)", async () => {
  const boom = async () => {
    throw new Error("compare 실패");
  };
  await assert.rejects(firstReach([S.sq203], reachTargetsOf({ base: "main", mainSha: S.main, open: [], merged: [], prBaseRef: "b2", prMergedAt: "2026-09-30T10:00:00Z" }), boom), /compare 실패/);
});
