import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type ActionLine, coolingOf, type FleetAutoCtx, fleetAutoWhyNot, fleetMisfiresOf, misfiresByDay, parseAutoSwitch, recentActs, scheduleAutoWhyNot, scheduleMisfireOf } from "./autonomy-auto.ts";
import { loadAutoSwitch, runAutoSchedule, type ScheduleAutoIO, saveAutoSwitch } from "./autonomy-auto-run.ts";
import type { ScheduleOp } from "./schedule.ts";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

test("스위치: 파일에 없거나 모르는 값이면 on, off만 off", () => {
  assert.equal(parseAutoSwitch(undefined), "on");
  assert.equal(parseAutoSwitch("shadow"), "on");
  assert.equal(parseAutoSwitch("off"), "off");
  assert.equal(parseAutoSwitch("on"), "on");
});

test("스위치 파일: 다른 키는 그대로 두고 auto만 쓴다, 없는 파일은 on", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-auto-"));
  try {
    const f = join(dir, "schedule.json");
    assert.equal(loadAutoSwitch("schedule", f), "on");
    writeFileSync(f, JSON.stringify({ mode: "approval" }));
    saveAutoSwitch("schedule", "off", "SUPERVISOR", f);
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { mode: "approval", auto: "off" });
    assert.equal(loadAutoSwitch("schedule", f), "off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const sctx = (over = {}) => ({ sw: "on" as const, mode: "approval" as const, appliedToday: 0, max: 40, ...over });
test("SCHEDULE: CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW 열린 초안은 CROSSCHECK 없이도 대상", () => {
  for (const kind of ["CLASSIFY", "TAIL", "CLOSE", "WAYPOINT", "NEW"] as const) assert.equal(scheduleAutoWhyNot({ kind, status: "draft" }, sctx()), null, kind);
});
test("SCHEDULE: 방향(ROUTE·TARGET)·PRIORITIZE는 제안으로 남고, 스위치·모드·상한이 막는다", () => {
  for (const kind of ["ROUTE", "TARGET", "PRIORITIZE"] as const) assert.equal(scheduleAutoWhyNot({ kind, status: "draft" }, sctx()), "kind", kind);
  assert.equal(scheduleAutoWhyNot({ kind: "TAIL", status: "draft" }, sctx({ sw: "off" })), "switch-off");
  assert.equal(scheduleAutoWhyNot({ kind: "TAIL", status: "draft" }, sctx({ mode: "shadow" })), "mode");
  assert.equal(scheduleAutoWhyNot({ kind: "TAIL", status: "approved" }, sctx()), "not-open");
  assert.equal(scheduleAutoWhyNot({ kind: "TAIL", status: "draft" }, sctx({ appliedToday: 40 })), "daily-cap");
  assert.equal(scheduleAutoWhyNot({ kind: "TAIL", status: "draft" }, sctx({ appliedToday: 39 })), null);
});

const draft = (id: string, kind: ScheduleOp["kind"], minAgo: number): ScheduleOp =>
  ({ id, kind, flight: "ATC-1", payload: {}, reason: "r", at: iso(minAgo), status: "draft", statusAt: iso(minAgo), verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null }) as ScheduleOp;

test("runAutoSchedule: 오래된 초안부터 승인하고 한 일을 적는다, 하루 상한에서 멈춘다", () => {
  const approved: string[] = [];
  const actions: ActionLine[] = [];
  const ops = [draft("S-0002", "TAIL", 5), draft("S-0001", "CLASSIFY", 10), draft("S-0003", "ROUTE", 20), draft("S-0004", "CLOSE", 1)];
  const io: ScheduleAutoIO = {
    sw: () => "on",
    mode: () => "approval",
    ops: () => ops.map((o) => (approved.includes(o.id) ? { ...o, status: "approved" as const } : o)),
    actions: () => actions,
    autoApprovals: () => 0,
    max: () => 2,
    approve: (id) => void approved.push(id),
    addAction: (l) => void actions.push(l),
    stamp: () => iso(0),
  };
  // S-0003(ROUTE)은 건너뛴다. S-0003이 가장 오래됐어도 방향이라 제안으로 남는다. 상한 2
  assert.equal(runAutoSchedule(NOW, io), 2);
  assert.deepEqual(approved, ["S-0001", "S-0002"]);
  assert.deepEqual(actions.map((a) => `${a.kind}:${a.op}:${a.id}:${a.what}`), ["schedule:apply:S-0001:CLASSIFY", "schedule:apply:S-0002:TAIL"]);
  // 스위치가 off면 아무것도 하지 않는다
  assert.equal(runAutoSchedule(NOW, { ...io, sw: () => "off", max: () => 99 }), 0);
});

const fctx = (over: Partial<FleetAutoCtx> = {}): FleetAutoCtx => ({ sw: "on", mode: "approval", launchesToday: 0, launchMax: 6, actsToday: 0, actMax: 40, cooling: new Set(), aircraftKey: "TEAM_E", ...over });
const prop = (kind: string) => ({ kind, status: "open" as const, reasons: [] }) as never;

test("FLEET PLAN: LAUNCH·STOP·RESTART·REFRESH·AOG만, 나머지는 제안으로 남는다", () => {
  for (const k of ["LAUNCH", "STOP", "RESTART", "REFRESH", "AOG"]) assert.equal(fleetAutoWhyNot(prop(k), false, fctx()), null, k);
  for (const k of ["ENTRY", "ACCOUNT CHANGE", "REPOSITION", "RETIRE", "RETURN"]) assert.equal(fleetAutoWhyNot(prop(k), false, fctx()), "kind", k);
});
test("FLEET PLAN: 스위치·모드·사람 세션 REFRESH·쉬는 AIRCRAFT·상한이 막는다", () => {
  assert.equal(fleetAutoWhyNot(prop("STOP"), false, fctx({ sw: "off" })), "switch-off");
  assert.equal(fleetAutoWhyNot(prop("STOP"), false, fctx({ mode: "shadow" })), "mode");
  assert.equal(fleetAutoWhyNot(prop("REFRESH"), true, fctx()), "manual");
  assert.equal(fleetAutoWhyNot(prop("STOP"), false, fctx({ cooling: new Set(["TEAM_E"]) })), "cooling");
  assert.equal(fleetAutoWhyNot(prop("STOP"), false, fctx({ actsToday: 40 })), "daily-cap");
  assert.equal(fleetAutoWhyNot(prop("LAUNCH"), false, fctx({ launchesToday: 6 })), "launch-daily-cap");
  // STOP·AOG는 LAUNCH 상한에 걸리지 않는다
  assert.equal(fleetAutoWhyNot(prop("STOP"), false, fctx({ launchesToday: 6 })), null);
});

test("recentActs·coolingOf: 24시간 안의 적용, 30분 안의 적용·60분 안의 실패는 쉰다", () => {
  const lines: ActionLine[] = [
    { at: iso(10), kind: "fleet", op: "apply", id: "F-1", what: "STOP", aircraft: "TEAM_A" },
    { at: iso(45), kind: "fleet", op: "apply", id: "F-2", what: "STOP", aircraft: "TEAM_B" },
    { at: iso(45), kind: "fleet", op: "fail", id: "F-3", what: "LAUNCH", aircraft: "TEAM_C" },
    { at: iso(25 * 60), kind: "fleet", op: "apply", id: "F-0", what: "STOP", aircraft: "TEAM_D" },
    { at: iso(10), kind: "schedule", op: "apply", id: "S-1", what: "TAIL" },
  ];
  assert.equal(recentActs(lines, NOW, "fleet").length, 2);
  assert.deepEqual([...coolingOf(lines, NOW)].sort(), ["TEAM_A", "TEAM_C"]);
});

const applied = (over: Partial<ScheduleOp>): ScheduleOp => ({ ...draft("S-0010", "TAIL", 60), status: "applied", statusAt: iso(30), via: "auto", payload: { registration: "TEAM_E" }, ...over }) as ScheduleOp;
const tk = (labels: string[], stateType = "unstarted") => ({ key: "ATC-1", labels, stateType });

test("SCHEDULE 오작동: 자동 승인한 TAIL이 다른 tail로 바뀌면 센다", () => {
  assert.equal(scheduleMisfireOf(applied({}), [], tk(["tail:TEAM_E"]), NOW), null);
  const bad = scheduleMisfireOf(applied({}), [], tk(["tail:TEAM_G"]), NOW);
  assert.equal(bad?.why, "undone");
  assert.match(bad?.detail ?? "", /tail:TEAM_G/);
});
test("SCHEDULE 오작동: CLOSE한 이슈가 다시 열리거나 CLASSIFY 라벨이 빠지면 센다", () => {
  const close = applied({ kind: "CLOSE", payload: {} });
  assert.equal(scheduleMisfireOf(close, [], tk([], "completed"), NOW), null);
  assert.match(scheduleMisfireOf(close, [], tk([], "started"), NOW)?.detail ?? "", /다시 열림/);
  const cls = applied({ kind: "CLASSIFY", payload: { type: "BUILD", wake: "M" } });
  assert.equal(scheduleMisfireOf(cls, [], tk(["type:BUILD", "M"]), NOW), null);
  assert.match(scheduleMisfireOf(cls, [], tk(["M"]), NOW)?.detail ?? "", /BUILD/);
});
test("SCHEDULE 오작동: 뒤 초안이 다른 값을 내면 센다, 사람이 승인한 것·3일 지난 것은 안 센다", () => {
  const op = applied({});
  const later = { ...draft("S-0011", "TAIL", 5), payload: { registration: "TEAM_G" } } as ScheduleOp;
  assert.match(scheduleMisfireOf(op, [op, later], undefined, NOW)?.detail ?? "", /S-0011/);
  assert.equal(scheduleMisfireOf(applied({ via: "manual" }), [], tk(["tail:TEAM_G"]), NOW), null);
  assert.equal(scheduleMisfireOf(applied({ statusAt: iso(4 * 24 * 60) }), [], tk(["tail:TEAM_G"]), NOW), null);
});

test("FLEET PLAN 오작동: STOP 뒤 1시간 안 LAUNCH, 1시간 뒤에도 노는 LAUNCH, RESTART 고리", () => {
  const act = (id: string, what: string, minAgo: number, aircraft: string): ActionLine => ({ at: iso(minAgo), kind: "fleet", op: "apply", id, what, aircraft });
  const ctx = (launches: { aircraft: string; at: string }[], idle: string[] = []) => ({ now: NOW, launches, idleNow: (r: string) => idle.includes(r) });
  const stop = act("F-1", "STOP", 100, "TEAM_A");
  assert.deepEqual(fleetMisfiresOf([stop], ctx([{ aircraft: "TEAM_A", at: iso(70) }])).map((m) => m.why), ["stop-launch"]);
  // STOP 90분 뒤의 LAUNCH는 1시간을 넘었다
  assert.deepEqual(fleetMisfiresOf([stop], ctx([{ aircraft: "TEAM_A", at: iso(10) }])), []);
  const launch = act("F-2", "LAUNCH", 90, "TEAM_B");
  assert.deepEqual(fleetMisfiresOf([launch], ctx([], ["TEAM_B"])).map((m) => m.why), ["idle-launch"]);
  assert.deepEqual(fleetMisfiresOf([launch], ctx([], [])), []);
  assert.deepEqual(fleetMisfiresOf([act("F-3", "LAUNCH", 20, "TEAM_B")], ctx([], ["TEAM_B"])), []); // 아직 1시간 전
  const loop = [act("F-4", "RESTART", 300, "TEAM_C"), act("F-5", "REFRESH", 200, "TEAM_C"), act("F-6", "RESTART", 100, "TEAM_C")];
  assert.deepEqual(fleetMisfiresOf(loop, ctx([])).map((m) => `${m.id}:${m.why}`), ["F-6:restart-loop"]);
});

test("misfiresByDay: 같은 사건은 한 번, 하루별·종류별로 센다", () => {
  const m = (at: string, kind: "schedule" | "fleet", id: string) => ({ at, kind, id, why: "undone" as const, what: "TAIL" });
  const days = misfiresByDay([m("2026-10-01T01:00:00Z", "schedule", "S-1"), m("2026-10-02T01:00:00Z", "schedule", "S-1"), m("2026-10-02T02:00:00Z", "fleet", "F-1"), m("2026-10-02T03:00:00Z", "fleet", "F-2")]);
  assert.deepEqual(days, [{ day: "2026-10-01", schedule: 1, fleet: 0 }, { day: "2026-10-02", schedule: 0, fleet: 2 }]);
});
