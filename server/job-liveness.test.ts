import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AutoLine } from "./auto-approve.ts";
import { type AutoDeps, type AutoIO, runApprovedRelaunch } from "./auto-approve-run.ts";
import { absentOf } from "./dispatch-launch.ts";
import { DEFAULT_DISPATCH_CONFIG, type DispatchConfig } from "./dispatch.ts";
import { loadLivenessSwitch, procAlive, proofOfSession, readRoster } from "./job-liveness-io.ts";
import { countsOf, initDeathHoldOf, initDeathOf, jobGoneWhyOf, jobProofOf, type LivenessLine, parseLivenessSwitch, rosterOf, type Worker } from "./job-liveness.ts";
import type { Snapshot } from "./model.ts";
import { approvedNoSessionOf, fold, type Op } from "./proposals.ts";

// ATC-534: TEAM_B의 job은 IN SERVICE 한 줄만 쓰고 죽었는데 FLEET는 idle로 보였고, 승인된 카드는 보낼 곳 없이 기다렸다.
const NOW = Date.parse("2026-10-04T14:05:00.000Z");
const MIN = 60_000;
const w = (pid: number, procStart: string | null = "1"): Worker => ({ pid, procStart });
const rosterWith = (jobs: Record<string, Worker>, supervisorPid: number | null = 1) => ({ supervisorPid, workers: new Map(Object.entries(jobs)) });

test("rosterOf: workers만 읽고 모르는 모양은 null(증거 없음)", () => {
  const r = rosterOf({ proto: 1, supervisorPid: 7, workers: { abc12345: { pid: 5, procStart: "99", cwd: "/x" }, bad: { pid: "x" }, nope: null } });
  assert.equal(r?.supervisorPid, 7);
  assert.deepEqual([...(r?.workers ?? [])], [["abc12345", { pid: 5, procStart: "99" }]]);
  assert.equal(rosterOf(null), null);
  assert.equal(rosterOf({ workers: [] }), null);
  assert.equal(rosterOf({}), null);
});

test("프로세스가 없으면 state 파일이 새로워도 gone이다", () => {
  const input = { jobId: "c528fe7b", roster: rosterWith({}), workerAlive: () => false, sessionVerified: false };
  assert.equal(jobProofOf(input), "gone");
  // roster에 줄은 있는데 그 pid가 없다
  assert.equal(jobProofOf({ ...input, roster: rosterWith({ c528fe7b: w(5) }) }), "gone");
});

test("프로세스가 있으면 지금처럼(live): roster의 worker 또는 확인된 세션 pid", () => {
  const base = { jobId: "c528fe7b", workerAlive: () => true, sessionVerified: false };
  assert.equal(jobProofOf({ ...base, roster: rosterWith({ c528fe7b: w(5) }) }), "live");
  assert.equal(jobProofOf({ ...base, roster: rosterWith({}), workerAlive: () => false, sessionVerified: true }), "live"); // roster가 늦어도 확인된 pid가 있으면 살아 있다
});

test("roster를 못 믿으면 unknown(지금 규칙으로 물러난다)", () => {
  assert.equal(jobProofOf({ jobId: "c528fe7b", roster: null, workerAlive: () => false, sessionVerified: false }), "unknown");
  assert.equal(jobProofOf({ jobId: "c528fe7b", roster: null, workerAlive: () => false, sessionVerified: true }), "live");
});

test("jobGoneWhyOf: `job gone (last state 13:16Z)`, 시각을 모르면 시각 없이", () => {
  assert.equal(jobGoneWhyOf("2026-10-04T13:16:44.000Z"), "job gone (last state 13:16Z)");
  assert.equal(jobGoneWhyOf(null), "job gone");
  assert.equal(jobGoneWhyOf("nope"), "job gone");
});

test("init에서 죽은 LAUNCH: IN SERVICE 한 줄 뒤 아무것도 못 쓰고 프로세스가 없다", () => {
  const launchedAt = NOW - 49 * MIN;
  const base = { launchedAt, entries: 1, lastWriteAt: launchedAt + 44_000, gone: true };
  assert.equal(initDeathOf(base), true); // TEAM_B: 13:16:00 LAUNCH, 13:16:44 마지막 줄
  assert.equal(initDeathOf({ ...base, gone: false }), false); // 프로세스가 있다
  assert.equal(initDeathOf({ ...base, entries: 5 }), false); // 일을 시작했다
  assert.equal(initDeathOf({ ...base, lastWriteAt: launchedAt + 30 * MIN }), false); // 한참 뒤에 쓴 것은 init이 아니다
  assert.equal(initDeathOf({ ...base, lastWriteAt: null }), false);
  assert.equal(initDeathOf({ ...base, lastWriteAt: launchedAt - 1 }), false); // 이 LAUNCH의 줄이 아니다
});

test("init에서 연달아 죽으면 서버가 또 자동으로 띄우지 않는다. 사람이 띄운 LAUNCH는 막지 않는다", () => {
  const dead = new Set(["j1", "j2"]);
  const t = (jobId: string, by: string, n: number) => ({ t: new Date(NOW + n).toISOString(), jobId, by });
  assert.equal(initDeathHoldOf([t("j1", "auto", 1), t("j2", "auto", 2)], dead), true);
  assert.equal(initDeathHoldOf([t("j2", "auto", 2)], dead), false); // 한 번 죽었다: 다시 한 번은 띄운다
  assert.equal(initDeathHoldOf([t("j1", "auto", 1), t("j2", "SUPERVISOR", 2)], dead), false); // 가장 최근을 사람이 띄웠다
  assert.equal(initDeathHoldOf([t("j1", "auto", 1), t("j9", "auto", 2)], dead), false); // 가장 최근은 init을 넘겼다
  assert.equal(initDeathHoldOf([], dead), false);
});

test("스위치 값: 없거나 모르는 값은 on, off만 끈다", () => {
  assert.equal(parseLivenessSwitch(undefined), "on");
  assert.equal(parseLivenessSwitch("garbage"), "on");
  assert.equal(parseLivenessSwitch("off"), "off");
});

test("오작동 수: 이 검사 때문에 다시 띄우거나 넘긴 카드(relaunch + handoff)", () => {
  const l = (op: LivenessLine["op"], n: number): LivenessLine => ({ t: new Date(NOW - n * MIN).toISOString(), kind: "job-liveness", op, registration: "TEAM_B" });
  const c = countsOf([l("gone", 1), l("init-death", 1), l("relaunch", 2), l("handoff", 3), l("handoff", 4), l("hold", 5), l("relaunch", 60 * 24 * 10)], NOW - 7 * 86_400_000, NOW + 1);
  assert.deepEqual(c, { gone: 1, initDeath: 1, relaunch: 1, handoff: 2, hold: 1, misfires: 3 });
});

test("absent: 그 LAUNCH의 job이 사라졌다고 읽은 사유가 붙는다", () => {
  const launches = new Map([["TEAM_B", { t: "2026-10-04T13:16:00.000Z", jobId: "c528fe7b" }]]);
  const input = { liveRegs: new Set<string>(), restarting: new Set<string>(), registered: new Set(["TEAM_B"]), retired: new Set<string>() };
  const [a] = absentOf(launches, input, () => null, () => null, (_r, id) => (id === "c528fe7b" ? "job gone (last state 13:16Z)" : null));
  assert.equal(a?.jobGone, "job gone (last state 13:16Z)");
  assert.equal(absentOf(launches, input)[0]?.jobGone, undefined);
});

// ── 서버가 읽는 증거(임시 폴더) ──
const startOf = (pid: number) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
};
function daemonDir(workers: Record<string, { pid: number; procStart: string }>, supervisorPid: number | null = process.pid) {
  const dir = mkdtempSync(join(tmpdir(), "atc-liveness-"));
  mkdirSync(join(dir, "daemon"));
  writeFileSync(join(dir, "daemon", "roster.json"), JSON.stringify({ proto: 1, supervisorPid, workers }));
  return dir;
}

test("proofOfSession: roster의 worker가 살아 있으면 live, 없고 pid 증거도 없으면 gone, daemon이 죽었으면 unknown", () => {
  const me = { pid: process.pid, procStart: startOf(process.pid) };
  const session = (over: Record<string, unknown> = {}) => ({ kind: "bg", jobId: "c528fe7b", pid: 999_999_001, procStart: "1", ...over });
  const live = daemonDir({ c528fe7b: me });
  const none = daemonDir({});
  const dead = daemonDir({}, 999_999_002);
  try {
    assert.equal(proofOfSession(session(), live), "live");
    assert.equal(proofOfSession(session(), none), "gone"); // 세션 파일 pid도 없다
    assert.equal(proofOfSession(session({ pid: process.pid, procStart: me.procStart }), none), "live"); // 확인된 세션 pid
    assert.equal(proofOfSession(session({ pid: process.pid, procStart: "1" }), none), "gone"); // pid가 재사용됐다(procStart 다름)
    assert.equal(proofOfSession(session({ pid: process.pid, procStart: undefined }), none), "gone"); // procStart 없이는 확인하지 못한다
    assert.equal(proofOfSession(session(), dead), "unknown");
    assert.equal(proofOfSession(session(), join(tmpdir(), "no-such-dir")), "unknown");
    assert.equal(proofOfSession(session({ kind: "interactive" }), none), "unknown");
    assert.equal(readRoster(none)?.workers.size, 0);
  } finally {
    for (const d of [live, none, dead]) rmSync(d, { recursive: true, force: true });
  }
});

test("procAlive: procStart까지 맞아야 같은 프로세스", () => {
  assert.equal(procAlive(process.pid), true);
  assert.equal(procAlive(process.pid, startOf(process.pid)), true);
  assert.equal(procAlive(process.pid, "1"), false);
  assert.equal(procAlive(999_999_003), false);
});

test("loadLivenessSwitch: 파일이 없거나 깨졌으면 on, off를 쓰면 off", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-liveness-"));
  try {
    assert.equal(loadLivenessSwitch(join(dir, "none.json")), "on");
    writeFileSync(join(dir, "bad.json"), "{");
    assert.equal(loadLivenessSwitch(join(dir, "bad.json")), "on");
    writeFileSync(join(dir, "off.json"), JSON.stringify({ mode: "off" }));
    assert.equal(loadLivenessSwitch(join(dir, "off.json")), "off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 승인된 카드의 길(ATC-388) ──
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const cfgOf = (over: Partial<DispatchConfig> = {}): DispatchConfig => ({ ...DEFAULT_DISPATCH_CONFIG, mode: "approval", ...over });
const d0764 = (approvedMinAgo: number): Op[] => [
  { op: "create", id: "D-0764", at: iso(approvedMinAgo + 20), kind: "ASSIGN", flight: "VOC-379", aircraft: null, aircraftName: "TEAM_B", airport: "VCDO", score: 1, factors: [] } as Op,
  { op: "approve", id: "D-0764", at: iso(approvedMinAgo) },
];
const goneB = { name: "TEAM_B", status: "dead", jobId: "c528fe7b", jobGone: "job gone (last state 13:16Z)" };
const absentB = { registration: "TEAM_B", launchedAt: iso(49), jobId: "c528fe7b", cut: null, jobGone: "job gone (last state 13:16Z)" };
const snap = (over: Record<string, unknown> = {}) => ({ sessions: [goneB], fuel: {}, absent: [absentB], ...over }) as unknown as Snapshot;

interface Fake {
  io: AutoIO;
  ops: Op[];
  lines: AutoLine[];
  notes: string[];
}
function fake(cfg: DispatchConfig, base: Op[], hold = false): Fake {
  const st: Fake = { ops: [...base], lines: [], notes: [], io: null as unknown as AutoIO };
  st.io = {
    cfg: () => cfg,
    proposals: () => fold(st.ops),
    scheduleOps: () => [],
    scheduleMode: () => "approval",
    lines: () => st.lines,
    addLine: (l) => st.lines.push(l),
    appendOps: (ops) => void st.ops.push(...ops),
    approveSchedule: () => {},
    stamp: () => new Date(NOW).toISOString(),
    liveness: (op, reg, proposal) => st.notes.push(`${op} ${reg} ${proposal}`),
    initHold: () => hold,
  };
  return st;
}
const launcher = () => {
  const calls: unknown[][] = [];
  const deps: AutoDeps = { max: 6, launch: async (...a) => (calls.push(a.slice(1)), { ok: true, jobId: "j2" }) };
  return { deps, calls };
};

test("approvedNoSessionOf: job이 사라진 AIRCRAFT의 승인된 카드를 센다(waiting과 jobGone)", () => {
  const cards = fold(d0764(30));
  const r = approvedNoSessionOf(cards, snap(), NOW, 15);
  assert.deepEqual([r.waiting, r.jobGone, r.overdue], [1, 1, 1]);
  // 그 job이 살아 있으면(roster에 증거) 지금과 같다: 센 것이 없다
  const alive = approvedNoSessionOf(cards, { sessions: [{ name: "TEAM_B", status: "idle" }] } as unknown as Snapshot, NOW, 15);
  assert.deepEqual([alive.waiting, alive.jobGone], [0, 0]);
});

test("사라진 job의 승인된 카드: 서버가 다시 LAUNCH하고 센다(relaunch)", async () => {
  const f = fake(cfgOf(), d0764(5));
  const { deps, calls } = launcher();
  const r = await runApprovedRelaunch(snap(), deps, NOW, f.io);
  assert.deepEqual(r, { relaunched: 1, closed: 0, waiting: 0 });
  assert.deepEqual(calls, [["TEAM_B", "D-0764", false, "VOC-379"]]);
  assert.deepEqual(f.notes, ["relaunch TEAM_B D-0764"]);
});

test("job이 사라진 카드가 LAUNCH하지 못하면 approvedWaitMin 뒤 닫아 다른 AIRCRAFT로 넘긴다(handoff). init에서 연달아 죽었으면 LAUNCH를 시도하지 않는다", async () => {
  const f = fake(cfgOf(), d0764(5), true);
  const { deps, calls } = launcher();
  assert.deepEqual(await runApprovedRelaunch(snap(), deps, NOW, f.io), { relaunched: 0, closed: 0, waiting: 1 }); // 아직 기다린다
  assert.deepEqual(calls, []);
  const late = fake(cfgOf(), d0764(30), true);
  assert.deepEqual(await runApprovedRelaunch(snap(), deps, NOW, late.io), { relaunched: 0, closed: 1, waiting: 0 });
  assert.deepEqual(calls, []);
  const p = late.io.proposals().find((x) => x.id === "D-0764")!;
  assert.equal(p.status, "superseded");
  assert.match(p.reason ?? "", /^승인 뒤 세션 없음 \(job gone \(last state 13:16Z\)\) — LAUNCH 못 함\(init-death\)/);
  assert.deepEqual(late.notes, ["handoff TEAM_B D-0764"]);
});

test("job 사라짐이 아닌 absent는 센 것이 없다(오작동 수에 들지 않는다)", async () => {
  const f = fake(cfgOf(), d0764(5));
  const { deps } = launcher();
  const plain = { ...absentB };
  delete (plain as { jobGone?: string }).jobGone;
  await runApprovedRelaunch(snap({ sessions: [], absent: [plain] }), deps, NOW, f.io);
  assert.deepEqual(f.notes, []);
});
