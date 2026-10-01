import { isBlind } from "./blind.ts";
import type { AutoMode } from "./dispatch.ts";
import { LAUNCH_FAILED_WHY, type LaunchCap } from "./dispatch-launch.ts";
import { type Proposal, regOfProposal } from "./proposals.ts";
import type { ScheduleOp } from "./schedule.ts";

// 일치 기반 자동 승인(ATC-334, docs/autonomy.md C14와 WO-16 1·2단계). 여기는 순수 함수만 — 읽고 쓰는 것은 auto-approve-run.ts.
// 서버가 스스로 승인하는 것은 CROSSCHECK가 agree한 열린 카드뿐이다. blind 표본, HELD, disagree, 주의(caution) 카드는 그대로 SUPERVISOR 몫이고,
// 상한이 차면 카드는 SUPERVISOR를 기다린다. 스위치가 off면 아무것도 하지 않는다(그때는 이 규칙을 부르지도 않는다).

const DAY_MS = 86_400_000;

// 자동 승인이 막힌 까닭(사람에게는 보이지 않는다. 시험과 FLIGHT RECORDER·로그 설명용)
export type AutoSkip =
  | "mode" // DISPATCH가 approval 모드가 아님(승인·거절은 그 모드에서만)
  | "not-assign"
  | "not-open"
  | "unsettled"
  | "held"
  | "launch" // ASSIGN 규칙은 launch 카드를 승인하지 않는다(별도 스위치)
  | "not-launch"
  | "no-crosscheck"
  | "disagree"
  | "blind"
  | "caution"
  | "fuel-hold"
  | "cap-full" // ATC_MAX_LAUNCHED
  | "stuck" // LAUNCH 막힘(ATC-129·213)
  | "backoff" // 방금 LAUNCH가 실패한 REGISTRATION
  | "daily-cap"
  | "launch-daily-cap"
  | "network-kind"
  | "not-draft";

export interface AutoCounts {
  approved: number; // 지난 24시간의 자동 승인(ASSIGN과 SCHEDULE, shadow의 would-approve 포함)
  launched: number; // 지난 24시간의 자동 LAUNCH 시도(실패 포함, would-launch 포함)
}

type CardFacts = Pick<Proposal, "id" | "kind" | "status" | "at" | "launch" | "caution" | "crosscheck" | "holdAt">;

export interface AssignCtx {
  now: number;
  settleMin: number;
  dispatchMode: "shadow" | "approval";
  fuelHold: boolean; // 그 AIRCRAFT의 ACCOUNT가 FUEL hold(스위치가 켜져 있고 holdPct 이상)
  counts: AutoCounts;
  approveMax: number;
}

// 열린 ASSIGN(LAUNCH 아님)을 자동 승인해도 되나. 막히면 까닭, 되면 null
export function assignWhyNot(p: CardFacts, c: AssignCtx): AutoSkip | null {
  if (c.dispatchMode !== "approval") return "mode";
  if (p.kind !== "ASSIGN") return "not-assign";
  if (p.status !== "proposed") return "not-open";
  if (p.launch) return "launch";
  return commonWhyNot(p, c) ?? (c.counts.approved >= c.approveMax ? "daily-cap" : null);
}

export interface LaunchCtx {
  now: number;
  settleMin: number;
  dispatchMode: "shadow" | "approval";
  fuelHold: boolean;
  cap: Pick<LaunchCap, "full">;
  stuck: boolean; // 그 ABSENT AIRCRAFT가 LAUNCH 막힘
  backedOff: boolean; // 최근 LAUNCH 실패로 쉬는 REGISTRATION
  counts: AutoCounts;
  launchMax: number;
}

// 열린 launch 카드(ABSENT·RESUME)를 자동 승인하고 LAUNCH해도 되나. 조건은 모두 지켜야 한다
export function launchWhyNot(p: CardFacts, c: LaunchCtx): AutoSkip | null {
  if (c.dispatchMode !== "approval") return "mode";
  if (p.kind !== "ASSIGN") return "not-assign";
  if (p.status !== "proposed") return "not-open";
  if (!p.launch) return "not-launch";
  const common = commonWhyNot(p, c);
  if (common) return common;
  if (c.cap.full) return "cap-full";
  if (c.stuck) return "stuck";
  if (c.backedOff) return "backoff";
  if (c.counts.launched >= c.launchMax) return "launch-daily-cap";
  return null;
}

// ASSIGN과 launch 카드가 같이 지키는 조건: SETTLED, HELD 아님, CROSSCHECK agree, blind 아님, 주의 없음, FUEL hold 아님
function commonWhyNot(p: CardFacts, c: { now: number; settleMin: number; fuelHold: boolean }): AutoSkip | null {
  if (p.holdAt !== null) return "held";
  if (c.now - Date.parse(p.at) < c.settleMin * 60_000) return "unsettled";
  if (!p.crosscheck) return "no-crosscheck";
  if (p.crosscheck.verdict !== "agree") return "disagree";
  if (isBlind(p.id)) return "blind"; // blind 표본은 SUPERVISOR가 mark를 못 본 채 판정한다. 자동으로는 절대 승인하지 않는다
  if (p.caution) return "caution"; // OCC가 주의 메모를 단 카드는 사람이 본다
  if (c.fuelHold) return "fuel-hold";
  return null;
}

export interface ScheduleCtx {
  scheduleMode: "shadow" | "approval";
  counts: AutoCounts;
  approveMax: number;
  isNetwork: (kind: ScheduleOp["kind"]) => boolean;
}

// 열린 SCHEDULE 초안을 자동 승인해도 되나(TARGET·ROUTE 같은 network 종류는 적용할 길이 없어 승인이 아니라 그림자 판정만 있다)
export function scheduleWhyNot(op: Pick<ScheduleOp, "id" | "kind" | "status" | "crosscheck">, c: ScheduleCtx): AutoSkip | null {
  if (c.scheduleMode !== "approval") return "mode";
  if (op.status !== "draft") return "not-draft";
  if (c.isNetwork(op.kind)) return "network-kind";
  if (!op.crosscheck) return "no-crosscheck";
  if (op.crosscheck.verdict !== "agree") return "disagree";
  if (isBlind(op.id)) return "blind";
  if (c.counts.approved >= c.approveMax) return "daily-cap";
  return null;
}

// ── 기록(auto-approve.jsonl, 추가만 하는 JSONL). shadow는 would-* 줄만 쓰고, on은 한 일을 쓴다 ──
export type AutoOp = "approve" | "would-approve" | "launch" | "would-launch";
export interface AutoLine {
  at: string;
  mode: "shadow" | "on";
  kind: "dispatch" | "schedule";
  op: AutoOp;
  id: string;
  registration?: string; // launch 줄
  ok?: boolean; // launch 줄: LAUNCH 결과(would-launch에는 없다)
  error?: string;
}

// 지난 24시간(굴러가는 창)의 개수. 하루 상한이 이 값을 본다
export function countsOf(lines: readonly AutoLine[], now: number): AutoCounts {
  const recent = lines.filter((l) => now - Date.parse(l.at) < DAY_MS);
  return {
    approved: recent.filter((l) => l.op === "approve" || l.op === "would-approve").length,
    launched: recent.filter((l) => l.op === "launch" || l.op === "would-launch").length,
  };
}

// shadow가 이미 would-* 줄을 쓴 카드(같은 카드를 틱마다 다시 쓰지 않는다)
export const wouldIdsOf = (lines: readonly AutoLine[]): Set<string> => new Set(lines.filter((l) => l.op === "would-approve" || l.op === "would-launch").map((l) => `${l.kind}:${l.id}`));

// 최근 LAUNCH가 실패한 REGISTRATION(손으로 한 승인의 실패도 센다): 같은 카드로 또 실패하는 고리를 끊는다(ATC-129 사고 — 40분에 카드 11건)
export function recentLaunchFailsOf(proposals: readonly Proposal[], now: number, backoffMin: number, teamPattern?: string): Set<string> {
  const out = new Set<string>();
  for (const p of proposals) {
    if (!p.launch || p.status !== "superseded" || !(p.reason ?? "").startsWith(LAUNCH_FAILED_WHY)) continue;
    if (now - Date.parse(p.statusAt) >= backoffMin * 60_000) continue;
    const reg = regOfProposal(p, teamPattern);
    if (reg) out.add(reg);
  }
  return out;
}

// 이 스위치 값에서 하는 일: off는 아무것도, shadow는 기록만, on은 승인
export const actsOf = (mode: AutoMode): "none" | "record" | "approve" => (mode === "on" ? "approve" : mode === "shadow" ? "record" : "none");
