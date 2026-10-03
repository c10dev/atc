import type { PullRequest, Ticket } from "./model.ts";

// 취소된 FLIGHT(Linear stateType canceled)의 규칙(ATC-460, 순수). 취소된 FLIGHT는 AIRCRAFT를 붙들지 못한다:
// APPLY NOW는 그 FLIGHT의 STAND 점유와 열린 PR을 "진행 중"으로 세지 않고, FLEET은 그 FLIGHT를 날고 있다고 하지 않는다.
// 남은 열린 PR은 사라지지 않는다: SUPERVISOR의 한 줄(HOME의 ALERT)로 올린다. atc는 PR을 닫지 않는다.

type TicketLike = Pick<Ticket, "key" | "stateType">;
type PullLike = Pick<PullRequest, "repo" | "number" | "url" | "draft" | "ticketKey" | "standPath">;

export const canceledKeysOf = (tickets: readonly TicketLike[] | undefined): Set<string> => new Set((tickets ?? []).filter((t) => t.stateType === "canceled").map((t) => t.key));

// 쥔 STAND·kept FLIGHT의 key 가운데 취소되지 않은 것만(APPLY NOW의 "FLIGHT 중")
export const liveFlightsOf = (keys: readonly string[], canceled: ReadonlySet<string>): string[] => keys.filter((k) => !canceled.has(k));

// STAND(워크트리 path)를 쥔 AIRCRAFT. 쥔 점유(active)가 있는 세션의 REGISTRATION
export function standHoldersOf(
  claims: readonly { sessionId: string; workspacePath: string; state: string }[],
  regOfSession: (sessionId: string) => string | undefined,
): Map<string, string | undefined> {
  return new Map(claims.filter((c) => c.state === "active").map((c) => [c.workspacePath, regOfSession(c.sessionId)] as const));
}

// 열린 PR을 쥔 AIRCRAFT 가운데 취소되지 않은 FLIGHT의 PR을 쥔 것(APPLY NOW의 "열린 PR이 있음")
export function aircraftWithLivePrOf(pulls: readonly PullLike[], holders: ReadonlyMap<string, string | undefined>, canceled: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const p of pulls) {
    if (p.ticketKey && canceled.has(p.ticketKey)) continue;
    const reg = p.standPath ? holders.get(p.standPath) : undefined;
    if (reg) out.add(reg);
  }
  return out;
}

export interface CanceledPr {
  repo: string;
  number: number;
  url: string;
  draft: boolean;
  flight: string;
  aircraft: string | null; // 그 PR의 STAND를 쥔 AIRCRAFT. 쥔 세션이 없으면 null
  airport: string | null; // PR drawer 주소용 AIRPORT 코드
}

// 취소된 FLIGHT에 아직 열려 있는 PR(Draft 포함). PR 번호 순
export function canceledPrsOf(pulls: readonly PullLike[], canceled: ReadonlySet<string>, holders: ReadonlyMap<string, string | undefined>, airportOf: (repo: string) => string | null): CanceledPr[] {
  return pulls
    .filter((p) => p.ticketKey && canceled.has(p.ticketKey))
    .map((p) => ({ repo: p.repo, number: p.number, url: p.url, draft: p.draft, flight: p.ticketKey!, aircraft: (p.standPath ? holders.get(p.standPath) : undefined) ?? null, airport: airportOf(p.repo) }))
    .sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
}
