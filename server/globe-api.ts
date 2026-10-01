import type { Hono } from "hono";
import { loadDispatchConfig } from "./dispatch.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import { globeSceneOf } from "./globe.ts";
import { landDecisionOf } from "./land-by.ts";
import { mccLandInfoCached } from "./mcc-run.ts";
import { milestonesNow, progressNow } from "./milestones-run.ts";
import type { Snapshot } from "./model.ts";

// GET /api/globe(ATC-254·260, docs/globe.md 3.8): 지구본의 장면. 읽기만 한다. 스냅샷, fleet.json, 그리고 GET /api/milestones와 같은 OOOI·진행(LOGBOOK과 스냅샷이
// 이미 가진 것)만 읽고 GitHub·Linear를 더 부르지 않으며, 아무것도 쓰지 않는다. SUPERVISOR의 위치는 받지도 않는다(AIRPORT는 허브에 대한 방위와 거리로만 나간다).
// ?home=<AIRPORT 코드>가 홈 AIRPORT. 없거나 모르는 코드면 살아 있는 세션이 가장 많은 AIRPORT.
export function mountGlobe(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/globe", async (c) => {
    const s = await getSnapshot();
    const now = Date.now();
    const views = fleetView(s, loadFleet(), loadDispatchConfig().teamPattern);
    const milestones = milestonesNow(s, now);
    // 누가 착륙시키나(ATC-300): TOWER·SUPERVISOR QUEUE·알림과 같은 landByOf를 캐시된 등급으로만 부른다(GitHub·Linear를 더 부르지 않는다)
    const mcc = mccLandInfoCached(s);
    return c.json(
      globeSceneOf({
        at: new Date(now),
        airports: s.airports,
        sessions: s.sessions,
        aircraft: views.map((a) => ({ registration: a.registration, callsign: a.callsign, base: a.base, flying: a.flying.length > 0 || a.flights.length > 0, retired: Boolean(a.retired) })),
        home: c.req.query("home") ?? null,
        flights: {
          now,
          tickets: s.tickets,
          workspaces: s.workspaces,
          pulls: s.pulls,
          clearances: s.clearances,
          aircraft: views.filter((a) => !a.retired).map((a) => ({ registration: a.registration, callsign: a.callsign, status: a.status, flying: a.flying })),
          milestones: Object.fromEntries(milestones),
          progress: progressNow(s, milestones, now),
          land: (p) => landDecisionOf(p, mcc, s.airports.find((a) => a.repo === p.repo)?.teamsMerge !== false),
        },
      }),
    );
  });
}
