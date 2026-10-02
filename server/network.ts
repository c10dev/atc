import { dayKey } from "./day-key.ts";
import { compareRegistration } from "./registration.ts";
import { DONE_STATES } from "./dispatch.ts";
import type { AircraftView } from "./fleet.ts";
import { ACTUALS_DAYS, type LogEntry } from "./logbook.ts";
import { parentKeysOf, type Ticket } from "./model.ts";
import type { ProjectGoal } from "./sources/linear-projects.ts";

// NETWORK(4단계): ROUTE(Linear 프로젝트)·AIRCRAFT·추세를 한 화면에 모은 읽기 전용 운항 개요.
// 계산은 모두 스냅샷·LOGBOOK·FLEET·DISPATCH/SCHEDULE 기록 위의 순수 함수다. 아무것도 쓰지 않는다.
// 게이트 진행 추세와 HTTP는 network-run.ts(순환 import를 끊으려고 나눴다, ATC-337).
// 설계: docs/fleet.md 7장(TARGETS)과 7.3(NETWORK).

const DAY = 86_400_000;
export const NETWORK_DAYS = 28;
export const ROUTE_ARRIVED_DAYS = ACTUALS_DAYS; // 14일. FLEET 카드 실적과 같은 창

export interface RouteRow {
  project: string;
  goal: { targetDate: string | null; progress: number | null; state: string | null } | null;
  open: { todo: number; inProgress: number; inReview: number };
  arrived14: number;
  aircraft: string[];
  landingWaitMedianMin: number | null;
}

export interface AircraftRow {
  registration: string;
  callsign: string;
  status: string;
  targets: { flightsPerWeek: number | null; onTime: number | null };
  actuals: { weekDone: number; onTimeRate: number | null; landingWaitMedianMin: number | null; reverts: number; los: number };
}

export interface DayRow {
  date: string;
  arrived: number;
  landingWaitMedianMin: number | null;
  reverts: number;
}

export interface GateRow {
  date: string;
  dispatchDecided: number;
  dispatchAgreement: number | null;
  scheduleDecided: number;
  scheduleAgreement: number | null;
  crosscheckMatch: number | null;
}

export interface Network {
  at: string;
  windowDays: number;
  routes: RouteRow[];
  aircraft: AircraftRow[];
  trend: { days: DayRow[]; gates: GateRow[] };
  sources: { linear: boolean; github: boolean; githubOff?: boolean; logbook: boolean };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 오늘을 포함한 최근 n일의 [시작, 끝) 구간, 오래된 날 먼저. 자정은 로컬 시간(서머타임도 setDate로 맞춘다)
export function dayWindows(now: number, n = NETWORK_DAYS): { date: string; from: number; to: number }[] {
  const out: { date: string; from: number; to: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const a = new Date(now);
    a.setHours(0, 0, 0, 0);
    a.setDate(a.getDate() - i);
    const b = new Date(a);
    b.setDate(b.getDate() + 1);
    out.push({ date: dayKey(a.getTime()), from: a.getTime(), to: b.getTime() });
  }
  return out;
}

// 열린 FLIGHT의 단계. 화면(web/src/aviation.ts)과 같은 규칙: 이름 In Review·Ready to Merge → APPROACH 쪽(inReview),
// 그 밖의 started → ENROUTE(inProgress), unstarted → FILED(todo). backlog·triage·끝난 상태는 세지 않는다.
export function openPhase(t: Pick<Ticket, "state" | "stateType">): keyof RouteRow["open"] | null {
  if (DONE_STATES.has(t.stateType)) return null;
  if (t.state === "In Review" || t.state === "Ready to Merge") return "inReview";
  if (t.stateType === "started") return "inProgress";
  if (t.stateType === "unstarted") return "todo";
  return null;
}

export type ViewLike = Pick<AircraftView, "registration" | "callsign" | "status" | "routes" | "targets" | "actuals" | "retired">;

// ROUTE별 행. 프로젝트 목록 = 열린 FLIGHT·최근 14일 ARRIVED·AIRCRAFT ROUTE에 나온 프로젝트
// + Linear 프로젝트 중 끝나지 않은 것(status.type이 completed·canceled면 제외). 바쁜 ROUTE 먼저, 같으면 이름순.
// LOGBOOK 기록의 프로젝트는 스냅샷 티켓으로 찾는다(티켓을 모르면 어느 ROUTE에도 넣지 않는다).
// goals가 null이면(Linear 프로젝트를 못 읽음) 모든 goal이 null.
export function routeRows(input: { tickets: Ticket[]; entries: LogEntry[]; views: ViewLike[]; goals: ProjectGoal[] | null; now: number }): RouteRow[] {
  const { tickets, entries, goals, now } = input;
  const views = input.views.filter((v) => !v.retired);
  const parents = parentKeysOf(tickets);
  const projectOf = new Map(tickets.map((t) => [t.key, t.project]));
  const open = new Map<string, RouteRow["open"]>();
  const openOf = (p: string) => open.get(p) ?? (open.set(p, { todo: 0, inProgress: 0, inReview: 0 }), open.get(p)!);
  for (const t of tickets) {
    const phase = openPhase(t);
    if (!t.project || !phase || parents.has(t.key)) continue;
    openOf(t.project)[phase]++;
  }
  const since = now - ROUTE_ARRIVED_DAYS * DAY;
  const arrived = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const at = Date.parse(e.arrivedAt);
    const p = e.flight ? projectOf.get(e.flight) : null;
    if (!p || at < since || at > now) continue;
    arrived.set(p, [...(arrived.get(p) ?? []), e]);
  }
  const goalOf = new Map((goals ?? []).map((g) => [g.name, g]));
  const names = new Set<string>([...open.keys(), ...arrived.keys(), ...views.flatMap((v) => v.routes)]);
  for (const g of goals ?? []) if (g.state !== "completed" && g.state !== "canceled") names.add(g.name);
  const rows = [...names].map((project): RouteRow => {
    const g = goals ? goalOf.get(project) : undefined;
    const got = arrived.get(project) ?? [];
    return {
      project,
      goal: g ? { targetDate: g.targetDate, progress: g.progress, state: g.state } : null,
      open: open.get(project) ?? { todo: 0, inProgress: 0, inReview: 0 },
      arrived14: got.length,
      aircraft: views.filter((v) => v.routes.includes(project)).map((v) => v.registration).sort(compareRegistration),
      landingWaitMedianMin: median(got.flatMap((e) => e.landingWaitMin ?? [])),
    };
  });
  const load = (r: RouteRow) => r.open.todo + r.open.inProgress + r.open.inReview + r.arrived14;
  return rows.sort((a, b) => load(b) - load(a) || a.project.localeCompare(b.project));
}

// AIRCRAFT별 TARGETS 대 실적. 실적은 fleetView의 actuals(computeActuals)를 그대로 옮긴다 — FLEET 카드와 같은 숫자.
// 퇴역(RETIREMENT) AIRCRAFT는 뺀다.
export function aircraftRows(views: ViewLike[]): AircraftRow[] {
  return views
    .filter((v) => !v.retired)
    .map((v) => ({
      registration: v.registration,
      callsign: v.callsign,
      status: v.status,
      targets: { flightsPerWeek: v.targets.flightsPerWeek ?? null, onTime: v.targets.onTime ?? null },
      actuals: {
        weekDone: v.actuals.week,
        onTimeRate: v.actuals.onTime.rate,
        landingWaitMedianMin: v.actuals.landingWait.medianMin,
        reverts: v.actuals.reverted,
        los: v.actuals.los,
      },
    }));
}

// 날마다: 그날 ARRIVED 수, 그날 ARRIVED한 것의 착륙 대기 중앙값, 그날 머지된 Revert PR 수(revertedBy.at)
export function logbookTrend(entries: LogEntry[], now: number, days = NETWORK_DAYS): DayRow[] {
  return dayWindows(now, days).map(({ date, from, to }) => {
    const inDay = (iso: string | undefined | null) => {
      const t = iso ? Date.parse(iso) : NaN;
      return t >= from && t < to && t <= now;
    };
    const got = entries.filter((e) => inDay(e.arrivedAt));
    return {
      date,
      arrived: got.length,
      landingWaitMedianMin: median(got.flatMap((e) => e.landingWaitMin ?? [])),
      reverts: entries.filter((e) => e.reverted && inDay(e.revertedBy?.at)).length,
    };
  });
}
