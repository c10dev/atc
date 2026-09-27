import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalRunOf, currentModelRate } from "./atfm-run.ts";

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

test("켜는 조건 2b·S2: approval 운용 기간을 FLIGHT RECORDER의 마지막 mode: 전환에서 잰다, 잴 수 없으면 확인 필요", () => {
  const NOW = Date.parse("2026-09-27T12:00:00Z");
  const dayAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
  const recs = [
    { t: dayAgo(20), kind: "dispatch", op: "mode:approval", id: "-" },
    { t: dayAgo(18), kind: "dispatch", op: "mode:shadow", id: "-" },
    { t: dayAgo(15), kind: "dispatch", op: "mode:approval", id: "-" },
    { t: dayAgo(3), kind: "schedule", op: "mode:approval", id: "-" },
    { t: dayAgo(1), kind: "dispatch", op: "release", id: "D-0001" },
  ];
  const d = approvalRunOf(recs, "dispatch", "approval", NOW);
  assert.equal(d.status, "pass");
  assert.equal(d.since, dayAgo(15)); // 중간에 shadow로 돌아갔으면 마지막 전환부터
  assert.equal(approvalRunOf(recs, "schedule", "approval", NOW).status, "insufficient");
  assert.equal(approvalRunOf(recs, "schedule", "shadow", NOW).status, "fail");
  assert.equal(approvalRunOf([], "dispatch", "approval", NOW).status, "check"); // 기록 없음(파일을 직접 고쳤거나 30일 밖)
  assert.equal(approvalRunOf([{ t: dayAgo(2), kind: "dispatch", op: "mode:shadow" }], "dispatch", "approval", NOW).status, "check"); // 기록과 지금 모드가 다름
});
