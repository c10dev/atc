import { factsOf } from "./health.ts";
import { registrationOf } from "./registration.ts";

// RESTARTING(ATC-91, docs/fleet.md 8.5): 데스크톱의 /clear는 그 세션을 끝내고 다음 지시가 올 때까지 세션 파일이 없다.
// 새 세션은 새 id를 받지만 같은 이름(custom-title)을 이어 간다. 그 사이의 AIRCRAFT를 "곧 다시 뜰" 상태로 본다.
// 어떤 세션이 정상으로 끝나고(대화 기록의 마지막이 도구 호출 없는 답) 세션 파일이 사라졌고 같은 REGISTRATION의 살아 있는 세션이 아직 없으면,
// 마지막 기록 뒤 restartGraceMin 동안 RESTARTING이다. 지나면 예전처럼 세션 없음(absent)이다. 순수 함수. 읽기는 sources/claude.ts(readEndedSessions)

export const DEFAULT_RESTART_GRACE_MIN = 30;

export interface EndedSession {
  sessionId: string;
  name: string; // 대화 기록의 마지막 custom-title
  endedAt: number; // 대화 기록을 마지막으로 쓴 시각
  normalEnd: boolean; // 마지막 사실이 도구 호출 없는 답(오류·승인 대기·지시 뒤 무응답이 아니다)
}

export interface Restarting {
  registration: string;
  name: string; // 끝난 세션의 이름
  sessionId: string; // 끝난 세션(옛 id)
  since: string; // 마지막 기록 시각
  until: string; // since + restartGraceMin
}

// 끝난 세션의 대화 기록 끝 → 정상 종료인가. 마지막 사실이 도구 호출 없는 답이다
export function normalEndOf(tailText: string): boolean {
  const facts = factsOf(tailText);
  const last = facts.at(-1);
  return last?.kind === "reply" && last.toolUses.length === 0;
}

export function restartingOf(
  ended: readonly EndedSession[],
  live: readonly { name: string; status: "busy" | "idle" | "dead" }[],
  now: number,
  graceMin: number,
  teamPattern?: string,
): Restarting[] {
  const liveRegs = new Set(live.filter((x) => x.status !== "dead").map((x) => registrationOf(x.name, teamPattern)).filter((r): r is string => Boolean(r)));
  const out = new Map<string, Restarting>();
  for (const e of ended) {
    const registration = registrationOf(e.name, teamPattern);
    if (!registration || !e.normalEnd || liveRegs.has(registration)) continue;
    const until = e.endedAt + graceMin * 60_000;
    if (now >= until || e.endedAt > now + 60_000) continue;
    const prev = out.get(registration);
    if (!prev || Date.parse(prev.since) < e.endedAt) {
      out.set(registration, { registration, name: e.name, sessionId: e.sessionId, since: new Date(e.endedAt).toISOString(), until: new Date(until).toISOString() });
    }
  }
  return [...out.values()].sort((a, b) => a.registration.localeCompare(b.registration));
}

// 화면과 브리핑이 같이 쓰는 말
export const RESTARTING_TEXT = "세션 없음 — /clear 뒤 첫 메시지 대기";
export const restartingReason = (r: Pick<Restarting, "until">) => `RESTARTING — ${RESTARTING_TEXT} (${new Date(r.until).toISOString().slice(11, 16)}Z까지)`;
