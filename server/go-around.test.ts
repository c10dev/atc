import assert from "node:assert/strict";
import { test } from "node:test";
import { goAroundEvents, goAroundOf, goAroundTextOf, sharedFiles } from "./go-around.ts";
import { landTextOf } from "./controller.ts";
import { fixTextOf } from "./fix.ts";
import * as en from "./landing-en.ts";
import { responseOf } from "./response.ts";
import type { Clearance, LandingBlockCode, PullRequest, Snapshot } from "./model.ts";

const REPO = "/home/c10/projects/atc";
const WT = "/home/c10/projects/worktrees";
const T0 = Date.parse("2026-09-29T04:30:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const pr = (number: number, codes: LandingBlockCode[] = [], over: Partial<PullRequest> = {}): PullRequest => ({
  repo: REPO, number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, branch: `claude/atc-${number}`,
  head: `h${number}abcdef0`, base: "main", ticketKey: `ATC-${number}`, standPath: `${WT}/atc-${number}`, draft: false,
  landing: codes.length ? "APPROACH" : "CLEARED", blocks: codes.map((code) => ({ code, text: code, en: code })),
  readyAt: codes.length ? null : iso(-10), createdAt: iso(-100 + number), ...over,
});
const snap = (pulls: PullRequest[]) => ({ pulls }) as unknown as Snapshot;
const kinds = (a: PullRequest[], b: PullRequest[]) => goAroundEvents(snap(a), snap(b)).map((e) => `${e.kind}:${e.pull}`);

test("landing.conflict: DIRTY·BEHIND가 새로 생기거나 SEQUENCE에 그 채로 들어올 때, head마다 한 번", () => {
  assert.deepEqual(kinds([pr(5)], [pr(5, ["dirty"])]), ["landing.conflict:5"]);
  assert.deepEqual(kinds([pr(5)], [pr(5, ["behind"])]), ["landing.conflict:5"]);
  // 이미 그 상태인 head는 다시 내지 않는다
  assert.deepEqual(kinds([pr(5, ["dirty"])], [pr(5, ["dirty", "no-review"])]), []);
  // 새 push했는데 아직 충돌이면 새 head라 다시
  assert.deepEqual(kinds([pr(5, ["dirty"])], [pr(5, ["dirty"], { head: "new1234567" })]), ["landing.conflict:5"]);
  // 뒤처짐이 충돌로 바뀜
  assert.deepEqual(kinds([pr(5, ["behind"])], [pr(5, ["dirty"])]), ["landing.conflict:5"]);
  // 처음부터 충돌인 채 들어온 PR(2026-09-29 PR 194)
  assert.deepEqual(kinds([], [pr(5, ["no-checks", "no-review", "dirty"])]), ["landing.conflict:5"]);
  // Draft는 SEQUENCE 밖이라 내지 않는다
  assert.deepEqual(kinds([], [pr(5, ["draft", "dirty"], { draft: true })]), []);
  // 충돌이 풀리면 조용히
  assert.deepEqual(kinds([pr(5, ["dirty"])], [pr(5)]), []);
});

test("landing.conflict는 그 사이 머지된 PR과 함께 고친 파일을 싣는다(모르면 빈 배열)", () => {
  const before = [pr(3, [], { changed: ["a.ts", "b.ts"] }), pr(4, [], { changed: ["b.ts", "c.ts", "d.ts"] }), pr(5, [], { changed: ["z.ts"] })];
  const after = [pr(4, ["dirty"], { changed: ["b.ts", "c.ts", "d.ts"], head: "moved12345" }), pr(5, [], { changed: ["z.ts"] })];
  const [e] = goAroundEvents(snap(before), snap(after)).filter((x) => x.kind === "landing.conflict");
  assert.deepEqual(e.merged, [3]);
  assert.deepEqual(e.shared, ["b.ts"]);
  assert.match(e.message!, /^GO AROUND: PR #4 \(ATC-4\) head moved12 conflicts with base after #3 merged\. Shared files: b\.ts\./);
  assert.match(e.message!, /plain git push.*answer UNABLE with the reason\.$/);
  // 목록을 못 읽었으면 공유 파일은 비고 문구에서 빠진다
  const [u] = goAroundEvents(snap([pr(3), pr(4)]), snap([pr(4, ["behind"], { head: "moved12345" })]));
  assert.deepEqual(u.shared, []);
  assert.doesNotMatch(u.message!, /Shared files/);
  assert.match(u.message!, /is behind base after #3 merged/);
  assert.deepEqual(sharedFiles(undefined, ["a"]), []);
});

test("landing.prevMerged: LAND 문구의 앞 PR(같은 저장소·base의 CLEARED 바로 앞)이 머지되면. 충돌이 함께 나면 conflict만", () => {
  assert.deepEqual(kinds([pr(1), pr(2), pr(3)], [pr(2), pr(3)]), ["landing.prevMerged:2"]);
  // 3번은 앞(2)이 그대로라 조용하다. 1번이 머지돼도 3번의 앞 PR은 그대로 2번
  assert.equal(goAroundEvents(snap([pr(1), pr(2), pr(3)]), snap([pr(2), pr(3)])).length, 1);
  // 앞 PR이 머지되고 뒤 PR이 충돌이 되면 conflict 하나
  assert.deepEqual(kinds([pr(1), pr(2)], [pr(2, ["dirty"])]), ["landing.conflict:2"]);
  // 순서 1번이 머지된 것은 뒤에 아무도 없으면 이벤트 없음
  assert.deepEqual(kinds([pr(1)], []), []);
  // 다른 저장소의 머지는 무관
  assert.deepEqual(kinds([pr(1, [], { repo: "/other" }), pr(2)], [pr(2)]), []);
});

test("GO AROUND 문구: 행동과 UNABLE 조건이 들어 있고, 파일이 많으면 줄인다", () => {
  const t = goAroundTextOf({ reason: "dirty", pr: 7, head: "abcdef0123", flight: null, merged: [3, 4], shared: Array.from({ length: 10 }, (_, i) => `f${i}.ts`) });
  assert.match(t, /^GO AROUND: PR #7 head abcdef0 conflicts with base after #3, #4 merged\./);
  assert.match(t, /\(\+2 more\)/);
  assert.match(t, /Merge origin\/main and resolve the conflicts. Run the checks. Then push with a plain git push/);
  assert.match(goAroundTextOf({ reason: "prevMerged", pr: 7, head: "abcdef0123", flight: "ATC-7", merged: [6], shared: [] }), /the PR ahead of it in the LANDING SEQUENCE \(#6\) has merged/);
});

test("응답 속성: GO AROUND는 W/U(READBACK이나 UNABLE)", () => {
  assert.equal(responseOf("clearance", "GO AROUND"), "W/U");
});

const clearance = (over: Partial<Clearance>): Clearance => ({
  id: "C-0001", at: iso(0), to: "s", toName: "TEAM_X", type: "GO AROUND", stand: `${WT}/atc-5`, flight: "ATC-5", text: "GO AROUND: PR #5 (ATC-5) head h5abcde conflicts with base.",
  readbackAt: null, cancelledAt: null, ...over,
});
const ctx = (over: Partial<Parameters<typeof goAroundOf>[1]> = {}) => ({ clearances: [], events: [], pulls: [pr(5, ["dirty"])], lastLand: undefined, holders: 1, now: T0 + 5 * 60_000, ...over });

test("브리핑 goAround: 상태에서 만든다(reset이어도 남음), head마다 한 번, 한 시간 안 두 번째와 holder 없음은 SUPERVISOR", () => {
  const dirty = pr(5, ["dirty"]);
  const a = goAroundOf(dirty, ctx())!;
  assert.deepEqual([a.reason, a.action, a.why, a.clearance], ["dirty", "send", null, null]);
  assert.match(a.text, /head h5abcde conflicts with base/);

  // 이 head에 이미 나갔다
  const sent = goAroundOf(dirty, ctx({ clearances: [clearance({})] }))!;
  assert.deepEqual([sent.action, sent.clearance], ["sent", "C-0001"]);
  // 취소된 것은 세지 않는다
  assert.equal(goAroundOf(dirty, ctx({ clearances: [clearance({ cancelledAt: iso(1) })] }))!.action, "send");
  // 새 head에 한 시간 안 두 번째 → SUPERVISOR, 한 시간이 지나면 다시 보낸다
  const moved = pr(5, ["dirty"], { head: "n5abcdef01" });
  const again = goAroundOf(moved, ctx({ clearances: [clearance({})] }))!;
  assert.deepEqual([again.action, again.why, again.clearance], ["supervisor", "repeat", "C-0001"]);
  assert.equal(goAroundOf(moved, ctx({ clearances: [clearance({})], now: T0 + 61 * 60_000 }))!.action, "send");
  // holder가 없으면 SUPERVISOR
  assert.deepEqual([goAroundOf(dirty, ctx({ holders: 0 }))!.action, goAroundOf(dirty, ctx({ holders: 0 }))!.why], ["supervisor", "no-holder"]);
  // 이번 브리핑 이벤트의 문구가 있으면 그것을 그대로(원인 머지·파일 포함)
  const ev = { id: 1, at: iso(0), kind: "landing.conflict" as const, repo: REPO, pull: 5, head: "h5abcde", message: "GO AROUND: from event" };
  assert.equal(goAroundOf(dirty, ctx({ events: [ev] }))!.text, "GO AROUND: from event");
  // 막힘이 없으면 없다
  assert.equal(goAroundOf(pr(5), ctx({ pulls: [pr(5)] })), null);
});

test("브리핑 goAround(prevMerged): LAND 문구의 앞 PR이 사라진 CLEARED PR에, LAND 뒤 한 번만", () => {
  const land = clearance({ type: "LAND", at: iso(-3), text: landTextOf(2, "ATC", 5, "ATC-5", 4) });
  const p = pr(5);
  // 앞 PR(#4)이 아직 열려 있으면 없다
  assert.equal(goAroundOf(p, ctx({ pulls: [p, pr(4)], lastLand: land })), null);
  const a = goAroundOf(p, ctx({ pulls: [p], lastLand: land }))!;
  assert.deepEqual([a.reason, a.action], ["prevMerged", "send"]);
  assert.match(a.text, /the PR ahead of it in the LANDING SEQUENCE \(#4\) has merged/);
  // 이미 GO AROUND를 냈으면 새 head를 push해도 다시 내지 않는다
  const done = clearance({ at: iso(1) });
  assert.equal(goAroundOf(pr(5, [], { head: "n5abcdef01" }), ctx({ pulls: [p], lastLand: land, clearances: [done] }))!.action, "sent");
  // 첫 순서(앞 PR 없음)의 LAND는 무관
  assert.equal(goAroundOf(p, ctx({ pulls: [p], lastLand: clearance({ type: "LAND", text: landTextOf(1, "ATC", 5, "ATC-5", null) }) })), null);
});

// 나가는 GO AROUND·FIX 본문은 AIRPORT 팀이 자기 세션에서 SUPERVISOR 승인 없이 할 수 있는 일만 청한다(ATC-350): force·rebase 말이 없다.
// RELAY는 이 본문을 그대로 싣는다. LAND·INFO 본문도 같은 말을 쓰지 않는다(ATC-497). GO AROUND 판정은 "PR ahead (#n)"만 읽는다.
test("GO AROUND·FIX·LAND·INFO 본문에 force·rebase가 없다", () => {
  const bad = /--force|force-with-lease|force[- ]push|rebase/i;
  const texts: string[] = [];
  for (const reason of ["dirty", "behind", "prevMerged"] as const) {
    for (const merged of [[], [3, 5]]) texts.push(goAroundTextOf({ reason, pr: 4, head: "abcdef1234", flight: "ATC-4", merged, shared: ["a.ts"] }));
  }
  const base = { pr: 4, head: "abcdef1234", flight: "ATC-4", url: "https://example.com/pr/4", en: "review findings" };
  for (const source of ["mcc", "review", "codex", "carried"] as const) {
    for (const f of [{ counts: [1, 0, 2] as [number, number, number] }, { counts: null }, { counts: [0, 0, 0] as [number, number, number], p3Only: true as const }]) {
      texts.push(fixTextOf({ ...base, findings: { source, by: "MCC INSPECTION", text: "P0: x", from: null, ...f } }));
    }
  }
  // LAND 본문(첫 순서·뒤 순서·P3 메모)과 모든 막힘 코드의 INFO 본문(ATC-497)
  texts.push(landTextOf(1, "ATC", 5, "ATC-5", null), landTextOf(2, "ATC", 6, "ATC-6", 5), landTextOf(3, null, 7, null, 6, 2));
  const blocksEn = [
    en.noChecksEn(), en.checksPendingEn(["a"]), en.checksFailedEn(["a"]), en.draftEn(), en.changesRequestedEn(["a"]), en.changesRequestedEn([]),
    en.noReviewEn("n"), en.reviewStaleEn("abc1234", "n"), en.behindEn(), en.dirtyEn(), en.blockedEn(), en.blockedEn(2), en.mergeUnknownEn(), en.losEn(),
    en.codexFindingsEn("abc1234", "P1 1"), en.codexFindingsEn("abc1234", null), en.codexP3OpenEn("abc1234", 2, 1), en.carriedFindingsEn("REVIEW", "abc1234"),
    en.stackedEn({ number: 6, baseRefName: "x" }, null, "main"), en.stackedEn({ number: 6, baseRefName: "x" }, { base: 5, chain: [5, 6] }, "main"),
  ];
  for (const b of blocksEn) texts.push(en.infoTextOf(4, [b])!);
  texts.push(en.infoTextOf(4, blocksEn)!);
  assert.ok(texts.length >= 40);
  for (const t of texts) assert.doesNotMatch(t, bad, t);
});
