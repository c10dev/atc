import assert from "node:assert/strict";
import { test } from "node:test";
import { laneDaysOf, type LaneOp, type LanePull, laneSilentSince, laneStepOf, singleLaneCauseOf, LANE_SILENT_MS } from "./codex-lane.ts";
import { buildPulls, type GhPull } from "./landing.ts";

// ATC-386: Codex가 저장소 전체에서 조용하면 기다리는 PR·새 head는 6시간이 아니라 곧바로 REVIEW로 간다.

const REPO = "/p/vocado_nextjs";
const SLUG = "chaehy5665/vocado_nextjs";
const T0 = "2026-10-02T00:00:00.000Z";
const at = (min: number) => Date.parse(T0) + min * 60_000;
const iso = (min: number) => new Date(at(min)).toISOString();

// 열린 PR 하나(Codex 신호를 읽은 상태). headAt은 T0 + headMin분
const lp = (number: number, headMin: number, codex: Partial<NonNullable<LanePull["codex"]>> = {}, over: Partial<LanePull> = {}): LanePull => ({
  number,
  createdAt: iso(headMin - 5),
  reviews: [],
  isDraft: false,
  codex: { headAt: iso(headMin), thumbsAt: null, lastComment: null, ...codex },
  ...over,
});

test("silent: a PR waited the set time and Codex gave no signal on any PR in the repository", () => {
  const s = laneStepOf(REPO, null, [lp(1, 0), lp(2, 10)], at(LANE_SILENT_MS / 60_000 + 1));
  assert.equal(s.silentAt, iso(LANE_SILENT_MS / 60_000)); // 가장 먼저 기다린 PR의 base + 임계
  assert.equal(s.op?.op, "silent");
  assert.deepEqual(s.op?.evidence, [1]); // PR 2는 아직 임계를 못 채웠다
});

test("not silent: waiting less than the set time, or no PR waiting at all (a quiet repository with nothing open)", () => {
  assert.equal(laneStepOf(REPO, null, [lp(1, 0)], at(20)).silentAt, null);
  assert.equal(laneStepOf(REPO, null, [], at(500)).silentAt, null);
});

test("not silent: Codex spoke on another PR after this one began waiting — only this PR is quiet, the per-PR rule covers it", () => {
  const spoke = lp(2, 5, { lastComment: { at: iso(20), limit: false } as never });
  assert.equal(laneStepOf(REPO, null, [lp(1, 0), spoke], at(60)).silentAt, null);
  // 한도 안내도 말한 것이다(한도 경로가 맡는다)
  const limited = lp(2, 5, { lastComment: { at: iso(20), limit: true } as never });
  assert.equal(laneStepOf(REPO, null, [lp(1, 0), limited], at(60)).silentAt, null);
});

test("drafts and PRs whose Codex signal was not read yet are no evidence of waiting", () => {
  assert.equal(laneStepOf(REPO, null, [lp(1, 0, {}, { isDraft: true })], at(60)).silentAt, null);
  assert.equal(laneStepOf(REPO, null, [lp(1, 0, {}, { codex: null as never })], at(60)).silentAt, null);
});

test("once silent it stays silent for new heads, and goes back to Codex when Codex speaks again", () => {
  const since = iso(30);
  // 새 head(조금 전에 push)가 있어도 조용한 채
  const stay = laneStepOf(REPO, since, [lp(1, 0), lp(2, 50)], at(55));
  assert.equal(stay.silentAt, since);
  assert.equal(stay.op, null);
  // 조용하다고 본 뒤 Codex가 저장소의 어느 PR에든 말하면 돌아온다
  const back = laneStepOf(REPO, since, [lp(1, 0), lp(2, 50, { thumbsAt: iso(54) })], at(55));
  assert.equal(back.silentAt, null);
  assert.equal(back.op?.op, "speaks");
  // 조용하다고 보기 전의 신호는 돌아옴이 아니다
  assert.equal(laneStepOf(REPO, since, [lp(1, 0, { thumbsAt: iso(10) })], at(55)).silentAt, since);
});

test("laneSilentSince: the repository's last record decides", () => {
  const ops: LaneOp[] = [
    { t: iso(31), repo: REPO, op: "silent", since: iso(30), evidence: [1] },
    { t: iso(80), repo: REPO, op: "speaks" },
    { t: iso(90), repo: "/p/other", op: "silent", since: iso(85) },
  ];
  assert.equal(laneSilentSince(ops, REPO), null);
  assert.equal(laneSilentSince(ops, "/p/other"), iso(85));
  assert.equal(laneSilentSince(ops.slice(0, 1), REPO), iso(30));
  assert.equal(laneSilentSince([], REPO), null);
});

// ── buildPulls: 저장소가 조용하면 곧바로 REVIEW, 제외는 그대로 ──
const gh = (over: Partial<GhPull> = {}): GhPull => ({
  number: 401,
  title: "Record album artwork (VOC-174)",
  url: `https://github.com/${SLUG}/pull/401`,
  headRefName: "claude/voc-174",
  headRefOid: "36f36a0".padEnd(40, "0"),
  baseRefName: "main",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  createdAt: iso(-60),
  author: { login: "chaehy5665" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [],
  labels: [],
  body: "",
  files: ["src/app/album/page.tsx"],
  codex: { headAt: iso(0), thumbsAt: null, lastComment: null },
  ...over,
});
const build = (g: GhPull, lane: string | null, now = at(45)) =>
  buildPulls([{ repo: REPO, pulls: [g], defaultBranch: "main" }], [], [], new Map(), () => "VOC-174", new Date(now).toISOString(), {
    silentMs: 6 * 3_600_000,
    reviews: [],
    ticketLabelsOf: () => [],
    ticketTitleOf: () => null,
    lane: () => lane,
  })[0]!;

test("buildPulls: a quiet repository sends the waiting PR to REVIEW at once instead of after 6 hours", () => {
  assert.equal(build(gh(), null).codexUnavailable, null); // 오늘: 6시간
  const p = build(gh(), iso(30));
  assert.deepEqual(p.codexUnavailable, { why: "lane", since: iso(30), scope: "repo" });
  assert.equal(p.extReview?.status, "waiting");
  assert.match(p.blocks.map((b) => b.text).join(" "), /Codex 저장소 무응답/);
  assert.match(p.blocks.map((b) => b.en).join(" "), /Codex silent across the repository/);
});

test("buildPulls: a head Codex already answered is not sent (the quiet repository does not override a real signal)", () => {
  const p = build(gh({ codex: { headAt: iso(0), thumbsAt: iso(20), lastComment: null } }), iso(30));
  assert.equal(p.codexUnavailable, null);
});

test("buildPulls: REVIEW still may not take secrets paths or (switch off) security paths", () => {
  const secret = build(gh({ files: ["src/.env.local"] }), iso(30));
  assert.equal(secret.codexUnavailable?.why, "lane");
  assert.equal(secret.extReview?.status, "excluded");
  assert.equal(secret.landing, "APPROACH");
  const sql = build(gh({ files: ["supabase/migrations/20261002_x.sql"] }), iso(30));
  assert.equal(sql.extReview?.status, "excluded");
  assert.equal(sql.externalExclusion, "migrations");
});

// ── 한 레인으로 착륙 ──
test("singleLaneCauseOf: cleared on the REVIEW lane only, with the reason Codex was unavailable", () => {
  assert.equal(singleLaneCauseOf({ landing: "CLEARED", codexUnavailable: { why: "lane" }, extReview: { status: "pass" } }), "lane");
  assert.equal(singleLaneCauseOf({ landing: "CLEARED", codexUnavailable: { why: "limit" }, extReview: { status: "pass" } }), "limit");
  assert.equal(singleLaneCauseOf({ landing: "CLEARED", codexUnavailable: null, extReview: null }), null); // 두 레인(또는 Codex)으로 통과
  assert.equal(singleLaneCauseOf({ landing: "APPROACH", codexUnavailable: { why: "lane" }, extReview: { status: "pass" } }), null);
  assert.equal(singleLaneCauseOf({ landing: "CLEARED", codexUnavailable: { why: "lane" }, extReview: { status: "excluded" } }), null);
});

test("laneDaysOf: per UTC day, how many landed and how many of them landed on one lane, by cause", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const landed = [
    { t: "2026-10-02T01:00:00Z", airport: "VCDO", number: 1, head: "aaaaaaa1" },
    { t: "2026-10-02T02:00:00Z", airport: "VCDO", number: 2, head: "bbbbbbb2" },
    { t: "2026-10-02T02:30:00Z", airport: "VCDO", number: 2, head: "bbbbbbb2" }, // 같은 PR·head의 두 번째 기록은 세지 않는다
    { t: "2026-10-01T09:00:00Z", airport: "VCDO", number: 3, head: "ccccccc3" },
  ];
  const lines = [
    { t: "2026-10-02T00:50:00Z", repo: REPO, number: 1, head: "aaaaaaa1", cause: "lane" as const },
    { t: "2026-09-30T00:50:00Z", repo: REPO, number: 9, head: "ddddddd9", cause: "limit" as const }, // 착륙 기록이 없다: 세지 않는다
  ];
  const days = laneDaysOf(landed, lines, 3, now, (repo) => (repo === REPO ? "VCDO" : repo));
  assert.deepEqual(days.map((d) => d.day), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(days[2], { day: "2026-10-02", landed: 2, single: 1, causes: { lane: 1 } });
  assert.deepEqual(days[1], { day: "2026-10-01", landed: 1, single: 0, causes: {} });
  assert.equal(days[0]!.landed, 0);
});

// PR 번호는 저장소마다 따로 센다: 다른 저장소의 같은 번호·head 앞 7자리가 단일 레인으로 세어지지 않는다(PR 429 P2)
test("laneDaysOf: the same PR number and head in another repository is not counted as a single-lane landing", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const landed = [{ t: "2026-10-02T01:00:00Z", airport: "ATCC", number: 7, head: "aaaaaaa1" }];
  const lines = [{ t: "2026-10-02T00:50:00Z", repo: REPO, number: 7, head: "aaaaaaa1", cause: "lane" as const }];
  const airportOf = (repo: string) => (repo === REPO ? "VCDO" : repo);
  assert.deepEqual(laneDaysOf(landed, lines, 1, now, airportOf)[0], { day: "2026-10-02", landed: 1, single: 0, causes: {} });
  assert.deepEqual(laneDaysOf([{ ...landed[0]!, airport: "VCDO" }], lines, 1, now, airportOf)[0], { day: "2026-10-02", landed: 1, single: 1, causes: { lane: 1 } });
});

// 옛 AUTOLAND merge 기록에는 airport가 없다: 저장소를 모르니 번호·head만으로 짝을 짓는다(옛 방식). airport가 있으면 저장소까지 맞아야 한다
test("laneDaysOf: a landing line without an airport (older AUTOLAND records) still matches the single-lane line by number and head", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const lines = [{ t: "2026-10-02T00:50:00Z", repo: REPO, number: 7, head: "aaaaaaa1", cause: "lane" as const }];
  const airportOf = (repo: string) => (repo === REPO ? "VCDO" : repo);
  const old = [{ t: "2026-10-02T01:00:00Z", airport: "", number: 7, head: "aaaaaaa1" }];
  assert.deepEqual(laneDaysOf(old, lines, 1, now, airportOf)[0], { day: "2026-10-02", landed: 1, single: 1, causes: { lane: 1 } });
  assert.equal(laneDaysOf([{ ...old[0]!, airport: "ATCC" }], lines, 1, now, airportOf)[0]!.single, 0); // 다른 저장소는 여전히 아니다
});
