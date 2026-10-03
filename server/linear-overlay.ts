// atc가 Linear에 쓴 상태 변경을 서버 캐시에 바로 보이는 규칙(ATC-448). 순수 함수만, 입출력은 sources/linear.ts.
// - 쓰기가 성공한 뒤에만 덮어쓰기(overlay)를 넣는다. 실패한 쓰기는 이 함수를 부르지 않아 아무것도 바뀌지 않는다
// - 쓰기보다 먼저 시작한 가져오기(fetch)가 뒤에 도착해도 옛 상태를 되돌리지 않는다: 그 결과에도 덮어쓰기를 입힌다
// - 쓰기보다 나중에 시작한 가져오기가 도착하면 덮어쓰기를 버린다(그때부터 Linear의 답이 이긴다)
// 순서는 시각이 아니라 한 줄로 늘어나는 번호(seq)로 잰다: 같은 밀리초에도 앞뒤가 갈린다
import type { Ticket } from "./model.ts";

export interface StateOverlay {
  state: string;
  stateType: Ticket["stateType"];
  stateColor: string | null; // 모르면 null(티켓의 옛 색을 둔다)
  seq: number; // 쓰기가 성공한 순간의 번호
}
export type Overlays = ReadonlyMap<string, StateOverlay>;

const applyOne = (t: Ticket, o: StateOverlay): Ticket => (t.state === o.state && t.stateType === o.stateType ? t : { ...t, state: o.state, stateType: o.stateType, stateColor: o.stateColor ?? t.stateColor });

// 쓰기 성공: 캐시의 그 티켓을 새 상태로 바꾸고 덮어쓰기를 적어 둔다. 캐시에 없는 티켓은 덮어쓰기만 남긴다(다음 가져오기에 입힌다)
export function applyWrite(tickets: readonly Ticket[], overlays: Overlays, key: string, next: { name: string; type: string; color?: string | null }, seq: number): { tickets: Ticket[]; overlays: Map<string, StateOverlay> } {
  const o: StateOverlay = { state: next.name, stateType: next.type as Ticket["stateType"], stateColor: next.color ?? null, seq };
  const out = new Map(overlays);
  out.set(key, o);
  return { tickets: tickets.map((t) => (t.key === key ? applyOne(t, o) : t)), overlays: out };
}

// 가져오기 도착: fetchSeq는 그 가져오기가 시작한 순간의 번호. 쓰기보다 뒤에 시작했으면(fetchSeq > seq) 덮어쓰기를 버리고, 아니면 결과에 입힌다
export function reconcileFetch(fetched: readonly Ticket[], overlays: Overlays, fetchSeq: number): { tickets: Ticket[]; overlays: Map<string, StateOverlay> } {
  const kept = new Map([...overlays].filter(([, o]) => o.seq >= fetchSeq));
  return { tickets: fetched.map((t) => (kept.has(t.key) ? applyOne(t, kept.get(t.key)!) : t)), overlays: kept };
}
