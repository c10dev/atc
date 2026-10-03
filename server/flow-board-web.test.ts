import assert from "node:assert/strict";
import { test } from "node:test";
import { ageText } from "../web/src/flow-age.ts";
import { splitLine, todoKeysOf } from "../web/src/flow-board.ts";

test("splitLine: 첫 ' · '에서 제목과 나머지로 나눈다", () => {
  assert.deepEqual(splitLine("흐름 정상 · 지난 6h 착륙 32 · 비행 중 9"), { title: "흐름 정상", rest: "지난 6h 착륙 32 · 비행 중 9" });
  assert.deepEqual(splitLine("흐름 정상"), { title: "흐름 정상", rest: "" });
});

test("todoKeysOf: 묶음 열쇠와 줄 key 둘 다 찾는다", () => {
  const todo = [{ key: "LANDING/a", group: "LANDING/머지" }, { key: "LANDING/b", group: "LANDING/머지" }, { key: "STUCK/c" }];
  assert.deepEqual(todoKeysOf(todo, "LANDING/머지"), ["LANDING/a", "LANDING/b"]);
  assert.deepEqual(todoKeysOf(todo, "STUCK/c"), ["STUCK/c"]);
  assert.deepEqual(todoKeysOf(todo, "none"), []);
});

test("ageText: 분·시간·일 한 단위", () => {
  assert.equal(ageText(4), "4m");
  assert.equal(ageText(360), "6h");
  assert.equal(ageText(3 * 1440), "3d");
  assert.equal(ageText(null), "—");
});
