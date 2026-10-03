import assert from "node:assert/strict";
import { test } from "node:test";
import { ageText } from "../web/src/flow-age.ts";
import { splitLine } from "../web/src/flow-board.ts";

test("splitLine: 첫 ' · '에서 제목과 나머지로 나눈다", () => {
  assert.deepEqual(splitLine("흐름 정상 · 지난 6h 착륙 32 · 비행 중 9"), { title: "흐름 정상", rest: "지난 6h 착륙 32 · 비행 중 9" });
  assert.deepEqual(splitLine("흐름 정상"), { title: "흐름 정상", rest: "" });
});

test("ageText: 분·시간·일 한 단위", () => {
  assert.equal(ageText(4), "4m");
  assert.equal(ageText(360), "6h");
  assert.equal(ageText(3 * 1440), "3d");
  assert.equal(ageText(null), "—");
});
