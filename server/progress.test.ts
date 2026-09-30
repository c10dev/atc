import assert from "node:assert/strict";
import { test } from "node:test";
import type { Milestones } from "./milestones.ts";
import { minText, type ProgressInput, progressOf, progressText, type Typical, typicalDurations } from "./progress.ts";

// FLIGHT 진행 막대의 셈(ATC-211)
const NOW = Date.parse("2026-09-30T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ms = (o: Partial<Milestones>): Milestones => ({ out: null, off: null, on: null, in: null, reverted: null, ...o });

const line = (i: number, over: Record<string, unknown> = {}) => ({
  flight: `ATC-${i}`,
  class: { type: "BUILD", wake: "M" },
  airport: "ATCC",
  arrivedAt: ago(60 * 24 * (1 + i)),
  blockMin: 20 + i * 10, // 30 40 50 60 …
  landingWaitMin: 5 + i,
  reverted: false,
  pr: { repo: "o/r", number: i, url: "", title: "" },
  ...over,
});
const target = { key: "ATC-999", class: { type: "BUILD", wake: "M" }, airport: "ATCC" };

test("typicalDurations: p25·p50·p75와 표본 수, 단계 이름", () => {
  const e = [1, 2, 3, 4, 5].map((i) => line(i)); // blockMin 30..70
  const t = typicalDurations(target, e as never, NOW);
  assert.deepEqual(t.work, { p25: 40, p50: 50, p75: 60, n: 5, level: "TYPE×WAKE", group: "BUILD·M" });
  assert.equal(t.landing?.n, 5);
});

test("typicalDurations: 표본이 모자라면 WAKE, 그다음 AIRPORT로 넓히고, 끝까지 모자라면 null", () => {
  const other = [1, 2, 3].map((i) => line(i, { class: { type: "FIX", wake: "M" } }));
  assert.equal(typicalDurations(target, other as never, NOW).work?.level, "WAKE");
  const air = [1, 2, 3].map((i) => line(i, { class: { type: "FIX", wake: "L" } }));
  const t = typicalDurations(target, air as never, NOW).work;
  assert.deepEqual([t?.level, t?.group, t?.n], ["AIRPORT", "ATCC", 3]);
  assert.equal(typicalDurations(target, air.slice(0, 2) as never, NOW).work, null);
  assert.equal(typicalDurations({ key: null, class: null, airport: null }, air as never, NOW).work, null);
});

test("typicalDurations: 되돌려진 줄·PR 없는 줄·null 값·오래된 줄·자기 FLIGHT는 뺀다", () => {
  const good = [1, 2, 3].map((i) => line(i));
  const bad = [
    line(10, { reverted: true }),
    line(11, { pr: undefined }),
    line(12, { blockMin: null }),
    line(13, { arrivedAt: ago(60 * 24 * 90) }),
    line(14, { flight: "ATC-999" }),
  ];
  const t = typicalDurations(target, [...good, ...bad] as never, NOW);
  assert.equal(t.work?.n, 3);
  assert.equal(t.landing?.n, 4); // blockMin이 null인 줄은 landing에는 쓸 수 있다
});

const typ = (p25: number, p75: number): Typical => ({ p25, p50: (p25 + p75) / 2, p75, n: 12, level: "TYPE×WAKE", group: "BUILD·M" });
const inp = (m: Partial<Milestones>, over: Partial<ProgressInput> = {}): ProgressInput => ({
  milestones: ms(m),
  awaitsRts: true,
  arrivedWithoutPr: false,
  typical: { work: typ(30, 60), landing: typ(5, 20) },
  ...over,
});

test("progressOf: OUT이 없으면 막대가 없다", () => {
  assert.equal(progressOf(inp({}), NOW), null);
});

test("progressOf: work — 지난 분, 보통 범위, 표식은 p75 대비", () => {
  const p = progressOf(inp({ out: ago(42) }), NOW)!;
  assert.deepEqual([p.segment, p.elapsedMin, p.late], ["work", 42, false]);
  assert.equal(p.marker, (0 + 42 / 60) / 4);
  assert.equal(progressText(p), "작업 42분 · 보통 30–60분 (BUILD·M, n=12)");
  const late = progressOf(inp({ out: ago(90) }), NOW)!;
  assert.deepEqual([late.late, late.marker], [true, 0.25]); // 칸 끝에서 멈춘다
  assert.match(progressText(late), /길어짐/);
});

test("progressOf: 표본이 없으면 데이터 부족, 표식은 구간 시작", () => {
  const p = progressOf(inp({ out: ago(42) }, { typical: { work: null, landing: null } }), NOW)!;
  assert.deepEqual([p.typical, p.late, p.marker], [null, false, 0]);
  assert.equal(progressText(p), "작업 42분 · 데이터 부족");
});

test("progressOf: landing → rts → done", () => {
  const l = progressOf(inp({ out: ago(80), off: ago(8) }), NOW)!;
  assert.deepEqual([l.segment, l.elapsedMin, l.late], ["landing", 8, false]);
  assert.equal(l.marker, (1 + 8 / 20) / 4);
  assert.equal(progressText(l), "착륙 대기 8분 · 보통 5–20분 (BUILD·M, n=12)");
  const r = progressOf(inp({ out: ago(80), off: ago(30), on: ago(5) }), NOW)!;
  assert.deepEqual([r.segment, r.typical, r.late, r.marker], ["rts", null, false, 0.5]); // RTS는 지난 시간만
  assert.equal(progressText(r), "RTS 대기 5분");
  const done = progressOf(inp({ out: ago(80), off: ago(30), on: ago(5), in: ago(1) }), NOW)!;
  assert.deepEqual([done.segment, done.marker], ["done", null]);
});

test("progressOf: RTS가 넣지 않는 FLIGHT는 ON이 끝, STAND 없는 FLIGHT는 ARRIVED까지 work뿐", () => {
  assert.equal(progressOf(inp({ out: ago(80), off: ago(30), on: ago(5) }, { awaitsRts: false }), NOW)!.segment, "done");
  const open = progressOf(inp({ out: ago(10) }, { awaitsRts: false }), NOW)!;
  assert.deepEqual([open.segment, open.standFree], ["work", false]);
  const arrived = progressOf(inp({ out: ago(70) }, { arrivedWithoutPr: true }), NOW)!;
  assert.deepEqual([arrived.segment, arrived.standFree], ["done", true]);
});

test("minText: 60분 넘으면 시간으로", () => {
  assert.equal(minText(42), "42분");
  assert.equal(minText(60), "1시간");
  assert.equal(minText(75), "1시간 15분");
  const p = progressOf(inp({ out: ago(70) }, { typical: { work: typ(50, 130), landing: null } }), NOW)!;
  assert.match(progressText(p), /작업 1시간 10분 · 보통 50분–2시간 10분/);
});
