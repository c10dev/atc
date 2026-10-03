import type { Hono } from "hono";
import { config } from "./config.ts";
import { openFleetPlanNow } from "./fleet-plan-run.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { DEFAULT_HEALTH } from "./health.ts";
import { landDecisionOf } from "./land-by.ts";
import { mccLandInfo } from "./mcc-run.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";
import { accountFolders } from "./accounts.ts";
import { allClearances } from "./clearances.ts";
import { allProposals } from "./proposals.ts";
import { arrivedOpenOf } from "./arrived-open.ts";
import { closeManualOf, closePrOf } from "./close-manual.ts";
import { loadLogbook } from "./logbook.ts";
import { foldEffects } from "./effect-check.ts";
import { readEffectLines } from "./effect-store.ts";
import { followNow } from "./follow-run.ts";
import { setTodo } from "./queue-todo.ts";
import { currentAlerts } from "./supervisor-alerts-run.ts";
import { candidateTeamsOf } from "./dispatch.ts";
import { readReviewLines } from "./duty-review-store.ts";
import { filedProposalsOf, proposalSourcesOf } from "./release-proposals.ts";
import { queueEpoch } from "./queue-bust.ts";
import { allRelays, lastAircraftSources } from "./relay-run.ts";
import { relayOffersOf } from "./relay-offer.ts";
import { holderRoutes } from "./pr-holder-state.ts";
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
  // HOME의 한 목록(ATC-454): 읽기만 한다. 보드를 못 만들어도 다른 줄은 그대로
  const scheduleOps = loadScheduleOps();
  let follow: QueueInput["follow"];
  try {
    const f = followNow(s, now);
    follow = { bundles: f.bundles.filter((b) => !b.folded), dispatchMode: f.dispatchMode };
  } catch {
    follow = undefined;
  }
  let effects: QueueInput["effects"];
  try {
    effects = foldEffects(readEffectLines());
  } catch {
    effects = undefined;
  }
  const closes = closeManualOf(scheduleOps, s.tickets, now).map((x) => {
    const t = s.tickets.find((y) => y.key === x.flight);
    return { id: x.id, flight: x.flight ?? null, statusAt: x.statusAt, url: t?.url ?? null, pr: closePrOf(x) };
  });
  return {
    alerts: currentAlerts(),
    arrived: arrivedOpenOf(s.tickets, loadLogbook()),
    follow,
    effects,
    closes,
    proposals: allProposals(),
    autoDispatch: loadDispatchConfig().autoDispatch === "on",
    schedule: { mode: loadScheduleMode(), ops: scheduleOps },
    fleetPlan: openFleetPlanNow(now),
    pulls: (s.pulls ?? []).map((p) => {
      const d = landDecisionOf(p, mcc, s.airports.find((a) => a.repo === p.repo)?.teamsMerge !== false);
      return { ...p, landBy: d.by, landWhy: d.why };
    }),
    update: st ? { kind: st.kind, deployed: st.deployed, main: st.main, mainCi: st.mainCi, at: st.at } : null,
    sessions: s.sessions.filter((x) => x.status !== "dead"),
    blockedMin: config.health.blockedMin ?? DEFAULT_HEALTH.blockedMin!,
    teamPattern: loadDispatchConfig().teamPattern,
    relays,
    clearances,
    relayOffers: relayOffersOf({ pulls: s.pulls ?? [], claims: s.claims ?? [], sessions: s.sessions ?? [], workspaces: s.workspaces ?? [], airports: s.airports ?? [] }, { clearances, events: events(), relays, lastAircraft: lastAircraftSources(), now, holderRoutes: holderRoutes() ?? new Map() }),
    backlog: filedProposalsOf(s.tickets, proposalSourcesOf(readReviewLines(), loadScheduleOps()), candidateTeamsOf(loadDispatchConfig())).map((f) => ({ key: f.key, by: f.by, at: f.at })),
    folders: accountFolders().map((f) => ({ label: f.label, dir: f.dir })),
    defaultDir: config.claudeDir,
  };
}

let cache: { at: number; epoch: number; view: SupervisorQueue } | null = null;

// 같은 5초 캐시로 큐를 준다(GET /api/supervisor/queue와 GET /api/notices가 함께 쓴다, ATC-447)
export async function supervisorQueueNow(getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>, now = Date.now()): Promise<SupervisorQueue> {
  if (cache && cache.epoch === queueEpoch() && now - cache.at < CACHE_MS) return cache.view;
  const s = await getSnapshot();
  const view = supervisorQueueView(await collectQueueInput(s, updateStatus, now), now);
  cache = { at: now, epoch: queueEpoch(), view };
  setTodo(view.count); // SUPERVISOR SUMMARY의 todo가 같은 수를 읽는다(ATC-454)
  return view;
}

export function mountSupervisorQueue(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>, events: () => readonly TrafficEvent[] = () => []) {
  eventsOf = events;
  app.get("/api/supervisor/queue", async (c) => c.json(await supervisorQueueNow(getSnapshot, updateStatus)));
}
