import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { crosscheckRateOf } from "./crosscheck.ts";
import { DONE_STATES, loadDispatchConfig } from "./dispatch.ts";
import { type AircraftView, fleetView, loadFleet } from "./fleet.ts";
import { ACTUALS_DAYS, type LogEntry, loadLogbook } from "./logbook.ts";
import { parentKeysOf, type Snapshot, type Ticket } from "./model.ts";
import { allProposals, humanOf as proposalHuman, type Proposal } from "./proposals.ts";
import { countsForGate, humanOf as scheduleHuman, loadScheduleOps, type ScheduleOp } from "./schedule.ts";
import { loadLinearProjects, type ProjectGoal } from "./sources/linear-projects.ts";

// NETWORK(4단계): ROUTE(Linear 프로젝트)·AIRCRAFT·추세를 한 화면에 모은 읽기 전용 운항 개요.
// 계산은 모두 스냅샷·LOGBOOK·FLEET·DISPATCH/SCHEDULE 기록 위의 순수 함수다. 아무것도 쓰지 않는다.
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
  sources: { linear: boolean; github: boolean; logbook: boolean };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 서버 로컬 날짜(YYYY-MM-DD). weekStartOf와 같은 로컬 시간 기준
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

type ViewLike = Pick<AircraftView, "registration" | "callsign" | "status" | "routes" | "targets" | "actuals" | "retired">;

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
      aircraft: views.filter((v) => v.routes.includes(project)).map((v) => v.registration).sort(),
      landingWaitMedianMin: median(got.map((e) => e.landingWaitMin)),
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
      landingWaitMedianMin: median(got.map((e) => e.landingWaitMin)),
      reverts: entries.filter((e) => e.reverted && inDay(e.revertedBy?.at)).length,
    };
  });
}

// 게이트 진행: 날마다 SUPERVISOR 그림자 판정 수(agreed·disagreed — 게이트가 세는 것과 같다)와
// 그날 끝까지의 누적 합의율. 마지막 날 값은 proposals.gateOf·schedule.gateOf의 agreement와 같다.
// 승인 단계(2b·S2)의 approve·reject는 게이트처럼 세지 않는다.
// crosscheckMatch: DISPATCH와 SCHEDULE을 합친 CROSSCHECK 일치율(crosscheckRateOf), 그날 끝까지 사람 판정이 난 것 누적.
// TARGET·ROUTE(countsForGate가 아닌 것)는 게이트처럼 빼고 센다.
export function gateTrend(proposals: Proposal[], allOps: ScheduleOp[], now: number, days = NETWORK_DAYS): GateRow[] {
  const ops = allOps.filter(countsForGate);
  const shadow = <T>(xs: T[], status: (x: T) => string, at: (x: T) => string | null | undefined) =>
    xs
      .filter((x) => status(x) === "agreed" || status(x) === "disagreed")
      .map((x) => ({ t: Date.parse(at(x) ?? ""), agreed: status(x) === "agreed" }))
      .filter((x) => Number.isFinite(x.t));
  const dispatch = shadow(proposals, (p) => p.status, (p) => p.timeline.agreed ?? p.timeline.disagreed);
  const schedule = shadow(ops, (s) => s.status, (s) => s.decision?.at);
  const marks = [
    ...proposals.map((p) => ({ crosscheck: p.crosscheck, human: proposalHuman(p) })),
    ...ops.map((s) => ({ crosscheck: s.crosscheck, human: scheduleHuman(s) })),
  ].filter((x) => x.human);
  const cumulative = (xs: { t: number; agreed: boolean }[], to: number) => {
    const upto = xs.filter((x) => x.t < to);
    return upto.length ? upto.filter((x) => x.agreed).length / upto.length : null;
  };
  return dayWindows(now, days).map(({ date, from, to }) => {
    const end = Math.min(to, now + 1);
    return {
      date,
      dispatchDecided: dispatch.filter((x) => x.t >= from && x.t < end).length,
      dispatchAgreement: cumulative(dispatch, end),
      scheduleDecided: schedule.filter((x) => x.t >= from && x.t < end).length,
      scheduleAgreement: cumulative(schedule, end),
      crosscheckMatch: crosscheckRateOf(marks.filter((x) => Date.parse(x.human!.at) < end)).rate,
    };
  });
}

export interface NetworkInput {
  now: number;
  tickets: Ticket[];
  entries: LogEntry[];
  views: ViewLike[];
  goals: ProjectGoal[] | null;
  proposals: Proposal[];
  schedule: ScheduleOp[];
  sources: Network["sources"];
}

export function buildNetwork(i: NetworkInput): Network {
  return {
    at: new Date(i.now).toISOString(),
    windowDays: NETWORK_DAYS,
    routes: routeRows(i),
    aircraft: aircraftRows(i.views),
    trend: { days: logbookTrend(i.entries, i.now), gates: gateTrend(i.proposals, i.schedule, i.now) },
    sources: i.sources,
  };
}

// ---- 입출력 ----

export function mountNetwork(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/network", async (c) => {
    const s = await getSnapshot();
    const now = Date.now();
    const entries = loadLogbook();
    const views = fleetView(s, loadFleet(), loadDispatchConfig().teamPattern, entries, now);
    const lp = await loadLinearProjects();
    return c.json(
      buildNetwork({
        now,
        tickets: s.tickets,
        entries,
        views,
        goals: lp.ok ? lp.projects : null,
        proposals: allProposals(),
        schedule: loadScheduleOps(),
        sources: {
          linear: s.linear.enabled && Boolean(s.linear.fetchedAt),
          github: s.github.enabled && Boolean(s.github.fetchedAt),
          logbook: existsSync(join(config.stateDir, "logbook.jsonl")),
        },
      }),
    );
  });
}
