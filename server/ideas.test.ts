import assert from "node:assert/strict";
import test from "node:test";
import { drawerOfHash } from "./detail.ts";
import { adoptText, IDEAS_REPO, ideaNumberOf, shapeIdea, shapeIdeaList } from "./ideas.ts";

test("읽는 저장소는 atc 하나로 고정", () => {
  assert.equal(IDEAS_REPO, "chaehy5665/atc");
});

test("번호: 자연수만", () => {
  assert.equal(ideaNumberOf("12"), 12);
  for (const bad of ["", "0", "-1", "1.5", "1e3", "12/../x", "abc", "12345678"]) assert.equal(ideaNumberOf(bad), null, bad);
});

test("주소: #ideas와 #ideas/<n>", () => {
  assert.deepEqual(drawerOfHash("#ideas"), { kind: "ideas" });
  assert.deepEqual(drawerOfHash("#ideas/7"), { kind: "idea", number: 7 });
  for (const h of ["#ideas/x", "#ideas/0", "#ideas/7/8", "#ideas/"]) assert.equal(drawerOfHash(h), null, h);
});

test("목록: idea 라벨만, 늦게 바뀐 것부터, 미리보기 300자와 댓글 수", () => {
  const rows = shapeIdeaList([
    { number: 1, title: "old", labels: [{ name: "idea" }], updatedAt: "2026-09-01T00:00:00Z", comments: [], body: "a" },
    { number: 2, title: "new", labels: [{ name: "idea" }, { name: "x" }], updatedAt: "2026-09-30T00:00:00Z", comments: [{}, {}], body: `${"word ".repeat(200)}\n\nend` },
    { number: 3, title: "not an idea", labels: [{ name: "bug" }], updatedAt: "2026-10-01T00:00:00Z", comments: [], body: "" },
    { title: "no number", labels: [{ name: "idea" }] },
  ]);
  assert.deepEqual(rows.map((r) => r.number), [2, 1]);
  assert.equal(rows[0].comments, 2);
  assert.equal(rows[0].preview.length, 301);
  assert.ok(!rows[0].preview.includes("\n"));
  assert.equal(shapeIdeaList([{ number: 4, labels: [{ name: "idea" }], body: "## Idea\n\nText" }])[0].preview, "Idea Text");
  assert.deepEqual(rows[0].labels, ["idea", "x"]);
  assert.deepEqual(shapeIdeaList(null), []);
});

test("상세: 열린 idea 이슈만, 댓글은 20개까지", () => {
  const base = { number: 5, title: "T", url: "https://github.com/chaehy5665/atc/issues/5", state: "OPEN", labels: [{ name: "idea" }], author: { login: "u" }, body: "본문", comments: [] };
  const d = shapeIdea({ ...base, comments: Array.from({ length: 25 }, (_, i) => ({ author: { login: "c" }, body: `c${i}`, createdAt: "2026-09-30T00:00:00Z" })) });
  assert.ok(d);
  assert.equal(d.comments.length, 20);
  assert.equal(d.commentsTotal, 25);
  assert.equal(d.author, "u");
  assert.equal(shapeIdea({ ...base, state: "CLOSED" }), null);
  assert.equal(shapeIdea({ ...base, labels: [{ name: "bug" }] }), null);
  assert.equal(shapeIdea({ ...base, url: "javascript:1" })?.url, null);
  assert.equal(shapeIdea({ ...base, body: "x".repeat(25_000) })?.bodyTruncated, true);
});

test("ADOPT 문구: 고정 틀, 제목은 한 줄·따옴표 없이·120자", () => {
  assert.equal(adoptText(12, "Idea title"), 'ADOPT idea #12 "Idea title" — read it (duty idea 12) and propose a design outline: problem, current facts to check, principles, steps. Do not write files.');
  const t = adoptText(3, `a "quoted"\nline ${"x".repeat(200)}`);
  assert.ok(!t.includes("\n"));
  assert.ok(t.startsWith(`ADOPT idea #3 "a 'quoted' line x`));
  assert.equal(t.match(/"([^"]*)"/)?.[1].length, 120);
  assert.equal(shapeIdea({ number: 9, title: "Q", state: "open", labels: [{ name: "idea" }] })?.adopt, adoptText(9, "Q"));
});
