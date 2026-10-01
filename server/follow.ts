import { isReady } from "./detail.ts";
import { waitsOnHuman } from "./human-check.ts";
import type { FollowIssue, FollowItem } from "./following.ts";
import { hhmm } from "./health.ts";
import type { Milestones } from "./milestones.ts";
import type { Clearance, PullRequest, Ticket } from "./model.ts";
import { type FlightProgress, progressText } from "./progress.ts";
import type { Plan } from "./dispatch.ts";
import { type Proposal, READBACK_OVERDUE_MS } from "./proposals.ts";
import { TEAM_KEY } from "./linear-keys.ts";

// FOLLOW(docs/follow.md): SUPERVISOR가 따라가기로 한 상위 이슈(번들)마다 하위 이슈의 단계를 한 줄씩 보인다.
// 새 사실은 없다 — 스냅샷, 제안(proposals), FLIGHT FOLLOWING, OOOI, DISPATCH 계획을 이슈마다 한 곳에서 합친다(순수).
// readback → arrived는 followingOf가 이미 센 것을 그대로 읽고 다시 세지 않는다. 브라우저에서도 타입을 쓰므로 node 모듈은 순수 함수만 끌어온다.

const MIN = 60_000;
const DAY = 86_400_000;
export const FOLD_AFTER_MS = DAY; // 모두 끝난 번들은 하루 열려 있다가 접힌다

export const FOLLOW_STAGES = ["todo", "proposed", "approved", "sent", "readback", "pr", "ci", "landed", "deployed"] as const;
export type FollowStage = (typeof FOLLOW_STAGES)[number];

export interface StageCell {
  done: boolean;
  at: string | null; // 닿은 시각. 모르면 null(done이어도)
  na: boolean; // 이 FLIGHT에는 없는 단계(STAND 없는 FLIGHT의 PR, tail: FLIGHT의 제안, MCC AIRPORT가 아닌 곳의 deployed)
}

// F2(docs/follow.md 3.3·3.4): 막힌 줄과 다음 할 일. 둘 다 줄 모델에 더하는 새 필드다
export const STUCK_TODO_MIN = 30; // 우선순위가 있는 Todo인데 제안이 없음
export const STUCK_APPROVED_MIN = 10; // 승인됐는데 발송 없음
export const STUCK_LANDED_MIN = 15; // 착륙(ON)했는데 배포(IN) 없음(RTS는 5분마다 묶는다)

export interface FollowStuck {
  stage: FollowStage; // 어느 단계에서 막혔나(그 점이 amber가 된다)
  code: "todo-no-proposal" | "approved-not-sent" | "landed-not-deployed" | "sent-no-readback" | "undelivered" | "no-pr" | "pr-not-cleared" | "landing-wait";
  text: string;
  since: string | null;
}

export type FollowNextKind = "release" | "priority" | "approve" | "human-check" | "merge" | "look";
export interface FollowNext {
  kind: FollowNextKind;
  label: string;
  href: string | null; // 링크가 가는 곳. release는 링크가 아니라 기존 상태 길을 부르는 버튼이다(null)
  proposal?: string; // approve: 기다리는 제안
}

export interface FollowRow {
  key: string;
  title: string | null;
  url: string | null;
  state: string | null; // Linear 상태 이름
  stateType: string | null;
  unreadable: boolean; // 스냅샷에 없는 이슈(45일 창 밖이거나 다른 팀): 상태를 짐작하지 않는다
  stages: Record<FollowStage, StageCell>;
  current: FollowStage | null; // 닿은 마지막 단계
  finished: boolean;
  now: string; // 지금 어디에 있나 한 줄
  issues: { code: FollowIssue["code"]; severity: FollowIssue["severity"]; text: string }[]; // FLIGHT FOLLOWING의 문제(같은 코드·같은 글)
  history: { at: string; text: string }[]; // 단계 시각과 RECALL·거절·SUPERSEDED 같은 되돌림, 시각순
  proposal: string | null; // 지금 이 줄을 이끄는 제안 D-xxxx
  standFree: boolean;
  tail: boolean;
  stuck: FollowStuck | null;
  next: FollowNext | null; // 한 줄에 최대 하나(3.4의 순서)
  // F3(ATC-278, 알림이 읽는다. 더하기만 한 칸): 풀 수 있는 Backlog, 살아 있는 GO AROUND, 되돌려진 ON
  ready: boolean;
  goAround: { id: string; readbackAt: string | null } | null;
  reverted: { number: number; at: string } | null;
}

export interface FollowBundle {
  parent: string;
  title: string | null;
  url: string | null;
  state: string | null;
  missing: boolean; // 스냅샷에 상위 이슈가 없다
  rows: FollowRow[];
  total: number;
  finished: number;
  flying: number; // 발송 이후 끝나지 않은 줄
  next: number; // 다음 할 일이 있는 줄(F2)
  stuck: number; // 막힌 줄(F2)
  done: boolean;
  doneAt: string | null;
  folded: boolean; // 모두 끝난 지 하루가 지남
}

export interface FollowInput {
  parents: readonly string[];
  tickets: readonly Ticket[];
  proposals: readonly Proposal[];
  pulls: readonly PullRequest[];
  clearances: readonly Pick<Clearance, "id" | "type" | "flight" | "at" | "readbackAt" | "cancelledAt">[];
  milestones: ReadonlyMap<string, Milestones>;
  following: readonly FollowItem[];
  progress: Readonly<Record<string, FlightProgress>>;
  plan: Pick<Plan, "hold" | "excluded" | "unserved"> | null;
  noDeploy: ReadonlySet<string>; // MCC AIRPORT가 아닌 곳의 FLIGHT: deployed가 없고 ON이 끝이다
  userPulls?: ReadonlySet<number>; // MCC AIRPORT에서 SUPERVISOR가 머지할 PR 번호(`user` 등급 또는 ESCALATE). 없으면 merge 칩이 없다
  airports?: readonly { code: string; repo: string }[]; // PR 서랍 주소(#pr/<AIRPORT>/<번호>)용
  now: number;
}

const isFinishedType = (t: string | null | undefined) => t === "completed" || t === "canceled" || t === "duplicate";
const minSince = (iso: string | null | undefined, now: number) => (iso && Number.isFinite(Date.parse(iso)) ? Math.max(0, Math.round((now - Date.parse(iso)) / MIN)) : null);
const stamp = (iso: string | null | undefined, now: number) => (iso ? hhmm(Date.parse(iso), now) : "—");

// 새 제안으로 이어지지 않고 줄을 todo로 되돌리는 끝 상태
const RESET = new Set<Proposal["status"]>(["declined", "recalled", "superseded", "rejected", "expired"]);
const RESET_LABEL: Partial<Record<Proposal["status"], string>> = { declined: "UNABLE", recalled: "RECALL", superseded: "SUPERSEDED", rejected: "거절됨", expired: "만료" };

// 번들의 줄 key: 상위 이슈의 children + 상위 이슈와 related인 이슈. 하위가 없으면 상위 이슈 하나(번들 하나짜리)
export function bundleKeysOf(parent: string, tickets: readonly Ticket[]): string[] {
  const p = tickets.find((t) => t.key === parent);
  if (!p) return [];
  const kids = new Set<string>([...(p.children ?? []), ...tickets.filter((t) => t.parent === parent).map((t) => t.key)]);
  const rel = new Set<string>([...(p.related ?? []), ...tickets.filter((t) => t.related?.includes(parent)).map((t) => t.key)]);
  const keys = [...new Set([...kids, ...rel])].filter((k) => k !== parent);
  return keys.length ? keys : [parent];
}

// blockedBy 사슬 순서(막는 쪽이 먼저), 같은 층은 key 순. 고리가 있으면 남은 것을 key 순으로 붙인다
export function chainOrder(keys: readonly string[], tickets: readonly Ticket[]): string[] {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const inSet = new Set(keys);
  const deps = new Map(keys.map((k) => [k, (byKey.get(k)?.blockedBy ?? []).filter((b) => inSet.has(b) && b !== k)]));
  const out: string[] = [];
  const left = new Set(keys);
  while (left.size) {
    const ready = [...left].filter((k) => deps.get(k)!.every((d) => !left.has(d))).sort();
    if (!ready.length) {
      out.push(...[...left].sort());
      break;
    }
    out.push(ready[0]);
    left.delete(ready[0]);
  }
  return out;
}

const cell = (done: boolean, at: string | null = null, na = false): StageCell => ({ done, at, na });

// 줄 하나(순수)
export function followRowOf(key: string, inp: Omit<FollowInput, "parents">): FollowRow {
  const { now } = inp;
  const t = inp.tickets.find((x) => x.key === key);
  const item = inp.following.find((f) => f.flight === key);
  const m = inp.milestones.get(key) ?? null;
  const pull = inp.pulls.filter((p) => p.ticketKey === key).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const mine = inp.proposals.filter((p) => p.kind === "ASSIGN" && p.flight === key).sort((a, b) => a.at.localeCompare(b.at));
  const live = mine.filter((p) => !RESET.has(p.status)).at(-1) ?? null; // 지금 이 줄을 이끄는 제안
  const resets = mine.filter((p) => RESET.has(p.status));
  const tail = !live && item?.source === "tail";
  const standFree = Boolean(item?.standFree);
  const tl = live?.timeline ?? {};
  const fin = isFinishedType(t?.stateType);
  const noDeploy = inp.noDeploy.has(key);
  const backlog = t?.stateType === "backlog" || t?.stateType === "triage";
  const ready = Boolean(t && backlog && isReady(t.stateType, t.blockedBy.map((k) => inp.tickets.find((x) => x.key === k)?.stateType ?? null)));
  const go = inp.clearances.filter((x) => x.type === "GO AROUND" && x.flight === key && !x.cancelledAt).sort((a, b) => b.at.localeCompare(a.at))[0];

  const started = Boolean(t && t.stateType !== "backlog" && t.stateType !== "triage" && t.stateType !== "unknown");
  const proposedAt = live ? (tl.proposed ?? live.at) : null;
  const sentAt = tl.sent ?? null;
  const readbackAt = tl.accepted ?? (tl.departed ?? null);
  const prAt = standFree ? null : (m?.off ?? item?.stages.prOpened ?? pull?.createdAt ?? null);
  const cleared = pull?.landing === "CLEARED" ? pull.readyAt : (item?.stages.cleared ?? null);
  const landedAt = standFree ? null : (m?.on ?? item?.stages.arrived ?? null);
  const deployedAt = m?.in ?? null;

  const stages: Record<FollowStage, StageCell> = {
    todo: cell(started, null),
    proposed: tail ? cell(false, null, true) : cell(Boolean(live), proposedAt),
    approved: tail ? cell(false, null, true) : cell(Boolean(tl.approved), tl.approved ?? null),
    sent: tail ? cell(false, null, true) : cell(Boolean(sentAt), sentAt),
    readback: tail ? cell(false, null, true) : cell(Boolean(readbackAt), readbackAt),
    pr: standFree ? cell(false, null, true) : cell(Boolean(prAt || landedAt), prAt),
    ci: standFree ? cell(false, null, true) : cell(Boolean(cleared || landedAt), cleared),
    landed: standFree ? cell(false, null, true) : cell(Boolean(landedAt), landedAt),
    deployed: standFree || noDeploy ? cell(false, null, true) : cell(Boolean(deployedAt), deployedAt),
  };
  // 닿은 단계가 앞 단계를 건너뛴 경우(직접 맡긴 FLIGHT 등): 사실만 보이고 앞 칸을 지어내지 않는다
  const reached = FOLLOW_STAGES.filter((s) => stages[s].done);
  const current = reached.at(-1) ?? null;

  const arrivedFree = standFree && Boolean(item?.stages.arrived);
  const finished = t?.stateType === "canceled" || t?.stateType === "duplicate" || arrivedFree || (fin && (stages.deployed.done || stages.deployed.na || !stages.landed.done));

  const issues = (item?.issues ?? []).map((i) => ({ code: i.code, severity: i.severity, text: i.text }));
  const history: FollowRow["history"] = [];
  const add = (at: string | null | undefined, text: string) => at && history.push({ at, text });
  for (const p of resets) add(p.statusAt, `${p.id} ${RESET_LABEL[p.status] ?? p.status}${p.reason ? ` — ${p.reason}` : ""}`);
  add(proposedAt, `${live?.id ?? ""} proposed`.trim());
  add(tl.approved, "approved");
  add(sentAt, "FLIGHT PLAN 발송");
  add(readbackAt, "READBACK");
  add(prAt, "PR 열림");
  add(cleared, "CLEARED TO LAND");
  add(landedAt, "착륙(ON)");
  add(deployedAt, "배포(IN)");
  if (m?.reverted) add(m.reverted.at, `PR #${m.reverted.number}로 되돌려짐`);
  history.sort((a, b) => a.at.localeCompare(b.at));

  const stuck = finished ? null : stuckOf({ key, t, live, resets, item, stages, standFree, tail, inp });
  return {
    key,
    title: t?.title ?? null,
    url: t?.url ?? null,
    state: t?.state ?? null,
    stateType: t?.stateType ?? null,
    unreadable: !t,
    stages,
    current,
    finished,
    now: nowText({ key, t, live, resets, item, pull, stages, finished, standFree, tail, noDeploy, inp }),
    issues,
    history,
    proposal: live?.id ?? null,
    standFree,
    tail,
    stuck,
    next: finished ? null : nextOf({ key, t, live, pull, item, stuck, tail, inp }),
    ready,
    goAround: go ? { id: go.id, readbackAt: go.readbackAt ?? null } : null,
    reverted: m?.reverted ? { number: m.reverted.number, at: m.reverted.at } : null,
  };
}

interface StuckCtx {
  key: string;
  t: Ticket | undefined;
  live: Proposal | null;
  resets: Proposal[];
  item: FollowItem | undefined;
  stages: Record<FollowStage, StageCell>;
  standFree: boolean;
  tail: boolean;
  inp: Omit<FollowInput, "parents">;
}

// 3.3의 막힘. 처음 맞는 것 하나. 기존 FLIGHT FOLLOWING 한도(undelivered, no-pr, pr-not-cleared, landing-wait)와 FLIGHT PLAN READBACK 지연은 그대로 쓰고,
// 새 셋(우선순위 있는 Todo 30분, 승인 뒤 발송 없음 10분, ON 뒤 IN 없음 15분)을 더한다
function stuckOf(c: StuckCtx): FollowStuck | null {
  const { t, live, stages, inp } = c;
  const now = inp.now;
  if (!t) return null;
  const mins = (iso: string | null | undefined) => minSince(iso, now);
  const issue = (code: FollowIssue["code"]) => c.item?.issues.find((i) => i.code === code);
  const un = issue("undelivered");
  if (un) return { stage: "sent", code: "undelivered", text: un.text, since: un.since };
  if (live?.status === "sent" && !stages.readback.done && !live.awaitSupervisor && stages.sent.at && now - Date.parse(stages.sent.at) > READBACK_OVERDUE_MS)
    return { stage: "sent", code: "sent-no-readback", text: `발송 ${mins(stages.sent.at)}분 · READBACK 없음`, since: stages.sent.at };
  if (live?.status === "approved" && stages.approved.at && now - Date.parse(stages.approved.at) >= STUCK_APPROVED_MIN * MIN)
    return { stage: "approved", code: "approved-not-sent", text: `승인 ${mins(stages.approved.at)}분 · 발송 없음`, since: stages.approved.at };
  for (const [code, stage] of [["no-pr", "readback"], ["pr-not-cleared", "pr"], ["landing-wait", "ci"]] as const) {
    const i = issue(code);
    if (i) return { stage, code, text: i.text, since: i.since };
  }
  if (stages.landed.done && !stages.deployed.done && !stages.deployed.na && stages.landed.at && now - Date.parse(stages.landed.at) >= STUCK_LANDED_MIN * MIN)
    return { stage: "landed", code: "landed-not-deployed", text: `착륙 ${mins(stages.landed.at)}분 · 배포(IN) 없음`, since: stages.landed.at };
  // Todo + 우선순위 + 제안 없음. 선행 FLIGHT를 기다리는 HOLD와 지정 팀이 정해진(tail:) FLIGHT는 일부러 기다리는 것이라 막힘이 아니다
  if (t.stateType === "unstarted" && t.state === "Todo" && t.priority > 0 && !live && !c.tail && !c.standFree && !c.item?.stages.readback && !c.item?.stages.departed && !inp.plan?.hold.some((h) => h.flight === c.key)) {
    const since = [t.updatedAt, ...c.resets.map((r) => r.statusAt)].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
    if (since && now - Date.parse(since) >= STUCK_TODO_MIN * MIN) return { stage: "proposed", code: "todo-no-proposal", text: `제안 없이 Todo ${mins(since)}분`, since };
  }
  return null;
}

interface NextCtx {
  key: string;
  t: Ticket | undefined;
  live: Proposal | null;
  pull: PullRequest | undefined;
  item: FollowItem | undefined;
  stuck: FollowStuck | null;
  tail: boolean;
  inp: Omit<FollowInput, "parents">;
}

// 3.4의 다음 할 일. 한 줄에 최대 하나, 순서대로 처음 맞는 것. 쓰는 것은 release 하나(기존 상태 길)이고 나머지는 이미 있는 화면으로 가는 링크다
function nextOf(c: NextCtx): FollowNext | null {
  const { t, live, pull, stuck, inp } = c;
  if (!t) return null;
  if (t.stateType === "backlog" && isReady(t.stateType, t.blockedBy.map((k) => inp.tickets.find((x) => x.key === k)?.stateType ?? null)))
    return { kind: "release", label: "Todo로", href: null };
  if (t.stateType === "unstarted" && t.priority === 0 && !live && !c.tail) return { kind: "priority", label: "우선순위 정하기", href: `#flight/${c.key}` };
  if (live?.status === "proposed" && live.holdAt == null) return { kind: "approve", label: `승인하러 ${live.id}`, href: "#dispatch", proposal: live.id };
  if (pull) {
    const code = inp.airports?.find((a) => a.repo === pull.repo)?.code;
    const href = code ? `#pr/${code}/${pull.number}` : null;
    if (waitsOnHuman(pull.humanCheck)) return { kind: "human-check", label: `HUMAN CHECK #${pull.number}`, href };
    if (pull.landing === "CLEARED" && inp.userPulls?.has(pull.number)) return { kind: "merge", label: `머지 #${pull.number}`, href };
  }
  if (stuck && (stuck.stage === "sent" || stuck.stage === "readback")) return { kind: "look", label: "살펴보기", href: "#radio" };
  if (stuck && stuck.stage === "landed") return { kind: "look", label: "살펴보기", href: "#strips" };
  return null;
}

interface NowCtx {
  key: string;
  t: Ticket | undefined;
  live: Proposal | null;
  resets: Proposal[];
  item: FollowItem | undefined;
  pull: PullRequest | undefined;
  stages: Record<FollowStage, StageCell>;
  finished: boolean;
  standFree: boolean;
  tail: boolean;
  noDeploy: boolean;
  inp: Omit<FollowInput, "parents">;
}

// 3.3의 지금 글. 처음 맞는 것 하나
function nowText(c: NowCtx): string {
  const { t, live, stages, inp } = c;
  const now = inp.now;
  if (!t) return "Linear에서 못 읽음";
  if (t.stateType === "canceled" || t.stateType === "duplicate") return "취소됨";
  if (c.finished) {
    if (c.standFree) return `ARRIVED ${stamp(c.item?.stages.arrived, now)}`;
    if (stages.deployed.at) return `${stamp(stages.deployed.at, now)} 배포`;
    if (stages.landed.at) return `${stamp(stages.landed.at, now)} 착륙`;
    return "Done";
  }
  if (t.stateType === "backlog" || t.stateType === "triage") {
    const open = t.blockedBy.filter((k) => !isFinishedType(inp.tickets.find((x) => x.key === k)?.stateType));
    const ready = isReady(t.stateType, t.blockedBy.map((k) => inp.tickets.find((x) => x.key === k)?.stateType ?? null));
    // 막는 이슈가 없으면 "풀린 것"이 아니라 그냥 Backlog다(isReady와 같은 기준)
    return ready ? "풀 수 있음" : open.length ? `${open.join(", ")} 대기` : "Backlog";
  }
  const open = c.pull;
  if (stages.landed.done) {
    const rev = inp.milestones.get(c.key)?.reverted;
    return `RTS 대기${stages.landed.at ? ` · ${stamp(stages.landed.at, now)} 착륙` : ""}${rev ? ` · PR #${rev.number}로 되돌려짐` : ""}`;
  }
  if (stages.pr.done && open && open.landing !== "CLEARED") {
    const go = inp.clearances.filter((x) => x.type === "GO AROUND" && x.flight === c.key && !x.cancelledAt).sort((a, b) => b.at.localeCompare(a.at))[0];
    const blocks = open.blocks.map((b) => b.code).join(", ");
    return `PR #${open.number} ${blocks || "막힘 없음"}${go ? ` · GO AROUND ${go.id} ${go.readbackAt ? `READBACK ${stamp(go.readbackAt, now)}` : "READBACK 대기"}` : ""}`;
  }
  if (stages.ci.done || (open && open.landing === "CLEARED")) return "착륙 대기";
  if (stages.pr.done) return `PR #${open?.number ?? "?"} 열림`;
  if (live) {
    if (live.status === "recalling") return `RECALL ${minSince(live.statusAt, now) ?? 0}분 · READBACK 대기`;
    if (stages.readback.done) {
      const p = inp.progress[c.key];
      const line = p ? progressText(p) : "";
      return line || `READBACK ${minSince(stages.readback.at, now) ?? 0}분 전`;
    }
    if (stages.sent.done) return `발송 ${minSince(stages.sent.at, now) ?? 0}분 · READBACK 대기`;
    if (stages.approved.done) return `승인 ${minSince(stages.approved.at, now) ?? 0}분 · 발송 없음`;
    return "승인 대기";
  }
  if (c.tail) {
    const p = inp.progress[c.key];
    return (p ? progressText(p) : "") || "작업 중";
  }
  if (c.item?.stages.readback || c.item?.stages.departed) return progressText(inp.progress[c.key] ?? null) || "작업 중";
  // Todo인데 제안이 없다: DISPATCH가 왜 안 배정했나
  const why = dispatchWhy(c.key, t, inp.plan);
  if (why) return why;
  const last = c.resets.at(-1);
  if (last) return `${last.id} ${RESET_LABEL[last.status] ?? last.status}${last.reason ? ` — ${last.reason}` : ""}`;
  return t.stateType === "started" ? "작업 중" : "배정 대기";
}

function dispatchWhy(key: string, t: Ticket, plan: FollowInput["plan"]): string | null {
  if (plan) {
    const h = plan.hold.find((x) => x.flight === key);
    if (h) return `HOLD — ${h.why ?? h.blockedBy.join(", ")}`;
    const ex = plan.excluded.find((x) => x.flight === key);
    if (ex) return ex.reason;
    const un = plan.unserved?.find((x) => x.flight === key);
    if (un) return un.why === "no-tail" ? `AIRCRAFT 없음 (${un.tails.join(", ")})` : un.why === "unqualified" ? "AIRCRAFT 자격 없음" : "AIRCRAFT 없음";
  }
  return t.priority === 0 ? "우선순위 없음" : null;
}

// 번들 전체(순수). parents 순서를 지킨다
export function followBoardOf(inp: FollowInput): FollowBundle[] {
  const { parents, ...rest } = inp;
  return parents.map((parent) => {
    const p = inp.tickets.find((t) => t.key === parent);
    const keys = chainOrder(bundleKeysOf(parent, inp.tickets), inp.tickets);
    // 막힌 줄이 번들 맨 위로(3.3). 나머지는 사슬 순서 그대로(안정 정렬)
    const rows = keys.map((k) => followRowOf(k, rest)).map((r, i) => ({ r, i })).sort((a, b) => Number(Boolean(b.r.stuck)) - Number(Boolean(a.r.stuck)) || a.i - b.i).map((x) => x.r);
    const finished = rows.filter((r) => r.finished).length;
    const flying = rows.filter((r) => !r.finished && (r.stages.sent.done || r.stages.pr.done || r.tail)).length;
    const done = rows.length > 0 && finished === rows.length;
    const ends = rows.flatMap((r) => [r.stages.deployed.at, r.stages.landed.at, r.history.at(-1)?.at ?? null]).filter((x): x is string => Boolean(x));
    const doneAt = done && ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null;
    return {
      parent,
      title: p?.title ?? null,
      url: p?.url ?? null,
      state: p?.state ?? null,
      missing: !p,
      rows,
      total: rows.length,
      finished,
      flying,
      next: rows.filter((r) => r.next).length,
      stuck: rows.filter((r) => r.stuck).length,
      done,
      doneAt,
      folded: Boolean(done && doneAt && inp.now - Date.parse(doneAt) > FOLD_AFTER_MS),
    };
  });
}

// ── follow.json(설정): 따라가는 상위 이슈 key. 기록이 아니라 설정이다 ──

export interface FollowFile {
  parents: string[];
}

export function parseFollowFile(raw: unknown): FollowFile {
  const arr = raw && typeof raw === "object" && Array.isArray((raw as { parents?: unknown }).parents) ? ((raw as { parents: unknown[] }).parents) : [];
  const out: string[] = [];
  for (const x of arr) if (typeof x === "string" && isIssueKey(x) && !out.includes(x.toUpperCase())) out.push(x.toUpperCase());
  return { parents: out };
}

// "ATC-276" 모양
export const isIssueKey = (k: string) => /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/i.test(k) && TEAM_KEY.test(k.split("-")[0].toUpperCase());

// POST 본문 검사: 읽는 Linear 팀의 이슈 key만 받는다
export function parseFollowBody(body: unknown, teams: readonly string[]): { ok: true; parent: string; on: boolean } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.on !== "boolean") return { ok: false, error: "on(true|false)이 필요함" };
  const parent = typeof b.parent === "string" ? b.parent.trim().toUpperCase() : "";
  if (!isIssueKey(parent)) return { ok: false, error: "이슈 key 형식이 아님(예: ATC-253)" };
  if (!teams.map((t) => t.toUpperCase()).includes(parent.split("-")[0])) return { ok: false, error: `${parent.split("-")[0]} 팀은 읽지 않음` };
  return { ok: true, parent, on: b.on };
}

// 목록에 더하거나 뺀 새 목록(순수). 이미 있거나 없으면 그대로
export function toggleParent(file: FollowFile, parent: string, on: boolean): FollowFile {
  const has = file.parents.includes(parent);
  if (on) return has ? file : { parents: [...file.parents, parent] };
  return has ? { parents: file.parents.filter((p) => p !== parent) } : file;
}
