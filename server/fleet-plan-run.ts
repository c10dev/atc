import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { authStatusOf } from "./account-health.ts";
import { accountFolders, observedLabelsOn } from "./accounts.ts";
import { effectiveLaunchAccount, launchSettingOf } from "./launch-account.ts";
import { reportRate } from "./judges/store.ts";
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
  type FleetProposal,
  fleetPlanGateOf,
  fleetPlanOf,
  fuelExpiryOf,
  foldFleetPlan,
  isManual,
  persistOf,
  syncFleetPlan,
} from "./fleet-plan.ts";
import { readPrices } from "./fuel-prices.ts";
import type { FuelRemaining } from "./fuel-remaining.ts";
import { aircraftContexts } from "./fuel-run.ts";
import { loadLogbook } from "./logbook.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { allProposals, reservedOf } from "./proposals.ts";
import { readRecords, record } from "./recorder.ts";
import { autoRepositionOf, parseReposition, type RepositionConfig, type RepositionEvent, type RepositionMode, REPOSITION_MODES } from "./reposition.ts";
import { fleetKeyOf, regKey } from "./registration.ts";
import { activeWaypointsOf } from "./routes.ts";
import { type AgentRow, agentRows, launchAccountRefusal, launchAircraft, liveRowsOf, MAX_LAUNCHED, PERMISSION_MODES, rowOriginOf, stopAircraft } from "./session-control.ts";
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
// ── REPOSITION 모드(ATC-179): 같은 파일의 `reposition`(off·shadow·approval·auto, 기본 shadow)과 `repositionDailyMax`(기본 4) ──
export function loadReposition(file = modeFile()): RepositionConfig {
  try {
    return parseReposition(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseReposition(null);
  }
}
function saveRepositionRaw(patch: Record<string, unknown>, file = modeFile()) {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...raw, ...patch }, null, 2) + "\n");
  renameSync(tmp, file);
}
// 스위치 바꿈은 FLIGHT RECORDER에 남는다(`reposition` `mode`). auto로 올리는 것은 SUPERVISOR만(설정 창), 내리는 것은 flapping 때 atc도 한다
export function setRepositionMode(mode: RepositionMode, by = "SUPERVISOR", reason?: string) {
  const cur = loadReposition();
  if (cur.mode === mode) return;
  saveRepositionRaw({ reposition: mode });
  record({ t: new Date().toISOString(), kind: "reposition", op: "mode", by, from: cur.mode, to: mode, ...(reason ? { reason } : {}) });
}
// 이 제안을 승인(실행)할 수 있는 모드인가: REPOSITION은 자기 스위치(approval·auto), 나머지는 FLEET PLAN 모드
export const approvalModeOf = (kind: string): "shadow" | "approval" =>
  kind === "REPOSITION" ? (["approval", "auto"].includes(loadReposition().mode) ? "approval" : "shadow") : loadFleetPlanMode();

// 지금 승인 운용이면 마지막 mode:approval 줄의 시각(30일 안). 모르면 null
function approvalSinceOf(now: number): string | null {
  const last = readRecords(now - 30 * DAY)
    .filter((r) => r.kind === "fleet-plan")
    .sort((a, b) => a.t.localeCompare(b.t))
    .at(-1);
  return last?.kind === "fleet-plan" && last.op === "mode:approval" ? last.t : null;
}

// 스냅샷, 등록부, LOGBOOK, FLIGHT RECORDER, claude agents로 입력을 만든다
// AIRCRAFT의 LAUNCH ACCOUNT(ATC-239). 설정이 없거나 등록부에 없는 라벨이면 null(프로필 home을 쓴다)
export function launchAccountOfFleet(fleet: { launchAccount?: { aircraft?: string } }, accountLogins: FleetInputs["accountLogins"] = []): string | null {
  const l = fleet.launchAccount?.aircraft;
  return l && accountLogins.some((x) => x.label === l) ? l : null;
}

export function inputsOf(s: Snapshot, rows: AgentRow[], now: number, accountLogins: FleetInputs["accountLogins"] = []): FleetInputs {
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
  const regOf = (name: string | null | undefined) => regKey(name, cfg.teamPattern); // `Team G`도 TEAM_G(ATC-67)
  const liveNames = new Set(live.map((x) => regOf(x.name)));
  const nameOf = new Map(s.sessions.map((x) => [x.id, regOf(x.name)]));
  const records = readRecords(now - DAY);
  const los = new Map<string, string>();
  const conflicts = records
    .filter((r) => r.kind === "event")
    .map((r) => (r as { event: TrafficEvent }).event)
    .filter((e) => e.kind === "alert.raised" && e.alertKind === "conflict" && now - Date.parse(e.at) < DAY);
  for (const e of conflicts) for (const id of e.sessionIds ?? []) if (nameOf.get(id)) los.set(nameOf.get(id)!, e.at);
  const dwell = new Map<string, { op: "launch" | "stop"; at: string }>();
  for (const r of records) if (r.kind === "fleet" && r.ok && (r.op === "launch" || r.op === "stop")) dwell.set(regOf(r.aircraft), { op: r.op, at: r.t });
  const repositions: NonNullable<FleetInputs["repositions"]> = records.flatMap((r) =>
    r.kind === "fleet" && r.op === "reposition" && r.from && r.to ? [{ aircraft: regOf(r.aircraft), from: r.from, to: r.to, at: r.t, ok: r.ok, baseChanged: r.ok || r.stage === "launch" }] : [],
  );
  const holders = new Map(s.claims.filter((c) => c.state === "active").map((c) => [c.workspacePath, nameOf.get(c.sessionId)]));
  return {
    aircraft,
    plan,
    sessions: rows
      .filter((r) => team.test(r.name ?? ""))
      .map((r) => ({ registration: regOf(r.name), kind: r.kind, id: r.id, startedAt: typeof r.startedAt === "number" ? r.startedAt : null, origin: rowOriginOf(r) })),
    lastActive: new Map(live.map((x) => [regOf(x.name), x.lastActiveAt ?? x.startedAt])),
    nordo: new Set(s.sessions.filter((x) => team.test(x.name) && x.status === "dead" && !liveNames.has(regOf(x.name))).map((x) => regOf(x.name))),
    los,
    logbook,
    openPrs: new Set(s.pulls.map((p) => (p.standPath ? holders.get(p.standPath) : undefined)).filter(Boolean) as string[]),
    groundStops: new Set(s.atfm.groundStops.filter((g) => g.kind === "stop").map((g) => g.airport)),
    dwell,
    repositions,
    maxLaunched: MAX_LAUNCHED,
    nextRegistration: nextRegistration([...aircraft.map((a) => a.registration), ...s.sessions.map((x) => x.name)]),
    defaults: fleet.defaults,
    config: FLEET_PLAN_DEFAULTS,
    now,
    fuelAccounts: s.fuelAccounts ?? [], // FUEL REMAINING per ACCOUNT(ATC-63). 관제 세션만 있는 ACCOUNT도
    accountLogins, // 등록된 ACCOUNT와 로그인(ATC-147). ENTRY가 새 AIRCRAFT를 올릴 ACCOUNT를 고른다
    launchAccount: launchAccountOfFleet(fleet, accountLogins), // LAUNCH ACCOUNT(ATC-239): 등록부에 있는 AIRCRAFT용 라벨. ACCOUNT CHANGE의 효과 있는 home, ENTRY·LAUNCH의 ACCOUNT
    context: aircraftContexts(s.sessions, cfg.teamPattern, now), // CONTEXT SIZE(ATC-69): REFRESH
    prices: readPrices().table,
  };
}

let pending: Record<string, string> = {};
let last: { at: string; candidates: FleetCandidate[]; demand: DemandRow[]; background: number; error: string | null } | null = null;
let inflight = false;
// 시험용: 최근 주기 결과를 넣고 승인 실행기를 직접 부른다(fleet-plan-run.test.ts). 운영 코드는 쓰지 않는다
export const testHooks = {
  setLast: (candidates: FleetCandidate[], at: string) => void (last = { at, candidates, demand: [], background: 0, error: null }),
  runApproval: (id: string, body: Record<string, unknown>, who: "supervisor" | "auto", getSnapshot: () => Promise<Snapshot>) => runApproval(id, body, who, getSnapshot),
};
let autoRun: ((id: string) => Promise<ApprovalResult>) | null = null; // mountFleetPlan이 채운다(getSnapshot을 잡은 실행기)
const pendingShadow: Record<string, string> = {}; // shadow: 같은 짝의 would를 한 시간에 한 번만

function wouldReposition(seen: Record<string, string>, cands: FleetCandidate[], now: number) {
  for (const c of cands) {
    const k = `${c.aircraft}|${c.from}|${c.airport}`;
    if (seen[k] && now - Date.parse(seen[k]) < 3_600_000) continue;
    seen[k] = new Date(now).toISOString();
    record({ t: seen[k], kind: "reposition", op: "would", aircraft: c.aircraft ?? "", from: c.from ?? "", to: c.airport ?? "", reasons: c.reasons.slice(0, 2).map((r) => r.detail) });
  }
}

async function autoReposition(fresh: FleetProposal[], flaps: { aircraft: string; from: string; to: string }[], events: RepositionEvent[], rep: RepositionConfig, now: number) {
  const d = autoRepositionOf({ ready: fresh, flaps, events, now, dailyMax: rep.dailyMax });
  if (d.toApproval) {
    setRepositionMode("approval", "auto", d.toApproval); // flapping: auto를 멈춘다. 알림은 이 기록에서
    console.warn(`[atc] reposition auto → approval: ${d.toApproval}`);
    return;
  }
  for (const p of d.act) await autoRun?.(p.id);
}

// 등록된 ACCOUNT마다 로그인 여부(ATC-147). 등록부가 없으면 빈 목록. loggedIn만 남기고 60초 캐시(account-health)
// running·maxLaunched는 ACCOUNT CHANGE의 옮길 ACCOUNT 상한 검사용(ATC-148): 그 폴더에서 읽은 백그라운드 세션 수(STALE 뺌)
async function accountLoginsOf(rows: AgentRow[] = []): Promise<NonNullable<FleetInputs["accountLogins"]>> {
  const folders = accountFolders();
  if (!observedLabelsOn(folders)) return [];
  return Promise.all(
    folders.map(async (f) => ({
      label: f.label,
      loggedIn: (await authStatusOf(f.dir)).loggedIn,
      ...(f.maxLaunched ? { maxLaunched: f.maxLaunched } : {}),
      running: rows.filter((r) => r.kind === "background" && !r.stale && r.account === f.label).length,
    })),
  );
}

// DISPATCH 주기에 부른다. Linear·GitHub을 아직 못 읽었거나 claude agents를 못 읽으면 그 주기는 건너뛴다(열린 제안을 닫지 않는다)
export async function runFleetPlan(s: Snapshot, now = Date.now()) {
  if (inflight || !s.linear.fetchedAt || !s.github.fetchedAt) return;
  inflight = true;
  try {
    // STALE 줄(ATC-93)은 살아 있는 세션이 아니다: STOP·RESTART를 내지 않고 상한에 세지 않는다
    const rows = liveRowsOf(await agentRows());
    const inputs = inputsOf(s, rows, now, await accountLoginsOf(rows));
    const plan = fleetPlanOf(inputs);
    const rep = loadReposition();
    // REPOSITION(ATC-179): off는 아무것도, shadow는 지속 조건을 채운 것을 would로만 남긴다. approval·auto만 카드가 된다
    const isRep = (c: FleetCandidate) => c.kind === "REPOSITION";
    const candidates = rep.mode === "approval" || rep.mode === "auto" ? plan.candidates : plan.candidates.filter((c) => !isRep(c));
    const demand = plan.demand;
    const p = persistOf(pending, candidates, now, FLEET_PLAN_DEFAULTS);
    pending = p.pending;
    if (rep.mode === "shadow") wouldReposition(pendingShadow, plan.candidates.filter(isRep), now);
    const before = new Set(allFleetPlan().map((x) => x.id));
    append(syncFleetPlan(allFleetPlan(), candidates, p.ready, now, FLEET_PLAN_DEFAULTS, (x) => fuelExpiryOf(inputs, x)));
    // 최근 주기 결과를 먼저 둔다: 승인 실행기가 "이 제안을 최근 주기가 여전히 내나"(isStale)를 이것으로 본다
    last = { at: new Date(now).toISOString(), candidates, demand, background: rows.filter((r) => r.kind === "background").length, error: null };
    // auto: 새로 열린 REPOSITION 카드를 가드(하루 상한·flapping) 아래에서 곧바로 실행한다
    if (rep.mode === "auto") await autoReposition(allFleetPlan().filter((x) => !before.has(x.id) && x.kind === "REPOSITION" && x.status === "open"), plan.flaps, inputs.repositions ?? [], rep, now);
  } catch (e) {
    last = { at: new Date(now).toISOString(), candidates: last?.candidates ?? [], demand: last?.demand ?? [], background: last?.background ?? 0, error: (e as Error).message };
    console.error("[atc] fleet plan failed:", e);
  } finally {
    inflight = false;
  }
}

// 열린 제안과 옛것인지(SUPERVISOR QUEUE, ATC-194). fleetPlanView의 open과 같은 규칙이고 다른 것은 읽지 않는다
export const openFleetPlanNow = (now = Date.now()) =>
  allFleetPlan()
    .filter((p) => p.status === "open")
    .map((p) => ({ ...p, stale: isStale(p, last?.candidates ?? [], last?.at ?? null, now) }));

// fuel: 지금 스냅샷의 FUEL REMAINING per ACCOUNT(ATC-63). 계획 주기(5분)를 기다리지 않고 보인다
export function fleetPlanView(now = Date.now(), fuel: FuelRemaining[] = []) {
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
    reposition: { ...loadReposition(), modes: REPOSITION_MODES, movedToday: repositionEventsOf(now).filter((e) => e.ok && now - Date.parse(e.at) < DAY).length },
    ranAt: last?.at ?? null,
    error: last?.error ?? null,
    demand: last?.demand ?? [],
    fuel, // FUEL REMAINING per ACCOUNT(ATC-63): 블록의 "weekly-usage line"
    open,
    waiting,
    recent,
    gate: fleetPlanGateOf(all),
    judges: { report: reportRate() }, // REPORT 판정(ATC-89, 그림자 전용)의 SUPERVISOR 표시 일치율
    now: new Date(now).toISOString(),
  };
}

// 최근 24시간의 옮김(FLIGHT RECORDER)
const repositionEventsOf = (now: number): RepositionEvent[] =>
  readRecords(now - DAY).flatMap((r) => (r.kind === "fleet" && r.op === "reposition" && r.from && r.to ? [{ aircraft: r.aircraft, from: r.from, to: r.to, at: r.t, ok: r.ok }] : []));

// ── 승인하면 실행(8.7) ──

const executing = new Set<string>(); // 제안 id. 두 번 눌러도 한 번만 실행한다

async function runStep(step: ExecStep, by: string, getSnapshot: () => Promise<Snapshot>): Promise<StepResult> {
  const reg = step.registration;
  const t = () => new Date().toISOString();
  const patch = (op: "aog" | "return" | "retire", body: Record<string, unknown>): StepResult => {
    try {
      const fleet = loadFleet();
      const key = fleetKeyOf(Object.keys(fleet.aircraft), reg) ?? reg;
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
          loadFleet(), { registration: reg, configuration: step.configuration, base: step.base, ...(step.account ? { account: step.account } : {}) },
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
      const r = await launchAircraft(await getSnapshot(), reg, { permissionMode: step.permissionMode, model: step.model, ...(step.account ? { account: step.account } : {}) }, by);
      return { action: "launch", registration: reg, ok: r.ok, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
    }
    case "stop": {
      const r = await stopAircraft(reg, by);
      if (r.ok) await goneFromAgents(reg);
      return { action: "stop", registration: reg, ok: r.ok, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
    }
    case "base": {
      // REPOSITION(ATC-179): 옛 세션은 이미 멈췄다. 새 base를 fleet.json에 쓰고(FLEET 탭과 같은 쓰기), 이어서 그 AIRPORT 저장소에서 LAUNCH한다
      try {
        const fleet = loadFleet();
        const key = fleetKeyOf(Object.keys(fleet.aircraft), reg) ?? reg;
        saveAircraft(key, applyPatch(fleet.aircraft[key] ?? {}, { base: step.base }, fleet.defaults));
        return { action: "base", registration: reg, ok: true };
      } catch (e) {
        return { action: "base", registration: reg, ok: false, error: (e as Error).message };
      }
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
    const rows = liveRowsOf(await agentRows().catch(() => []));
    if (!rows.some((r) => regKey(r.name) === regKey(reg))) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function mountFleetPlan(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/fleet/plan", async (c) => c.json(fleetPlanView(Date.now(), (await getSnapshot()).fuelAccounts ?? [])));

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
  // 승인 운용에서 동의는 승인(실행)으로 한다 — 실행 없는 동의는 받지 않는다. 사람이 하는 제안(데스크톱·터미널 세션의 REFRESH)만 "했음"으로 동의한다
  app.post("/api/fleet/plan/:id/verdict", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const id = c.req.param("id") ?? "";
    const body = await c.req.json().catch(() => ({}));
    const verdict = body.verdict;
    if (verdict !== "agree" && verdict !== "disagree") return c.json({ error: "verdict는 agree | disagree" }, 400);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const p = allFleetPlan().find((x) => x.id === id);
    if (!p) return c.json({ error: `FLEET PLAN에 없음: ${id}` }, 404);
    if (verdict === "agree" && approvalModeOf(p.kind) === "approval" && !isManual(p)) return c.json({ error: "승인 운용 중 — 승인(실행)을 쓴다" }, 409);
    if (p.status !== "open" || executing.has(id)) return c.json({ error: `${id}는 이미 닫힘(${p.status})` }, 409);
    append([{ op: "verdict", id, verdict, by: "SUPERVISOR", ...(reason ? { reason } : {}), at: new Date().toISOString() }]);
    return c.json({ ok: true, proposal: allFleetPlan().find((x) => x.id === id) });
  });

  // 승인(실행). 최근 주기와 8.5 거절 조건으로 다시 확인하고, 단계를 차례로 실행해 결과를 적는다
  app.post("/api/fleet/plan/:id/approve", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const r = await runApproval(c.req.param("id") ?? "", await c.req.json().catch(() => ({})), "supervisor", getSnapshot);
    return c.json(r.body, r.status as 200);
  });
  // REPOSITION auto(ATC-179): 같은 실행기를 by "auto"로 부른다(새 길이 아니다)
  autoRun = (id) => runApproval(id, {}, "auto", getSnapshot);
}

export interface ApprovalResult {
  status: number;
  body: Record<string, unknown>;
}

async function runApproval(id: string, body: Record<string, unknown>, who: "supervisor" | "auto", getSnapshot: () => Promise<Snapshot>): Promise<ApprovalResult> {
  const fail = (status: number, error: string): ApprovalResult => ({ status, body: { error } });
  if (executing.has(id)) return fail(409, `${id}는 실행 중`);
  const p = allFleetPlan().find((x) => x.id === id);
  if (!p) return fail(404, `FLEET PLAN에 없음: ${id}`);
  executing.add(id);
  try {
    const now = Date.now();
    const s = await getSnapshot();
    const cfg = loadDispatchConfig();
    const team = new RegExp(cfg.teamPattern, "i");
    const fleet = loadFleet();
    const rows = liveRowsOf(await agentRows());
    const sessions: SessionFact[] = rows
      .filter((r) => team.test(r.name ?? ""))
      .map((r) => ({ registration: regKey(r.name, cfg.teamPattern), kind: r.kind, id: r.id, startedAt: typeof r.startedAt === "number" ? r.startedAt : null, origin: rowOriginOf(r) }));
    const lastLaunch = new Map<string, { permissionMode?: string; model?: string }>();
    for (const r of readRecords(now - 30 * DAY)) if (r.kind === "fleet" && r.op === "launch" && r.ok) lastLaunch.set(regKey(r.aircraft, cfg.teamPattern), { permissionMode: r.permissionMode, model: r.model });
    let plan: { steps: ExecStep[]; options: ApproveOptions };
    try {
      plan = executionOf(p, body, {
        mode: approvalModeOf(p.kind),
        latest: last?.candidates ?? [],
        ranAt: last?.at ?? null,
        aircraft: fleetView(s, fleet, cfg.teamPattern, loadLogbook(), now),
        sessions,
        taken: [...Object.keys(fleet.aircraft), ...s.sessions.map((x) => x.name)],
        lastLaunch,
        airports: s.airports.map((a) => ({ code: a.code, repo: a.repo })),
        now,
      });
    } catch (e) {
      if (e instanceof PlanError) return fail(e.status, e.message);
      throw e;
    }
    const reg = regKey(p.aircraft ?? "", cfg.teamPattern);
    // ACCOUNT CHANGE(ATC-148)·REPOSITION(ATC-179): 새 ACCOUNT·새 저장소가 거절할 것이면 옛 세션을 멈추기 전에 알린다(STOP만 되고 LAUNCH가 안 되는 일이 없게)
    const moveTo = p.kind === "ACCOUNT CHANGE" ? p.account : undefined;
    if (moveTo) {
      const refusal = await launchAccountRefusal(moveTo, s.fuelAccounts);
      if (refusal) return fail(409, `${refusal} — ${p.aircraft}는 멈추지 않았다`);
    }
    if (p.kind === "REPOSITION") {
      // 같은 ACCOUNT로 띄우므로 그 ACCOUNT가 로그인·FUEL hold 때문에 거절하면 멈추지 않는다
      const home = fleetView(s, fleet, cfg.teamPattern, loadLogbook(), now).find((a) => a.registration === reg)?.account;
      // 이름 없는 LAUNCH는 LAUNCH ACCOUNT가 있으면 거기서 뜬다(ATC-239): 거절 검사도 그 ACCOUNT로
      const folders = accountFolders();
      const setAcct = effectiveLaunchAccount(launchSettingOf(fleet.launchAccount), "aircraft", observedLabelsOn(folders) ? folders.map((f) => f.label) : []).label;
      const target = setAcct ?? home;
      const refusal = target ? await launchAccountRefusal(target, s.fuelAccounts) : null;
      if (refusal) {
        refuseReposition(p, reg, who, `${refusal} — ${p.aircraft}는 멈추지 않았다`, now);
        return fail(409, `${refusal} — ${p.aircraft}는 멈추지 않았다`);
      }
    }
    append([{ op: "approve", id, by: who === "auto" ? "auto" : "SUPERVISOR", options: plan.options, at: new Date().toISOString() }]);
    const by = `FLEET PLAN ${id}`;
    const steps: StepResult[] = [];
    const fromAccount = moveTo ? rows.find((r) => regKey(r.name, cfg.teamPattern) === regKey(p.aircraft ?? "", cfg.teamPattern))?.account : undefined;
    for (const step of plan.steps) {
      const r = await runStep(step, by, getSnapshot);
      steps.push(r);
      if (!r.ok) break; // 앞 단계가 실패하면 멈춘다. 된 단계는 그대로 남고 기록에 적힌다
    }
    const ok = steps.length === plan.steps.length && steps.every((x) => x.ok);
    // 옮기기는 STOP과 LAUNCH를 한 사건으로도 남긴다(FUEL LEAK의 ACCOUNT CHANGE가 새 세션을 알아본다)
    if (moveTo) {
      const launched = steps.find((x) => x.action === "launch" && x.ok);
      record({ t: new Date().toISOString(), kind: "fleet", op: "account-change", aircraft: regKey(p.aircraft ?? "", cfg.teamPattern), by, ok, ...(fromAccount ? { from: fromAccount } : {}), to: moveTo, ...(launched?.jobId ? { jobId: launched.jobId } : {}), ...(!ok ? { error: steps.find((x) => !x.ok)?.error } : {}) });
    }
    // REPOSITION: STOP·base·LAUNCH를 한 사건(`reposition`)으로도 남긴다. by는 supervisor | auto. LAUNCH가 실패해도 base는 바뀐 채다(stage로 말한다)
    if (p.kind === "REPOSITION") {
      const launched = steps.find((x) => x.action === "launch" && x.ok);
      const failed = steps.find((x) => !x.ok);
      const stage = failed ? (failed.action === "stop" ? "stop" : failed.action === "base" ? "base" : "launch") : undefined;
      record({ t: new Date().toISOString(), kind: "fleet", op: "reposition", aircraft: reg, by: who, ok, from: p.from, to: p.airport ?? undefined, ...(launched?.jobId ? { jobId: launched.jobId } : {}), proposal: id, ...(stage ? { stage } : {}), ...(failed?.error ? { error: failed.error } : {}) });
    }
    append([{ op: "executed", id, ok, steps, at: new Date().toISOString() }]);
    return { status: ok ? 200 : 502, body: { ok, steps, proposal: allFleetPlan().find((x) => x.id === id) } };
  } catch (e) {
    // 예상 못 한 오류: 실행 중으로 남지 않게 실패로 닫는다
    if (allFleetPlan().find((x) => x.id === id)?.status === "executing") {
      append([{ op: "executed", id, ok: false, steps: [], at: new Date().toISOString() }]);
    }
    return fail(500, (e as Error).message);
  } finally {
    executing.delete(id);
  }
}

// APPLY NOW(ATC-244): 쉬는 AIRCRAFT 하나를 ACCOUNT CHANGE와 같은 길로 옮긴다 — 목표 ACCOUNT를 STOP 전에 확인하고, STOP → 사라짐 확인 → 그 ACCOUNT에서 CREW BRIEFING으로 LAUNCH(마지막 LAUNCH의 옵션), account-change 한 줄.
// 이 세션이 지금 FLIGHT 사이인지는 부르는 쪽(applyNowPlanOf, 매번 새로 읽음)이 정한다
export async function moveAircraftAccount(reg: string, to: string, by: string, getSnapshot: () => Promise<Snapshot>): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const s = await getSnapshot();
  const cfg = loadDispatchConfig();
  const refusal = await launchAccountRefusal(to, s.fuelAccounts);
  if (refusal) return { ok: false, error: `${refusal} — ${reg}는 멈추지 않았다` };
  const now = Date.now();
  const rows = liveRowsOf(await agentRows());
  const fromAccount = rows.find((r) => regKey(r.name, cfg.teamPattern) === regKey(reg, cfg.teamPattern))?.account;
  let opts: { permissionMode?: string; model?: string } | undefined;
  for (const r of readRecords(now - 30 * DAY)) if (r.kind === "fleet" && r.op === "launch" && r.ok && regKey(r.aircraft, cfg.teamPattern) === regKey(reg, cfg.teamPattern)) opts = { permissionMode: r.permissionMode, model: r.model };
  const steps: StepResult[] = [];
  for (const step of [{ action: "stop", registration: reg }, { action: "launch", registration: reg, permissionMode: opts?.permissionMode ?? "auto", model: opts?.model ?? null, account: to }] as ExecStep[]) {
    const r = await runStep(step, by, getSnapshot);
    steps.push(r);
    if (!r.ok) break;
  }
  const ok = steps.length === 2 && steps.every((x) => x.ok);
  const launched = steps.find((x) => x.action === "launch" && x.ok);
  const failed = steps.find((x) => !x.ok);
  record({ t: new Date().toISOString(), kind: "fleet", op: "account-change", aircraft: regKey(reg, cfg.teamPattern), by, ok, ...(fromAccount ? { from: fromAccount } : {}), to, ...(launched?.jobId ? { jobId: launched.jobId } : {}), ...(failed?.error ? { error: failed.error } : {}) });
  return { ok, ...(launched?.jobId ? { jobId: launched.jobId } : {}), ...(failed?.error ? { error: failed.error } : {}) };
}

// STOP 전에 거절한 REPOSITION도 한 사건으로 남긴다(옛 세션은 멈추지 않았고 base도 그대로: stage precheck)
function refuseReposition(p: FleetProposal, reg: string, who: "supervisor" | "auto", error: string, now: number) {
  record({ t: new Date(now).toISOString(), kind: "fleet", op: "reposition", aircraft: reg, by: who, ok: false, from: p.from, to: p.airport ?? undefined, proposal: p.id, stage: "precheck", error });
}
