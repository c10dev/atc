// 콜사인·FLIGHT NUMBER 규칙. 서버(ATC 브리핑)와 화면(web/src/aviation.ts)이 같이 쓴다.
import type { Session } from "./model.ts";
import { registrationOf } from "./registration.ts";

const PHONETIC: Record<string, string> = {
  A: "ALPHA", B: "BRAVO", C: "CHARLIE", D: "DELTA", E: "ECHO", F: "FOXTROT", G: "GOLF",
  H: "HOTEL", I: "INDIA", J: "JULIETT", K: "KILO", L: "LIMA", M: "MIKE", N: "NOVEMBER",
  O: "OSCAR", P: "PAPA", Q: "QUEBEC", R: "ROMEO", S: "SIERRA", T: "TANGO", U: "UNIFORM",
  V: "VICTOR", W: "WHISKEY", X: "XRAY", Y: "YANKEE", Z: "ZULU",
};

// TEAM_A → ALPHA, TEAM_RA → ROMEO ALPHA(글자마다 한 단어, ATC-181). 팀 이름 규칙(registration.ts)에 맞지 않는 세션은 이름 그대로.
export function callsign(session: Pick<Session, "name">): string {
  const reg = registrationOf(session.name);
  return reg ? [...reg.slice("TEAM_".length)].map((c) => PHONETIC[c]).join(" ") : session.name;
}

// VOC-191 → VOC191 (항공사 코드 + FLIGHT NUMBER). 브랜치·PR에는 Linear 표기를 그대로 쓴다.
export function flightNumber(ticketKey: string): string {
  return ticketKey.replace("-", "");
}
