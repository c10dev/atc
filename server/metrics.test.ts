import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { computeMetrics } from "./metrics.ts";
import type { Clearance, TrafficEvent } from "./model.ts";
import { pruneRecords, type RecordLine, readRecords } from "./recorder.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const at = (h: number, m = 0) => new Date(NOW - (12 - h) * 3_600_000 + m * 60_000).toISOString();
let id = 0;
const ev = (t: string, e: Partial<TrafficEvent>): RecordLine => ({
  t, kind: "event", epoch: "e", event: { id: ++id, at: t, kind: "handoff", ...e } as TrafficEvent,
});
const conflict = (t: string, kind: "alert.raised" | "alert.cleared", ws: string) =>
  ev(t, { kind, alertKind: "conflict", workspacePath: ws });
const clr = (issued: string, readback: string | null, cancelled = false): Clearance => ({
  id: `C-${++id}`, at: issued, to: "s", toName: "TEAM_B", type: "HOLD", stand: null, flight: null, text: "x",
  readbackAt: readback, cancelledAt: cancelled ? issued : null,
});

test("충돌: 발생·해소 짝짓기, 지속 중앙값, 5분 안에 풀린 비율, 아직 열린 것", () => {
  const records = [
    conflict(at(9), "alert.raised", "/w/a"), conflict(at(9, 3), "alert.cleared", "/w/a"),
    conflict(at(10), "alert.raised", "/w/b"), conflict(at(10, 20), "alert.cleared", "/w/b"),
    conflict(at(11), "alert.raised", "/w/a"),
  ];
  const m = computeMetrics(records, [], NOW, 1);
  assert.equal(m.conflicts.count, 3);
  assert.equal(m.conflicts.open, 1);
  assert.equal(m.conflicts.medianMin, 11.5);
  assert.equal(m.conflicts.shortShare, 0.5);
});

test("착륙 대기와 이벤트 수", () => {
  const records = [
    ev(at(8), { kind: "landing.requested", ticketKey: "VOC-1" }), ev(at(8, 40), { kind: "landing.left", ticketKey: "VOC-1" }),
    ev(at(9), { kind: "landing.requested", ticketKey: "VOC-2" }), ev(at(9, 10), { kind: "landing.left", ticketKey: "VOC-2" }),
    ev(at(11), { kind: "landing.requested", ticketKey: "VOC-3" }),
    ev(at(10), { kind: "handoff" }), ev(at(10), { kind: "session.lost" }), ev(at(10), { kind: "away.started" }),
  ];
  const m = computeMetrics(records, [], NOW, 1);
  assert.deepEqual(m.landing, { requests: 3, landed: 2, waiting: 1, medianWaitMin: 25, maxWaitMin: 40 });
  assert.equal(m.handoffs, 1);
  assert.equal(m.lost, 1);
  assert.equal(m.away, 1);
});

test("관제 지시: 복창률은 취소 제외, 늦은 복창·미복창은 overdue", () => {
  const cs = [clr(at(9), at(9, 2)), clr(at(9), at(9, 4)), clr(at(10), at(10, 30)), clr(at(11), null), clr(at(11), null, true)];
  const m = computeMetrics([], cs, NOW, 1);
  assert.equal(m.clearances.issued, 5);
  assert.equal(m.clearances.readBack, 3);
  assert.equal(m.clearances.readbackRate, 0.75);
  assert.equal(m.clearances.readbackMedianMin, 4);
  assert.equal(m.clearances.overdue, 2);
  assert.equal(m.clearances.cancelled, 1);
});

test("2단계 점검: 표본이 적으면 데이터 부족, TOWER 운용 일수는 ack가 있던 날", () => {
  const acks: RecordLine[] = [0, 1, 2].map((d) => ({ t: new Date(NOW - d * 86_400_000).toISOString(), kind: "ack", consumer: "controller" }));
  const m = computeMetrics(acks, [clr(at(9), at(9, 1))], NOW, 7);
  const byId = Object.fromEntries(m.readiness.map((r) => [r.id, r.status]));
  assert.deepEqual(byId, { "tower-days": "pass", "readback-rate": "insufficient", "readback-median": "insufficient", "short-conflicts": "insufficient" });
  assert.equal(m.daily.length, 7);
  assert.deepEqual(m.daily.filter((d) => d.towerActive).map((d) => d.date), ["2026-09-24", "2026-09-25", "2026-09-26"]);
});

test("범위 밖 기록은 빼고, 표본이 많으면 줄인다", () => {
  const samples: RecordLine[] = Array.from({ length: 600 }, (_, i) => ({
    t: new Date(NOW - i * 60_000).toISOString(), kind: "sample",
    airborne: 2, holding: 1, claims: 4, conflicts: 0, alerts: 3, landing: 1, pendingClearances: 0,
  }));
  const old = ev(new Date(NOW - 3 * 86_400_000).toISOString(), { kind: "handoff" });
  const m = computeMetrics([...samples, old], [], NOW, 1);
  assert.equal(m.handoffs, 0);
  assert.ok(m.series.length <= 240);
  assert.equal(m.series[0].claims, 4);
  assert.ok(m.series[0].t < m.series.at(-1)!.t);
});

test("블랙박스: 날짜 파일에서 범위만 읽고, 30일 지난 파일은 지운다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-rec-"));
  writeFileSync(join(dir, "2026-08-01.jsonl"), JSON.stringify({ t: "2026-08-01T00:00:00.000Z", kind: "ack", consumer: "c" }) + "\n");
  writeFileSync(join(dir, "2026-09-25.jsonl"), [
    JSON.stringify({ t: "2026-09-25T01:00:00.000Z", kind: "ack", consumer: "c" }),
    JSON.stringify({ t: "2026-09-25T23:00:00.000Z", kind: "ack", consumer: "c" }),
    "{broken",
  ].join("\n") + "\n");
  assert.deepEqual(readRecords(Date.parse("2026-09-25T12:00:00.000Z"), dir).map((r) => r.t), ["2026-09-25T23:00:00.000Z"]);
  pruneRecords(NOW, dir);
  assert.deepEqual(readdirSync(dir), ["2026-09-25.jsonl"]);
});
