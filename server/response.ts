import type { ClearanceType } from "./model.ts";

// 응답 속성(ATC-122). CPDLC(ICAO GOLD)처럼 메시지마다 어떤 답이 그 메시지를 닫는지 정한다.
// W/U: READBACK(= WILCO)이나 UNABLE이 닫고, STANDBY는 열어 둔 채 overdue를 한 번 다시 센다.
// R: ROGER(또는 READBACK)가 닫는다. 알림이라 "하겠다"가 아니라 "받았다"면 된다.
// 설계와 근거: docs/research/aviation-signals.md 1–2절.

export type ResponseAttr = "W/U" | "R";
export type Answer = "READBACK" | "ROGER" | "UNABLE" | "STANDBY";

// 알림(INFO·TRAFFIC·REPORT)은 R, 따를 지시(LAND·GO AROUND·HOLD·CONTINUE)는 W/U
const CLEARANCE_ATTR: Record<ClearanceType, ResponseAttr> = {
  LAND: "W/U",
  "GO AROUND": "W/U", // 행동 지시(ATC-128): 합치고 풀고 push하거나 UNABLE
  FIX: "W/U", // 행동 지시(ATC-270): 리뷰 지적을 고치고 push하거나 UNABLE
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

// 답 주소 줄(ATC-169): 답장은 보낸 세션의 주소(from)가 아니라 세션 이름으로 보낸다. 관제 세션을 다시 띄우면 주소가 바뀌고, 옛 주소로 보내면 ENOENT로 실패한다(docs/control-recycle.md 1.1).
// 이름으로 보내면 다시 뜬 같은 이름의 세션에 닿는다. CLEARANCE는 TOWER가, FLIGHT PLAN·RECALL·CREW CHANGE는 OCC가 보낸다
export const replyToName = (kind: MessageKind) => (kind === "clearance" ? "TOWER" : "OCC");
export function addressLine(kind: MessageKind): string {
  const name = replyToName(kind);
  return `— Send your reply to the session name "${name}" (SendMessage to: "${name}"). Do not send it to the from address. The address changes when ${name} restarts.`;
}

// 메시지 끝줄: 어떤 답을 기다리는지 적는다. RECALL은 늘 READBACK <id> RECALL 하나. 바로 위에 답 주소 줄이 붙는다
// quote(ATC-555): FLIGHT PLAN의 work-order 해시 자리(@WOHASH, 봉인 때 @<해시>로 바뀐다). 주면 READBACK이 그 해시를 인용해야 한다고 적는다
export function closingLine(kind: MessageKind, attr: ResponseAttr, id: string, quote?: string): string {
  const ask =
    kind === "recall"
      ? `— Reply to this message with "READBACK ${id} RECALL" when you receive it.`
      : attr === "R"
        ? `— Reply to this message with "ROGER ${id}" when you receive it.`
        : quote
          ? `— Reply to this message with "READBACK ${id} ${quote}" if you take it, exactly like that (${quote} is this work order's hash; a reply without it is refused). Reply with "UNABLE ${id} — reason" if you cannot. Reply with "STANDBY ${id}" if you need time.`
          : `— Reply to this message with "READBACK ${id}" if you take it. Reply with "UNABLE ${id} — reason" if you cannot. Reply with "STANDBY ${id}" if you need time.`;
  return `${addressLine(kind)}\n${ask}`;
}

// READBACK overdue를 세는 기준 시각(ms). STANDBY는 한 번만 다시 세게 한다: 보낸 뒤 첫 STANDBY가 기준이 되고,
// 두 번째부터는 기록만 한다(CPDLC는 STANDBY마다 타이머를 다시 시작하지만, atc는 끝없이 미뤄지지 않게 한 번으로 둔다)
export function overdueBase(sentAt: string, firstStandbyAt: string | null | undefined): number {
  const sent = Date.parse(sentAt);
  const standby = firstStandbyAt ? Date.parse(firstStandbyAt) : NaN;
  return standby >= sent ? standby : sent;
}
