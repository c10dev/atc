import assert from "node:assert/strict";
import { test } from "node:test";
import { ghPostOf, type TalkEvent, talkEventsOf } from "./briefs.ts";
import type { Departure } from "./departures.ts";
import { landedOf, landedWhy } from "./dispatch.ts";
import { computeActuals, foldLogbook, hasPr, type LogLine, prEntries } from "./logbook.ts";
import {
  checkSuggestionOf,
  directDepartureOf,
  docsOnlyOf,
  type GhWrite,
  type MergedPr,
  readbackDeparturesOf,
  type StandFreeError,
  type StandFreeFlight,
  standFreeKey,
  standFreeLine,
  surveySuggestionOf,
  timelinessOf,
} from "./standfree.ts";

const DEP = "2026-09-28T10:00:00.000Z";
const CHECK: StandFreeFlight = { flight: "VOC-210", type: "CHECK", aircraft: "TEAM_G", departedAt: DEP, proposal: "D-0042", slug: "o/app" };
const SURVEY: StandFreeFlight = { ...CHECK, flight: "VOC-211", type: "SURVEY", proposal: null };
const post = (t: string, p: Partial<NonNullable<TalkEvent["post"]>>, keys: string[] = []): TalkEvent => ({ t, dir: "post", post: { kind: "review", repo: null, number: null, issue: null, url: null, ...p }, keys, ids: [] });
const review = (at: string, number = 400, over: Partial<GhWrite> = {}): GhWrite => ({ kind: "review", slug: "o/app", number, url: `https://github.com/o/app/pull/${number}#pullrequestreview-1`, author: "owner", at, state: "COMMENTED", ...over });
const refused = (fn: () => unknown, status: number, re: RegExp) =>
  assert.throws(fn, (e: unknown) => (e as StandFreeError).status === status && re.test((e as Error).message));

// ── 세션 기록에서 밖에 쓴 글 ──
test("gh 명령 → 밖에 쓴 글: pr review·comment, issue comment, api POST. 읽기(GET)는 아니다", () => {
  assert.deepEqual(ghPostOf("gh pr review 400 --repo o/app --comment -b 'VOC-210 review: https://x.dev/r'"), { kind: "review", repo: "o/app", number: 400, issue: null, url: "https://x.dev/r" });
  assert.equal(ghPostOf("gh pr comment https://github.com/o/app/pull/401 -b hi")?.number, 401);
  assert.equal(ghPostOf("gh issue comment 12 -R o/app -b done")?.kind, "issue-comment");
  assert.deepEqual(ghPostOf("gh api repos/o/app/pulls/400/reviews -f event=COMMENT -f body=ok"), { kind: "review", repo: "o/app", number: 400, issue: null, url: null });
  assert.equal(ghPostOf("gh api repos/o/app/issues/400/comments --input -")?.kind, "pr-comment");
  assert.equal(ghPostOf("gh api repos/o/app/pulls/400/reviews --jq '.[].state'"), null);
  assert.equal(ghPostOf("gh pr view 400"), null);
});

test("대화 기록 사건: Bash gh 호출과 Linear 댓글은 post, 답 글의 READBACK은 out", () => {
  const line = (o: unknown) => JSON.stringify(o);
  const text = [
    line({ type: "assistant", timestamp: "2026-09-28T10:05:00Z", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr review 400 --comment -b 'ok VOC-210'" } }] } }),
    line({ type: "assistant", timestamp: "2026-09-28T10:06:00Z", message: { content: [{ type: "tool_use", name: "mcp__abc__save_comment", input: { issueId: "VOC-211", body: "result: https://docs.example/r1" } }] } }),
    line({ type: "assistant", timestamp: "2026-09-28T09:59:00Z", message: { content: [{ type: "text", text: "READBACK VOC-211\n\nstarting" }] } }),
  ].join("\n");
  const ev = talkEventsOf(text);
  const posts = ev.filter((e) => e.dir === "post");
  assert.deepEqual(posts.map((e) => [e.post!.kind, e.post!.number, e.post!.issue, e.post!.url]), [
    ["review", 400, null, null],
    ["linear-comment", null, "VOC-211", "https://docs.example/r1"],
  ]);
  assert.deepEqual(posts[0].keys, ["VOC-210"]);
  const rb = ev.find((e) => e.dir === "out");
  assert.deepEqual([rb?.readback, rb?.keys], [true, ["VOC-211"]]);
});

// ── CHECK ──
test("CHECK: 그 팀 세션의 gh pr review와 짝인 대상 PR 리뷰 → 후보(증거·이유·명령)", () => {
  const s = checkSuggestionOf(CHECK, [{ slug: "o/app", number: 400 }], [post("2026-09-28T11:00:00Z", { kind: "review", number: 400 })], [review("2026-09-28T11:00:20Z")])!;
  assert.equal(s.kind, "check-review");
  assert.deepEqual(s.evidence, { url: "https://github.com/o/app/pull/400#pullrequestreview-1", author: "owner", at: "2026-09-28T11:00:20Z" });
  assert.match(s.reason, /TEAM_G 세션이 11:00에 gh pr review 400 → 검토 대상 PR #400에 리뷰\(COMMENTED\)/);
  assert.equal(s.command, "node ../controller/atcctl.mjs dispatch arrived D-0042 -- 'https://github.com/o/app/pull/400#pullrequestreview-1'");
  // PR 댓글로 남긴 리뷰도 받되 종류가 다르다
  const c = checkSuggestionOf(CHECK, [{ slug: "o/app", number: 400 }], [post("2026-09-28T11:00:00Z", { kind: "pr-comment", number: 400 })], [review("2026-09-28T11:00:05Z", 400, { kind: "comment", state: undefined })]);
  assert.equal(c?.kind, "check-comment");
});

test("CHECK: 다른 작성자(팀 세션 기록에 호출이 없음)·출발 전·대상 아닌 PR·팀 모름이면 후보 없음", () => {
  const targets = [{ slug: "o/app", number: 400 }];
  // 리뷰는 있는데 이 팀 세션이 단 것이 아님(SUPERVISOR·다른 팀·MCC도 같은 계정)
  assert.equal(checkSuggestionOf(CHECK, targets, [], [review("2026-09-28T11:00:20Z")]), null);
  // 세션 호출과 시각이 맞지 않음(다른 사람이 30분 뒤 단 리뷰)
  assert.equal(checkSuggestionOf(CHECK, targets, [post("2026-09-28T11:00:00Z", { number: 400 })], [review("2026-09-28T11:30:00Z")]), null);
  // 출발 전
  assert.equal(checkSuggestionOf(CHECK, targets, [post("2026-09-28T09:50:00Z", { number: 400 })], [review("2026-09-28T09:50:10Z")]), null);
  // 검토 대상이 아닌 PR
  assert.equal(checkSuggestionOf(CHECK, targets, [post("2026-09-28T11:00:00Z", { number: 401 })], [review("2026-09-28T11:00:10Z", 401)]), null);
  // 다른 저장소의 같은 번호
  assert.equal(checkSuggestionOf(CHECK, targets, [post("2026-09-28T11:00:00Z", { number: 400, repo: "o/other" })], [review("2026-09-28T11:00:10Z")]), null);
  // 팀을 모름
  assert.equal(checkSuggestionOf({ ...CHECK, aircraft: null }, targets, [post("2026-09-28T11:00:00Z", { number: 400 })], [review("2026-09-28T11:00:10Z")]), null);
  // 대상을 모름
  assert.equal(checkSuggestionOf(CHECK, [], [post("2026-09-28T11:00:00Z", { number: 400 })], [review("2026-09-28T11:00:10Z")]), null);
});

// ── SURVEY ──
const mergedPr = (over: Partial<MergedPr> = {}): MergedPr => ({ key: "o/app#420", flight: "VOC-211", aircraft: "TEAM_G", arrivedAt: "2026-09-28T12:00:00Z", slug: "o/app", number: 420, url: "https://github.com/o/app/pull/420", title: "Survey notes (VOC-211)", docsOnly: true, ...over });

test("SURVEY: 문서만의 머지 PR(FLIGHT key) → 그 팀 GitHub 댓글 → Linear 결과 링크 댓글 순서", () => {
  const pr = surveySuggestionOf(SURVEY, [], [], [mergedPr()])!;
  assert.equal(pr.kind, "survey-docs-pr");
  assert.equal(pr.evidence.url, "https://github.com/o/app/pull/420");
  assert.equal(pr.command, "node ../controller/atcctl.mjs dispatch arrived VOC-211 --aircraft TEAM_G -- 'https://github.com/o/app/pull/420'");
  const gh: GhWrite = { kind: "comment", slug: "o/app", number: 77, url: "https://github.com/o/app/issues/77#issuecomment-9", author: "owner", at: "2026-09-28T11:00:03Z" };
  const c = surveySuggestionOf(SURVEY, [post("2026-09-28T11:00:00Z", { kind: "issue-comment", number: 77 }, ["VOC-211"])], [gh], [])!;
  assert.equal(c.kind, "survey-comment");
  assert.equal(c.evidence.url, gh.url);
  const l = surveySuggestionOf(SURVEY, [post("2026-09-28T11:00:00Z", { kind: "linear-comment", issue: "VOC-211", url: "https://docs.example/r1" }, ["VOC-211"])], [], [])!;
  assert.equal(l.kind, "survey-linear-comment");
  assert.deepEqual(l.evidence, { url: "https://docs.example/r1", author: null, at: "2026-09-28T11:00:00Z" });
});

test("SURVEY: 다른 팀·출발 전·코드 PR·key 없는 댓글·링크 없는 Linear 댓글·팀 모름이면 후보 없음", () => {
  assert.equal(surveySuggestionOf(SURVEY, [], [], [mergedPr({ aircraft: "TEAM_H" })]), null);
  assert.equal(surveySuggestionOf(SURVEY, [], [], [mergedPr({ aircraft: null })]), null);
  assert.equal(surveySuggestionOf(SURVEY, [], [], [mergedPr({ arrivedAt: "2026-09-28T09:00:00Z" })]), null);
  assert.equal(surveySuggestionOf(SURVEY, [], [], [mergedPr({ docsOnly: false })]), null);
  assert.equal(surveySuggestionOf(SURVEY, [], [], [mergedPr({ docsOnly: null })]), null);
  assert.equal(surveySuggestionOf(SURVEY, [], [], [mergedPr({ flight: null, title: "Other notes" })]), null);
  const gh: GhWrite = { kind: "comment", slug: "o/app", number: 77, url: "u", author: "owner", at: "2026-09-28T11:00:03Z" };
  assert.equal(surveySuggestionOf(SURVEY, [post("2026-09-28T11:00:00Z", { kind: "issue-comment", number: 77 }, ["VOC-999"])], [gh], []), null);
  assert.equal(surveySuggestionOf(SURVEY, [], [gh], []), null); // 댓글은 있는데 이 팀이 단 것이 아님
  assert.equal(surveySuggestionOf(SURVEY, [post("2026-09-28T11:00:00Z", { kind: "linear-comment", issue: "VOC-211", url: null })], [], []), null);
  assert.equal(surveySuggestionOf(SURVEY, [post("2026-09-28T09:00:00Z", { kind: "linear-comment", issue: "VOC-211", url: "https://r" })], [], []), null);
  assert.equal(surveySuggestionOf({ ...SURVEY, aircraft: null }, [], [], [mergedPr()]), null);
});

test("문서만의 PR", () => {
  assert.equal(docsOnlyOf(["docs/a.md", "README.ko.md", "notes/x.txt"]), true);
  assert.equal(docsOnlyOf(["docs/a.md", "src/x.ts"]), false);
  assert.equal(docsOnlyOf(null), null);
  assert.equal(docsOnlyOf([]), null);
});

// ── 직접 배정의 착수(DEPARTURE LOG readback) ──
test("READBACK → DEPARTURE LOG 착수: STAND 없는 FLIGHT만, D-xxxx로 보낸 짝은 빼고, 한 번만, ARRIVED 뒤 다시", () => {
  const rb = (t: string, keys: string[]): TalkEvent => ({ t, dir: "out", readback: true, keys, ids: [] });
  const base = {
    standFree: (k: string) => k !== "VOC-300",
    repoOf: () => "/r/app",
    entries: [],
    dispatched: new Set(["VOC-212|TEAM_G"]),
    since: "2026-09-01T00:00:00Z",
  };
  const events = new Map([["TEAM_G", [rb("2026-09-28T10:00:00Z", ["VOC-211", "VOC-300"]), rb("2026-09-28T10:10:00Z", ["VOC-211"]), rb("2026-09-28T10:20:00Z", ["VOC-212"])]]]);
  const lines = readbackDeparturesOf({ ...base, events, existing: [] });
  assert.deepEqual(lines, [{ t: "2026-09-28T10:00:00Z", flight: "VOC-211", aircraft: "TEAM_G", stand: null, branch: null, repo: "/r/app", via: "readback" }]);
  // 다시 돌려도 같은 줄을 쓰지 않는다
  assert.deepEqual(readbackDeparturesOf({ ...base, events, existing: lines }), []);
  // ARRIVED 뒤의 READBACK은 새 착수
  const later = new Map([["TEAM_G", [rb("2026-09-29T09:00:00Z", ["VOC-211"])]]]);
  const arrived = [{ flight: "VOC-211", aircraft: "TEAM_G", departedAt: "2026-09-28T10:00:00Z", standFree: { arrivedVia: "report" as const, evidence: { url: null, note: "x" }, workDoneAt: null, proposal: null } }];
  assert.equal(readbackDeparturesOf({ ...base, events: later, existing: lines, entries: arrived }).length, 1);
  assert.equal(readbackDeparturesOf({ ...base, events: later, existing: lines, entries: [] }).length, 0);
});

test("직접 배정의 ARRIVED: STAND 없는 FLIGHT, 떠 있는 D-xxxx 없음, DEPARTURE LOG 착수 필요, 한 착수에 한 번", () => {
  const dep: Departure = { t: DEP, flight: "VOC-211", aircraft: "TEAM_G", stand: null, branch: null, repo: "/r", via: "readback" };
  const x = { flight: "VOC-211", aircraft: "TEAM_G", standFree: true, inFlight: [], departures: [dep], entries: [] };
  assert.equal(directDepartureOf(x), dep);
  refused(() => directDepartureOf({ ...x, standFree: false }), 409, /STAND가 있는 FLIGHT/);
  refused(() => directDepartureOf({ ...x, standFree: null }), 404, /모름/);
  refused(() => directDepartureOf({ ...x, inFlight: [{ id: "D-0042", flight: "VOC-211" }] }), 409, /D-0042/);
  refused(() => directDepartureOf({ ...x, departures: [{ ...dep, aircraft: "TEAM_H" }] }), 409, /착수\(READBACK\)가 없음/);
  refused(() => directDepartureOf({ ...x, entries: [{ key: standFreeKey("VOC-211", DEP) }] }), 409, /이미 ARRIVED/);
});

// ── 확인 → LOGBOOK ──
const CLS = { type: "CHECK" as const, wake: "L" as const, ratings: ["UI" as const], explicit: { type: true, wake: true } };
const confirm = (over = {}) => ({ flight: "VOC-210", aircraft: "TEAM_G", cls: CLS, airport: "VCDO", departedAt: DEP, departedFrom: "readback" as const, arrivedAt: "2026-09-28T13:00:00.000Z", note: "done: https://github.com/o/app/pull/400#pullrequestreview-1", proposal: "D-0042", suggestion: null, ...over });

test("확인된 ARRIVED의 LOGBOOK 줄: PR 없음, arrivedVia·증거·일 끝난 시각, 팀 소요 시간은 착수 → 일 끝", () => {
  const s = checkSuggestionOf(CHECK, [{ slug: "o/app", number: 400 }], [post("2026-09-28T11:00:00Z", { number: 400 })], [review("2026-09-28T11:00:20.000Z")]);
  const line = standFreeLine(confirm({ suggestion: s }), "2026-09-28T13:00:01.000Z");
  assert.equal(line.key, "standfree:VOC-210@2026-09-28T10:00:00.000Z");
  assert.equal(line.pr, undefined);
  assert.equal(line.landingWaitMin, null);
  assert.deepEqual(line.stands, []);
  assert.deepEqual(line.standFree, { arrivedVia: "confirmed-suggestion", evidence: { url: "https://github.com/o/app/pull/400#pullrequestreview-1", note: confirm().note }, workDoneAt: "2026-09-28T11:00:20.000Z", proposal: "D-0042" });
  assert.equal(line.blockMin, 60);
  // 후보 없이 CAPTAIN 보고만: report, 일 끝난 시각 모름 → 팀 소요 시간은 확인 시각까지
  const r = standFreeLine(confirm({ note: "no link, summary sent" }), "t");
  assert.deepEqual([r.standFree!.arrivedVia, r.standFree!.evidence.url, r.standFree!.workDoneAt, r.blockMin], ["report", null, null, 180]);
  // 다른 FLIGHT의 후보는 쓰지 않는다
  assert.equal(standFreeLine(confirm({ suggestion: { ...s!, flight: "VOC-999" } }), "t").standFree!.arrivedVia, "report");
});

test("LOGBOOK: STAND 없는 줄도 실적(이번 주·정시·총)에 세고, PR·착륙 대기를 쓰는 곳은 뺀다. 옛 줄은 그대로", () => {
  const now = Date.parse("2026-09-29T00:00:00Z");
  const sf = standFreeLine(confirm(), "2026-09-28T13:00:01.000Z");
  const pr: LogLine = {
    op: "arrived", t: "x", key: "o/app#31", aircraft: "TEAM_G", flight: "VOC-201", class: { type: "BUILD", wake: "M", ratings: [], explicit: { type: true, wake: true } }, airport: "VCDO",
    pr: { repo: "o/app", number: 31, url: "u", title: "t" }, stands: ["/w"], departedAt: "2026-09-28T01:00:00Z", departedFrom: "claim", arrivedAt: "2026-09-28T05:00:00Z", blockMin: 120, landingWaitMin: 120,
    codexFindings: 0, changesRequested: false, reverted: false, los: 0,
  };
  const entries = foldLogbook([pr, sf]);
  const a = computeActuals(entries, "TEAM_G", now, Date.parse("2026-09-28T00:00:00Z"));
  assert.equal(a.week, 2);
  assert.equal(a.total, 2);
  // CHECK L(60분)인데 착수 → 보고 180분: 늦음. PR 줄은 M 240분 안
  assert.deepEqual(a.onTime, { rate: 0.5, within: 1, measured: 2 });
  assert.deepEqual(a.landingWait, { medianMin: 120, count: 1 });
  assert.deepEqual(prEntries(entries).map((e) => e.key), ["o/app#31"]);
  assert.deepEqual(entries.filter(hasPr).map((e) => e.key), ["o/app#31"]);
  // 옛 줄(실제 LOGBOOK 모양)은 접어도 그대로다
  assert.equal(entries.find((e) => e.key === "o/app#31")?.standFree, undefined);
});

test("지표: 일이 끝난 뒤 24시간 안에 ARRIVED한 비율. 24시간 넘게 확인 안 된 후보는 놓친 것", () => {
  const now = Date.parse("2026-09-30T00:00:00Z");
  const e = (arrivedAt: string, workDoneAt: string | null) => ({ arrivedAt, standFree: { arrivedVia: "confirmed-suggestion" as const, evidence: { url: null, note: "" }, workDoneAt, proposal: null } });
  const t = timelinessOf(
    [e("2026-09-28T12:00:00Z", "2026-09-28T11:00:00Z"), e("2026-09-29T20:00:00Z", "2026-09-28T11:00:00Z"), e("2026-09-29T01:00:00Z", null), { arrivedAt: "2026-09-29T01:00:00Z", standFree: undefined }],
    [{ evidence: { url: "u", author: null, at: "2026-09-28T20:00:00Z" } }, { evidence: { url: "u", author: null, at: "2026-09-29T20:00:00Z" } }],
    now,
  );
  assert.deepEqual([t.within, t.total, t.pendingLate], [2, 4, 1]);
  assert.equal(t.rate, 0.5);
  assert.equal(timelinessOf([], [], now).rate, null);
});

test("확인된 STAND 없는 ARRIVED는 끝난 FLIGHT: planner가 다시 내지 않는다(LOGBOOK)", () => {
  const entries = foldLogbook([standFreeLine(confirm(), "t")]);
  const landed = landedOf(entries);
  assert.equal(landedWhy(landed.get("VOC-210")!), "이미 완료됨 — STAND 없이 ARRIVED(LOGBOOK)");
  assert.equal(landedWhy("app#31"), "이미 완료됨 — PR app#31 머지됨(LOGBOOK)");
});
