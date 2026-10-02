import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { actsOf, type AutoLine, assignWhyNot, countsOf, launchWhyNot, recentLaunchFailsOf, scheduleWhyNot, wouldIdsOf } from "./auto-approve.ts";
import { config } from "./config.ts";
import { approveLaunch, launchCapOf } from "./dispatch-launch.ts";
import { type DispatchConfig, loadDispatchConfig } from "./dispatch.ts";
import { fuelHolds } from "./fuel-remaining.ts";
import type { Snapshot } from "./model.ts";
import { isNetworkKind } from "./network-drafts.ts";
import { allProposals, append, type Op, type Proposal, regOfProposal } from "./proposals.ts";
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
  launch: (s: Snapshot, registration: string, proposal: string, resume: boolean) => Promise<{ ok: boolean; jobId?: string; error?: string }>; // by "auto"는 index.ts가 정한다
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
          launch: () => deps.launch(s, reg, p.id, !!p.resume),
          now: io.stamp,
          by: "auto",
        });
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
