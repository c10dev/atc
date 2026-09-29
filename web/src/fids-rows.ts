import type { Ticket } from "../../server/model.ts";

// FIDS 목록·보드가 보일 FLIGHT(ATC-112). 화면 계산만 한다 — 서버는 그대로.
// ARRIVED(Linear completed)는 STAND가 남은 것(정리 대상)과 가장 최근에 갱신된 FIDS_ARRIVED_CAP개만 기본으로 보이고, 나머지는 개수로만 알린다.
// 상수이고 설정이 아니다.
export const FIDS_ARRIVED_CAP = 10;

export interface FidsRows {
  rows: Ticket[]; // 보일 FLIGHT(들어온 순서 그대로)
  moreArrived: number; // 가려진 ARRIVED 수. 0이면 "more" 줄이 없다
}

// tickets는 상태 열 필터를 거친 뒤의 것. showClosed면 전부 보인다(fidsClosed: SCHEDULED·ARRIVED·CANCELLED 포함)
export function fidsRows(
  tickets: readonly Ticket[],
  idx: { workspacesByTicket: ReadonlyMap<string, readonly unknown[]> },
  showClosed: boolean,
  cap = FIDS_ARRIVED_CAP,
): FidsRows {
  if (showClosed) return { rows: [...tickets], moreArrived: 0 };
  const arrived = tickets.filter((t) => t.stateType === "completed");
  const staying = new Set(arrived.filter((t) => idx.workspacesByTicket.has(t.key)).map((t) => t.key));
  const recent = new Set(
    arrived
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.key.localeCompare(b.key))
      .slice(0, cap)
      .map((t) => t.key),
  );
  const rows = tickets.filter((t) => t.stateType !== "completed" || staying.has(t.key) || recent.has(t.key));
  return { rows, moreArrived: tickets.length - rows.length }; // 빠지는 것은 ARRIVED뿐이다
}
