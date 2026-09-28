import { stopKey } from "./atfm.ts";
import { awayOperations } from "./away.ts";
import { inSequence, pullKey } from "./landing.ts";
import type { LandingBlockCode, PullRequest, Snapshot, TrafficEvent } from "./model.ts";

type Draft = Omit<TrafficEvent, "id" | "at">;

const alertKey = (a: Snapshot["alerts"][number]) => a.key ?? `${a.kind}|${a.workspacePath ?? ""}|${a.ticketKey ?? ""}`;
const handoffKey = (h: Snapshot["handoffs"][number]) => `${h.workspacePath}|${h.from}|${h.to}`;

// LANDING SEQUENCE에 든 PR(Draft 제외), 키는 "저장소#번호"
export function landingPulls(s: Snapshot): Map<string, PullRequest> {
  return new Map(s.pulls.filter(inSequence).map((p) => [pullKey(p), p]));
}

// CAPTAIN이 손써야 하는 막힘. CI 진행 중·GitHub 계산 중은 기다리면 풀리고, LOS는 충돌 경보가 따로 알린다.
const WAIT_CODES = new Set<LandingBlockCode>(["checks-pending", "merge-unknown", "los", "draft"]);
export const actionableBlocks = (p: PullRequest) => p.blocks.map((b) => b.code).filter((c) => !WAIT_CODES.has(c));

// 서버가 막 떠서 Linear 티켓이나 git 변경 수, GitHub PR을 아직 못 읽은 스냅샷. 이걸 기준으로 비교하면
// 원래 있던 경보가 전부 "새로" 뜬 것처럼 보인다. GitHub은 한 번 시도해서 실패만 했어도 따뜻한 것으로 본다
// (gh가 안 돼도 충돌 이벤트는 나가야 한다). 대신 LANDING 이벤트는 양쪽 다 PR을 읽었을 때만 비교한다.
export function isWarm(s: Snapshot): boolean {
  return (
    (!s.linear.enabled || s.linear.fetchedAt !== null) &&
    (!s.github.enabled || s.github.fetchedAt !== null || s.github.error !== null) &&
    s.workspaces.every((w) => w.dirty !== null)
  );
}

// 두 스냅샷의 차이를 이벤트로. 첫 스냅샷이나 덜 읽힌 스냅샷과는 비교하지 않는다(브리핑의 현재 상태가 대신한다).
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): Draft[] {
  if (!prev || !isWarm(prev) || !isWarm(next)) return [];
  const out: Draft[] = [];

  const before = new Map(prev.alerts.map((a) => [alertKey(a), a]));
  const after = new Map(next.alerts.map((a) => [alertKey(a), a]));
  for (const [key, a] of after) {
    if (!before.has(key)) out.push({ kind: "alert.raised", alertKind: a.kind, workspacePath: a.workspacePath, ticketKey: a.ticketKey, sessionIds: a.sessionIds, message: a.message });
  }
  for (const [key, a] of before) {
    if (!after.has(key)) out.push({ kind: "alert.cleared", alertKind: a.kind, workspacePath: a.workspacePath, ticketKey: a.ticketKey, sessionIds: a.sessionIds });
  }

  const seen = new Set(prev.handoffs.map(handoffKey));
  for (const h of next.handoffs) {
    if (!seen.has(handoffKey(h))) out.push({ kind: "handoff", workspacePath: h.workspacePath, sessionIds: [h.from, h.to] });
  }

  if (prev.github.fetchedAt && next.github.fetchedAt) out.push(...diffLanding(prev, next), ...diffGroundStops(prev, next));

  const pairs = (m: Map<string, string[]>) => new Set([...m].flatMap(([id, repos]) => repos.map((r) => `${id}|${r}`)));
  const wasAway = pairs(awayOperations(prev));
  const isAway = pairs(awayOperations(next));
  const split = (key: string) => key.split("|") as [string, string];
  for (const key of isAway) if (!wasAway.has(key)) out.push({ kind: "away.started", sessionIds: [split(key)[0]], repo: split(key)[1] });
  for (const key of wasAway) if (!isAway.has(key)) out.push({ kind: "away.ended", sessionIds: [split(key)[0]], repo: split(key)[1] });

  const holding = new Set(prev.claims.filter((c) => c.state === "active").map((c) => c.sessionId));
  const wasAlive = new Set(prev.sessions.filter((s) => s.status !== "dead").map((s) => s.id));
  for (const s of next.sessions) {
    if (s.status === "dead" && wasAlive.has(s.id) && holding.has(s.id)) out.push({ kind: "session.lost", sessionIds: [s.id] });
  }
  return out;
}

// LANDING SEQUENCE 진입·이탈, CLEARED TO LAND가 됨, 손써야 할 막힘이 새로 생김
function diffLanding(prev: Snapshot, next: Snapshot): Draft[] {
  const out: Draft[] = [];
  const was = landingPulls(prev);
  const is = landingPulls(next);
  const ref = (p: PullRequest) => ({ repo: p.repo, pull: p.number, ticketKey: p.ticketKey ?? undefined, workspacePath: p.standPath ?? undefined });
  const codes = (p: PullRequest) => p.blocks.map((b) => b.code);
  for (const [key, p] of is) {
    const before = was.get(key);
    if (!before) {
      out.push({ kind: "landing.requested", ...ref(p), blocks: codes(p), message: p.title });
      if (p.landing === "CLEARED") out.push({ kind: "landing.cleared", ...ref(p), ...(p.carried && !p.carried.findings ? { carriedFrom: p.carried.from } : {}) });
      continue;
    }
    if (p.landing === "CLEARED") {
      if (before.landing !== "CLEARED") out.push({ kind: "landing.cleared", ...ref(p), ...(p.carried && !p.carried.findings ? { carriedFrom: p.carried.from } : {}) });
      continue;
    }
    const had = new Set(actionableBlocks(before));
    if (actionableBlocks(p).some((c) => !had.has(c))) {
      out.push({ kind: "landing.blocked", ...ref(p), blocks: codes(p), message: p.blocks.map((b) => b.text).join(" · ") });
    }
  }
  for (const [key, p] of was) if (!is.has(key)) out.push({ kind: "landing.left", ...ref(p) });
  return out;
}

// 메모리 안의 이벤트 기록. 커서는 "epoch:seq"라서 서버가 재시작하면 epoch가 바뀌고 reset으로 알린다.
export class EventLog {
  readonly epoch = Date.now().toString(36);
  private seq = 0;
  private events: TrafficEvent[] = [];
  private readonly capacity: number;

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  push(drafts: Draft[], at = new Date().toISOString()): TrafficEvent[] {
    const added = drafts.map((d) => ({ ...d, id: ++this.seq, at }));
    this.events.push(...added);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    return added;
  }

  get cursor(): string {
    return `${this.epoch}:${this.seq}`;
  }

  since(cursor: string | null): { events: TrafficEvent[]; reset: boolean; cursor: string } {
    const [epoch, seq] = (cursor ?? "").split(":");
    const reset = epoch !== this.epoch;
    const after = reset ? 0 : Number(seq) || 0;
    return { events: this.events.filter((e) => e.id > after), reset: Boolean(cursor) && reset, cursor: this.cursor };
  }
}

// 켜진 스위치로 실제로 막는 출발 중지(GROUND STOP)의 시작·끝. TOWER가 HOLD·CONTINUE CLEARANCE를 낸다.
// 그림자 출발 중지는 이벤트를 내지 않는다(FLIGHT RECORDER의 atfm 줄에만 남는다).
export function diffGroundStops(prev: Snapshot, next: Snapshot): Draft[] {
  const on = (s: Snapshot) => new Map((s.atfm?.groundStops ?? []).filter((g) => g.enforced && g.kind === "stop").map((g) => [stopKey(g), g]));
  const was = on(prev);
  const is = on(next);
  const out: Draft[] = [];
  for (const [k, g] of is) if (!was.has(k)) out.push({ kind: "groundstop.started", repo: g.repo ?? undefined, message: g.text });
  for (const [k, g] of was) if (!is.has(k)) out.push({ kind: "groundstop.ended", repo: g.repo ?? undefined, message: g.text });
  return out;
}
