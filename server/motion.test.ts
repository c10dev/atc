import assert from "node:assert/strict";
import { test } from "node:test";
import { motionOn } from "../web/src/motion.ts";

test("OS가 움직임 줄이기를 요청하면 저장된 설정과 상관없이 끈다", () => {
  assert.equal(motionOn(true, true), false);
  assert.equal(motionOn(false, true), false);
  assert.equal(motionOn(undefined, true), false);
});

test("OS가 요청하지 않으면 저장된 설정을 따른다", () => {
  assert.equal(motionOn(true, false), true);
  assert.equal(motionOn(false, false), false);
});

test("저장된 값이 없으면 켬", () => {
  assert.equal(motionOn(undefined, false), true);
});
