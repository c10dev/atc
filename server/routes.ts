import { DONE_STATES } from "./dispatch.ts";
import type { LogEntry } from "./logbook.ts";
import { parentKeysOf, type Ticket } from "./model.ts";
import { dayKey } from "./day-key.ts";
import type { Milestone, ProjectGoal } from "./sources/linear-projects.ts";
import type { GateCheck } from "./waypoint-gates.ts";

// ROUTE MAP: ROUTE(Linear 프로젝트)마다 WAYPOINT(마일스톤)와 그 FLIGHT, ETA. 읽기 전용 순수 함수.
// 입력을 읽는 쪽은 routes-load.ts, 게이트 사실과 HTTP는 routes-run.ts(순환 import를 끊으려고 나눴다, ATC-337)
// 설계: docs/routes.md

const DAY = 86_400_000;
export const RATE_DAYS = 28;
export const RATE_MIN_SAMPLES = 3;

export type WaypointState = "passed" | "active" | "planned";
export type FlightPhase = "done" | "active" | "blocked" | "planned";
export type EtaReason = "few-samples" | "no-flights" | "truncated";

export interface RouteFlight {
  key: string;
  title: string;
  phase: FlightPhase;
  aircraft: string | null;
  url: string | null;
}

export interface Counts {
  done: number;
  active: number;
  blocked: number;
  planned: number;
}

export interface Eta {
  at: string | null; // YYYY-MM-DD, 모르면 null
  remaining: number; // 이 WAYPOINT의 남은 FLIGHT
  cumulative: number; // 앞선 지나지 않은 WAYPOINT까지 합친 남은 FLIGHT
  reason: EtaReason | null;
}

export interface Waypoint {
  id: string;
  name: string;
  state: WaypointState;
  linearStatus: string | null;
  progress: number | null;
  targetDate: string | null;
  criteria: string[];
  flights: RouteFlight[];
  counts: Counts;
  truncated: boolean;
  late: boolean;
  eta: Eta | null; // 지난 WAYPOINT는 null
  checks: (GateCheck | null)[]; // criteria마다 이어진 atc 게이트(6단계). 맞는 게이트가 없으면 null
}

export interface Route {
  project: string;
  state: string | null;
  progress: number | null;
  targetDate: string | null;
  open: Omit<Counts, "done">;
  aircraft: string[];
  rate: { completed: number; perWeek: number };
  waypoints: Waypoint[];
}

export interface Routes {
  at: string;
  ok: boolean; // Linear 프로젝트를 읽었나
  milestones: boolean; // 마일스톤을 읽었나
  error: string | null;
  windowDays: number;
  routes: Route[];
}

// 설명에서 완료 기준 추출. "Exit criteria"·"완료 기준" 제목 아래 번호 목록, 없으면 설명 전체의 번호 목록.
// 항목마다 첫 줄만, 굵게·밑줄 강조는 벗긴다.
export function criteriaOf(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const item = /^\s*\d+\\?[.)]\s+(.+)$/;
  const isHeading = (l: string) => /^\s*#/.test(l) || (/:\s*$/.test(l) && !item.test(l));
  const clean = (s: string) => s.replace(/\*\*|__/g, "").trim();
  const collect = (from: number) => {
    const out: string[] = [];
    for (let i = from; i < lines.length; i++) {
      const m = item.exec(lines[i]);
      if (m) out.push(clean(m[1]));
      else if (out.length && isHeading(lines[i])) break;
    }
    return out.filter(Boolean);
  };
  const h = lines.findIndex((l) => /exit criteria|완료 기준/i.test(l) && !item.test(l));
  if (h >= 0) {
    const got = collect(h + 1);
    if (got.length) return got;
  }
  return lines.map((l) => item.exec(l)?.[1]).filter((s): s is string => Boolean(s)).map(clean).filter(Boolean);
}

// FLIGHT 하나의 단계. 끝남 → done, canceled·duplicate → null(뺀다), 열린 blockedBy → blocked, started → active, 나머지 planned
export function phaseOf(stateType: string, blocked: boolean): FlightPhase | null {
  if (stateType === "completed") return "done";
  if (DONE_STATES.has(stateType as Ticket["stateType"])) return null;
  if (blocked) return "blocked";
  if (stateType === "started") return "active";
  return "planned";
}

// 보드에서 열린 선행 FLIGHT가 있나(보드에 없는 선행은 모른다 → 막힘으로 치지 않는다. dispatch와 같은 규칙)
export function isBlocked(t: Pick<Ticket, "blockedBy"> | undefined, byKey: Map<string, Pick<Ticket, "stateType">>): boolean {
  return Boolean(t?.blockedBy.some((k) => byKey.has(k) && !DONE_STATES.has(byKey.get(k)!.stateType)));
}

// 지난 WAYPOINT(Linear done) 말고 sortOrder로 첫 것이 active, 나머지 planned
// DISPATCH 점수(docs/routes.md 7장 8단계): FLIGHT key → 그 FLIGHT가 붙은 지금 구간 WAYPOINT("ROUTE · WAYPOINT"). 순수.
// ROUTE마다 지나지 않은 첫 WAYPOINT만. 이슈 목록이 잘린 마일스톤도 읽은 이슈는 넣는다
export function activeWaypointsOf(milestones: Pick<Milestone, "project" | "name" | "status" | "sortOrder" | "issues">[] | null): Map<string, string> {
  const out = new Map<string, string>();
  const byProject = new Map<string, typeof milestones & object>();
  for (const m of milestones ?? []) byProject.set(m.project, [...(byProject.get(m.project) ?? []), m]);
  for (const [project, ms] of byProject) {
    const i = waypointStates(ms).indexOf("active");
    if (i < 0) continue;
    for (const iss of ms[i].issues) out.set(iss.key, `${project} · ${ms[i].name}`);
  }
  return out;
}

export function waypointStates(ms: Pick<Milestone, "status" | "sortOrder">[]): WaypointState[] {
  const order = ms.map((m, i) => ({ m, i })).sort((a, b) => a.m.sortOrder - b.m.sortOrder);
  const out: WaypointState[] = ms.map(() => "planned");
  let active = false;
  for (const { m, i } of order) {
    if (m.status === "done") out[i] = "passed";
    else if (!active) {
      out[i] = "active";
      active = true;
    }
  }
  return out;
}

// ROUTE의 최근 완료 FLIGHT 수: 창 안에 LOGBOOK ARRIVED이거나 Linear completedAt인 FLIGHT(중복 없이)
export function completedIn(input: { project: string; entries: LogEntry[]; milestones: Milestone[]; projectOf: Map<string, string>; now: number; days?: number }): number {
  const since = input.now - (input.days ?? RATE_DAYS) * DAY;
  const inWindow = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return t >= since && t <= input.now;
  };
  const keys = new Set<string>();
  for (const e of input.entries) if (e.flight && input.projectOf.get(e.flight) === input.project && inWindow(e.arrivedAt)) keys.add(e.flight);
  for (const m of input.milestones)
    if (m.project === input.project) for (const i of m.issues) if (i.stateType === "completed" && inWindow(i.completedAt)) keys.add(i.key);
  return keys.size;
}

// ETA: 누적 남은 FLIGHT ÷ 하루 완료 수. 표본이 적거나, 남은 FLIGHT가 없거나, 목록이 잘렸으면 모름
export function etaOf(input: { remaining: number; cumulative: number; truncated: boolean; completed: number; now: number; days?: number }): Eta {
  const { remaining, cumulative, now } = input;
  const base = { remaining, cumulative };
  if (remaining === 0) return { ...base, at: null, reason: "no-flights" };
  if (input.truncated) return { ...base, at: null, reason: "truncated" };
  if (input.completed < RATE_MIN_SAMPLES) return { ...base, at: null, reason: "few-samples" };
  const perDay = input.completed / (input.days ?? RATE_DAYS);
  return { ...base, at: dayKey(now + Math.ceil(cumulative / perDay) * DAY), reason: null };
}

// 지연: 지나지 않았는데 목표일이 오늘보다 앞이거나 ETA보다 앞, 또는 Linear가 overdue라 한다
export function isLate(w: { state: WaypointState; targetDate: string | null; linearStatus: string | null; eta: Eta | null }, now: number): boolean {
  if (w.state === "passed") return false;
  if (w.linearStatus === "overdue") return true;
  if (!w.targetDate) return false;
  const target = w.targetDate.slice(0, 10);
  return target < dayKey(now) || Boolean(w.eta?.at && w.eta.at > target);
}

export interface RoutesInput {
  now: number;
  goals: ProjectGoal[] | null;
  milestones: Milestone[] | null;
  tickets: Ticket[];
  entries: LogEntry[];
  aircraftOf: Map<string, string>; // FLIGHT key → REGISTRATION(FOLLOWING과 같은 규칙)
  checkOf?: (criterion: string) => GateCheck | null; // 완료 기준 → atc 게이트(없으면 모두 null)
}

export function buildRoutes(i: RoutesInput): Omit<Routes, "at" | "ok" | "error"> {
  const { now, tickets } = i;
  const milestones = i.milestones ?? [];
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const parents = parentKeysOf(tickets);
  const projectOf = new Map<string, string>();
  for (const t of tickets) if (t.project) projectOf.set(t.key, t.project);
  for (const m of milestones) for (const iss of m.issues) projectOf.set(iss.key, m.project);

  // 보드의 열린 FLIGHT(ROUTES 표처럼 상위 이슈·backlog·triage는 뺀다)
  const boardOpen = new Map<string, Ticket[]>();
  for (const t of tickets) {
    if (!t.project || parents.has(t.key) || (t.stateType !== "started" && t.stateType !== "unstarted")) continue;
    boardOpen.set(t.project, [...(boardOpen.get(t.project) ?? []), t]);
  }

  const goalOf = new Map((i.goals ?? []).map((g) => [g.name, g]));
  const ended = (p: string) => ["completed", "canceled"].includes(goalOf.get(p)?.state ?? "");
  const names = new Set<string>([...boardOpen.keys(), ...milestones.map((m) => m.project)]);
  for (const g of i.goals ?? []) names.add(g.name);

  const routes = [...names]
    .filter((p) => !ended(p))
    .map((project): Route => {
      const g = goalOf.get(project);
      const open = { active: 0, blocked: 0, planned: 0 };
      const aircraft = new Set<string>();
      for (const t of boardOpen.get(project) ?? []) {
        const ph = phaseOf(t.stateType, isBlocked(t, byKey));
        if (ph && ph !== "done") open[ph]++;
        const ac = i.aircraftOf.get(t.key);
        if (ac) aircraft.add(ac);
      }
      const completed = completedIn({ project, entries: i.entries, milestones, projectOf, now });
      const ms = milestones.filter((m) => m.project === project).sort((a, b) => a.sortOrder - b.sortOrder);
      const states = waypointStates(ms);
      let cumulative = 0;
      let truncatedBefore = false;
      const waypoints = ms.map((m, k): Waypoint => {
        const flights: RouteFlight[] = [];
        for (const iss of m.issues) {
          const t = byKey.get(iss.key);
          const ph = phaseOf(t?.stateType ?? iss.stateType, isBlocked(t, byKey));
          if (!ph) continue;
          flights.push({ key: iss.key, title: t?.title ?? iss.title, phase: ph, aircraft: ph === "done" ? null : (i.aircraftOf.get(iss.key) ?? null), url: t?.url ?? null });
        }
        const counts: Counts = { done: 0, active: 0, blocked: 0, planned: 0 };
        for (const f of flights) counts[f.phase]++;
        const state = states[k];
        const remaining = counts.active + counts.blocked + counts.planned;
        let eta: Eta | null = null;
        if (state !== "passed") {
          cumulative += remaining;
          truncatedBefore ||= m.truncated;
          eta = etaOf({ remaining, cumulative, truncated: truncatedBefore, completed, now });
        }
        const w = { state, targetDate: m.targetDate, linearStatus: m.status, eta };
        const criteria = criteriaOf(m.description);
        return {
          id: m.id,
          name: m.name,
          state,
          linearStatus: m.status,
          progress: m.progress,
          targetDate: m.targetDate,
          criteria,
          checks: criteria.map((c) => i.checkOf?.(c) ?? null),
          flights,
          counts,
          truncated: m.truncated,
          late: isLate(w, now),
          eta,
        };
      });
      return {
        project,
        state: g?.state ?? null,
        progress: g?.progress ?? null,
        targetDate: g?.targetDate ?? null,
        open,
        aircraft: [...aircraft].sort(),
        rate: { completed, perWeek: Math.round((completed / (RATE_DAYS / 7)) * 10) / 10 },
        waypoints,
      };
    });
  const load = (r: Route) => r.open.active + r.open.blocked + r.open.planned;
  routes.sort((a, b) => Number(!a.waypoints.length) - Number(!b.waypoints.length) || load(b) - load(a) || a.project.localeCompare(b.project));
  return { milestones: i.milestones !== null, windowDays: RATE_DAYS, routes };
}
