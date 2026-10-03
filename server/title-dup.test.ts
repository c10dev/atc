import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "./model.ts";
import type { RecordLine } from "./recorder.ts";
import { duplicateCountsOf, openDuplicateOf, possibleDuplicateOf, twinAlreadyFired } from "./title-dup.ts";

// 비슷한 제목 검사(ATC-488). 사례는 2026-10-03: ATC-475와 ATC-476은 같은 작업 지시서를 1초 간격으로 올린 것이다
const NOW = Date.parse("2026-10-03T12:00:00Z");
const tk = (key: string, title: string, stateType: Ticket["stateType"] = "backlog", over: Partial<Ticket> = {}): Ticket =>
  ({ key, title, state: stateType, stateType, updatedAt: "2026-10-03T00:00:00Z", createdAt: "2026-10-03T00:00:00Z", blockedBy: [], blocks: [], related: [], labels: [], children: [], parent: null, ...over }) as Ticket;
const TITLE = "Release shows hand-filed Backlog issues in a folded PARKED section with a fire button";

test("쌍: 1초 간격으로 올라온 같은 제목은 열린 쌍으로 잡힌다(ATC-475 / ATC-476)", () => {
  const tickets = [tk("ATC-475", TITLE, "backlog", { createdAt: "2026-10-03T03:00:00Z" })];
  assert.deepEqual(openDuplicateOf(TITLE, tickets, NOW), { key: "ATC-475", title: TITLE });
  // 비슷하지만 같지 않은 제목도(겹치는 낱말이 많다)
  assert.equal(openDuplicateOf("Release shows hand-filed Backlog issues in a folded PARKED section", tickets, NOW)?.key, "ATC-475");
  assert.equal(openDuplicateOf("Cap memory of the background-session scope", tickets, NOW), null);
});

test("쌍: 취소·중복·끝난 이슈와 다른 팀 이슈는 세지 않는다", () => {
  const twin = (key: string, st: Ticket["stateType"]) => tk(key, TITLE, st);
  for (const st of ["canceled", "duplicate", "completed"] as const) assert.equal(openDuplicateOf(TITLE, [twin("ATC-1", st)], NOW), null, st);
  assert.equal(openDuplicateOf(TITLE, [tk("VOC-1", TITLE, "backlog")], NOW), null);
  assert.equal(openDuplicateOf(TITLE, [twin("ATC-1", "canceled"), twin("ATC-2", "unstarted")], NOW)?.key, "ATC-2");
});

test("PARKED 표시: 자기 자신은 빼고 열린 쌍과 최근 끝난 쌍을 가리킨다. 취소·중복 쌍은 가리키지 않는다", () => {
  const a = tk("ATC-475", TITLE);
  const b = tk("ATC-476", TITLE);
  assert.equal(possibleDuplicateOf(a, [a, b], NOW)?.key, "ATC-476");
  assert.equal(possibleDuplicateOf(b, [a, b], NOW)?.key, "ATC-475");
  assert.equal(possibleDuplicateOf(a, [a], NOW), null); // 자기 자신뿐
  assert.equal(possibleDuplicateOf(a, [a, tk("ATC-476", TITLE, "canceled")], NOW), null); // 취소된 쌍
  assert.equal(possibleDuplicateOf(a, [a, tk("ATC-476", TITLE, "duplicate")], NOW), null);
  assert.equal(possibleDuplicateOf(a, [a, tk("ATC-470", TITLE, "completed", { updatedAt: "2026-10-02T00:00:00Z" })], NOW)?.key, "ATC-470"); // 최근에 끝난 쌍
  assert.equal(possibleDuplicateOf(a, [a, tk("ATC-470", TITLE, "completed", { updatedAt: "2026-06-01T00:00:00Z", createdAt: "2026-05-01T00:00:00Z" })], NOW), null); // 오래전에 끝난 쌍
  assert.equal(possibleDuplicateOf(a, [a, tk("VOC-1", TITLE)], NOW), null);
});

test("세기: 7일 안의 거절·넘김·둘 다 발권만 센다", () => {
  const line = (event: "refused" | "override" | "both-fired", daysAgo: number): RecordLine => ({ t: new Date(NOW - daysAgo * 86_400_000).toISOString(), kind: "policy", op: "duplicate-title", event, flight: "ATC-2", of: "ATC-1" });
  const other: RecordLine = { t: new Date(NOW).toISOString(), kind: "policy", op: "duplicate-title-mode", by: "SUPERVISOR", from: "on", to: "off" };
  assert.deepEqual(duplicateCountsOf([line("refused", 1), line("refused", 2), line("override", 1), line("both-fired", 6), line("both-fired", 8), line("override", 30), other], NOW), { refused: 2, overrides: 1, bothFired: 1 });
  assert.deepEqual(duplicateCountsOf([], NOW), { refused: 0, overrides: 0, bothFired: 0 });
});

test("둘 다 발권: 쌍이 Todo 이상이고 취소·중복이 아니면 이미 쏜 것", () => {
  assert.equal(twinAlreadyFired(tk("ATC-1", "x", "unstarted")), true);
  assert.equal(twinAlreadyFired(tk("ATC-1", "x", "started")), true);
  assert.equal(twinAlreadyFired(tk("ATC-1", "x", "backlog")), false);
  assert.equal(twinAlreadyFired(tk("ATC-1", "x", "canceled")), false);
  assert.equal(twinAlreadyFired(undefined), false);
});
