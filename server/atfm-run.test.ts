import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ATFM, type GroundStop } from "./atfm.ts";
import { approvalRunOf, currentModelRate, releasedBy, stopFiguresOf } from "./atfm-run.ts";
import type { RecordLine } from "./recorder.ts";

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

test("두 번째 트리거 입력(ATC-62): atfm ci 줄 → 체크 소요 시간 추세, LOS 이벤트 → 24시간 수", () => {
  const NOW = Date.parse("2026-09-28T12:00:00Z");
  const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
  const ci = (min: number, minutes: number, airport = "VCDO") => ({ t: at(min), kind: "atfm" as const, op: "ci", airport, data: { pr: 1, minutes } });
  const los = (min: number, workspacePath: string) => ({ t: at(min), kind: "event" as const, epoch: "e", event: { id: 1, at: at(min), kind: "alert.raised", alertKind: "conflict", workspacePath } });
  const lines = [
    ...Array.from({ length: 10 }, (_, i) => ci(-300 - i * 60, 10)),
    ci(-10, 30), ci(-20, 30), ci(-30, 30),
    ci(-10, 99, "ATCC"),
    los(-60, "/w/a"), los(-120, "/w/a"), los(-2000, "/w/a"),
  ] as unknown as RecordLine[];
  const f = stopFiguresOf(lines, [{ code: "VCDO", repo: "/p/v" }, { code: "ATCC", repo: "/p/atc" }], (s) => (s === "/w/a" ? "/p/v" : null), NOW);
  assert.deepEqual([...f.ciTrend], [["/p/v", { recentMin: 30, baselineMin: 10, recentN: 3, baselineN: 10 }]]);
  assert.deepEqual([...f.losDay], [["/p/v", 2]]);
});

test("ground-release 사유(ATC-62): 스위치를 끔, 30분 기준 아래, 통과 PR 2개, 트리거가 풀림, 재시작 전 것", () => {
  const g = (trigger: GroundStop["trigger"], clearSince: string | null = null): GroundStop => ({ airport: "VCDO", repo: "/p/v", trigger, kind: "stop", land: true, enforced: true, text: "", evidence: [], since: "t", clearSince });
  const on = { ...DEFAULT_ATFM, groundStop: { ...DEFAULT_ATFM.groundStop, congestion: "on" as const, failureWave: "on" as const } };
  assert.equal(releasedBy(undefined, on), "restart");
  assert.equal(releasedBy(g("congestion", "x"), on), "30-min-below");
  assert.equal(releasedBy(g("failure-wave", "x"), on), "passed-in-2-prs");
  assert.equal(releasedBy(g("main-broken"), on), "cleared");
  assert.equal(releasedBy(g("los", "x"), { ...on, groundStop: { ...on.groundStop, los: "off" } }), "switched-off");
});
