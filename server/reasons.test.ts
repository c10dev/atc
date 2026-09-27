import assert from "node:assert/strict";
import { test } from "node:test";
import { composeReason, parseReasonCodes, REASON_CODES, reasonCountsOf } from "./reasons.ts";

test("사유 칩 목록: 8개 이하, code는 소문자 kebab이고 겹치지 않는다", () => {
  assert.ok(REASON_CODES.length <= 8);
  assert.ok(REASON_CODES.every((r) => /^[a-z]+(?:-[a-z]+)*$/.test(r.code) && r.label));
  assert.equal(new Set(REASON_CODES.map((r) => r.code)).size, REASON_CODES.length);
});

test("사유 칩 입력: 없으면 빈 목록, 모르는 code·배열 아님은 오류, 중복 빼고 목록 순서", () => {
  assert.deepEqual(parseReasonCodes(undefined), []);
  assert.deepEqual(parseReasonCodes(null), []);
  assert.deepEqual(parseReasonCodes([]), []);
  assert.deepEqual(parseReasonCodes(["other", "already-done", "other"]), ["already-done", "other"]);
  assert.throws(() => parseReasonCodes(["done"]), /모르는 사유 code: done/);
  assert.throws(() => parseReasonCodes("already-done"), /문자열 배열/);
  assert.throws(() => parseReasonCodes([1]), /문자열 배열/);
});

test("reason 조합: 칩 이름 · 로 잇고 — 뒤에 자유 사유, 한쪽만 있으면 그것만, 둘 다 없으면 null", () => {
  assert.equal(composeReason(["already-done", "out-of-repo"], "ruleset이 이미 켜짐"), "이미 완료됨 · 저장소 밖 작업 — ruleset이 이미 켜짐");
  assert.equal(composeReason(["no-priority"], null), "우선순위 미정");
  assert.equal(composeReason(["no-priority"], "  "), "우선순위 미정");
  assert.equal(composeReason([], "PR #393 머지 전이면 HOLD"), "PR #393 머지 전이면 HOLD");
  assert.equal(composeReason([], null), null);
});

test("칩별 건수: 목록의 모든 code를 0부터, 칩 없는 판정은 건너뛴다", () => {
  const counts = reasonCountsOf([{ reasonCodes: ["already-done"] }, { reasonCodes: ["already-done", "other"] }, {}, { reasonCodes: ["unknown"] }]);
  assert.equal(counts["already-done"], 2);
  assert.equal(counts.other, 1);
  assert.equal(counts["no-priority"], 0);
  assert.deepEqual(Object.keys(counts), REASON_CODES.map((r) => r.code));
});
