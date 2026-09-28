import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { landedOf, loadDispatchConfig, planDispatch, readFlightHistory } from "./dispatch.ts";
import { applyPatch, entryIntoService, FleetError, fleetView, loadFleet, nextRegistration, saveAircraft } from "./fleet.ts";
import {
  type ApproveOptions,
  COOLDOWN_MS,
  type DemandRow,
  type ExecStep,
  executionOf,
  isStale,
  judgedAtOf,
  PlanError,
  type SessionFact,
  type StepResult,
  type FleetCandidate,
  type FleetInputs,
  FLEET_PLAN_DEFAULTS,
  type FleetPlanOp,
  fleetPlanGateOf,
  fleetPlanOf,
  foldFleetPlan,
  persistOf,
  syncFleetPlan,
} from "./fleet-plan.ts";
import { loadLogbook } from "./logbook.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { allProposals, reservedOf } from "./proposals.ts";
import { readRecords, record } from "./recorder.ts";
import { activeWaypointsOf } from "./routes.ts";
import { type AgentRow, agentRows, launchAircraft, MAX_LAUNCHED, PERMISSION_MODES, stopAircraft } from "./session-control.ts";
import { readLinearProjects } from "./sources/linear-projects.ts";

// FLEET PLAN 실행부(docs/fleet.md 8.6): DISPATCH 주기(5분)마다 제안을 계산해 fleet-plan.jsonl에 적고,
// /api/fleet/plan으로 보여 준다. 그림자(1·2단계): 읽기만 하고, 세션을 띄우거나 멈추지 않는다.
// 지속 조건(두 주기, LAUNCH·ENTRY는 waitMin)은 메모리에 둔다 — 서버를 다시 띄우면 처음부터 센다.
// 3단계(8.7): 승인 운용(fleet-plan.json)에서는 SUPERVISOR의 승인이 FLEET 탭 버튼과 같은 코드로 바로 실행된다.

const DAY = 86_400_000;
const RECENT = 20;
const file = () => join(config.stateDir, "fleet-plan.jsonl");

function readOps(): FleetPlanOp[] {
  let text = "";
  try {
    text = readFileSync(file(), "utf8");
  } catch {
    return [];
  }
  const ops: FleetPlanOp[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      ops.push(JSON.parse(line));
    } catch {}
  }
  return ops;
}

function append(ops: FleetPlanOp[]) {
  if (!ops.length) return;
  mkdirSync(dirname(file()), { recursive: true });
  appendFileSync(file(), ops.map((o) => JSON.stringify(o) + "\n").join(""));
}

export const allFleetPlan = () => foldFleetPlan(readOps());

// ── 모드(8.7): ~/.local/state/atc/fleet-plan.json, 원자적으로 바꿔 쓴다. 없거나 모르는 값이면 그림자 ──
export type FleetPlanMode = "shadow" | "approval";
const modeFile = () => join(config.stateDir, "fleet-plan.json");
export function loadFleetPlanMode(file = modeFile()): FleetPlanMode {
  try {
    return JSON.parse(readFileSync(file, "utf8")).mode === "approval" ? "approval" : "shadow";
  } catch {
    return "shadow";
  }
}
function saveFleetPlanMode(mode: FleetPlanMode, file = modeFile()) {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...raw, mode }, null, 2) + "\n");
  renameSync(tmp, file);
}
// 지금 승인 운용이면 마지막 mode:approval 줄의 시각(30일 안). 모르면 null
function approvalSinceOf(now: number): string | null {
  const last = readRecords(now - 30 * DAY)
    .filter((r) => r.kind === "fleet-plan")
    .sort((a, b) => a.t.localeCompare(b.t))
    .at(-1);
  return last?.kind === "fleet-plan" && last.op === "mode:approval" ? last.t : null;
}

// 스냅샷, 등록부, LOGBOOK, FLIGHT RECORDER, claude agents로 입력을 만든다
export function inputsOf(s: Snapshot, rows: AgentRow[], now: number): FleetInputs {
  const cfg = loadDispatchConfig();
  const team = new RegExp(cfg.teamPattern, "i");
  const fleet = loadFleet();
  const logbook = loadLogbook();
  const proposals = allProposals();
  // SUPERVISOR 결정(2026-09-28): ATC FLIGHT도 수요로 센다 — candidateTeams가 아니라 모든 Linear 팀으로 planner를 돌린다
  const plan = planDispatch(
    s, readFlightHistory(), { ...cfg, candidateTeams: config.linearTeamKeys }, now, reservedOf(proposals, now), fleet,
    landedOf(logbook), logbook, activeWaypointsOf(readLinearProjects().milestones),
  );
  const aircraft = fleetView(s, fleet, cfg.teamPattern, logbook, now);
  const live = s.sessions.filter((x) => team.test(x.name) && x.status !== "dead");
  const liveNames = new Set(live.map((x) => x.name.toUpperCase()));
  const nameOf = new Map(s.sessions.map((x) => [x.id, x.name.toUpperCase()]));
  const records = readRecords(now - DAY);
  const los = new Map<string, string>();
  const conflicts = records
    .filter((r) => r.kind === "event")
    .map((r) => (r as { event: TrafficEvent }).event)
    .filter((e) => e.kind === "alert.raised" && e.alertKind === "conflict" && now - Date.parse(e.at) < DAY);
  for (const e of conflicts) for (const id of e.sessionIds ?? []) if (nameOf.get(id)) los.set(nameOf.get(id)!, e.at);
  const dwell = new Map<string, { op: "launch" | "stop"; at: string }>();
  for (const r of records) if (r.kind === "fleet" && r.ok && (r.op === "launch" || r.op === "stop")) dwell.set(r.aircraft.toUpperCase(), { op: r.op, at: r.t });
  const holders = new Map(s.claims.filter((c) => c.state === "active").map((c) => [c.workspacePath, nameOf.get(c.sessionId)]));
  return {
    aircraft,
    plan,
    sessions: rows
      .filter((r) => team.test(r.name ?? ""))
      .map((r) => ({ registration: (r.name ?? "").toUpperCase(), kind: r.kind, id: r.id, startedAt: typeof r.startedAt === "number" ? r.startedAt : null })),
    lastActive: new Map(live.map((x) => [x.name.toUpperCase(), x.lastActiveAt ?? x.startedAt])),
    nordo: new Set(s.sessions.filter((x) => team.test(x.name) && x.status === "dead" && !liveNames.has(x.name.toUpperCase())).map((x) => x.name.toUpperCase())),
    los,
    logbook,
    openPrs: new Set(s.pulls.map((p) => (p.standPath ? holders.get(p.standPath) : undefined)).filter(Boolean) as string[]),
    groundStops: new Set(s.atfm.groundStops.filter((g) => g.kind === "stop").map((g) => g.airport)),
    dwell,
    maxLaunched: MAX_LAUNCHED,
    nextRegistration: nextRegistration([...aircraft.map((a) => a.registration), ...s.sessions.map((x) => x.name)]),
    defaults: fleet.defaults,
    config: FLEET_PLAN_DEFAULTS,
    now,
  };
}

let pending: Record<string, string> = {};
let last: { at: string; candidates: FleetCandidate[]; demand: DemandRow[]; background: number; error: string | null } | null = null;
let inflight = false;

// DISPATCH 주기에 부른다. Linear·GitHub을 아직 못 읽었거나 claude agents를 못 읽으면 그 주기는 건너뛴다(열린 제안을 닫지 않는다)
export async function runFleetPlan(s: Snapshot, now = Date.now()) {
  if (inflight || !s.linear.fetchedAt || !s.github.fetchedAt) return;
  inflight = true;
  try {
    const rows = await agentRows();
    const { candidates, demand } = fleetPlanOf(inputsOf(s, rows, now));
    const p = persistOf(pending, candidates, now, FLEET_PLAN_DEFAULTS);
    pending = p.pending;
    append(syncFleetPlan(allFleetPlan(), candidates, p.ready, now, FLEET_PLAN_DEFAULTS));
    last = { at: new Date(now).toISOString(), candidates, demand, background: rows.filter((r) => r.kind === "background").length, error: null };
  } catch (e) {
    last = { at: new Date(now).toISOString(), candidates: last?.candidates ?? [], demand: last?.demand ?? [], background: last?.background ?? 0, error: (e as Error).message };
    console.error("[atc] fleet plan failed:", e);
  } finally {
    inflight = false;
  }
}

export function fleetPlanView(now = Date.now()) {
  const all = allFleetPlan();
  const current = new Map((last?.candidates ?? []).map((c) => [c.key, c]));
  const open = all
    .filter((p) => p.status === "open" || p.status === "executing")
    .map((p) => {
      // 지금 계산한 사유(같은 제안일 때만). 제안 뒤 숫자가 바뀌었을 수 있다
      const c = current.get(p.key);
      return { ...p, now: c && c.kind === p.kind && c.aircraft === p.aircraft ? c.reasons : null, stale: isStale(p, last?.candidates ?? [], last?.at ?? null, now) };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  const recent = all
    .filter((p) => p.status !== "open" && p.status !== "executing")
    .sort((a, b) => (b.closedAt ?? b.at).localeCompare(a.closedAt ?? a.at))
    .slice(0, RECENT);
  // 아직 제안이 되지 않은 후보(지속 조건을 기다리는 중). 판정 뒤 24시간 쉬는 것은 뺀다
  const openKeys = new Set(open.map((p) => `${p.key}|${p.kind}|${p.aircraft}`));
  const resting = new Set(
    all.filter((p) => {
      const at = judgedAtOf(p);
      return at !== null && now - Date.parse(at) < COOLDOWN_MS;
    }).map((p) => `${p.key}|${p.kind}|${p.aircraft}`),
  );
  const waiting = (last?.candidates ?? [])
    .filter((c) => !openKeys.has(`${c.key}|${c.kind}|${c.aircraft}`) && !resting.has(`${c.key}|${c.kind}|${c.aircraft}`))
    .map((c) => ({ key: c.key, kind: c.kind, aircraft: c.aircraft, airport: c.airport, since: pending[c.key] ?? null }));
  const mode = loadFleetPlanMode();
  return {
    mode,
    approvalSince: mode === "approval" ? approvalSinceOf(now) : null,
    background: { count: last?.background ?? null, max: MAX_LAUNCHED },
    permissionModes: PERMISSION_MODES,
    config: FLEET_PLAN_DEFAULTS,
    ranAt: last?.at ?? null,
    error: last?.error ?? null,
    demand: last?.demand ?? [],
    open,
    waiting,
    recent,
    gate: fleetPlanGateOf(all),
    now: new Date(now).toISOString(),
  };
}

// ── 승인하면 실행(8.7) ──

const executing = new Set<string>(); // 제안 id. 두 번 눌러도 한 번만 실행한다

async function runStep(step: ExecStep, by: string, getSnapshot: () => Promise<Snapshot>): Promise<StepResult> {
  const reg = step.registration;
  const t = () => new Date().toISOString();
  const patch = (op: "aog" | "return" | "retire", body: Record<string, unknown>): StepResult => {
    try {
      const fleet = loadFleet();
      const key = Object.keys(fleet.aircraft).find((k) => k.toUpperCase() === reg) ?? reg;
      saveAircraft(key, applyPatch(fleet.aircraft[key] ?? {}, body, fleet.defaults));
      record({ t: t(), kind: "fleet", op, aircraft: reg, by, ok: true });
      return { action: step.action, registration: reg, ok: true };
    } catch (e) {
      const error = (e as Error).message;
      record({ t: t(), kind: "fleet", op, aircraft: reg, by, ok: false, error });
      return { action: step.action, registration: reg, ok: false, error };
    }
  };
  switch (step.action) {
    case "entry": {
      const s = await getSnapshot();
      const cfg = loadDispatchConfig();
      try {
        const { registration, profile } = entryIntoService(
          loadFleet(), { registration: reg, configuration: step.configuration, base: step.base },
          s.sessions.filter((x) => x.status !== "dead").map((x) => x.name), cfg.teamPattern,
        );
        saveAircraft(registration, profile);
        record({ t: t(), kind: "fleet", op: "entry", aircraft: registration, by, ok: true });
        return { action: "entry", registration, ok: true };
      } catch (e) {
        if (!(e instanceof FleetError)) throw e;
        record({ t: t(), kind: "fleet", op: "entry", aircraft: reg, by, ok: false, error: e.message });
        return { action: "entry", registration: reg, ok: false, error: e.message };
      }
    }
    case "launch": {
      const r = await launchAircraft(await getSnapshot(), reg, { permissionMode: step.permissionMode, model: step.model }, by);
      return { action: "launch", registration: reg, ok: r.ok, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
    }
    case "stop": {
      const r = await stopAircraft(reg, by);
      if (r.ok) await goneFromAgents(reg);
      return { action: "stop", registration: reg, ok: r.ok, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
    }
    case "aog":
      return patch("aog", { aog: { reason: step.reason, until: step.until } });
    case "return":
      return patch("return", { aog: null });
    case "retire":
      return patch("retire", { retired: { reason: step.reason } });
  }
}

// RESTART: 멈춘 세션이 claude agents에서 빠질 때까지 잠깐 기다린다(곧바로 띄우면 "이미 떠 있음"으로 거절될 수 있다)
async function goneFromAgents(reg: string, tries = 10) {
  for (let n = 0; n < tries; n++) {
    const rows = await agentRows().catch(() => []);
    if (!rows.some((r) => (r.name ?? "").toUpperCase() === reg)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function mountFleetPlan(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/fleet/plan", (c) => c.json(fleetPlanView()));

  // 모드 전환. 승인 운용으로 켜는 것은 이 화면에서, 게이트가 준비됐을 때만. 그림자로 돌리는 것은 언제나 된다
  app.post("/api/fleet/plan/mode", async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const mode: FleetPlanMode = body.mode;
    if (mode !== "shadow" && mode !== "approval") return c.json({ error: "mode는 shadow | approval" }, 400);
    const screen = fromThisApp(c);
    if (mode === "approval") {
      if (!screen) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
      const gate = fleetPlanGateOf(allFleetPlan());
      if (!gate.ready) return c.json({ error: `그림자 게이트 전 — 판정 ${gate.decided}/${gate.target.decided}, 합의 ${gate.agreement === null ? "—" : Math.round(gate.agreement * 100) + "%"}` }, 409);
    }
    if (loadFleetPlanMode() !== mode) {
      saveFleetPlanMode(mode);
      record({ t: new Date().toISOString(), kind: "fleet-plan", op: `mode:${mode}`, by: screen ? "SUPERVISOR" : "API" });
    }
    return c.json({ mode: loadFleetPlanMode() });
  });

  // 그림자 판정: 동의·반대. SUPERVISOR가 FLEET 화면에서 누를 때만(관제 세션의 atcctl은 Origin이 없다).
  // 승인 운용에서 동의는 승인(실행)으로 한다 — 실행 없는 동의는 받지 않는다
  app.post("/api/fleet/plan/:id/verdict", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const id = c.req.param("id") ?? "";
    const body = await c.req.json().catch(() => ({}));
    const verdict = body.verdict;
    if (verdict !== "agree" && verdict !== "disagree") return c.json({ error: "verdict는 agree | disagree" }, 400);
    if (verdict === "agree" && loadFleetPlanMode() === "approval") return c.json({ error: "승인 운용 중 — 승인(실행)을 쓴다" }, 409);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const p = allFleetPlan().find((x) => x.id === id);
    if (!p) return c.json({ error: `FLEET PLAN에 없음: ${id}` }, 404);
    if (p.status !== "open" || executing.has(id)) return c.json({ error: `${id}는 이미 닫힘(${p.status})` }, 409);
    append([{ op: "verdict", id, verdict, by: "SUPERVISOR", ...(reason ? { reason } : {}), at: new Date().toISOString() }]);
    return c.json({ ok: true, proposal: allFleetPlan().find((x) => x.id === id) });
  });

  // 승인(실행). 최근 주기와 8.5 거절 조건으로 다시 확인하고, 단계를 차례로 실행해 결과를 적는다
  app.post("/api/fleet/plan/:id/approve", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const id = c.req.param("id") ?? "";
    if (executing.has(id)) return c.json({ error: `${id}는 실행 중` }, 409);
    const body = await c.req.json().catch(() => ({}));
    const p = allFleetPlan().find((x) => x.id === id);
    if (!p) return c.json({ error: `FLEET PLAN에 없음: ${id}` }, 404);
    executing.add(id);
    try {
      const now = Date.now();
      const s = await getSnapshot();
      const cfg = loadDispatchConfig();
      const team = new RegExp(cfg.teamPattern, "i");
      const fleet = loadFleet();
      const rows = await agentRows();
      const sessions: SessionFact[] = rows
        .filter((r) => team.test(r.name ?? ""))
        .map((r) => ({ registration: (r.name ?? "").toUpperCase(), kind: r.kind, id: r.id, startedAt: typeof r.startedAt === "number" ? r.startedAt : null }));
      const lastLaunch = new Map<string, { permissionMode?: string; model?: string }>();
      for (const r of readRecords(now - 30 * DAY)) if (r.kind === "fleet" && r.op === "launch" && r.ok) lastLaunch.set(r.aircraft.toUpperCase(), { permissionMode: r.permissionMode, model: r.model });
      let plan: { steps: ExecStep[]; options: ApproveOptions };
      try {
        plan = executionOf(p, body, {
          mode: loadFleetPlanMode(),
          latest: last?.candidates ?? [],
          ranAt: last?.at ?? null,
          aircraft: fleetView(s, fleet, cfg.teamPattern, loadLogbook(), now),
          sessions,
          taken: [...Object.keys(fleet.aircraft), ...s.sessions.map((x) => x.name)],
          lastLaunch,
          now,
        });
      } catch (e) {
        if (e instanceof PlanError) return c.json({ error: e.message }, e.status as 409);
        throw e;
      }
      append([{ op: "approve", id, by: "SUPERVISOR", options: plan.options, at: new Date().toISOString() }]);
      const by = `FLEET PLAN ${id}`;
      const steps: StepResult[] = [];
      for (const step of plan.steps) {
        const r = await runStep(step, by, getSnapshot);
        steps.push(r);
        if (!r.ok) break; // 앞 단계가 실패하면 멈춘다. 된 단계는 그대로 남고 기록에 적힌다
      }
      const ok = steps.length === plan.steps.length && steps.every((x) => x.ok);
      append([{ op: "executed", id, ok, steps, at: new Date().toISOString() }]);
      return c.json({ ok, steps, proposal: allFleetPlan().find((x) => x.id === id) }, ok ? 200 : 502);
    } catch (e) {
      // 예상 못 한 오류: 실행 중으로 남지 않게 실패로 닫는다
      if (allFleetPlan().find((x) => x.id === id)?.status === "executing") {
        append([{ op: "executed", id, ok: false, steps: [], at: new Date().toISOString() }]);
      }
      return c.json({ error: (e as Error).message }, 500);
    } finally {
      executing.delete(id);
    }
  });
}
