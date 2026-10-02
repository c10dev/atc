import type { Hono } from "hono";
import { config } from "./config.ts";
import { openFleetPlanNow } from "./fleet-plan-run.ts";
import { DEFAULT_HEALTH } from "./health.ts";
import { landByOf } from "./land-by.ts";
import { mccLandInfo } from "./mcc-run.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";
import { accountFolders } from "./accounts.ts";
import { allClearances } from "./clearances.ts";
import { allDecisions } from "./decision-card-run.ts";
import { allProposals } from "./proposals.ts";
import { queueEpoch } from "./queue-bust.ts";
import { allRelays, lastAircraftSources } from "./relay-run.ts";
import { relayOffersOf } from "./relay-offer.ts";
import { loadScheduleMode, loadScheduleOps } from "./schedule.ts";
import { type QueueInput, type SupervisorQueue, supervisorQueueView } from "./supervisor-queue.ts";
import type { UpdateStatus } from "./update.ts";

// SUPERVISOR QUEUE(ATC-194)의 읽기. 계산은 supervisor-queue.ts(순수). 여기는 화면이 이미 쓰는 자료를 모으기만 한다(읽기 전용).
// 파일과 GitHub 등급을 읽으므로 CACHE_MS 안에서는 지난 결과를 그대로 준다.
export const CACHE_MS = 5_000;

// TOWER가 보는 사건 목록(brief의 GO AROUND 글이 여기서 온다). mountSupervisorQueue가 넣는다: DUTY 카드도 같은 입력을 쓴다
let eventsOf: () => readonly TrafficEvent[] = () => [];
export const queueEvents = () => eventsOf();

export async function collectQueueInput(s: Snapshot, updateStatus: () => Promise<UpdateStatus | null>, now: number, events: () => readonly TrafficEvent[] = eventsOf): Promise<QueueInput> {
  // 등급을 못 읽으면(GitHub off·오류) mcc가 null이거나 tiers가 비어 landBy가 supervisor·holder로 떨어진다(TOWER와 같은 규칙)
  const mcc = await mccLandInfo(s).catch(() => null);
  const st = await updateStatus().catch(() => null);
  const relays = allRelays();
  const clearances = allClearances();
  return {
    proposals: allProposals(),
    schedule: { mode: loadScheduleMode(), ops: loadScheduleOps() },
    fleetPlan: openFleetPlanNow(now),
    pulls: (s.pulls ?? []).map((p) => ({ ...p, landBy: landByOf(p, mcc, s.airports.find((a) => a.repo === p.repo)?.teamsMerge !== false) })),
    update: st ? { kind: st.kind, deployed: st.deployed, main: st.main, mainCi: st.mainCi, at: st.at } : null,
    sessions: s.sessions.filter((x) => x.status !== "dead"),
    blockedMin: config.health.blockedMin ?? DEFAULT_HEALTH.blockedMin!,
    relays,
    clearances,
    decisions: allDecisions(),
    relayOffers: relayOffersOf({ pulls: s.pulls ?? [], claims: s.claims ?? [], workspaces: s.workspaces ?? [], airports: s.airports ?? [] }, { clearances, events: events(), relays, lastAircraft: lastAircraftSources(), now }),
    folders: accountFolders().map((f) => ({ label: f.label, dir: f.dir })),
    defaultDir: config.claudeDir,
  };
}

let cache: { at: number; epoch: number; view: SupervisorQueue } | null = null;

export function mountSupervisorQueue(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>, events: () => readonly TrafficEvent[] = () => []) {
  eventsOf = events;
  app.get("/api/supervisor/queue", async (c) => {
    const now = Date.now();
    if (cache && cache.epoch === queueEpoch() && now - cache.at < CACHE_MS) return c.json(cache.view);
    const s = await getSnapshot();
    const view = supervisorQueueView(await collectQueueInput(s, updateStatus, now), now);
    cache = { at: now, epoch: queueEpoch(), view };
    return c.json(view);
  });
}
