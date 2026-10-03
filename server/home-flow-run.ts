// GET /api/flow(ATC-499, docs/home-flow.md 3.6): HOME 흐름판의 판정·칸·주체·묶은 할 일. 읽기만 한다.
// 계산은 home-flow.ts(순수). 여기는 이미 있는 읽기 길(FOLLOW 입력, 스냅샷, 캐시된 MCC 등급, LOGBOOK, SUPERVISOR QUEUE, SINCE LAST LOOK)에서 모으기만 한다:
// GitHub·Linear를 따로 부르지 않고 상태 폴더에 쓰지 않는다. 기준(착륙 없음 분)은 입력이다 — 지금은 floor 30분이고 AIRPORT별 p90은 H2(ATC-501)가 넣는다.
import type { Hono } from "hono";
import { candidateTeamsOf, isCandidateTicket, loadDispatchConfig } from "./dispatch.ts";
import { followInputOf } from "./follow-run.ts";
import { followRowOf } from "./follow.ts";
import { type FlowInput, type FlowPullIn, flowViewOf } from "./home-flow.ts";
import { landDecisionOf } from "./land-by.ts";
import { loadLogbook } from "./logbook.ts";
import { mccLandInfoCached } from "./mcc-run.ts";
import { type Snapshot, parentKeysOf } from "./model.ts";
import { sinceLookNow } from "./since-look-run.ts";
import { supervisorQueueNow } from "./supervisor-queue-run.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";
import type { UpdateStatus } from "./update.ts";

// 스냅샷과 기록에서 순수 함수의 입력을 모은다(읽기만)
export async function flowInputNow(s: Snapshot, updateStatus: () => Promise<UpdateStatus | null>, alerts: () => readonly SupervisorAlert[], now: number): Promise<FlowInput> {
  const cfg = loadDispatchConfig();
  const teams = candidateTeamsOf(cfg);
  const follow = followInputOf(s, now);
  const parents = parentKeysOf(s.tickets);
  // 후보 팀의 열린 FLIGHT: 시작 전(Todo)과 시작한 것. Backlog·끝난 것·상위 이슈는 보드에 없다
  const rows = s.tickets
    .filter((t) => (t.stateType === "unstarted" || t.stateType === "started") && isCandidateTicket(t, teams) && !parents.has(t.key))
    .map((t) => ({ row: followRowOf(t.key, follow), airport: t.airport ?? null, blockedBy: t.blockedBy }));
  // 캐시된 MCC 등급만 읽는다(GitHub를 부르지 않는다). 등급을 모르면 landBy가 supervisor로 떨어진다(TOWER와 같은 규칙)
  const mcc = mccLandInfoCached(s);
  const pulls: FlowPullIn[] = (s.pulls ?? []).filter((p) => !p.draft || p.ticketKey).map((p) => ({ ...p, landBy: landDecisionOf(p, mcc, s.airports.find((a) => a.repo === p.repo)?.teamsMerge !== false).by }));
  const airportOfRepo = (repo: string) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  const landings = loadLogbook().flatMap((e) => (e.pr && e.airport && !e.reverted ? [{ airport: e.airport, at: e.arrivedAt }] : []));
  const stops = (s.atfm?.groundStops ?? []).filter((g) => g.kind === "stop" && g.enforced && g.land !== false).map((g) => ({ airport: g.airport, text: g.text }));
  const mainRed = (s.atfm?.mains ?? []).filter((m) => m.state === "failure").flatMap((m) => {
    const c = airportOfRepo(m.repo);
    return c ? [c] : [];
  });
  const queue = (await supervisorQueueNow(async () => s, updateStatus, now).catch(() => null))?.items ?? [];
  const look = sinceLookNow(s, alerts(), now, false);
  return {
    now,
    airports: s.airports.map((a) => ({ code: a.code, name: a.name })),
    rows,
    pulls,
    landings,
    stops,
    mainRed,
    queue,
    sinceLook: { since: look.since, released: look.released.length, landed: look.landed.length, deployed: look.deployed.length },
  };
}

export function mountHomeFlow(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>, alerts: () => readonly SupervisorAlert[]) {
  app.get("/api/flow", async (c) => {
    const s = await getSnapshot();
    if (!s) return c.json({ error: "snapshot not ready" }, 503);
    return c.json(flowViewOf(await flowInputNow(s, updateStatus, alerts, Date.now())));
  });
}
