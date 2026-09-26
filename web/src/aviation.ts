// 화면 표기용 항공 용어. 코드·API의 이름(Session, Workspace, Ticket, Claim)은 바꾸지 않는다.
import type { Alert, AlertKind, Session, Ticket, TicketColumn } from "../../server/model.ts";

const PHONETIC: Record<string, string> = {
  A: "ALPHA", B: "BRAVO", C: "CHARLIE", D: "DELTA", E: "ECHO", F: "FOXTROT", G: "GOLF",
  H: "HOTEL", I: "INDIA", J: "JULIETT", K: "KILO", L: "LIMA", M: "MIKE", N: "NOVEMBER",
  O: "OSCAR", P: "PAPA", Q: "QUEBEC", R: "ROMEO", S: "SIERRA", T: "TANGO", U: "UNIFORM",
  V: "VICTOR", W: "WHISKEY", X: "XRAY", Y: "YANKEE", Z: "ZULU",
};

// TEAM_A → ALPHA. 팀 이름 규칙에 맞지 않는 세션은 이름 그대로.
export function callsign(session: Pick<Session, "name">): string {
  const m = session.name.match(/^TEAM[\s_-]?([A-Z])$/i);
  return m ? PHONETIC[m[1].toUpperCase()] : session.name;
}

// VOC-191 → VOC191 (항공사 코드 + 편 번호). 브랜치·PR에는 Linear 표기를 그대로 쓴다.
export function flightNumber(ticketKey: string): string {
  return ticketKey.replace("-", "");
}

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

export type AircraftStatus = "airborne" | "holding" | "parked" | "nordo";

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
