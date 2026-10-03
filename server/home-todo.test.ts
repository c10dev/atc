import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowInput } from "./home-flow.ts";
import { flowViewOf } from "./home-flow.ts";
import type { QueueItem } from "./supervisor-queue.ts";
import { ageShort, groupLines, lineItems, lineKeyOf, locateTodo, planOf, todoDomId } from "../web/src/home-todo.ts";

// HOME 묶은 할 일(ATC-503): 화면의 순수 계산. 서버(flowViewOf)가 정한 순서·묶음을 그대로 쓰고, 거른 목록만 같은 규칙으로 다시 묶는다
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const item = (kind: QueueItem["kind"], key: string, over: Partial<QueueItem> = {}): QueueItem =>
  ({ kind, key, since: ago(30), title: `t ${key}`, hash: "#home", primary: { action: "open", label: "열기" }, ...over }) as QueueItem;
const input = (queue: QueueItem[]): FlowInput => ({ now: NOW, airports: [{ code: "ATCC", name: "atc" }], rows: [], pulls: [], landings: [], stops: [], mainRed: [], queue });

// LANDING 8건(한 묶음), 승인 4줄(필요가 달라 각각), BACKLOG 두 건(한 묶음), UPDATE 한 건: 묶은 뒤 7줄, 5줄만 보인다
const queue = [
  ...Array.from({ length: 8 }, (_, i) => item("LANDING", `atc#${i}@h${i}`, { since: ago(300 - i), primary: { action: "open", label: "PR 열기" } })),
  ...["a", "b", "c", "d"].map((k, i) => item("PROPOSAL", `R-${k}`, { since: ago(100 - i), primary: { action: "approve", label: `승인 ${k}` } })),
  item("BACKLOG", "ATC-9", { since: ago(5) }),
  item("BACKLOG", "ATC-8", { since: ago(4) }),
  item("UPDATE", "u1", { since: ago(3) }),
];
const flow = flowViewOf(input(queue));

test("거르지 않으면 서버의 5줄과 나머지 글 그대로, 접힌 줄은 같은 순서의 나머지", () => {
  const plan = planOf(flow, null);
  assert.deepEqual(plan.shown, flow.todoLines);
  assert.equal(plan.shown.length, 5);
  assert.equal(plan.restText, "나머지 3건 BACKLOG 2 · UPDATE 1");
  assert.deepEqual(plan.rest.map((l) => (l.type === "group" ? `${l.kind}×${l.count}` : l.item.kind)), ["BACKLOG×2", "UPDATE"]);
  // 보이는 줄과 접힌 줄을 합치면 todo 전체이고, 서버가 보낸 순서를 바꾸지 않는다
  assert.deepEqual([...plan.shown, ...plan.rest].flatMap(lineItems).map((t) => t.key).sort(), flow.todo.map((t) => t.key).sort());
});

test("같은 묶음 규칙: 서버의 todoLines와 groupLines(todo)의 앞 5줄이 같다", () => {
  assert.deepEqual(groupLines(flow.todo).slice(0, flow.todoLines.length), flow.todoLines);
});

test("묶음 줄은 첫 항목 자리, 묶음 안의 항목은 서버 순서(오래된 것 먼저)", () => {
  const lines = groupLines(flow.todo);
  const g = lines[0]!;
  assert.equal(g.type, "group");
  if (g.type !== "group") return;
  assert.equal(g.count, 8);
  assert.equal(g.groupNeed, "SUPERVISOR 머지 필요");
  assert.deepEqual(g.items.map((t) => t.key), flow.todo.filter((t) => t.group === g.group).map((t) => t.key));
  assert.equal(g.oldestMin, Math.max(...g.items.map((t) => t.ageMin)));
});

test("종류로 거르면 순서를 지킨 채 다시 묶고 접지 않는다", () => {
  const keep = (t: { kind: string }) => t.kind === "LANDING" || t.kind === "PROPOSAL";
  const plan = planOf(flow, keep);
  assert.equal(plan.rest.length, 0);
  assert.equal(plan.restText, null);
  assert.deepEqual(plan.shown.map((l) => (l.type === "group" ? `${l.kind}×${l.count}` : l.item.kind)), ["LANDING×8", "PROPOSAL", "PROPOSAL", "PROPOSAL", "PROPOSAL"]);
  const only = planOf(flow, (t) => t.kind === "BACKLOG");
  assert.deepEqual(only.shown.map(lineKeyOf), ["BACKLOG/열기"]);
  assert.equal(planOf(flow, () => false).shown.length, 0);
});

test("흐름판 칸의 링크: 묶음 열쇠나 항목 key로 어느 줄인지, 접힌 쪽인지 찾는다", () => {
  const plan = planOf(flow, null);
  const landing = plan.shown[0]!;
  assert.deepEqual(locateTodo(plan, lineKeyOf(landing)), { where: "shown", line: lineKeyOf(landing), item: null });
  const inside = lineItems(landing)[3]!.key;
  assert.deepEqual(locateTodo(plan, inside), { where: "shown", line: lineKeyOf(landing), item: inside });
  assert.deepEqual(locateTodo(plan, "BACKLOG/ATC-9"), { where: "rest", line: "BACKLOG/열기", item: "BACKLOG/ATC-9" });
  assert.deepEqual(locateTodo(plan, "UPDATE/u1"), { where: "rest", line: "UPDATE/u1", item: null });
  assert.equal(locateTodo(plan, "NOPE/none"), null);
});

test("나이 글자: 가장 큰 단위 하나", () => {
  assert.deepEqual([0, 45, 59, 60, 360, 1439, 1440, 4400].map(ageShort), ["0m", "45m", "59m", "1h", "6h", "24h", "1d", "3d"]);
  assert.equal(ageShort(-5), "0m");
});

test("줄 id: 같은 열쇠는 같은 id, 공백·슬래시·# 같은 글자는 빠진다", () => {
  assert.equal(todoDomId("LANDING/PR 열기"), todoDomId("LANDING/PR 열기"));
  assert.match(todoDomId("LANDING/PR 열기"), /^home-todo-[A-Za-z0-9가-힣_-]+$/);
  assert.notEqual(todoDomId("a/b"), todoDomId("a/c"));
  assert.doesNotMatch(todoDomId("atc#1@h1/x y"), /[#@/ ]/);
});
