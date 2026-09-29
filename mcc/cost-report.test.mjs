import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectedIn, report, rowOf } from "./cost-report.mjs";

const table = { models: { m: { in: 10, out: 50, readMult: 0.1 } }, writeMult: { "5m": 1.25, "1h": 2 }, multipliers: {} };
const rec = (t, sidechain, o = {}) => ({ t, sidechain, model: "m", speed: null, geo: null, input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, ...o });
const since = Date.parse("2026-01-01T00:00:00Z");
const until = Date.parse("2026-01-01T01:00:00Z");

test("cost-report: 구간 안 요청만 세고, 하위 에이전트 $를 PR당에 넣는다", () => {
  const rs = [
    rec("2026-01-01T00:10:00Z", false, { input: 100_000 }), // $1.00
    rec("2026-01-01T00:20:00Z", false, { cacheRead: 1_000_000, output: 10_000 }), // $1.00 + $0.50
    rec("2026-01-01T00:30:00Z", true, { input: 200_000 }), // $2.00 (하위 에이전트)
    rec("2026-01-01T02:00:00Z", false, { input: 999_999_999 }), // 구간 밖
    rec("2026-01-01T00:40:00Z", false, { model: "x", input: 5 }), // 값 없는 모델
  ];
  const r = report(rs, { since, until, inspected: 2, table });
  assert.equal(r.mainCalls, 3);
  assert.equal(r.subCalls, 1);
  assert.equal(r.usdMain, 2.5);
  assert.equal(r.usdSub, 2);
  assert.equal(r.usdPerHour, 4.5);
  assert.equal(r.usdPerInspected, 2.25);
  assert.equal(r.avgContext, Math.round((100_000 + 1_000_000 + 5) / 3));
  assert.equal(r.unpriced, 1);
  assert.equal(report([], { since, until, inspected: 0, table }).usdPerInspected, null);
  assert.match(rowOf("after", r), /^\| after \| \d+ \| 4\.5 \| 2\.25 \| 2 \| 3 \+ 1 \|$/);
});

test("cost-report: 구간 안 INSPECTION은 PR+head 하나씩", () => {
  const mcc = [
    { op: "inspect", pr: 1, head: "a", at: "2026-01-01T00:05:00Z" },
    { op: "inspect", pr: 1, head: "a", at: "2026-01-01T00:06:00Z" },
    { op: "inspect", pr: 2, head: "b", at: "2026-01-01T00:07:00Z" },
    { op: "inspect", pr: 3, head: "c", at: "2026-01-02T00:07:00Z" },
    { op: "land", pr: 1, at: "2026-01-01T00:08:00Z" },
  ];
  assert.equal(inspectedIn(mcc, since, until), 2);
});
