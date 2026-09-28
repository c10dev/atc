import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { landedOf, loadDispatchConfig, planDispatch, readFlightHistory } from "./dispatch.ts";
import { fleetView, loadFleet, nextRegistration } from "./fleet.ts";
import {
  COOLDOWN_MS,
  type DemandRow,
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
import { readRecords } from "./recorder.ts";
import { activeWaypointsOf } from "./routes.ts";
import { type AgentRow, agentRows, MAX_LAUNCHED } from "./session-control.ts";
import { readLinearProjects } from "./sources/linear-projects.ts";

// FLEET PLAN 실행부(docs/fleet.md 8.6): DISPATCH 주기(5분)마다 제안을 계산해 fleet-plan.jsonl에 적고,
// /api/fleet/plan으로 보여 준다. 그림자(1·2단계): 읽기만 하고, 세션을 띄우거나 멈추지 않는다.
// 지속 조건(두 주기, LAUNCH·ENTRY는 waitMin)은 메모리에 둔다 — 서버를 다시 띄우면 처음부터 센다.

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
  for (const r of records) if (r.kind === "fleet" && r.ok) dwell.set(r.aircraft.toUpperCase(), { op: r.op, at: r.t });
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
let last: { at: string; candidates: FleetCandidate[]; demand: DemandRow[]; error: string | null } | null = null;
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
    last = { at: new Date(now).toISOString(), candidates, demand, error: null };
  } catch (e) {
    last = { at: new Date(now).toISOString(), candidates: last?.candidates ?? [], demand: last?.demand ?? [], error: (e as Error).message };
    console.error("[atc] fleet plan failed:", e);
  } finally {
    inflight = false;
  }
}

export function fleetPlanView(now = Date.now()) {
  const all = allFleetPlan();
  const current = new Map((last?.candidates ?? []).map((c) => [c.key, c]));
  const open = all
    .filter((p) => p.status === "open")
    .map((p) => {
      // 지금 계산한 사유(같은 제안일 때만). 제안 뒤 숫자가 바뀌었을 수 있다
      const c = current.get(p.key);
      return { ...p, now: c && c.kind === p.kind && c.aircraft === p.aircraft ? c.reasons : null };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  const recent = all
    .filter((p) => p.status !== "open")
    .sort((a, b) => (b.closedAt ?? b.at).localeCompare(a.closedAt ?? a.at))
    .slice(0, RECENT);
  // 아직 제안이 되지 않은 후보(지속 조건을 기다리는 중). 판정 뒤 24시간 쉬는 것은 뺀다
  const openKeys = new Set(open.map((p) => `${p.key}|${p.kind}|${p.aircraft}`));
  const resting = new Set(all.filter((p) => p.verdict && now - Date.parse(p.verdict.at) < COOLDOWN_MS).map((p) => `${p.key}|${p.kind}|${p.aircraft}`));
  const waiting = (last?.candidates ?? [])
    .filter((c) => !openKeys.has(`${c.key}|${c.kind}|${c.aircraft}`) && !resting.has(`${c.key}|${c.kind}|${c.aircraft}`))
    .map((c) => ({ key: c.key, kind: c.kind, aircraft: c.aircraft, airport: c.airport, since: pending[c.key] ?? null }));
  return {
    mode: "shadow" as const,
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

export function mountFleetPlan(app: Hono) {
  app.get("/api/fleet/plan", (c) => c.json(fleetPlanView()));

  // 그림자 판정: 동의·반대. SUPERVISOR가 FLEET 화면에서 누를 때만(관제 세션의 atcctl은 Origin이 없다)
  app.post("/api/fleet/plan/:id/verdict", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const id = c.req.param("id") ?? "";
    const body = await c.req.json().catch(() => ({}));
    const verdict = body.verdict;
    if (verdict !== "agree" && verdict !== "disagree") return c.json({ error: "verdict는 agree | disagree" }, 400);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const p = allFleetPlan().find((x) => x.id === id);
    if (!p) return c.json({ error: `FLEET PLAN에 없음: ${id}` }, 404);
    if (p.status !== "open") return c.json({ error: `${id}는 이미 닫힘(${p.status})` }, 409);
    append([{ op: "verdict", id, verdict, by: "SUPERVISOR", ...(reason ? { reason } : {}), at: new Date().toISOString() }]);
    return c.json({ ok: true, proposal: allFleetPlan().find((x) => x.id === id) });
  });
}
