import assert from "node:assert/strict";
import { test } from "node:test";
import type { FollowRow, FollowStage } from "./follow.ts";
import { sinceLookOf } from "./since-look.ts";
import { statusOf, type StatusInput } from "./status.ts";

const AT = "2026-10-02T10:00:00.000Z";
const row = (key: string, current: FollowStage | null, over: Partial<FollowRow> = {}): FollowRow =>
  ({ key, title: `${key} 제목`, state: "In Progress", finished: false, current, now: `${key} 지금`, stuck: null, next: null, ...over }) as FollowRow;
const alert = (key: string, level: "warning" | "caution" | "advisory" | null, dest: "alerts" | "queue" | "log" = "alerts", over = {}) => ({ key, level, dest, text: `${key} 문구`, next: "다음", flight: null, link: "#home", ...over });
const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  at: AT,
  sinceLook: sinceLookOf({ lastLook: AT, releases: [], milestones: [], stuckFlights: [], waiting: [] }),
  rows: [],
  alerts: [],
  rts: null,
  tickets: [],
  pulls: [],
  milestones: new Map(),
  ...over,
});

test("빈 상태: 모두 비어 있고 한 번에 같은 모양", () => {
  const s = statusOf(input());
  assert.deepEqual([s.v, s.flying, s.flyingTotal, s.waiting, s.alerts, s.rts, s.since.line], [1, [], 0, [], [], null, ""]);
  assert.equal(s.focus, undefined);
  assert.equal(s.topic, undefined);
});

test("비행 중: Todo 뒤 IN 전, 끝난 줄과 Todo는 뺀다. 단계가 앞선 것이 먼저, 같은 key는 한 번", () => {
  const s = statusOf(input({ rows: [row("ATC-1", "todo"), row("ATC-2", "pr"), row("ATC-3", "ci"), row("ATC-4", "deployed", { finished: true }), row("ATC-2", "pr")] }));
  assert.deepEqual(s.flying.map((f) => [f.key, f.stageLabel]), [["ATC-3", "CLEARED"], ["ATC-2", "PR"]]);
  assert.equal(s.flyingTotal, 2);
});

test("SUPERVISOR 대기는 dest queue, 알림은 WARNING 먼저 CAUTION, advisory는 뺀다", () => {
  const s = statusOf(input({ alerts: [alert("a|1", "caution"), alert("a|2", "warning"), alert("a|3", "advisory"), alert("pending|x", "advisory", "queue"), alert("b|1", null)] }));
  assert.deepEqual(s.waiting.map((w) => w.key), ["pending|x"]);
  assert.deepEqual(s.alerts.map((a) => a.level), ["warning", "caution"]);
});

test("?flight: 단계·PR·막는 FLIGHT·다음 한 걸음. 끝난 막는 FLIGHT는 뺀다", () => {
  const pull = { number: 9, url: "u", ticketKey: "ATC-7", draft: false, landing: "APPROACH" as const, blocks: [{ code: "checks-pending" as const, text: "CI 대기", en: "", findings: undefined }], humanCheck: null };
  const tickets = [
    { key: "ATC-7", title: "일곱", state: "In Progress", stateType: "started" as const, blockedBy: ["ATC-5", "ATC-6"] },
    { key: "ATC-5", title: "다섯", state: "Done", stateType: "completed" as const, blockedBy: [] },
    { key: "ATC-6", title: "여섯", state: "Todo", stateType: "unstarted" as const, blockedBy: [] },
  ];
  const s = statusOf(input({ tickets, pulls: [pull], rows: [row("ATC-7", "pr")], query: { flight: "atc-7" } }));
  assert.equal(s.focus?.key, "ATC-7");
  assert.equal(s.focus?.stageLabel, "PR");
  assert.deepEqual(s.focus?.blockers, ["ATC-6"]);
  assert.equal(s.focus?.pr?.number, 9);
  assert.equal(s.focus?.next, "CI 대기");
});

test("?flight: 보드 줄이 없으면 OOOI의 마지막으로 단계를 정하고, 아무것도 없으면 found false", () => {
  const tickets = [{ key: "ATC-8", title: "여덟", state: "Done", stateType: "completed" as const, blockedBy: [] }];
  const s = statusOf(input({ tickets, milestones: new Map([["ATC-8", { out: "a", off: "b", on: "c", in: null }]]), query: { flight: "ATC-8" } }));
  assert.equal(s.focus?.stageLabel, "ON");
  assert.equal(statusOf(input({ query: { flight: "ATC-99" } })).focus?.found, false);
});

test("?flight: 막힌 글과 보드의 다음 칩이 다음 한 걸음이 된다", () => {
  const stuck = { stage: "sent" as const, code: "sent-no-readback" as const, text: "발송 뒤 READBACK 없음", since: null };
  const s = statusOf(input({ rows: [row("ATC-3", "sent", { stuck, next: { kind: "look", label: "살펴보기", href: "#flights/radio" } })], query: { flight: "ATC-3" } }));
  assert.equal(s.focus?.next, "살펴보기");
  assert.equal(s.focus?.stuck, "발송 뒤 READBACK 없음");
  assert.equal(statusOf(input({ rows: [row("ATC-3", "sent", { stuck })], query: { flight: "ATC-3" } })).focus?.next, "발송 뒤 READBACK 없음");
});

test("?topic: 비행 중·대기·알림·이슈에서 글이 든 것만", () => {
  const tickets = [{ key: "ATC-30", title: "FLIGHTS 화면", state: "Todo", stateType: "unstarted" as const, blockedBy: [] }, { key: "ATC-31", title: "다른 일", state: "Todo", stateType: "unstarted" as const, blockedBy: [] }];
  const s = statusOf(input({ tickets, rows: [row("ATC-30", "pr", { title: "FLIGHTS 화면" }), row("ATC-31", "pr")], alerts: [alert("a|1", "caution", "alerts", { text: "FLIGHTS 막힘" })], query: { topic: "flights" } }));
  assert.deepEqual(s.topic?.flying.map((f) => f.key), ["ATC-30"]);
  assert.equal(s.topic?.alerts.length, 1);
  assert.deepEqual(s.topic?.issues.map((i) => i.key), ["ATC-30"]);
});
