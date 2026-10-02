import type { Claim, Handoff, Session } from "./model.ts";

export interface Occupancy {
  handoffs: Handoff[];
  conflicts: { workspacePath: string; sessionIds: string[] }[];
  orphans: Claim[];
}

const ms = (iso: string) => Date.parse(iso);

// 점유 구간은 [since, lastAt]. 같은 워크트리의 두 점유가
// - 앞 세션이 뒤 세션 시작 뒤로 graceMs 넘게 더 건드리지 않았고, 뒤 세션이 끝까지 남아 있으면 → HANDOFF
// - HANDOFF가 아니고 겹친 시간이 graceMs를 넘으면 → 충돌
// - 겹침이 graceMs 이하(잠깐 들른 경우)면 둘 다 점유로 두되 충돌로 치지 않는다.
// transcript(추정) 점유는 판정에 쓰지 않는다. claims의 state/handedOffTo를 채운다.
export function resolveOccupancy(
  claims: Claim[],
  statusOf: (sessionId: string) => Session["status"] | undefined,
  graceMs: number,
): Occupancy {
  const handoffs: Handoff[] = [];
  const conflicts: Occupancy["conflicts"] = [];
  const orphans: Claim[] = [];

  const byWorkspace = new Map<string, Claim[]>();
  for (const c of claims) {
    if (c.source === "transcript") continue;
    byWorkspace.set(c.workspacePath, [...(byWorkspace.get(c.workspacePath) ?? []), c]);
  }

  for (const [workspacePath, group] of byWorkspace) {
    for (const x of group) {
      const successor = group
        .filter(
          (y) =>
            y.sessionId !== x.sessionId &&
            ms(y.since) > ms(x.since) &&
            ms(x.lastAt) - ms(y.since) <= graceMs &&
            ms(y.lastAt) >= ms(x.lastAt),
        )
        .sort((a, b) => ms(a.since) - ms(b.since))[0];
      if (!successor) continue;
      x.state = "handed-off";
      x.handedOffTo = successor.sessionId;
      handoffs.push({ workspacePath, from: x.sessionId, to: successor.sessionId, at: successor.since });
    }

    const active = group.filter((c) => c.state === "active");
    const live = active.filter((c) => statusOf(c.sessionId) !== "dead");
    orphans.push(...active.filter((c) => statusOf(c.sessionId) === "dead"));

    const clashing = new Set<string>();
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const [a, b] = [live[i], live[j]];
        const overlap = Math.min(ms(a.lastAt), ms(b.lastAt)) - Math.max(ms(a.since), ms(b.since));
        if (overlap > graceMs) clashing.add(a.sessionId).add(b.sessionId);
      }
    }
    if (clashing.size) conflicts.push({ workspacePath, sessionIds: [...clashing] });
  }

  handoffs.sort((a, b) => b.at.localeCompare(a.at));
  return { handoffs, conflicts, orphans };
}

// PR의 STAND를 쥔 세션의 active 점유(ATC-440). 끝난 세션(status "dead", 위 orphan과 같은 기준)의 점유는 홀더가 아니다:
// 죽은 세션에게는 GO AROUND·FIX가 닿지 않으므로 홀더 카드로 돌려야 한다. 세션을 모르면(sessions에 없음) 살아 있는 것으로 본다
export function liveHolderClaims<T extends Pick<Claim, "state" | "workspacePath" | "sessionId">>(
  claims: readonly T[],
  standPath: string | null | undefined,
  sessions: readonly Pick<Session, "id" | "status">[] | undefined,
): T[] {
  if (!standPath) return [];
  const dead = new Set((sessions ?? []).filter((x) => x.status === "dead").map((x) => x.id));
  return claims.filter((c) => c.state === "active" && c.workspacePath === standPath && !dead.has(c.sessionId));
}
