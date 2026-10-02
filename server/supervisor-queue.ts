import { blockedAlerts, type Job } from "./job-state.ts";
import type { LandBy, LandWhy } from "./land-by.ts";
import type { Clearance, PullRequest, Session } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import type { FleetProposal } from "./fleet-plan.ts";
import type { ScheduleMode, ScheduleOp } from "./schedule.ts";
import { waitsOnHuman } from "./human-check.ts";
import { type HandCard, handCardOf, liveSessionOf, type Relay } from "./relay.ts";
import type { RelayOffer } from "./relay-offer.ts";
import type { UpdateKind } from "./update.ts";

// SUPERVISOR QUEUE(ATC-194, docs/ui-visibility.md 3.1, docs/duty.md Q1): SUPERVISOR의 결정을 기다리는 것 하나의 목록.
// 새 감지는 없다 — 화면이 이미 쓰는 상태를 그대로 읽는다. 항목은 밑의 상태가 바뀔 때만 사라진다(읽음·미룸 없음).
// 순수 함수만. 자료 모으기는 supervisor-queue-run.ts. `title`은 atc 말(FLIGHT key·REGISTRATION·PR 번호)만 쓰고 티켓·PR 제목은 싣지 않는다.

export const QUEUE_KINDS = ["PROPOSAL", "SCHEDULE", "FLEET PLAN", "HUMAN CHECK", "LANDING", "UPDATE", "NEEDS YOU", "RELAY", "UNDELIVERED", "GO"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export interface QueueItem {
  kind: QueueKind;
  key: string; // 같은 일이면 늘 같은 key(kind 안에서 유일)
  since: string | null; // 이 일이 기다리기 시작한 시각(ISO). 모르면 null
  title: string;
  hash: string; // 그 항목이 있는 화면 주소
  hand?: HandItem; // UNDELIVERED: 손으로 전하는 카드(ATC-271)
  offer?: RelayOffer; // RELAY: STAND를 쥔 세션이 없는 GO AROUND·FIX를 SUPERVISOR가 전하는 카드(ATC-308)
}

// 닿지 못한 글(SUPERVISOR RELAY·CLEARANCE·FLIGHT PLAN)을 SUPERVISOR가 손으로 전하는 카드의 자료. text가 null이면 복사할 글이 없다(FLIGHT PLAN은 FLIGHT 카드의 DIRECT 지시서)
export interface HandItem {
  source: "RELAY" | "CLEARANCE" | "FLIGHT PLAN";
  id: string;
  to: string;
  reason: string;
  text: string | null;
  card: HandCard;
}

export interface QueueInput {
  proposals: Pick<Proposal, "id" | "kind" | "status" | "flight" | "aircraftName" | "holdAt" | "statusAt" | "awaitSupervisor" | "undelivered">[];
  schedule: { mode: ScheduleMode; ops: Pick<ScheduleOp, "id" | "kind" | "flight" | "status" | "statusAt">[] };
  // FLEET PLAN: 열린 제안과, 최근 주기가 아직 그것을 내는지(isStale의 결과)
  fleetPlan: (Pick<FleetProposal, "id" | "kind" | "aircraft" | "status" | "at"> & { stale: boolean })[];
  // landBy: TOWER가 쓰는 landByOf의 결과. "supervisor"이고 CLEARED면 SUPERVISOR가 머지한다
  pulls: (Pick<PullRequest, "repo" | "number" | "head" | "draft" | "landing" | "humanCheck" | "ticketKey"> & { landBy: LandBy; landWhy?: LandWhy | null })[];
  update: { kind: UpdateKind; deployed: string | null; main: string | null; mainCi: string; at: string } | null;
  sessions: (Pick<Session, "id" | "name" | "job" | "lastActiveAt"> & Partial<Pick<Session, "status" | "origin" | "jobId" | "account">>)[];
  blockedMin: number;
  // 손으로 전하는 카드(ATC-271): 모두 없으면 카드가 없다
  relays?: Pick<Relay, "id" | "to" | "kind" | "text" | "status" | "statusAt" | "reason" | "cause">[];
  clearances?: Pick<Clearance, "id" | "toName" | "type" | "text" | "undeliverableAt" | "undeliverableReason" | "undeliverableCause" | "handAt">[];
  folders?: { label: string; dir: string }[]; // ACCOUNT 라벨 → 폴더(등록부)
  defaultDir?: string; // ~/.claude
  autoDispatch?: boolean; // 자동 운항(ATC-367): 서버가 ASSIGN 카드를 승인하므로 SUPERVISOR 큐에 올리지 않는다
  relayOffers?: RelayOffer[]; // relay-offer.ts의 결과(없으면 RELAY 카드가 없다)
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "?");
// PR의 저장소는 경로일 수 있다: 마지막 마디만 쓴다
const repoName = (repo: string) => repo.replace(/\/+$/, "").split("/").pop() || repo;

export function supervisorQueueOf(inp: QueueInput, now: number): QueueItem[] {
  const out: QueueItem[] = [];

  // PROPOSAL: SUPERVISOR가 판정할 DISPATCH 제안. HOLD 걸린 것은 선행 FLIGHT를 기다리는 것이라 뺀다(DISPATCH 화면의 open과 같다)
  for (const p of inp.proposals) {
    if (p.status !== "proposed" || (p.kind === "ASSIGN" && p.holdAt !== null)) continue;
    if (inp.autoDispatch && p.kind === "ASSIGN") continue; // ASSIGN·launch 카드는 서버가 승인한다(ATC-367). RELEASE는 그대로 SUPERVISOR 몫
    out.push({ kind: "PROPOSAL", key: p.id, since: p.statusAt, title: `${p.kind} ${p.flight}${p.aircraftName ? ` → ${p.aircraftName}` : ""}`, hash: "#home" });
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

  // RELAY(ATC-308): STAND를 쥔 세션이 없어 TOWER가 못 보내는 GO AROUND·FIX. head가 바뀌거나 PR이 닫히거나 쥔 세션이 생기면(offer가 없어지면) 사라진다
  for (const o of inp.relayOffers ?? []) {
    out.push({ kind: "RELAY", key: o.key, since: null, title: `${o.type} PR #${o.pr}${o.flight ? ` (${o.flight})` : ""}${o.to ? ` → ${o.to}` : ""}`, hash: o.airport ? `#pr/${o.airport}/${o.pr}` : "#strips", offer: o });
  }

  // UNDELIVERED(ATC-271): 닿지 못한 글은 조용히 닫지 않고 손으로 전하는 카드를 둔다. 상태가 바뀌면(손으로 전했다고 표시·답이 옴·다시 보냄) 사라진다
  const handFor = (to: string, reason: string) => {
    const t = liveSessionOf(inp.sessions.map((x) => ({ ...x, status: x.status ?? "idle" })), to);
    const dir = inp.folders?.find((f) => f.label === t?.account)?.dir ?? null;
    return handCardOf(to, reason, { session: t, folderDir: dir, defaultDir: inp.defaultDir ?? "" });
  };
  for (const r of inp.relays ?? []) {
    if (r.status !== "undeliverable") continue;
    const reason = r.reason ?? "undeliverable";
    out.push({ kind: "UNDELIVERED", key: r.id, since: r.statusAt, title: `RELAY ${r.id} → ${r.to}`, hash: "#fleet", hand: { source: "RELAY", id: r.id, to: r.to, reason, text: r.text, card: handFor(r.to, reason) } });
  }
  for (const c of inp.clearances ?? []) {
    if (!c.undeliverableAt || c.handAt || now - Date.parse(c.undeliverableAt) > 3 * 86_400_000) continue;
    const reason = c.undeliverableReason ?? "undeliverable";
    out.push({ kind: "UNDELIVERED", key: c.id, since: c.undeliverableAt, title: `${c.type} ${c.id} → ${c.toName}`, hash: "#radar", hand: { source: "CLEARANCE", id: c.id, to: c.toName, reason, text: c.text, card: handFor(c.toName, reason) } });
  }
  for (const p of inp.proposals) {
    if (!p.undelivered || p.status !== "approved" || !p.aircraftName) continue;
    const reason = p.undelivered.reason;
    out.push({ kind: "UNDELIVERED", key: `${p.id}|${p.undelivered.at}`, since: p.undelivered.at, title: `FLIGHT PLAN ${p.flight} → ${p.aircraftName}`, hash: "#home", hand: { source: "FLIGHT PLAN", id: p.id, to: p.aircraftName, reason, text: null, card: handFor(p.aircraftName, reason) } });
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
