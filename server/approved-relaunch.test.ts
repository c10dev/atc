import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AutoLine } from "./auto-approve.ts";
import { type AutoDeps, type AutoIO, runApprovedRelaunch } from "./auto-approve-run.ts";
import { DEFAULT_DISPATCH_CONFIG, type DispatchConfig, loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";
import { APPROVED_NO_SESSION_WHY, approvedNoSessionOf, fold, type Op } from "./proposals.ts";

// ATC-388, D-0441: TEAM_K에게 승인한 ASSIGN 카드가, 승인 때 TEAM_K가 ABSENT(세션 없음)여서 LAUNCH도 전달도 없이 approved로 남았다.
const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

const cfgOf = (over: Partial<DispatchConfig> = {}): DispatchConfig => ({ ...DEFAULT_DISPATCH_CONFIG, mode: "approval", ...over });
const d0441 = (approvedMinAgo: number, reg = "TEAM_K"): Op[] => [
  { op: "create", id: "D-0441", at: iso(approvedMinAgo + 20), kind: "ASSIGN", flight: "ATC-441", aircraft: null, aircraftName: reg, airport: "ATCC", score: 1, factors: [] } as Op,
  { op: "approve", id: "D-0441", at: iso(approvedMinAgo) },
];
const absentK = { registration: "TEAM_K", launchedAt: iso(600), jobId: null, cut: null };
const snapshot = (over: Record<string, unknown> = {}) => ({ sessions: [], fuel: {}, absent: [absentK], ...over }) as unknown as Snapshot;
const bg = (name: string) => ({ name, status: "busy", origin: "background" });

interface Fake {
  io: AutoIO;
  ops: Op[];
  lines: AutoLine[];
}
function fake(cfg: DispatchConfig, base: Op[], lines: AutoLine[] = []): Fake {
  const state: Fake = { ops: [...base], lines: [...lines], io: null as unknown as AutoIO };
  state.io = {
    cfg: () => cfg,
    proposals: () => fold(state.ops),
    scheduleOps: () => [],
    scheduleMode: () => "approval",
    lines: () => state.lines,
    addLine: (l) => state.lines.push(l),
    appendOps: (ops) => void state.ops.push(...ops),
    approveSchedule: () => {},
    stamp: () => new Date(NOW).toISOString(),
  };
  return state;
}
const launcher = (result: { ok: boolean; jobId?: string; error?: string } = { ok: true, jobId: "j1" }) => {
  const calls: unknown[][] = [];
  const deps: AutoDeps = { max: 6, launch: async (...a) => (calls.push(a.slice(1)), result) };
  return { deps, calls };
};
const card = (f: Fake) => f.io.proposals().find((p) => p.id === "D-0441")!;

test("D-0441: 승인된 ASSIGN의 AIRCRAFT가 ABSENT면 서버가 launch 카드로 바꿔 LAUNCH한다(스위치와 상관없이)", async () => {
  const f = fake(cfgOf({ autoDispatch: "off", autoApprove: "off", autoApproveLaunch: "off" }), d0441(5));
  const { deps, calls } = launcher();
  const r = await runApprovedRelaunch(snapshot(), deps, NOW, f.io);
  assert.deepEqual(r, { relaunched: 1, closed: 0, waiting: 0 });
  assert.deepEqual(calls, [["TEAM_K", "D-0441", false, "ATC-441"]]);
  const p = card(f);
  assert.equal(p.status, "approved"); // 닫지 않는다: 새 세션이 뜨면 FLIGHT PLAN이 간다
  assert.equal(p.launch, true);
  assert.deepEqual([p.launched?.ok, p.launched?.by, p.launched?.jobId], [true, "auto", "j1"]);
  assert.deepEqual(f.lines.map((l) => [l.kind, l.op, l.id, l.registration, l.ok]), [["dispatch", "launch", "D-0441", "TEAM_K", true]]);
  // 두 번째 주기: 이미 launch 카드라 다시 띄우지 않는다
  assert.equal((await runApprovedRelaunch(snapshot(), deps, NOW, f.io)).relaunched, 0);
  assert.equal(calls.length, 1);
});

test("LAUNCH가 실패하면 카드를 닫고 사유를 남긴다(FLIGHT는 planner로 돌아간다)", async () => {
  const f = fake(cfgOf(), d0441(5));
  const { deps } = launcher({ ok: false, error: "이미 떠 있음(bg abcdef)" });
  const r = await runApprovedRelaunch(snapshot(), deps, NOW, f.io);
  assert.equal(r.relaunched, 1);
  const p = card(f);
  assert.equal(p.status, "superseded");
  assert.match(p.reason ?? "", /^LAUNCH 실패 — 이미 떠 있음/);
  assert.equal(p.launched?.ok, false);
});

test("살아 있는 세션이 있거나 RESTARTING이면 건드리지 않는다", async () => {
  const { deps, calls } = launcher();
  const live = fake(cfgOf(), d0441(5));
  assert.deepEqual(await runApprovedRelaunch(snapshot({ sessions: [bg("TEAM_K")] }), deps, NOW, live.io), { relaunched: 0, closed: 0, waiting: 0 });
  const restarting = fake(cfgOf(), d0441(5));
  assert.deepEqual(await runApprovedRelaunch(snapshot({ restarting: [{ registration: "TEAM_K" }] }), deps, NOW, restarting.io), { relaunched: 0, closed: 0, waiting: 0 });
  assert.equal(calls.length, 0);
  assert.equal(card(live).launch, undefined);
});

test("상한에 걸리면 기다리다 approvedWaitMin 뒤 닫는다(ATC_MAX_LAUNCHED)", async () => {
  const full = snapshot({ sessions: ["TEAM_A", "TEAM_B", "TEAM_C", "TEAM_D", "TEAM_E", "TEAM_F"].map(bg) });
  const { deps, calls } = launcher();
  const young = fake(cfgOf(), d0441(5));
  assert.deepEqual(await runApprovedRelaunch(full, deps, NOW, young.io), { relaunched: 0, closed: 0, waiting: 1 });
  assert.equal(card(young).status, "approved");
  const old = fake(cfgOf(), d0441(DEFAULT_DISPATCH_CONFIG.approvedWaitMin + 1));
  assert.deepEqual(await runApprovedRelaunch(full, deps, NOW, old.io), { relaunched: 0, closed: 1, waiting: 0 });
  const p = card(old);
  assert.equal(p.status, "superseded");
  assert.ok((p.reason ?? "").startsWith(APPROVED_NO_SESSION_WHY));
  assert.match(p.reason ?? "", /cap-full/);
  assert.equal(calls.length, 0);
});

test("FUEL hold·LAUNCH 막힘·실패 뒤 대기·하루 LAUNCH 상한·LIMIT cut·띄운 적 없는 AIRCRAFT는 띄우지 않는다", async () => {
  const hold = cfgOf({ fuel: { ...DEFAULT_DISPATCH_CONFIG.fuel, hold: true } });
  const tries: [string, DispatchConfig, Snapshot, AutoLine[], RegExp][] = [
    ["fuel", hold, snapshot({ fuel: { TEAM_K: { top: { pct: 97, resetsAt: iso(-60) } } } }), [], /fuel-hold/],
    ["stuck", cfgOf(), snapshot({ absent: [{ ...absentK, stuck: { jobId: "abcdef", at: iso(3), state: "working" } }] }), [], /stuck/],
    ["daily", cfgOf({ autoLaunchMax: 1 }), snapshot(), [{ at: iso(10), mode: "on", kind: "dispatch", op: "launch", id: "D-0001" }], /launch-daily-cap/],
    ["limit", cfgOf(), snapshot({ absent: [{ ...absentK, cut: { sessionId: "s", cutAt: iso(30), resetsAt: iso(-120), report: null } }] }), [], /limit/],
    ["never launched", cfgOf(), snapshot({ absent: [] }), [], /no-absent/],
  ];
  for (const [name, cfg, snap, lines, why] of tries) {
    const { deps, calls } = launcher();
    const f = fake(cfg, d0441(DEFAULT_DISPATCH_CONFIG.approvedWaitMin + 1), lines);
    const r = await runApprovedRelaunch(snap, deps, NOW, f.io);
    assert.deepEqual(r, { relaunched: 0, closed: 1, waiting: 0 }, name);
    assert.equal(calls.length, 0, name);
    assert.match(card(f).reason ?? "", why, name);
  }
});

test("최근 LAUNCH가 실패한 REGISTRATION은 쉰다(실패 뒤 대기)", async () => {
  const failed: Op[] = [
    { op: "create", id: "D-0400", at: iso(40), kind: "ASSIGN", flight: "ATC-400", aircraft: null, aircraftName: "TEAM_K", airport: "ATCC", score: 1, factors: [], launch: true } as Op,
    { op: "approve", id: "D-0400", at: iso(38) },
    { op: "supersede", id: "D-0400", at: iso(10), reason: "LAUNCH 실패 — 이미 떠 있음(bg abcdef)" },
  ];
  const { deps, calls } = launcher();
  const f = fake(cfgOf(), [...failed, ...d0441(5)]);
  assert.deepEqual(await runApprovedRelaunch(snapshot(), deps, NOW, f.io), { relaunched: 0, closed: 0, waiting: 1 });
  assert.equal(calls.length, 0);
});

test("DISPATCH가 approval 모드가 아니면 아무것도 하지 않는다", async () => {
  const { deps, calls } = launcher();
  const f = fake(cfgOf({ mode: "shadow" }), d0441(60));
  assert.deepEqual(await runApprovedRelaunch(snapshot(), deps, NOW, f.io), { relaunched: 0, closed: 0, waiting: 0 });
  assert.equal(calls.length, 0);
});

test("세지는 수: 기다리는 카드, 시간이 지난 카드, 지난 24시간에 이 사유로 닫은 카드", async () => {
  const wait = DEFAULT_DISPATCH_CONFIG.approvedWaitMin;
  const closed = fold([
    ...d0441(wait + 20),
    { op: "supersede", id: "D-0441", at: iso(30), reason: `${APPROVED_NO_SESSION_WHY} — LAUNCH 못 함(cap-full)` },
    ...(d0441(wait + 5, "TEAM_M").map((o) => ({ ...o, id: "D-0450" })) as Op[]),
    ...(d0441(2, "TEAM_N").map((o) => ({ ...o, id: "D-0451" })) as Op[]),
  ]);
  const n = approvedNoSessionOf(closed, { sessions: [] } as unknown as Snapshot, NOW, wait);
  assert.deepEqual([n.waiting, n.overdue, n.closed24h, n.waitMin], [2, 1, 1, wait]);
  // 살아 있는 세션이 있는 AIRCRAFT의 카드는 기다리는 것이 아니다
  const live = approvedNoSessionOf(closed, { sessions: [bg("TEAM_M")] } as unknown as Snapshot, NOW, wait);
  assert.deepEqual([live.waiting, live.overdue], [1, 0]);
});

test("설정: approvedWaitMin 기본 15, 양수가 아니면 기본", () => {
  const d = mkdtempSync(join(tmpdir(), "atc-relaunch-"));
  try {
    assert.equal(DEFAULT_DISPATCH_CONFIG.approvedWaitMin, 15);
    const f = join(d, "dispatch.json");
    writeFileSync(f, JSON.stringify({ approvedWaitMin: 30 }));
    assert.equal(loadDispatchConfig(f).approvedWaitMin, 30);
    writeFileSync(f, JSON.stringify({ approvedWaitMin: -1 }));
    assert.equal(loadDispatchConfig(f).approvedWaitMin, 15);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
