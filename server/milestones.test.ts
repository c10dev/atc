import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEntry } from "./logbook.ts";
import { hasMilestone, latestMilestone, type MilestoneSources, milestoneLine, milestonesOf, milestoneTitle } from "./milestones.ts";

// OOOI(ATC-123): OUT(DEPARTED) · OFF(PR 엶) · ON(머지) · IN(RTS로 서비스에 들어감)
const T = (hhmm: string) => `2026-09-29T${hhmm}:00.000Z`;
const F = "ATC-9";

const entry = (over: Partial<LogEntry> & { arrivedAt: string }, n = 10): LogEntry =>
  ({
    key: `o/atc#${n}`,
    aircraft: "TEAM_K",
    flight: F,
    class: null,
    airport: "ATCC",
    pr: { repo: "o/atc", number: n, url: `https://github.com/o/atc/pull/${n}`, title: "t" },
    stands: [],
    departedAt: T("01:00"),
    departedFrom: "departure",
    blockMin: null,
    landingWaitMin: 20,
    codexFindings: 0,
    changesRequested: false,
    reverted: false,
    los: 0,
    ...over,
  }) as LogEntry;

const src = (over: Partial<MilestoneSources> = {}): MilestoneSources => ({
  departures: [],
  proposals: [],
  pulls: [],
  logbook: [],
  landingRequested: [],
  rts: [],
  rtsAirport: "ATCC",
  mergeCommitOf: () => "m".repeat(40),
  isAncestor: () => true,
  ...over,
});

test("OUT: DEPARTURE LOG의 첫 줄(다른 FLIGHT는 무시), 없으면 제안의 departed(STAND 없는 FLIGHT)", () => {
  const dep = (flight: string, t: string) => ({ flight, t });
  assert.equal(milestonesOf(F, src({ departures: [dep(F, T("03:12")), dep(F, T("02:50")), dep("ATC-1", T("01:00"))] })).out, T("02:50"));
  const prop = (flight: string, departed?: string) => ({ flight, kind: "ASSIGN" as const, timeline: departed ? { departed } : {} });
  assert.equal(milestonesOf(F, src({ proposals: [prop(F, T("04:00")), prop("ATC-1", T("01:00"))] })).out, T("04:00"));
  // 둘 다 있으면 DEPARTURE LOG가 먼저
  assert.equal(milestonesOf(F, src({ departures: [dep(F, T("03:12"))], proposals: [prop(F, T("04:00"))] })).out, T("03:12"));
});

test("OUT: LOGBOOK이 출발 시각을 실제로 알던 줄만 쓰고, PR로 추정한 것(departedFrom pr)은 쓰지 않는다", () => {
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("05:00"), departedFrom: "claim", departedAt: T("02:00") })] })).out, T("02:00"));
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("05:00"), departedFrom: "pr", departedAt: T("04:40") })] })).out, null);
});

test("OFF: 열린 PR의 createdAt, 머지된 PR은 (머지 − 착륙 대기), 없으면 첫 landing.requested", () => {
  assert.equal(milestonesOf(F, src({ pulls: [{ ticketKey: F, createdAt: T("03:40") }, { ticketKey: "ATC-1", createdAt: T("01:00") }] })).off, T("03:40"));
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02"), landingWaitMin: 22 })] })).off, T("03:40"));
  const req = (flight: string, at: string) => ({ flight, at });
  assert.equal(milestonesOf(F, src({ landingRequested: [req(F, T("03:50")), req(F, T("03:45")), req("ATC-1", T("01:00"))] })).off, T("03:45"));
  // PR이 있으면 더 이른 쪽
  assert.equal(milestonesOf(F, src({ pulls: [{ ticketKey: F, createdAt: T("03:40") }], landingRequested: [req(F, T("03:50"))] })).off, T("03:40"));
});

test("ON: 머지된 PR의 arrivedAt", () => {
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") }), entry({ arrivedAt: T("09:00"), flight: "ATC-1" }, 11)] })).on, T("04:02"));
});

test("PR이 둘인 FLIGHT: OFF는 가장 이른 PR, ON은 머지된 PR", () => {
  const m = milestonesOf(
    F,
    src({
      pulls: [{ ticketKey: F, createdAt: T("03:10") }], // 아직 열린 PR
      logbook: [entry({ arrivedAt: T("04:02"), landingWaitMin: 12 }, 12)], // 03:50에 열려 04:02에 머지
    }),
  );
  assert.equal(m.off, T("03:10"));
  assert.equal(m.on, T("04:02"));
});

test("되돌린 머지: ON은 그대로 두고 reverted가 알린다(그 머지 커밋의 IN도 그대로)", () => {
  const e = entry({ arrivedAt: T("04:02"), reverted: true, revertedBy: { number: 30, url: "https://github.com/o/atc/pull/30", at: T("06:00") } });
  const m = milestonesOf(F, src({ logbook: [e], rts: [{ at: T("04:07"), to: "x".repeat(40), result: "ok" }] }));
  assert.equal(m.on, T("04:02"));
  assert.equal(m.in, T("04:07"));
  assert.deepEqual(m.reverted, { number: 30, url: "https://github.com/o/atc/pull/30", at: T("06:00") });
  assert.match(milestoneTitle(m, (i) => i.slice(11, 16)), /PR이 #30로 되돌려짐/);
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") })] })).reverted, null);
});

test("IN: RTS가 거절된 뒤 성공하면 성공한 것의 시각", () => {
  const rts = [
    { at: T("04:05"), to: "a".repeat(40), result: "refused" as const },
    { at: T("04:06"), to: "a".repeat(40), result: "running" as const },
    { at: T("04:12"), to: "a".repeat(40), result: "ok" as const },
    { at: T("05:30"), to: "b".repeat(40), result: "ok" as const },
  ];
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") })], rts })).in, T("04:12"));
});

test("IN: 머지 커밋이 들어 있는 대상의 첫 성공 RTS만(앞선 성공 RTS나 머지 전 RTS는 건너뜀)", () => {
  const rts = [
    { at: T("03:00"), to: "0".repeat(40), result: "ok" as const }, // 머지 전
    { at: T("04:10"), to: "1".repeat(40), result: "ok" as const }, // 머지 커밋이 아직 없는 대상
    { at: T("05:00"), to: "2".repeat(40), result: "ok" as const },
  ];
  const m = milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") })], rts, isAncestor: (_c, to) => to === "2".repeat(40) }));
  assert.equal(m.in, T("05:00"));
});

test("IN: RTS가 배포하지 않는 AIRPORT의 FLIGHT는 없다(추측하지 않는다)", () => {
  const rts = [{ at: T("04:12"), to: "a".repeat(40), result: "ok" as const }];
  const logbook = [entry({ arrivedAt: T("04:02"), airport: "VCDO" })];
  assert.equal(milestonesOf(F, src({ logbook, rts })).in, null);
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") })], rts, rtsAirport: null })).in, null);
  assert.equal(milestonesOf(F, src({ logbook, rts })).on, T("04:02")); // ON은 있다
});

test("빠진 출처는 null이고 추측하지 않는다", () => {
  assert.deepEqual(milestonesOf(F, src()), { out: null, off: null, on: null, in: null, reverted: null });
  const rts = [{ at: T("04:12"), to: "a".repeat(40), result: "ok" as const }];
  // 머지 커밋을 모르면 IN이 없다
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") })], rts, mergeCommitOf: () => null })).in, null);
  // 아직 RTS가 없으면 IN이 없다
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") })] })).in, null);
  // RTS 대상이 머지 커밋을 품지 않으면 IN이 없다
  assert.equal(milestonesOf(F, src({ logbook: [entry({ arrivedAt: T("04:02") })], rts, isAncestor: () => false })).in, null);
  // STAND 없는 FLIGHT(PR 없음)는 OUT만 있다
  const m = milestonesOf(F, src({ proposals: [{ flight: F, kind: "ASSIGN", timeline: { departed: T("03:00") } }] }));
  assert.deepEqual([m.out, m.off, m.on, m.in], [T("03:00"), null, null, null]);
});

test("화면 도우미: 한 줄(닿지 않은 칸은 —), 가장 늦은 이정표, 툴팁", () => {
  const m = { out: T("03:12"), off: T("03:40"), on: T("04:02"), in: T("04:07"), reverted: null };
  const hhmm = (iso: string) => iso.slice(11, 16);
  assert.equal(milestoneLine(m, hhmm), "OUT 03:12 · OFF 03:40 · ON 04:02 · IN 04:07");
  assert.equal(milestoneLine({ ...m, on: null, in: null }, hhmm), "OUT 03:12 · OFF 03:40 · ON — · IN —");
  assert.equal(milestoneLine(null, hhmm), "OUT — · OFF — · ON — · IN —");
  assert.deepEqual(latestMilestone(m), { name: "in", at: T("04:07") });
  assert.deepEqual(latestMilestone({ ...m, on: null, in: null }), { name: "off", at: T("03:40") });
  assert.equal(latestMilestone({ out: null, off: null, on: null, in: null, reverted: null }), null);
  assert.equal(hasMilestone(null), false);
  assert.equal(milestoneTitle(m, hhmm), "OUT 03:12\nOFF 03:40\nON 04:02\nIN 04:07");
});
