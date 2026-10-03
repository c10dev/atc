import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, type TouchInput, touchesView, utcDay } from "./touches.ts";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const empty: TouchInput = { releases: [], relays: [], proposals: [], schedule: [], fleetPlan: [], mcc: [], autoland: [] };
const row = (inp: TouchInput, day: string, days = 3) => touchesView(inp, NOW, days).rows.find((r) => r.day === day)!;

test("범주마다 한 줄씩 센다: release·RELAY·FLEET·card(proposals·schedule)", () => {
  const inp: TouchInput = {
    ...empty,
    releases: [
      { op: "release", at: "2026-10-03T01:00:00Z" },
      { op: "other", at: "2026-10-03T01:00:00Z" },
    ],
    relays: [
      { op: "create", at: "2026-10-03T02:00:00Z" },
      { op: "issued", at: "2026-10-03T02:00:00Z" },
    ],
    fleetPlan: [
      { op: "approve", by: "SUPERVISOR", at: "2026-10-03T03:00:00Z" },
      { op: "approve", by: "auto", at: "2026-10-03T03:00:00Z" },
      { op: "create", at: "2026-10-03T03:00:00Z" },
    ],
    proposals: [
      { op: "approve", via: "manual", at: "2026-10-03T04:00:00Z" },
      { op: "approve", via: "auto", at: "2026-10-03T04:00:00Z" },
      { op: "approve", via: "crosscheck", at: "2026-10-03T04:00:00Z" },
    ],
    schedule: [
      { op: "verdict", via: "manual", at: "2026-10-03T05:00:00Z" },
      { op: "approve", via: "auto", at: "2026-10-03T05:00:00Z" },
    ],
    mcc: [{ op: "land", result: "ok", pr: 1, at: "2026-10-03T06:00:00Z" }],
  };
  const r = row(inp, "2026-10-03");
  assert.equal(r.counts.release, 1);
  assert.equal(r.counts.relay, 1);
  assert.equal(r.counts.fleet, 1);
  assert.equal(r.counts.card, 2);
  assert.equal(r.gate, 1);
  assert.equal(r.leaks, 4);
  assert.equal(r.touches, 5);
  assert.equal(r.landed, 1);
  assert.equal(r.perPr, 5);
  assert.equal(r.leaksPerPr, 4);
});

test("기록이 없는 범주는 0이 아니라 null", () => {
  const r = row(empty, "2026-10-03");
  for (const c of CATEGORIES) assert.equal(r.counts[c.id], c.source ? 0 : null, c.id);
  for (const id of ["merge", "linear", "duty"] as const) assert.equal(r.counts[id], null);
});

test("착륙이 0인 날은 0으로 나누지 않고 null(—)", () => {
  const r = row({ ...empty, relays: [{ op: "create", at: "2026-10-02T10:00:00Z" }] }, "2026-10-02");
  assert.equal(r.landed, 0);
  assert.equal(r.touches, 1);
  assert.equal(r.perPr, null);
  assert.equal(r.leaksPerPr, null);
});

test("UTC 하루 경계: 23:59:59.999Z는 그날, 00:00:00Z는 다음 날, 오프셋 시각도 UTC로", () => {
  assert.equal(utcDay("2026-10-02T23:59:59.999Z"), "2026-10-02");
  assert.equal(utcDay("2026-10-03T00:00:00.000Z"), "2026-10-03");
  assert.equal(utcDay("2026-10-03T08:30:00+09:00"), "2026-10-02");
  assert.equal(utcDay("not a time"), null);
  const inp: TouchInput = {
    ...empty,
    relays: [
      { op: "create", at: "2026-10-02T23:59:59.999Z" },
      { op: "create", at: "2026-10-03T00:00:00Z" },
      { op: "create", at: "깨진 시각" },
    ],
  };
  assert.equal(row(inp, "2026-10-02").counts.relay, 1);
  assert.equal(row(inp, "2026-10-03").counts.relay, 1);
});

test("착륙: 같은 PR은 하루에 한 번, MCC와 AUTOLAND 합, 실패는 제외", () => {
  const inp: TouchInput = {
    ...empty,
    mcc: [
      { op: "land", result: "ok", pr: 5, at: "2026-10-03T01:00:00Z" },
      { op: "land", result: "ok", pr: 5, at: "2026-10-03T02:00:00Z" },
      { op: "land", result: "failed", pr: 6, at: "2026-10-03T02:00:00Z" },
      { op: "would-land", result: "ok", pr: 7, at: "2026-10-03T02:00:00Z" },
    ],
    autoland: [
      { op: "merge", result: "ok", slug: "a/b", number: 5, at: "2026-10-03T03:00:00Z" },
      { op: "update", result: "ok", slug: "a/b", number: 9, at: "2026-10-03T03:00:00Z" },
    ],
    relays: [
      { op: "create", at: "2026-10-03T04:00:00Z" },
      { op: "create", at: "2026-10-03T04:01:00Z" },
      { op: "create", at: "2026-10-03T04:02:00Z" },
    ],
  };
  const r = row(inp, "2026-10-03");
  assert.equal(r.landed, 2);
  assert.equal(r.perPr, 1.5);
});

test("기간 밖 기록은 무시하고 오늘부터 days개 날을 돌려준다", () => {
  const v = touchesView({ ...empty, relays: [{ op: "create", at: "2026-09-01T00:00:00Z" }] }, NOW, 3);
  assert.deepEqual(
    v.rows.map((r) => r.day),
    ["2026-10-03", "2026-10-02", "2026-10-01"],
  );
  assert.ok(v.rows.every((r) => r.counts.relay === 0));
});

test("gate는 release 하나, 나머지는 leak", () => {
  assert.deepEqual(
    CATEGORIES.filter((c) => c.side === "gate").map((c) => c.id),
    ["release"],
  );
});
