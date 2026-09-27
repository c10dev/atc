import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Departure } from "./departures.ts";
import {
  appendLogbook,
  attribution,
  buildEntry,
  computeActuals,
  type EntryContext,
  expectationMin,
  foldLogbook,
  type LogEntry,
  planLogbook,
  readLogbook,
  revertTarget,
  weekStartOf,
} from "./logbook.ts";
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
  assert.equal(a.reverted, 1);
  assert.equal(a.los, 3);
  assert.deepEqual(a.recent.map((e) => [e.pr.number, e.onTime]), [[1, true], [6, null], [2, false], [3, true], [4, true]]);
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
