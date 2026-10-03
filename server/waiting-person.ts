import { blockedAlerts, isControlSessionName, type Job } from "./job-state.ts";
import type { Proposal } from "./proposals.ts";
import { registrationOf } from "./registration.ts";

// 사람을 기다리는 세션 하나의 정의(ATC-374). SUPERVISOR QUEUE의 NEEDS YOU·GO 줄과 SUPERVISOR SUMMARY의 `needsYou`가 이것 하나를 읽어, 둘이 어긋나지 않는다. 순수 함수.
// 세션이 스스로 사람을 기다린다:
//   blocked — 백그라운드 job이 blocked로 blockedMin분 넘게 이어짐(job-state.ts blockedAlerts, ALERT와 같은 함수)
//   pending — 도구 호출 승인 프롬프트(health PENDING)
//   go      — CAPTAIN이 READBACK도 거절도 아닌 채 SUPERVISOR의 go를 기다림(보낸 FLIGHT PLAN의 awaitSupervisor)
// 판정을 기다리는 DISPATCH 카드(ASSIGN·RELEASE)는 AIRCRAFT가 기다리는 것이 아니라 SUPERVISOR가 정할 일이라 여기에 없다(`pending.dispatch`로만 센다).
export type WaitKind = "blocked" | "pending" | "go";

export interface WaitSession {
  id: string;
  name: string;
  status?: string;
  job?: Job | null;
  jobId?: string | null;
  attachDir?: string | null;
  lastActiveAt?: string | null;
  health?: { code: string; since?: string | null } | null;
}
export interface WaitingOnPerson {
  kind: WaitKind;
  key: string; // blocked·pending: 세션 id, go: 제안 id
  name: string; // 세션 이름(go는 FLIGHT와 AIRCRAFT)
  aircraft: string | null; // 팀 AIRCRAFT의 이름. 관제 세션이면 null(큐에는 오르지만 needsYou에는 없다)
  since: string | null;
}

export interface WaitInput {
  sessions: readonly WaitSession[];
  proposals: readonly Pick<Proposal, "id" | "flight" | "aircraftName" | "awaitSupervisor">[];
  now: number;
  blockedMin: number;
  teamPattern?: string;
}

export function waitingOnPersonOf(inp: WaitInput): WaitingOnPerson[] {
  const out: WaitingOnPerson[] = [];
  const aircraftOf = (name: string | null | undefined) => (name && registrationOf(name, inp.teamPattern) ? name : null);
  const byId = new Map(inp.sessions.map((s) => [s.id, s]));
  const blocked = new Set<string>();
  for (const a of blockedAlerts(inp.sessions.map((s) => ({ ...s, job: s.job ?? null })), inp.now, inp.blockedMin)) {
    const id = a.sessionIds[0]!;
    const s = byId.get(id);
    blocked.add(id);
    if (s && isControlSessionName(s.name)) continue; // 관제 세션은 NEEDS YOU가 아니라 규칙 위반 WARNING이다(ATC-352)
    out.push({ kind: "blocked", key: id, name: s?.name ?? id, aircraft: aircraftOf(s?.name), since: s?.job?.since ?? null });
  }
  for (const s of inp.sessions) {
    if (s.status === "dead" || s.health?.code !== "PENDING" || blocked.has(s.id)) continue;
    out.push({ kind: "pending", key: s.id, name: s.name, aircraft: aircraftOf(s.name), since: s.health.since ?? null });
  }
  for (const p of inp.proposals) {
    if (!p.awaitSupervisor) continue;
    out.push({ kind: "go", key: p.id, name: `${p.flight}${p.aircraftName ? ` ${p.aircraftName}` : ""}`, aircraft: aircraftOf(p.aircraftName), since: p.awaitSupervisor.at });
  }
  return out;
}

// SUPERVISOR SUMMARY의 `needsYou`: 스스로 사람을 기다리는 팀 AIRCRAFT의 이름(중복 없이 정렬)
export const needsYouOf = (waiting: readonly WaitingOnPerson[]): string[] => [...new Set(waiting.flatMap((w) => (w.aircraft ? [w.aircraft] : [])))].sort();
