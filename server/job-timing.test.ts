import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTimer, MAX_SOURCES, parseJobTimingSwitch, sumTimings, type TimingLine } from "./job-timing.ts";

const clock = (...steps: number[]) => {
  let t = 0;
  const q = [...steps];
  return () => (t += q.shift() ?? 0);
};
const cpu = () => ({ user: 0, system: 0 });

test("timed: 동기 시간을 재고 값은 그대로 돌려준다", () => {
  const tm = createTimer(clock(0, 0, 5), cpu); // since, t0, 끝(+5)
  assert.equal(tm.timed("a", () => 42), 42);
  const w = tm.take();
  assert.equal(w.sources.a.runs, 1);
  assert.equal(w.sources.a.ms, 5);
  assert.equal(w.sources.a.wallRuns, 0);
});

test("timed: 던져도 시간은 세고 그대로 던진다", () => {
  const tm = createTimer(() => 1, cpu);
  assert.throws(() => tm.timed("boom", () => { throw new Error("x"); }), /x/);
  assert.equal(tm.take().sources.boom.runs, 1);
});

test("timed: Promise는 같은 Promise를 돌려주고 끝난 때 wallMs를 센다, 거절해도 센다", async () => {
  const tm = createTimer(undefined, cpu);
  const p = Promise.resolve(7);
  assert.equal(tm.timed("p", () => p), p);
  await p;
  await assert.rejects(tm.timed("r", () => Promise.reject(new Error("no"))), /no/);
  await new Promise((r) => setImmediate(r));
  const w = tm.take();
  assert.equal(w.sources.p.wallRuns, 1);
  assert.equal(w.sources.r.wallRuns, 1);
});

test("꺼져 있으면 재지 않고 fn만 돈다", () => {
  const tm = createTimer(() => 1, cpu);
  tm.setEnabled(false);
  assert.equal(tm.timed("a", () => "v"), "v");
  assert.deepEqual(tm.take().sources, {});
  assert.equal(tm.runsInWindow(), 0);
});

test("출처가 한도를 넘으면 새 이름은 버리고 dropped를 센다, 있던 이름은 계속 센다", () => {
  const tm = createTimer(() => 1, cpu);
  for (let i = 0; i < MAX_SOURCES + 3; i++) tm.timed(`s${i}`, () => 0);
  tm.timed("s0", () => 0);
  const w = tm.take();
  assert.equal(Object.keys(w.sources).length, MAX_SOURCES);
  assert.equal(w.dropped, 3);
  assert.equal(w.sources.s0.runs, 2);
  assert.equal(tm.take().dropped, 3); // 누적
});

test("take: 구간을 비우고 CPU 차를 ms로 돌려준다", () => {
  let c = { user: 0, system: 0 };
  const tm = createTimer(() => 10, () => c);
  tm.timed("a", () => 0);
  c = { user: 4_000, system: 1_500 }; // µs
  const w = tm.take();
  assert.deepEqual(w.cpu, { userMs: 4, systemMs: 2 });
  assert.deepEqual(tm.take().sources, {});
});

test("sumTimings: 구간을 더하고 최대는 최대로", () => {
  const s = (runs: number, ms: number, maxMs: number) => ({ runs, ms, maxMs, wallRuns: 0, wallMs: 0, wallMaxMs: 0 });
  const line = (sources: TimingLine["sources"], dropped: number): TimingLine => ({ t: "x", kind: "job-timing", windowMs: 1000, sources, cpu: { userMs: 10, systemMs: 5 }, dropped });
  const sum = sumTimings([line({ a: s(2, 4, 3) }, 0), line({ a: s(1, 9, 9), b: s(1, 1, 1) }, 2)]);
  assert.deepEqual(sum.sources.a, s(3, 13, 9));
  assert.equal(sum.windowMs, 2000);
  assert.deepEqual(sum.cpu, { userMs: 20, systemMs: 10 });
  assert.equal(sum.dropped, 2);
});

test("parseJobTimingSwitch: off만 off, 나머지는 기본 on", () => {
  assert.equal(parseJobTimingSwitch("off"), "off");
  assert.equal(parseJobTimingSwitch("on"), "on");
  assert.equal(parseJobTimingSwitch(undefined), "on");
  assert.equal(parseJobTimingSwitch("OFF"), "on");
});

test("flush·스위치 파일: 임시 폴더에서 한 줄을 적고, 쓰지 못하면 dropped, 꺼지면 쓰지 않는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-jt-"));
  process.env.ATC_STATE_DIR = dir; // config가 import할 때 읽는다(운영 상태 폴더를 읽지 않도록 먼저 정한다)
  try {
    const run = await import("./job-timing-run.ts");
    const { jobTimer } = await import("./job-timing.ts");
    jobTimer.setEnabled(true);
    jobTimer.take();
    jobTimer.timed("t:one", () => 1);
    const out = join(dir, "jt");
    assert.equal(run.flushTimings(Date.parse("2026-10-03T00:00:00Z"), out), true);
    const lines = run.readTimingLines(Date.parse("2026-10-02T00:00:00Z"), out);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].sources["t:one"].runs, 1);
    // 쓰지 못하는 곳(파일이 있는 자리를 폴더로 쓰려 함)
    writeFileSync(join(dir, "blocked"), "x");
    jobTimer.timed("t:two", () => 1);
    assert.equal(run.flushTimings(Date.now(), join(dir, "blocked", "sub")), false);
    assert.equal(jobTimer.take().dropped, 1);
    // 스위치 파일
    const sw = join(dir, "job-timing.json");
    assert.equal(run.loadJobTimingSwitch(sw), "on");
    run.saveJobTimingSwitch("off", "test", sw);
    assert.equal(JSON.parse(readFileSync(sw, "utf8")).mode, "off");
    assert.equal(run.loadJobTimingSwitch(sw), "off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
