import { config } from "./config.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";

type Draft = Omit<TrafficEvent, "id" | "at">;

const alertKey = (a: Snapshot["alerts"][number]) => `${a.kind}|${a.workspacePath ?? ""}|${a.ticketKey ?? ""}`;
const handoffKey = (h: Snapshot["handoffs"][number]) => `${h.workspacePath}|${h.from}|${h.to}`;

export function landingKeys(s: Snapshot): Set<string> {
  return new Set(s.tickets.filter((t) => t.state === config.landingState).map((t) => t.key));
}

// 서버가 막 떠서 Linear 티켓이나 git 변경 수를 아직 못 읽은 스냅샷. 이걸 기준으로 비교하면
// 원래 있던 경보가 전부 "새로" 뜬 것처럼 보인다.
export function isWarm(s: Snapshot): boolean {
  return (!s.linear.enabled || s.linear.fetchedAt !== null) && s.workspaces.every((w) => w.dirty !== null);
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

  const wasLanding = landingKeys(prev);
  const isLanding = landingKeys(next);
  for (const key of isLanding) if (!wasLanding.has(key)) out.push({ kind: "landing.requested", ticketKey: key });
  for (const key of wasLanding) if (!isLanding.has(key)) out.push({ kind: "landing.left", ticketKey: key });

  const holding = new Set(prev.claims.filter((c) => c.state === "active").map((c) => c.sessionId));
  const wasAlive = new Set(prev.sessions.filter((s) => s.status !== "dead").map((s) => s.id));
  for (const s of next.sessions) {
    if (s.status === "dead" && wasAlive.has(s.id) && holding.has(s.id)) out.push({ kind: "session.lost", sessionIds: [s.id] });
  }
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

  push(drafts: Draft[], at = new Date().toISOString()) {
    for (const d of drafts) this.events.push({ ...d, id: ++this.seq, at });
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
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
