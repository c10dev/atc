import { blockedAlerts, type Job } from "./job-state.ts";
import type { LandBy } from "./land-by.ts";
import type { PullRequest, Session } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import type { FleetProposal } from "./fleet-plan.ts";
import type { ScheduleMode, ScheduleOp } from "./schedule.ts";
import { waitsOnHuman } from "./human-check.ts";
import type { UpdateKind } from "./update.ts";

// SUPERVISOR QUEUE(ATC-194, docs/ui-visibility.md 3.1, docs/duty.md Q1): SUPERVISOR의 결정을 기다리는 것 하나의 목록.
// 새 감지는 없다 — 화면이 이미 쓰는 상태를 그대로 읽는다. 항목은 밑의 상태가 바뀔 때만 사라진다(읽음·미룸 없음).
// 순수 함수만. 자료 모으기는 supervisor-queue-run.ts. `title`은 atc 말(FLIGHT key·REGISTRATION·PR 번호)만 쓰고 티켓·PR 제목은 싣지 않는다.

export const QUEUE_KINDS = ["PROPOSAL", "SCHEDULE", "FLEET PLAN", "HUMAN CHECK", "LANDING", "UPDATE", "NEEDS YOU", "GO"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export interface QueueItem {
  kind: QueueKind;
  key: string; // 같은 일이면 늘 같은 key(kind 안에서 유일)
  since: string | null; // 이 일이 기다리기 시작한 시각(ISO). 모르면 null
  title: string;
  hash: string; // 그 항목이 있는 화면 주소
}

export interface QueueInput {
  proposals: Pick<Proposal, "id" | "kind" | "status" | "flight" | "aircraftName" | "holdAt" | "statusAt" | "awaitSupervisor">[];
  schedule: { mode: ScheduleMode; ops: Pick<ScheduleOp, "id" | "kind" | "flight" | "status" | "statusAt">[] };
  // FLEET PLAN: 열린 제안과, 최근 주기가 아직 그것을 내는지(isStale의 결과)
  fleetPlan: (Pick<FleetProposal, "id" | "kind" | "aircraft" | "status" | "at"> & { stale: boolean })[];
  // landBy: TOWER가 쓰는 landByOf의 결과. "supervisor"이고 CLEARED면 SUPERVISOR가 머지한다
  pulls: (Pick<PullRequest, "repo" | "number" | "head" | "draft" | "landing" | "humanCheck" | "ticketKey"> & { landBy: LandBy })[];
  update: { kind: UpdateKind; deployed: string | null; main: string | null; mainCi: string; at: string } | null;
  sessions: Pick<Session, "id" | "name" | "job" | "lastActiveAt">[];
  blockedMin: number;
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "?");
// PR의 저장소는 경로일 수 있다: 마지막 마디만 쓴다
const repoName = (repo: string) => repo.replace(/\/+$/, "").split("/").pop() || repo;

export function supervisorQueueOf(inp: QueueInput, now: number): QueueItem[] {
  const out: QueueItem[] = [];

  // PROPOSAL: SUPERVISOR가 판정할 DISPATCH 제안. HOLD 걸린 것은 선행 FLIGHT를 기다리는 것이라 뺀다(DISPATCH 화면의 open과 같다)
  for (const p of inp.proposals) {
    if (p.status !== "proposed" || (p.kind === "ASSIGN" && p.holdAt !== null)) continue;
    out.push({ kind: "PROPOSAL", key: p.id, since: p.statusAt, title: `${p.kind} ${p.flight}${p.aircraftName ? ` → ${p.aircraftName}` : ""}`, hash: "#dispatch" });
  }

  // SCHEDULE: approval 모드에서 판정을 기다리는 draft. shadow는 게이트 판정이라 SUPERVISOR 결정이 아니다
  if (inp.schedule.mode === "approval") {
    for (const op of inp.schedule.ops) {
      if (op.status !== "draft") continue;
      out.push({ kind: "SCHEDULE", key: op.id, since: op.statusAt, title: `${op.kind}${op.flight ? ` ${op.flight}` : ""}`, hash: "#schedule" });
    }
  }

  // FLEET PLAN: 열려 있고 최근 주기가 아직 내는 제안(옛것은 승인해도 거절되므로 뺀다)
  for (const p of inp.fleetPlan) {
    if (p.status !== "open" || p.stale) continue;
    out.push({ kind: "FLEET PLAN", key: p.id, since: p.at, title: `${p.kind}${p.aircraft ? ` ${p.aircraft}` : ""}`, hash: "#fleet" });
  }

  // HUMAN CHECK · LANDING: 초안이 아닌 PR. 같은 PR이 둘 다일 수 있다(key가 kind 안에서 유일하면 된다)
  for (const pr of inp.pulls) {
    if (pr.draft) continue;
    const id = `${repoName(pr.repo)}#${pr.number}`;
    const tag = `PR #${pr.number}${pr.ticketKey ? ` ${pr.ticketKey}` : ""}`;
    if (waitsOnHuman(pr.humanCheck)) out.push({ kind: "HUMAN CHECK", key: `${id}@${pr.head}`, since: null, title: tag, hash: "#strips" });
    // MCC나 팀이 아니라 SUPERVISOR가 머지할 CLEARED PR(user 등급·ESCALATE·HOLD·MCC가 안 착륙시키는 모드·등급을 모름)
    if (pr.landing === "CLEARED" && pr.landBy === "supervisor") out.push({ kind: "LANDING", key: `${id}@${pr.head}`, since: null, title: tag, hash: "#strips" });
  }

  // UPDATE: 서비스가 origin/main보다 뒤이고 main CI가 통과했다(UPDATE 바의 [업데이트] 상태)
  if (inp.update?.kind === "available" && inp.update.mainCi === "ok") {
    out.push({ kind: "UPDATE", key: short(inp.update.main), since: inp.update.at, title: `${short(inp.update.deployed)} → ${short(inp.update.main)}`, hash: "#radar" });
  }

  // NEEDS YOU: 백그라운드 job이 blocked로 blockedMin분 넘게 사람을 기다린다(ALERT와 같은 함수)
  const byId = new Map(inp.sessions.map((s) => [s.id, s]));
  for (const a of blockedAlerts(inp.sessions, now, inp.blockedMin)) {
    const s = byId.get(a.sessionIds[0]);
    out.push({ kind: "NEEDS YOU", key: a.sessionIds[0], since: (s?.job as Job | null | undefined)?.since ?? null, title: s?.name ?? a.sessionIds[0], hash: "#fleet" });
  }

  // GO: CAPTAIN이 SUPERVISOR의 go를 기다린다(sent인 동안만 awaitSupervisor가 있다)
  for (const p of inp.proposals) {
    if (!p.awaitSupervisor) continue;
    out.push({ kind: "GO", key: p.id, since: p.awaitSupervisor.at, title: `${p.flight}${p.aircraftName ? ` ${p.aircraftName}` : ""}`, hash: "#fleet" });
  }

  return out.sort((a, b) => sinceMs(a) - sinceMs(b) || kindRank(a) - kindRank(b) || a.key.localeCompare(b.key));
}

// 오래 기다린 것이 먼저. since를 모르는 것은 맨 뒤(지금부터 기다린 것으로 본다)
const sinceMs = (i: QueueItem) => {
  const t = i.since ? Date.parse(i.since) : NaN;
  return Number.isFinite(t) ? t : Infinity;
};
const kindRank = (i: QueueItem) => QUEUE_KINDS.indexOf(i.kind);

// kind별 수(0인 kind도 모두 든다). 탭 배지가 읽는다(ui-visibility 3.3)
export function queueCountsOf(items: readonly QueueItem[]): Record<QueueKind, number> {
  const counts = Object.fromEntries(QUEUE_KINDS.map((k) => [k, 0])) as Record<QueueKind, number>;
  for (const i of items) counts[i.kind]++;
  return counts;
}

export interface SupervisorQueue {
  v: 1;
  at: string;
  count: number;
  counts: Record<QueueKind, number>;
  items: QueueItem[];
}

export function supervisorQueueView(inp: QueueInput, now: number): SupervisorQueue {
  const items = supervisorQueueOf(inp, now);
  return { v: 1, at: new Date(now).toISOString(), count: items.length, counts: queueCountsOf(items), items };
}
