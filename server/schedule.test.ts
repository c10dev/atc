import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "./model.ts";
import { candidatesOf, changesOf, draftOps, fold, gateOf, parsePayload, ScheduleError, syncLines } from "./schedule.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (key: string, over: Partial<Ticket> = {}) =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", labels: [], priority: 3, project: "Beta Readiness", url: null, ...over }) as Ticket;

test("CLASSIFY·PRIORITIZE 입력 검사", () => {
  assert.deepEqual(parsePayload("CLASSIFY", { type: "maint", wake: "h", ratings: ["sec", "SEC"] }), { kind: "CLASSIFY", payload: { type: "MAINT", wake: "H", ratings: ["SEC"] } });
  assert.deepEqual(parsePayload("PRIORITIZE", { priority: "2" }), { kind: "PRIORITIZE", payload: { priority: 2 } });
  assert.throws(() => parsePayload("CLOSE", {}), /모르는 SCHEDULE 작업/);
  assert.throws(() => parsePayload("CLASSIFY", {}), /하나 이상/);
  assert.throws(() => parsePayload("CLASSIFY", { type: "PILOT" }), /FLIGHT TYPE/);
  assert.throws(() => parsePayload("PRIORITIZE", { priority: 0 }), /priority/);
});

test("changesOf: 지금 라벨·우선순위와 다른 것만", () => {
  assert.deepEqual(changesOf("CLASSIFY", { type: "BUILD", wake: "M" }, t("VOC-1")), ["type:BUILD", "wake:M"]);
  assert.deepEqual(changesOf("CLASSIFY", { type: "BUILD", ratings: ["SEC"] }, t("VOC-1", { labels: ["type:BUILD", "Risk:Security"] })), []);
  assert.deepEqual(changesOf("PRIORITIZE", { priority: 2 }, t("VOC-1", { priority: 0 })), ["priority 없음 → High"]);
  assert.deepEqual(changesOf("PRIORITIZE", { priority: 2 }, t("VOC-1", { priority: 2 })), []);
});

test("초안: 번호를 매기고, 같은 FLIGHT·종류의 열린 초안은 대신하며, 계획 단계가 아니거나 바꿀 게 없으면 거절", () => {
  const tickets = [t("VOC-10"), t("VOC-11", { state: "In Progress", stateType: "started" }), t("VOC-12", { labels: ["type:MAINT", "wake:M"] })];
  const first = draftOps([], { kind: "CLASSIFY", flight: "voc-10", type: "MAINT", wake: "M", reason: "리팩터링만" }, tickets, iso(10), 0);
  assert.deepEqual(first.map((l) => `${l.op}:${l.id}`), ["draft:S-0001"]);
  const ops = fold(first);
  const second = draftOps(ops, { kind: "CLASSIFY", flight: "VOC-10", type: "MAINT", wake: "H", reason: "마이그레이션 포함" }, tickets, iso(5), ops.length);
  assert.deepEqual(second.map((l) => `${l.op}:${l.id}`), ["supersede:S-0001", "draft:S-0002"]);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-11", type: "BUILD", reason: "x" }, tickets, iso(0), 0), /Todo·Backlog가 아님/);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-12", type: "MAINT", wake: "M", reason: "x" }, tickets, iso(0), 0), /이미 그렇게/);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-99", type: "BUILD", reason: "x" }, tickets, iso(0), 0), /목록에 없음/);
  assert.throws(() => draftOps([], { kind: "CLASSIFY", flight: "VOC-10", type: "BUILD", reason: " " }, tickets, iso(0), 0), /근거/);
});

test("초안 한도: 열린 초안이 5건이면 더 받지 않는다", () => {
  const tickets = Array.from({ length: 6 }, (_, i) => t(`VOC-${20 + i}`));
  let lines = [] as ReturnType<typeof draftOps>;
  for (let i = 0; i < 5; i++) lines = [...lines, ...draftOps(fold(lines), { kind: "CLASSIFY", flight: `VOC-${20 + i}`, type: "BUILD", reason: "r" }, tickets, iso(0), i)];
  assert.throws(
    () => draftOps(fold(lines), { kind: "CLASSIFY", flight: "VOC-25", type: "BUILD", reason: "r" }, tickets, iso(0), 5),
    (e) => e instanceof ScheduleError && e.status === 409,
  );
});

test("동기화: FLIGHT가 계획 단계를 벗어나거나 이미 반영됐으면 SUPERSEDED, 3일 지나면 EXPIRED", () => {
  const lines = [
    { op: "draft" as const, id: "S-0001", at: iso(10), kind: "CLASSIFY" as const, flight: "VOC-30", payload: { type: "MAINT" as const }, reason: "r" },
    { op: "draft" as const, id: "S-0002", at: iso(10), kind: "CLASSIFY" as const, flight: "VOC-31", payload: { type: "MAINT" as const }, reason: "r" },
    { op: "draft" as const, id: "S-0003", at: iso(4 * 24 * 60), kind: "PRIORITIZE" as const, flight: "VOC-32", payload: { priority: 2 as const }, reason: "r" },
    { op: "draft" as const, id: "S-0004", at: iso(10), kind: "PRIORITIZE" as const, flight: "VOC-33", payload: { priority: 2 as const }, reason: "r" },
  ];
  const tickets = [t("VOC-30", { state: "Done", stateType: "completed" }), t("VOC-31", { labels: ["type:MAINT"] }), t("VOC-32", { priority: 0 }), t("VOC-33", { priority: 0 })];
  const out = syncLines(fold(lines), tickets, NOW);
  assert.deepEqual(out.map((l) => `${l.op}:${l.id}:${"reason" in l ? l.reason : ""}`), [
    "supersede:S-0001:FLIGHT 상태가 바뀜(Done)",
    "supersede:S-0002:Linear에 이미 반영됨",
    "expire:S-0003:",
  ]);
});

test("판정과 2단계 점검, 후보 목록", () => {
  const lines = [
    { op: "draft" as const, id: "S-0001", at: iso(10), kind: "CLASSIFY" as const, flight: "VOC-40", payload: { type: "MAINT" as const }, reason: "r" },
    { op: "verdict" as const, id: "S-0001", at: iso(5), verdict: "disagree" as const, reason: "BUILD임" },
    { op: "verdict" as const, id: "S-0001", at: iso(4), verdict: "agree" as const, reason: null }, // 닫힌 뒤라 무시
  ];
  const ops = fold(lines);
  assert.equal(ops[0].status, "disagreed");
  assert.equal(ops[0].verdictReason, "BUILD임");
  assert.deepEqual(gateOf(ops), { decided: 1, agreed: 0, agreement: 0, target: { decided: 20, agreement: 0.8 }, ready: false });
  const tickets = [t("VOC-41"), t("VOC-42", { labels: ["type:BUILD", "wake:M"], priority: 0 }), t("VOC-43", { state: "In Progress", stateType: "started" })];
  assert.deepEqual(candidatesOf(tickets, []), { classify: ["VOC-41"], prioritize: ["VOC-42"] });
});
