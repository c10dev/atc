import assert from "node:assert/strict";
import { test } from "node:test";
import { tickPlan } from "./atcctl.mjs";

// `atcctl tick <역할>`(ATC-297): 줄을 만들고 ack할 cursor를 정하는 순수 부분
const same = { changed: false, line: "UNCHANGED" };
const changed = { changed: true, line: "CHANGED abcd1234 — CLAUDE.md와 …를 다시 읽은 뒤 `manual ack`" };
const quietRes = { act: false, reasons: [], info: 0, brief: { cursor: "42", events: [] } };
const actRes = { act: true, reasons: ["land", "event:landing.cleared"], info: 0, brief: { cursor: "43", events: [{ id: 1 }] } };

test("조용한 TOWER tick은 한 줄이고 brief의 cursor로 ack한다", () => {
  assert.deepEqual(tickPlan("tower", same, quietRes), { lines: ["TICK QUIET tower — nothing to act on"], ack: "42" });
});

test("조용해도 info 사건 수를 한 줄에 알린다(ack되는 사건)", () => {
  assert.deepEqual(tickPlan("tower", same, { ...quietRes, info: 1 }).lines, ["TICK QUIET tower — nothing to act on (1 info event acked)"]);
  assert.deepEqual(tickPlan("tower", same, { ...quietRes, info: 3 }).lines, ["TICK QUIET tower — nothing to act on (3 info events acked)"]);
});

test("할 일이 있으면 TICK ACT, 이유, 브리핑을 찍고 ack하지 않는다(처리한 뒤 세션이 한다)", () => {
  const p = tickPlan("tower", same, actRes);
  assert.equal(p.ack, null);
  assert.equal(p.lines[0], "TICK ACT tower");
  assert.equal(p.lines[1], "REASONS: land, event:landing.cleared");
  assert.deepEqual(JSON.parse(p.lines[2]), actRes.brief);
});

test("규정이 바뀌었으면 CHANGED를 먼저 찍고, 조용한 브리핑이어도 ack하지 않고 할 일로 보인다", () => {
  const p = tickPlan("tower", changed, quietRes);
  assert.equal(p.lines[0], changed.line);
  assert.equal(p.lines[1], "TICK ACT tower");
  assert.equal(p.lines[2], "REASONS: manual-changed");
  assert.equal(p.ack, null);
  assert.equal(p.lines.some((l) => l.startsWith("TICK QUIET")), false);
  // 할 일이 겹치면 이유도 함께
  assert.equal(tickPlan("tower", changed, actRes).lines[2], "REASONS: manual-changed, land, event:landing.cleared");
});

test("TOWER 밖의 역할은 ack할 cursor가 없다(이 PR에서 /tick을 바꾸지 않는다)", () => {
  assert.deepEqual(tickPlan("mcc", same, { act: false, reasons: [], info: 0, brief: { queue: {} } }), { lines: ["TICK QUIET mcc — nothing to act on"], ack: null });
  assert.equal(tickPlan("review", same, { act: true, reasons: ["pending"], info: 0, brief: { reviews: {} } }).lines[0], "TICK ACT review");
});

test("서버 답이 없거나 이상하면 조용하다고 하지 않는다: 오류는 할 일이고, cursor가 없으면 ack하지 않는다", () => {
  const e = tickPlan("tower", same, { act: true, reasons: ["error"], error: "연결 실패", brief: null });
  assert.equal(e.ack, null);
  assert.deepEqual(e.lines.slice(0, 2), ["TICK ACT tower", "REASONS: error"]);
  assert.match(e.lines[2], /^NOTE: 연결 실패 — 서버가 판정하지 못했다/);
  assert.equal(tickPlan("tower", same, undefined).lines[0], "TICK ACT tower");
  assert.equal(tickPlan("tower", same, {}).lines[0], "TICK ACT tower");
  assert.equal(tickPlan("tower", same, { act: false, reasons: [], info: 0, brief: {} }).ack, null); // cursor 없음
});
