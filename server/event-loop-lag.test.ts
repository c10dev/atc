import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LAG_START, type LagEpisodeLine, type LagState, type LagSwitch, lagCounterOf, lagLineOf, lagStep, openLagOf, parseLagSwitch } from "./event-loop-lag.ts";
import { createTimer, type LoopSampler, sumTimings, type TimingLine } from "./job-timing.ts";

// EVENT LOOP LAG(ATC-538)
const MIN = 60_000;
const T0 = Date.parse("2026-10-20T12:00:00Z");
const CFG = { thresholdMs: 250, windows: 3 };
const win = (p99Ms: number) => ({ p99Ms, maxMs: p99Ms * 2 });

// 구간을 차례로 넣어 에피소드 줄을 모은다. 구간은 5분 간격
function run(p99s: (number | null)[], sw: LagSwitch = "on", cfg = CFG, from: LagState = LAG_START, start = T0) {
  let st = from;
  const lines: LagEpisodeLine[] = [];
  p99s.forEach((p, i) => {
    const r = lagStep(st, p === null ? null : win(p), cfg, sw, start + i * 5 * MIN);
    st = r.state;
    lines.push(...r.lines);
  });
  return { st, lines };
}

test("스위치: 파일에 없거나 모르는 값이면 on, 끄는 것은 off뿐", () => {
  assert.equal(parseLagSwitch(undefined), "on");
  assert.equal(parseLagSwitch("x"), "on");
  assert.equal(parseLagSwitch("off"), "off");
});

test("기준을 연달아 N번 넘어야 알림이 오른다: 둘만 넘으면 오르지 않고, 셋째에 열린다", () => {
  assert.deepEqual(run([300, 300]).lines, []);
  const r = run([300, 400, 500]);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0]!.op, "open");
  assert.equal(r.lines[0]!.p99Ms, 500);
  assert.equal(r.lines[0]!.thresholdMs, 250);
  assert.equal(r.lines[0]!.windows, 3);
  assert.ok(r.st.open);
  // 넘은 상태가 이어져도 한 번만 연다
  assert.equal(run([300, 300, 300, 300, 300]).lines.length, 1);
});

test("기준과 같은 값은 넘은 것이 아니다, 중간에 한 번 기준 밑이면 연속이 끊긴다", () => {
  assert.deepEqual(run([250, 250, 250, 250]).lines, []);
  assert.deepEqual(run([300, 300, 100, 300, 300]).lines, []);
  assert.equal(run([300, 300, 100, 300, 300, 300]).lines.length, 1);
});

test("기준 밑인 구간이 오면 알림이 내려간다(close, cleared)", () => {
  const r = run([300, 300, 300, 100]);
  assert.deepEqual(
    r.lines.map((l) => [l.op, l.endedBy ?? null]),
    [["open", null], ["close", "cleared"]],
  );
  assert.equal(r.st.open, null);
  assert.equal(r.st.over, 0);
});

test("MISFIRE: 올라간 지 10분 안에 내려가면 센다, 10분 이상이면 세지 않는다", () => {
  const quick = run([300, 300, 300, 100]); // 10분에 오르고 15분에 내려감: 5분
  assert.equal(quick.lines[1]!.misfire, true);
  const slow = run([300, 300, 300, 300, 300, 100]); // 10분에 오르고 25분에 내려감: 15분
  assert.equal(slow.lines.at(-1)!.misfire, false);
  // 정확히 10분은 안이 아니다
  const ten = run([300, 300, 300, 300, 100]); // 10분에 오르고 20분에 내려감
  assert.equal(ten.lines.at(-1)!.misfire, false);
});

test("설정: 기준과 구간 수가 바뀌면 그대로 따른다", () => {
  assert.equal(run([120, 120], "on", { thresholdMs: 100, windows: 2 }).lines.length, 1);
  assert.deepEqual(run([300, 300, 300], "on", { thresholdMs: 400, windows: 3 }).lines, []);
  assert.equal(run([300], "on", { thresholdMs: 100, windows: 1 }).lines.length, 1);
});

test("스위치 off: 알림이 오르지 않고, 올라가 있던 것은 switch로 닫히며 MISFIRE로 세지 않는다", () => {
  assert.deepEqual(run([900, 900, 900, 900], "off").lines, []);
  const up = run([300, 300, 300]);
  const off = lagStep(up.st, win(900), CFG, "off", T0 + 16 * MIN);
  assert.equal(off.lines.length, 1);
  assert.equal(off.lines[0]!.endedBy, "switch");
  assert.equal(off.lines[0]!.misfire, false);
  assert.equal(off.state.open, null);
});

test("구간을 못 쟀으면(JOB TIMING off) 올라간 알림은 no-data로 닫히고 MISFIRE가 아니다, 연속도 끊긴다", () => {
  const up = run([300, 300, 300]);
  const r = lagStep(up.st, null, CFG, "on", T0 + 16 * MIN);
  assert.equal(r.lines[0]!.endedBy, "no-data");
  assert.equal(r.lines[0]!.misfire, false);
  assert.deepEqual(run([300, 300, null, 300]).lines, []);
});

test("카운터: 에피소드·닫힌 수·MISFIRE 수·몫·열림, 창 밖은 세지 않는다", () => {
  const a = run([300, 300, 300, 100]); // MISFIRE 1
  const b = run([300, 300, 300, 300, 300, 100], "on", CFG, LAG_START, T0 + 60 * MIN); // MISFIRE 아님
  const c = run([300, 300, 300], "on", CFG, LAG_START, T0 + 200 * MIN); // 열림
  const lines = [...a.lines, ...b.lines, ...c.lines];
  const now = T0 + 300 * MIN;
  const k = lagCounterOf(lines, now, 7);
  assert.equal(k.episodes, 3);
  assert.equal(k.closed, 2);
  assert.equal(k.misfires, 1);
  assert.equal(k.share, 0.5);
  assert.equal(k.open, true);
  const old = lagCounterOf(lines, now + 10 * 86_400_000, 7);
  assert.equal(old.episodes, 0);
  assert.equal(old.share, null);
  assert.equal(openLagOf(lines)?.op, "open");
  assert.equal(openLagOf(a.lines), null);
});

test("알림 글: p99·기준·연속 구간 수가 들어간다", () => {
  const t = lagLineOf({ p99Ms: 312.4, thresholdMs: 250, windows: 3 });
  assert.match(t, /312ms/);
  assert.match(t, /250ms/);
  assert.match(t, /3개 구간/);
});

// ── 측정: JOB TIMING 구간에 p99와 max가 실린다 ──
test("take: 구간에 이벤트 루프 지연이 실리고, 표본기가 없으면 null이다", () => {
  const cpu = () => ({ user: 0, system: 0 });
  let started = 0;
  const sampler: LoopSampler = { start: () => void started++, take: () => ({ p99Ms: 12, maxMs: 40 }) };
  const tm = createTimer(() => 1, cpu, sampler);
  tm.startLoop();
  assert.equal(started, 1);
  assert.deepEqual(tm.take().loop, { p99Ms: 12, maxMs: 40 });
  assert.equal(createTimer(() => 1, cpu).take().loop, null);
});

test("sumTimings: 구간들 중 가장 나빴던 p99·max를 낸다, loop가 없는 옛 줄은 건너뛴다", () => {
  const line = (loop?: { p99Ms: number; maxMs: number }): TimingLine => ({ t: "2026-10-20T12:00:00Z", kind: "job-timing", windowMs: 300_000, sources: {}, cpu: { userMs: 0, systemMs: 0 }, dropped: 0, loop });
  assert.deepEqual(sumTimings([line({ p99Ms: 10, maxMs: 90 }), line(), line({ p99Ms: 30, maxMs: 50 })]).loop, { p99Ms: 30, maxMs: 90 });
  assert.equal(sumTimings([line()]).loop, null);
});

// ── 파일: 임시 상태 폴더. config가 import 때 환경을 읽으니 먼저 정하고 동적으로 가져온다 ──
test("기록: 에피소드 줄(open·close)이 파일에 추가되고, off로 바꾸면 올라간 알림이 내려간다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-lag-"));
  const prev = process.env.ATC_STATE_DIR;
  process.env.ATC_STATE_DIR = dir;
  try {
    const lag = await import("./event-loop-lag-run.ts");
    const { config } = await import("./config.ts");
    assert.equal(config.stateDir, dir);
    assert.equal(config.eventLoopLagMs, 250);
    assert.equal(config.eventLoopLagWindows, 3);
    assert.equal(lag.loadLagSwitch(), "on");
    for (let i = 0; i < 3; i++) lag.trackLag({ p99Ms: 400, maxMs: 900 }, T0 + i * 5 * MIN);
    assert.ok(lag.lagAlertNow());
    lag.trackLag({ p99Ms: 10, maxMs: 30 }, T0 + 15 * MIN); // 10분에 오르고 15분에 내려감
    assert.equal(lag.lagAlertNow(), null);
    const read = () =>
      readFileSync(join(dir, "event-loop-lag-episodes.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
    assert.deepEqual(read().map((l) => l.op), ["open", "close"]);
    assert.equal(read()[1].misfire, true);
    for (let i = 0; i < 3; i++) lag.trackLag({ p99Ms: 400, maxMs: 900 }, T0 + (30 + i * 5) * MIN);
    assert.ok(lag.lagAlertNow());
    lag.saveLagSwitch("off");
    assert.equal(lag.loadLagSwitch(), "off");
    assert.equal(lag.lagAlertNow(), null);
    assert.equal(read().at(-1).endedBy, "switch");
    assert.equal(read().at(-1).misfire, false);
    const k = lagCounterOf(lag.readLagEpisodes(), Date.now()); // off의 close 줄은 지금 시각으로 적힌다
    assert.deepEqual([k.episodes, k.closed, k.misfires, k.open], [2, 2, 1, false]);
  } finally {
    if (prev === undefined) delete process.env.ATC_STATE_DIR;
    else process.env.ATC_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
