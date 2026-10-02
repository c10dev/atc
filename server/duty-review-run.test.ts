import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type DutyConfig, parseDutyConfig } from "./duty-config.ts";
import type { ReviewLine } from "./duty-review.ts";
import { landingLinesOf, type ReviewDeps, reviewTick } from "./duty-review-run.ts";
import type { DutyRuntime } from "./duty-run.ts";
import type { Snapshot } from "./model.ts";

const T0 = Date.parse("2026-10-02T12:00:00Z");
const MIN = 60_000;

const DISPATCH = (idle: boolean) => ({ plan: { aircraft: [{ registration: "TEAM_A", available: idle }], assign: idle ? [{ flight: "ATC-1" }] : [], unserved: [], excluded: [] } });

function harness(over: { cfg?: Partial<DutyConfig>; now?: number; idle?: boolean; busy?: boolean; refuse?: boolean; lines?: ReviewLine[]; leak?: number | null } = {}) {
  const appended: ReviewLine[] = [];
  const sent: { text: string; line: string }[] = [];
  const rt = {
    status: () => ({ state: over.busy ? "thinking" : "idle", queued: 0 }),
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
