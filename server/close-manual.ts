import { DONE_STATES } from "./dispatch.ts";
import type { ClosePayload, ScheduleOp } from "./schedule.ts";

// SUPERVISOR가 Linear에서 직접 Done으로 바꿀 CLOSE(ATC-378): 승인한 CLOSE, 그림자 운용이면 "승인했을 것"(7일 안) 중 아직 열린 이슈. 순수.
// SCHEDULE 보기(GET /api/schedule)·HOME 보기(GET /api/schedule/home)와 SUPERVISOR QUEUE의 CLOSE 줄이 같은 이 규칙 하나를 쓴다(ATC-454)
export const CLOSE_AGREED_MS = 7 * 86_400_000;

export interface CloseManualTicket {
  key: string;
  stateType: string;
}

export function closeManualOf<O extends Pick<ScheduleOp, "kind" | "status" | "statusAt" | "flight">>(ops: readonly O[], tickets: readonly CloseManualTicket[], now: number): O[] {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  return ops
    .filter((x) => x.kind === "CLOSE" && (x.status === "approved" || (x.status === "agreed" && now - Date.parse(x.statusAt) < CLOSE_AGREED_MS)))
    .filter((x) => !DONE_STATES.has(byKey.get(x.flight ?? "")?.stateType ?? "completed"))
    .sort((a, b) => a.statusAt.localeCompare(b.statusAt));
}

export const closePrOf = (op: Pick<ScheduleOp, "payload">): ClosePayload["pr"] => (op.payload as ClosePayload).pr;
