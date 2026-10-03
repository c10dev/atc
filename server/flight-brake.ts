// FLIGHT의 brake가 걸릴 수 있는 상태(ATC-377). 화면(FlightBrakes.tsx)과 SUPERVISOR QUEUE의 `primary`(supervisor-queue.ts)가 같은 판정을 쓴다. 순수.
// RECALL은 보냈거나(sent) READBACK 받은(accepted) FLIGHT PLAN, 그리고 STAND 없이 DEPARTED한 것에만. CANCEL은 승인했지만 아직 안 보낸 카드에만
export interface BrakeState {
  status: string;
  departedStand?: string | null;
  departedVia?: string | null;
}
export const canRecall = (p: BrakeState) => p.status === "sent" || p.status === "accepted" || (p.status === "departed" && !p.departedStand && p.departedVia === "readback");
export const canCancel = (p: Pick<BrakeState, "status">) => p.status === "approved";
