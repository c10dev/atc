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

test("contextBadgeOf: FOB = 창에 남은 몫. 목록은 FOB 50% · 504k/1M, 카드는 FOB 50% · 504k / 1M(ATC-81)", () => {
  const view = (cacheRead: number, over = {}) => contextView(contextSizeOf({ ...sessionContexts([rec("2026-09-28T11:00:00Z", { cacheRead })]).get("s1")!, ...over }));
  const b = contextBadgeOf(view(501_690))!;
  assert.equal(b.short, "FOB 50% · 502k/1M");
  assert.equal(b.label, "FOB 50% · 502k / 1M");
  assert.equal(b.fobPct, 50);
  assert.equal(b.level, "info"); // 50 % 남음은 amber
  assert.match(b.title, /FOB\(FUEL ON BOARD\) 50% = 창 1M에 남은 몫\. context 502k \/ 1M \(50%\) · claude-opus-5-5 · 2026-09-28 11:00Z · 창: 200k를 넘는 요청을 봄/);
  assert.equal(contextView(null), null);
  assert.equal(contextBadgeOf(null), null);
  assert.equal(view(501_690)!.fobPct, 50); // API에도 실린다(field 이름 context는 그대로)
});

test("contextBadgeOf 색: 남은 몫 60 % 이하 info, 30 % 이하 alert(ATC-69의 쓴 몫 40 %/70 %). 1M 창", () => {
  const view = (used: number) => contextView(contextSizeOf({ ...sessionContexts([rec("2026-09-28T11:00:00Z", { cacheRead: used })]).get("s1")!, maxSeen: 300_000 }))!;
  const at = (used: number) => {
    const b = contextBadgeOf(view(used))!;
    return `${b.fobPct}:${b.level}`;
  };
  assert.equal(at(300_000), "70:ok");
  assert.equal(at(390_000), "61:ok");
  assert.equal(at(400_000), "60:info"); // 60 % 남음부터 amber
  assert.equal(at(690_000), "31:info");
  assert.equal(at(700_000), "30:alert"); // 30 % 남음부터 alert
  assert.equal(at(1_000_000), "0:alert");
  assert.equal(at(1_200_000), "0:alert"); // 창을 넘어도 0 아래로 내려가지 않는다
  // 화면에 적힌 정수 %로 가른다: 39.6 % 쓴 것은 FOB 60 %로 적히니 amber
  assert.equal(at(396_000), "60:info");
});

test("contextBadgeOf: 창을 200k로 짐작만 했으면 토큰 300k·500k로 가른다. compaction 뒤 크기를 모르면 FOB —", () => {
  const view = (cacheRead: number) => contextView(contextSizeOf(sessionContexts([rec("2026-09-28T11:00:00Z", { cacheRead })]).get("s1")!))!;
  const b = contextBadgeOf(view(120_000))!;
  assert.equal(b.short, "FOB 40% · 120k/200k");
  assert.equal(b.level, "ok"); // 남은 몫 40 %지만 짐작한 창이라 토큰 기준
  const unknown = contextBadgeOf(contextView(contextSizeOf(sessionContexts([rec("2026-09-28T10:00:00Z")], [{ session: "s1", t: "2026-09-28T11:05:00Z", trigger: null, preTokens: null, postTokens: null }]).get("s1")!)))!;
  assert.equal(unknown.short, "FOB — · —/200k (compacted)");
  assert.equal(unknown.fobPct, null);
  assert.equal(unknown.level, "ok");
});
