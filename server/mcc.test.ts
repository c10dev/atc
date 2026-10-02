import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type GhPull, reviewBlocks } from "./landing.ts";
import {
  autoRtsInfoOf,
  autoRtsOf,
  escalationOf,
  type Inspection,
  inspectionComment,
  inspectionOf,
  type LandInput,
  type GateEntry,
  landBlocksOf,
  lastRtsFailureOf,
  loadMcc,
  mccDeploys,
  mccLands,
  MCC_GATE,
  mccGateLine,
  mccGateOf,
  MccError,
  mccModelOf,
  type MccRecord,
  parseInspect,
  parseMcc,
  reviewOfHead,
  type RtsRecord,
  rtsDueOf,
  spacingStartOf,
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
  bad({ model: "" }, /MCC 세션에서만/);
  bad({ model: "deepseek-v4.1-flash" }, /Claude 모델만/);
  bad({ model: "gpt-5.6-luna" }, /Claude/);
  const f = parseInspect({ head: HEAD, verdict: "findings", text: "P1 새 동작에 테스트 없음", model: "claude-fable-5-1" }, 106, HEAD, iso(0));
  assert.deepEqual([f.verdict, f.p1], ["findings", 1]);
  assert.match(inspectionComment(f), /MCC INSPECTION — findings.*aaaaaaa.*P1 1[\s\S]*새 동작에 테스트 없음/);
});

test("MCC 쓰기의 모델: guard가 붙인 Claude 모델만. 없으면(TOWER·OCC의 atcctl) 거절", () => {
  assert.equal(mccModelOf({ model: " claude-sonnet-5 " }), "claude-sonnet-5");
  assert.throws(() => mccModelOf({}), /MCC 세션에서만/);
  assert.throws(() => mccModelOf({ model: "muse-spark-1.3-contributor" }), /Claude 모델만/);
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
  assert.equal(rtsDueOf({ ...x, lastStartAt: iso(1) }, null, 0).due, true); // SUPERVISOR 클릭은 간격 없음
  assert.deepEqual(rtsDueOf(x, "ROLLBACK 뒤 멈춤"), { due: false, why: "ROLLBACK 뒤 멈춤" });
});

test("RTS 할 때(ATC-121): 마지막 착륙이 main CI를 읽은 때보다 늦으면 아직", () => {
  const x = { deployed: OLD, main: HEAD, mainCi: "ok" as const, last: null, lastStartAt: null, now: NOW, mainReadAt: iso(3), lastLandAt: iso(5) };
  assert.equal(rtsDueOf(x, null).due, true); // 착륙 뒤에 읽었다
  assert.match(rtsDueOf({ ...x, lastLandAt: iso(1) }, null).why, /착륙 뒤 main CI/); // 방금 착륙했는데 읽은 건 그 전
  assert.equal(rtsDueOf({ ...x, lastLandAt: null }, null).due, true);
  assert.equal(rtsDueOf({ ...x, mainReadAt: null, lastLandAt: iso(1) }, null).due, true); // 모르면 다른 조건대로(예전 그대로)
  assert.equal(rtsDueOf({ ...x, lastLandAt: iso(1) }, null, 0).due, false); // 간격 0이어도 이 순서 규칙은 같다
});

test("5분 간격(ATC-121): 거절된 시작은 세지 않는다", () => {
  const start = (min: number, to = HEAD): MccRecord => ({ op: "rts", at: iso(min), from: OLD, to, result: "started" });
  assert.equal(spacingStartOf([], []), null);
  assert.equal(spacingStartOf([start(3)], []), iso(3)); // 아직 결과가 없다
  assert.equal(spacingStartOf([start(3)], [rts({ at: iso(2.9), result: "running" })]), iso(3));
  assert.equal(spacingStartOf([start(3)], [rts({ at: iso(2.9), result: "running" }), rts({ at: iso(2), result: "ok" })]), iso(3));
  assert.equal(spacingStartOf([start(3)], [rts({ at: iso(2.9), result: "failed" })]), iso(3)); // 실패는 센다
  assert.equal(spacingStartOf([start(3)], [rts({ at: iso(2.9), result: "refused", detail: "커밋하지 않은 변경" })]), null);
  // 거절된 것은 건너뛰고 그 앞의 시작을 본다
  assert.equal(spacingStartOf([start(9), start(3)], [rts({ at: iso(2.9), result: "refused" })]), iso(9));
  // 다른 main을 향한 거절, 시작 이전 거절은 이 시작의 결과가 아니다
  assert.equal(spacingStartOf([start(3)], [rts({ at: iso(2.9), to: OLD, result: "refused" })]), iso(3));
  assert.equal(spacingStartOf([start(3)], [rts({ at: iso(20), result: "refused" })]), iso(3));
  // 거절된 시작이 다음 RTS를 막지 않는다
  const x = { deployed: OLD, main: HEAD, mainCi: "ok" as const, last: null, now: NOW };
  assert.equal(rtsDueOf({ ...x, lastStartAt: spacingStartOf([start(3)], [rts({ at: iso(2.9), result: "refused" })]) }, null).due, true);
  assert.equal(rtsDueOf({ ...x, lastStartAt: spacingStartOf([start(3)], []) }, null).due, false);
});

test("순서(ATC-121): 착륙·RTS·착륙을 5분마다 해도 적어도 두 tick에 한 번은 배포된다", () => {
  // 모델: tick마다 5분. 착륙하면 90초 뒤 다음 읽기에 main이 새 커밋이 되고, CI(check)는 3분이면 끝난다.
  // MCC는 rts.due를 먼저 보고(배포), 아니면 착륙한다(매뉴얼의 순서). 배포하면 서비스가 main에 닿는다
  const MIN = 60_000;
  let deployed = "d0";
  let main = "d0";
  let mainReadAt = 0;
  let mainCiOkAt = 0; // 이 시각부터 ok
  let lastLandAt: number | null = null;
  let lastStartAt: number | null = null;
  let lands = 0;
  let deploys = 0;
  let pendingLand = 0;
  const TICKS = 12;
  for (let k = 0; k < TICKS; k++) {
    const now = k * 5 * MIN;
    // atc의 읽기(90초 간격 근사): 착륙이 있었으면 main이 그 커밋이 되고 CI는 3분 뒤 통과
    if (pendingLand && now - pendingLand >= 90_000) {
      main = `d${lands}`;
      mainCiOkAt = pendingLand + 90_000 + 3 * MIN;
      pendingLand = 0;
    }
    mainReadAt = Math.max(mainReadAt, now - 30_000);
    const due = () =>
      rtsDueOf(
        { deployed, main, mainCi: now >= mainCiOkAt ? "ok" : "pending", last: null, lastStartAt: lastStartAt === null ? null : new Date(lastStartAt).toISOString(), mainReadAt: new Date(mainReadAt).toISOString(), lastLandAt: lastLandAt === null ? null : new Date(lastLandAt).toISOString(), now },
        null,
      ).due;
    if (due()) {
      deployed = main;
      lastStartAt = now;
      deploys++;
    }
    lands++; // 이 tick의 착륙(RTS 뒤, 매뉴얼의 순서)
    lastLandAt = now + 1000;
    pendingLand = now + 1000;
  }
  assert.ok(deploys >= TICKS / 2 - 1, `deploys ${deploys}`);
  // 착륙을 먼저 하고 같은 tick에 RTS를 치면 서버가 막는다(순서 규칙)
  const x = { deployed: "a", main: "b", mainCi: "ok" as const, last: null, lastStartAt: null, now: NOW, mainReadAt: iso(1), lastLandAt: iso(0.5) };
  assert.equal(rtsDueOf(x, null).due, false);
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

// ── SHADOW GATE ──
const H = (c: string) => c.repeat(40);
const at = (day: number, h = 0) => new Date(Date.parse("2026-09-20T00:00:00Z") + day * 86_400_000 + h * 3_600_000).toISOString();
const entry = (n: number, arrived: string, extra: Partial<GateEntry> = {}): GateEntry => ({
  airport: "ATCC",
  pr: { number: n, url: `https://github.com/o/atc/pull/${n}`, title: `PR ${n}` },
  arrivedAt: arrived,
  reverted: false,
  ...extra,
});
const insp = (pr: number, head: string, verdict: "pass" | "findings", when: string): MccRecord => ({ op: "inspect", at: when, pr, head, verdict, text: "x", model: "claude-opus-5-5", p0: 0, p1: verdict === "findings" ? 1 : 0, p2: 0 });
const would = (pr: number, head: string, when: string): MccRecord => ({ op: "would-land", at: when, pr, head, tier: "auto", result: "ok", detail: "shadow" });

test("SHADOW GATE: 머지된 head의 INSPECTION·would-land·ESCALATE·되돌림을 맞추고, 불일치를 모은다", () => {
  const records: MccRecord[] = [
    { op: "mode", at: at(0), mode: "shadow", detail: "x" }, // 모드 기록은 시작점이 아니다
    insp(1, H("1"), "pass", at(1)),
    would(1, H("1"), at(1, 1)),
    insp(2, H("2"), "findings", at(1, 2)),
    insp(3, H("a"), "pass", at(1, 3)), // 옛 head만
    { op: "escalate", at: at(1, 4), pr: 4, head: H("4"), reason: "운영 상태 형식", model: "claude-opus-5-5" },
    insp(6, H("6"), "pass", at(1, 5)),
    { op: "land", at: at(1, 6), pr: 6, head: H("6"), tier: "auto", result: "ok", model: "claude-opus-5-5" },
    insp(7, H("7"), "pass", at(9)), // 머지 뒤 기록은 보지 않는다(다시 연 PR 등)
  ];
  const entries = [
    entry(1, at(2), { reverted: true, revertedBy: { number: 9, url: "u", at: at(3) } }),
    entry(2, at(2, 1)),
    entry(3, at(2, 2)),
    entry(4, at(2, 3)),
    entry(5, at(2, 4)),
    entry(6, at(2, 5)),
    entry(7, at(2, 6)),
    entry(8, at(0, 12), { airport: "VCDO" }), // 다른 AIRPORT
    entry(10, at(0, 12)), // 첫 MCC 기록 전
  ];
  const heads = new Map([[1, H("1")], [2, H("2")], [3, H("3")], [4, H("4")], [5, H("5")], [6, H("6")], [7, H("7")]]);
  const g = mccGateOf({ records, entries, airport: "ATCC", heads, now: Date.parse(at(4, 12)) });
  assert.equal(g.since, at(1));
  assert.equal(g.days, 3.5);
  assert.equal(g.merged, 7);
  assert.deepEqual(g.rows.map((r) => r.pr), [7, 6, 5, 4, 3, 2, 1]); // 도착 최신순
  const row = (n: number) => g.rows.find((r) => r.pr === n)!;
  assert.deepEqual({ ...row(1), revertedBy: null }, { pr: 1, title: "PR 1", url: "https://github.com/o/atc/pull/1", arrivedAt: at(2), head: H("1"), inspection: "pass", staleInspection: false, wouldLand: true, escalated: false, landedBy: "other", reverted: true, revertedBy: null });
  assert.equal(row(3).inspection, null);
  assert.equal(row(3).staleInspection, true);
  assert.equal(row(6).landedBy, "mcc");
  assert.equal(row(6).wouldLand, true);
  assert.equal(row(7).inspection, null);
  assert.equal(g.prs, 4); // 1, 2(findings도 판단), 4(ESCALATE), 6
  assert.equal(g.wouldLand, 2);
  assert.equal(g.reverted, 1);
  assert.equal(g.ready, false);
  assert.deepEqual(
    g.misses.map((m) => [m.pr, m.kind]),
    [[7, "no-inspection"], [5, "no-inspection"], [3, "no-inspection"], [2, "findings"], [1, "reverted-would-land"]],
  );
  assert.match(g.misses.find((m) => m.pr === 3)!.text, /옛 head/);
  assert.match(g.misses.find((m) => m.pr === 1)!.text, /#9/);
});

test("SHADOW GATE: head를 모르면 머지 전 마지막 INSPECTION으로 맞추고, 기록이 없으면 시작 전", () => {
  const g = mccGateOf({ records: [insp(1, H("a"), "findings", at(0)), insp(1, H("b"), "pass", at(0, 1)), would(1, H("b"), at(0, 2))], entries: [entry(1, at(0, 3))], airport: "ATCC", heads: new Map(), now: Date.parse(at(1)) });
  assert.deepEqual([g.rows[0].head, g.rows[0].inspection, g.rows[0].wouldLand, g.misses.length], [null, "pass", true, 0]);
  const empty = mccGateOf({ records: [], entries: [entry(1, at(0))], airport: "ATCC", heads: new Map(), now: Date.parse(at(1)) });
  assert.deepEqual([empty.since, empty.days, empty.merged, empty.ready], [null, 0, 0, false]);
  assert.match(mccGateLine(empty), /^SHADOW GATE 아직 · 판단한 PR 0\/20건 · 0\/5일 · would-land 되돌림 0건 · 불일치 0건$/);
});

test("SHADOW GATE: 20건·5일·되돌림 0이면 ready — 하나라도 모자라면 아니다", () => {
  const records = Array.from({ length: MCC_GATE.prs }, (_, i) => insp(i + 1, H("c"), "pass", at(0, i)));
  const entries = records.map((r, i) => entry((r as { pr: number }).pr, at(0, i + 1)));
  const heads = new Map(entries.map((e) => [e.pr.number, H("c")]));
  const g = mccGateOf({ records, entries, airport: "ATCC", heads, now: Date.parse(at(5)) });
  assert.deepEqual([g.prs, g.days, g.ready], [20, 5, true]);
  assert.match(mccGateLine(g), /^SHADOW GATE 충족/);
  assert.equal(mccGateOf({ records, entries, airport: "ATCC", heads, now: Date.parse(at(4, 23)) }).ready, false);
  assert.equal(mccGateOf({ records, entries: entries.slice(1), airport: "ATCC", heads, now: Date.parse(at(5)) }).ready, false);
  const back = [...records, would(1, H("c"), at(0, 0.5))];
  assert.equal(mccGateOf({ records: back, entries: [{ ...entries[0], reverted: true }, ...entries.slice(1)], airport: "ATCC", heads, now: Date.parse(at(5)) }).ready, false);
});

// ── 자동 RTS(ATC-84) ──
const AUTO = { mode: "rts", due: { due: true, why: "aaaaaaa → bbbbbbb" }, main: OLD, rangeRefusal: null, guard: null, last: null, lastFailedAt: null, now: NOW } as const;

test("모드 rts: 설정에서 읽히고, MCC는 착륙하지 않고 서버는 배포한다", () => {
  assert.equal(parseMcc({ mode: "rts" }).mode, "rts");
  assert.deepEqual(["shadow", "land", "land+rts", "rts"].map((m) => mccLands(m as never)), [false, true, true, false]);
  assert.deepEqual(["shadow", "land", "land+rts", "rts"].map((m) => mccDeploys(m as never)), [false, false, true, true]);
});

test("autoRtsOf: rts·land+rts에서 할 때면 시작하고, 그 밖의 모드는 시작하지 않는다", () => {
  assert.deepEqual(autoRtsOf(AUTO), { start: true, why: "aaaaaaa → bbbbbbb" });
  assert.equal(autoRtsOf({ ...AUTO, mode: "land+rts" }).start, true);
  for (const mode of ["shadow", "land"] as const) assert.equal(autoRtsOf({ ...AUTO, mode }).start, false);
});

test("autoRtsOf: 할 때가 아니거나 시험 서버거나 범위가 사람 몫이면 시작하지 않는다", () => {
  assert.deepEqual(autoRtsOf({ ...AUTO, due: { due: false, why: "지난 RTS에서 5분이 안 지남" } }), { start: false, why: "지난 RTS에서 5분이 안 지남" });
  assert.match(autoRtsOf({ ...AUTO, guard: "시험 서버(포트 7702)는 …" }).why, /시험 서버/);
  const r = autoRtsOf({ ...AUTO, rangeRefusal: "package.json 변경" });
  assert.equal(r.start, false);
  assert.match(r.why, /사람이 배포: package\.json/);
});

test("autoRtsOf: 같은 main에 RTS가 거절·실패했으면 멈추고, 새 main이면 다시 한다", () => {
  const refused: RtsRecord = { at: iso(3), from: OLD, to: OLD, result: "refused", detail: "세션 점검" };
  const r = autoRtsOf({ ...AUTO, last: refused });
  assert.equal(r.start, false);
  assert.match(r.why, /자동 배포 멈춤.*거절/);
  assert.equal(autoRtsOf({ ...AUTO, last: { ...refused, result: "failed" } }).start, false);
  assert.equal(autoRtsOf({ ...AUTO, last: { ...refused, to: HEAD } }).start, true);
  assert.equal(autoRtsOf({ ...AUTO, last: { ...refused, result: "ok" } }).start, true);
});

test("autoRtsOf: 유닛 시작이 방금 실패했으면 5분 뒤에 다시 한다", () => {
  assert.equal(autoRtsOf({ ...AUTO, lastFailedAt: iso(2) }).start, false);
  assert.equal(autoRtsOf({ ...AUTO, lastFailedAt: iso(6) }).start, true);
  const recs: MccRecord[] = [
    { op: "rts", at: iso(9), from: null, to: HEAD, result: "failed" },
    { op: "rts", at: iso(8), from: null, to: OLD, result: "started", by: "server" },
    { op: "rts", at: iso(2), from: null, to: OLD, result: "failed" },
  ];
  assert.equal(lastRtsFailureOf(recs, OLD.slice(0, 7)), iso(2));
  assert.equal(lastRtsFailureOf(recs, HEAD), iso(9));
  assert.equal(lastRtsFailureOf(recs, null), null);
});

test("autoRtsInfoOf: 켜짐 표시와 다음 시각(5분 간격 대기 중일 때만)", () => {
  assert.deepEqual(autoRtsInfoOf("land", iso(1), true, NOW), { on: false, nextAt: null });
  assert.deepEqual(autoRtsInfoOf("rts", iso(2), true, NOW), { on: true, nextAt: new Date(NOW + 3 * 60_000).toISOString() });
  assert.deepEqual(autoRtsInfoOf("land+rts", iso(6), true, NOW), { on: true, nextAt: null });
  assert.deepEqual(autoRtsInfoOf("rts", null, true, NOW), { on: true, nextAt: null });
  assert.deepEqual(autoRtsInfoOf("rts", iso(2), false, NOW), { on: true, nextAt: null });
});

test("reviewOfHead(ATC-390): ESCALATE한 head는 P0·P1 없는 pass, INSPECTION 기록이 있으면 그것이 먼저, 다른 head는 아직 본 적 없음", () => {
  const insp = (pr: number, head: string, verdict: Inspection["verdict"], at: string): MccRecord => ({ op: "inspect", at, pr, head, verdict, text: "P1 x.ts:1 — 문제", model: "claude-opus-5-5", p0: 0, p1: verdict === "findings" ? 1 : 0, p2: 0 });
  const records: MccRecord[] = [
    { op: "escalate", at: iso(30), pr: 110, head: OLD, reason: "상태 형식 바뀜" },
    { op: "escalate", at: iso(20), pr: 111, head: HEAD, reason: "의심이 남음" },
    insp(111, HEAD, "findings", iso(19)), // 같은 head의 findings가 ESCALATE보다 먼저다
    { op: "escalate", at: iso(10), pr: 112, head: HEAD, reason: "되돌리기 어려움" },
    insp(112, HEAD, "pass", iso(9)),
  ];
  // 지금 head(HEAD)는 아직 INSPECTION도 ESCALATE도 없다: 새 head는 새 INSPECTION이 필요하고, ESCALATE는 PR에 남는다
  assert.equal(reviewOfHead(records, 110, HEAD), null);
  assert.equal(escalationOf(records, 110)?.reason, "상태 형식 바뀜");
  // ESCALATE한 그 head는 본 것이다
  const seen = reviewOfHead(records, 110, OLD);
  assert.deepEqual([seen?.verdict, seen?.p0, seen?.p1, seen?.at], ["pass", 0, 0, iso(30)]);
  assert.match(seen!.text, /상태 형식 바뀜/);
  // findings 기록이 있으면 ESCALATE가 가리지 않는다
  assert.equal(reviewOfHead(records, 111, HEAD)?.verdict, "findings");
  assert.equal(reviewOfHead(records, 112, HEAD)?.verdict, "pass");
  assert.equal(reviewOfHead(records, 999, HEAD), null);
});

test("ESCALATE한 PR의 착륙 리뷰(ATC-390): 같은 head는 막힘 없음(CLEARED 쪽), findings는 지적, 새 head는 INSPECTION 대기", () => {
  const records: MccRecord[] = [{ op: "escalate", at: iso(5), pr: 110, head: OLD, reason: "상태 형식 바뀜" }];
  const at = (head: string) => reviewBlocks(gh({ headRefOid: head, reviews: [] }), undefined, undefined, undefined, { review: reviewOfHead(records, 110, head) }).map((b) => b.code);
  assert.deepEqual(at(OLD), []);
  assert.deepEqual(at(HEAD), ["no-review"]);
  const withFindings: MccRecord[] = [...records, { op: "inspect", at: iso(4), pr: 110, head: OLD, verdict: "findings", text: "P1 a.ts:1 — x", model: "claude-opus-5-5", p0: 0, p1: 1, p2: 0 }];
  const f = reviewBlocks(gh({ headRefOid: OLD, reviews: [] }), undefined, undefined, undefined, { review: reviewOfHead(withFindings, 110, OLD) });
  assert.deepEqual(f.map((b) => b.code), ["review-findings"]);
});
