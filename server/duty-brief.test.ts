import assert from "node:assert/strict";
import test from "node:test";
import { briefMaxCharsOf, DEFAULT_BRIEF_MAX_CHARS, type DutyBriefInput, dutyBriefOf } from "./duty-brief.ts";

const AT = "2026-09-30T12:00:00.000Z";
const base = (): DutyBriefInput => ({
  at: AT,
  queue: {
    count: 3,
    counts: { PROPOSAL: 2, LANDING: 1, UPDATE: 0 },
    items: [
      { kind: "LANDING", key: "r#12", since: "2026-09-30T11:00:00.000Z", title: "PR #12 ATC-5" },
      { kind: "PROPOSAL", key: "D-0007", since: "2026-09-30T09:00:00.000Z", title: "ASSIGN ATC-9 → TEAM_A" },
      { kind: "PROPOSAL", key: "D-0008", since: null, title: "ASSIGN ATC-10" },
    ],
  },
  alerts: [{ key: "alert|x", level: "warning", aircraft: "TEAM_B", flight: "ATC-3", text: "NORDO\nfor   40 min", since: null }],
  fleet: [
    { registration: "TEAM_A", status: "AIRBORNE", airport: "ATCC", account: "acct-2", flight: "ATC-9", more: 1, fuelHold: false },
    { registration: "TEAM_B", status: "HOLDING", airport: null, account: null, flight: null, more: 0, fuelHold: true },
  ],
  flights: [{ key: "ATC-9", state: "In Progress" }],
  fuel: [{ account: "acct-2", window: "seven_day", pct: 81.6, resetsAt: "2026-10-02T00:00:00Z", level: "info" }],
});

test("brief: 큐 수(0은 뺀다)·가장 오래 기다린 줄부터·알림·FLEET·FUEL·FLIGHT를 한 장에", () => {
  const b = dutyBriefOf(base());
  assert.equal(b.truncated, false);
  assert.equal(b.chars, b.text.length);
  const t = b.text.split("\n");
  assert.match(t[0], /^DUTY BRIEF 2026-09-30T12:00:00.000Z/);
  assert.ok(t.includes("QUEUE 3 · PROPOSAL 2 · LANDING 1"));
  assert.ok(t.indexOf("  PROPOSAL D-0007 — ASSIGN ATC-9 → TEAM_A (waiting 3h)") < t.indexOf("  LANDING r#12 — PR #12 ATC-5 (waiting 1h)"));
  assert.ok(t.some((l) => l === "  WARNING alert|x TEAM_B ATC-3 — NORDO for 40 min"), "알림 문구는 한 줄로");
  assert.ok(t.includes("  TEAM_A AIRBORNE ATCC ATC-9 +1 acct-2"));
  assert.ok(t.includes("  TEAM_B HOLDING FUEL-HOLD"));
  assert.ok(t.includes("  acct-2 seven_day 82% resets 2026-10-02T00:00:00Z (info)"));
  assert.ok(t.includes("  ATC-9 In Progress"));
});

test("brief: 상한 안이면 안 자른다, 넘으면 뒤쪽 구역부터 줄을 덜고 잘렸다고 적는다", () => {
  const big = base();
  big.fleet = Array.from({ length: 200 }, (_, i) => ({ registration: `TEAM_${i}`, status: "PARKED", airport: "ATCC", account: "acct-1", flight: null, more: 0, fuelHold: false }));
  big.flights = Array.from({ length: 50 }, (_, i) => ({ key: `ATC-${i}`, state: "In Progress" }));
  const b = dutyBriefOf(big, 1500);
  assert.equal(b.truncated, true);
  assert.ok(b.text.length <= 1500, `${b.text.length}`);
  assert.match(b.text, /\[brief cut at 1500 chars: rows dropped from FLIGHTS, FUEL, FLEET\]$|\[brief cut at 1500 chars: rows dropped from FLIGHTS(, FUEL)?(, FLEET)?\]$/);
  assert.ok(b.text.includes("QUEUE 3"), "앞쪽 구역(QUEUE)은 남는다");
  assert.ok(b.text.includes("ALERTS 1"));
});

test("brief: 큐 줄이 많으면 8줄까지, 알림은 10줄까지 보이고 나머지 수를 적는다", () => {
  const b = base();
  b.queue = { count: 12, counts: { PROPOSAL: 12 }, items: Array.from({ length: 12 }, (_, i) => ({ kind: "PROPOSAL", key: `D-${i}`, since: AT, title: "t" })) };
  b.alerts = Array.from({ length: 14 }, (_, i) => ({ key: `alert|${i}`, level: "caution", aircraft: null, flight: null, text: "x", since: null }));
  const t = dutyBriefOf(b).text.split("\n");
  assert.equal(t.filter((l) => l.startsWith("  PROPOSAL")).length, 8);
  assert.ok(t.includes("  … 4 more in GET /api/supervisor/queue"));
  assert.equal(t.filter((l) => l.startsWith("  CAUTION")).length, 10);
  assert.ok(t.includes("  … 4 more"));
});

test("brief: 티켓·PR 본문 자리가 없다(입력에 title은 큐 줄 하나뿐이고 100자로 자른다)", () => {
  const b = base();
  b.queue.items[0].title = "x".repeat(500);
  const line = dutyBriefOf(b).text.split("\n").find((l) => l.includes("r#12"))!;
  assert.ok(line.length < 160, `${line.length}`);
});

test("briefMaxChars: 정수 500~50,000만, 아니면 기본 6,000", () => {
  assert.equal(DEFAULT_BRIEF_MAX_CHARS, 6000);
  assert.equal(briefMaxCharsOf(undefined), 6000);
  assert.equal(briefMaxCharsOf("9000"), 6000);
  assert.equal(briefMaxCharsOf(100), 6000);
  assert.equal(briefMaxCharsOf(1e9), 6000);
  assert.equal(briefMaxCharsOf(2500.5), 6000);
  assert.equal(briefMaxCharsOf(2500), 2500);
});
