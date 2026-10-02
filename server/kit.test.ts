import assert from "node:assert/strict";
import { test } from "node:test";
import { foldSummary } from "../web/src/kit/fold.ts";
import { nextSegment, tabStop } from "../web/src/kit/segmented.ts";

test("foldSummary: 요약 글이 먼저, 없으면 개수, 더 있으면 n / 전체", () => {
  assert.equal(foldSummary({ count: 13 }), "13");
  assert.equal(foldSummary({ count: 3, total: 13 }), "3 / 13");
  assert.equal(foldSummary({ count: 13, total: 13 }), "13");
  assert.equal(foldSummary({ count: 0 }), "0");
  assert.equal(foldSummary({ count: 5, summary: "gate 12/20 ✗" }), "gate 12/20 ✗");
  assert.equal(foldSummary({}), "");
});

test("nextSegment: 화살표는 양끝에서 돌고 Home·End는 끝 칸, 그 밖의 키는 null", () => {
  assert.equal(nextSegment(3, 0, "ArrowRight"), 1);
  assert.equal(nextSegment(3, 2, "ArrowRight"), 0);
  assert.equal(nextSegment(3, 0, "ArrowLeft"), 2);
  assert.equal(nextSegment(3, 1, "ArrowDown"), 2);
  assert.equal(nextSegment(3, 1, "ArrowUp"), 0);
  assert.equal(nextSegment(3, 1, "Home"), 0);
  assert.equal(nextSegment(3, 1, "End"), 2);
  assert.equal(nextSegment(3, -1, "ArrowRight"), 1);
  assert.equal(nextSegment(3, 1, "a"), null);
  assert.equal(nextSegment(0, 0, "ArrowRight"), null);
});

test("tabStop: 선택된 칸, 없으면 첫 칸", () => {
  assert.equal(tabStop(3, 2), 2);
  assert.equal(tabStop(3, -1), 0);
  assert.equal(tabStop(0, -1), -1);
});
