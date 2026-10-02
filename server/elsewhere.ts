import type { Snapshot } from "./model.ts";

// FIX·GO AROUND를 받는 AIRCRAFT가 그때 다른 FLIGHT를 하고 있었나(ATC-387). 착륙만 기다리는 FLIGHT를 두고 다음 FLIGHT를 새 STAND에서 하는 AIRCRAFT의 응답 시간을 따로 재려고 CLEARANCE에 남긴다.
// 그 세션이 이 STAND(stand)가 아닌 다른 STAND를 쥐고 있고, 그 STAND의 FLIGHT가 Linear에서 진행 중(started)이면 그 FLIGHT key. 아니면 null. 순수 함수
export function elsewhereOf(sessionId: string, stand: string | null, flight: string | null, s: Pick<Snapshot, "claims" | "workspaces" | "tickets">): string | null {
  const wsKey = new Map(s.workspaces.map((w) => [w.path, w.ticketKey]));
  const started = new Set(s.tickets.filter((t) => t.stateType === "started").map((t) => t.key));
  for (const c of s.claims) {
    if (c.sessionId !== sessionId || c.state !== "active" || c.workspacePath === stand) continue;
    const key = wsKey.get(c.workspacePath);
    if (key && key !== flight && started.has(key)) return key;
  }
  return null;
}
