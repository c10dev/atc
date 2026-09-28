import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePriceTable } from "./fuel-cost.ts";
import { contextBadgeOf, contextLabel, contextSizeOf, contextView, refreshSavingOf, sessionContexts, tokensShort, windowOf } from "./fuel-context.ts";
import type { FuelRecord } from "./fuel.ts";

const rec = (t: string, over: Partial<FuelRecord> = {}): FuelRecord => ({
  key: `m-${t}|r`, session: "s1", sidechain: false, agent: null, t, model: "claude-opus-5-5",
  input: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 100,
  stopReason: "end_turn", version: null, effort: null, speed: null, geo: null, ...over,
});

test("sessionContexts: 마지막 CAPTAIN 요청의 input + cacheRead + cacheWrite. CREW 요청은 보지 않는다", () => {
  const m = sessionContexts([
    rec("2026-09-28T10:00:00Z", { input: 5, cacheWrite1h: 25_000 }),
    rec("2026-09-28T11:00:00Z", { input: 3, cacheWrite1h: 2_000, cacheRead: 499_700 }),
    // 더 늦은 CREW 요청(서브에이전트)은 CAPTAIN 대화 크기가 아니다
    rec("2026-09-28T11:30:00Z", { sidechain: true, agent: "a1", cacheRead: 40_000 }),
  ]);
  const c = m.get("s1")!;
  assert.equal(c.contextTokens, 501_703);
  assert.equal(c.at, "2026-09-28T11:00:00Z");
  assert.equal(c.model, "claude-opus-5-5");
  assert.equal(c.base, 25_005);
  assert.equal(c.tier, "1h");
  assert.equal(c.compacted, false);
});

test("sessionContexts: 마지막 요청 뒤 compaction이면 postTokens로 줄고, 그 앞 compaction은 상관없다", () => {
  const records = [rec("2026-09-28T10:00:00Z", { cacheRead: 150_000 }), rec("2026-09-28T11:00:00Z", { cacheRead: 180_000 })];
  const before = { session: "s1", t: "2026-09-28T10:30:00Z", trigger: "auto", preTokens: 160_000, postTokens: 20_000 };
  assert.equal(sessionContexts(records, [before]).get("s1")!.contextTokens, 180_010);
  const after = sessionContexts(records, [before, { session: "s1", t: "2026-09-28T11:05:00Z", trigger: "manual", preTokens: 180_010, postTokens: 12_000 }]).get("s1")!;
  assert.equal(after.contextTokens, 12_000);
  assert.equal(after.at, "2026-09-28T11:05:00Z");
  assert.equal(after.compacted, true);
  // postTokens를 모르면 크기도 모른다
  const unknown = sessionContexts(records, [{ session: "s1", t: "2026-09-28T11:05:00Z", trigger: null, preTokens: null, postTokens: null }]).get("s1")!;
  assert.equal(unknown.contextTokens, null);
  assert.equal(contextLabel(contextSizeOf(unknown)), "context — / 200k (compacted)");
  // 다른 세션의 compaction은 상관없다
  assert.equal(sessionContexts(records, [{ ...before, session: "s2", t: "2026-09-28T11:05:00Z" }]).get("s1")!.contextTokens, 180_010);
});

test("windowOf: 설정 → [1m] 이름 → 200k를 넘게 봄 → 200k", () => {
  assert.deepEqual(windowOf("claude-opus-5-5", 120_000), { window: 200_000, source: "default" });
  assert.deepEqual(windowOf("claude-opus-5-5[1m]", 10_000), { window: 1_000_000, source: "model" });
  assert.deepEqual(windowOf("claude-opus-5-5", 240_000), { window: 1_000_000, source: "observed" });
  assert.deepEqual(windowOf("claude-opus-5-5", 240_000, { "claude-opus-5-5": 500_000 }), { window: 500_000, source: "config" });
  // 날짜 접미어를 뗀 이름으로도 찾는다. 이상한 값은 버린다
  assert.deepEqual(windowOf("claude-haiku-4-5-20251001", 1, { "claude-haiku-4-5": 1_000_000 }), { window: 1_000_000, source: "config" });
  assert.deepEqual(windowOf("claude-sonnet-5", 1, { "claude-sonnet-5": -1 }), { window: 200_000, source: "default" });
});

test("contextLabel: context 502k / 1M (50%)", () => {
  const c = sessionContexts([rec("2026-09-28T10:00:00Z", { cacheRead: 300_000 }), rec("2026-09-28T11:00:00Z", { input: 1_700, cacheRead: 500_000 })]).get("s1")!;
  const size = contextSizeOf(c);
  assert.equal(size.window, 1_000_000);
  assert.equal(size.pct, 0.502);
  assert.equal(contextLabel(size), "context 502k / 1M (50%)");
  assert.equal(tokensShort(1_500_000), "1.5M");
  assert.equal(tokensShort(999), "999");
});

test("refreshSavingOf: (context − base)의 캐시 쓰기(다음 cold wake)와 한 턴 읽기를 F5 가격표로", () => {
  const prices = parsePriceTable({ writeMult: { "5m": 1.25, "1h": 2 }, models: { "claude-opus-5-5": { in: 4, out: 20, readMult: 0.05 } } });
  const c = { contextTokens: 525_000, base: 25_000, model: "claude-opus-5-5", tier: "1h" as const, speed: null, geo: null };
  // 500k × 2 × $4/M = $4.00, 500k × 0.05 × $4/M = $0.10
  assert.deepEqual(refreshSavingOf(c, prices), { tokens: 500_000, coldWake: 4, perTurn: 0.1 });
  assert.deepEqual(refreshSavingOf({ ...c, tier: "5m" }, prices), { tokens: 500_000, coldWake: 2.5, perTurn: 0.1 });
  // 값이 없는 모델은 토큰만, 크기를 모르면 null
  assert.deepEqual(refreshSavingOf({ ...c, model: "deepseek-v4.1-flash" }, prices), { tokens: 500_000, coldWake: null, perTurn: null });
  assert.equal(refreshSavingOf({ ...c, contextTokens: null }, prices), null);
  assert.deepEqual(refreshSavingOf({ ...c, contextTokens: 10_000 }, null), { tokens: 0, coldWake: null, perTurn: null });
});

test("contextBadgeOf: FLEET 칸과 카드. 창의 40 %부터 info, 70 %부터 alert. 200k 짐작이면 토큰 300k·500k로", () => {
  const view = (cacheRead: number, over = {}) => contextView(contextSizeOf({ ...sessionContexts([rec("2026-09-28T11:00:00Z", { cacheRead })]).get("s1")!, ...over }));
  const b = contextBadgeOf(view(501_690))!;
  assert.equal(b.short, "502k / 1M");
  assert.equal(b.label, "context 502k / 1M (50%)");
  assert.equal(b.level, "info");
  assert.match(b.title, /claude-opus-5-5 · 2026-09-28 11:00Z · 창: 200k를 넘는 요청을 봄/);
  assert.equal(contextBadgeOf(view(750_000))!.level, "alert");
  assert.equal(contextBadgeOf(view(250_000))!.level, "ok");
  assert.equal(contextBadgeOf(view(120_000))!.level, "ok"); // 200k 짐작: 60%지만 토큰 기준
  assert.equal(contextBadgeOf(view(120_000))!.short, "120k / 200k");
  assert.equal(contextBadgeOf(null), null);
});
