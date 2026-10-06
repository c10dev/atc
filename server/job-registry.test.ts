import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUILTIN_JOBS_DIR, createJobRunner, jobs, loadJobs, provideService, serviceOf } from "./job-registry.ts";
import type { JobContext } from "./job-def.ts";
import type { Snapshot } from "./model.ts";

// JOB REGISTRY(ATC-393): 주기로 도는 서버 일 하나는 server/jobs/ 파일 하나. 파일만 더해도 돈다.
const here = new URL(".", import.meta.url).pathname;
const SNAP = { at: "2026-10-02T00:00:00.000Z" } as unknown as Snapshot;

test("내장 일: 이름이 겹치지 않고 때는 하나씩, tick 일의 순서는 옛 index.ts의 순서와 같다", () => {
  const names = jobs.map((j) => j.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    [...jobs].filter((j) => j.tick).sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000)).map((j) => j.name),
    ["dispatch", "fleet-plan", "sample", "ticket-state", "departures", "logbook", "milestones", "standfree", "atfm", "auto-revert", "autoland", "judges", "qrh"],
  );
  assert.deepEqual(jobs.filter((j) => j.every !== undefined).map((j) => [j.name, j.every]).sort(), [["auto-approve", 60_000], ["auto-rts", 30_000], ["auto-schedule", 60_000], ["clearance-moot", 60_000], ["control-recycle", 60_000], ["control-stop-check", 60_000], ["job-liveness", 60_000], ["landing-gap", 60_000], ["orphan-flight", 60_000], ["scope-oom", 60_000], ["stale-stop", 60_000]]);
  assert.deepEqual(jobs.filter((j) => j.start).map((j) => j.name).sort(), ["readability", "skill-usage"]);
  assert.ok(BUILTIN_JOBS_DIR.endsWith("/jobs"));
});

test("server/index.ts는 일을 하나씩 적지 않는다: 일 파일을 가져오지 않고 setInterval도 없다", () => {
  const text = readFileSync(join(here, "index.ts"), "utf8");
  assert.ok(!/from "\.\/jobs\//.test(text));
  assert.ok(!/\bsetInterval\(/.test(text));
  // 옛 index.ts가 하나씩 부르던 실행 함수가 남아 있지 않다
  for (const fn of ["runDispatch(", "runFleetPlan(", "runAutoland(", "runJudges(", "runAtfm(", "runQrh(", "runLogbook(", "runMilestones(", "runStandFree(", "recordDepartures(", "runAutoApprove(", "runAutoSchedule(", "runControlRecycle(", "startReadability(", "startSkillUsage("]) assert.ok(!text.includes(fn), fn);
});

const fakeCtx = (): { ctx: JobContext; clock: { t: number }; cur: { s: Snapshot | null } } => {
  const clock = { t: 1_000_000 };
  const cur: { s: Snapshot | null } = { s: SNAP };
  return { ctx: { current: () => cur.s, now: () => clock.t, service: serviceOf }, clock, cur };
};

test("일 파일 하나만 더하면: tick 일(순서·간격), every 일(타이머), start 일(한 번)이 돈다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-jobs-"));
  const calls: string[] = [];
  (globalThis as unknown as { __jobs: string[] }).__jobs = calls;
  writeFileSync(join(dir, "a-late.ts"), `export default { name: "late", tick: {}, order: 2000, run: (_c, s) => { globalThis.__jobs.push("late:" + s.at); } };\n`);
  writeFileSync(join(dir, "b-early.ts"), `export default { name: "early", tick: {}, order: 5, run: () => { globalThis.__jobs.push("early"); } };\n`);
  writeFileSync(join(dir, "c-slow.ts"), `export default { name: "slow", tick: { everyMs: 60000 }, run: () => { globalThis.__jobs.push("slow"); } };\n`);
  writeFileSync(join(dir, "d-timer.ts"), `export default { name: "timer", every: 30000, run: (ctx, s) => { globalThis.__jobs.push("timer:" + (s ? s.at : "none") + ":" + ctx.service("answer")); } };\n`);
  writeFileSync(join(dir, "e-boot.ts"), `export default { name: "boot", start: true, run: () => { globalThis.__jobs.push("boot"); } };\n`);
  const loaded = await loadJobs([dir]);
  assert.equal(loaded.length, 5);

  provideService("answer", 42);
  const timers: { fn: () => void; ms: number; unref: number }[] = [];
  const { ctx, clock, cur } = fakeCtx();
  const runner = createJobRunner(loaded, ctx, { setInterval: (fn, ms) => { const t = { fn, ms, unref: 0 }; timers.push(t); return { unref: () => void t.unref++ }; } });

  runner.startTimers();
  assert.deepEqual(calls, ["boot"]); // start 일은 한 번
  assert.deepEqual(timers.map((t) => [t.ms, t.unref]), [[30000, 1]]); // every 일의 타이머는 unref
  timers[0]!.fn();
  assert.equal(calls.at(-1), "timer:2026-10-02T00:00:00.000Z:42");
  cur.s = null;
  timers[0]!.fn(); // 스냅샷이 아직 없어도 일은 스스로 판단한다
  assert.equal(calls.at(-1), "timer:none:42");

  calls.length = 0;
  runner.tick(SNAP, false); // 따뜻하지 않으면 아무것도 하지 않는다
  assert.deepEqual(calls, []);
  runner.tick(SNAP, true);
  assert.deepEqual(calls, ["early", "slow", "late:2026-10-02T00:00:00.000Z"]); // order 순서
  calls.length = 0;
  clock.t += 30_000;
  runner.tick(SNAP, true);
  assert.deepEqual(calls, ["early", "late:2026-10-02T00:00:00.000Z"]); // slow는 간격이 안 찼다
  clock.t += 30_000;
  runner.tick(SNAP, true);
  assert.ok((calls as string[]).includes("slow"));
});

test("tick 일이 던지면 그 주기가 멈춘다(옛 index.ts와 같다), every 일이 던지면 로그만 남는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-jobs-throw-"));
  writeFileSync(join(dir, "boom.ts"), `export default { name: "boom", tick: {}, run: () => { throw new Error("boom"); } };\n`);
  writeFileSync(join(dir, "boom-timer.ts"), `export default { name: "boom-timer", every: 1000, run: () => { throw new Error("boom2"); } };\n`);
  const { ctx } = fakeCtx();
  const timers: (() => void)[] = [];
  const runner = createJobRunner(await loadJobs([dir]), ctx, { setInterval: (fn) => (timers.push(fn), { unref: () => {} }) });
  assert.throws(() => runner.tick(SNAP, true), /boom/);
  const err = console.error;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => void logged.push(String(a[0]));
  runner.startTimers();
  timers[0]!();
  await new Promise((r) => setTimeout(r, 5));
  console.error = err;
  assert.deepEqual(logged, ["[atc] job boom-timer failed:"]);
});

test("선언이 잘못되면 어느 파일인지 적어 던진다: 때가 둘, 때가 없음, 이름이 겹침", async () => {
  const two = mkdtempSync(join(tmpdir(), "atc-jobs-two-"));
  writeFileSync(join(two, "two.ts"), `export default { name: "two", every: 1000, tick: {}, run: () => {} };\n`);
  await assert.rejects(loadJobs([two]), /two\.ts.*일\(every·tick·start 중 하나\) 선언이 아님/);
  const none = mkdtempSync(join(tmpdir(), "atc-jobs-none-"));
  writeFileSync(join(none, "none.ts"), `export default { name: "none", run: () => {} };\n`);
  await assert.rejects(loadJobs([none]), /none\.ts/);
  const dup = mkdtempSync(join(tmpdir(), "atc-jobs-dup-"));
  writeFileSync(join(dup, "x.ts"), `export default { name: "sample", tick: {}, run: () => {} };\n`);
  await assert.rejects(loadJobs([BUILTIN_JOBS_DIR, dup]), /일 이름이 겹침: sample/);
});

test("서비스: 넣은 이름으로 꺼내고, 없으면 이름을 적어 던진다", () => {
  provideService("x-test", { v: 1 });
  assert.deepEqual(serviceOf("x-test"), { v: 1 });
  assert.throws(() => serviceOf("nope-test"), /서비스가 없음: nope-test/);
});
