import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareBriefs } from "./briefs.ts";
import type { Departure } from "./departures.ts";
import { parsePriceTable, priceFlightFuel } from "./fuel-cost.ts";
import {
  appendLogbook,
  attribution,
  buildEntry,
  computeActuals,
  type EntryContext,
  expectationMin,
  foldLogbook,
  type LogEntry,
  type LogLine,
  measureLines,
  needsDetails,
  needsFindings,
  planLogbook,
  readLogbook,
  revertTarget,
  weekStartOf,
 prEntries } from "./logbook.ts";
import type { GhMerged } from "./sources/github.ts";

const pr = (over: Partial<GhMerged> = {}): GhMerged => ({
  number: 31,
  title: "Add the LOGBOOK (VOC-201)",
  url: "https://github.com/o/atc/pull/31",
  headRefName: "claude/logbook",
  baseRefName: "main",
  createdAt: "2026-09-26T12:00:00Z",
  mergedAt: "2026-09-26T14:00:00Z",
  body: "",
  reviews: [],
  ...over,
});

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({
  slug: "o/atc",
  repo: "/r/atc",
  airport: "ATCC",
  ticketKeyOf: (p) => /\((VOC-\d+)\)$/.exec(p.title)?.[1] ?? null,
  labelsOf: (k) => (k === "VOC-201" ? ["type:BUILD", "wake:L", "rating:UI"] : null),
  landingStands: new Map([["/r/atc#31", new Set(["/w/atc-logbook"])]]),
  workspaces: [],
  claims: [
    { sessionId: "j", workspacePath: "/w/atc-logbook", since: "2026-09-26T11:00:00Z", lastAt: "2026-09-26T13:50:00Z" },
    { sessionId: "s", workspacePath: "/w/atc-logbook", since: "2026-09-26T10:30:00Z", lastAt: "2026-09-26T10:40:00Z" },
    { sessionId: "h", workspacePath: "/w/atc-other", since: "2026-09-26T09:00:00Z", lastAt: "2026-09-26T13:59:00Z" },
  ],
  nameOf: (id) => ({ j: "Team_J", s: "structure", h: "TEAM_H" })[id] ?? null,
  teamPattern: "^TEAM[\\s_-]?[A-Z]$",
  los: [
    { at: "2026-09-26T12:30:00Z", workspacePath: "/w/atc-logbook" },
    { at: "2026-09-26T15:00:00Z", workspacePath: "/w/atc-logbook" }, // 머지 뒤
    { at: "2026-09-26T12:30:00Z", workspacePath: "/w/atc-other" },
  ],
  ...over,
});

test("LOGBOOK 한 줄: STAND의 점유로 AIRCRAFT·출발 시각을, 리뷰로 Codex 지적·변경 요청을, 기록으로 LOS를 센다", () => {
  const e = buildEntry(
    pr({
      reviews: [
        { author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: "", commit: { oid: "a" } },
        { author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: "", commit: { oid: "b" } },
        { author: { login: "someone" }, state: "COMMENTED", submittedAt: "", commit: { oid: "b" } },
        { author: { login: "someone" }, state: "CHANGES_REQUESTED", submittedAt: "", commit: { oid: "a" } },
      ],
    }),
    ctx(),
  );
  assert.equal(e.key, "o/atc#31");
  assert.equal(e.aircraft, "TEAM_J"); // structure는 TEAM 이름이 아니라 빠진다
  assert.equal(e.flight, "VOC-201");
  assert.deepEqual(e.class, { type: "BUILD", wake: "L", ratings: ["UI"], explicit: { type: true, wake: true } });
  assert.deepEqual(e.stands, ["/w/atc-logbook"]);
  assert.equal(e.departedAt, "2026-09-26T10:30:00Z"); // 그 STAND의 가장 이른 점유(누구든)
  assert.equal(e.departedFrom, "claim");
  assert.equal(e.blockMin, 90); // 팀 소요 시간: 착수 → PR을 연 시각
  assert.equal(e.landingWaitMin, 120); // 착륙 대기: PR → 머지
  assert.equal(e.codexFindings, 2);
  assert.equal(e.changesRequested, true);
  assert.equal(e.los, 1);
  assert.equal(e.reverted, false);
});

test("LOGBOOK 한 줄: 점유가 없으면 PR을 연 시각에서 출발하고, AIRCRAFT를 모르면 null로 남긴다", () => {
  const e = buildEntry(pr({ title: "Tidy docs" }), ctx({ landingStands: new Map(), claims: [] }));
  assert.equal(e.flight, null);
  assert.equal(e.class, null);
  assert.equal(e.aircraft, null);
  assert.deepEqual(e.stands, []);
  assert.equal(e.departedFrom, "pr");
  assert.equal(e.blockMin, null); // 팀 소요 시간은 모름
  assert.equal(e.landingWaitMin, 120);
});

test("LOGBOOK STAND 찾기: landing 기록이 없으면 그 브랜치의 워크트리, 그다음 이름에 ticket key가 있는 워크트리", () => {
  const ws = { name: "", repo: "/r/atc", isMain: false, head: "", dirty: 0, lastCommitAt: null, ticketKey: null };
  const byBranch = buildEntry(pr(), ctx({ landingStands: new Map(), workspaces: [{ ...ws, path: "/w/lb", branch: "claude/logbook" }] }));
  assert.deepEqual(byBranch.stands, ["/w/lb"]);
  const byKey = buildEntry(
    pr(),
    ctx({ landingStands: new Map(), claims: [{ sessionId: "j", workspacePath: "/w/atc-voc-201-x", since: "2026-09-26T11:00:00Z", lastAt: "2026-09-26T12:00:00Z" }] }),
  );
  assert.deepEqual(byKey.stands, ["/w/atc-voc-201-x"]);
  assert.equal(byKey.aircraft, "TEAM_J");
});

test("LOGBOOK 쓰기: repo#number로 한 번만 쓰고, Revert PR은 원래 줄을 reverted로 갱신한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-logbook-"));
  const file = join(dir, "logbook.jsonl");
  const c = ctx();
  const first = planLogbook([{ ctx: c, pulls: [pr()] }], readLogbook(file), "2026-09-26T14:05:00Z");
  assert.deepEqual(first.map((l) => l.op), ["arrived"]);
  appendLogbook(first, file);
  assert.equal(planLogbook([{ ctx: c, pulls: [pr()] }], readLogbook(file)).length, 0); // 중복 없음

  const revert = pr({ number: 35, title: 'Revert "Add the LOGBOOK (VOC-201)"', url: "https://github.com/o/atc/pull/35", body: "Reverts o/atc#31", mergedAt: "2026-09-27T09:00:00Z" });
  const second = planLogbook([{ ctx: c, pulls: [revert, pr()] }], readLogbook(file));
  assert.deepEqual(second, [{ op: "reverted", t: "2026-09-27T09:00:00Z", key: "o/atc#31", by: { number: 35, url: "https://github.com/o/atc/pull/35" } }]);
  appendLogbook(second, file);
  assert.equal(planLogbook([{ ctx: c, pulls: [revert] }], readLogbook(file)).length, 0); // 되돌림도 한 번만

  const entries = foldLogbook(readLogbook(file));
  assert.equal(entries.length, 1); // Revert PR은 FLIGHT가 아니다
  assert.equal(entries[0].reverted, true);
  assert.deepEqual(entries[0].revertedBy, { number: 35, url: "https://github.com/o/atc/pull/35", at: "2026-09-27T09:00:00Z" });
});

test("fuel 칸(ATC-53): 옛 arrived 줄(없음)과 새 줄(있음)이 섞여도 접기·쓰기·실적·지시서 비교가 그대로 돈다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-logbook-"));
  const file = join(dir, "logbook.jsonl");
  const c = ctx({ landingStands: new Map([["/r/atc#31", new Set(["/w/atc-logbook"])], ["/r/atc#32", new Set(["/w/atc-logbook"])]]) });
  const old = planLogbook([{ ctx: c, pulls: [pr()] }], [], "2026-09-26T14:05:00Z");
  appendLogbook(old, file);
  const burn = { input: 1, cacheWrite5m: 0, cacheWrite1h: 2, cacheRead: 7, output: 3, requests: 1, cacheHit: 0.7 };
  const fuel = { captain: burn, crew: { ...burn, outputLowerBound: true as const }, cacheHit: 0.7, models: { "claude-opus-5-5": 2 } };
  const next = planLogbook([{ ctx: c, pulls: [pr({ number: 32, title: "Next (VOC-202)", url: "https://github.com/o/atc/pull/32", mergedAt: "2026-09-26T16:00:00Z" })] }], readLogbook(file), "2026-09-26T16:05:00Z");
  assert.equal(next.length, 1);
  if (next[0].op === "arrived") next[0].fuel = fuel;
  appendLogbook([...next, { op: "measured", t: "2026-09-26T16:10:00Z", key: "o/atc#32", rework: 0 }], file);
  assert.equal(planLogbook([{ ctx: c, pulls: [pr()] }], readLogbook(file)).length, 0); // 중복 판정은 그대로

  const entries = foldLogbook(readLogbook(file));
  assert.deepEqual(entries.map((e) => [e.key, e.fuel ?? null]), [["o/atc#32", fuel], ["o/atc#31", null]]);
  assert.equal(entries[0].measured?.rework, 0);
  const actuals = computeActuals(entries, "TEAM_J", Date.parse("2026-09-27T00:00:00Z"));
  assert.equal(actuals.total, 2);
  assert.deepEqual(actuals.recent[0].fuel, fuel);
  assert.equal(compareBriefs(prEntries(entries), Date.parse("2026-09-27T00:00:00Z"), 30).unmeasured, 2);
});

test("fuel.byModel(ATC-59): 옛 줄(fuel 없음), F4 줄(byModel 없음), 새 줄(byModel 있음)이 섞여도 접기·실적이 그대로 돌고, 값은 읽을 때 매긴다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-logbook-"));
  const file = join(dir, "logbook.jsonl");
  const stands = new Set(["/w/atc-logbook"]);
  const c = ctx({ landingStands: new Map([["/r/atc#31", stands], ["/r/atc#32", stands], ["/r/atc#33", stands]]) });
  appendLogbook(planLogbook([{ ctx: c, pulls: [pr()] }], [], "2026-09-26T14:05:00Z"), file);
  const burn = { input: 1, cacheWrite5m: 0, cacheWrite1h: 2, cacheRead: 7, output: 3, requests: 1, cacheHit: 0.7 };
  const f4 = { captain: burn, crew: { ...burn, outputLowerBound: true as const }, cacheHit: 0.7, models: { "claude-opus-5-5": 2 } };
  const tokens = { input: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, requests: 1 };
  const f5b = { ...f4, byModel: [{ model: "claude-opus-5-5", captain: tokens, leak: { count: 1, rewritten5m: 0, rewritten1h: 0 } }] };
  for (const [n, fuel, at] of [[32, f4, "2026-09-26T16:00:00Z"], [33, f5b, "2026-09-26T17:00:00Z"]] as const) {
    const next = planLogbook([{ ctx: c, pulls: [pr({ number: n, title: `N${n} (VOC-2${n})`, url: `https://github.com/o/atc/pull/${n}`, mergedAt: at })] }], readLogbook(file), at);
    if (next[0].op === "arrived") next[0].fuel = fuel;
    appendLogbook(next, file);
  }
  const entries = foldLogbook(readLogbook(file));
  assert.deepEqual(entries.map((e) => [e.key, Boolean(e.fuel), Boolean(e.fuel?.byModel)]), [
    ["o/atc#33", true, true],
    ["o/atc#32", true, false],
    ["o/atc#31", false, false],
  ]);
  assert.ok(!readFileSync(file, "utf8").includes("cost")); // 달러는 기록에 없다
  assert.equal(computeActuals(entries, "TEAM_J", Date.parse("2026-09-27T00:00:00Z")).total, 3);
  const table = parsePriceTable({ writeMult: { "5m": 1.25, "1h": 2 }, models: { "claude-opus-5-5": { in: 4, out: 20, readMult: 0.05 } } });
  assert.deepEqual(
    entries.map((e) => priceFlightFuel(e.fuel, table)?.total?.total ?? null),
    [4, null, null],
  );
});

test("LOGBOOK 되돌림 대상: body의 Reverts 참조, 없으면 같은 저장소의 같은 제목, 모르는 PR은 무시", () => {
  const e = { key: "o/atc#31", pr: { repo: "o/atc", number: 31, url: "", title: "Add X" } } as LogEntry;
  assert.equal(revertTarget({ title: 'Revert "Add X"', body: "" }, "o/atc", [e]), "o/atc#31");
  assert.equal(revertTarget({ title: 'Revert "Add X"', body: "" }, "o/other", [e]), null);
  assert.equal(revertTarget({ title: 'Revert "Whatever"', body: "Reverts o/atc#31" }, "o/atc", [e]), "o/atc#31");
  assert.equal(revertTarget({ title: 'Revert "Add X"', body: "Reverts o/atc#9" }, "o/atc", [e]), null);
  assert.equal(revertTarget({ title: "Add Y", body: "Reverts o/atc#31" }, "o/atc", [e]), null);
});

const entry = (n: number, over: Partial<LogEntry> = {}): LogEntry => ({
  key: `o/atc#${n}`,
  aircraft: "TEAM_J",
  flight: `VOC-${n}`,
  class: { type: "BUILD", wake: "M", ratings: [], explicit: { type: true, wake: true } },
  airport: "ATCC",
  pr: { repo: "o/atc", number: n, url: "", title: "" },
  stands: [],
  departedAt: "",
  departedFrom: "claim",
  arrivedAt: "2026-09-24T10:00:00Z",
  blockMin: 100,
  landingWaitMin: 60,
  codexFindings: 0,
  changesRequested: false,
  reverted: false,
  los: 0,
  ...over,
});

test("점유가 PR보다 늦게 잡히면 PR을 연 시각에서 출발하고, 팀 소요 시간은 모름(null)으로 정시율·중앙값에서 뺀다", () => {
  const late = buildEntry(
    pr(),
    ctx({ claims: [{ sessionId: "j", workspacePath: "/w/atc-logbook", since: "2026-09-26T12:30:00Z", lastAt: "2026-09-26T13:50:00Z" }] }),
  );
  assert.equal(late.aircraft, "TEAM_J"); // AIRCRAFT는 그대로 안다
  assert.equal(late.departedFrom, "pr");
  assert.equal(late.departedAt, "2026-09-26T12:00:00Z");
  assert.equal(late.blockMin, null);
  assert.equal(late.landingWaitMin, 120);

  const now = Date.parse("2026-09-26T12:00:00Z");
  const unknown = entry(1, { blockMin: null, landingWaitMin: 300, arrivedAt: "2026-09-25T10:00:00Z" });
  const known = entry(2, { blockMin: 100, landingWaitMin: 100, arrivedAt: "2026-09-24T10:00:00Z" });
  const a = computeActuals([unknown, known], "TEAM_J", now, Date.parse("2026-09-21T00:00:00Z"));
  assert.deepEqual(a.onTime, { rate: 1, within: 1, measured: 1 });
  assert.equal(a.recent[0].onTime, null);
  assert.deepEqual(a.landingWait, { medianMin: 200, count: 2 }); // 착륙 대기는 둘 다 센다
  const group = (n: number, blockMin: number | null) =>
    entry(n, { blockMin, class: { type: "BUILD", wake: "M", ratings: [], explicit: { type: false, wake: false } } });
  assert.equal(expectationMin(group(9, 50), [group(1, null), group(2, null), group(3, 40), group(4, 60)]), null); // 아는 것 2건뿐
});

test("정시 기대치: 라벨로 정한 L·M·H는 고정값, 그 밖은 같은 TYPE·WAKE 중앙값(3건 이상)", () => {
  assert.equal(expectationMin(entry(1), []), 240);
  assert.equal(expectationMin(entry(1, { class: { type: "BUILD", wake: "L", ratings: [], explicit: { type: true, wake: true } } }), []), 60);
  const unlabeled = (n: number, blockMin: number) => entry(n, { blockMin, class: { type: "BUILD", wake: "M", ratings: [], explicit: { type: false, wake: false } } });
  const adhoc = (n: number, blockMin: number) => entry(n, { blockMin, class: null, flight: null });
  const all = [unlabeled(1, 50), unlabeled(2, 100), unlabeled(3, 300), unlabeled(4, 999), adhoc(5, 10), adhoc(6, 20)];
  assert.equal(expectationMin(all[3], all), 100); // 자기 자신은 빼고 50·100·300
  assert.equal(expectationMin(all[0], [all[0], all[1], all[2]]), null); // 다른 기록이 2건뿐
  assert.equal(expectationMin(all[4], all), null); // AD HOC끼리 2건뿐
  const unknown = [1, 2, 3].map((n) => entry(n + 10, { aircraft: null, blockMin: 1, class: null, flight: null }));
  assert.equal(expectationMin(adhoc(7, 30), [...unknown, all[4], all[5]]), null); // AIRCRAFT를 모르는 기록은 중앙값에 안 쓴다
  const j = entry(9, { class: { type: "BUILD", wake: "J", ratings: [], explicit: { type: true, wake: true } } });
  assert.equal(expectationMin(j, []), null);
});

test("TARGETS 실적: 이번 주(월요일부터) ARRIVED, 14일 정시율·되돌림·LOS, 최근 5건", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const weekFrom = Date.parse("2026-09-21T00:00:00Z");
  const entries = [
    entry(1, { arrivedAt: "2026-09-25T10:00:00Z", blockMin: 200 }), // 이번 주, 정시
    entry(2, { arrivedAt: "2026-09-22T10:00:00Z", blockMin: 500, los: 2 }), // 이번 주, 지연
    entry(3, { arrivedAt: "2026-09-18T10:00:00Z", blockMin: 100, reverted: true, los: 1 }), // 지난주
    entry(4, { arrivedAt: "2026-09-01T10:00:00Z", reverted: true }), // 14일 밖
    entry(5, { arrivedAt: "2026-09-25T11:00:00Z", aircraft: "TEAM_H" }),
    entry(6, { arrivedAt: "2026-09-23T10:00:00Z", class: null, flight: null }), // 기대치 없음
  ];
  const a = computeActuals(entries, "team_j", now, weekFrom);
  assert.equal(a.week, 3);
  assert.equal(a.total, 4);
  assert.deepEqual(a.onTime, { rate: 2 / 3, within: 2, measured: 3 });
  // 이번 주 정시율(ATC-44): 이번 주 1(정시)·2(지연)만 잰다. 6은 기대치 없음
  assert.deepEqual(a.weekOnTime, { rate: 1 / 2, within: 1, measured: 2 });
  assert.equal(a.reverted, 1);
  assert.equal(a.los, 3);
  assert.deepEqual(a.recent.map((e) => [e.pr?.number, e.onTime]), [[1, true], [6, null], [2, false], [3, true], [4, true]]);
  assert.deepEqual(computeActuals(entries, "TEAM_X", now, weekFrom).onTime, { rate: null, within: 0, measured: 0 });
});

test("주 시작은 로컬 시간 월요일 00:00", () => {
  const monday = new Date(2026, 8, 21, 0, 0, 0, 0).getTime();
  assert.equal(weekStartOf(new Date(2026, 8, 26, 15, 0).getTime()), monday); // 토요일
  assert.equal(weekStartOf(new Date(2026, 8, 27, 23, 59).getTime()), monday); // 일요일
  assert.equal(weekStartOf(monday), monday);
});

const dep = (t: string, over: Partial<Departure> = {}): Departure => ({
  t, flight: "VOC-201", aircraft: "TEAM_J", stand: "/w/atc-logbook", branch: "claude/logbook", repo: "/r/atc", via: "claim", ...over,
});

test("착수 기록 귀속: 점유가 정리되고 워크트리가 지워져도 같은 브랜치의 착수 기록으로 AIRCRAFT·STAND·출발을 채운다", () => {
  const gone = ctx({ landingStands: new Map(), workspaces: [], claims: [], departures: [dep("2026-09-26T10:00:00Z", { via: "stand", aircraft: null }), dep("2026-09-26T10:05:00Z")] });
  const e = buildEntry(pr(), gone);
  assert.equal(e.aircraft, "TEAM_J");
  assert.deepEqual(e.stands, ["/w/atc-logbook"]);
  assert.equal(e.departedFrom, "departure");
  assert.equal(e.departedAt, "2026-09-26T10:00:00Z");
  assert.equal(e.blockMin, 120); // 10:00 → PR 12:00
  assert.equal(e.branch, "claude/logbook");
  // 지금 점유가 있으면 그쪽이 먼저(AIRCRAFT). 출발은 둘 중 이른 것
  const both = buildEntry(pr(), ctx({ departures: [dep("2026-09-26T09:00:00Z", { aircraft: "TEAM_H" })] }));
  assert.equal(both.aircraft, "TEAM_J");
  assert.equal(both.departedFrom, "departure");
  assert.equal(both.departedAt, "2026-09-26T09:00:00Z");
  // 착수 기록이 PR보다 늦으면(PR 뒤에 착수) 출발은 여전히 모름
  const late = buildEntry(pr(), ctx({ landingStands: new Map(), claims: [], departures: [dep("2026-09-26T13:00:00Z")] }));
  assert.equal(late.aircraft, "TEAM_J");
  assert.equal(late.departedFrom, "pr");
  assert.equal(late.blockMin, null);
});

test("attributed 보정: AIRCRAFT를 몰랐던 줄을 착수 기록으로 한 번만 채우고, 아는 AIRCRAFT는 바꾸지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-logbook-attr-"));
  const file = join(dir, "logbook.jsonl");
  // 착수 기록이 생기기 전에 들어온 줄: AIRCRAFT·출발 모름
  appendLogbook(planLogbook([{ ctx: ctx({ landingStands: new Map(), claims: [], workspaces: [] }), pulls: [pr()] }], [], "2026-09-26T14:05:00Z"), file);
  assert.equal(foldLogbook(readLogbook(file))[0].aircraft, null);
  const withLog = ctx({ landingStands: new Map(), claims: [], workspaces: [], departures: [dep("2026-09-26T11:00:00Z")] });
  const fix = planLogbook([{ ctx: withLog, pulls: [pr()] }], readLogbook(file), "2026-09-26T15:00:00Z");
  assert.deepEqual(fix, [{ op: "attributed", t: "2026-09-26T15:00:00Z", key: "o/atc#31", aircraft: "TEAM_J", via: "departures", departedAt: "2026-09-26T11:00:00Z", blockMin: 60 }]);
  appendLogbook(fix, file);
  const [e] = foldLogbook(readLogbook(file));
  assert.equal(e.aircraft, "TEAM_J");
  assert.equal(e.attributedBy, "departures");
  assert.equal(e.departedFrom, "departure");
  assert.equal(e.blockMin, 60);
  assert.equal(planLogbook([{ ctx: withLog, pulls: [pr()] }], readLogbook(file)).length, 0); // 다시 쓰지 않는다
  // 이미 아는 AIRCRAFT에는 보정 줄이 와도 무시
  const known = foldLogbook([...readLogbook(file), { op: "attributed", t: "x", key: "o/atc#31", aircraft: "TEAM_B", via: "departures" }]);
  assert.equal(known[0].aircraft, "TEAM_J");
  // 착수 기록이 없는 과거 줄은 그대로 모름(정상)
  assert.equal(attribution({ ...e, aircraft: null, branch: undefined, flight: null, stands: [] }, "/r/atc", [], "now"), null);
});

// ── 지시서 비교 측정(ATC-32) ──

test("measured 줄: 비어 있는 칸만 채우고, 먼저 쓴 값은 바꾸지 않는다", () => {
  const { op: _op, t: _t, ...base } = { op: "arrived", t: "", ...entry(7) };
  const lines: LogLine[] = [
    { op: "arrived", t: "x", ...base },
    { op: "measured", t: "a", key: "o/atc#7", brief: null, rework: 2 },
    { op: "measured", t: "b", key: "o/atc#7", brief: { kind: "DIRECT", at: "z", by: null, readbackAt: null, questions: 0 }, rework: 9, findings: { p0: 0, p1: 1, p2: 0 } },
    { op: "measured", t: "c", key: "o/atc#8", rework: 1 }, // 없는 FLIGHT
  ];
  assert.deepEqual(foldLogbook(lines)[0].measured, { brief: null, rework: 2, findings: { p0: 0, p1: 1, p2: 0 } });
});

test("measureLines: AD HOC은 지시서 null, AIRCRAFT를 모르거나 대화 기록이 없으면 다음에, 수정 커밋·지적은 읽은 PR만", () => {
  const NOW = Date.parse("2026-09-28T00:00:00Z");
  const events = [
    { t: "2026-09-24T07:00:00.000Z", dir: "in" as const, from: "uds:s", fromName: "structure", keys: ["VOC-1"], ids: [], brief: "DIRECT" as const },
    { t: "2026-09-24T07:01:00.000Z", dir: "out" as const, to: "uds:s", keys: ["VOC-1"], ids: [], readback: true },
    { t: "2026-09-24T08:00:00.000Z", dir: "write" as const, by: "leader" as const, path: "/w/voc-1/src/a.ts", keys: [], ids: [] },
    { t: "2026-09-24T08:10:00.000Z", dir: "write" as const, by: "crew" as const, path: "/w/voc-1/README.md", keys: [], ids: [] }, // 문서만: 도움
  ];
  const entries = [
    entry(1, { departedAt: "2026-09-24T07:05:00Z", stands: ["/w/voc-1"] }),
    entry(2, { flight: null }),
    entry(3, { aircraft: null }),
    entry(4, { aircraft: "TEAM_X" }), // 이어진 세션 없음
    entry(5, { measured: { brief: null, rework: 0, findings: { p0: 0, p1: 0, p2: 0 }, crew: null } }), // 다 잼
    entry(6, { arrivedAt: "2026-08-01T00:00:00Z" }), // 30일 밖
  ];
  const pulls = new Map([["o/atc#1", pr({ number: 1, createdAt: "2026-09-24T09:00:00Z", commits: [{ authoredDate: "2026-09-24T09:30:00Z", messageHeadline: "fix" }] })]]);
  assert.deepEqual(needsFindings(entries, pulls, NOW).map((e) => e.key), ["o/atc#1"]);
  const threads = new Map([["o/atc#1", [{ resolved: true, outdated: false, path: null, comments: [{ author: "chatgpt-codex-connector", at: "", commit: null, body: "![P1 Badge](x)" }] }]]]);
  const out = measureLines(entries, { pulls, eventsOf: (a) => (a === "TEAM_J" ? events : null), threads, reviews: [] }, NOW);
  assert.deepEqual(out, [
    {
      op: "measured",
      t: "2026-09-28T00:00:00.000Z",
      key: "o/atc#1",
      brief: { kind: "DIRECT", at: "2026-09-24T07:00:00.000Z", by: "structure", readbackAt: "2026-09-24T07:01:00.000Z", questions: 0 },
      crew: "SOLO",
      rework: 1,
      findings: { p0: 0, p1: 1, p2: 0 },
    },
    { op: "measured", t: "2026-09-28T00:00:00.000Z", key: "o/atc#2", brief: null, crew: null }, // STAND 모름
  ]);
  // 이미 SOLO·CREW를 잰 줄은 다시 재지 않는다. 옛 measured 줄(crew 없음)에는 새 줄이 crew만 더한다
  const old = entry(9, { departedAt: "2026-09-24T07:05:00Z", stands: ["/w/voc-1"], measured: { brief: null, rework: 0, findings: { p0: 0, p1: 0, p2: 0 } } });
  assert.deepEqual(measureLines([old], { pulls: new Map(), eventsOf: () => events, threads: new Map(), reviews: [] }, NOW), [{ op: "measured", t: "2026-09-28T00:00:00.000Z", key: "o/atc#9", crew: "SOLO" }]);
  assert.deepEqual(measureLines([{ ...old, measured: { ...old.measured, crew: null } }], { pulls: new Map(), eventsOf: () => events, threads: new Map(), reviews: [] }, NOW), []);
});

test("needsDetails: 줄 없는 새 PR, 30일 안이고 rework 없는 줄만 읽고 나머지는 건너뛴다. Revert PR은 줄 없이 되돌림으로 알아본다", () => {
  const NOW = Date.parse("2026-09-28T00:00:00Z");
  const e = (n: number, over: Partial<LogEntry> = {}) => ({ ...foldLogbook([{ op: "arrived", t: "x", ...buildEntry(pr({ number: n, mergedAt: "2026-09-26T14:00:00Z" }), ctx()) }])[0], ...over });
  const entries = [e(2), e(3, { measured: { rework: 0 } }), e(4, { arrivedAt: "2026-08-01T00:00:00Z" })];
  const pulls = [1, 2, 3, 4].map((n) => ({ slug: "o/atc", pr: pr({ number: n }) }));
  assert.deepEqual(needsDetails(pulls, entries, NOW), [{ slug: "o/atc", number: 1 }, { slug: "o/atc", number: 2 }]);
  const rev = pr({ number: 9, title: 'Revert "Add the LOGBOOK (VOC-201)"', body: "Reverts o/atc#2", mergedAt: "2026-09-27T00:00:00Z" });
  delete rev.reviews;
  assert.deepEqual(needsDetails([{ slug: "o/atc", pr: rev }], entries, NOW), []);
  const lines = planLogbook([{ ctx: ctx(), pulls: [rev] }], entries.map((x) => ({ op: "arrived" as const, t: "x", ...x })), "2026-09-28T00:00:00.000Z");
  assert.deepEqual(lines.filter((l) => l.op === "reverted").map((l) => l.key), ["o/atc#2"]);
});
