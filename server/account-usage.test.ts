import assert from "node:assert/strict";
import { test } from "node:test";
import { planUsageOf, planUsageViewsOf, resetOf, type UsageRead, usageReadOf, usageWindowsOf, windowLabel } from "./account-usage.ts";
import { refreshUsage } from "./account-usage-run.ts";
import type { FuelRemaining } from "./fuel-remaining.ts";

// ACCOUNT 요금제·사용량(ATC-348). /usage 글은 2026-10-02 Claude Code 2.1.287에서 본 모양(계정을 알 수 있는 줄은 지어낸 것)
const NOW = Date.parse("2026-10-02T02:00:00Z");
const cfg = { infoPct: 80, holdPct: 95, hold: false };

const USAGE = [
  "You are currently using your subscription to power your Claude Code usage",
  "",
  "Current session: 2% used · resets Oct 2, 6:59am (UTC)",
  "Current week (all models): 54% used · resets Oct 3, 2:59am (UTC)",
  "Current week (Fable): 0% used · resets Oct 3, 3am (UTC)",
  "",
  "What's contributing to your limits usage?",
  "Signed in as someone@example.com · Org Name",
  "Last 24h · 3829 requests · 36 sessions",
  "  73% of your usage was at >150k context",
].join("\n");
const json = (result: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 0, total_cost_usd: 0, result, ...extra });

test("resetOf: 날짜·분이 있거나 없는 UTC 글을 가장 가까운 앞날로", () => {
  assert.equal(resetOf("Oct 2, 6:59am (UTC)", NOW), "2026-10-02T06:59:00.000Z");
  assert.equal(resetOf("Oct 8, 10am (UTC)", NOW), "2026-10-08T10:00:00.000Z");
  assert.equal(resetOf("Oct 3, 12am (UTC)", NOW), "2026-10-03T00:00:00.000Z");
  assert.equal(resetOf("Oct 3, 12pm (UTC)", NOW), "2026-10-03T12:00:00.000Z");
  // 해가 넘어가는 reset: 12월 말에 본 "Jan 2"는 다음 해
  assert.equal(resetOf("Jan 2, 3am (UTC)", Date.parse("2026-12-30T00:00:00Z")), "2027-01-02T03:00:00.000Z");
  // 날짜 없이 시각만: 오늘, 지났으면 내일
  assert.equal(resetOf("3pm (UTC)", NOW), "2026-10-02T15:00:00.000Z");
  assert.equal(resetOf("1am (UTC)", NOW), "2026-10-03T01:00:00.000Z");
  // UTC가 아니거나 모르는 글은 null
  for (const bad of ["Oct 2, 6:59am (KST)", "tomorrow", "Foo 2, 3am (UTC)", "Oct 2, 13pm (UTC)", "Oct 2, 6:75am (UTC)", ""]) assert.equal(resetOf(bad, NOW), null, bad);
});

test("usageWindowsOf: 한도 줄만 읽고 다른 줄은 버린다", () => {
  assert.deepEqual(usageWindowsOf(USAGE, NOW), [
    { name: "five_hour", pct: 2, resetsAt: "2026-10-02T06:59:00.000Z" },
    { name: "seven_day", pct: 54, resetsAt: "2026-10-03T02:59:00.000Z" },
    { name: "seven_day:Fable", pct: 0, resetsAt: "2026-10-03T03:00:00.000Z" },
  ]);
  // reset 없는 0 % 줄, 소수, 100 넘는 값
  assert.deepEqual(usageWindowsOf("Current session: 0% used\nCurrent week (all models): 12.5% used · resets Oct 8, 10am (UTC)\nCurrent week (Opus): 140% used", NOW), [
    { name: "five_hour", pct: 0, resetsAt: null },
    { name: "seven_day", pct: 12.5, resetsAt: "2026-10-08T10:00:00.000Z" },
    { name: "seven_day:Opus", pct: 100, resetsAt: null },
  ]);
  // 같은 창이 두 번 나오면 처음 것. 모델 이름에 이상한 글자가 있으면 버린다
  assert.deepEqual(usageWindowsOf("Current session: 5% used\nCurrent session: 90% used\nCurrent week (a<b>): 3% used", NOW), [{ name: "five_hour", pct: 5, resetsAt: null }]);
});

test("usageReadOf: 창과 이유만 남는다 — email·조직·기타 줄은 나가지 않는다", () => {
  const got = usageReadOf(json(USAGE), NOW);
  assert.equal(got.reason, null);
  assert.equal(got.windows.length, 3);
  assert.deepEqual(Object.keys(got).sort(), ["at", "reason", "windows"]);
  for (const leak of ["example.com", "Org Name", "requests", "subscription"]) assert.equal(JSON.stringify(got).includes(leak), false, leak);
});

test("usageReadOf: 읽지 못하면 창 없이 이유(0 %가 아니다)", () => {
  const cases: [string, RegExp][] = [
    ["", /답하지 않음/],
    ["not json", /읽지 못함/],
    [JSON.stringify({ type: "assistant" }), /모양/],
    [json("x", { is_error: true }), /오류/],
    // 2026-10-02 acct-3에서 본 모양: 한도 줄 없이 아래 절만
    [json("You are currently using your subscription to power your Claude Code usage\n\nWhat's contributing to your limits usage?\nLast 7d · 622 requests · 11 sessions"), /한도 줄이 없음/],
  ];
  for (const [out, re] of cases) {
    const r = usageReadOf(out, NOW);
    assert.deepEqual(r.windows, []);
    assert.match(r.reason ?? "", re);
  }
});

const fuel = (at: string, windows: FuelRemaining["windows"], from = "TEAM_K"): FuelRemaining => ({
  group: "acct-1",
  account: "acct-1",
  at,
  from,
  fromKind: "aircraft",
  windows,
  top: windows[0],
  level: "ok",
  aircraft: [from],
  control: [],
});
const read = (at: string, windows: UsageRead["windows"], reason: string | null = null): UsageRead => ({ at, windows, reason });

test("planUsageOf: 아무 값도 없으면 알 수 없음(창 없음)", () => {
  const v = planUsageOf(undefined, undefined, cfg, NOW);
  assert.equal(v.source, null);
  assert.deepEqual(v.windows, []);
  assert.match(v.reason ?? "", /REFRESH/);
  // 실패한 REFRESH만 있으면 그 이유
  assert.match(planUsageOf(undefined, read("2026-10-02T01:59:00Z", [], "claude가 오류를 냄"), cfg, NOW).reason ?? "", /오류/);
});

test("planUsageOf: statusline과 /usage 가운데 더 새것, 남은 몫과 임계값 수준", () => {
  const f = fuel("2026-10-02T01:50:00Z", [
    { name: "seven_day", pct: 96, resetsAt: "2026-10-03T02:59:00Z" },
    { name: "five_hour", pct: 81.5, resetsAt: "2026-10-02T06:59:00Z" },
  ]);
  const v = planUsageOf(f, undefined, cfg, NOW);
  assert.equal(v.source, "statusline");
  assert.equal(v.from, "TEAM_K");
  assert.equal(v.stale, false);
  assert.deepEqual(
    v.windows.map((w) => [w.label, w.used, w.left, w.level]),
    [
      ["5h", 81.5, 18, "info"], // 쓴 몫 82 %로 보이니 남은 몫은 18 %(합 100)
      ["7d", 96, 4, "hold"],
    ],
  );
  const r = read("2026-10-02T01:55:00Z", [
    { name: "five_hour", pct: 2, resetsAt: "2026-10-02T06:59:00Z" },
    { name: "seven_day:Fable", pct: 0, resetsAt: null },
    { name: "seven_day", pct: 54, resetsAt: "2026-10-03T02:59:00Z" },
  ]);
  const u = planUsageOf(f, r, cfg, NOW);
  assert.equal(u.source, "usage");
  assert.equal(u.from, null);
  assert.deepEqual(u.windows.map((w) => w.label), ["5h", "7d", "7d Fable"]);
  // statusline이 더 새면 statusline
  assert.equal(planUsageOf(fuel("2026-10-02T01:58:00Z", f.windows), r, cfg, NOW).source, "statusline");
});

test("planUsageOf: reset이 지난 /usage 창은 빼고, 실패한 새 REFRESH는 이유로 보인다, 30분 넘으면 오래됨", () => {
  const old = read("2026-10-01T20:00:00Z", [{ name: "five_hour", pct: 70, resetsAt: "2026-10-02T01:00:00Z" }]);
  const v = planUsageOf(undefined, old, cfg, NOW);
  assert.equal(v.source, null);
  assert.match(v.reason ?? "", /reset/);
  const f = fuel("2026-10-02T01:00:00Z", [{ name: "seven_day", pct: 40, resetsAt: "2026-10-03T02:59:00Z" }]);
  const failed = planUsageOf(f, read("2026-10-02T01:59:00Z", [], "claude가 오류를 냄"), cfg, NOW);
  assert.equal(failed.source, "statusline");
  assert.equal(failed.stale, true);
  assert.match(failed.reason ?? "", /마지막 REFRESH 실패: claude가 오류를 냄/);
  // 실패가 statusline 값보다 오래됐으면 이유를 달지 않는다
  assert.equal(planUsageOf(f, read("2026-10-02T00:59:00Z", [], "x"), cfg, NOW).reason, null);
});

test("windowLabel", () => {
  assert.deepEqual(["five_hour", "seven_day", "seven_day:Opus", "spend_limit", "other"].map(windowLabel), ["5h", "7d", "7d Opus", "spend", "other"]);
});

test("refreshUsage: 한 번에 하나, 같은 폴더는 묶고, 최근 값은 다시 읽지 않는다", async () => {
  let running = 0;
  let maxRunning = 0;
  const calls: string[] = [];
  const run = async (dir: string) => {
    calls.push(dir);
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return dir.endsWith("bad") ? "" : json("Current session: 7% used");
  };
  const [a, a2, b] = await Promise.all([refreshUsage("/t/a", NOW, run), refreshUsage("/t/a", NOW, run), refreshUsage("/t/bad", NOW, run)]);
  assert.equal(maxRunning, 1);
  assert.deepEqual(calls, ["/t/a", "/t/bad"]);
  assert.equal(a.read, a2.read);
  assert.equal(a.read.windows[0].pct, 7);
  assert.equal(b.read.windows.length, 0);
  // 방금 읽은 값은 다시 읽지 않는다(cached). 실패한 값은 30초 뒤에 다시 읽는다
  const again = await refreshUsage("/t/a", Date.now() + 60_000, run);
  assert.equal(again.cached, true);
  assert.equal(calls.length, 2);
  const retry = await refreshUsage("/t/bad", Date.now() + 31_000, run);
  assert.equal(retry.cached, false);
  assert.equal(calls.length, 3);
  const later = await refreshUsage("/t/a", Date.now() + 6 * 60_000, run);
  assert.equal(later.cached, false);
  assert.equal(calls.length, 4);
});

test("planUsageViewsOf: 폴더마다, statusline은 같은 라벨의 ACCOUNT 것만, /usage는 폴더 경로로", () => {
  const folders = [
    { label: "acct-1", dir: "/h/.claude-acct-1" },
    { label: "acct-2", dir: "/h/.claude" },
    { label: "acct-3", dir: "/h/.claude-acct-3" },
  ];
  const unlabelled = { ...fuel("2026-10-02T01:59:00Z", [{ name: "five_hour", pct: 99, resetsAt: "2026-10-02T06:59:00Z" }]), group: "aircraft:TEAM_Z", account: null };
  const views = planUsageViewsOf(
    folders,
    [fuel("2026-10-02T01:50:00Z", [{ name: "seven_day", pct: 54, resetsAt: "2026-10-03T02:59:00Z" }]), unlabelled],
    new Map([["/h/.claude-acct-3", read("2026-10-02T01:55:00Z", [{ name: "seven_day", pct: 10, resetsAt: "2026-10-03T02:59:00Z" }])]]),
    cfg,
    NOW,
  );
  assert.deepEqual(Object.keys(views), ["acct-1", "acct-2", "acct-3"]);
  assert.deepEqual([views["acct-1"].source, views["acct-1"].windows[0].used], ["statusline", 54]);
  assert.equal(views["acct-2"].source, null); // 라벨 없이 묶인 99 %를 남의 폴더에 붙이지 않는다
  assert.deepEqual([views["acct-3"].source, views["acct-3"].windows[0].used], ["usage", 10]);
});
