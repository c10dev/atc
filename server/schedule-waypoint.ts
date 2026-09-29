import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { Ticket } from "./model.ts";
import { criteriaOf, type Route, waypointStates } from "./routes.ts";
import type { Milestone } from "./sources/linear-projects.ts";
import { GAP_DESCRIPTION_MAX } from "./waypoint-gaps.ts";

// SCHEDULE WAYPOINT(ATC-77): WAYPOINT(마일스톤)가 없는 FLIGHT를 그 ROUTE의 지나지 않은 WAYPOINT에 붙이자는 초안,
// 그리고 열린 FLIGHT가 있는데 WAYPOINT가 하나도 없는 ROUTE 알림. 설계: docs/routes.md 7장 9단계, docs/occ.md 5장.
// 마일스톤은 만들거나 바꾸지 않는다(routes.md 원칙 1) — 이슈의 milestone 칸만 쓴다. 상태·담당은 건드리지 않는다.
// 소속은 마일스톤 쪽에서 읽는다(routes.md 원칙 5): 이슈 조회(sources/linear.ts)는 milestone을 읽지 않는다.

export interface WaypointPayload {
  route: string; // FLIGHT의 프로젝트(ROUTE)
  milestone: { id: string; name: string }; // S2 호출에는 id로 들어간다
}

export class WaypointError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const CLOSED = new Set(["completed", "canceled", "duplicate"]);

// FLIGHT가 붙은 마일스톤(없으면 null). 읽은 이슈 목록에서만 찾는다 — 잘린 목록에 빠진 것은 모른다
export const milestoneOfFlight = (milestones: Pick<Milestone, "id" | "name" | "issues">[], key: string) => milestones.find((m) => m.issues.some((i) => i.key === key)) ?? null;

const routeMilestones = <M extends Pick<Milestone, "project">>(milestones: M[], route: string) => milestones.filter((m) => m.project === route);

// WAYPOINT 입력 검사(순수). ticket: 닫히지 않은 대상 FLIGHT(닫힘은 draftOps가 본다). milestones: 읽은 마일스톤 전부(못 읽었으면 null)
export function parseWaypoint(raw: Record<string, unknown>, ticket: Pick<Ticket, "key" | "project">, milestones: Milestone[] | null): WaypointPayload {
  const wanted = raw.milestone == null ? "" : String(raw.milestone).trim();
  if (!wanted) throw new WaypointError("마일스톤(WAYPOINT) 이름이나 id가 필요함");
  if (!milestones) throw new WaypointError("Linear 마일스톤을 아직 읽지 못함 — 잠시 뒤 다시", 503);
  const route = ticket.project;
  if (!route) throw new WaypointError(`${ticket.key}에는 프로젝트(ROUTE)가 없음 — WAYPOINT는 그 프로젝트의 마일스톤이라 붙일 곳이 없다`);
  const mine = routeMilestones(milestones, route).sort((a, b) => a.sortOrder - b.sortOrder);
  const now = milestoneOfFlight(milestones, ticket.key);
  if (now) throw new WaypointError(`${ticket.key}는 이미 WAYPOINT ${now.name}에 있음 — 바꾸는 초안은 쓰지 않는다`);
  // 이슈가 50개를 넘어 잘린 마일스톤이 있으면 이 FLIGHT가 이미 붙어 있는지 알 수 없다
  const cut = mine.filter((m) => m.truncated);
  if (cut.length) throw new WaypointError(`${route}의 마일스톤 ${cut.map((m) => m.name).join(", ")}은 이슈 목록이 잘려 ${ticket.key}가 이미 붙어 있는지 알 수 없음`, 409);
  const m = mine.find((x) => x.id === wanted || x.name.toLowerCase() === wanted.toLowerCase());
  const open = mine.filter((x) => x.status !== "done").map((x) => x.name);
  if (!m) throw new WaypointError(`${route}의 마일스톤이 아님: ${wanted} (가능: ${open.join(", ") || "없음"})`);
  if (m.status === "done") throw new WaypointError(`${route} · ${m.name}은 이미 지난 WAYPOINT(done) (가능: ${open.join(", ") || "없음"})`);
  return { route, milestone: { id: m.id, name: m.name } };
}

// 화면·근거용 바뀜 한 줄. 소속은 티켓에 없으니 늘 한 줄이다(APPLIED 판정은 waypointSyncOf가 마일스톤으로 한다)
export const waypointChangesOf = (p: WaypointPayload) => [`WAYPOINT 없음 → ${p.route} · ${p.milestone.name}`];

// 열린 WAYPOINT 작업을 닫을지(순수). null이면 그대로 둔다. milestones가 null이면(못 읽음) 소속으로는 판단하지 않는다.
// applied: 그 마일스톤에 FLIGHT가 보임(발부 뒤면 APPLIED, 발부 전이면 SUPERSEDED). other: 다른 마일스톤에 붙음.
// gone: 마일스톤이 없어짐, passed: 발부 전인데 WAYPOINT를 지남
export function waypointSyncOf(
  op: { flight: string; payload: WaypointPayload; status: string },
  t: Pick<Ticket, "stateType" | "state"> | undefined,
  milestones: Pick<Milestone, "id" | "name" | "status" | "issues">[] | null,
): { applied: true } | { supersede: string } | null {
  if (!t) return { supersede: "FLIGHT가 목록에 없음" };
  if (CLOSED.has(t.stateType)) return { supersede: `FLIGHT가 닫힘(${t.state})` };
  if (!milestones) return null;
  const target = milestones.find((m) => m.id === op.payload.milestone.id);
  if (target?.issues.some((i) => i.key === op.flight)) return { applied: true };
  const other = milestoneOfFlight(milestones, op.flight);
  if (other) return { supersede: `다른 WAYPOINT에 붙음(${other.name})` };
  if (!target) return { supersede: `마일스톤이 없어짐(${op.payload.milestone.name})` };
  if (target.status === "done" && op.status !== "released") return { supersede: `WAYPOINT를 이미 지남(${target.name})` };
  return null;
}

// ── 후보: WAYPOINT가 있는 ROUTE의 열린 FLIGHT인데 어느 WAYPOINT에도 없는 것 ──

export interface WaypointOption {
  id: string;
  name: string;
  state: "active" | "planned";
  targetDate: string | null;
  criteria: string[];
  description: string | null; // 번호 목록이 없을 때만 설명(1,500자까지)
}
export interface WaypointCandidate {
  route: string;
  waypoints: WaypointOption[]; // 지나지 않은 WAYPOINT, ROUTE MAP 순서(sortOrder)
  flights: string[]; // WAYPOINT가 없는 열린 FLIGHT
}

// ROUTE마다 후보(순수). 마일스톤이 잘린 ROUTE는 소속을 알 수 없어 뺀다. 모두 지난 ROUTE도 뺀다(붙일 곳이 없다).
// skip: 열린 WAYPOINT 작업이 있는 FLIGHT. atc는 이것으로 초안을 쓰지 않는다 — OCC가 완료 기준을 읽고 고른다. ROUTE 이름순
export function waypointCandidatesOf(tickets: Pick<Ticket, "key" | "project" | "stateType">[], milestones: Milestone[], skip: Set<string> = new Set()): WaypointCandidate[] {
  const members = new Set(milestones.flatMap((m) => m.issues.map((i) => i.key)));
  const byRoute = new Map<string, Milestone[]>();
  for (const m of milestones) byRoute.set(m.project, [...(byRoute.get(m.project) ?? []), m]);
  const out: WaypointCandidate[] = [];
  for (const [route, list] of byRoute) {
    if (list.some((m) => m.truncated)) continue;
    const ms = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    const states = waypointStates(ms);
    const waypoints = ms.flatMap((m, i): WaypointOption[] => {
      if (states[i] === "passed") return [];
      const criteria = criteriaOf(m.description);
      const text = m.description.trim();
      return [{
        id: m.id,
        name: m.name,
        state: states[i] as "active" | "planned",
        targetDate: m.targetDate,
        criteria,
        description: criteria.length || !text ? null : text.length > GAP_DESCRIPTION_MAX ? `${text.slice(0, GAP_DESCRIPTION_MAX - 1)}…` : text,
      }];
    });
    if (!waypoints.length) continue;
    const flights = tickets
      .filter((t) => t.project === route && !CLOSED.has(t.stateType) && !members.has(t.key) && !skip.has(t.key))
      .map((t) => t.key)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (flights.length) out.push({ route, waypoints, flights });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

// ── 알림: 열린 FLIGHT가 있는데 WAYPOINT가 하나도 없는 ROUTE. OCC가 새것(fresh)만 SUPERVISOR에게 한 번 보고하고 ack한다 ──

export interface RouteWithoutWaypoints {
  route: string; // 알림 key도 ROUTE 이름
  open: number; // ROUTE MAP의 열린 FLIGHT(active·blocked·planned, 상위 이슈 빼고)
}

// ROUTE MAP 행에서(순수). 열린 FLIGHT가 많은 순, 같으면 이름순
export function routesWithoutWaypointsOf(routes: Pick<Route, "project" | "open" | "waypoints">[]): RouteWithoutWaypoints[] {
  return routes
    .filter((r) => !r.waypoints.length)
    .map((r) => ({ route: r.project, open: r.open.active + r.open.blocked + r.open.planned }))
    .filter((r) => r.open > 0)
    .sort((a, b) => b.open - a.open || a.route.localeCompare(b.route));
}

const STATE_FILE = () => join(config.stateDir, "routes-without-waypoints.json");
export interface RoutesReported {
  reported: Record<string, string>; // ROUTE 이름 → 보고한 시각
}
export function loadRoutesReported(file = STATE_FILE()): RoutesReported {
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return { reported: r.reported && typeof r.reported === "object" ? r.reported : {} };
  } catch {
    return { reported: {} };
  }
}
export function saveRoutesReported(r: RoutesReported, file = STATE_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r, null, 2) + "\n");
  renameSync(tmp, file);
}

export const freshRouteKeys = (list: RouteWithoutWaypoints[], r: RoutesReported) => list.map((x) => x.route).filter((k) => !(k in r.reported));

// 보고했다고 적는다(순수): 지금 알림에 있는 ROUTE만 남기고(WAYPOINT가 생기거나 열린 FLIGHT가 없어지면 잊는다 — 다시 생기면 다시 fresh), ack한 것을 더한다
export function ackRoutes(list: RouteWithoutWaypoints[], r: RoutesReported, keys: string[], now: string): RoutesReported {
  const current = new Set(list.map((x) => x.route));
  const next: Record<string, string> = {};
  for (const [k, at] of Object.entries(r.reported)) if (current.has(k)) next[k] = at;
  for (const k of keys) if (current.has(k)) next[k] ??= now;
  return { reported: next };
}
