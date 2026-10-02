import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { crosscheckRateOf } from "./crosscheck.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import { GITHUB_OFF_REASON } from "./github-switch.ts";
import { type LogEntry, loadLogbook } from "./logbook.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { aircraftRows, dayWindows, type GateRow, logbookTrend, type Network, NETWORK_DAYS, routeRows, type ViewLike } from "./network.ts";
import { allProposals, humanOf as proposalHuman, type Proposal } from "./proposals.ts";
import { countsForGate, humanOf as scheduleHuman, loadScheduleOps, type ScheduleOp } from "./schedule.ts";
import { loadLinearProjects, type ProjectGoal } from "./sources/linear-projects.ts";

// NETWORK의 게이트 진행 추세와 GET /api/network. 행 계산(ROUTE·AIRCRAFT·일별)은 network.ts
// 게이트 계산이 proposals.ts·schedule.ts를 불러서 순환 import를 끊으려고 나눴다(ATC-337)

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
          githubOff: s.github.reason === GITHUB_OFF_REASON,
          logbook: existsSync(join(config.stateDir, "logbook.jsonl")),
        },
      }),
    );
  });
}
