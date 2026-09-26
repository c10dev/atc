// 화면 표기용 항공 용어. 코드·API의 이름(Session, Workspace, Ticket, Claim)은 바꾸지 않는다.
import type { Alert, AlertKind, Session, Ticket, TicketColumn } from "../../server/model.ts";

export { callsign, flightNumber } from "../../server/callsign.ts";

const phaseByStateName: Record<string, string> = {
  "In Progress": "ENROUTE",
  "In Review": "APPROACH",
  "Ready to Merge": "CLEARED TO LAND",
};

const phaseByStateType: Record<string, string> = {
  triage: "TRIAGE",
  backlog: "SCHEDULED",
  unstarted: "FILED",
  started: "ENROUTE",
  completed: "ARRIVED",
  canceled: "CANCELLED",
  duplicate: "CONSOLIDATED",
};

// Linear 상태 → 비행 단계. 모르는 상태는 Linear 이름 그대로.
export function flightPhase(t: Pick<Ticket, "state" | "stateType"> | TicketColumn): string {
  const name = "state" in t ? t.state : t.name;
  const type = "stateType" in t ? t.stateType : t.type;
  return phaseByStateName[name] ?? phaseByStateType[type] ?? name;
}

// 비행 단계의 색 계열과 FIDS에 쓰는 영문 약호.
export type PhaseTone = "triage" | "scheduled" | "filed" | "enroute" | "approach" | "cleared" | "arrived" | "canceled";

const toneByStateName: Record<string, PhaseTone> = {
  "In Progress": "enroute",
  "In Review": "approach",
  "Ready to Merge": "cleared",
};

const toneByStateType: Record<string, PhaseTone> = {
  triage: "triage",
  backlog: "scheduled",
  unstarted: "filed",
  started: "enroute",
  completed: "arrived",
  canceled: "canceled",
  duplicate: "canceled",
};

export const phaseCode: Record<PhaseTone, string> = {
  triage: "TRIAGE",
  scheduled: "SCHED",
  filed: "FILED",
  enroute: "ENROUTE",
  approach: "APPROACH",
  cleared: "CLEARED",
  arrived: "ARRIVED",
  canceled: "CNX",
};

export function phaseTone(t: Pick<Ticket, "state" | "stateType"> | TicketColumn): PhaseTone {
  const name = "state" in t ? t.state : t.name;
  const type = "stateType" in t ? t.stateType : t.type;
  return toneByStateName[name] ?? toneByStateType[type] ?? "filed";
}

export type AircraftStatus = "airborne" | "holding" | "parked" | "nordo";

export const aircraftStatusCode: Record<AircraftStatus, string> = {
  airborne: "AIRBORNE",
  holding: "HOLDING",
  parked: "PARKED",
  nordo: "NORDO",
};

export function aircraftStatus(session: Session, hasStand: boolean): AircraftStatus {
  if (session.status === "dead") return "nordo";
  if (session.status === "busy") return "airborne";
  return hasStand ? "holding" : "parked";
}

export const aircraftStatusLabel: Record<AircraftStatus, string> = {
  airborne: "AIRBORNE",
  holding: "HOLDING",
  parked: "PARKED",
  nordo: "NORDO",
};

export const HANDOFF_LABEL = "HANDOFF";

export const alertCode: Record<AlertKind, string> = {
  conflict: "LOS",
  orphan: "7600",
  unattended: "UNID",
  "no-workspace": "NO CONTACT",
};

export const alertLabel: Record<AlertKind, string> = {
  conflict: "LOSS OF SEPARATION",
  orphan: "NORDO STAND",
  unattended: "UNIDENTIFIED",
  "no-workspace": "NO CONTACT",
};

export function alertMessage(a: Alert, sessionName: (id: string) => string): string {
  switch (a.kind) {
    case "conflict":
      return `${(a.sessionIds ?? []).map(sessionName).join(", ")} 가 같은 STAND에 있음`;
    case "orphan":
      return `${(a.sessionIds ?? []).map(sessionName).join(", ")} CONTACT가 끊긴 채 STAND를 점유`;
    case "unattended":
      return `점유한 AIRCRAFT 없이 변경만 있음`;
    case "no-workspace":
      return `ENROUTE인데 STAND(워크트리)가 없음`;
  }
}
