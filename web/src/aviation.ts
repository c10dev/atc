// 화면 표기용 항공 용어. 코드·API의 이름(Session, Workspace, Ticket, Claim)은 바꾸지 않는다.
import type { Alert, AlertKind, Session, Ticket, TicketColumn } from "../../server/model.ts";

export { callsign, flightNumber } from "../../server/callsign.ts";

const phaseByStateName: Record<string, string> = {
  "In Progress": "순항",
  "In Review": "접근",
  "Ready to Merge": "착륙 허가",
};

const phaseByStateType: Record<string, string> = {
  triage: "관제 대기",
  backlog: "운항 예정",
  unstarted: "비행계획 제출",
  started: "순항",
  completed: "도착",
  canceled: "결항",
  duplicate: "합편",
};

// Linear 상태 → 비행 단계. 모르는 상태는 Linear 이름 그대로.
export function flightPhase(t: Pick<Ticket, "state" | "stateType"> | TicketColumn): string {
  const name = "state" in t ? t.state : t.name;
  const type = "stateType" in t ? t.stateType : t.type;
  return phaseByStateName[name] ?? phaseByStateType[type] ?? name;
}

// 비행 단계의 색 계열과 운항 정보판에 쓰는 영문 약호.
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
  airborne: "비행 중",
  holding: "체공 대기",
  parked: "주기",
  nordo: "무선 두절",
};

export const HANDOFF_LABEL = "관제 이양";

export const alertCode: Record<AlertKind, string> = {
  conflict: "LOS",
  orphan: "7600",
  unattended: "UNID",
  "no-workspace": "NO CONTACT",
};

export const alertLabel: Record<AlertKind, string> = {
  conflict: "분리 기준 위반",
  orphan: "무선 두절 점유",
  unattended: "미식별 표적",
  "no-workspace": "레이더 미포착",
};

export function alertMessage(a: Alert, sessionName: (id: string) => string): string {
  switch (a.kind) {
    case "conflict":
      return `${(a.sessionIds ?? []).map(sessionName).join(", ")} 가 같은 주기장에 있음`;
    case "orphan":
      return `${(a.sessionIds ?? []).map(sessionName).join(", ")} 교신이 끊긴 채 주기장을 점유`;
    case "unattended":
      return `점유한 항공기 없이 변경만 있음`;
    case "no-workspace":
      return `순항 중인데 주기장(워크트리)이 없음`;
  }
}
