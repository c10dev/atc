import type { Hono } from "hono";
import { atfmView } from "./atfm-run.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { loadLogbook } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { allProposals, gateOf as dispatchGateOf, readiness2bNow } from "./proposals.ts";
import { buildRoutes, type Routes } from "./routes.ts";
import { routesInput } from "./routes-load.ts";
import { gateOf as scheduleGateOf, loadScheduleMode, loadScheduleOps } from "./schedule.ts";
import { criterionCheck, type GateFacts } from "./waypoint-gates.ts";

// ROUTE MAP의 게이트 사실(6단계)과 GET /api/routes. 계산은 routes.ts, 입력은 routes-load.ts

// 완료 기준에 이을 atc 게이트의 지금 상태(6단계). ATFM 켜는 조건 계산이 무거워 60초 캐시
const FACTS_TTL_MS = 60_000;
let facts: { at: number; value: GateFacts } | null = null;
function gateFactsNow(s: Snapshot, now: number): GateFacts {
  if (facts && now - facts.at < FACTS_TTL_MS) return facts.value;
  const proposals = allProposals();
  const dispatchGate = dispatchGateOf(proposals);
  const value: GateFacts = {
    dispatchGate,
    scheduleGate: scheduleGateOf(loadScheduleOps()),
    readiness: readiness2bNow(dispatchGate, now).items,
    dispatchMode: loadDispatchConfig().mode,
    scheduleMode: loadScheduleMode(),
    autoTurnOn: atfmView(s, undefined, now).auto.turnOn,
    recalled: proposals.filter((p) => p.timeline.recalled).length,
  };
  facts = { at: now, value };
  return value;
}

export function mountRoutes(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/routes", async (c) => {
    const now = Date.now();
    const s = await getSnapshot();
    const input = await routesInput(s, loadLogbook(), now);
    // 사실은 게이트와 맞는 기준이 있을 때만 모은다
    let f: GateFacts | null = null;
    input.checkOf = (text) => criterionCheck(text, () => (f ??= gateFactsNow(s, now)));
    const body: Routes = {
      at: new Date(now).toISOString(),
      ok: input.lp.ok,
      error: input.lp.error ?? input.lp.milestonesError,
      ...buildRoutes(input),
    };
    return c.json(body);
  });
}
