import assert from "node:assert/strict";
import test from "node:test";
import { drawerOfHash, flightKeyOf, makeCache, prRefOf, safeUrl, shapeIssue, shapePr } from "./detail.ts";

test("주소: #flight/·#pr/만 서랍이고 나머지는 null", () => {
  assert.deepEqual(drawerOfHash("#flight/atc-206"), { kind: "flight", key: "ATC-206" });
  assert.deepEqual(drawerOfHash("#pr/ATCC/12"), { kind: "pr", airport: "ATCC", number: 12 });
  for (const h of ["", "#radar", "#docs/requesting", "#flight/", "#flight/nope", "#pr/ATCC", "#pr/ATCC/x", "#pr//1"]) assert.equal(drawerOfHash(h), null, h);
});

test("FLIGHT key: 대문자로 바꾸고 형식이 아니면 null", () => {
  assert.equal(flightKeyOf(" atc-206 "), "ATC-206");
  for (const bad of ["", "ATC", "ATC-", "ATC-1x", "../etc", "ATC-1;rm", "A TC-1", "ATC-12345678"]) assert.equal(flightKeyOf(bad), null, bad);
});

test("PR 주소: AIRPORT 코드와 자연수 번호만", () => {
  assert.deepEqual(prRefOf("atcc", "12"), { airport: "ATCC", number: 12 });
  for (const [a, n] of [["", "1"], ["ATCC", "0"], ["ATCC", "-1"], ["ATCC", "1.5"], ["AT/CC", "1"], ["ATCC", "abc"]]) assert.equal(prRefOf(a, n), null, `${a} ${n}`);
});

test("링크는 http(s)만", () => {
  assert.equal(safeUrl("https://github.com/a/b/pull/1"), "https://github.com/a/b/pull/1");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//x.com", null, 3]) assert.equal(safeUrl(bad), null);
});

test("이슈: 관계·라벨·붙은 PR을 다듬고 PR이 아닌 첨부와 http 아닌 주소는 뺀다", () => {
  const d = shapeIssue({
    identifier: "ATC-206", title: "T", url: "https://linear.app/x", description: "본문", priority: 3,
    state: { name: "Todo", type: "unstarted" }, assignee: { displayName: "A" }, project: { name: "P" },
    labels: { nodes: [{ name: "BUILD", parent: { name: "type" } }, { name: "x", parent: null }] },
    parent: { identifier: "ATC-192", title: "P", state: { name: "Todo", type: "unstarted" } },
    children: { nodes: [] },
    relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "ATC-207", title: "n", state: { name: "Backlog", type: "backlog" } } }, { type: "related", relatedIssue: { identifier: "ATC-1", title: "", state: null } }] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "ATC-194", title: "q", state: { name: "Done", type: "completed" } } }] },
    attachments: { nodes: [{ url: "https://github.com/o/r/pull/9", title: "PR" }, { url: "https://example.com/x", title: "no" }, { url: "javascript:1", title: "no" }] },
    comments: { nodes: [{ body: "c", createdAt: "2026-09-30T00:00:00Z", user: { displayName: "U" } }] },
  });
  assert.deepEqual(d.labels, ["type:BUILD", "x"]);
  assert.deepEqual(d.blocks.map((r) => r.key), ["ATC-207"]);
  assert.deepEqual(d.blockedBy.map((r) => [r.key, r.stateType]), [["ATC-194", "completed"]]);
  assert.equal(d.parent?.key, "ATC-192");
  assert.deepEqual(d.prs, [{ url: "https://github.com/o/r/pull/9", title: "PR" }]);
  assert.equal(d.comments[0].author, "U");
});

test("이슈: 본문과 댓글은 길이를 자르고, 빈 값은 견딘다", () => {
  const d = shapeIssue({ identifier: "ATC-1", description: "x".repeat(25_000), comments: { nodes: [{ body: "y".repeat(5000) }] } });
  assert.equal(d.description.length, 20_000);
  assert.equal(d.descriptionTruncated, true);
  assert.equal(d.comments[0].truncated, true);
  assert.equal(shapeIssue(null).key, "");
});

test("PR: 체크는 이름별 마지막 것, 파일은 100개까지, 본문은 문자열 그대로(화면이 안전하게 그린다)", () => {
  const pr = shapePr(
    {
      number: 5, title: "Fixes ATC-9", url: "https://github.com/o/r/pull/5", state: "OPEN", isDraft: false, headRefName: "claude/atc-9-x", headRefOid: "abc", baseRefName: "main",
      author: { login: "me" }, labels: [{ name: "l" }], body: "<script>alert(1)</script>", reviewDecision: "", mergeStateStatus: "CLEAN",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "FAILURE" },
        { __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: "" },
        { __typename: "StatusContext", context: "ci/x", state: "SUCCESS" },
      ],
      files: Array.from({ length: 130 }, (_, i) => ({ path: `f${i}`, additions: 1, deletions: 0 })),
    },
    () => "ATC-9",
  );
  assert.deepEqual(pr.checks, [{ name: "check", state: "pass" }, { name: "lint", state: "pending" }, { name: "ci/x", state: "pass" }]);
  assert.equal(pr.files.length, 100);
  assert.equal(pr.filesTotal, 130);
  assert.equal(pr.ticketKey, "ATC-9");
  assert.equal(pr.reviewDecision, null);
  assert.equal(pr.body, "<script>alert(1)</script>");
});

test("캐시: TTL 안에서는 다시 부르지 않고, 오류는 캐시하지 않는다", async () => {
  let t = 0;
  let calls = 0;
  const cache = makeCache<number>(60_000, () => t);
  assert.equal(await cache("a", async () => ++calls), 1);
  assert.equal(await cache("a", async () => ++calls), 1);
  t = 61_000;
  assert.equal(await cache("a", async () => ++calls), 2);
  await assert.rejects(cache("b", async () => { throw new Error("x"); }));
  await new Promise((r) => setImmediate(r));
  assert.equal(await cache("b", async () => ++calls), 3);
});
