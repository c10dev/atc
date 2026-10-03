import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { atcRecord, type AtcState, checkGreenAt, claudeTokensOf, controlShare, type GhPr, soloRecord, transcriptFacts } from "./arm-metrics.ts";
import { foldLogbook, type LogLine } from "./logbook.ts";

// 합성 fixture: 세션·저장소·이슈 이름·시각은 전부 지어낸 값이다
const T0 = Date.parse("2030-01-01T00:00:00Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const usage = (i: number, o: number, cw = 0, cr = 0) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr });
const asst = (min: number, id: string, u: object | null, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", sessionId: "s1", timestamp: iso(min), requestId: `r-${id}`, version: "9.9.9", message: { id, model: "claude-test-1", ...(u ? { usage: u } : {}), content: [{ type: "text", text: "secret body" }] }, ...extra });
const human = (min: number, content: unknown = "do the thing") => JSON.stringify({ type: "user", sessionId: "s1", timestamp: iso(min), message: { role: "user", content } });
const toolResult = (min: number, text: string, isError: boolean) =>
  JSON.stringify({ type: "user", sessionId: "s1", timestamp: iso(min), message: { role: "user", content: [{ type: "tool_result", is_error: isError, content: text }] } });

const SOLO = [
  human(0, "WORK ORDER text"),
  asst(1, "m1", usage(10, 20, 100, 1000)),
  asst(1, "m1", usage(10, 20, 100, 1000)), // 같은 요청의 사본: 한 번만
  asst(2, "m2", usage(5, 5, 0, 500), { isSidechain: true }), // CREW
  toolResult(3, "The user doesn't want to proceed with this tool use.", true),
  toolResult(4, "ok", false),
  human(5, [{ type: "text", text: "please also fix X" }]),
  human(6, "<system-reminder>not a human</system-reminder>"),
  JSON.stringify({ type: "user", isMeta: true, sessionId: "s1", timestamp: iso(7), message: { role: "user", content: "meta" } }),
  asst(8, "m3", usage(1, 1)),
].join("\n");

const pr = (over: Partial<GhPr> = {}): GhPr => ({
  number: 7,
  createdAt: iso(10),
  isDraft: true,
  commits: [
    { authoredDate: iso(5), messageHeadline: "first" },
    { authoredDate: iso(15), messageHeadline: "fix after open" },
    { authoredDate: iso(16), messageHeadline: "Merge branch 'main'" },
  ],
  checks: [
    { name: "check", conclusion: "FAILURE", completedAt: iso(20) },
    { name: "check", conclusion: "SUCCESS", completedAt: iso(30) },
    { name: "other", conclusion: "SUCCESS", completedAt: iso(40) },
  ],
  reviews: [
    { author: "chatgpt-codex-connector", state: "COMMENTED" },
    { author: "someone", state: "COMMENTED" },
  ],
  ...over,
});

test("transcriptFacts: FUEL 파서로 센다, 중복은 한 번, CREW는 따로", () => {
  const f = transcriptFacts(SOLO);
  assert.equal(f.records.length, 3);
  assert.equal(f.records.filter((r) => r.sidechain).length, 1);
});

test("transcriptFacts: 사람 메시지만, 도구 결과·시스템 알림·메타 제외, 거절은 따로", () => {
  const f = transcriptFacts(SOLO);
  assert.deepEqual(f.humanTurns, [iso(0), iso(5)]);
  assert.deepEqual(f.rejections, [iso(3)]);
});

test("soloRecord: 필드 전부", () => {
  const r = soloRecord({ issue: "ATC-1", start: iso(0), transcript: SOLO, pr: pr() });
  assert.equal(r.arm, "solo");
  assert.equal(r.mergeReady, iso(30));
  assert.equal(r.elapsedMin, 30);
  assert.equal(r.reworkRounds, 1); // 머지 커밋·PR 전 커밋 제외
  assert.equal(r.interruptions.count, 2); // 메시지 1 + 거절 1
  assert.equal(r.interruptions.parts.permissionApprovals, null);
  assert.equal(r.tokens.measured, true);
  assert.equal(r.tokens.captain?.cacheRead, 1000 + 0);
  assert.equal(r.tokens.crew?.cacheRead, 500);
  assert.equal(r.tokens.total, 10 + 20 + 100 + 1000 + 5 + 5 + 500 + 2);
  assert.equal(r.codexReviews, 1);
  assert.equal(r.codexTokens, "unmeasured");
  assert.deepEqual(r.models, ["claude-test-1"]);
  assert.deepEqual(r.versions, ["9.9.9"]);
  assert.equal(r.control, null);
});

test("soloRecord: usage가 없는 대화 기록은 토큰을 모름으로 두고 실패하지 않는다", () => {
  const text = [human(0), asst(1, "m1", null), human(2, "more")].join("\n");
  const r = soloRecord({ issue: "ATC-1", start: iso(0), transcript: text, pr: pr() });
  assert.equal(r.tokens.measured, false);
  assert.equal(r.tokens.total, null);
  assert.equal(claudeTokensOf(r), null);
  assert.equal(r.interruptions.count, 1);
  assert.match(r.notes.join(" "), /unmeasured/);
});

test("soloRecord: 대화 기록도 PR도 없으면 모두 모름", () => {
  const r = soloRecord({ issue: "ATC-1", start: iso(0), transcript: null, pr: null });
  assert.equal(r.mergeReady, null);
  assert.equal(r.elapsedMin, null);
  assert.equal(r.interruptions.count, null);
  assert.equal(r.reworkRounds, null);
  assert.equal(r.tokens.measured, false);
});

test("checkGreenAt: 마지막 check가 실패면 null, 이름이 다른 run은 무시", () => {
  assert.equal(checkGreenAt(pr().checks), iso(30));
  assert.equal(checkGreenAt([{ name: "check", conclusion: "SUCCESS", completedAt: iso(1) }, { name: "check", conclusion: "FAILURE", completedAt: iso(2) }]), null);
  assert.equal(checkGreenAt([{ name: "other", conclusion: "SUCCESS", completedAt: iso(1) }]), null);
});

test("soloRecord: 블라인드 리뷰가 CI보다 늦으면 merge-ready는 리뷰 통과 시각", () => {
  const r = soloRecord({ issue: "ATC-1", start: iso(0), transcript: null, pr: pr(), reviewPassedAt: iso(50) });
  assert.equal(r.mergeReady, iso(50));
  assert.equal(r.elapsedMin, 50);
});

// ── atc ──
const lines: LogLine[] = [
  {
    op: "arrived",
    t: iso(100),
    key: "o/r#1",
    aircraft: "TEAM_X",
    flight: "ATC-1",
    class: null,
    airport: null,
    pr: { repo: "o/r", number: 1, url: "u", title: "t" },
    stands: [],
    departedAt: iso(20), // blockMin의 시작: 실험 창 시작이 아니다
    departedFrom: "departure",
    arrivedAt: iso(60),
    blockMin: 40,
    landingWaitMin: 15,
    codexFindings: 2,
    changesRequested: false,
    reverted: false,
    los: 0,
    fuel: {
      captain: { input: 1, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 4, output: 5, requests: 3, cacheHit: null },
      crew: { input: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 10, requests: 2, cacheHit: null, agents: 1 },
      cacheHit: null,
      models: { "claude-test-1": 5 },
    },
  } as unknown as LogLine,
  { op: "measured", t: iso(101), key: "o/r#1", rework: 3 } as unknown as LogLine,
];

const state = (): AtcState => ({
  logbook: foldLogbook(lines),
  leaks: [
    { ev: "open", t: iso(30), flight: "ATC-1", id: "a" },
    { ev: "close", t: iso(35), flight: "ATC-1", id: "a" },
    { ev: "open", t: iso(31), flight: "ATC-2", id: "b" },
    { ev: "open", t: iso(500), flight: "ATC-1", id: "c" }, // 창 밖
  ],
  relays: [
    { op: "create", at: iso(40), flight: "ATC-1" },
    { op: "issued", at: iso(41), flight: null, id: "R-1" },
  ],
  proposals: [
    { op: "create", id: "D-1", at: iso(1), flight: "ATC-1" },
    { op: "approve", id: "D-1", at: iso(2) },
    { op: "create", id: "D-2", at: iso(1), flight: "ATC-1" },
    { op: "approve", id: "D-2", at: iso(2), via: "auto" }, // 사람이 아님
  ],
  clearances: [{ op: "issue", id: "C-1", at: iso(45), flight: "ATC-1" }],
});

const ctl = (role: string, mins: number[]) => ({ role, text: mins.map((m, i) => asst(m, `${role}${i}`, usage(100, 100))).join("\n") });

test("controlShare: 창 안 요청만, 이슈 수로 고르게 나눈다", () => {
  const c = controlShare([ctl("OCC", [10, 20, 900]), ctl("MCC", [30])], { start: iso(0), end: iso(120) }, 4);
  assert.equal(c.tokens, 600); // 3 요청 × 200
  assert.equal(c.perIssue, 150);
  assert.deepEqual(c.byRole, { OCC: 400, MCC: 200 });
});

test("atcRecord: 시작은 창의 시작(blockMin 아님), 칸이 모두 채워진다", () => {
  const r = atcRecord({ issue: "ATC-1", start: iso(0), window: { start: iso(0), end: iso(120) }, batchIssues: 2, state: state(), control: [ctl("OCC", [10, 20])] });
  assert.equal(r.start, iso(0));
  assert.equal(r.mergeReady, iso(75)); // arrivedAt 60 + 착륙 대기 15
  assert.equal(r.elapsedMin, 75); // blockMin(40)이 아니다
  assert.equal(r.reworkRounds, 3);
  assert.equal(r.interruptions.count, 3); // leak 1 + relay 1 + 사람 승인 1
  assert.deepEqual(r.interruptions.parts, { leakOpens: 1, relays: 1, approvals: 1, clearancesIssued: 1 });
  assert.equal(r.tokens.total, 15 + 20);
  assert.equal(r.control?.perIssue, 200); // 2 요청 × 200 / 2
  assert.equal(claudeTokensOf(r), 35 + 200);
  assert.equal(r.codexReviews, 2);
  assert.equal(r.codexTokens, "unmeasured");
  assert.deepEqual(r.models, ["claude-test-1"]);
});

test("atcRecord: LOGBOOK에 없는 이슈는 모름으로 둔다", () => {
  const r = atcRecord({ issue: "ATC-9", start: iso(0), window: { start: iso(0), end: iso(120) }, batchIssues: 1, state: state(), control: [] });
  assert.equal(r.tokens.measured, false);
  assert.equal(r.mergeReady, null);
  assert.equal(r.codexReviews, null);
});

// ── CLI: 상태 폴더는 읽기만 한다 ──
test("CLI: 임시 상태 폴더 fixture를 읽고 폴더를 바꾸지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "arm-metrics-"));
  try {
    const st = join(dir, "state");
    mkdirSync(st);
    const put = (f: string, rows: unknown[]) => writeFileSync(join(st, f), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
    put("logbook.jsonl", lines);
    put("leaks.jsonl", state().leaks);
    put("relays.jsonl", state().relays);
    put("proposals.jsonl", state().proposals);
    put("clearances.jsonl", state().clearances);
    writeFileSync(join(dir, "occ.jsonl"), ctl("OCC", [10]).text + "\n");
    writeFileSync(join(dir, "spec.json"), JSON.stringify({ arm: "atc", window: { start: iso(0), end: iso(120) }, issues: [{ key: "ATC-1" }], control: [{ role: "OCC", file: join(dir, "occ.jsonl") }] }));
    const before = readdirSync(st).map((f) => [f, readFileSync(join(st, f), "utf8")]);
    const out = execFileSync("node", [new URL("./arm-metrics-run.ts", import.meta.url).pathname, "--spec", join(dir, "spec.json"), "--state", st, "--json"], { encoding: "utf8" });
    const [rec] = JSON.parse(out);
    assert.equal(rec.issue, "ATC-1");
    assert.equal(rec.elapsedMin, 75);
    assert.equal(rec.control.perIssue, 200);
    assert.deepEqual(
      readdirSync(st).map((f) => [f, readFileSync(join(st, f), "utf8")]),
      before,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
