import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyze, type AwExport, type ExperimentWindow, formatReport, matchRule, parseConfig } from "./attention.ts";

// 합성 fixture: 앱·제목·호스트는 전부 지어낸 값이다(실제 제목·이름·저장소 이름 없음)
const T0 = Date.parse("2030-01-01T00:00:00Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ev = (min: number, dur: number, data: Record<string, unknown>) => ({ timestamp: iso(min), duration: dur * 60, data });

const config = parseConfig(JSON.parse(readFileSync(new URL("../docs/research/attention-windows.json", import.meta.url), "utf8")));

function fixture(withInput = true): AwExport {
  const buckets: AwExport["buckets"] = {
    "aw-watcher-window_host1": {
      type: "currentwindow",
      hostname: "host1",
      events: [
        ev(0, 10, { app: "Terminal", title: "shell" }), // 센다
        ev(10, 10, { app: "Chrome", title: "Sample Page - GitHub" }), // 센다
        ev(20, 10, { app: "Chrome", title: "Recipes" }), // 안 센다
      ],
    },
    "aw-watcher-afk_host1": {
      type: "afkstatus",
      hostname: "host1",
      events: [ev(0, 20, { status: "not-afk" }), ev(20, 5, { status: "afk" }), ev(25, 5, { status: "not-afk" })],
    },
  };
  if (withInput) {
    buckets["aw-watcher-input_host1"] = {
      type: "os.hid.input",
      hostname: "host1",
      // 0~5분 입력, 5~10분 없음, 10~20분 입력(마지막 이벤트가 20분 직전까지), 25~30분 입력
      events: [ev(0, 5, { presses: 3, clicks: 0 }), ev(10, 10, { presses: 0, clicks: 2 }), ev(25, 5, { deltaX: 40 }), ev(6, 1, { presses: 0, clicks: 0 })],
    };
  }
  return { buckets };
}

const win = (extra: Partial<ExperimentWindow> = {}): ExperimentWindow => ({ start: iso(0), end: iso(30), arm: "atc", batch: "b1", issues: ["i1"], ...extra });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test("규칙은 앞에서부터 맞는 첫 것을 고르고 안 맞으면 null", () => {
  assert.equal(matchRule(config.rules, "Chrome", "Sample Page - GitHub"), "github");
  assert.equal(matchRule(config.rules, "Chrome", "Claude Code session"), "claude-code-web");
  assert.equal(matchRule(config.rules, "Terminal", "x"), "terminal");
  assert.equal(matchRule(config.rules, "Chrome", "Recipes"), null);
  assert.equal(matchRule(config.rules, "Claude", "any"), "claude-app");
});

test("active·tethered·away·excluded를 센다(입력 유지 시간 포함)", () => {
  const r = analyze(fixture(), [win()], config).windows[0];
  // 입력: 0~5분 + 유지 10초, 10~20분
  near(r.active, 5 + 10 / 60 + 10); // 둘째 구간의 유지 시간은 AFK 시작(20분)에서 잘린다
  near(r.tethered, 20 - r.active);
  near(r.away, 5);
  near(r.excluded, 5 /* 25~30분은 not-afk + 안 세는 창 */);
  near(r.nodata, 0);
  near(r.active + r.tethered + r.away + r.excluded + r.nodata, 30);
  assert.equal(r.byRule.terminal.active > 0, true);
  assert.equal(r.byRule.github.tethered, 0);
});

test("입력 버킷이 없으면 not-afk를 입력 있음으로 보고 알린다", () => {
  const rep = analyze(fixture(false), [win()], config);
  const r = rep.windows[0];
  near(r.active, 20);
  near(r.tethered, 0);
  assert.equal(r.inputBucket, false);
  assert.match(formatReport(rep), /no input bucket/);
});

test("AFK 기록이 없는 구간은 nodata", () => {
  const r = analyze(fixture(), [win({ end: iso(40) })], config).windows[0];
  near(r.nodata, 10);
});

test("두 팔에 같은 규칙이 적용되고 팔·배치별로 합쳐진다", () => {
  const rep = analyze(fixture(), [win(), win({ arm: "solo", batch: "s1" }), win({ batch: "b2" })], config);
  near(rep.byArm.atc.away, 10);
  near(rep.byArm.solo.away, 5);
  assert.deepEqual(Object.keys(rep.byBatch).sort(), ["atc/b1", "atc/b2", "solo/s1"]);
  assert.equal(rep.windows[0].active, rep.windows[1].active);
});

test("하위 구간이 있는 이슈만 이슈별로 낸다", () => {
  const rep = analyze(fixture(), [win({ issues: ["i1", "i2"], subWindows: [{ start: iso(0), end: iso(10), issue: "i1" }] })], config);
  assert.deepEqual(Object.keys(rep.byIssue), ["atc/i1"]);
  near(rep.byIssue["atc/i1"].active + rep.byIssue["atc/i1"].tethered, 10);
  assert.throws(() => analyze(fixture(), [win({ subWindows: [{ start: iso(-5), end: iso(10), issue: "i1" }] })], config), /밖/);
});

test("수동 타이머와 active의 차가 크면 표시한다", () => {
  const near1 = analyze(fixture(), [win({ timer: [{ start: iso(0), end: iso(15) }] })], config).windows[0];
  assert.equal(near1.timerMinutes, 15);
  assert.equal(near1.timerFlag, false);
  const far = analyze(fixture(), [win({ timer: [{ start: iso(0), end: iso(29) }] })], config).windows[0];
  assert.equal(far.timerFlag, true);
  assert.equal(analyze(fixture(), [win()], config).windows[0].timerMinutes, null);
});

test("겹치는 창 이벤트는 뒤 이벤트가 시작하는 곳에서 앞을 자른다", () => {
  const f = fixture(false);
  f.buckets["aw-watcher-window_host1"].events = [ev(0, 30, { app: "Terminal", title: "a" }), ev(10, 5, { app: "Chrome", title: "Recipes" })];
  const r = analyze(f, [win()], config).windows[0];
  near(r.excluded, 15); // 10~20분(안 세는 창, 그 뒤 창 기록 없음) + 25~30분(창 기록 없음), 모두 not-afk
});

test("설정 검사: 빈 규칙, 겹친 id, 깨진 정규식은 던진다", () => {
  assert.throws(() => parseConfig({ rules: [] }), /rules/);
  assert.throws(() => parseConfig({ rules: [{ id: "a", app: "x" }, { id: "a", app: "y" }] }), /겹친다/);
  assert.throws(() => parseConfig({ rules: [{ id: "a", app: "(" }] }));
  assert.throws(() => parseConfig({ rules: [{ id: "a" }] }), /app 또는 title/);
});

test("출력 표에 합계가 나온다", () => {
  const out = formatReport(analyze(fixture(), [win()], config));
  assert.match(out, /\| atc \| b1 \|/);
  assert.match(out, /Per arm/);
});
