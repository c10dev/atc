import type { ClearanceType } from "./model.ts";

// 응답 속성(ATC-122). CPDLC(ICAO GOLD)처럼 메시지마다 어떤 답이 그 메시지를 닫는지 정한다.
// W/U: READBACK(= WILCO)이나 UNABLE이 닫고, STANDBY는 열어 둔 채 overdue를 한 번 다시 센다.
// R: ROGER(또는 READBACK)가 닫는다. 알림이라 "하겠다"가 아니라 "받았다"면 된다.
// 설계와 근거: docs/research/aviation-signals.md 1–2절.

export type ResponseAttr = "W/U" | "R";
export type Answer = "READBACK" | "ROGER" | "UNABLE" | "STANDBY";

// 알림(INFO·TRAFFIC·REPORT)은 R, 따를 지시(LAND·HOLD·CONTINUE)는 W/U
const CLEARANCE_ATTR: Record<ClearanceType, ResponseAttr> = {
  LAND: "W/U",
  HOLD: "W/U",
  CONTINUE: "W/U",
  INFO: "R",
  TRAFFIC: "R",
  REPORT: "R",
};

export type MessageKind = "clearance" | "flight-plan" | "recall" | "crew-change";

export function responseOf(kind: MessageKind, type?: ClearanceType): ResponseAttr {
  if (kind === "clearance") return (type && CLEARANCE_ATTR[type]) ?? "W/U";
  return "W/U";
}

// 그 메시지에 그 답을 받을 수 있나. 못 받으면 사유(API가 409로 돌려준다), 받으면 null.
// READBACK은 늘 받는다(옛 습관이 깨지지 않게). RECALL은 READBACK만 받는다(멈추라는 지시라 "못 함"이 없다).
export function answerError(kind: MessageKind, attr: ResponseAttr, answer: Answer): string | null {
  if (answer === "READBACK") return null;
  if (kind === "recall") return `RECALL은 "READBACK <id> RECALL"로만 닫는다`;
  if (answer === "ROGER" && attr !== "R") return `ROGER는 R 메시지(INFO·TRAFFIC·REPORT)만 닫는다 — 이 메시지는 ${attr}라 READBACK이나 UNABLE로 닫는다`;
  if (answer === "STANDBY" && attr !== "W/U") return `STANDBY는 W/U 메시지만 받는다 — 이 메시지는 R이라 ROGER로 닫는다`;
  return null;
}

// 메시지 끝줄: 어떤 답을 기다리는지 적는다. RECALL은 늘 READBACK <id> RECALL 하나
export function closingLine(kind: MessageKind, attr: ResponseAttr, id: string): string {
  if (kind === "recall") return `— When received, reply to this message with "READBACK ${id} RECALL".`;
  if (attr === "R") return `— When received, reply to this message with "ROGER ${id}".`;
  return `— Reply to this message with "READBACK ${id}" if you take it, "UNABLE ${id} — reason" if you cannot, or "STANDBY ${id}" if you need time.`;
}

// READBACK overdue를 세는 기준 시각(ms). STANDBY는 한 번만 다시 세게 한다: 보낸 뒤 첫 STANDBY가 기준이 되고,
// 두 번째부터는 기록만 한다(CPDLC는 STANDBY마다 타이머를 다시 시작하지만, atc는 끝없이 미뤄지지 않게 한 번으로 둔다)
export function overdueBase(sentAt: string, firstStandbyAt: string | null | undefined): number {
  const sent = Date.parse(sentAt);
  const standby = firstStandbyAt ? Date.parse(firstStandbyAt) : NaN;
  return standby >= sent ? standby : sent;
}
