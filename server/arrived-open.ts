import type { LogEntry } from "./logbook.ts";
import { type Ticket, parentKeysOf } from "./model.ts";
import { standFreeTicket } from "./proposals.ts";

// STAND 없는 FLIGHT(SURVEY·CHECK, ATC-72)가 LOGBOOK에는 ARRIVED인데 Linear 이슈는 아직 started(In Progress)인 것(ATC-473). 순수 함수만.
// 그런 FLIGHT는 워크트리가 없으니 "진행 중인데 워크트리가 없음" 알림은 아무것도 알리지 못한다(아래 noWorkspaceKeysOf가 뺀다).
// 대신 SUPERVISOR의 할 일 한 줄(HOME의 큐, 종류 ARRIVED)이 되고, 확인한 클릭 하나로 Done으로 옮긴다. 옮겨도 되는 FLIGHT의 규칙은 이 목록 하나다: 목록에 든 것만 옮긴다.

export interface ArrivedOpen {
  flight: string;
  title: string;
  state: string; // Linear의 지금 상태 이름(옮길 때의 from)
  aircraft: string | null;
  arrivedAt: string;
  note: string | null; // ARRIVED 보고의 글
  result: string | null; // 결과 링크
  issueUrl: string | null;
}

type EntryLike = Pick<LogEntry, "flight" | "aircraft" | "arrivedAt" | "reverted" | "standFree">;
type TicketLike = Pick<Ticket, "key" | "title" | "state" | "stateType" | "labels" | "url">;

// STAND가 필요 없고, 되돌려지지 않은 LOGBOOK ARRIVED 줄이 있고, Linear 상태가 아직 started인 FLIGHT. 가장 늦은 ARRIVED 줄을 쓴다. 도착이 오래된 것부터
export function arrivedOpenOf(tickets: readonly TicketLike[], entries: readonly EntryLike[]): ArrivedOpen[] {
  const latest = new Map<string, EntryLike>();
  for (const e of entries) {
    if (!e.flight || e.reverted) continue;
    const prev = latest.get(e.flight);
    if (!prev || prev.arrivedAt < e.arrivedAt) latest.set(e.flight, e);
  }
  const out: ArrivedOpen[] = [];
  for (const t of tickets) {
    const e = latest.get(t.key);
    if (!e || t.stateType !== "started" || !standFreeTicket(t)) continue;
    out.push({ flight: t.key, title: t.title, state: t.state, aircraft: e.aircraft, arrivedAt: e.arrivedAt, note: e.standFree?.evidence.note ?? null, result: e.standFree?.evidence.url ?? null, issueUrl: t.url });
  }
  return out.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.flight.localeCompare(b.flight));
}

// "진행 중인데 워크트리가 없음"(no-workspace)을 낼 FLIGHT key들(ATC-473): started이고 워크트리가 없고 상위 이슈가 아니며 STAND가 필요한 FLIGHT.
// STAND 없는 FLIGHT는 워크트리가 있을 수 없으니 뺀다
export function noWorkspaceKeysOf(tickets: readonly Pick<Ticket, "key" | "stateType" | "labels" | "parent" | "children">[], workspaceTicketKeys: ReadonlySet<string | null>): string[] {
  const parents = parentKeysOf(tickets as Ticket[]);
  return tickets.filter((t) => t.stateType === "started" && !workspaceTicketKeys.has(t.key) && !parents.has(t.key) && !standFreeTicket(t)).map((t) => t.key);
}
