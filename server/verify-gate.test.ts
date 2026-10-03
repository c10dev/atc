import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cmdLabel,
  countRuns,
  exitCodeOf,
  gateDirOf,
  gateView,
  type GateRun,
  mayTry,
  NODE_SHIM,
  parseGateConfig,
  parseRuns,
  queuePosition,
  shouldAnnounce,
  timeoutMessage,
  waitDecision,
  waitMessage,
} from "./verify-gate.ts";

const run = (p: Partial<GateRun>): GateRun => ({ t: "2026-10-03T00:00:00.000Z", where: "local", cmd: "npm test", cwd: "/x", waited: false, waitedMs: 0, ranMs: 10, exit: 0, ...p });

test("config: 기본값, 환경이 파일을 이긴다, 틀린 값은 기본값, 끄는 것은 정확히 off", () => {
  assert.deepEqual(parseGateConfig(undefined), { mode: "on", slots: 2, waitLimitMs: 1_800_000, testConcurrency: 3, remote: "on", probeMs: 3000 });
  assert.equal(parseGateConfig({ mode: "OFF" }).mode, "on");
  assert.equal(parseGateConfig({ mode: "off" }).mode, "off");
  assert.equal(parseGateConfig({ slots: 4 }).slots, 4);
  assert.equal(parseGateConfig({ slots: 4 }, { ATC_GATE_SLOTS: "3" }).slots, 3);
  assert.equal(parseGateConfig({ slots: 0 }).slots, 2);
  assert.equal(parseGateConfig({ slots: 99 }).slots, 2);
  assert.equal(parseGateConfig({}, { ATC_GATE_WAIT_LIMIT_SEC: "5" }).waitLimitMs, 5000);
  assert.equal(parseGateConfig({}, { ATC_GATE_TEST_CONCURRENCY: "x" }).testConcurrency, 3);
});

test("gateDirOf: 환경 변수가 먼저, 아니면 운영 상태 폴더와 따로인 atc-gate", () => {
  assert.equal(gateDirOf({ ATC_GATE_DIR: "/t/g" }), "/t/g");
  assert.equal(gateDirOf({ HOME: "/h" }), "/h/.local/state/atc-gate");
});

test("줄 순번: 도착순, 죽은 표는 세지 않는다, 내 표가 없으면 맨 뒤", () => {
  const t = [
    { name: "001-a", alive: true },
    { name: "002-dead", alive: false },
    { name: "003-me", alive: true },
    { name: "004-c", alive: true },
  ];
  assert.equal(queuePosition(t, "003-me"), 2);
  assert.equal(queuePosition(t, "001-a"), 1);
  assert.equal(queuePosition(t, "009-new"), 4);
  assert.equal(queuePosition([{ name: "5-me", alive: false }], "5-me"), 1); // 내 표는 늘 센다
});

test("슬롯 시도 자격은 줄 앞 N명, 기다림 한도 판단", () => {
  assert.equal(mayTry(1, 2), true);
  assert.equal(mayTry(2, 2), true);
  assert.equal(mayTry(3, 2), false);
  assert.equal(waitDecision(999, 1000), "wait");
  assert.equal(waitDecision(1000, 1000), "timeout");
});

test("알림은 처음 한 번, 그다음 30초마다", () => {
  assert.equal(shouldAnnounce(null, 0), true);
  assert.equal(shouldAnnounce(0, 29_999), false);
  assert.equal(shouldAnnounce(0, 30_000), true);
  assert.equal(shouldAnnounce(30_000, 59_000), false);
});

test("메시지에 순번·기다린 시간·한도가 있다", () => {
  const m = waitMessage({ position: 3, slots: 2, waitedMs: 12_400, limitMs: 1_800_000 });
  assert.match(m, /position 3/);
  assert.match(m, /waited 12s/);
  assert.match(m, /1800s/);
  assert.match(timeoutMessage(61_000), /exit 75/);
});

test("종료 코드: 코드 그대로, 신호는 128+번호", () => {
  assert.equal(exitCodeOf(0, null), 0);
  assert.equal(exitCodeOf(7, null), 7);
  assert.equal(exitCodeOf(null, 15), 143);
});

test("명령 이름은 앞 세 낱말까지만 남긴다(인자에 섞인 비밀을 기록하지 않는다)", () => {
  assert.equal(cmdLabel(["npx", "tsc", "--noEmit", "-p", ".", "--token=SECRET"]), "npx tsc --noEmit");
});

// 데스크톱 칸(ATC-518)은 verify-remote.test.ts가 센다. 여기서는 0이다
const NO_REMOTE = { desktopRuns: 0, transportFailed: 0, remoteCommandFails: 0, localFallbacks: { "desktop-absent": 0, "transport-error": 0, "not-listed": 0, "switch-off": 0 }, lostMidway: 0 };

test("카운터: 줄 선 수·가장 긴 기다림·한도 실패·바로 실행·죽은 명령, 7일 창", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  const runs = [
    run({ t: "2026-09-01T00:00:00Z", waited: true, waitedMs: 90_000 }),
    run({ t: "2026-10-02T00:00:00Z", waited: true, waitedMs: 5000 }),
    run({ t: "2026-10-02T01:00:00Z", waited: true, waitedMs: 1_800_000, timedOut: true, exit: 75 }),
    run({ t: "2026-10-02T02:00:00Z", fallback: "flock missing" }),
    run({ t: "2026-10-03T00:00:00Z", killed: true, exit: 143 }),
    run({ t: "2026-10-03T01:00:00Z" }),
  ];
  const v = gateView(runs, parseGateConfig({}), now);
  assert.deepEqual(v.total, { runs: 6, waited: 3, longestWaitMs: 1_800_000, waitLimitFails: 1, fallbacks: 1, killedReleases: 1, ...NO_REMOTE });
  assert.equal(v.last7d.runs, 5);
  assert.equal(v.last7d.longestWaitMs, 1_800_000);
  assert.equal(v.where, "local");
  assert.equal(v.recent.length, 5);
  assert.equal(v.recent[0].t, "2026-10-03T01:00:00Z");
  assert.deepEqual(countRuns([]), { runs: 0, waited: 0, longestWaitMs: 0, waitLimitFails: 0, fallbacks: 0, killedReleases: 0, ...NO_REMOTE });
});

test("기록 읽기는 반쯤 쓰인 줄과 모양이 틀린 줄을 건너뛴다", () => {
  const text = [JSON.stringify(run({})), "{\"t\":\"2026", "not json", JSON.stringify({ x: 1 }), ""].join("\n");
  assert.equal(parseRuns(text).length, 1);
});

test("node 껍데기는 --test에만 동시성을 건다", () => {
  assert.match(NODE_SHIM, /--test-concurrency=\$k/);
  assert.match(NODE_SHIM, /ATC_GATE_REAL_NODE/);
});
