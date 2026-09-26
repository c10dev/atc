// 콜사인·편명 규칙. 서버(관제 브리핑)와 화면(web/src/aviation.ts)이 같이 쓴다.
import type { Session } from "./model.ts";

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
