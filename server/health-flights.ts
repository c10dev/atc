import { tailsOf } from "./dispatch.ts";
import { type HealthConfig, stalledOf } from "./health.ts";
import type { Claim, PullRequest, Session, Ticket, Workspace } from "./model.ts";
import { standFreeTicket } from "./proposals.ts";
import { regKey } from "./registration.ts";

// FLIGHT를 쥔 AIRCRAFT의 health(ATC-86, docs/fleet.md 8.8 "as built"): STALLED와, 한도로 잘리거나 멈춘 AIRCRAFT가 FLIGHT를 잃지 않게 하는 것.
// 세션의 활동 시각과 이미 읽은 점유·Linear·PR로만 계산한다(폴링 없음). 순수 함수이고, 스냅샷이 세션에 결과를 붙인다.

export interface FlightHealthInput {
  sessions: Session[];
  teamPattern: string;
  freshClaims: readonly Claim[]; // 지금 STAND를 쥔 점유(claimTtl 안)
  staleClaims: readonly Claim[]; // TTL이 지나 스냅샷 claims에서 빠진 hook 점유. 한도로 멈춘 AIRCRAFT의 FLIGHT를 잃지 않게 하는 데만 쓴다
  workspaces: readonly Pick<Workspace, "path" | "ticketKey">[];
  tickets: readonly Ticket[];
  pulls: readonly Pick<PullRequest, "ticketKey">[];
  now: number;
  cfg: HealthConfig;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

// 멈춘 채로 FLIGHT를 보여 줄 health: 오류 없이 한도로 잘린 LIMIT, RESUME, STALLED
export const keepsFlight = (h: { code: string; cut?: boolean } | null | undefined): boolean => Boolean(h) && (h!.code === "RESUME" || h!.code === "STALLED" || (h!.code === "LIMIT" && h!.cut === true));

// 세션마다: 다른 health가 없고 조건이 맞으면 STALLED를 붙이고, 그 health(cut LIMIT·RESUME·STALLED)면 STAND를 놓친 FLIGHT를 keptFlights에 둔다.
// In Progress FLIGHT = 그 AIRCRAFT가 STAND를 쥔(점유) FLIGHT와 tail: 라벨이 붙은 FLIGHT 중 Linear가 started인 것
export function applyFlightHealth(inp: FlightHealthInput): void {
  const team = new RegExp(inp.teamPattern, "i");
  const wsTicket = new Map(inp.workspaces.map((w) => [w.path, w.ticketKey]));
  const ticketOf = new Map(inp.tickets.map((t) => [t.key, t]));
  const keysOf = (cs: readonly Claim[], id: string) => uniq(cs.filter((c) => c.sessionId === id && c.state === "active").map((c) => wsTicket.get(c.workspacePath)).filter((k): k is string => Boolean(k)));
  for (const x of inp.sessions) {
    if (x.agent !== "claude" || x.status === "dead" || !team.test(x.name)) continue;
    const reg = regKey(x.name, inp.teamPattern);
    const held = keysOf(inp.freshClaims, x.id);
    const tail = inp.tickets.filter((t) => t.stateType === "started" && tailsOf(t).has(reg)).map((t) => t.key);
    if (!x.health) {
      // PR을 낼 일이 아닌 FLIGHT(SURVEY·CHECK 같은 STAND 없는 FLIGHT)는 PR이 없어도 멈춘 것이 아니다
      const open = uniq([...held, ...tail]).filter((k) => ticketOf.get(k)?.stateType === "started" && !standFreeTicket(ticketOf.get(k)));
      x.health = stalledOf(
        { status: x.status, lastActiveAt: x.lastActiveAt ? Date.parse(x.lastActiveAt) : null, flights: open.map((key) => ({ key, hasPr: inp.pulls.some((p) => p.ticketKey === key) })) },
        inp.now,
        inp.cfg,
      );
    }
    if (!keepsFlight(x.health)) continue;
    const stale = keysOf(inp.staleClaims, x.id).filter((k) => {
      const t = ticketOf.get(k);
      return !t || t.stateType === "started"; // Done·Canceled FLIGHT의 옛 워크트리는 FLIGHT가 아니다
    });
    const kept = uniq([...tail, ...stale]).filter((k) => !held.includes(k));
    if (kept.length) x.keptFlights = kept;
  }
}
