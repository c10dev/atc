import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { actsOf, type AutoLine, assignWhyNot, countsOf, launchWhyNot, recentLaunchFailsOf, scheduleWhyNot, wouldIdsOf } from "./auto-approve.ts";
import { config } from "./config.ts";
import { approveLaunch, cutHoldWhy, LAUNCH_FAILED_WHY, launchCapOf } from "./dispatch-launch.ts";
import { type DispatchConfig, loadDispatchConfig } from "./dispatch.ts";
import { fuelHolds } from "./fuel-remaining.ts";
import type { Snapshot } from "./model.ts";
import { isNetworkKind } from "./network-drafts.ts";
import { initHoldOf, noteLiveness } from "./job-liveness-run.ts";
import { allProposals, APPROVED_NO_SESSION_WHY, append, type Op, type Proposal, regOfProposal } from "./proposals.ts";
import { k3LaunchWaits, k3WaitClear } from "./k3-launch-wait.ts";
import { regKey } from "./registration.ts";
import { appendScheduleApprove, loadScheduleMode, loadScheduleOps, type ScheduleOp } from "./schedule.ts";

// 일치 기반 자동 승인의 한 주기(ATC-334, docs/autonomy.md C14). 서버 안에서만 돈다 — HTTP 길도 atcctl 명령도 없다(K3).
// 규칙은 순수 함수(auto-approve.ts)가 정하고, 여기서는 읽고 쓰기만 한다. 스위치가 off(기본)면 아무것도 읽지 않는다.
// shadow는 would-* 줄만 auto-approve.jsonl에 쓴다. on은 승인 줄(via "auto")과 launch 카드의 LAUNCH를 한다.

const FILE = () => join(config.stateDir, "auto-approve.jsonl");

export function readAutoLines(file = FILE()): AutoLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: AutoLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as AutoLine);
    } catch {}
  }
  return out;
}

function appendAutoLine(line: AutoLine, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(line) + "\n");
}

export interface AutoDeps {
  max: number; // ATC_MAX_LAUNCHED
  launch: (s: Snapshot, registration: string, proposal: string, resume: boolean, flight: string) => Promise<{ ok: boolean; jobId?: string; error?: string; wait?: string }>; // by "auto"는 index.ts가 정한다
}

// 한 주기가 읽고 쓰는 곳(시험은 가짜를 꽂는다)
export interface AutoIO {
  cfg: () => DispatchConfig;
  proposals: () => Proposal[];
  scheduleOps: () => ScheduleOp[];
  scheduleMode: () => "shadow" | "approval";
  lines: () => AutoLine[];
  addLine: (l: AutoLine) => void;
  appendOps: (ops: Op[]) => void;
  approveSchedule: (id: string, at: string) => void;
  stamp: () => string;
  // JOB LIVENESS(ATC-534): 이 검사 때문에 카드를 다시 띄우거나 넘긴 것을 센다(없으면 적지 않는다). initHold: init에서 연달아 죽은 REGISTRATION은 서버가 또 띄우지 않는다
  liveness?: (op: "relaunch" | "handoff" | "hold", registration: string, proposal: string, detail?: string) => void;
  initHold?: (registration: string) => boolean;
}

const realIO = (): AutoIO => ({
  cfg: loadDispatchConfig,
  proposals: allProposals,
  scheduleOps: () => loadScheduleOps(),
  scheduleMode: () => loadScheduleMode(),
  lines: () => readAutoLines(),
  addLine: (l) => appendAutoLine(l),
  appendOps: append,
  approveSchedule: (id, at) => appendScheduleApprove(id, at),
  stamp: () => new Date().toISOString(),
  liveness: (op, registration, proposal, detail) => noteLiveness(op, registration, { proposal, ...(detail ? { detail } : {}) }),
  initHold: (registration) => initHoldOf(registration, loadDispatchConfig().teamPattern),
});

let running = false;

export interface AutoResult {
  approved: number;
  launched: number;
  would: number;
}

export async function runAutoApprove(s: Snapshot, deps: AutoDeps, now = Date.now(), io: AutoIO = realIO()): Promise<AutoResult> {
  const result: AutoResult = { approved: 0, launched: 0, would: 0 };
  const cfg = io.cfg();
  const autoOn = cfg.autoDispatch === "on"; // 자동 운항(ATC-367): 사람·CROSSCHECK 없이 필터와 상한을 통과한 ASSIGN·launch를 승인한다
  if (!autoOn && cfg.autoApprove === "off" && cfg.autoApproveLaunch === "off") return result;
  if (running) return result;
  running = true;
  try {
    const lines = io.lines();
    const counts = countsOf(lines, now);
    const seen = wouldIdsOf(lines);
    const tp = cfg.teamPattern;
    const fuelHoldOf = (reg: string | null) => {
      const f = reg ? s.fuel?.[reg] : undefined;
      return Boolean(f && fuelHolds(f, cfg.fuel));
    };

    // ASSIGN(LAUNCH 아님): 오래된 카드부터. 자동 운항이 켜져 있으면 항상 승인
    const assignAct = autoOn ? "approve" : actsOf(cfg.autoApprove);
    if (assignAct !== "none") {
      const open = io.proposals().filter((p) => p.status === "proposed" && !p.launch).sort((a, b) => a.at.localeCompare(b.at));
      for (const p of open) {
        const why = assignWhyNot(p, { now, settleMin: cfg.settleMin, dispatchMode: cfg.mode, fuelHold: fuelHoldOf(regOfProposal(p, tp)), counts, approveMax: cfg.autoApproveMax, live: autoOn });
        if (why) continue;
        if (assignAct === "record") {
          if (seen.has(`dispatch:${p.id}`)) continue;
          io.addLine({ at: io.stamp(), mode: "shadow", kind: "dispatch", op: "would-approve", id: p.id });
          counts.approved++;
          result.would++;
          continue;
        }
        // 사람이 그 사이에 눌렀으면 하지 않는다
        if (io.proposals().find((x) => x.id === p.id)?.status !== "proposed") continue;
        const at = io.stamp();
        io.appendOps([{ op: "approve", id: p.id, at, via: "auto" }]);
        io.addLine({ at, mode: "on", kind: "dispatch", op: "approve", id: p.id });
        counts.approved++;
        result.approved++;
      }
    }

    // SCHEDULE 초안(같은 상한을 같이 센다). 자동 운항과 상관없이 autoApprove 스위치(CROSSCHECK agree)만 따른다 — CROSSCHECK는 SCHEDULE에서 그대로다
    const scheduleAct = actsOf(cfg.autoApprove);
    if (scheduleAct !== "none") {
      const scheduleMode = io.scheduleMode();
      for (const op of io.scheduleOps().filter((o) => o.status === "draft").sort((a, b) => a.at.localeCompare(b.at))) {
        const why = scheduleWhyNot(op, { scheduleMode, counts, approveMax: cfg.autoApproveMax, isNetwork: isNetworkKind });
        if (why) continue;
        if (scheduleAct === "record") {
          if (seen.has(`schedule:${op.id}`)) continue;
          io.addLine({ at: io.stamp(), mode: "shadow", kind: "schedule", op: "would-approve", id: op.id });
          counts.approved++;
          result.would++;
          continue;
        }
        if (io.scheduleOps().find((x) => x.id === op.id)?.status !== "draft") continue;
        const at = io.stamp();
        io.approveSchedule(op.id, at);
        io.addLine({ at, mode: "on", kind: "schedule", op: "approve", id: op.id });
        counts.approved++;
        result.approved++;
      }
    }

    // launch 카드(ABSENT·RESUME): 상한, FUEL hold, 막힘, 실패 뒤 대기, 하루 상한을 모두 지킬 때만
    const launchAct = autoOn ? "approve" : actsOf(cfg.autoApproveLaunch);
    if (launchAct !== "none") {
      const fails = recentLaunchFailsOf(io.proposals(), now, cfg.autoLaunchBackoffMin, tp);
      const open = io.proposals().filter((p) => p.status === "proposed" && p.launch).sort((a, b) => a.at.localeCompare(b.at));
      for (const p of open) {
        const reg = regOfProposal(p, tp) ?? "";
        const cap = launchCapOf(s.sessions, io.proposals(), deps.max, tp, now);
        const why = launchWhyNot(p, {
          now,
          settleMin: cfg.settleMin,
          dispatchMode: cfg.mode,
          fuelHold: fuelHoldOf(reg || null),
          cap,
          stuck: Boolean(s.absent?.find((a) => a.registration === reg)?.stuck),
          backedOff: fails.has(reg),
          counts,
          launchMax: cfg.autoLaunchMax,
          live: autoOn,
        });
        if (why) continue;
        if (launchAct === "record") {
          if (seen.has(`dispatch:${p.id}`)) continue;
          io.addLine({ at: io.stamp(), mode: "shadow", kind: "dispatch", op: "would-launch", id: p.id, registration: reg });
          counts.launched++;
          result.would++;
          continue;
        }
        if (io.proposals().find((x) => x.id === p.id)?.status !== "proposed") continue;
        const live = s.sessions.some((x) => x.status !== "dead" && regKey(x.name, tp) === reg);
        const at = io.stamp();
        const r = await approveLaunch(p.id, {
          live,
          cap,
          approve: { op: "approve", id: p.id, at, via: "auto" },
          append: io.appendOps,
          launch: () => deps.launch(s, reg, p.id, !!p.resume, p.flight),
          now: io.stamp,
          by: "auto",
        });
        // K3 entries가 아직 없어 기다린다(ATC-506): 승인은 적혔고 LAUNCH 줄은 없다. 상한·백오프에 세지 않는다
        if (r.wait) continue;
        io.addLine({ at, mode: "on", kind: "dispatch", op: "launch", id: p.id, registration: reg, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
        counts.launched++;
        if (r.ok) result.launched++;
      }
    }
    return result;
  } finally {
    running = false;
  }
}

// ── 승인됐는데 세션이 없는 ASSIGN 카드(ATC-388, D-0441) ──
// 카드를 만들 때는 세션이 있었는데 승인 전에 AIRCRAFT가 사라지면(ABSENT) FLIGHT PLAN을 보낼 곳이 없어 카드가 approved로 남았다.
// 서버가 그 카드를 launch 카드로 바꿔(op relaunch) 같은 상한(ATC_MAX_LAUNCHED, FUEL hold, 막힘, 실패 뒤 대기, 하루 LAUNCH 상한)에서 LAUNCH하고, FLIGHT PLAN은 전처럼 새 세션에 간다.
// LAUNCH할 수 없는 채로 approvedWaitMin이 지나면 카드를 닫는다(SUPERSEDED, 사유 기록): FLIGHT는 planner로 돌아가 다른 AIRCRAFT를 찾는다.
// SUPERVISOR의 승인이 이미 있으므로 스위치(autoApprove·autoDispatch)와 상관없이 돈다. 서버 안에서만 돈다(HTTP 길도 atcctl 명령도 없다).
export interface RelaunchResult {
  relaunched: number; // LAUNCH를 시도한 수(실패 포함)
  closed: number; // 기다리다 닫은 수
  waiting: number; // 아직 기다리는 수
}

let relaunching = false;

export async function runApprovedRelaunch(s: Snapshot, deps: AutoDeps, now = Date.now(), io: AutoIO = realIO()): Promise<RelaunchResult> {
  const result: RelaunchResult = { relaunched: 0, closed: 0, waiting: 0 };
  const cfg = io.cfg();
  if (cfg.mode !== "approval" || relaunching) return result;
  relaunching = true;
  try {
    const tp = cfg.teamPattern;
    const counts = countsOf(io.lines(), now);
    const fails = recentLaunchFailsOf(io.proposals(), now, cfg.autoLaunchBackoffMin, tp);
    const candidates = io.proposals().filter((p) => p.kind === "ASSIGN" && p.status === "approved" && !p.launch && !p.prHolder);
    for (const p of candidates) {
      const reg = regOfProposal(p, tp) ?? "";
      if (!reg || s.sessions.some((x) => x.status !== "dead" && regKey(x.name, tp) === reg)) continue; // 세션이 있다: 평소대로 OCC가 보낸다
      if (s.restarting?.some((r) => r.registration === reg)) continue; // /clear 뒤 첫 메시지를 기다리는 중: 기존 유예가 기다린다(ATC-91)
      const a = s.absent?.find((x) => x.registration === reg);
      const f = s.fuel?.[reg];
      const jobGone = Boolean(a?.jobGone); // job의 프로세스가 사라져 absent가 된 AIRCRAFT(ATC-534)
      const fuelHold = Boolean(f && fuelHolds(f, cfg.fuel));
      const cap = launchCapOf(s.sessions, io.proposals(), deps.max, tp, now);
      // launch 카드와 같은 조건(launchWhyNot). 이미 SUPERVISOR가 승인한 카드라 blind·주의는 보지 않는다(live)
      const why: string | null = !a
        ? "no-absent" // atc가 띄운 적이 없는 AIRCRAFT(등록부·RETIRED 등)라 띄울 길이 없다
        : (cutHoldWhy(a.cut, now) ? "limit" : null) ??
          (io.initHold?.(reg) ? "init-death" : null) ?? // init에서 연달아 죽었다: CREW CHANGE나 SUPERVISOR의 LAUNCH까지 서버가 또 띄우지 않는다(ATC-534)
          launchWhyNot({ ...p, status: "proposed", launch: true }, { now, settleMin: cfg.settleMin, dispatchMode: cfg.mode, fuelHold, cap, stuck: Boolean(a.stuck), backedOff: fails.has(reg), counts, launchMax: cfg.autoLaunchMax, live: true });
      const at = io.stamp();
      if (why) {
        const waited = now - Date.parse(p.timeline.approved ?? p.statusAt);
        if (waited > cfg.approvedWaitMin * 60_000) {
          io.appendOps([{ op: "supersede", id: p.id, at, reason: `${APPROVED_NO_SESSION_WHY}${jobGone ? ` (${a!.jobGone})` : ""} — LAUNCH 못 함(${why}), ${cfg.approvedWaitMin}분 지남 — 다른 AIRCRAFT로 다시 제안` }]);
          if (jobGone) io.liveness?.("handoff", reg, p.id, why);
          result.closed++;
        } else result.waiting++;
        continue;
      }
      io.appendOps([{ op: "relaunch", id: p.id, at }]);
      if (jobGone) io.liveness?.("relaunch", reg, p.id, a!.jobGone);
      let r: { ok: boolean; jobId?: string; error?: string; wait?: string };
      try {
        r = await deps.launch(s, reg, p.id, false, p.flight);
      } catch (e) {
        r = { ok: false, error: (e as Error).message };
      }
      if (r.wait) {
        // K3 entries가 아직 없다(ATC-506): 카드는 relaunch 상태로 남고 K3 재시도가 이어받는다
        result.waiting++;
        continue;
      }
      const done = io.stamp();
      const launched: Op = { op: "launch", id: p.id, at: done, ok: r.ok, by: "auto", ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
      io.appendOps(r.ok ? [launched] : [launched, { op: "supersede", id: p.id, at: done, reason: `${LAUNCH_FAILED_WHY} — ${r.error ?? "원인 모름"}` }]);
      io.addLine({ at: done, mode: "on", kind: "dispatch", op: "launch", id: p.id, registration: reg, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
      counts.launched++;
      result.relaunched++;
    }
    return result;
  } finally {
    relaunching = false;
  }
}

// ── K3 entries를 기다리는 승인된 launch 카드(ATC-506) ──
// LAUNCH 직전 재확인(launchForCard)이 기다리게 한 카드만 다시 시도한다(서버 메모리의 k3LaunchWaits). 서버가 멈췄다 뜬 카드는 전과 같이 launchCardTimeoutMin 뒤에 닫힌다.
// 기다리는 동안은 아무것도 적지 않는다. 띄워지면 LAUNCH 줄을, 실패하면 LAUNCH 줄과 SUPERSEDED를 적는다(approveLaunch와 같다)
export async function runK3LaunchRetry(s: Snapshot, deps: AutoDeps, io: AutoIO = realIO()): Promise<{ launched: number; waiting: number }> {
  const result = { launched: 0, waiting: 0 };
  const tp = io.cfg().teamPattern;
  const cards = io.proposals();
  for (const id of [...k3LaunchWaits().keys()]) {
    const p = cards.find((x) => x.id === id);
    if (!p || p.status !== "approved" || !p.launch || p.launched) {
      k3WaitClear(id); // 닫혔거나 이미 LAUNCH됐다
      continue;
    }
    const reg = regOfProposal(p, tp) ?? "";
    if (!reg || s.sessions.some((x) => x.status !== "dead" && regKey(x.name, tp) === reg)) {
      k3WaitClear(id); // 세션이 이미 있다: 평소대로
      continue;
    }
    let r: { ok: boolean; jobId?: string; error?: string; wait?: string };
    try {
      r = await deps.launch(s, reg, p.id, !!p.resume, p.flight);
    } catch (e) {
      r = { ok: false, error: (e as Error).message };
    }
    if (r.wait) {
      result.waiting++;
      continue;
    }
    const at = io.stamp();
    const launched: Op = { op: "launch", id: p.id, at, ok: r.ok, by: "auto", ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
    io.appendOps(r.ok ? [launched] : [launched, { op: "supersede", id: p.id, at, reason: `${LAUNCH_FAILED_WHY} — ${r.error ?? "원인 모름"}` }]);
    io.addLine({ at, mode: "on", kind: "dispatch", op: "launch", id: p.id, registration: reg, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
    k3WaitClear(id);
    if (r.ok) result.launched++;
  }
  return result;
}
