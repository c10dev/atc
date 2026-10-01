import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPulls, codexUnavailableOf, type GhPull, repoCodexOf } from "./landing.ts";
import { codexWhyEn } from "./landing-en.ts";

// ATC-312: 저장소의 Codex 한도 안내가 계속되는 동안 새 head는 6시간을 기다리지 않고 REVIEW로 간다
const HOUR = 3_600_000;
const T0 = "2026-10-01T00:00:00Z";
const at = (h: number) => new Date(Date.parse(T0) + h * HOUR).toISOString();
const SIX = 6 * HOUR;
const HEAD = "b".repeat(40);

const pr = (over: Partial<GhPull> = {}): GhPull => ({
  number: 10, title: "Change a thing", url: "https://github.com/o/r/pull/10", headRefName: "claude/atc-10", headRefOid: HEAD, baseRefName: "main",
  isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: null, createdAt: at(-1), author: { login: "x" }, statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }], reviews: [], labels: [],
  codex: { headAt: at(2), thumbsAt: null, lastComment: null }, files: ["a.ts"], body: "", ...over,
});
const other = (codex: GhPull["codex"], reviews: GhPull["reviews"] = []): GhPull => pr({ number: 11, headRefOid: "c".repeat(40), codex, reviews });
const unavailable = (p: GhPull, others: GhPull[], nowH: number) => codexUnavailableOf(p, Date.parse(at(nowH)), SIX, { codex: repoCodexOf([p, ...others]), limitMs: SIX });

test("한도 안내가 이 PR의 head보다 먼저 있고 그 뒤 Codex 신호가 없다: 한도", () => {
  const p = pr({ codex: { headAt: at(2), thumbsAt: null, lastComment: { at: at(1), limit: true } } });
  assert.deepEqual(unavailable(p, [], 3), { why: "limit", since: at(1), scope: "repo" });
});

test("안내가 같은 저장소의 다른 PR에 있고 창 안이다: 한도", () => {
  const p = pr();
  const o = other({ headAt: at(0), thumbsAt: null, lastComment: { at: at(1), limit: true } });
  assert.deepEqual(unavailable(p, [o], 3), { why: "limit", since: at(1), scope: "repo" });
});

test("안내가 창보다 오래됐다: 한도가 아니라 예전 규칙(silent)", () => {
  const p = pr();
  const o = other({ headAt: at(-20), thumbsAt: null, lastComment: { at: at(-10), limit: true } });
  assert.equal(unavailable(p, [o], 3), null); // head(2h) 뒤 6시간이 안 지났다
  assert.deepEqual(unavailable(p, [o], 9), { why: "silent", since: at(8) });
});

test("안내 뒤 저장소에 진짜 Codex 리뷰가 있다: 한도 아님(Codex를 기다린다)", () => {
  const p = pr();
  const o = other({ headAt: at(0), thumbsAt: null, lastComment: { at: at(1), limit: true } }, [{ author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: at(1.5), commit: { oid: "c".repeat(40) } }]);
  assert.equal(unavailable(p, [o], 3), null);
  // 안내 뒤 다른 PR의 👍이나 한도 아닌 댓글도 신호다
  assert.equal(unavailable(p, [other({ headAt: at(0), thumbsAt: at(1.5), lastComment: { at: at(1), limit: true } })], 3), null);
  assert.equal(unavailable(p, [other({ headAt: at(0), thumbsAt: null, lastComment: { at: at(1.5), limit: false } })], 3), null);
});

test("이 PR의 head 뒤에 Codex가 한도 아닌 댓글을 남겼다: 한도 아님", () => {
  const p = pr({ codex: { headAt: at(2), thumbsAt: null, lastComment: { at: at(2.5), limit: false } } });
  const o = other({ headAt: at(0), thumbsAt: null, lastComment: { at: at(1), limit: true } });
  assert.equal(unavailable(p, [o], 3), null);
});

test("저장소 수준 판단 없이(예전 호출)는 예전처럼 동작한다", () => {
  const p = pr({ codex: { headAt: at(2), thumbsAt: null, lastComment: { at: at(1), limit: true } } });
  assert.equal(codexUnavailableOf(p, Date.parse(at(3)), SIX), null);
});

test("제외 PR(FLIGHT 없음, SEC)은 저장소가 한도여도 extReview가 excluded", () => {
  const limited = other({ headAt: at(0), thumbsAt: null, lastComment: { at: at(1), limit: true } });
  const build = (g: GhPull, flight: string | null, labels: string[]) =>
    buildPulls([{ repo: "/r/proj", pulls: [g, limited] }], [], [], new Map(), () => flight, at(3), { silentMs: SIX, limitMs: SIX, reviews: [], ticketLabelsOf: () => labels }).find((x) => x.number === g.number)!;
  const noFlight = build(pr(), null, []);
  assert.deepEqual([noFlight.codexUnavailable?.scope, noFlight.extReview?.status], ["repo", "excluded"]);
  const sec = build(pr(), "ATC-10", ["rating:SEC"]);
  assert.equal(sec.extReview?.status, "excluded");
  // 제외가 아니면 REVIEW 대기
  assert.equal(build(pr(), "ATC-10", []).extReview?.status, "waiting");
});

// REVIEW 통과 뒤: 창이 끝나거나 다른 PR에 Codex 신호가 와도 그 head는 한도로 남아 CLEARED가 APPROACH로 돌아가지 않는다
const withReview = (g: GhPull, others: GhPull[], nowH: number) => {
  const review = { at: at(2.5), repo: "o/r", number: g.number, head: g.headRefOid, verdict: "pass" as const, text: "ok", by: "REVIEW", model: "m", family: "claude-sonnet", p0: 0, p1: 0, p2: 0 };
  return buildPulls([{ repo: "/r/proj", pulls: [g, ...others] }], [], [], new Map(), () => "ATC-10", at(nowH), { silentMs: SIX, limitMs: SIX, reviews: [review], ticketLabelsOf: () => [] }).find((x) => x.number === g.number)!;
};
const NOTICE = other({ headAt: at(0), thumbsAt: null, lastComment: { at: at(1), limit: true } });

test("REVIEW 통과가 있는 head: 안내 창(6시간)이 끝나도 한도로 남아 CLEARED를 유지한다", () => {
  const p = pr();
  assert.equal(withReview(p, [NOTICE], 3).landing, "CLEARED");
  const later = withReview(p, [NOTICE], 7.5); // 안내(1h)+6h는 지났고, head(2h)+6h는 아직
  assert.deepEqual([later.codexUnavailable?.why, later.codexUnavailable?.scope, later.landing], ["limit", "repo", "CLEARED"]);
});

test("REVIEW 통과 뒤 다른 PR에 Codex 리뷰·👍이 와도 이 head는 CLEARED로 남는다. REVIEW가 없으면 Codex를 기다린다", () => {
  const p = pr();
  const back = other({ headAt: at(0), thumbsAt: at(4), lastComment: { at: at(1), limit: true } }, [{ author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: at(4), commit: { oid: "c".repeat(40) } }]);
  assert.equal(withReview(p, [back], 5).landing, "CLEARED");
  const noReview = buildPulls([{ repo: "/r/proj", pulls: [p, back] }], [], [], new Map(), () => "ATC-10", at(5), { silentMs: SIX, limitMs: SIX, reviews: [], ticketLabelsOf: () => [] }).find((x) => x.number === 10)!;
  assert.equal(noReview.codexUnavailable ?? null, null);
});

test("영어 이유 글: 저장소 한도는 시각을 싣는다", () => {
  assert.equal(codexWhyEn("limit", 6, "2026-10-01T06:29:00.000Z"), "Codex limit (repository, 06:29Z~)");
  assert.equal(codexWhyEn("limit", 6), "Codex limit");
  assert.equal(codexWhyEn("silent", 6), "Codex silent for 6 hours");
});
