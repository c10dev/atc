import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { config } from "./config.ts";
import { parseAbsentSettings, type AbsentSettings } from "./control-absent.ts";
import { type AbsentDeps, absentData, absentEscalationsNow, ackAbsent, controlAbsentPass, type LastJob, loadAbsentSettings, markAbsentFalse, resetControlAbsent, saveAbsentSetting } from "./control-absent-run.ts";
import type { Snapshot } from "./model.ts";
import { readRecords } from "./recorder.ts";
import { writerModeOf, writerPlaceNow } from "./session-socket.ts";
import { isRealStateDir, realHome } from "./state-guard.ts";
import type { ControlOp } from "./supervisor-alerts.ts";

// CONTROL ABSENT(ATC-532)의 한 주기: 주입한 세션 목록·마지막 동작·증거·LAUNCH·시계만 쓴다. 시험마다 새 임시 상태 폴더(FLIGHT RECORDER)를 쓴다.
// 진짜 claude·/proc·운영 상태 폴더를 읽지 않고, 진짜 세션을 띄우지 않는다
const MIN = 60_000;
const T0 = Date.parse("2026-10-07T03:25:00Z");
const S = {} as Snapshot;
const JOB: LastJob = { id: "a1b2c3d4", launchedAt: Date.parse("2026-10-06T20:00:00Z"), account: "acct-1" };

beforeEach(() => {
  config.stateDir = mkdtempSync(join(tmpdir(), "atc-absent-"));
  resetControlAbsent();
});

interface World {
  now: number;
  present: Set<string>;
  live: Record<string, string[]>;
  ops: Map<string, ControlOp>;
  jobs: Map<string, LastJob>;
  gone: boolean; // 재부팅 증거(bootAt > launchedAt)
  cwd: number[];
  launches: string[];
  launchResult: { ok: boolean; jobId?: string; error?: string };
  production: boolean;
  auto: Record<string, boolean>;
  settings: AbsentSettings;
  rowsFail?: boolean;
}
const world = (o: Partial<World> = {}): World => ({
  now: T0,
  present: new Set(),
  live: {},
  ops: new Map([["TOWER", { t: "2026-10-06T20:00:00Z", op: "launch", by: "RECYCLE", ok: true }]]),
  jobs: new Map([["TOWER", JOB]]),
  gone: true,
  cwd: [],
  launches: [],
  launchResult: { ok: true, jobId: "ffee0011" },
  production: true,
  auto: { TOWER: true, OCC: false, MCC: true, REVIEW: true },
  settings: parseAbsentSettings(null),
  ...o,
});
const deps = (w: World, roles = ["TOWER"]): AbsentDeps => ({
  now: () => w.now,
  roles: roles.map((name) => ({ name, dir: `/repo/${name.toLowerCase()}` })),
  present: () => w.present,
  liveRows: async () => (w.rowsFail ? Promise.reject(new Error("claude agents 실패")) : (name: string) => w.live[name] ?? []),
  lastOps: () => w.ops,
  lastJobs: () => w.jobs,
  facts: () => ({ cwdPids: w.cwd, jobState: "done", workerLive: null, bootAt: w.gone ? Date.parse("2026-10-07T03:23:00Z") : null }),
  launch: async (name) => {
    w.launches.push(name);
    return w.launchResult;
  },
  recycling: () => null,
  production: () => w.production,
  auto: () => w.auto,
  settings: () => w.settings,
});
const absentLines = () => readRecords(0).flatMap((r) => (r.kind === "control" && r.op === "absent" ? [r] : []));
// 서버가 뜬 뒤 한 시간이 지난 곳에서 시작한다(서버가 뜬 직후 규칙을 빼려고)
async function warm(w: World, roles?: string[]) {
  const at = w.now;
  w.now = at - 60 * MIN;
  const p = new Set(w.present);
  w.present = new Set([...(roles ?? ["TOWER"])]);
  await controlAbsentPass(S, deps(w, roles));
  w.present = p;
  w.now = at;
}

test("25분 없음 + 사라진 증거 → 한 번만 다시 띄운다(launchControl), 다시 보이면 없음의 끝에 분을 적는다", async () => {
  const w = world();
  await warm(w);
  await controlAbsentPass(S, deps(w)); // 없음의 시작
  w.now += 25 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, ["TOWER"]);
  // 다음 주기들: 새 job이 아직 안 보여도(LAUNCH 직후 유예) 또 띄우지 않는다
  w.ops.set("TOWER", { t: new Date(w.now).toISOString(), op: "launch", by: "ABSENT", ok: true });
  w.now += MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, ["TOWER"]);
  w.present.add("TOWER");
  w.now += MIN;
  await controlAbsentPass(S, deps(w));
  const lines = absentLines();
  assert.deepEqual(lines.map((l) => (l as { event: string }).event), ["start", "relaunch", "end"]);
  const rl = lines[1] as { ok: boolean; jobId: string; lastJobId: string; proof: string };
  assert.deepEqual([rl.ok, rl.jobId, rl.lastJobId], [true, "ffee0011", "a1b2c3d4"]);
  assert.match(rl.proof, /호스트가 03:23Z에 다시 켜짐/);
  assert.equal((lines[2] as { minutes: number }).minutes, 27);
  assert.deepEqual(absentEscalationsNow(), []);
});

test("없음 + 살아 있는 증거 → 띄우지 않고 WARNING, 30분마다 새 key로 되풀이, SUPERVISOR 확인으로 그친다", async () => {
  const w = world({ cwd: [4242] });
  await warm(w);
  await controlAbsentPass(S, deps(w));
  w.now += 21 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, []);
  let open = absentEscalationsNow();
  assert.equal(open.length, 1);
  assert.deepEqual([open[0]!.session, open[0]!.n, open[0]!.minutes, open[0]!.lastJobId, open[0]!.passQuiet], ["TOWER", 1, 21, "a1b2c3d4", true]);
  assert.match(open[0]!.why, /살아 있는 증거: 관제 폴더에서 도는 프로세스 pid 4242/);
  w.now += 10 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.equal(absentEscalationsNow()[0]!.n, 1); // 30분 전에는 되풀이하지 않는다
  w.now += 20 * MIN;
  await controlAbsentPass(S, deps(w));
  open = absentEscalationsNow();
  assert.equal(open[0]!.n, 2);
  assert.equal(ackAbsent("TOWER", "SUPERVISOR", w.now), true);
  assert.deepEqual(absentEscalationsNow(), []);
  w.now += 40 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(absentEscalationsNow(), []);
  assert.deepEqual(w.launches, []);
  const events = absentLines().map((l) => (l as { event: string }).event);
  assert.deepEqual(events, ["start", "escalate", "escalate", "ack"]);
});

test("한도 전에는 아무것도 하지 않는다 · SUPERVISOR STOP은 없음으로 치지 않는다 · 스위치가 모두 off면 아무것도 하지 않는다", async () => {
  const w = world();
  await warm(w);
  await controlAbsentPass(S, deps(w));
  w.now += 19 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual([w.launches, absentEscalationsNow()], [[], []]);

  resetControlAbsent();
  config.stateDir = mkdtempSync(join(tmpdir(), "atc-absent-"));
  const st = world({ ops: new Map([["TOWER", { t: "2026-10-06T22:00:00Z", op: "stop", by: "SUPERVISOR", ok: true }]]) });
  await warm(st);
  for (let i = 0; i < 4; i++) {
    st.now += 20 * MIN;
    await controlAbsentPass(S, deps(st));
  }
  assert.deepEqual([st.launches, absentEscalationsNow(), absentLines()], [[], [], []]);

  resetControlAbsent();
  config.stateDir = mkdtempSync(join(tmpdir(), "atc-absent-"));
  const off = world({ settings: { ...parseAbsentSettings(null), relaunch: "off", escalate: "off" } });
  await warm(off);
  await controlAbsentPass(S, deps(off));
  off.now += 60 * MIN;
  await controlAbsentPass(S, deps(off));
  assert.deepEqual([off.launches, absentEscalationsNow()], [[], []]);
  assert.deepEqual(absentLines().map((l) => (l as { event: string }).event), ["start"]); // 없던 시간은 잰다
});

test("LAUNCH가 거절되면 같은 주기에 WARNING(이유는 거절 글), 다시 시도하지 않는다", async () => {
  const w = world({ launchResult: { ok: false, error: "ACCOUNT acct-1는 FUEL hold 수준: FUEL 사용 97% until 05:00Z" } });
  await warm(w);
  await controlAbsentPass(S, deps(w));
  w.now += 20 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, ["TOWER"]);
  const open = absentEscalationsNow();
  assert.equal(open.length, 1);
  assert.equal(open[0]!.why, "다시 띄우기 거절·실패: ACCOUNT acct-1는 FUEL hold 수준: FUEL 사용 97% until 05:00Z");
  w.now += 40 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, ["TOWER"]);
  assert.equal(absentEscalationsNow()[0]!.n, 2);
});

test("재부팅: 서버가 뜬 첫 판단부터 없던 TOWER·MCC·REVIEW는 2분 뒤 다시 띄우고, auto.OCC가 false인 OCC는 알림만", async () => {
  const roles = ["TOWER", "OCC", "MCC", "REVIEW"];
  const at = "2026-10-06T20:00:00Z";
  const w = world({
    ops: new Map(roles.map((r) => [r, { t: at, op: "launch", by: "ABSENT", ok: true }])),
    jobs: new Map(roles.map((r, i) => [r, { ...JOB, id: `aaaa000${i}` }])),
  });
  await controlAbsentPass(S, deps(w, roles)); // 첫 판단(서버가 뜬 직후)
  assert.deepEqual(w.launches, []);
  w.now += MIN;
  await controlAbsentPass(S, deps(w, roles));
  assert.deepEqual(w.launches, []);
  w.now += MIN;
  await controlAbsentPass(S, deps(w, roles));
  assert.deepEqual(w.launches, ["TOWER", "MCC", "REVIEW"]);
  const open = absentEscalationsNow();
  assert.deepEqual(open.map((e) => [e.session, e.why]), [["OCC", "control-recycle.json auto.OCC가 false — 알림만"]]);
  assert.ok(absentLines().filter((l) => (l as { event: string }).event === "relaunch").every((l) => (l as { startup?: boolean }).startup === true));
});

test("운영 서버가 아니면 띄우지 않는다(알림만) · 지금 이 시험 프로세스는 운영 서버가 아니다(7700·운영 상태 폴더·node --test 아님만)", async () => {
  const w = world({ production: false });
  await warm(w);
  await controlAbsentPass(S, deps(w));
  w.now += 25 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, []);
  assert.match(absentEscalationsNow()[0]!.why, /운영 서버가 아님/);
  // jobs/control-absent.ts가 쓰는 판정: writerModeOf(writerPlaceNow()) === "production"
  assert.notEqual(writerModeOf(writerPlaceNow()), "production");
  const home = realHome();
  const prod = { port: 7700, stateDir: join(home, ".local/state/atc"), home, test: false, env: {}, tmp: tmpdir() };
  assert.ok(isRealStateDir(prod.stateDir, home));
  assert.equal(writerModeOf(prod), "production");
  assert.equal(writerModeOf({ ...prod, port: 7702 }), null); // 시험 서버
  assert.equal(writerModeOf({ ...prod, stateDir: config.stateDir }), null); // 임시 상태 폴더
  assert.equal(writerModeOf({ ...prod, test: true }), null); // node --test
  assert.notEqual(writerModeOf({ ...prod, port: 7702, env: { ATC_SERVER_SEND_TEST: "1" } }), "production"); // 시험 opt-in도 관제 세션을 띄우지 않는다
});

test("claude agents를 못 읽으면 띄우지 않는다 · RECYCLE 중인 세션은 건너뛴다 · 살아 있는 줄이 있으면 없음이 아니다", async () => {
  const w = world({ rowsFail: true });
  await warm(w);
  await controlAbsentPass(S, deps(w));
  w.now += 25 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, []);
  assert.match(absentEscalationsNow()[0]!.why, /claude agents를 읽지 못함/);

  resetControlAbsent();
  config.stateDir = mkdtempSync(join(tmpdir(), "atc-absent-"));
  const r = world();
  await warm(r);
  const d = { ...deps(r), recycling: () => "TOWER" };
  for (let i = 0; i < 3; i++) {
    r.now += 20 * MIN;
    await controlAbsentPass(S, d);
  }
  assert.deepEqual([r.launches, absentLines()], [[], []]);

  resetControlAbsent();
  config.stateDir = mkdtempSync(join(tmpdir(), "atc-absent-"));
  const l = world({ live: { TOWER: ["9f00aa"] } });
  await warm(l);
  l.now += 30 * MIN;
  await controlAbsentPass(S, deps(l));
  assert.deepEqual([l.launches, absentLines()], [[], []]);
});

test("서버를 다시 켜면 열린 없음을 FLIGHT RECORDER에서 되살리고 서버가 뜬 직후 규칙으로 한 번 더 띄워 본다 · 오탐 표시는 알림을 걷고 센다", async () => {
  const w = world({ cwd: [7] });
  await warm(w);
  await controlAbsentPass(S, deps(w));
  w.now += 20 * MIN;
  await controlAbsentPass(S, deps(w));
  const esc = absentLines().find((l) => (l as { event: string }).event === "escalate")!;
  // 서버 재시작: 기억이 비고, 증거가 사라짐(프로세스 없음 + 재부팅)
  resetControlAbsent();
  w.cwd = [];
  w.now += 5 * MIN;
  await controlAbsentPass(S, deps(w));
  w.now += 2 * MIN;
  await controlAbsentPass(S, deps(w));
  assert.deepEqual(w.launches, ["TOWER"]);
  // 오탐 표시
  assert.equal(markAbsentFalse(esc.t, "MCC", "SUPERVISOR", w.now), false); // 같은 t라도 다른 세션의 줄은 아니다
  assert.equal(markAbsentFalse(esc.t, "TOWER", "SUPERVISOR", w.now), true);
  assert.equal(markAbsentFalse("2020-01-01T00:00:00.000Z", "TOWER", "SUPERVISOR", w.now), false);
  const d = absentData(w.now);
  assert.equal(d.last7d.falseEscalations, 1);
  assert.equal(d.last7d.relaunches, 1);
  assert.equal(d.recent.find((x) => x.event === "escalate")?.marked, true);
});

test("설정 저장: 한 칸만 바꾸고 바뀐 것만 policy 줄", () => {
  const file = join(mkdtempSync(join(tmpdir(), "atc-absent-set-")), "control-absent.json");
  saveAbsentSetting("quietPass", "off", "SUPERVISOR", file);
  saveAbsentSetting("limitMin", 45, "SUPERVISOR", file);
  assert.deepEqual(loadAbsentSettings(file), { relaunch: "on", escalate: "on", quietPass: "off", limitMin: 45 });
  assert.deepEqual(loadAbsentSettings(), parseAbsentSettings(null)); // 이 시험 상태 폴더의 파일은 그대로
});
