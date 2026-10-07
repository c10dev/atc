import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type DutyConfig, parseDutyConfig } from "./duty-config.ts";
import type { ReviewLine } from "./duty-review.ts";
import { fuelHoldOf, landingLinesOf, type ReviewDeps, reviewTick, reviewTurnActive, watchEmptyTurn } from "./duty-review-run.ts";
import type { DutyRuntime } from "./duty-run.ts";
import type { Snapshot } from "./model.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendReviewLine, readReviewLines } from "./duty-review-store.ts";

const T0 = Date.parse("2026-10-02T12:00:00Z");
const MIN = 60_000;

const DISPATCH = (idle: boolean) => ({ plan: { aircraft: [{ registration: "TEAM_A", available: idle }], assign: idle ? [{ flight: "ATC-1" }] : [], unserved: [], excluded: [] } });

function harness(over: { cfg?: Partial<DutyConfig>; now?: number; idle?: boolean; busy?: boolean; refuse?: boolean; lines?: ReviewLine[]; leak?: number | null } = {}) {
  const appended: ReviewLine[] = [];
  const sent: { text: string; line: string }[] = [];
  const rt = {
    status: () => ({ state: over.busy ? "thinking" : "idle", queued: 0 }),
    reviewTurn: () => false,
    sendReview: async (text: string, line: string) => {
      if (over.refuse) return { verdict: "refused" as const, reason: "busy" };
      sent.push({ text, line });
      return { verdict: "sent" as const };
    },
  } as unknown as DutyRuntime;
  const d: ReviewDeps = {
    snapshot: async () => ({ tickets: [{ key: "ATC-5", title: "Open thing", stateType: "unstarted" }] }) as unknown as Snapshot,
    get: async (path) => (path === "/api/dispatch/brief" ? DISPATCH(over.idle ?? false) : { landingQueue: [{ landing: "CLEARED", key: "ATC-9", pr: { number: 9 }, landBy: "supervisor", landWhy: "escalate", holders: [], blocks: [] }] }),
    rt: () => rt,
    lines: () => [...(over.lines ?? []), ...appended],
    append: (l) => void appended.push(l),
    releases: () => [],
    openLeaks: () => (over.leak == null ? [] : [{ title: "LANDING #9", sinceMs: (over.now ?? T0) - over.leak * MIN }]),
    alerts: () => [{ level: "warning", text: "something is stuck" }, { level: "advisory", text: "ignored" }],
    cfg: () => ({ ...parseDutyConfig({ enabled: true, l1: true }), ...over.cfg }),
    now: () => over.now ?? T0,
    startedAt: T0 - 600 * MIN,
  };
  return { d, appended, sent };
}

test("점검 한 주기: 정기 간격이 지나면 DUTY 턴을 시작하고 점검 한 줄을 남긴다", async () => {
  const h = harness();
  const id = await reviewTick(h.d, { idleSince: null });
  assert.equal(id, "R-0001");
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0]!.text, /^\[ATC DUTY REVIEW R-0001\] trigger: schedule/);
  assert.match(h.sent[0]!.text, /PR #9 \(ATC-9\) CLEARED · landBy supervisor\/escalate/);
  assert.match(h.sent[0]!.text, /warning: something is stuck/);
  assert.doesNotMatch(h.sent[0]!.text, /ignored/);
  assert.match(h.sent[0]!.text, /ATC-5 Open thing/);
  assert.match(h.sent[0]!.line, /^DUTY REVIEW R-0001 · schedule/);
  assert.deepEqual(h.appended.map((l) => [l.ev, l.ev === "review" ? l.trigger : ""]), [["review", "schedule"]]);
});

test("점검 한 주기: 스위치가 꺼졌거나 DUTY가 꺼졌거나 돌고 있으면, 서버가 뜬 직후면 시작하지 않는다", async () => {
  for (const o of [{ cfg: { review: false } }, { cfg: { enabled: false } }, { busy: true }, { now: T0 - 598 * MIN }]) {
    const h = harness(o);
    assert.equal(await reviewTick(h.d, { idleSince: null }), null, JSON.stringify(o));
    assert.equal(h.sent.length, 0);
  }
});

test("점검 한 주기: 간격 안이면 시작하지 않고, DUTY가 거절하면(바쁨) 점검으로 세지 않는다", async () => {
  const recent: ReviewLine = { v: 1, ev: "review", id: "R-0001", at: new Date(T0 - 20 * MIN).toISOString(), trigger: "schedule", detail: "" };
  const h = harness({ lines: [recent], leak: 500 });
  assert.equal(await reviewTick(h.d, { idleSince: null }), null);
  const r = harness({ refuse: true });
  assert.equal(await reviewTick(r.d, { idleSince: null }), null);
  assert.equal(r.appended.length, 0);
});

test("점검 한 주기: 놀고 있는 AIRCRAFT가 일감을 두고 이어지면 idle 트리거, 오래 열린 leak이면 leak 트리거", async () => {
  const recent: ReviewLine = { v: 1, ev: "review", id: "R-0001", at: new Date(T0 - 60 * MIN).toISOString(), trigger: "schedule", detail: "" };
  const h = harness({ idle: true, lines: [recent] });
  const state = { idleSince: T0 - 25 * MIN as number | null };
  assert.equal(await reviewTick(h.d, state), "R-0002");
  assert.match(h.sent[0]!.line, /· idle · TEAM_A idle for 25 min while ATC-1 wait/);
  const l = harness({ lines: [recent], leak: 75 });
  assert.equal(await reviewTick(l.d, { idleSince: null }), "R-0002");
  assert.match(l.sent[0]!.line, /· leak · LANDING #9 held 75 min/);
});

test("landingLinesOf: PR마다 한 줄(착륙시키는 쪽·이유·holder 수·막힘)", () => {
  const lines = landingLinesOf({ landingQueue: [{ landing: "APPROACH", key: null, pr: { number: 4 }, landBy: "holder", holders: ["a", "b"], blocks: [{ code: "no-review" }, { code: "behind" }] }] });
  assert.deepEqual(lines, ["PR #4 APPROACH · landBy holder · holders 2 · blocks no-review+behind"]);
  assert.deepEqual(landingLinesOf(null), []);
});

test("점검 한 주기(MCC P2): 서버를 다시 띄워도 정기 점검이 밀리지 않는다 — 마지막 점검 기록만 본다", async () => {
  const old: ReviewLine = { v: 1, ev: "review", id: "R-0001", at: new Date(T0 - 250 * MIN).toISOString(), trigger: "schedule", detail: "" };
  const h = harness({ lines: [old] });
  h.d.startedAt = T0 - 5 * MIN; // 방금 다시 떴지만 준비 시간(3분)은 지났다
  assert.equal(await reviewTick(h.d, { idleSince: null }), "R-0002");
  assert.match(h.sent[0]!.line, /· schedule ·/);
});

test("점검 한 주기(MCC P1): 열려 있는 같은 leak은 간격마다 되풀이되지 않고, 점검 줄에 서명이 남는다", async () => {
  const h = harness({ leak: 200 });
  const state = { idleSince: null as number | null };
  assert.equal(await reviewTick(h.d, state), "R-0001");
  assert.deepEqual(h.appended.map((l) => l.ev === "review" && [l.trigger, l.key]), [["leak", "LANDING #9"]]);
  // 40분 뒤(간격 30분은 지났다) 같은 leak이 그대로 열려 있다
  h.d.now = () => T0 + 40 * MIN;
  assert.equal(await reviewTick(h.d, state), null);
  assert.equal(h.sent.length, 1);
});

test("점검 한 주기: DUTY ACCOUNT의 FUEL이 HOLD면 시작하지 않는다", async () => {
  const h = harness();
  h.d.snapshot = async () => ({ tickets: [], fuelAccounts: [{ account: "acct-2", group: "acct-2", level: "hold" }] }) as unknown as Snapshot;
  assert.equal(await reviewTick(h.d, { idleSince: null }), null);
  const ok = harness();
  ok.d.snapshot = async () => ({ tickets: [], fuelAccounts: [{ account: "acct-9", group: "acct-9", level: "hold" }] }) as unknown as Snapshot;
  assert.equal(await reviewTick(ok.d, { idleSince: null }), "R-0001");
});

test("fuelHoldOf·reviewTurnActive: ACCOUNT를 못 찾으면 false, 턴이 끝나면 점검 id도 풀린다", async () => {
  assert.equal(fuelHoldOf({ fuelAccounts: undefined }, "acct-2"), false);
  assert.equal(fuelHoldOf({ fuelAccounts: [{ account: null, group: "acct-2", level: "hold" }] as never }, "acct-2"), true);
  // 점검을 시작하면 도는 동안 참이고, 턴이 끝나면(rt.reviewTurn()이 거짓) 다시 호출할 때 풀린다
  let turn = true;
  const rt = { reviewTurn: () => turn, status: () => ({ state: "idle", queued: 0 }), sendReview: async () => ({ verdict: "sent" as const }) } as unknown as DutyRuntime;
  const h = harness();
  h.d.rt = () => rt;
  assert.equal(await reviewTick(h.d, { idleSince: null }), "R-0001");
  assert.equal(reviewTurnActive(() => rt), true);
  turn = false;
  assert.equal(reviewTurnActive(() => rt), false);
  turn = true;
  assert.equal(reviewTurnActive(() => rt), false, "한 번 풀린 id는 다음 턴이 되살리지 않는다");
});

test("점검 한 주기(ATC-470): 놀고 있는 AIRCRAFT가 있고 기다리는 FLIGHT가 없는 채 20분이면 empty 점검, READY·idea 목록이 지시문에 실리고, 턴이 끝나면 outcome 한 줄", async () => {
  const recent: ReviewLine = { v: 1, ev: "review", id: "R-0001", at: new Date(T0 - 60 * MIN).toISOString(), trigger: "schedule", detail: "" };
  const h = harness({ lines: [recent] });
  const feeds: ((e: unknown) => void)[] = [];
  (h.d.rt() as unknown as { subscribe: (f: (e: unknown) => void) => () => void }).subscribe = (f) => (feeds.push(f), () => {});
  h.d.get = async (path) => (path === "/api/dispatch/brief" ? { plan: { aircraft: [{ registration: "TEAM_A", available: true }], assign: [], unserved: [], excluded: [] } } : { landingQueue: [] });
  h.d.ready = () => [{ key: "ATC-7", title: "Fire me", priority: 2 }];
  h.d.ideas = async () => [{ number: 41, title: "Tiny idea" }];
  watchEmptyTurn(h.d.rt(), h.d.append, h.d.now);
  const state: { idleSince: number | null; emptySince: number | null } = { idleSince: null, emptySince: T0 - 21 * MIN };
  assert.equal(await reviewTick(h.d, state), "R-0002");
  assert.match(h.sent[0]!.line, /· empty · TEAM_A available for 21 min/);
  assert.match(h.sent[0]!.text, /- ATC-7 P2 Fire me/);
  assert.match(h.sent[0]!.text, /- #41 Tiny idea/);
  assert.equal(state.emptySince, null);
  // DUTY의 답이 ATC-7을 이름 붙이고 턴이 끝난다
  for (const f of feeds) f({ type: "text", text: "지금 ATC-7을 발권하세요", final: true });
  for (const f of feeds) f({ type: "state", state: "idle" });
  const o = h.appended.find((l) => l.ev === "outcome");
  assert.deepEqual(o && o.ev === "outcome" ? [o.review, o.named] : null, ["R-0002", 1]);
  // 60분 안에는 다시 empty 점검을 하지 않는다
  state.emptySince = T0 - 90 * MIN;
  h.d.now = () => T0 + 10 * MIN;
  assert.equal(await reviewTick(h.d, state), null);
});

test("empty 점검 결과(ATC-470): 점검 턴 뒤에 이어 쓰인 SUPERVISOR 글의 답은 named에 세지 않는다", async () => {
  const h = harness({ lines: [{ v: 1, ev: "review", id: "R-0001", at: new Date(T0 - 60 * MIN).toISOString(), trigger: "schedule", detail: "" }] });
  const feeds: ((e: unknown) => void)[] = [];
  (h.d.rt() as unknown as { subscribe: (f: (e: unknown) => void) => () => void }).subscribe = (f) => (feeds.push(f), () => {});
  h.d.get = async (path) => (path === "/api/dispatch/brief" ? { plan: { aircraft: [{ registration: "TEAM_A", available: true }], assign: [], unserved: [], excluded: [] } } : { landingQueue: [] });
  h.d.ready = () => [{ key: "ATC-7", title: "Fire me", priority: 2 }];
  h.d.ideas = async () => null;
  watchEmptyTurn(h.d.rt(), h.d.append, h.d.now);
  assert.equal(await reviewTick(h.d, { idleSince: null, emptySince: T0 - 30 * MIN }), "R-0002");
  for (const f of feeds) f({ type: "text", text: "요약: READY 없음", final: true });
  for (const f of feeds) f({ type: "user", text: "ATC-7 어때?" }); // 상태가 thinking으로 이어진 채 SUPERVISOR 글이 시작
  for (const f of feeds) f({ type: "text", text: "ATC-7을 쏘세요", final: true });
  for (const f of feeds) f({ type: "state", state: "idle" });
  const outs = h.appended.filter((l) => l.ev === "outcome");
  assert.equal(outs.length, 1);
  assert.equal(outs[0]!.ev === "outcome" ? outs[0]!.named : -1, 0);
});

// ── 같은 사실이면 건너뛰기(ATC-566) ──
// harness의 사실: 놀고 있는 AIRCRAFT 없음, leak "LANDING #9", 착륙 대기열 PR #9, WARNING 알림 하나. 지문은 첫 점검이 남긴 줄에서 읽는다
async function firstRun(over: Parameters<typeof harness>[0] = {}) {
  const h = harness({ leak: 200, ...over });
  assert.equal(await reviewTick(h.d, { idleSince: null }), "R-0001");
  const r = h.appended[0]!;
  assert.ok(r.ev === "review" && r.fp && r.facts?.includes("leak:LANDING #9"));
  return { h, review: r };
}

test("건너뛰기(ATC-566): 지난 점검이 아무것도 내지 않았고 사실이 같으면 다음 트리거는 턴을 시작하지 않고 skip 한 줄을 남긴다", async () => {
  const { review } = await firstRun();
  // 4시간 10분 뒤: 같은 leak의 서명이 reviewEveryMin(240분)을 넘겨 leak 트리거가 다시 선다
  const h = harness({ leak: 450, lines: [review], now: T0 + 250 * MIN });
  const state = { idleSince: null as number | null };
  assert.equal(await reviewTick(h.d, state), null);
  assert.equal(h.sent.length, 0);
  const sk = h.appended[0]!;
  assert.ok(sk.ev === "skip");
  assert.equal(sk.trigger, "leak");
  assert.equal(sk.same, "R-0001");
  assert.equal(sk.fp, review.ev === "review" ? review.fp : "");
  assert.match(sk.why, /same facts as R-0001/);
  // 다음 주기(1분 뒤): 건너뛴 점검도 간격에 들어 skip 줄을 또 쓰지 않는다
  h.d.now = () => T0 + 251 * MIN;
  assert.equal(await reviewTick(h.d, state), null);
  assert.equal(h.appended.length, 1);
  assert.equal(h.sent.length, 0);
});

test("건너뛰기(ATC-566): 건너뛴 뒤 사실이 바뀌면(새 알림) 트리거를 기다리지 않고 곧바로 돈다", async () => {
  const { review } = await firstRun();
  const h = harness({ leak: 450, lines: [review], now: T0 + 250 * MIN });
  const state = { idleSince: null as number | null };
  assert.equal(await reviewTick(h.d, state), null);
  h.d.now = () => T0 + 252 * MIN;
  h.d.alerts = () => [{ level: "warning", text: "something is stuck" }, { level: "caution", text: "a new one", key: "alert|orphan-flight|ATC-3" }];
  assert.equal(await reviewTick(h.d, state), "R-0002");
  assert.match(h.sent[0]!.line, /DUTY REVIEW R-0002 · leak · facts changed since the review skipped at 16:10Z/);
  const r2 = h.appended.at(-1)!;
  assert.ok(r2.ev === "review" && r2.facts?.includes("alert:alert|orphan-flight|ATC-3"));
});

test("건너뛰기(ATC-566): 스위치가 꺼졌거나, 지난 점검이 이슈·댓글을 냈으면 오늘처럼 돈다", async () => {
  const { review } = await firstRun();
  const off = harness({ leak: 450, lines: [review], now: T0 + 250 * MIN, cfg: { reviewSkip: false } });
  assert.equal(await reviewTick(off.d, { idleSince: null }), "R-0002");
  for (const out of [
    { v: 1, ev: "proposal", at: new Date(T0 + MIN).toISOString(), review: "R-0001", key: "ATC-9", title: "x" },
    { v: 1, ev: "write", at: new Date(T0 + MIN).toISOString(), review: "R-0001", key: "ATC-9", action: "comment" },
  ] as ReviewLine[]) {
    const h = harness({ leak: 450, lines: [review, out], now: T0 + 250 * MIN });
    assert.equal(await reviewTick(h.d, { idleSince: null }), "R-0002", out.ev);
  }
});

test("건너뛰기(ATC-566): 하루 한 번 — 마지막으로 돈 점검이 00:00Z 전이면 사실이 같아도 돈다", async () => {
  const { review } = await firstRun();
  // R-0001은 10-02 12:00Z. 10-03 00:05Z에 정기 트리거가 서면 하루 한 번으로 돈다
  const h = harness({ leak: 900, lines: [review], now: Date.parse("2026-10-03T00:05:00Z") });
  assert.equal(await reviewTick(h.d, { idleSince: null }), "R-0002");
  assert.match(h.sent[0]!.line, /daily heartbeat \(00:00Z\)/);
  // 같은 날 밀린 점검도: 10-03 02:00Z에 건너뛴 뒤 사실이 그대로면 00:00Z를 넘길 때까지 기다린다
  const skipLine: ReviewLine = { v: 1, ev: "skip", at: "2026-10-02T23:00:00.000Z", trigger: "schedule", detail: "", same: "R-0001", fp: review.ev === "review" ? review.fp! : "", facts: [], why: "same" };
  const p = harness({ leak: 900, lines: [review, skipLine], now: Date.parse("2026-10-02T23:40:00Z") });
  assert.equal(await reviewTick(p.d, { idleSince: null }), null);
  p.d.now = () => Date.parse("2026-10-03T00:01:00Z");
  assert.equal(await reviewTick(p.d, { idleSince: null }), "R-0002");
  assert.match(p.sent[0]!.line, /daily heartbeat \(00:00Z\): facts unchanged since R-0001/);
});

test("건너뛰기(ATC-566): 지문이 없는 옛 점검 줄 뒤에는 건너뛰지 않는다", async () => {
  const old: ReviewLine = { v: 1, ev: "review", id: "R-0001", at: new Date(T0 - 250 * MIN).toISOString(), trigger: "schedule", detail: "" };
  const h = harness({ lines: [old] });
  assert.equal(await reviewTick(h.d, { idleSince: null }), "R-0002");
});

test("duty-reviews.jsonl: skip·write 줄도 읽어 들인다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-review-store-"));
  try {
    const file = join(dir, "duty-reviews.jsonl");
    const lines: ReviewLine[] = [
      { v: 1, ev: "review", id: "R-0001", at: "2026-10-02T12:00:00.000Z", trigger: "leak", detail: "", fp: "abc", facts: ["idle:TEAM_A"] },
      { v: 1, ev: "write", at: "2026-10-02T12:01:00.000Z", review: "R-0001", key: "ATC-9", action: "comment" },
      { v: 1, ev: "skip", at: "2026-10-02T16:00:00.000Z", trigger: "schedule", detail: "", same: "R-0001", fp: "abc", facts: ["idle:TEAM_A"], why: "same" },
    ];
    for (const l of lines) appendReviewLine(l, file);
    assert.deepEqual(readReviewLines(file), lines);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
