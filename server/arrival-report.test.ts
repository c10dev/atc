import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendReport, foldReports, parseReport, readReports, ReportError, reportLine, type ArrivalReport } from "./arrival-report.ts";
import { BLOCKED_KEEP_MS, followingOf, REPORT_GRACE_MS, type FollowInput } from "./following.ts";
import type { PrEntry } from "./logbook.ts";
import type { Ticket } from "./model.ts";

const AT = "2026-09-29T12:00:00.000Z";
const ok = { pr: 211, tier: "user", tests: "1149/1149", discretion: 2, blocked: "none" };

test("parseReport: 고정 칸만 받아 정규화한다(TESTS 문자열, BLOCKED none 소문자)", () => {
  const r = parseReport({ ...ok, blocked: " None ", summary: "저장하지 않는다" }, "ATC-124", "D-0119", AT);
  assert.deepEqual(r, { op: "report", flight: "ATC-124", at: AT, proposal: "D-0119", pr: 211, result: null, tier: "user", tests: { pass: 1149, total: 1149 }, discretion: 2, blocked: "none" });
  assert.ok(!("summary" in r));
  assert.deepEqual(parseReport({ ...ok, tests: { pass: 3, total: 4 } }, "ATC-1", null, AT).tests, { pass: 3, total: 4 });
});

test("parseReport: PR이 없으면 RESULT 링크(TESTS 없어도 됨), 둘 다 없거나 둘 다 있으면 거절", () => {
  const r = parseReport({ result: "https://x/y", tier: "auto", discretion: 0, blocked: "none" }, "ATC-77", null, AT);
  assert.deepEqual([r.pr, r.result, r.tests], [null, "https://x/y", null]);
  assert.throws(() => parseReport({ tier: "auto", discretion: 0, blocked: "none" }, "ATC-77", null, AT), ReportError);
  assert.throws(() => parseReport({ ...ok, result: "u" }, "ATC-77", null, AT), /함께/);
  assert.throws(() => parseReport({ ...ok, tests: undefined }, "ATC-77", null, AT), /tests/);
});

test("parseReport: 잘못된 칸은 사유와 함께 거절", () => {
  const bad = (patch: object, re: RegExp, flight = "ATC-1") => assert.throws(() => parseReport({ ...ok, ...patch }, flight, null, AT), re);
  bad({ tier: "urgent" }, /tier/);
  bad({ tests: "5/4" }, /tests/);
  bad({ tests: "x" }, /tests/);
  bad({ pr: 0 }, /pr은/);
  bad({ discretion: -1 }, /discretion/);
  bad({ discretion: "many" }, /discretion/);
  bad({ blocked: "" }, /blocked/);
  bad({ blocked: "x".repeat(301) }, /300자/);
  bad({}, /FLIGHT key/, "nonsense");
});

test("foldReports: FLIGHT마다 마지막 보고가 유효, 순서와 상관없이 시각으로", () => {
  const mk = (flight: string, at: string, blocked: string): ArrivalReport => ({ ...parseReport({ ...ok, blocked }, flight, null, at) });
  const m = foldReports([mk("ATC-1", "2026-09-29T02:00:00Z", "later"), mk("ATC-1", "2026-09-29T01:00:00Z", "none"), mk("ATC-2", "2026-09-29T01:00:00Z", "none")]);
  assert.equal(m.size, 2);
  assert.equal(m.get("ATC-1")!.blocked, "later");
});

test("JSONL: 추가만 하고, 깨진 줄은 건너뛰며 읽는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-report-"));
  const file = join(dir, "arrival-reports.jsonl");
  try {
    assert.deepEqual(readReports(file), []);
    appendReport(parseReport(ok, "ATC-1", null, AT), file);
    appendReport(parseReport({ ...ok, pr: 212 }, "ATC-2", "D-0002", AT), file);
    assert.deepEqual(readReports(file).map((r) => r.flight), ["ATC-1", "ATC-2"]);
    assert.match(reportLine(readReports(file)[0]), /^ATC-1 ARRIVED 보고 기록 · PR #211 · TIER user · TESTS 1149\/1149 · DISCRETION 2 · BLOCKED none$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── FOLLOWING 두 규칙 ──
const MIN = 60_000;
const MERGED_AT = "2026-09-29T10:00:00.000Z";
const NOW = Date.parse(MERGED_AT) + 31 * MIN;
const ticket = (key: string): Ticket => ({ key, title: "t", url: "u", state: "In Progress", stateType: "started", labels: [], updatedAt: MERGED_AT, startedAt: MERGED_AT }) as unknown as Ticket;
const entry = (flight: string): PrEntry =>
  ({ flight, arrivedAt: MERGED_AT, landingWaitMin: 5, reverted: false, pr: { repo: "o/r", number: 211, url: "https://x/pull/211" } }) as unknown as PrEntry;
const input = (patch: Partial<FollowInput> = {}): FollowInput => ({
  proposals: [],
  tickets: [{ ...ticket("ATC-1"), labels: ["tail:TEAM_H"] } as Ticket],
  workspaces: [],
  pulls: [],
  logbook: [entry("ATC-1")],
  departures: [],
  now: NOW,
  ...patch,
});
const codes = (i: FollowInput) => followingOf(i).flatMap((f) => f.issues.map((x) => `${f.flight}:${x.code}`));

test("FOLLOWING no-report: PR이 머지(ON)된 지 30분이 지나도 기록된 보고가 없으면 한 건, 보고가 있으면 없다", () => {
  assert.ok(codes(input()).includes("ATC-1:no-report"));
  const item = followingOf(input()).find((f) => f.flight === "ATC-1")!.issues.find((x) => x.code === "no-report")!;
  assert.equal(item.key, "ATC-1|no-report");
  assert.equal(item.since, new Date(Date.parse(MERGED_AT) + REPORT_GRACE_MS).toISOString());
  // 30분이 안 됐으면 아직
  assert.ok(!codes(input({ now: Date.parse(MERGED_AT) + 29 * MIN })).includes("ATC-1:no-report"));
  // 보고는 머지 전에 기록돼도 된다(PR을 올릴 때 보고하므로)
  const rep = parseReport(ok, "ATC-1", null, "2026-09-29T09:00:00.000Z");
  assert.ok(!codes(input({ arrivalReports: foldReports([rep]) })).includes("ATC-1:no-report"));
  // 머지 안 된 FLIGHT는 대상이 아니다
  assert.ok(!codes(input({ logbook: [] })).includes("ATC-1:no-report"));
});

test("FOLLOWING blocked-report: BLOCKED가 none이 아닌 보고가 하루 안이면 한 건, none이거나 하루가 지나면 없다", () => {
  const blocked = parseReport({ ...ok, blocked: "CI가 자꾸 실패 — 원인 모름" }, "ATC-1", null, new Date(NOW - 5 * MIN).toISOString());
  const got = followingOf(input({ arrivalReports: foldReports([blocked]) })).find((f) => f.flight === "ATC-1")!.issues.filter((x) => x.code === "blocked-report");
  assert.equal(got.length, 1);
  assert.match(got[0].text, /BLOCKED가 있음 — CI가 자꾸 실패/);
  assert.equal(got[0].key, `ATC-1|blocked-report|${blocked.at}`);
  const none = parseReport(ok, "ATC-1", null, new Date(NOW - 5 * MIN).toISOString());
  assert.ok(!codes(input({ arrivalReports: foldReports([none]) })).some((c) => c.endsWith("blocked-report")));
  const old = { ...blocked, at: new Date(NOW - BLOCKED_KEEP_MS - MIN).toISOString() };
  assert.ok(!codes(input({ arrivalReports: foldReports([old]) })).some((c) => c.endsWith("blocked-report")));
  // 따라가는 대상이 아닌 FLIGHT(이미 오래전에 끝난 것)도 BLOCKED 보고는 보인다
  const other = parseReport({ ...ok, blocked: "권한 필요" }, "ATC-9", null, new Date(NOW - MIN).toISOString());
  assert.ok(codes(input({ arrivalReports: foldReports([other]) })).includes("ATC-9:blocked-report"));
});
