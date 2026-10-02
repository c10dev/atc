import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type AssignCtx, type AutoCounts, type AutoLine, assignWhyNot, countsOf, type LaunchCtx, launchWhyNot, recentLaunchFailsOf, type ScheduleCtx, scheduleWhyNot, wouldIdsOf } from "./auto-approve.ts";
import { type AutoDeps, type AutoIO, runAutoApprove } from "./auto-approve-run.ts";
import { isBlind } from "./blind.ts";
import { DEFAULT_DISPATCH_CONFIG, type DispatchConfig, loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";
import { type Op, type Proposal, fold, gateOf, humanOf } from "./proposals.ts";
import { modeSegments, needsConfirm } from "./settings-policy.ts";
import type { ScheduleOp } from "./schedule.ts";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const ZERO: AutoCounts = { approved: 0, launched: 0 };

// blind가 아닌 id와 blind인 id(해시로 정해진다)
const idWhere = (blind: boolean, prefix = "D-") => {
  for (let i = 1; i < 500; i++) {
    const id = `${prefix}${String(i).padStart(4, "0")}`;
    if (isBlind(id) === blind) return id;
  }
  throw new Error("id 없음");
};
const OPEN = idWhere(false);
const BLIND = idWhere(true);

type Card = Pick<Proposal, "id" | "kind" | "status" | "at" | "launch" | "caution" | "crosscheck" | "holdAt">;
const agree = { by: "CROSSCHECK", model: "m", verdict: "agree" as const, reason: "ok", at: iso(15) };
const card = (over: Partial<Card> = {}): Card => ({ id: OPEN, kind: "ASSIGN", status: "proposed", at: iso(30), launch: undefined, caution: false, crosscheck: agree, holdAt: null, ...over });

const assignCtx = (over: Partial<AssignCtx> = {}): AssignCtx => ({ now: NOW, settleMin: 10, dispatchMode: "approval", fuelHold: false, counts: ZERO, approveMax: 40, ...over });
const launchCtx = (over: Partial<LaunchCtx> = {}): LaunchCtx => ({ now: NOW, settleMin: 10, dispatchMode: "approval", fuelHold: false, cap: { full: false }, stuck: false, backedOff: false, counts: ZERO, launchMax: 6, ...over });

test("ASSIGN: agree이고 열린 SETTLED 카드, blind·HELD·LAUNCH 아님, 상한 안, FUEL hold 아님이면 승인 대상", () => {
  assert.equal(assignWhyNot(card(), assignCtx()), null);
});

test("ASSIGN: 막는 조건마다 까닭을 낸다", () => {
  assert.equal(assignWhyNot(card(), assignCtx({ dispatchMode: "shadow" })), "mode");
  assert.equal(assignWhyNot(card({ kind: "RELEASE" }), assignCtx()), "not-assign");
  assert.equal(assignWhyNot(card({ status: "approved" }), assignCtx()), "not-open");
  assert.equal(assignWhyNot(card({ launch: true }), assignCtx()), "launch");
  assert.equal(assignWhyNot(card({ holdAt: iso(5) }), assignCtx()), "held");
  assert.equal(assignWhyNot(card({ at: iso(2) }), assignCtx()), "unsettled");
  assert.equal(assignWhyNot(card({ crosscheck: null }), assignCtx()), "no-crosscheck");
  assert.equal(assignWhyNot(card({ crosscheck: { ...agree, verdict: "disagree" } }), assignCtx()), "disagree");
  assert.equal(assignWhyNot(card({ id: BLIND }), assignCtx()), "blind");
  assert.equal(assignWhyNot(card({ caution: true }), assignCtx()), "caution");
  assert.equal(assignWhyNot(card(), assignCtx({ fuelHold: true })), "fuel-hold");
  assert.equal(assignWhyNot(card(), assignCtx({ counts: { approved: 40, launched: 0 } })), "daily-cap");
  assert.equal(assignWhyNot(card(), assignCtx({ counts: { approved: 39, launched: 0 } })), null);
  // 상한 0이면 자동으로는 아무것도 승인하지 않는다
  assert.equal(assignWhyNot(card(), assignCtx({ approveMax: 0 })), "daily-cap");
});

test("launch 카드: 조건을 모두 지킬 때만, 하나라도 어기면 막는다", () => {
  const c = card({ launch: true });
  assert.equal(launchWhyNot(c, launchCtx()), null);
  assert.equal(launchWhyNot(c, launchCtx({ cap: { full: true } })), "cap-full");
  assert.equal(launchWhyNot(c, launchCtx({ fuelHold: true })), "fuel-hold");
  assert.equal(launchWhyNot(c, launchCtx({ stuck: true })), "stuck");
  assert.equal(launchWhyNot({ ...c, id: BLIND }, launchCtx()), "blind");
  assert.equal(launchWhyNot(c, launchCtx({ backedOff: true })), "backoff");
  assert.equal(launchWhyNot(c, launchCtx({ counts: { approved: 0, launched: 6 } })), "launch-daily-cap");
  assert.equal(launchWhyNot(c, launchCtx({ counts: { approved: 0, launched: 5 } })), null);
  assert.equal(launchWhyNot({ ...c, holdAt: iso(1) }, launchCtx()), "held");
  assert.equal(launchWhyNot({ ...c, crosscheck: null }, launchCtx()), "no-crosscheck");
  assert.equal(launchWhyNot({ ...c, crosscheck: { ...agree, verdict: "disagree" } }, launchCtx()), "disagree");
  assert.equal(launchWhyNot(card(), launchCtx()), "not-launch");
  assert.equal(launchWhyNot(c, launchCtx({ dispatchMode: "shadow" })), "mode");
  // ASSIGN 상한(하루 40)은 launch에 상관없다: launch는 자기 상한만 본다
  assert.equal(launchWhyNot(c, launchCtx({ counts: { approved: 99, launched: 0 } })), null);
});

const sched = (over: Partial<Pick<ScheduleOp, "id" | "kind" | "status" | "crosscheck">> = {}) => ({ id: OPEN.replace("D-", "S-"), kind: "CLASSIFY" as ScheduleOp["kind"], status: "draft" as ScheduleOp["status"], crosscheck: agree, ...over });
const schedCtx = (over: Partial<ScheduleCtx> = {}): ScheduleCtx => ({ scheduleMode: "approval", counts: ZERO, approveMax: 40, isNetwork: (k) => k === "TARGET" || k === "ROUTE", ...over });

test("SCHEDULE 초안: agree, blind 아님, approval 모드, network 종류 아님, 상한 안일 때만", () => {
  const ok = sched();
  assert.equal(isBlind(ok.id), false); // 이 시험의 id는 blind가 아니어야 한다
  assert.equal(scheduleWhyNot(ok, schedCtx()), null);
  assert.equal(scheduleWhyNot(ok, schedCtx({ scheduleMode: "shadow" })), "mode");
  assert.equal(scheduleWhyNot(sched({ status: "approved" }), schedCtx()), "not-draft");
  assert.equal(scheduleWhyNot(sched({ kind: "TARGET" }), schedCtx()), "network-kind");
  assert.equal(scheduleWhyNot(sched({ crosscheck: null }), schedCtx()), "no-crosscheck");
  assert.equal(scheduleWhyNot(sched({ crosscheck: { ...agree, verdict: "disagree" } }), schedCtx()), "disagree");
  assert.equal(scheduleWhyNot(sched({ id: idWhere(true, "S-") }), schedCtx()), "blind");
  assert.equal(scheduleWhyNot(ok, schedCtx({ counts: { approved: 40, launched: 0 } })), "daily-cap");
});

test("하루 개수는 굴러가는 24시간, would 줄도 센다. shadow는 같은 카드를 다시 쓰지 않는다", () => {
  const line = (minAgo: number, op: AutoLine["op"], id = "D-0001", kind: AutoLine["kind"] = "dispatch"): AutoLine => ({ at: iso(minAgo), mode: "on", kind, op, id });
  const lines = [line(10, "approve"), line(60, "would-approve", "D-0002"), line(25 * 60, "approve", "D-0003"), line(5, "launch"), line(6, "would-launch", "D-0004"), line(30 * 60, "launch", "D-0005")];
  assert.deepEqual(countsOf(lines, NOW), { approved: 2, launched: 2 });
  assert.deepEqual([...wouldIdsOf(lines)].sort(), ["dispatch:D-0002", "dispatch:D-0004"]);
});

test("최근 LAUNCH 실패한 REGISTRATION은 기다린다(손으로 한 승인의 실패도 센다)", () => {
  const failed = (id: string, aircraft: string, minAgo: number): Op[] => [
    { op: "create", id, at: iso(minAgo + 5), kind: "ASSIGN", flight: "ATC-1", aircraft: null, aircraftName: aircraft, airport: "ATCC", score: 1, factors: [], launch: true } as Op,
    { op: "approve", id, at: iso(minAgo + 2) },
    { op: "supersede", id, at: iso(minAgo), reason: "LAUNCH 실패 — 이미 떠 있음(bg abcdef)" },
  ];
  const ps = fold([...failed("D-0001", "TEAM_D", 10), ...failed("D-0002", "TEAM_E", 45)]);
  const fails = recentLaunchFailsOf(ps, NOW, 30);
  assert.deepEqual([...fails], ["TEAM_D"]); // TEAM_E의 실패는 45분 전이라 지났다
  assert.equal(recentLaunchFailsOf(ps, NOW, 60).size, 2);
});

test("설정: 기본은 off, 모르는 값은 off, 상한은 0 이상 정수 아니면 기본", () => {
  const d = mkdtempSync(join(tmpdir(), "atc-auto-"));
  try {
    assert.equal(DEFAULT_DISPATCH_CONFIG.autoApprove, "off");
    assert.equal(DEFAULT_DISPATCH_CONFIG.autoApproveLaunch, "off");
    assert.equal(DEFAULT_DISPATCH_CONFIG.autoApproveMax, 40);
    assert.equal(DEFAULT_DISPATCH_CONFIG.autoLaunchMax, 6);
    assert.equal(DEFAULT_DISPATCH_CONFIG.autoLaunchBackoffMin, 30);
    const f = join(d, "dispatch.json");
    writeFileSync(f, JSON.stringify({ mode: "approval" }));
    assert.equal(loadDispatchConfig(f).autoApprove, "off"); // 옛 파일은 그대로 off
    writeFileSync(f, JSON.stringify({ autoApprove: "yes", autoApproveLaunch: 1, autoApproveMax: -3, autoLaunchMax: 2.5, autoLaunchBackoffMin: "x" }));
    const bad = loadDispatchConfig(f);
    assert.deepEqual([bad.autoApprove, bad.autoApproveLaunch, bad.autoApproveMax, bad.autoLaunchMax, bad.autoLaunchBackoffMin], ["off", "off", 40, 6, 30]);
    writeFileSync(f, JSON.stringify({ autoApprove: "shadow", autoApproveLaunch: "on", autoApproveMax: 0, autoLaunchMax: 3, autoLaunchBackoffMin: 45 }));
    const good = loadDispatchConfig(f);
    assert.deepEqual([good.autoApprove, good.autoApproveLaunch, good.autoApproveMax, good.autoLaunchMax, good.autoLaunchBackoffMin], ["shadow", "on", 0, 3, 45]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("via auto는 사람 판정이 아니다: humanOf·게이트에서 빠진다", () => {
  const create: Op = { op: "create", id: "D-0001", at: iso(40), kind: "ASSIGN", flight: "ATC-1", aircraft: null, aircraftName: "TEAM_B", airport: "ATCC", score: 1, factors: [] };
  const [auto] = fold([create, { op: "approve", id: "D-0001", at: iso(5), via: "auto" }]);
  assert.equal(auto.status, "approved");
  assert.equal(auto.via, "auto");
  assert.equal(humanOf(auto), null);
  const [manual] = fold([{ ...create, id: "D-0002" } as Op, { op: "approve", id: "D-0002", at: iso(5), via: "manual" }]);
  assert.equal(humanOf(manual)?.verdict, "agree");
  // 게이트(shadow 점검)는 사람 판정만 센다
  const g = gateOf(fold([create, { op: "verdict", id: "D-0001", at: iso(5), verdict: "agree", reason: null, via: "auto" }]));
  assert.equal(g.decided, 0);
});

test("정책 줄: 두 스위치가 보이고 on만 확인이 필요하다", () => {
  assert.equal(needsConfirm("autoApprove", "off", "on"), true);
  assert.equal(needsConfirm("autoApprove", "off", "shadow"), false);
  assert.equal(needsConfirm("autoApproveLaunch", "shadow", "on"), true);
  assert.equal(needsConfirm("autoApproveLaunch", "on", "off"), false);
  const segs = modeSegments({
    autoland: { mode: "off", reviewedSecurity: "off", airports: [], applicationCheck: "", groundStops: [], applicationCheckWarnings: [] },
    mcc: { mode: "shadow", airport: "ATCC" },
    review: { security: "exclude" },
    dispatchAuto: { auto: "on", approve: "on", launch: "shadow", approveMax: 40, launchMax: 6, backoffMin: 30 },
  });
  const auto = segs.filter((x) => x.key === "autoApprove" || x.key === "autoApproveLaunch");
  assert.deepEqual(auto.map((x) => [x.label, x.value, x.warn]), [["AUTO APPROVE", "on", true], ["AUTO LAUNCH", "shadow", false]]);
});

// ── 한 주기(runAutoApprove): 가짜 IO ──
const snapshot = (over: Record<string, unknown> = {}) => ({ sessions: [], fuel: {}, absent: [], ...over }) as unknown as Snapshot;
const cfgOf = (over: Partial<DispatchConfig> = {}): DispatchConfig => ({ ...DEFAULT_DISPATCH_CONFIG, mode: "approval", autoDispatch: "off", ...over }); // 옛 일치 기반 시험은 자동 운항(ATC-367)을 끈다
const cardOps = (id: string, opts: { launch?: boolean; reg?: string; verdict?: "agree" | "disagree" | null; caution?: boolean; minAgo?: number } = {}): Op[] => {
  const ops: Op[] = [{ op: "create", id, at: iso(opts.minAgo ?? 30), kind: "ASSIGN", flight: `ATC-${id.slice(-3)}`, aircraft: null, aircraftName: opts.reg ?? "TEAM_B", airport: "ATCC", score: 1, factors: [], ...(opts.launch ? { launch: true as const } : {}) } as Op];
  if (opts.verdict !== null) ops.push({ op: "crosscheck", id, by: "CROSSCHECK", model: "m", verdict: opts.verdict ?? "agree", reason: "ok", at: iso(15) } as Op);
  if (opts.caution) ops.push({ op: "note", id, at: iso(14), text: "주의", caution: true });
  return ops;
};

interface Fake {
  io: AutoIO;
  ops: Op[];
  lines: AutoLine[];
  schedule: string[];
}
function fake(cfg: DispatchConfig, base: Op[], schedule: ScheduleOp[] = [], scheduleMode: "shadow" | "approval" = "approval"): Fake {
  const state: Fake = { ops: [...base], lines: [], schedule: [], io: null as unknown as AutoIO };
  state.io = {
    cfg: () => cfg,
    proposals: () => fold(state.ops),
    scheduleOps: () => schedule,
    scheduleMode: () => scheduleMode,
    lines: () => state.lines,
    addLine: (l) => state.lines.push(l),
    appendOps: (ops) => void state.ops.push(...ops),
    approveSchedule: (id) => void state.schedule.push(id),
    stamp: () => new Date(NOW).toISOString(),
  };
  return state;
}
const noLaunch: AutoDeps = { max: 6, launch: async () => ({ ok: true, jobId: "j1" }) };

test("runAutoApprove: 스위치가 모두 off면 아무것도 읽거나 쓰지 않는다", async () => {
  const f = fake(cfgOf(), cardOps(OPEN));
  const r = await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.deepEqual(r, { approved: 0, launched: 0, would: 0 });
  assert.equal(f.ops.length, cardOps(OPEN).length);
  assert.equal(f.lines.length, 0);
});

test("runAutoApprove shadow: would-approve 줄만, 승인은 하나도 없고 같은 카드를 다시 쓰지 않는다", async () => {
  const f = fake(cfgOf({ autoApprove: "shadow" }), [...cardOps(OPEN), ...cardOps(BLIND)]);
  const before = f.ops.length;
  const r = await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.deepEqual(r, { approved: 0, launched: 0, would: 1 }); // blind는 would도 쓰지 않는다
  assert.equal(f.ops.length, before); // 승인 op 없음
  assert.deepEqual(f.lines.map((l) => [l.mode, l.op, l.id]), [["shadow", "would-approve", OPEN]]);
  await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.equal(f.lines.length, 1);
  assert.deepEqual(f.schedule, []);
});

test("runAutoApprove on: via auto로 승인하고 blind·disagree·caution·HELD 카드는 건드리지 않는다", async () => {
  const dis = idWhere(false, "D-9");
  const caut = (() => {
    for (let i = 600; i < 900; i++) {
      const id = `D-${i}`;
      if (!isBlind(id) && id !== OPEN && id !== dis) return id;
    }
    throw new Error("id 없음");
  })();
  const f = fake(cfgOf({ autoApprove: "on" }), [...cardOps(OPEN), ...cardOps(BLIND), ...cardOps(dis, { verdict: "disagree" }), ...cardOps(caut, { caution: true })]);
  const r = await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.deepEqual(r, { approved: 1, launched: 0, would: 0 });
  const approves = f.ops.filter((o) => o.op === "approve");
  assert.deepEqual(approves, [{ op: "approve", id: OPEN, at: iso(0), via: "auto" }]);
  const ps = f.io.proposals();
  assert.equal(ps.find((p) => p.id === OPEN)?.status, "approved");
  for (const id of [BLIND, dis, caut]) assert.equal(ps.find((p) => p.id === id)?.status, "proposed", id);
  assert.deepEqual(f.lines.map((l) => [l.mode, l.op, l.id]), [["on", "approve", OPEN]]);
  // 두 번째 주기: 이미 승인했으니 더 하지 않는다
  assert.equal((await runAutoApprove(snapshot(), noLaunch, NOW, f.io)).approved, 0);
});

test("runAutoApprove on: 하루 상한에서 멈춘다(ASSIGN과 SCHEDULE을 같이 센다)", async () => {
  const ids = [OPEN];
  for (let i = 1000; ids.length < 4; i++) if (!isBlind(`D-${i}`)) ids.push(`D-${i}`);
  const f = fake(cfgOf({ autoApprove: "on", autoApproveMax: 2 }), ids.flatMap((id) => cardOps(id)));
  const r = await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.equal(r.approved, 2);
  assert.equal(f.io.proposals().filter((p) => p.status === "approved").length, 2);
  assert.equal((await runAutoApprove(snapshot(), noLaunch, NOW, f.io)).approved, 0); // 상한이 찼다
});

test("runAutoApprove: DISPATCH가 shadow 모드면 아무것도 승인하지 않는다", async () => {
  const f = fake(cfgOf({ mode: "shadow", autoApprove: "on" }), cardOps(OPEN));
  assert.deepEqual(await runAutoApprove(snapshot(), noLaunch, NOW, f.io), { approved: 0, launched: 0, would: 0 });
});

const sOp = (id: string, over: Partial<ScheduleOp> = {}) => ({ id, kind: "CLASSIFY", status: "draft", at: iso(30), crosscheck: agree, ...over }) as unknown as ScheduleOp;

test("runAutoApprove: SCHEDULE 초안도 같은 규칙(agree, blind 아님, approval 모드)으로 승인한다", async () => {
  const okId = idWhere(false, "S-");
  const f = fake(cfgOf({ autoApprove: "on" }), [], [sOp(okId), sOp(idWhere(true, "S-")), sOp("S-NET", { kind: "TARGET" })].filter((o) => o.id !== "S-NET" || !isBlind("S-NET")));
  const r = await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.equal(r.approved, 1);
  assert.deepEqual(f.schedule, [okId]);
  // 스케줄이 shadow 모드면 승인하지 않는다
  const g = fake(cfgOf({ autoApprove: "on" }), [], [sOp(okId)], "shadow");
  assert.equal((await runAutoApprove(snapshot(), noLaunch, NOW, g.io)).approved, 0);
  // shadow 스위치는 would 줄만
  const h = fake(cfgOf({ autoApprove: "shadow" }), [], [sOp(okId)]);
  assert.equal((await runAutoApprove(snapshot(), noLaunch, NOW, h.io)).would, 1);
  assert.deepEqual(h.schedule, []);
});

const absentSnap = (reg: string, over: Record<string, unknown> = {}) => snapshot({ absent: [{ registration: reg, launchedAt: iso(300), jobId: null, cut: null, ...over }] });

test("runAutoApprove launch on: 승인하고 by auto로 LAUNCH한다", async () => {
  const launched: string[] = [];
  const deps: AutoDeps = { max: 6, launch: async (_s, reg, id) => (launched.push(`${reg}:${id}`), { ok: true, jobId: "j9" }) };
  const f = fake(cfgOf({ autoApproveLaunch: "on" }), cardOps(OPEN, { launch: true, reg: "TEAM_D" }));
  const r = await runAutoApprove(absentSnap("TEAM_D"), deps, NOW, f.io);
  assert.deepEqual(r, { approved: 0, launched: 1, would: 0 });
  assert.deepEqual(launched, [`TEAM_D:${OPEN}`]);
  assert.deepEqual(f.ops.filter((o) => o.op === "approve"), [{ op: "approve", id: OPEN, at: iso(0), via: "auto" }]);
  const launchOp = f.ops.find((o) => o.op === "launch") as Extract<Op, { op: "launch" }>;
  assert.equal(launchOp.by, "auto");
  assert.equal(launchOp.ok, true);
  assert.deepEqual(f.lines.map((l) => [l.op, l.ok]), [["launch", true]]);
});

test("runAutoApprove launch: 막는 조건마다 승인도 LAUNCH도 하지 않는다", async () => {
  const run = async (cfg: DispatchConfig, snap: Snapshot, ops: Op[], deps: AutoDeps = noLaunch) => {
    const f = fake(cfg, ops);
    const r = await runAutoApprove(snap, deps, NOW, f.io);
    return { r, f };
  };
  const base = cardOps(OPEN, { launch: true, reg: "TEAM_D" });
  const on = cfgOf({ autoApproveLaunch: "on" });
  // 상한이 참
  let x = await run(on, absentSnap("TEAM_D"), base, { ...noLaunch, max: 0 });
  assert.equal(x.r.launched, 0);
  assert.equal(x.f.ops.some((o) => o.op === "approve"), false);
  // 막힘(stuck)
  x = await run(on, absentSnap("TEAM_D", { stuck: { jobId: "abcdef", at: iso(10), state: "working" } }), base);
  assert.equal(x.r.launched, 0);
  // FUEL hold: 스위치가 켜져 있고 ACCOUNT가 holdPct 이상
  const hold = cfgOf({ autoApproveLaunch: "on", fuel: { ...DEFAULT_DISPATCH_CONFIG.fuel, hold: true } });
  x = await run(hold, snapshot({ absent: [{ registration: "TEAM_D", launchedAt: iso(300), jobId: null, cut: null }], fuel: { TEAM_D: { top: { pct: 97, resetsAt: iso(-60) } } } }), base);
  assert.equal(x.r.launched, 0);
  // blind
  x = await run(on, absentSnap("TEAM_D"), cardOps(BLIND, { launch: true, reg: "TEAM_D" }));
  assert.equal(x.r.launched, 0);
  // 하루 상한
  const capped = cfgOf({ autoApproveLaunch: "on", autoLaunchMax: 0 });
  x = await run(capped, absentSnap("TEAM_D"), base);
  assert.equal(x.r.launched, 0);
  // 실패 뒤 대기: 10분 전에 LAUNCH 실패로 닫힌 같은 REGISTRATION의 카드가 있다
  const failedOps: Op[] = [
    { op: "create", id: "D-0777", at: iso(20), kind: "ASSIGN", flight: "ATC-777", aircraft: null, aircraftName: "TEAM_D", airport: "ATCC", score: 1, factors: [], launch: true } as Op,
    { op: "approve", id: "D-0777", at: iso(12) },
    { op: "supersede", id: "D-0777", at: iso(10), reason: "LAUNCH 실패 — 어떤 오류" },
  ];
  x = await run(on, absentSnap("TEAM_D"), [...failedOps, ...base]);
  assert.equal(x.r.launched, 0);
  assert.equal(x.f.ops.some((o) => o.op === "approve" && o.id === OPEN), false);
  // 35분이 지났으면 다시 한다
  const old = failedOps.map((o) => ({ ...o, at: new Date(Date.parse(o.at) - 40 * 60_000).toISOString() }) as Op);
  x = await run(on, absentSnap("TEAM_D"), [...old, ...base]);
  assert.equal(x.r.launched, 1);
});

test("runAutoApprove launch shadow: would-launch 줄만, LAUNCH도 승인도 없다", async () => {
  let called = 0;
  const f = fake(cfgOf({ autoApproveLaunch: "shadow" }), cardOps(OPEN, { launch: true, reg: "TEAM_D" }));
  const r = await runAutoApprove(absentSnap("TEAM_D"), { max: 6, launch: async () => (called++, { ok: true }) }, NOW, f.io);
  assert.deepEqual(r, { approved: 0, launched: 0, would: 1 });
  assert.equal(called, 0);
  assert.equal(f.ops.some((o) => o.op === "approve"), false);
  assert.deepEqual(f.lines.map((l) => [l.mode, l.op, l.registration]), [["shadow", "would-launch", "TEAM_D"]]);
});

test("runAutoApprove launch on: LAUNCH가 실패하면 승인 뒤 SUPERSEDED로 닫히고 다음 주기에는 쉰다", async () => {
  const deps: AutoDeps = { max: 6, launch: async () => ({ ok: false, error: "이미 떠 있음(bg abcdef)" }) };
  const f = fake(cfgOf({ autoApproveLaunch: "on" }), cardOps(OPEN, { launch: true, reg: "TEAM_D" }));
  const r = await runAutoApprove(absentSnap("TEAM_D"), deps, NOW, f.io);
  assert.equal(r.launched, 0);
  const ps = f.io.proposals();
  assert.equal(ps.find((p) => p.id === OPEN)?.status, "superseded");
  assert.deepEqual(f.lines.map((l) => [l.op, l.ok]), [["launch", false]]);
  // 같은 REGISTRATION의 새 카드는 30분 동안 자동으로 승인하지 않는다
  const second = idWhere(false, "D-5");
  f.ops.push(...cardOps(second, { launch: true, reg: "TEAM_D" }));
  const again = await runAutoApprove(absentSnap("TEAM_D"), deps, NOW, f.io);
  assert.equal(again.launched, 0);
  assert.equal(f.io.proposals().find((p) => p.id === second)?.status, "proposed");
});

// ── 자동 운항(ATC-367): CROSSCHECK·blind·주의 없이 필터와 상한만 ──
test("자동 운항 설정: 기본 on, 파일의 off만 끈다, 깨진 파일은 off, 파일이 없으면 기본", () => {
  const d = mkdtempSync(join(tmpdir(), "atc-auto-"));
  try {
    assert.equal(DEFAULT_DISPATCH_CONFIG.autoDispatch, "on");
    const f = join(d, "dispatch.json");
    assert.equal(loadDispatchConfig(f).autoDispatch, "on"); // 파일 없음
    writeFileSync(f, JSON.stringify({ mode: "approval" }));
    assert.equal(loadDispatchConfig(f).autoDispatch, "on");
    writeFileSync(f, JSON.stringify({ autoDispatch: "off" }));
    assert.equal(loadDispatchConfig(f).autoDispatch, "off");
    writeFileSync(f, JSON.stringify({ autoDispatch: "yes" }));
    assert.equal(loadDispatchConfig(f).autoDispatch, "on"); // 모르는 값은 끄지 않는다(끄는 것은 "off"뿐)
    writeFileSync(f, "{ not json");
    assert.equal(loadDispatchConfig(f).autoDispatch, "off"); // 깨진 파일은 사람 없는 승인을 켜 두지 않는다
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("live: CROSSCHECK 없음·disagree·blind·주의 카드도 필터를 통과하면 승인 대상, HELD·SETTLED 아님·FUEL hold·상한은 그대로 막는다", () => {
  const live = assignCtx({ live: true });
  assert.equal(assignWhyNot(card({ crosscheck: null }), live), null);
  assert.equal(assignWhyNot(card({ crosscheck: { ...agree, verdict: "disagree" } }), live), null);
  assert.equal(assignWhyNot(card({ id: BLIND }), live), null);
  assert.equal(assignWhyNot(card({ caution: true }), live), null);
  assert.equal(assignWhyNot(card({ holdAt: iso(5) }), live), "held");
  assert.equal(assignWhyNot(card({ at: iso(2) }), live), "unsettled");
  assert.equal(assignWhyNot(card(), assignCtx({ live: true, fuelHold: true })), "fuel-hold");
  assert.equal(assignWhyNot(card(), assignCtx({ live: true, counts: { approved: 40, launched: 0 } })), "daily-cap");
  assert.equal(assignWhyNot(card(), assignCtx({ live: true, dispatchMode: "shadow" })), "mode");
  // launch 카드: 상한·막힘·실패 뒤 대기는 그대로
  const l = card({ launch: true, crosscheck: null });
  assert.equal(launchWhyNot(l, launchCtx({ live: true })), null);
  assert.equal(launchWhyNot(l, launchCtx({ live: true, cap: { full: true } })), "cap-full");
  assert.equal(launchWhyNot(l, launchCtx({ live: true, stuck: true })), "stuck");
  assert.equal(launchWhyNot(l, launchCtx({ live: true, backedOff: true })), "backoff");
  assert.equal(launchWhyNot(l, launchCtx({ live: true, counts: { approved: 0, launched: 6 } })), "launch-daily-cap");
});

test("runAutoApprove 자동 운항 on(autoApprove·Launch off): 모든 열린 ASSIGN을 승인하고 HELD는 두며 SCHEDULE은 건드리지 않는다", async () => {
  const held: Op[] = [...cardOps(idWhere(false, "D-7"), { verdict: null }), { op: "hold", id: idWhere(false, "D-7"), at: iso(20), by: [], reason: "x" } as unknown as Op];
  const f = fake(cfgOf({ autoDispatch: "on" }), [...cardOps(OPEN, { verdict: null }), ...cardOps(BLIND, { verdict: "disagree" }), ...cardOps(idWhere(false, "D-8"), { caution: true }), ...held]);
  const draft = { id: "S-1", kind: "NEW", status: "draft", at: iso(30), crosscheck: { by: "CROSSCHECK", model: "m", verdict: "agree", reason: "ok", at: iso(15) }, flight: null } as unknown as ScheduleOp;
  f.io.scheduleOps = () => [draft];
  const r = await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.equal(r.approved, 3);
  const ps = f.io.proposals();
  for (const id of [OPEN, BLIND, idWhere(false, "D-8")]) assert.equal(ps.find((p) => p.id === id)?.status, "approved", id);
  assert.equal(ps.find((p) => p.id === idWhere(false, "D-7"))?.status, "proposed"); // HELD
  assert.deepEqual(f.schedule, []); // autoApprove가 off라 SCHEDULE은 그대로
  assert.ok(f.ops.filter((o) => o.op === "approve").every((o) => (o as { via?: string }).via === "auto"));
});

test("runAutoApprove 자동 운항 on: launch 카드도 CROSSCHECK 없이 승인하고 LAUNCH한다, 상한이 차면 하지 않는다", async () => {
  const launched: string[] = [];
  const deps: AutoDeps = { max: 6, launch: async (_s, reg) => (launched.push(reg), { ok: true, jobId: "j1" }) };
  const f = fake(cfgOf({ autoDispatch: "on" }), cardOps(OPEN, { launch: true, verdict: null }));
  const r = await runAutoApprove(snapshot(), deps, NOW, f.io);
  assert.equal(r.launched, 1);
  assert.deepEqual(launched, ["TEAM_B"]);
  const full = fake(cfgOf({ autoDispatch: "on" }), cardOps(OPEN, { launch: true, verdict: null }));
  const r2 = await runAutoApprove(snapshot(), { ...deps, max: 0 }, NOW, full.io);
  assert.equal(r2.launched, 0);
  assert.equal(full.io.proposals()[0].status, "proposed");
});

test("runAutoApprove 자동 운항 off: 옛 규칙(CROSSCHECK agree만)으로 돌아간다", async () => {
  const f = fake(cfgOf({ autoDispatch: "off", autoApprove: "on" }), [...cardOps(OPEN), ...cardOps(BLIND, { verdict: null })]);
  const r = await runAutoApprove(snapshot(), noLaunch, NOW, f.io);
  assert.equal(r.approved, 1);
  assert.equal(f.io.proposals().find((p) => p.id === BLIND)?.status, "proposed");
});
