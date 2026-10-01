import assert from "node:assert/strict";
import { test } from "node:test";
import { FLEET_PLAN_DEFAULTS } from "./fleet-plan.ts";
import { FRESH_START_DIVIDER, type FreshStartFacts, freshStartPromptOf, freshStartSendOp, freshStartVerdictOf, launchWithFlightPromptOf, runFreshStart } from "./fresh-start.ts";
import { fold, type Op } from "./proposals.ts";

const ctx = (tokens: number | null, over: Partial<NonNullable<FreshStartFacts["context"]>> = {}) => ({ contextTokens: tokens, windowSource: "statusline" as const, pct: tokens === null ? null : tokens / 1_000_000, ...over });
const facts = (over: Partial<FreshStartFacts> = {}): FreshStartFacts => ({
  registration: "TEAM_F", origin: "background", retired: false, aog: false, status: "idle", flying: [], arrived: new Set(), context: ctx(794_000), ...over,
});
const cfg = FLEET_PLAN_DEFAULTS;

test("자격: 기준을 넘은 쉬는 백그라운드 세션이고 STAND가 없으면 된다", () => {
  assert.deepEqual(freshStartVerdictOf(facts(), cfg), { ok: true });
});

test("자격: 데스크톱·터미널 세션은 멈추지 않는다", () => {
  for (const origin of ["desktop", "terminal", "unknown"] as const) {
    const v = freshStartVerdictOf(facts({ origin }), cfg);
    assert.equal(v.ok, false);
    assert.match(!v.ok ? v.why : "", /백그라운드 세션이 아님/);
  }
});

test("자격: 세션이 없으면 LAUNCH on approve의 몫이다", () => {
  const v = freshStartVerdictOf(facts({ origin: null }), cfg);
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.why : "", /LAUNCH on approve/);
});

test("자격: 기준 아래이면 사유에 크기와 기준을 보인다", () => {
  const v = freshStartVerdictOf(facts({ context: ctx(120_000) }), cfg);
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.why : "", /기준/);
  // 창을 짐작만 했으면(default) 몫은 보지 않고 토큰만: 250k는 300k 아래
  assert.equal(freshStartVerdictOf(facts({ context: ctx(250_000, { windowSource: "default", pct: 0.9 }) }), cfg).ok, false);
  // 창을 아는 세션은 몫으로도: 250k/500k = 50% ≥ 40%
  assert.equal(freshStartVerdictOf(facts({ context: ctx(250_000, { pct: 0.5 }) }), cfg).ok, true);
});

test("자격: 크기를 모르면 하지 않는다", () => {
  assert.equal(freshStartVerdictOf(facts({ context: null }), cfg).ok, false);
  assert.equal(freshStartVerdictOf(facts({ context: ctx(null) }), cfg).ok, false);
});

test("자격: 끝나지 않은 FLIGHT의 STAND가 있으면 하지 않고, ARRIVED한 STAND는 괜찮다", () => {
  const open = freshStartVerdictOf(facts({ flying: ["ATC-311"] }), cfg);
  assert.equal(open.ok, false);
  assert.match(!open.ok ? open.why : "", /ATC-311/);
  assert.equal(freshStartVerdictOf(facts({ flying: ["ATC-311"], arrived: new Set(["ATC-311"]) }), cfg).ok, true);
});

test("자격: 턴 중이거나 RETIRED·AOG면 하지 않는다", () => {
  assert.equal(freshStartVerdictOf(facts({ status: "working" }), cfg).ok, false);
  assert.equal(freshStartVerdictOf(facts({ retired: true }), cfg).ok, false);
  assert.equal(freshStartVerdictOf(facts({ aog: true }), cfg).ok, false);
});

test("첫 프롬프트: CREW BRIEFING, 구분선, FLIGHT PLAN 순서", () => {
  const p = freshStartPromptOf("[ATC FLEET] CREW BRIEFING\n\nbody\n", "[DISPATCH D-0359] FLIGHT PLAN · JULIETT (TEAM_J)\n...");
  const [briefing, rest] = p.split(`\n\n${FRESH_START_DIVIDER}\n\n`);
  assert.equal(briefing, "[ATC FLEET] CREW BRIEFING\n\nbody");
  assert.match(rest!, /^\[DISPATCH D-0359\] FLIGHT PLAN/);
  assert.ok(p.indexOf("CREW BRIEFING") < p.indexOf("FLIGHT PLAN ·"));
});

test("첫 프롬프트: FLEET 카드의 LAUNCH with a FLIGHT는 CREW BRIEFING 뒤에 DIRECT 지시서", () => {
  const p = launchWithFlightPromptOf("[ATC FLEET] CREW BRIEFING\n", "BRIEF: DIRECT\nFLIGHT ATC-73\n");
  assert.match(p, /^\[ATC FLEET\] CREW BRIEFING\n\n— Assignment follows\.\n\nBRIEF: DIRECT\nFLIGHT ATC-73$/);
});

const create = (id: string): Op => ({ op: "create", id, at: "2026-10-01T09:00:00.000Z", kind: "ASSIGN", flight: "ATC-73", aircraft: "f", aircraftName: "TEAM_F", airport: "ATCC", score: 1, factors: [] });

test("타임라인: send에 via fresh-start가 붙고 sent가 되며 READBACK·DEPARTED는 같다", () => {
  const send = freshStartSendOp("D-0359", "2026-10-01T09:02:00.000Z", "FLIGHT PLAN text");
  assert.deepEqual(send, { op: "send", id: "D-0359", at: "2026-10-01T09:02:00.000Z", message: "FLIGHT PLAN text", via: "fresh-start" });
  const ps = fold([create("D-0359"), { op: "approve", id: "D-0359", at: "2026-10-01T09:01:00.000Z" }, send]);
  assert.equal(ps[0]!.status, "sent");
  assert.equal(ps[0]!.timeline.sent, "2026-10-01T09:02:00.000Z");
  assert.equal(ps[0]!.message, "FLIGHT PLAN text");
  assert.equal(ps[0]!.sentVia, "fresh-start");
  const after = fold([create("D-0359"), { op: "approve", id: "D-0359", at: "2026-10-01T09:01:00.000Z" }, send, { op: "accept", id: "D-0359", at: "2026-10-01T09:03:00.000Z" }, { op: "depart", id: "D-0359", at: "2026-10-01T09:05:00.000Z", stand: "/w/atc-73" }]);
  assert.equal(after[0]!.status, "departed");
  assert.equal(after[0]!.sentVia, "fresh-start");
});

test("타임라인: via 없는 옛 send는 sentVia가 없다(옛 기록을 그대로 읽는다)", () => {
  const ps = fold([create("D-0001"), { op: "approve", id: "D-0001", at: "2026-10-01T09:01:00.000Z" }, { op: "send", id: "D-0001", at: "2026-10-01T09:02:00.000Z", message: "m" }]);
  assert.equal(ps[0]!.status, "sent");
  assert.equal(ps[0]!.sentVia, undefined);
});

const deps = (log: string[], over: Partial<Parameters<typeof runFreshStart>[2]> = {}) => ({
  stop: async () => (log.push("stop"), { ok: true, jobId: "old1" }),
  gone: async () => void log.push("gone"),
  launch: async (promptOf: (b: string) => string) => (log.push(`launch:${promptOf("BRIEF").replace(/\n/g, "|")}`), { ok: true, jobId: "new1" }),
  append: (ops: Op[]) => void log.push(`append:${ops.map((o) => `${o.op}${"via" in o ? `/${o.via}` : ""}`).join(",")}`),
  note: (l: { stage: string; ok: boolean }) => void log.push(`note:${l.stage}:${l.ok}`),
  now: () => "2026-10-01T09:02:00.000Z",
  ...over,
});

test("실행: STOP → LAUNCH → send 기록, 줄마다 FLIGHT RECORDER 메모", async () => {
  const log: string[] = [];
  const r = await runFreshStart("D-1", "PLAN", deps(log));
  assert.deepEqual(r, { ok: true, status: 200, jobId: "new1" });
  assert.deepEqual(log.map((l) => l.split(":")[0]), ["stop", "note", "gone", "launch", "note", "append", "note"]);
  assert.ok(log.some((l) => l === "append:send/fresh-start"));
  assert.ok(log.find((l) => l.startsWith("launch:"))!.includes("PLAN"));
});

test("실행: STOP이 실패하면 LAUNCH도 send도 하지 않는다", async () => {
  const log: string[] = [];
  const r = await runFreshStart("D-1", "PLAN", deps(log, { stop: async () => ({ ok: false, error: "no" }) }));
  assert.equal(r.ok, false);
  assert.equal(r.stage, "stop");
  assert.ok(!log.some((l) => l.startsWith("launch") || l.startsWith("append")));
});

test("실행: LAUNCH가 거절·실패하면 send를 적지 않는다(제안은 approved 그대로)", async () => {
  for (const launch of [async () => ({ ok: false, error: "상한 6" }), async () => { throw new Error("boom"); }]) {
    const log: string[] = [];
    const r = await runFreshStart("D-1", "PLAN", deps(log, { launch }));
    assert.equal(r.ok, false);
    assert.equal(r.stage, "launch");
    assert.match(r.error!, /FLIGHT PLAN은 보내지 않았다/);
    assert.ok(!log.some((l) => l.startsWith("append")));
    assert.ok(log.includes("note:launch:false"));
  }
});
