import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type EffectData, judge, measureOf, type Measure } from "./effect-check.ts";
import { BORN_MS, flowDataOf, flowInputOf, flowViewOf, idleStat, stateChangesOf, stretchesOf, stretchStat, type FlowInput, type SampleRow, type TicketLine } from "./flow.ts";
import { factsNow, noteFacts, planFactsOf, resetFacts } from "./flow-facts.ts";
import { NOT_RELEASED_WHY } from "./release.ts";
import { computeMetrics } from "./metrics.ts";
import type { RecordLine } from "./recorder.ts";
import { sampleOf } from "./recorder.ts";


// FLOW(ATC-468)
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.parse("2026-10-10T00:00:00Z");
const at = (ms: number) => new Date(ms).toISOString();
const state = (key: string, from: string | null, to: string, ms: number): TicketLine => ({ t: at(ms), kind: "ticket", op: "state", key, from, to });
const input = (over: Partial<FlowInput>): FlowInput => ({ tickets: [], ticketLines: [], releases: [], launches: [], ...over });

test("planFactsOf: signalsOf와 같은 두 사실(놀고 있는 AIRCRAFT, 기다리는 FLIGHT)", () => {
  const plan = {
    aircraft: [{ registration: "TEAM_A", available: true }, { registration: "TEAM_B", available: false }],
    assign: [{ flight: "ATC-1" }],
    unserved: [{ flight: "ATC-2" }],
    excluded: [{ flight: "ATC-3", reason: NOT_RELEASED_WHY }, { flight: "ATC-4", reason: "다른 이유" }],
  };
  assert.deepEqual(planFactsOf(plan), { available: 1, waiting: 3 });
  assert.deepEqual(planFactsOf(null), { available: 0, waiting: 0 });
});

test("facts: 계획을 세운 지 10분이 지나면 표본에 싣지 않는다", () => {
  resetFacts();
  assert.equal(factsNow(T0), null);
  noteFacts({ available: 2, waiting: 0 }, T0);
  assert.deepEqual(factsNow(T0 + 9 * MIN), { available: 2, waiting: 0 });
  assert.equal(factsNow(T0 + 11 * MIN), null);
  resetFacts();
});

test("idleStat: 두 칸이 있는 표본만 분으로 세고, 옛 표본은 기록 안 됨이다(0이 아니다)", () => {
  const rows: SampleRow[] = [
    { t: at(T0) }, // 옛 표본
    { t: at(T0 + 5 * MIN), available: 1, waiting: 0 }, // 센다
    { t: at(T0 + 10 * MIN), available: 2, waiting: 1 }, // 일감이 있다
    { t: at(T0 + 15 * MIN), available: 0, waiting: 0 }, // 놀 AIRCRAFT가 없다
    { t: at(T0 + 20 * MIN), available: 3, waiting: 0 }, // 센다
    { t: at(T0 + 3 * DAY), available: 1, waiting: 0 }, // 기간 밖
  ];
  const s = idleStat(rows, T0, T0 + DAY);
  assert.equal(s.minutes, 10);
  assert.equal(s.recordedSamples, 4);
  assert.equal(s.unrecordedSamples, 1);
  assert.equal(s.recordedSince, at(T0 + 5 * MIN));
  // 기간 안에 기록된 표본이 하나도 없으면 0분이 아니라 null
  assert.equal(idleStat([{ t: at(T0) }], T0, T0 + DAY).minutes, null);
  assert.equal(idleStat([], T0, T0 + DAY).minutes, null);
});

test("sample 줄: 새 칸 없이 쓰던 줄이 그대로 읽힌다(computeMetrics가 옛 표본을 다룬다)", () => {
  const old: RecordLine = { t: at(T0 + MIN), kind: "sample", airborne: 1, holding: 0, claims: 1, conflicts: 0, alerts: 0, landing: 0, pendingClearances: 0 };
  const fresh: RecordLine = { ...(old as Extract<RecordLine, { kind: "sample" }>), t: at(T0 + 6 * MIN), available: 1, waiting: 0 };
  const m = computeMetrics([old, fresh], [], T0 + HOUR, 1);
  assert.equal(m.series.length, 2);
  assert.equal(m.series[0]!.airborne, 1);
});

test("stateChangesOf: 바뀐 것만, 처음 보는 이슈는 만든 지 10분 안일 때만 from null로", () => {
  const now = T0 + 5 * HOUR;
  const prev = new Map([["ATC-1", "Backlog"], ["ATC-2", "Todo"]]);
  const r = stateChangesOf(prev, [
    { key: "ATC-1", state: "Todo", createdAt: at(T0) }, // 바뀜
    { key: "ATC-2", state: "Todo", createdAt: at(T0) }, // 그대로
    { key: "ATC-3", state: "Todo", createdAt: at(now - 3 * MIN) }, // 갓 태어남
    { key: "ATC-4", state: "Backlog", createdAt: at(now - BORN_MS - MIN) }, // 처음 보지만 오래됨
    { key: "ATC-5", state: "Todo", createdAt: null }, // 만든 시각을 모름
  ], now);
  assert.deepEqual(r.lines.map((l) => [l.key, l.from, l.to]), [["ATC-1", "Backlog", "Todo"], ["ATC-3", null, "Todo"]]);
  assert.equal(r.next.get("ATC-4"), "Backlog"); // 기준선은 조용히 잡는다
  assert.equal(r.lines[0]!.t, at(now));
  // 읽기가 한 번 비어도 지난 상태를 잃지 않는다
  assert.equal(stateChangesOf(r.next, [], now + MIN).next.get("ATC-1"), "Todo");
});

test("stretchesOf: 기록으로 센 세 구간(Backlog에서 Todo로, 발권, 첫 성공한 LAUNCH)", () => {
  const created = T0;
  const todo = T0 + 2 * HOUR;
  const rel = todo + 30 * MIN;
  const launch = rel + 10 * MIN;
  const r = stretchesOf(input({
    tickets: [{ key: "ATC-1", createdAt: at(created) }],
    ticketLines: [state("ATC-1", "Backlog", "Todo", todo)],
    releases: [{ flight: "ATC-1", at: at(rel) }],
    launches: [{ flight: "ATC-1", t: at(launch) }],
  }));
  assert.deepEqual(r.map((s) => [s.name, s.ms / MIN, s.source]), [["created-todo", 120, "record"], ["todo-release", 30, "record"], ["release-launch", 10, "record"]]);
});

test("stretchesOf: Todo로 태어난 이슈 — created-todo는 0, todo-release는 만든 때부터", () => {
  const r = stretchesOf(input({
    tickets: [{ key: "ATC-2", createdAt: at(T0) }],
    ticketLines: [state("ATC-2", null, "Todo", T0 + MIN)],
    releases: [{ flight: "ATC-2", at: at(T0 + 40 * MIN) }],
  }));
  assert.deepEqual(r.map((s) => [s.name, s.ms / MIN, s.source]), [["created-todo", 0, "record"], ["todo-release", 40, "record"]]);
});

test("stretchesOf: 기록 전의 이슈는 만든 때로 대신한다(todo-release만, substitute), created-todo는 없다", () => {
  const r = stretchesOf(input({
    tickets: [{ key: "ATC-3", createdAt: at(T0) }],
    releases: [{ flight: "ATC-3", at: at(T0 + 5 * HOUR) }],
    launches: [{ flight: "ATC-3", t: at(T0 + 6 * HOUR) }],
  }));
  assert.deepEqual(r.map((s) => [s.name, s.ms / HOUR, s.source]), [["todo-release", 5, "substitute"], ["release-launch", 1, "record"]]);
});

test("stretchesOf: 다시 발권해도 Todo 뒤 첫 발권이 기준이고 LAUNCH는 그 발권 뒤 첫 것", () => {
  const todo = T0 + HOUR;
  const r = stretchesOf(input({
    tickets: [{ key: "ATC-4", createdAt: at(T0) }],
    ticketLines: [state("ATC-4", "Backlog", "Todo", todo)],
    releases: [
      { flight: "ATC-4", at: at(T0 + 10 * MIN) }, // Todo가 되기 전의 발권은 세지 않는다
      { flight: "ATC-4", at: at(todo + 20 * MIN) }, // 첫 발권
      { flight: "ATC-4", at: at(todo + 3 * HOUR) }, // 다시 발권
    ],
    launches: [{ flight: "ATC-4", t: at(todo + 50 * MIN) }, { flight: "ATC-4", t: at(todo + 4 * HOUR) }],
  }));
  assert.equal(r.find((s) => s.name === "todo-release")!.ms, 20 * MIN);
  assert.equal(r.find((s) => s.name === "release-launch")!.ms, 30 * MIN);
});

test("flowInputOf: 성공한 fleet launch 줄만, flight가 있는 것만, release 줄만", () => {
  const rec = (p: object) => ({ t: at(T0), ...p }) as RecordLine;
  const i = flowInputOf(
    [
      rec({ kind: "fleet", op: "launch", aircraft: "A", by: "supervisor", ok: true, flight: "ATC-1" }),
      rec({ kind: "fleet", op: "launch", aircraft: "A", by: "supervisor", ok: false, flight: "ATC-2", error: "x" }), // 실패한 LAUNCH
      rec({ kind: "fleet", op: "launch", aircraft: "A", by: "supervisor", ok: true }), // FLIGHT 없음
      rec({ kind: "fleet", op: "stop", aircraft: "A", by: "supervisor", ok: true, flight: "ATC-3" }),
      state("ATC-1", "Backlog", "Todo", T0),
    ],
    [],
    [{ op: "release", flight: "ATC-1", at: at(T0) }, { op: "revoke", flight: "ATC-1", at: at(T0) }, { op: "arm", at: at(T0) }],
  );
  assert.deepEqual(i.launches, [{ flight: "ATC-1", t: at(T0) }]);
  assert.equal(i.ticketLines.length, 1);
  assert.equal(i.releases.length, 1);
});

test("stretchStat: 끝난 때가 기간에 드는 이슈만, 중앙값과 근거별 개수", () => {
  const mk = (key: string, startH: number, endH: number, source: "record" | "substitute") => ({ key, name: "todo-release" as const, startMs: T0 + startH * HOUR, endMs: T0 + endH * HOUR, ms: (endH - startH) * HOUR, source });
  const all = [mk("A", 0, 1, "record"), mk("B", 0, 3, "record"), mk("C", 0, 5, "substitute"), mk("D", 0, 100, "record")];
  const s = stretchStat(all, "todo-release", T0, T0 + 10 * HOUR);
  assert.equal(s.n, 3);
  assert.equal(s.medianMin, 180);
  assert.deepEqual(s.record, { n: 2, medianMin: 120 });
  assert.deepEqual(s.substitute, { n: 1, medianMin: 300 });
  assert.equal(stretchStat([], "created-todo", T0, T0 + DAY).medianMin, null);
});

test("flowViewOf: 화면 모양 — 기록 시작과 세 구간", () => {
  const v = flowViewOf(
    input({ tickets: [{ key: "ATC-1", createdAt: at(T0) }], ticketLines: [state("ATC-1", "Backlog", "Todo", T0 + HOUR)], releases: [{ flight: "ATC-1", at: at(T0 + 2 * HOUR) }] }),
    [{ t: at(T0 + 3 * HOUR), available: 1, waiting: 0 }],
    T0,
    T0 + DAY,
  );
  assert.equal(v.recordedSince.ticketLines, at(T0 + HOUR));
  assert.equal(v.idleEmpty.minutes, 5);
  assert.equal(v.stretches["created-todo"].n, 1);
  assert.equal(v.stretches["todo-release"].medianMin, 60);
  assert.equal(v.stretches["release-launch"].n, 0);
});

// ── Measure: flow ──
const body = (metric: string) => `## Measure\n\n* metric: ${metric}\n* direction: down\n* window: 7d\n`;

test("measureOf: flow 이름 넷은 읽히고 모르는 이름은 invalid", () => {
  for (const n of ["idle-empty-min", "created-todo", "todo-release", "release-launch"]) {
    const p = measureOf(body(`flow:${n}`));
    assert.equal(p.kind, "measure", n);
    if (p.kind === "measure") assert.deepEqual([p.measure.source, p.measure.name], ["flow", n]);
  }
  const bad = measureOf(body("flow:made-up"));
  assert.equal(bad.kind, "invalid");
  assert.equal(measureOf(body("flow:")).kind, "invalid");
  assert.equal(measureOf(body("flow:IDLE-EMPTY-MIN")).kind, "measure"); // 이름은 소문자로 맞춘다
});

const DEPLOYED = T0 + 20 * DAY;
const flowData = (idleBefore: number, idleAfter: number, stretches: { name: "todo-release"; endDay: number; min: number }[], coverage = T0): EffectData => {
  const idleAt = [
    ...Array.from({ length: idleBefore }, (_, i) => DEPLOYED - 6 * DAY + i * 10 * MIN),
    ...Array.from({ length: idleAfter }, (_, i) => DEPLOYED + 1 * DAY + i * 10 * MIN),
  ];
  const fd = flowDataOf(input({}), []);
  return {
    leaks: [],
    misfires: [],
    alerts: [],
    clearances: [],
    coverageFrom: { leak: null, "leak-minutes": null, misfire: null, alert: null, clearance: null },
    flow: {
      ...fd,
      idleAt,
      stretches: stretches.map((s, i) => ({ key: `ATC-${i}`, name: s.name, startMs: DEPLOYED + s.endDay * DAY - s.min * MIN, endMs: DEPLOYED + s.endDay * DAY, ms: s.min * MIN, source: "record" as const })),
      coverage: { "idle-empty-min": coverage, "created-todo": coverage, "todo-release": coverage, "release-launch": coverage },
    },
  };
};
const m = (name: string, direction: "down" | "up" = "down"): Measure => ({ source: "flow", name, direction, windowDays: 7 });

test("judge flow:idle-empty-min — 분 합계가 20% 넘게 줄면 improved, 기록이 앞 창을 덮지 않으면 too little data", () => {
  const j = judge(m("idle-empty-min"), DEPLOYED, flowData(10, 4, []));
  assert.deepEqual([j.verdict, j.before, j.after], ["improved", 50, 20]);
  assert.equal(judge(m("idle-empty-min"), DEPLOYED, flowData(10, 11, [])).verdict, "not improved");
  assert.equal(judge(m("idle-empty-min"), DEPLOYED, flowData(10, 20, [])).verdict, "worse");
  assert.equal(judge(m("idle-empty-min"), DEPLOYED, flowData(10, 4, [], DEPLOYED - 3 * DAY)).verdict, "too little data"); // 기록이 3일 전에야 시작
  assert.equal(judge(m("idle-empty-min"), DEPLOYED, flowData(0, 0, [])).verdict, "too little data"); // 앞 구간에 분이 없다
});

test("judge flow:todo-release — 앞뒤 창의 중앙값을 견주고, 이슈가 3건 미만이면 too little data", () => {
  const st = (endDay: number, min: number) => ({ name: "todo-release" as const, endDay, min });
  const before = [st(-5, 600), st(-4, 700), st(-3, 800)]; // 중앙값 700분
  const afterFast = [st(1, 100), st(2, 200), st(3, 300)]; // 중앙값 200분
  const j = judge(m("todo-release"), DEPLOYED, flowData(0, 0, [...before, ...afterFast]));
  assert.deepEqual([j.verdict, j.before, j.after], ["improved", 700, 200]);
  assert.equal(judge(m("todo-release", "up"), DEPLOYED, flowData(0, 0, [...before, ...afterFast])).verdict, "worse");
  assert.equal(judge(m("todo-release"), DEPLOYED, flowData(0, 0, [...before, st(1, 100), st(2, 200)])).verdict, "too little data"); // 뒤 창 2건
  assert.equal(judge(m("todo-release"), DEPLOYED, flowData(0, 0, [...before, ...[st(1, 650), st(2, 700), st(3, 750)]])).verdict, "not improved");
  // 중앙값이 작아도(분 단위 3 미만) 이슈가 충분하면 견준다: 개수 규칙은 분이 아니라 이슈에 건다
  const small = [st(-5, 2), st(-4, 2), st(-3, 2), st(1, 1), st(2, 1), st(3, 1)];
  assert.equal(judge(m("todo-release"), DEPLOYED, flowData(0, 0, small)).verdict, "improved");
});

test("sampleOf는 새 칸을 만들지 않는다(칸은 jobs/sample.ts가 계획에서 읽은 때만 더한다)", () => {
  const s = sampleOf({ claims: [], sessions: [], alerts: [], pulls: [], clearances: [] } as never);
  assert.equal("available" in s, false);
});
