import assert from "node:assert/strict";
import { test } from "node:test";
import { currentModelRate } from "./atfm-run.ts";

test("ATFM 켜는 조건의 CROSSCHECK 일치: 가장 최근 mark의 모델 계열로 보고, unknown은 세지 않는다", () => {
  const at = (h: number) => `2026-09-27T0${h}:00:00Z`;
  const byModel = { "muse-spark-1.3": { marked: 3, matched: 2, rate: 2 / 3 }, unknown: { marked: 5, matched: 5, rate: 1 } };
  const items = [
    { crosscheck: { model: "claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]", at: at(1) } },
    { crosscheck: { model: "unknown", at: at(3) } }, // 더 최근이어도 unknown은 건너뛴다
    { crosscheck: null },
  ];
  assert.deepEqual(currentModelRate(items, byModel), { model: "muse-spark-1.3", marked: 3, matched: 2, rate: 2 / 3 });
  assert.equal(currentModelRate([{ crosscheck: { model: "unknown", at: at(1) } }], byModel), null);
  assert.equal(currentModelRate([], byModel), null);
});
