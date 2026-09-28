import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type GhPull, reviewBlocks } from "./landing.ts";
import {
  escalationOf,
  type Inspection,
  inspectionComment,
  inspectionOf,
  type LandInput,
  landBlocksOf,
  loadMcc,
  MccError,
  type MccRecord,
  parseInspect,
  parseMcc,
  type RtsRecord,
  rtsDueOf,
  rtsStopOf,
  saveMcc,
  tierOfFiles,
} from "./mcc.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = Date.parse("2026-09-28T09:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

test("설정: 모르는 값은 기본값(shadow, ATCC, check), 사용자가 적은 다른 키는 저장해도 남는다", () => {
  assert.deepEqual(parseMcc(null), { mode: "shadow", airport: "ATCC", ciCheck: "check", holds: [] });
  assert.deepEqual(parseMcc({ mode: "merge", airport: "atcc", holds: [106, 106, -1, "x", 1.5] }), { mode: "shadow", airport: "ATCC", ciCheck: "check", holds: [106] });
  assert.equal(parseMcc({ mode: "land+rts" }).mode, "land+rts");
  const file = join(mkdtempSync(join(tmpdir(), "mcc-")), "mcc.json");
  writeFileSync(file, JSON.stringify({ note: "keep" }));
  saveMcc({ ...loadMcc(file), mode: "land" }, file);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { note: "keep", mode: "land", airport: "ATCC", ciCheck: "check", holds: [] });
});

test("INSPECTION 입력: 지금 head만(짧은 SHA 가능), pass에 P0·P1 없음, findings에 등급, 모델은 Claude만", () => {
  const ok = parseInspect({ head: HEAD.slice(0, 7), verdict: "pass", text: "테스트·문서 짝 확인. P2 주석 하나", model: "claude-opus-5-5" }, 106, HEAD, iso(0));
  assert.deepEqual({ ...ok, text: undefined }, { op: "inspect", at: iso(0), pr: 106, head: HEAD, verdict: "pass", text: undefined, model: "claude-opus-5-5", p0: 0, p1: 0, p2: 1 });
  const bad = (body: Record<string, unknown>, re: RegExp) => assert.throws(() => parseInspect({ head: HEAD, verdict: "pass", text: "ok", model: "claude-sonnet-5", ...body }, 106, HEAD, iso(0)), (e: unknown) => e instanceof MccError && re.test(e.message));
  bad({ head: OLD }, /새 head/);
  bad({ head: "aaa" }, /새 head/);
  bad({ verdict: "maybe" }, /pass\|findings/);
  bad({ text: " " }, /text/);
  bad({ text: "P1 테스트 없음" }, /findings/);
  bad({ verdict: "findings", text: "고칠 것 있음" }, /등급/);
  bad({ model: "" }, /model/);
  bad({ model: "deepseek-v4.1-flash" }, /Claude/);
  bad({ model: "gpt-5.6-luna" }, /Claude/);
  const f = parseInspect({ head: HEAD, verdict: "findings", text: "P1 새 동작에 테스트 없음", model: "claude-fable-5-1" }, 106, HEAD, iso(0));
  assert.deepEqual([f.verdict, f.p1], ["findings", 1]);
  assert.match(inspectionComment(f), /MCC INSPECTION — findings.*aaaaaaa.*P1 1[\s\S]*새 동작에 테스트 없음/);
});

test("기록: INSPECTION은 그 head의 마지막 것, ESCALATE는 PR에 붙어 head가 바뀌어도 남는다", () => {
  const insp = (pr: number, head: string, verdict: Inspection["verdict"], at: string): MccRecord => ({ op: "inspect", at, pr, head, verdict, text: "t", model: "claude-opus-5-5", p0: 0, p1: verdict === "findings" ? 1 : 0, p2: 0 });
  const records: MccRecord[] = [
    insp(106, HEAD, "findings", iso(30)),
    insp(106, HEAD, "pass", iso(20)),
    insp(106, OLD, "pass", iso(10)),
    insp(107, HEAD, "findings", iso(5)),
    { op: "escalate", at: iso(4), pr: 107, head: OLD, reason: "상태 형식 바뀜" },
  ];
  assert.equal(inspectionOf(records, 106, HEAD)?.verdict, "pass");
  assert.equal(inspectionOf(records, 106, "c".repeat(40)), null);
  assert.equal(escalationOf(records, 107)?.reason, "상태 형식 바뀜");
  assert.equal(escalationOf(records, 106), null);
});

const land = (over: Partial<LandInput> = {}): LandInput => ({
  pr: { state: "open", draft: false, base: "main", head: HEAD, mergeableState: "clean", fork: false },
  defaultBranch: "main",
  head: HEAD.slice(0, 7),
  tier: "auto",
  tierReasons: [],
  escalated: null,
  ci: "ok",
  ciCheck: "check",
  inspection: { verdict: "pass" },
  held: false,
  groundStop: null,
  rtsBlocked: null,
  ...over,
});
const codes = (x: LandInput) => landBlocksOf(x).map((b) => b.code);

test("착륙 조건 L2–L8: 모두 맞으면 비고, 하나씩 막는다. flagged는 착륙, user와 ESCALATE는 사용자", () => {
  assert.deepEqual(codes(land()), []);
  assert.deepEqual(codes(land({ tier: "flagged" })), []);
  assert.deepEqual(codes(land({ pr: { ...land().pr, draft: true } })), ["L2"]);
  assert.deepEqual(codes(land({ pr: { ...land().pr, base: "claude/x" } })), ["L2"]);
  assert.deepEqual(codes(land({ head: OLD })), ["L2"]);
  assert.deepEqual(codes(land({ pr: { ...land().pr, state: "closed" } })), ["L2"]);
  assert.match(landBlocksOf(land({ pr: { ...land().pr, fork: true } }))[0].text, /fork/);
  assert.match(landBlocksOf(land({ tier: "user", tierReasons: ["guard"] }))[0].text, /user 등급.*guard/);
  assert.match(landBlocksOf(land({ tier: "auto", escalated: { reason: "되돌리기 어려움" } }))[0].text, /ESCALATE.*되돌리기 어려움/);
  for (const ci of ["none", "pending", "failed"] as const) assert.deepEqual(codes(land({ ci })), ["L4"], ci);
  for (const m of ["dirty", "behind", "blocked", "unknown", "draft"]) assert.deepEqual(codes(land({ pr: { ...land().pr, mergeableState: m } })), ["L5"], m);
  assert.deepEqual(codes(land({ pr: { ...land().pr, mergeableState: "unstable" } })), []);
  assert.deepEqual(codes(land({ inspection: null })), ["L6"]);
  assert.deepEqual(codes(land({ inspection: { verdict: "findings" } })), ["L6"]);
  assert.deepEqual(codes(land({ held: true, groundStop: "main CI 실패" })), ["L7", "L7"]);
  assert.deepEqual(codes(land({ rtsBlocked: "RTS 진행 중" })), ["L8"]);
});

const rts = (over: Partial<RtsRecord> = {}): RtsRecord => ({ at: iso(30), from: OLD, to: HEAD, result: "ok", ...over });

test("RTS 멈춤: 진행 중이면 멈춤, ROLLBACK 뒤에는 SUPERVISOR가 모드를 다시 고를 때까지", () => {
  assert.equal(rtsStopOf(null, null), null);
  assert.equal(rtsStopOf(rts(), null), null);
  assert.match(rtsStopOf(rts({ result: "running" }), null) ?? "", /진행 중/);
  assert.match(rtsStopOf(rts({ result: "rollback" }), null) ?? "", /ROLLBACK/);
  assert.match(rtsStopOf(rts({ result: "rollback" }), iso(40)) ?? "", /ROLLBACK/); // 모드를 고른 게 ROLLBACK보다 먼저
  assert.equal(rtsStopOf(rts({ result: "rollback" }), iso(10)), null);
});

test("RTS 할 때: 서비스가 main보다 뒤이고 main CI가 통과했고 지난 RTS에서 5분이 지남", () => {
  const x = { deployed: OLD, main: HEAD, mainCi: "ok" as const, last: null, lastStartAt: null, now: NOW };
  assert.deepEqual(rtsDueOf(x, null), { due: true, why: "bbbbbbb → aaaaaaa" });
  assert.match(rtsDueOf({ ...x, deployed: HEAD }, null).why, /최신/);
  assert.match(rtsDueOf({ ...x, deployed: null }, null).why, /서비스의 커밋/);
  assert.match(rtsDueOf({ ...x, mainCi: "pending" }, null).why, /진행 중/);
  assert.match(rtsDueOf({ ...x, mainCi: "failed" }, null).why, /실패/);
  assert.match(rtsDueOf({ ...x, lastStartAt: iso(3) }, null).why, /5분/);
  assert.equal(rtsDueOf({ ...x, lastStartAt: iso(6) }, null).due, true);
  assert.deepEqual(rtsDueOf(x, "ROLLBACK 뒤 멈춤"), { due: false, why: "ROLLBACK 뒤 멈춤" });
});

test("등급: deploy/landing-tier.mjs와 같은 규칙(서버·문서 auto, 관제 매뉴얼 flagged, guard·deploy user)", async () => {
  assert.equal((await tierOfFiles(["server/mcc.ts", "docs/mcc.md"])).tier, "auto");
  assert.equal((await tierOfFiles(["server/mcc.ts", "controller/CLAUDE.md"])).tier, "flagged");
  assert.equal((await tierOfFiles(["controller/guard.mjs"])).tier, "user");
  assert.equal((await tierOfFiles(["deploy/rts.mjs"])).tier, "user");
});

const gh = (over: Partial<GhPull> = {}): GhPull => ({
  number: 106, title: "x", url: "https://github.com/o/atc/pull/106", headRefName: "claude/x",
  headRefOid: HEAD, baseRefName: "main", isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: "",
  createdAt: "2026-09-28T08:00:00Z", author: { login: "me" }, statusCheckRollup: [], reviews: [], reactionGroups: [],
  ...over,
});

test("CLEARED TO LAND: MCC가 맡은 저장소는 이 head의 INSPECTION pass가 리뷰를 대신하고, findings는 review-findings", () => {
  const codesOf = (mcc?: Parameters<typeof reviewBlocks>[4]) => reviewBlocks(gh(), undefined, undefined, undefined, mcc).map((b) => b.code);
  assert.deepEqual(codesOf(undefined), ["no-review"]);
  assert.match(reviewBlocks(gh(), undefined, undefined, undefined, { review: null })[0].text, /MCC INSPECTION 대기/);
  assert.deepEqual(codesOf({ review: { verdict: "pass", text: "ok", p0: 0, p1: 0, p2: 0 } }), []);
  const f = reviewBlocks(gh(), undefined, undefined, undefined, { review: { verdict: "findings", text: "P1 테스트 없음", p0: 0, p1: 1, p2: 0 } });
  assert.deepEqual(f.map((b) => b.code), ["review-findings"]);
  assert.match(f[0].text, /MCC INSPECTION 지적.*P1 1.*테스트 없음/);
  // 사람의 head 리뷰는 그대로 센다
  const approved = gh({ reviews: [{ author: { login: "boss" }, state: "APPROVED", submittedAt: "2026-09-28T08:10:00Z", commit: { oid: HEAD } }] });
  assert.deepEqual(reviewBlocks(approved, undefined, undefined, undefined, { review: null }), []);
});
