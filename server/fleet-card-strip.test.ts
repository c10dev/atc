import assert from "node:assert/strict";
import { test } from "node:test";
import { LOG_OUTCOME_TEXT, logOutcomeOf, stripOf } from "../web/src/views/fleet/shared.ts";

// FLEET 카드의 LOGBOOK 띠(ATC-325): 막대 하나의 결과와 순서. 순수 함수
const e = (over: Partial<{ pr: unknown; onTime: boolean | null; reverted: boolean }> = {}) => ({ pr: { number: 1 }, onTime: true as boolean | null, reverted: false, ...over });

test("logOutcomeOf: UNEXPECTED > PR 없음 > 지연 > 정시, 모르면 기대치 없음", () => {
  assert.equal(logOutcomeOf(e()), "ontime");
  assert.equal(logOutcomeOf(e({ onTime: false })), "late");
  assert.equal(logOutcomeOf(e({ onTime: null })), "unknown");
  assert.equal(logOutcomeOf(e({ pr: undefined, onTime: false })), "nopr");
  assert.equal(logOutcomeOf(e({ onTime: false }), "unexpected"), "unexpected");
  assert.equal(logOutcomeOf(e({ reverted: true })), "unexpected");
  assert.equal(logOutcomeOf(e(), "inside"), "ontime");
});

test("모든 결과에 읽을 수 있는 말이 있다(색만으로 말하지 않는다)", () => {
  for (const o of ["unexpected", "nopr", "late", "ontime", "unknown"] as const) assert.ok(LOG_OUTCOME_TEXT[o].length > 0);
});

test("stripOf: 가장 새것 14개를 시간 순으로(왼쪽이 오래된 것)", () => {
  const newestFirst = Array.from({ length: 20 }, (_, i) => 20 - i); // 20이 가장 새것
  const s = stripOf(newestFirst);
  assert.equal(s.length, 14);
  assert.equal(s[0], 7);
  assert.equal(s.at(-1), 20);
  assert.deepEqual(stripOf([3, 2, 1]), [1, 2, 3]);
  assert.deepEqual(stripOf([]), []);
});
