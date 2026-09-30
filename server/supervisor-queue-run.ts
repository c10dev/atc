import type { Hono } from "hono";
import { config } from "./config.ts";
import { openFleetPlanNow } from "./fleet-plan-run.ts";
import { DEFAULT_HEALTH } from "./health.ts";
import { landByOf } from "./land-by.ts";
import { mccLandInfo } from "./mcc-run.ts";
import type { Snapshot } from "./model.ts";
import { allProposals } from "./proposals.ts";
import { loadScheduleMode, loadScheduleOps } from "./schedule.ts";
import { type QueueInput, type SupervisorQueue, supervisorQueueView } from "./supervisor-queue.ts";
import type { UpdateStatus } from "./update.ts";

// SUPERVISOR QUEUE(ATC-194)의 읽기. 계산은 supervisor-queue.ts(순수). 여기는 화면이 이미 쓰는 자료를 모으기만 한다(읽기 전용).
// 파일과 GitHub 등급을 읽으므로 CACHE_MS 안에서는 지난 결과를 그대로 준다.
export const CACHE_MS = 5_000;

export async function collectQueueInput(s: Snapshot, updateStatus: () => Promise<UpdateStatus | null>, now: number): Promise<QueueInput> {
  // 등급을 못 읽으면(GitHub off·오류) mcc가 null이거나 tiers가 비어 landBy가 supervisor·holder로 떨어진다(TOWER와 같은 규칙)
  const mcc = await mccLandInfo(s).catch(() => null);
  const st = await updateStatus().catch(() => null);
  return {
    proposals: allProposals(),
    schedule: { mode: loadScheduleMode(), ops: loadScheduleOps() },
    fleetPlan: openFleetPlanNow(now),
    pulls: (s.pulls ?? []).map((p) => ({ ...p, landBy: landByOf(p, mcc, s.airports.find((a) => a.repo === p.repo)?.teamsMerge !== false) })),
    update: st ? { kind: st.kind, deployed: st.deployed, main: st.main, mainCi: st.mainCi, at: st.at } : null,
    sessions: s.sessions.filter((x) => x.status !== "dead"),
    blockedMin: config.health.blockedMin ?? DEFAULT_HEALTH.blockedMin!,
  };
}

let cache: { at: number; view: SupervisorQueue } | null = null;

export function mountSupervisorQueue(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>) {
  app.get("/api/supervisor/queue", async (c) => {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_MS) return c.json(cache.view);
    const s = await getSnapshot();
    const view = supervisorQueueView(await collectQueueInput(s, updateStatus, now), now);
    cache = { at: now, view };
    return c.json(view);
  });
}
