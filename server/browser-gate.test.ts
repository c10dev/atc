import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BROWSER_SLOTS_DEFAULT,
  BROWSER_WAIT_LIMIT_SEC_DEFAULT,
  browserDirOf,
  browserGateView,
  busyMessage,
  countBrowserRuns,
  mergeMcpConfig,
  newestChromiumDir,
  parentGone,
  parseBrowserGateConfig,
  parseBrowserRuns,
  waitMessage,
  type BrowserRun,
} from "./browser-gate.ts";

const run = (p: Partial<BrowserRun> = {}): BrowserRun => ({ t: "2026-10-03T10:00:00Z", where: "local", cwd: "/x", waited: false, waitedMs: 0, ranMs: 1000, exit: 0, ...p });

test("설정: 기본값은 켜짐·3슬롯·90초, 틀린 값은 기본값, 끄는 것은 정확히 off", () => {
  const d = parseBrowserGateConfig({});
  assert.equal(d.mode, "on");
  assert.equal(d.slots, BROWSER_SLOTS_DEFAULT);
  assert.equal(d.waitLimitMs, BROWSER_WAIT_LIMIT_SEC_DEFAULT * 1000);
  assert.equal(d.realExecutable, null);
  assert.equal(parseBrowserGateConfig({ mode: "off" }).mode, "off");
  assert.equal(parseBrowserGateConfig({ mode: "OFF" }).mode, "on");
  assert.equal(parseBrowserGateConfig({ slots: 0 }).slots, BROWSER_SLOTS_DEFAULT);
  assert.equal(parseBrowserGateConfig({ slots: 99 }).slots, BROWSER_SLOTS_DEFAULT);
  assert.equal(parseBrowserGateConfig({ slots: 5 }).slots, 5);
  assert.equal(parseBrowserGateConfig(null).slots, BROWSER_SLOTS_DEFAULT);
});

test("설정: ms 대기 한도는 시험용 손잡이다. 기본과 초 단위 값은 그대로(ATC-523)", () => {
  assert.equal(parseBrowserGateConfig({}).waitLimitMs, 90_000);
  assert.equal(parseBrowserGateConfig({}, { ATC_BROWSER_WAIT_LIMIT_MS: "400" }).waitLimitMs, 400);
  assert.equal(parseBrowserGateConfig({ waitLimitSec: 30 }, { ATC_BROWSER_WAIT_LIMIT_MS: "400" }).waitLimitMs, 400);
  assert.equal(parseBrowserGateConfig({ waitLimitSec: 30 }, { ATC_BROWSER_WAIT_LIMIT_MS: "50" }).waitLimitMs, 30_000, "100ms 미만은 무시");
  assert.equal(parseBrowserGateConfig({ waitLimitSec: 30 }, { ATC_BROWSER_WAIT_LIMIT_MS: "x" }).waitLimitMs, 30_000);
  assert.equal(parseBrowserGateConfig({}, { ATC_BROWSER_WAIT_LIMIT_SEC: "5" }).waitLimitMs, 5000);
});

test("설정: 환경 변수가 파일을 이기고, 진짜 Chrome은 절대 경로만 받는다", () => {
  const c = parseBrowserGateConfig({ slots: 2, waitLimitSec: 30 }, { ATC_BROWSER_SLOTS: "4", ATC_BROWSER_WAIT_LIMIT_SEC: "bad", ATC_BROWSER_REAL: "/opt/chrome" });
  assert.equal(c.slots, 4);
  assert.equal(c.waitLimitMs, BROWSER_WAIT_LIMIT_SEC_DEFAULT * 1000);
  assert.equal(c.realExecutable, "/opt/chrome");
  assert.equal(parseBrowserGateConfig({ realExecutable: "chrome" }).realExecutable, null);
});

test("문 폴더는 VERIFY GATE 폴더 아래 browser/ (운영 상태 폴더와 따로)", () => {
  assert.equal(browserDirOf({ ATC_GATE_DIR: "/g" }), "/g/browser");
  assert.equal(browserDirOf({ HOME: "/h" }), "/h/.local/state/atc-gate/browser");
});

test("가장 새 chromium 폴더: revision 숫자 비교, headless shell·딴 이름은 무시", () => {
  assert.equal(newestChromiumDir(["chromium-1234", "chromium-1246", "chromium-999", "chromium_headless_shell-2000", "firefox-1549"]), "chromium-1246");
  assert.equal(newestChromiumDir(["firefox-1"]), null);
  assert.equal(newestChromiumDir([]), null);
});

test("부모가 바뀌면 세션이 끝난 것", () => {
  assert.equal(parentGone(100, 100), false);
  assert.equal(parentGone(100, 1), true);
});

test("메시지: busy는 BUSY로 시작하는 읽을 수 있는 안내이고 페이지·테스트 실패가 아니라고 말한다", () => {
  const m = busyMessage({ slots: 3, waitedMs: 90_000 });
  assert.match(m, /BUSY: all 3 shared browser slots are in use/);
  assert.match(m, /waited 90s/);
  assert.match(m, /not|fine/);
  assert.match(m, /browser_close/);
  assert.match(busyMessage({ slots: 1, waitedMs: 0 }), /1 shared browser slot is in use/);
  assert.match(waitMessage({ position: 2, slots: 3, waitedMs: 5000, limitMs: 90_000 }), /position 2 in line, 3 slots busy, waited 5s \(answers busy after 90s\)/);
});

test("기록 읽기: 반쯤 쓰인 줄과 모양이 틀린 줄은 건너뛴다", () => {
  const text = JSON.stringify(run()) + "\n{\"t\":\"2026\n" + JSON.stringify({ nope: 1 }) + "\n" + JSON.stringify(run({ busy: true })) + "\n";
  assert.equal(parseBrowserRuns(text).length, 2);
});

test("세기: 기다린 요청, 가장 긴 기다림, busy 답, 세션 뒤 놓은 슬롯, 바로 실행", () => {
  const runs = [
    run(),
    run({ waited: true, waitedMs: 4000 }),
    run({ waited: true, waitedMs: 90_000, busy: true, ranMs: 0, exit: 75 }),
    run({ endedWithSession: true, killed: true }),
    run({ fallback: "flock missing" }),
  ];
  const c = countBrowserRuns(runs);
  assert.deepEqual(c, { requests: 5, waited: 2, longestWaitMs: 90_000, busyAnswers: 1, releasedAfterEnd: 1, fallbacks: 1 });
  assert.equal(countBrowserRuns([]).requests, 0);
});

test("최근 7일 세기와 화면용 모양", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  const runs = [run({ t: "2026-09-01T00:00:00Z", busy: true, waited: true, waitedMs: 9000 }), run({ t: "2026-10-02T00:00:00Z" })];
  const v = browserGateView(runs, parseBrowserGateConfig({}), now);
  assert.equal(v.total.requests, 2);
  assert.equal(v.total.busyAnswers, 1);
  assert.equal(v.last7d.requests, 1);
  assert.equal(v.last7d.busyAnswers, 0);
  assert.equal(v.slots, 3);
  assert.equal(v.waitLimitSec, 90);
  assert.equal(v.recent.length, 2);
  assert.equal(v.recent[0].t, "2026-10-02T00:00:00Z"); // 최신이 먼저
});

test("MCP 설정 합치기: 실행 파일만 바꾸고 outputDir·viewport 같은 다른 칸은 그대로, 입력은 건드리지 않는다", () => {
  const base = { browser: { browserName: "chromium", launchOptions: { headless: true }, contextOptions: { viewport: { width: 1280, height: 800 } } }, outputDir: "/tmp/playwright-mcp" };
  const copy = JSON.parse(JSON.stringify(base));
  const out = mergeMcpConfig(base, "/x/chromium-gated") as typeof base & { browser: { launchOptions: { executablePath: string } } };
  assert.equal(out.browser.launchOptions.executablePath, "/x/chromium-gated");
  assert.equal(out.browser.launchOptions.headless, true);
  assert.equal(out.outputDir, "/tmp/playwright-mcp");
  assert.deepEqual(out.browser.contextOptions, base.browser.contextOptions);
  assert.deepEqual(base, copy);
  assert.deepEqual(mergeMcpConfig(null, "/w"), { browser: { launchOptions: { executablePath: "/w" } } });
  assert.deepEqual(mergeMcpConfig([], "/w"), { browser: { launchOptions: { executablePath: "/w" } } });
});
