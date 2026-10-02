import type { LogEntry } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { targetsOf } from "./following.ts";
import { allProposals } from "./proposals.ts";
import { buildRoutes, type Route, type RoutesInput } from "./routes.ts";
import { loadLinearProjects } from "./sources/linear-projects.ts";

// ROUTE MAP의 입력 읽기(Linear 프로젝트, FOLLOWING의 AIRCRAFT). 계산은 routes.ts

export async function routesInput(s: Snapshot, entries: LogEntry[], now: number): Promise<RoutesInput & { lp: Awaited<ReturnType<typeof loadLinearProjects>> }> {
  const lp = await loadLinearProjects();
  const aircraftOf = new Map<string, string>();
  for (const t of targetsOf({ proposals: allProposals(), tickets: s.tickets })) if (t.aircraft) aircraftOf.set(t.flight, t.aircraft);
  return { lp, now, goals: lp.ok ? lp.projects : null, milestones: lp.milestones, tickets: s.tickets, entries, aircraftOf };
}

// DISPATCH BRIEFING의 사실 줄(ROUTE·WAYPOINT)이 쓴다
export async function loadRoutes(s: Snapshot, entries: LogEntry[], now: number): Promise<Route[]> {
  return buildRoutes(await routesInput(s, entries, now)).routes;
}
