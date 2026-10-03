import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("timed: Promise 값은 그대로, 끝난 때 wallMs를 센다", async () => {
  const tm = createTimer(undefined, cpu);
  assert.equal(await tm.timed("p", () => Promise.resolve(7)), 7);
  const w = tm.take();
  assert.equal(w.sources.p.runs, 1);
  assert.equal(w.sources.p.wallRuns, 1);
});

test("timed: 거절은 그대로 호출한 쪽에 닿고(처리 안 한 호출은 처리 안 된 거절 그대로), 시간은 센다", async () => {
  const tm = createTimer(undefined, cpu);
  await assert.rejects(tm.timed("r", () => Promise.reject(new Error("no"))), /no/);
  assert.equal(tm.take().sources.r.wallRuns, 1);
  // void로 버린 호출은 켜도 꺼도 처리 안 된 거절이 한 번 올라온다(별도 프로세스: 시험 러너가 그 이벤트를 가로챈다)
  for (const on of [true, false]) {
    const code = `import { createTimer } from ${JSON.stringify(new URL("./job-timing.ts", import.meta.url).href)};
const t = createTimer(); t.setEnabled(${on});
let n = 0; process.on("unhandledRejection", () => n++);
void t.timed("x", () => Promise.reject(new Error("drop")));
setTimeout(() => { process.stdout.write(String(n)); }, 30);`;
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
    assert.equal(out.stdout.trim(), "1", `on=${on} ${out.stderr}`);
  }
});

test("setEnabled: 켜고 끌 때 구간을 비워 꺼져 있던 시간이 섞이지 않는다", () => {
  const tm = createTimer(clock(0, 0, 1, 100, 0, 5), cpu);
  tm.timed("a", () => 0); // since=0, t0=0, 끝=1
  tm.setEnabled(false); // 구간을 비우고 since=101
  tm.setEnabled(true); // 이미 꺼진 뒤 켠다: since=101
  assert.deepEqual(tm.take().sources, {});
});

test("span: 켜져 있을 때만 요청 하나를 센다", () => {
  const tm = createTimer(() => 1, cpu);
  tm.span("http:GET /api/x", 12);
  tm.setEnabled(false);
  tm.span("http:GET /api/y", 1);
  tm.setEnabled(true);
  tm.span("http:GET /api/z", 3);
  const w = tm.take();
  assert.deepEqual(Object.keys(w.sources), ["http:GET /api/z"]);
  assert.equal(w.sources["http:GET /api/z"].wallMs, 3);
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
