import { criteriaOf, waypointStates } from "./routes.ts";
import type { Milestone, ProjectGoal } from "./sources/linear-projects.ts";

// WAYPOINT gaps(ATC-8): ROUTE마다 지금 구간 WAYPOINT와 그다음 WAYPOINT의 완료 기준과 그 마일스톤의 이슈를 함께 보인다.
// 기준과 이슈를 짝짓는 것은 판단이라 서버는 하지 않는다 — OCC가 읽고, 덮는 이슈가 없는 기준만 NEW 초안으로 올린다.
// 설계: docs/routes.md, docs/occ.md 5.6

export interface GapIssue {
  key: string;
  title: string;
  state: string; // Linear 상태 이름
  stateType: string;
}

export interface GapWaypoint {
  id: string; // Linear 마일스톤 id(NEW의 --milestone에 이름 대신 써도 된다)
  name: string;
  state: "active" | "planned";
  linearStatus: string | null;
  progress: number | null;
  targetDate: string | null;
  criteria: string[];
  // 번호 목록이 없으면 설명 전체(1,500자까지). "Exit when …" 같은 문장에서 기준을 읽는 것은 OCC가 한다
  description: string | null;
  issues: GapIssue[]; // 취소·중복은 뺀다(덮지 않는다)
  truncated: boolean; // 이슈가 50개를 넘어 다 못 읽음 — 빠진 이슈가 있을 수 있다
}

export interface WaypointGap {
  route: string;
  waypoints: GapWaypoint[]; // 지금 구간, 그다음(있으면)
}

const DROPPED = new Set(["canceled", "duplicate"]);
export const GAP_DESCRIPTION_MAX = 1500;

// 후보 팀(teams, dispatch.json candidateTeams)의 마일스톤만 이 팀들의 ROUTE다(docs/routes.md 7장 5단계).
// NEW 초안은 주 팀에 이슈를 만들므로, 다른 팀(예: ATC) 프로젝트의 기준을 VOC 이슈로 올리지 않게 거른다.
export const ofTeams = (milestones: Milestone[], teams: Set<string>) => milestones.filter((m) => m.teams.some((t) => teams.has(t)));

// 끝난(completed·canceled) ROUTE와 WAYPOINT가 없거나 모두 지난 ROUTE는 뺀다. ROUTE 이름순. teams가 있으면 그 팀 마일스톤만
export function waypointGapsOf(all: Milestone[], goals: ProjectGoal[] | null, teams?: Set<string>): WaypointGap[] {
  const milestones = teams ? ofTeams(all, teams) : all;
  const ended = new Set((goals ?? []).filter((g) => g.state === "completed" || g.state === "canceled").map((g) => g.name));
  const byProject = new Map<string, Milestone[]>();
  for (const m of milestones) byProject.set(m.project, [...(byProject.get(m.project) ?? []), m]);
  const out: WaypointGap[] = [];
  for (const [route, list] of byProject) {
    if (ended.has(route)) continue;
    const ms = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    const states = waypointStates(ms);
    const active = states.indexOf("active");
    if (active < 0) continue;
    const next = states.findIndex((s, i) => i > active && s === "planned");
    const pick = [active, ...(next >= 0 ? [next] : [])];
    out.push({
      route,
      waypoints: pick.map((i) => {
        const m = ms[i];
        const criteria = criteriaOf(m.description);
        const text = m.description.trim();
        return {
          id: m.id,
          name: m.name,
          state: states[i] as "active" | "planned",
          linearStatus: m.status,
          progress: m.progress,
          targetDate: m.targetDate,
          criteria,
          description: criteria.length || !text ? null : text.length > GAP_DESCRIPTION_MAX ? `${text.slice(0, GAP_DESCRIPTION_MAX - 1)}…` : text,
          issues: m.issues.filter((x) => !DROPPED.has(x.stateType)).map((x) => ({ key: x.key, title: x.title, state: x.state, stateType: x.stateType })),
          truncated: m.truncated,
        };
      }),
    });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}
