import { type Decision } from "./decision-card.ts";
import { waitingOnPersonOf } from "./waiting-person.ts";
import type { LandBy, LandWhy } from "./land-by.ts";
import type { Clearance, PullRequest, Session } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import type { FleetProposal } from "./fleet-plan.ts";
import type { ScheduleMode, ScheduleOp } from "./schedule.ts";
import { scheduleWaitsOnSupervisor } from "./schedule-waiting.ts";
import type { ArrivedOpen } from "./arrived-open.ts";
import { canCancel, canRecall } from "./flight-brake.ts";
import type { FollowBundle, FollowRow } from "./follow.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";
import { effectLine, type EffectVerdict, openBadOf } from "./effect-check.ts";
import { waitsOnHuman } from "./human-check.ts";
import { type HandCard, handCardOf, liveSessionOf, type Relay } from "./relay.ts";
import type { RelayOffer } from "./relay-offer.ts";
import type { UpdateKind } from "./update.ts";

// SUPERVISOR QUEUE(ATC-194, docs/ui-visibility.md 3.1, docs/duty.md Q1): SUPERVISOR의 결정을 기다리는 것 하나의 목록.
// 새 감지는 없다 — 화면이 이미 쓰는 상태를 그대로 읽는다. 항목은 밑의 상태가 바뀔 때만 사라진다(읽음·미룸 없음).
// 순수 함수만. 자료 모으기는 supervisor-queue-run.ts. `title`은 atc 말(FLIGHT key·REGISTRATION·PR 번호)만 쓰고 티켓·PR 제목은 싣지 않는다.

// ARRIVED(ATC-473): STAND 없는 FLIGHT가 LOGBOOK ARRIVED인데 Linear는 아직 In Progress. 확인한 클릭 하나로 Done으로 옮긴다
// ALERT·STUCK·EFFECT·CLOSE(ATC-454, S1a)는 HOME이 한 목록으로 모으려고 더한 종류다: SUPERVISOR가 할 수 있는 알림, 한도를 넘긴 막힌 FLIGHT, 목표를 못 맞춘 EFFECT 평결, 손으로 Done 해야 하는 CLOSE
export const QUEUE_KINDS = ["PROPOSAL", "SCHEDULE", "FLEET PLAN", "HUMAN CHECK", "LANDING", "UPDATE", "NEEDS YOU", "RELAY", "UNDELIVERED", "GO", "BACKLOG", "ALERT", "STUCK", "EFFECT", "CLOSE", "ARRIVED", "DECISION"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

// HOME 줄이 보이는 단추 하나(ATC-454). 무엇을 누를지는 서버가 정하고 화면은 그린다. 다른 동작은 기존 길(duty-card.ts의 actionsOf와 각 라우트)에 그대로 있다
// approve: 큐 줄에서 승인·거절하는 기존 인라인 길(op가 어느 길인지). brake: 그 FLIGHT의 CANCEL·RECALL. open: hash의 화면(url이 있으면 그 주소)을 연다
export interface QueuePrimary {
  action: "approve" | "brake" | "open" | "done"; // done: STAND 없는 ARRIVED FLIGHT를 Done으로(ATC-473, 줄을 열어 확인한 뒤)
  label: string;
  op?: "fleet-plan" | "update" | "proposal" | "schedule";
  hash?: string;
  url?: string;
}

export interface QueueItem {
  kind: QueueKind;
  key: string; // 같은 일이면 늘 같은 key(kind 안에서 유일)
  since: string | null; // 이 일이 기다리기 시작한 시각(ISO). 모르면 null
  title: string;
  hash: string; // 그 항목이 있는 화면 주소
  primary: QueuePrimary;
  need?: string; // ALERT·STUCK·EFFECT·CLOSE: 무엇이 필요한지 한 줄(SUPERVISOR가 읽는다)
  level?: "warning" | "caution"; // ALERT: 알림 등급(WARNING이면 목록 맨 위, 레일 배지가 알림 톤)
  flight?: string; // ALERT·STUCK·EFFECT·CLOSE: 그 FLIGHT
  brake?: { id: string; status: string; aircraftName: string | null; departedStand: string | null; departedVia: string | null; mode: "shadow" | "approval" }; // STUCK: 줄의 CANCEL·RECALL이 쓰는 제안(primary가 brake일 때)
  pr?: { repo: string; number: number; url: string }; // CLOSE: 이 CLOSE를 승인한 PR
  arrived?: ArrivedOpen; // ARRIVED: 도착 보고(AIRCRAFT, 시각, 글, 결과 링크)와 이슈 링크, 지금 Linear 상태(옮길 때의 from)
  hand?: HandItem; // UNDELIVERED: 손으로 전하는 카드(ATC-271)
  decision?: Pick<Decision, "id" | "role" | "ask" | "options" | "pr">; // DECISION: 관제 세션이 올린 결정 하나(ATC-352)
  detail?: string; // SCHEDULE: OCC의 근거 한 줄. 탭이 없어 큐 줄이 판정 화면이라, 무엇을 승인하는지 보이게 한다(ATC-378)
  card?: { kind: Proposal["kind"]; launch: boolean }; // PROPOSAL: 승인하면 무슨 일이 일어나는지 가르는 것(ASSIGN은 FLIGHT PLAN, launch는 LAUNCH 먼저, RELEASE는 FLIGHT PLAN 없음, ATC-377)
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
  proposals: (Pick<Proposal, "id" | "kind" | "status" | "flight" | "aircraftName" | "holdAt" | "statusAt" | "awaitSupervisor" | "undelivered"> & Partial<Pick<Proposal, "launch">>)[];
  schedule: { mode: ScheduleMode; ops: (Pick<ScheduleOp, "id" | "kind" | "flight" | "status" | "statusAt"> & Partial<Pick<ScheduleOp, "reason">>)[] };
  // FLEET PLAN: 열린 제안과, 최근 주기가 아직 그것을 내는지(isStale의 결과)
  fleetPlan: (Pick<FleetProposal, "id" | "kind" | "aircraft" | "status" | "at"> & { stale: boolean })[];
  // landBy: TOWER가 쓰는 landByOf의 결과. "supervisor"이고 CLEARED면 SUPERVISOR가 머지한다
  pulls: (Pick<PullRequest, "repo" | "number" | "head" | "draft" | "landing" | "humanCheck" | "ticketKey"> & { landBy: LandBy; landWhy?: LandWhy | null })[];
  update: { kind: UpdateKind; deployed: string | null; main: string | null; mainCi: string; at: string } | null;
  sessions: (Pick<Session, "id" | "name" | "job" | "lastActiveAt"> & Partial<Pick<Session, "status" | "origin" | "jobId" | "account" | "health">>)[];
  blockedMin: number;
  teamPattern?: string; // 팀 AIRCRAFT 이름 규칙(waiting-person.ts). 없으면 기본
  // 손으로 전하는 카드(ATC-271): 모두 없으면 카드가 없다
  relays?: Pick<Relay, "id" | "to" | "kind" | "text" | "status" | "statusAt" | "reason" | "cause">[];
  clearances?: Pick<Clearance, "id" | "toName" | "type" | "text" | "undeliverableAt" | "undeliverableReason" | "undeliverableCause" | "handAt">[];
  folders?: { label: string; dir: string }[]; // ACCOUNT 라벨 → 폴더(등록부)
  defaultDir?: string; // ~/.claude
  autoDispatch?: boolean; // 자동 운항(ATC-367): 서버가 ASSIGN 카드를 승인하므로 SUPERVISOR 큐에 올리지 않는다
  relayOffers?: RelayOffer[]; // relay-offer.ts의 결과(없으면 RELAY 카드가 없다)
  decisions?: Pick<Decision, "id" | "key" | "role" | "at" | "ask" | "options" | "pr" | "status">[]; // decision-card.ts(열린 카드만 줄이 된다)
  // 제안(ATC-401): atc가 Backlog에 올렸고 SUPERVISOR가 아직 쏘거나 버리지 않은 이슈(release-proposals.ts의 filedProposalsOf). 없으면 BACKLOG 줄이 없다
  backlog?: { key: string; by: string; at: string }[];
  // HOME의 한 목록(ATC-454): 알림 목록(currentAlerts), FOLLOW 보드의 번들, EFFECT 평결(foldEffects), 손으로 Done 해야 하는 CLOSE(closeManualOf). 없으면 그 종류의 줄이 없다
  alerts?: Pick<SupervisorAlert, "key" | "level" | "group" | "aircraft" | "flight" | "text" | "next" | "link" | "since" | "dest">[];
  follow?: { bundles: Pick<FollowBundle, "rows">[]; dispatchMode: "shadow" | "approval" };
  effects?: EffectVerdict[];
  arrived?: ArrivedOpen[]; // STAND 없는 ARRIVED인데 아직 started인 FLIGHT(arrived-open.ts, ATC-473)
  closes?: { id: string; flight: string | null; statusAt: string; url: string | null; pr: { repo: string; number: number; url: string } }[];
}

const approve = (op: NonNullable<QueuePrimary["op"]>, label = "승인·거절"): QueuePrimary => ({ action: "approve", label, op });
const open = (label: string, hash: string, url?: string): QueuePrimary => ({ action: "open", label, hash, ...(url ? { url } : {}) });

// "SUPERVISOR가 할 수 있는" 알림(ATC-454): WARNING·CAUTION 가운데 조건(dest alerts)만. 큐로 가는 알림(dest queue)은 이미 큐 줄이고, 막힌 FLIGHT 줄(follow|stuck)은 STUCK 줄이 알린다.
// 알리기만 하는 것(ADVISORY·log)은 상단 ALERT 목록에만 남는다. 이전에는 화면의 homeAlertsOf였고 규칙은 그대로다. 순수
export const actionableAlertsOf = <A extends Pick<SupervisorAlert, "key" | "level" | "dest">>(items: readonly A[]): A[] =>
  items.filter((a) => (a.level === "warning" || a.level === "caution") && a.dest === "alerts" && !a.key.startsWith("follow|stuck|"));

// 막힌 FLIGHT 줄: 끝나지 않은 막힌 줄, 같은 FLIGHT는 한 번(번들이 겹치면 먼저 나온 것). 이전에는 화면의 stuckRowsOf. 순수
export function stuckRowsOf(bundles: readonly Pick<FollowBundle, "rows">[]): FollowRow[] {
  const seen = new Set<string>();
  return bundles.flatMap((b) => b.rows).filter((r) => r.stuck && !r.finished && !seen.has(r.key) && (seen.add(r.key), true));
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
    out.push({ kind: "PROPOSAL", key: p.id, since: p.statusAt, title: `${p.kind} ${p.flight}${p.aircraftName ? ` → ${p.aircraftName}` : ""}`, hash: "#home", primary: approve("proposal"), card: { kind: p.kind, launch: Boolean(p.launch) } });
  }

  // SCHEDULE: approval 모드에서 판정을 기다리는 draft. shadow는 게이트 판정이라 SUPERVISOR 결정이 아니다(알림 4b와 같은 함수, ATC-450)
  for (const op of inp.schedule.ops) {
    if (!scheduleWaitsOnSupervisor(inp.schedule.mode, op)) continue;
    out.push({ kind: "SCHEDULE", key: op.id, since: op.statusAt, title: `${op.kind}${op.flight ? ` ${op.flight}` : ""}`, hash: "#home", primary: approve("schedule"), ...(op.reason ? { detail: op.reason.slice(0, 240) } : {}) });
  }

  // FLEET PLAN: 열려 있고 최근 주기가 아직 내는 제안(옛것은 승인해도 거절되므로 뺀다)
  for (const p of inp.fleetPlan) {
    if (p.status !== "open" || p.stale) continue;
    out.push({ kind: "FLEET PLAN", key: p.id, since: p.at, title: `${p.kind}${p.aircraft ? ` ${p.aircraft}` : ""}`, hash: "#fleet", primary: approve("fleet-plan") });
  }

  // HUMAN CHECK · LANDING: 초안이 아닌 PR. 같은 PR이 둘 다일 수 있다(key가 kind 안에서 유일하면 된다)
  for (const pr of inp.pulls) {
    if (pr.draft) continue;
    const id = `${repoName(pr.repo)}#${pr.number}`;
    const tag = `PR #${pr.number}${pr.ticketKey ? ` ${pr.ticketKey}` : ""}`;
    if (waitsOnHuman(pr.humanCheck)) out.push({ kind: "HUMAN CHECK", key: `${id}@${pr.head}`, since: null, title: tag, hash: "#home", primary: open("확인", "#home") });
    // MCC나 팀이 아니라 SUPERVISOR가 머지할 CLEARED PR(user 등급·ESCALATE·HOLD·MCC가 안 착륙시키는 모드·등급을 모름)
    if (pr.landing === "CLEARED" && pr.landBy === "supervisor") out.push({ kind: "LANDING", key: `${id}@${pr.head}`, since: null, title: tag, hash: "#flights", primary: open("PR 열기", "#flights") });
  }

  // UPDATE: 서비스가 origin/main보다 뒤이고 main CI가 통과했다(UPDATE 바의 [업데이트] 상태)
  if (inp.update?.kind === "available" && inp.update.mainCi === "ok") {
    out.push({ kind: "UPDATE", key: short(inp.update.main), since: inp.update.at, title: `${short(inp.update.deployed)} → ${short(inp.update.main)}`, hash: "#home", primary: approve("update", "업데이트") });
  }

  // NEEDS YOU·GO: 스스로 사람을 기다리는 세션. SUPERVISOR SUMMARY의 needsYou와 같은 정의 하나(waiting-person.ts, ATC-374)
  const waiting = waitingOnPersonOf({ sessions: inp.sessions, proposals: inp.proposals, now, blockedMin: inp.blockedMin, teamPattern: inp.teamPattern });
  for (const w of waiting) {
    if (w.kind === "go") out.push({ kind: "GO", key: w.key, since: w.since, title: w.name, hash: "#fleet", primary: open("AIRCRAFT 보기", "#fleet") });
    else out.push({ kind: "NEEDS YOU", key: w.key, since: w.since, title: w.name, hash: "#fleet", primary: open("AIRCRAFT 보기", "#fleet") });
  }

  // RELAY(ATC-308): STAND를 쥔 세션이 없어 TOWER가 못 보내는 GO AROUND·FIX. head가 바뀌거나 PR이 닫히거나 쥔 세션이 생기면(offer가 없어지면) 사라진다
  for (const o of inp.relayOffers ?? []) {
    out.push({ kind: "RELAY", key: o.key, since: null, title: `${o.type} PR #${o.pr}${o.flight ? ` (${o.flight})` : ""}${o.to ? ` → ${o.to}` : ""}`, hash: o.airport ? `#pr/${o.airport}/${o.pr}` : "#strips", primary: open("PR 열기", o.airport ? `#pr/${o.airport}/${o.pr}` : "#strips"), offer: o });
  }

  // BACKLOG(ATC-401): DUTY REVIEW·SCHEDULE NEW가 Backlog에 올린 제안. RELEASE 화면에서 한 번의 클릭으로 쏘거나 버린다. 쏘거나 버리면(Todo·Canceled) 사라진다
  for (const b of inp.backlog ?? []) out.push({ kind: "BACKLOG", key: b.key, since: b.at, title: `${b.key} ← ${b.by}`, hash: "#release", primary: open("RELEASE에서 발권·버리기", "#release") });

  // UNDELIVERED(ATC-271): 닿지 못한 글은 조용히 닫지 않고 손으로 전하는 카드를 둔다. 상태가 바뀌면(손으로 전했다고 표시·답이 옴·다시 보냄) 사라진다
  const handFor = (to: string, reason: string) => {
    const t = liveSessionOf(inp.sessions.map((x) => ({ ...x, status: x.status ?? "idle" })), to);
    const dir = inp.folders?.find((f) => f.label === t?.account)?.dir ?? null;
    return handCardOf(to, reason, { session: t, folderDir: dir, defaultDir: inp.defaultDir ?? "" });
  };
  for (const r of inp.relays ?? []) {
    if (r.status !== "undeliverable") continue;
    const reason = r.reason ?? "undeliverable";
    out.push({ kind: "UNDELIVERED", key: r.id, since: r.statusAt, title: `RELAY ${r.id} → ${r.to}`, hash: "#fleet", primary: open("AIRCRAFT 보기", "#fleet"), hand: { source: "RELAY", id: r.id, to: r.to, reason, text: r.text, card: handFor(r.to, reason) } });
  }
  for (const c of inp.clearances ?? []) {
    if (!c.undeliverableAt || c.handAt || now - Date.parse(c.undeliverableAt) > 3 * 86_400_000) continue;
    const reason = c.undeliverableReason ?? "undeliverable";
    out.push({ kind: "UNDELIVERED", key: c.id, since: c.undeliverableAt, title: `${c.type} ${c.id} → ${c.toName}`, hash: "#home", primary: open("AIRCRAFT 보기", "#fleet"), hand: { source: "CLEARANCE", id: c.id, to: c.toName, reason, text: c.text, card: handFor(c.toName, reason) } });
  }
  for (const p of inp.proposals) {
    if (!p.undelivered || p.status !== "approved" || !p.aircraftName) continue;
    const reason = p.undelivered.reason;
    out.push({ kind: "UNDELIVERED", key: `${p.id}|${p.undelivered.at}`, since: p.undelivered.at, title: `FLIGHT PLAN ${p.flight} → ${p.aircraftName}`, hash: "#home", primary: open("AIRCRAFT 보기", "#fleet"), hand: { source: "FLIGHT PLAN", id: p.id, to: p.aircraftName, reason, text: null, card: handFor(p.aircraftName, reason) } });
  }

  // ── HOME의 한 목록에 더한 종류(ATC-454). 같은 사실은 한 번만: 이미 큐 줄이 있는 FLIGHT의 ALERT·STUCK 줄은 더하지 않는다 ──
  const held = new Set<string>();
  for (const p of inp.proposals) if (p.status === "proposed" && !(p.kind === "ASSIGN" && p.holdAt !== null) && !(inp.autoDispatch && p.kind === "ASSIGN")) held.add(p.flight);
  for (const op of inp.schedule.ops) if (inp.schedule.mode === "approval" && op.status === "draft" && op.flight) held.add(op.flight);
  for (const pr of inp.pulls) if (!pr.draft && pr.ticketKey && (waitsOnHuman(pr.humanCheck) || (pr.landing === "CLEARED" && pr.landBy === "supervisor"))) held.add(pr.ticketKey);
  for (const o of inp.relayOffers ?? []) if (o.flight) held.add(o.flight);
  for (const b of inp.backlog ?? []) held.add(b.key);
  for (const i of out) if (i.kind === "UNDELIVERED" && i.hand?.source === "FLIGHT PLAN") { const p = inp.proposals.find((x) => x.id === i.hand!.id); if (p) held.add(p.flight); }

  for (const a of actionableAlertsOf(inp.alerts ?? [])) {
    if (a.flight && held.has(a.flight)) continue;
    out.push({ kind: "ALERT", key: a.key, since: a.since, title: [a.aircraft, a.flight].filter(Boolean).join(" · ") || a.group.toUpperCase(), hash: a.link, primary: open("열기", a.link), detail: a.text, need: a.next || "확인", level: a.level === "warning" ? "warning" : "caution", ...(a.flight ? { flight: a.flight } : {}) });
  }

  // DECISION(ATC-352): 관제 세션이 올린 결정. 답이 오거나 세션이 거두면 사라진다
  for (const d of inp.decisions ?? []) {
    if (d.status !== "open") continue;
    out.push({ kind: "DECISION", key: d.id, since: d.at, title: `${d.role.toUpperCase()}${d.pr ? ` PR #${d.pr.number}` : ""}: ${d.ask.length > 80 ? `${d.ask.slice(0, 79)}…` : d.ask}`, hash: d.pr ? "#strips" : "#home", primary: open("답하기", "#home"), decision: { id: d.id, role: d.role, ask: d.ask, options: d.options, pr: d.pr } });
  }

  for (const r of stuckRowsOf(inp.follow?.bundles ?? [])) {
    if (held.has(r.key)) continue;
    const info = r.proposalInfo;
    const brake = info && (canCancel(info) || canRecall(info)) ? { id: info.id, status: info.status, aircraftName: info.aircraftName, departedStand: info.departedStand, departedVia: info.departedVia ?? null, mode: inp.follow?.dispatchMode ?? "approval" } : null;
    const hash = r.next?.href ?? `#flight/${r.key}`;
    out.push({ kind: "STUCK", key: r.key, since: r.stuck?.since ?? null, title: r.key, hash, primary: brake ? { action: "brake", label: canCancel(info!) ? "CANCEL" : "RECALL" } : open(r.next?.label ?? "FLIGHT 열기", hash), ...(r.stuck?.text ? { detail: r.stuck.text } : {}), need: r.next?.label ?? "원인을 보고 CANCEL·RECALL하거나 풀어 준다", flight: r.key, ...(brake ? { brake } : {}) });
  }

  for (const v of openBadOf(inp.effects ?? [])) {
    out.push({ kind: "EFFECT", key: v.flight, since: v.at, title: `${v.flight} ${v.verdict}`, hash: `#flight/${v.flight}`, primary: open("FLIGHT 열기", `#flight/${v.flight}`), detail: effectLine(v), need: "목표를 못 맞췄다: 원인을 보거나, 평결이 틀렸으면 틀림으로 표시한다", flight: v.flight });
  }

  for (const c of inp.closes ?? []) {
    out.push({ kind: "CLOSE", key: c.id, since: c.statusAt, title: `CLOSE ${c.flight ?? c.id}`, hash: "#home", primary: open("Linear에서 열기", "#home", c.url ?? undefined), detail: `승인한 CLOSE · PR ${c.pr.repo.split("/").pop()}#${c.pr.number}`, need: "OCC는 이슈 상태를 바꾸지 않는다: Linear에서 Done으로 바꾼다", pr: c.pr, ...(c.flight ? { flight: c.flight } : {}) });
  }

  // ARRIVED(ATC-473): 이미 큐 줄이 있는 FLIGHT는 더하지 않는다. 제목은 atc 말(FLIGHT key·AIRCRAFT), 티켓 제목과 보고 글은 detail에
  for (const a of inp.arrived ?? []) {
    if (held.has(a.flight)) continue;
    out.push({
      kind: "ARRIVED",
      key: a.flight,
      since: a.arrivedAt,
      title: `${a.flight}${a.aircraft ? ` → ${a.aircraft}` : ""}`,
      hash: `#flight/${a.flight}`,
      primary: { action: "done", label: "Done…" },
      detail: [a.title, a.note].filter(Boolean).join(" · ").slice(0, 400),
      need: `ARRIVED인데 Linear는 아직 ${a.state}: 확인하고 Done으로 옮긴다`,
      flight: a.flight,
      arrived: a,
    });
  }

  return queueOrderOf(out);
}

// 한 순서(ATC-454): 1 WARNING, 2 팀을 붙잡는 것(PROPOSAL 승인 대기·STUCK·NEEDS YOU·GO), 3 나머지. 그룹 안에서는 오래 기다린 것이 먼저, since가 없는 것은 그룹 맨 뒤. 순수
export const queueGroupOf = (i: Pick<QueueItem, "kind" | "level">): 0 | 1 | 2 =>
  i.kind === "ALERT" && i.level === "warning" ? 0 : i.kind === "PROPOSAL" || i.kind === "STUCK" || i.kind === "NEEDS YOU" || i.kind === "GO" ? 1 : 2;

export const queueOrderOf = (items: readonly QueueItem[]): QueueItem[] =>
  [...items].sort((a, b) => queueGroupOf(a) - queueGroupOf(b) || sinceMs(a) - sinceMs(b) || kindRank(a) - kindRank(b) || a.key.localeCompare(b.key));

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
