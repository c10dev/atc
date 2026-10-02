import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { readAutoLines } from "./auto-approve-run.ts";
import { type ActionLine, type AutoSwitch, coolingOf, fleetAutoWhyNot, fleetMisfiresOf, isLaunching, type MisfireLine, misfireKey, misfiresByDay, parseAutoSwitch, recentActs, scheduleAutoWhyNot, scheduleMisfireOf } from "./autonomy-auto.ts";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { isManual, type FleetProposal } from "./fleet-plan.ts";
import type { Snapshot } from "./model.ts";
import { readRecords, record } from "./recorder.ts";
import { regKey } from "./registration.ts";
import { appendScheduleApprove, loadScheduleMode, loadScheduleOps } from "./schedule.ts";

// SCHEDULE·FLEET PLAN 자동 적용의 읽고 쓰기(ATC-370). 규칙은 autonomy-auto.ts(순수). 서버 안에서만 돈다 — 스위치를 바꾸는 길은 설정 창(fromThisApp)뿐이고 atcctl 명령은 없다(K3).
// 스위치는 두 개: schedule.json의 `auto`, fleet-plan.json의 `auto`(on·off, 없으면 on). 기록은 auto-actions.jsonl(한 일)과 misfires.jsonl(되돌려진 것), 둘 다 추가만 한다.

const ACTIONS = () => join(config.stateDir, "auto-actions.jsonl");
const MISFIRES = () => join(config.stateDir, "misfires.jsonl");
const SCHEDULE_FILE = () => join(config.stateDir, "schedule.json");
const FLEET_FILE = () => join(config.stateDir, "fleet-plan.json");

export type AutoTarget = "schedule" | "fleetPlan";
const fileOf = (t: AutoTarget) => (t === "schedule" ? SCHEDULE_FILE() : FLEET_FILE());

export function loadAutoSwitch(t: AutoTarget, file = fileOf(t)): AutoSwitch {
  try {
    return parseAutoSwitch(JSON.parse(readFileSync(file, "utf8")).auto);
  } catch {
    return "on";
  }
}

// 다른 키(mode, reposition …)는 그대로 두고 auto만 바꿔 원자적으로 쓴다. 바뀐 것만 FLIGHT RECORDER에 남긴다
export function saveAutoSwitch(t: AutoTarget, v: AutoSwitch, by = "SUPERVISOR", file = fileOf(t)) {
  if (loadAutoSwitch(t, file) === v) return;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...raw, auto: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file !== fileOf(t)) return; // 시험이 넘긴 임시 파일이면 운영 FLIGHT RECORDER에 쓰지 않는다
  const t0 = new Date().toISOString();
  if (t === "schedule") record({ t: t0, kind: "schedule", op: `auto:${v}`, id: "-" });
  else record({ t: t0, kind: "fleet-plan", op: `auto:${v}`, by });
}

function readJsonl<T>(file: string): T[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {}
  }
  return out;
}
function appendJsonl(file: string, lines: readonly object[]) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
}
export const readActions = (file = ACTIONS()) => readJsonl<ActionLine>(file);
export const readMisfires = (file = MISFIRES()) => readJsonl<MisfireLine>(file);
export const appendAction = (l: ActionLine, file = ACTIONS()) => appendJsonl(file, [l]);

// ── SCHEDULE: 열린 초안을 서버가 승인한다(발부는 OCC가 S2 흐름대로) ──
export interface ScheduleAutoIO {
  sw: () => AutoSwitch;
  mode: () => ReturnType<typeof loadScheduleMode>;
  ops: () => ReturnType<typeof loadScheduleOps>;
  actions: () => ActionLine[];
  autoApprovals: () => number; // 일치 기반 자동 승인이 센 SCHEDULE 승인(같은 하루 상한을 같이 센다)
  max: () => number;
  approve: (id: string, at: string) => void;
  addAction: (l: ActionLine) => void;
  stamp: () => string;
}
const realScheduleIO = (): ScheduleAutoIO => ({
  sw: () => loadAutoSwitch("schedule"),
  mode: () => loadScheduleMode(),
  ops: () => loadScheduleOps(),
  actions: () => readActions(),
  autoApprovals: () => readAutoLines().filter((l) => l.kind === "schedule" && l.mode === "on" && l.op === "approve" && Date.now() - Date.parse(l.at) < 86_400_000).length,
  max: () => loadDispatchConfig().autoApproveMax,
  approve: (id, at) => appendScheduleApprove(id, at),
  addAction: (l) => appendAction(l),
  stamp: () => new Date().toISOString(),
});

export function runAutoSchedule(now = Date.now(), io: ScheduleAutoIO = realScheduleIO()): number {
  if (io.sw() !== "on") return 0;
  let appliedToday = recentActs(io.actions(), now, "schedule").length + io.autoApprovals();
  let n = 0;
  for (const op of io.ops().filter((o) => o.status === "draft").sort((a, b) => a.at.localeCompare(b.at))) {
    if (scheduleAutoWhyNot(op, { sw: "on", mode: io.mode(), appliedToday, max: io.max() })) continue;
    // 사람이 그 사이에 눌렀으면 하지 않는다
    if (io.ops().find((x) => x.id === op.id)?.status !== "draft") continue;
    const at = io.stamp();
    io.approve(op.id, at);
    io.addAction({ at, kind: "schedule", op: "apply", id: op.id, what: op.kind, flight: op.flight });
    appliedToday++;
    n++;
  }
  return n;
}

// 자동 승인한 초안이 적용된 뒤 되돌려졌나(1분마다 한 번, 이미 센 것은 다시 세지 않는다)
export function scheduleMisfires(s: Pick<Snapshot, "tickets">, now = Date.now()): MisfireLine[] {
  const ops = loadScheduleOps();
  const seen = new Set(readMisfires().map(misfireKey));
  const out: MisfireLine[] = [];
  for (const op of ops) {
    const t = op.flight ? s.tickets.find((x) => x.key === op.flight) : undefined;
    const m = scheduleMisfireOf(op, ops, t, now);
    if (m && !seen.has(misfireKey(m))) out.push(m);
  }
  appendJsonl(MISFIRES(), out);
  return out;
}

// ── FLEET PLAN: 열린 제안을 서버가 실행한다(실행기는 승인 버튼과 같은 길) ──
export interface FleetAutoDeps {
  proposals: () => FleetProposal[];
  mode: () => "shadow" | "approval";
  run: (id: string) => Promise<{ status: number; body: Record<string, unknown> }>;
}
export async function runAutoFleet(deps: FleetAutoDeps, now = Date.now(), aircraftOf: (p: FleetProposal) => string = (p) => regKey(p.aircraft ?? "")): Promise<number> {
  const sw = loadAutoSwitch("fleetPlan");
  if (sw !== "on") return 0;
  const cfg = loadDispatchConfig();
  let n = 0;
  for (const p of deps.proposals().filter((x) => x.status === "open").sort((a, b) => a.at.localeCompare(b.at))) {
    const lines = readActions();
    const acts = recentActs(lines, now, "fleet");
    // 일치 기반 자동 LAUNCH(DISPATCH 카드)도 같은 하루 LAUNCH 상한을 같이 센다
    const dispatchLaunches = readAutoLines().filter((l) => l.op === "launch" && Date.now() - Date.parse(l.at) < 86_400_000).length;
    const aircraft = aircraftOf(p);
    const why = fleetAutoWhyNot(p, isManual(p), {
      sw,
      mode: deps.mode(),
      launchesToday: acts.filter((a) => isLaunching(a.what)).length + dispatchLaunches,
      launchMax: cfg.autoLaunchMax,
      actsToday: acts.length,
      actMax: cfg.autoApproveMax,
      cooling: coolingOf(lines, now),
      aircraftKey: aircraft,
    });
    if (why) continue;
    const r = await deps.run(p.id);
    const at = new Date().toISOString();
    const ok = r.status === 200;
    // 막힌 제안(조건이 바뀜, 상한, FUEL hold)은 실행기가 409로 거절한 것: 실패로 세지 않고 다음 주기에 다시 본다
    if (!ok && r.status === 409) continue;
    appendAction({ at, kind: "fleet", op: ok ? "apply" : "fail", id: p.id, what: p.kind, aircraft, ...(ok ? {} : { error: String(r.body.error ?? "").slice(0, 200) }) });
    if (ok) n++;
  }
  return n;
}

// 오작동 점검: STOP 뒤 LAUNCH, 놀고 있는 LAUNCH, RESTART 고리
export function fleetMisfires(s: Pick<Snapshot, "sessions">, now = Date.now(), teamPattern = loadDispatchConfig().teamPattern): MisfireLine[] {
  const launches = readRecords(now - 2 * 86_400_000)
    .filter((r) => r.kind === "fleet" && r.op === "launch" && r.ok)
    .map((r) => ({ aircraft: regKey((r as { aircraft: string }).aircraft, teamPattern), at: r.t }));
  const idleNow = (reg: string) => s.sessions.some((x) => x.status === "idle" && regKey(x.name, teamPattern) === reg);
  const seen = new Set(readMisfires().map(misfireKey));
  const out = fleetMisfiresOf(readActions(), { now, launches, idleNow }).filter((m) => !seen.has(misfireKey(m)));
  appendJsonl(MISFIRES(), out);
  return out;
}

export function mountAutonomyAuto(app: Hono) {
  // 하루별 오작동 수와 스위치(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/autonomy/auto", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 14));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const acts = readActions().filter((a) => a.at >= since);
    return c.json({
      switches: { schedule: loadAutoSwitch("schedule"), fleetPlan: loadAutoSwitch("fleetPlan") },
      misfires: misfiresByDay(readMisfires().filter((m) => m.at >= since)),
      applied: { schedule: acts.filter((a) => a.kind === "schedule" && a.op === "apply").length, fleet: acts.filter((a) => a.kind === "fleet" && a.op === "apply").length, fleetFailed: acts.filter((a) => a.kind === "fleet" && a.op === "fail").length },
      recent: readMisfires().slice(-20).reverse(),
    });
  });
}
