import assert from "node:assert/strict";
import { test } from "node:test";
import { checkrideRows, flightRating, judge, nextRatings } from "./checkride.ts";
import { DEFAULT_FLEET, type CrewMember } from "./crew.ts";
import type { LogEntry } from "./logbook.ts";
import type { ScheduleOp } from "./schedule.ts";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const CREW = DEFAULT_FLEET.defaults.complement;
const FLASH_ONLY: CrewMember[] = [{ position: "flash-helper", agent: "flash-helper", limits: ["no BUILD", "no CHECK verdicts", "no SEC"] }];

const entry = (n: number, over: Partial<LogEntry> = {}): LogEntry => ({
  key: `o/v#${n}`,
  aircraft: "TEAM_B",
  flight: `VOC-${n}`,
  class: { type: "BUILD", wake: "M", ratings: [], explicit: { type: true, wake: true } },
  airport: "VCDO",
  pr: { repo: "o/v", number: n, url: "", title: "" },
  stands: [],
  departedAt: daysAgo(3),
  departedFrom: "claim",
  arrivedAt: daysAgo(2),
  blockMin: 100,
  landingWaitMin: 10,
  codexFindings: 1,
  changesRequested: false,
  reverted: false,
  los: 0,
  ...over,
});

const classify = (id: string, flight: string, ratings: string[] | undefined, verdict: "agree" | "disagree" | null, at = daysAgo(5)) =>
  ({
    id,
    kind: "CLASSIFY",
    flight,
    payload: { type: "BUILD", ...(ratings ? { ratings } : {}) },
    reason: "",
    at,
    status: verdict === "agree" ? "agreed" : verdict === "disagree" ? "disagreed" : "draft",
    statusAt: at,
    verdictReason: null,
    calls: null,
    appliedRef: null,
    decision: verdict ? { verdict, at } : null,
    crosscheck: null,
  }) as ScheduleOp;

test("FLIGHT의 rating: 라벨(지금 티켓 → LOGBOOK class) 먼저, 없으면 SUPERVISOR가 받아들인 CLASSIFY, 둘 다 없으면 근거 아님", () => {
  const ops = [classify("S-1", "VOC-1", ["SEC"], "agree"), classify("S-2", "VOC-2", ["UI"], "disagree"), classify("S-3", "VOC-3", ["DATA"], null)];
  const none = () => null;
  assert.deepEqual(flightRating(entry(1), () => ["rating:UI"], ops), { ratings: ["UI"], source: "label" });
  assert.deepEqual(flightRating(entry(1), () => ["Risk:Security"], ops), { ratings: ["SEC"], source: "label" });
  assert.deepEqual(flightRating(entry(1, { class: { type: "BUILD", wake: "M", ratings: ["DOCS"], explicit: { type: true, wake: true } } }), none, ops), { ratings: ["DOCS"], source: "label" });
  assert.deepEqual(flightRating(entry(1), none, ops), { ratings: ["SEC"], source: "schedule", scheduleId: "S-1" });
  assert.equal(flightRating(entry(2), none, ops), null); // 거절한 초안
  assert.equal(flightRating(entry(3), none, ops), null); // 아직 판정 없음
  assert.equal(flightRating(entry(4), none, ops), null);
  assert.equal(flightRating(entry(5, { flight: null }), none, ops), null); // AD HOC
  // 같은 FLIGHT에 받아들인 초안이 둘이면 나중 것
  const later = [classify("S-1", "VOC-1", ["SEC"], "agree", daysAgo(9)), classify("S-9", "VOC-1", ["DATA"], "agree", daysAgo(1))];
  assert.equal(flightRating(entry(1), none, later)?.scheduleId, "S-9");
});

const ev = (n: number, d: number, over: { reverted?: boolean; codexFindings?: number } = {}) => ({
  key: `o/v#${n}`,
  flight: `VOC-${n}`,
  pr: { repo: "o/v", number: n, url: "", title: "" },
  arrivedAt: daysAgo(d),
  source: "label" as const,
  reverted: false,
  codexFindings: 1,
  ...over,
});

test("부여 추천: 30일 3건 이상, 되돌림 0, Codex 지적 라운드 평균 3 미만", () => {
  const three = [ev(1, 1, { codexFindings: 1 }), ev(2, 5, { codexFindings: 2 }), ev(3, 20, { codexFindings: 1 })];
  const g = judge("SEC", false, CREW, three, NOW);
  assert.equal(g.status, "GRANT");
  assert.equal(g.reason, "SEC 근거 3/3 FLIGHT, 되돌림 0, Codex 지적 라운드 평균 1.3 → 부여 추천");
  assert.equal(judge("SEC", false, CREW, three.slice(0, 2), NOW).status, "BUILDING");
  assert.equal(judge("SEC", false, CREW, [...three.slice(0, 2), ev(3, 40)], NOW).status, "BUILDING"); // 30일 밖
  assert.equal(judge("SEC", false, CREW, [...three, ev(4, 25, { reverted: true })], NOW).status, "BUILDING");
  assert.equal(judge("UI", false, CREW, three.map((e) => ({ ...e, codexFindings: 3 })), NOW).status, "BUILDING");
});

test("SEC는 맡을 CREW가 없으면 추천하지 않고 이유를 보여 준다", () => {
  const three = [ev(1, 1), ev(2, 2), ev(3, 3)];
  const b = judge("SEC", false, FLASH_ONLY, three, NOW);
  assert.equal(b.status, "BLOCKED");
  assert.match(b.reason, /SEC를 맡을 CREW가 없어/);
  assert.equal(judge("DOCS", false, FLASH_ONLY, three, NOW).status, "GRANT"); // SEC만 막는다
});

test("재검토 추천: 가진 rating의 14일 안 되돌림, 또는 2건 이상 지적 라운드 평균 3 이상", () => {
  assert.equal(judge("SEC", true, CREW, [ev(1, 1), ev(2, 3)], NOW).status, "HOLDS");
  const reverted = judge("SEC", true, CREW, [ev(1, 10, { reverted: true })], NOW);
  assert.equal(reverted.status, "REVIEW");
  assert.match(reverted.reason, /되돌림 1건 → 재검토 추천/);
  assert.equal(judge("SEC", true, CREW, [ev(1, 20, { reverted: true })], NOW).status, "HOLDS"); // 14일 밖
  assert.equal(judge("UI", true, CREW, [ev(1, 1, { codexFindings: 4 }), ev(2, 2, { codexFindings: 2 })], NOW).status, "REVIEW");
  assert.equal(judge("UI", true, CREW, [ev(1, 1, { codexFindings: 5 })], NOW).status, "HOLDS"); // 1건으로는 안 봄
});

test("CHECKRIDE 행: AIRCRAFT를 아는 LOGBOOK만, 퇴역은 빼고, rating마다 근거와 출처", () => {
  const aircraft = [
    { registration: "TEAM_B", callsign: "BRAVO", ratings: ["UI", "DATA", "DOCS"] as const, complement: CREW, retired: null },
    { registration: "TEAM_Z", callsign: "ZULU", ratings: [] as const, complement: CREW, retired: { at: "" } },
  ].map((a) => ({ ...a, ratings: [...a.ratings] }));
  const entries = [
    entry(1, { arrivedAt: daysAgo(1) }),
    entry(2, { arrivedAt: daysAgo(3) }),
    entry(3, { arrivedAt: daysAgo(4) }),
    entry(4, { arrivedAt: daysAgo(5), aircraft: null }),
    entry(5, { arrivedAt: daysAgo(6), aircraft: "TEAM_Z" }),
  ];
  const labels = (k: string) => (k === "VOC-1" ? ["rating:SEC"] : null);
  const ops = ["VOC-2", "VOC-3", "VOC-4", "VOC-5"].map((f, i) => classify(`S-${i}`, f, ["SEC"], "agree"));
  const rows = checkrideRows(aircraft, entries, labels, ops, NOW);
  assert.deepEqual(rows.map((r) => `${r.registration}:${r.rating}:${r.status}`), ["TEAM_B:SEC:GRANT", "TEAM_B:UI:HOLDS", "TEAM_B:DATA:HOLDS", "TEAM_B:DOCS:HOLDS"]);
  assert.deepEqual(rows[0].evidence.map((e) => `${e.flight}:${e.source}${e.scheduleId ? `:${e.scheduleId}` : ""}`), ["VOC-1:label", "VOC-2:schedule:S-0", "VOC-3:schedule:S-1"]);
});

test("부여·회수 뒤 rating은 RATINGS 순서로", () => {
  assert.deepEqual(nextRatings(["UI", "DOCS"], "SEC", "grant"), ["SEC", "UI", "DOCS"]);
  assert.deepEqual(nextRatings(["SEC", "UI"], "SEC", "revoke"), ["UI"]);
  assert.deepEqual(nextRatings(["UI"], "UI", "grant"), ["UI"]);
});
