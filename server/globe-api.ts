import type { Hono } from "hono";
import { loadDispatchConfig } from "./dispatch.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import { globeSceneOf } from "./globe.ts";
import type { Snapshot } from "./model.ts";

// GET /api/globe(ATC-254, docs/globe.md 3.8): 지구본의 장면. 읽기만 한다. 스냅샷과 fleet.json만 읽고 GitHub·Linear를 부르지 않으며,
// 아무것도 쓰지 않는다. SUPERVISOR의 위치는 받지도 않는다(AIRPORT는 허브에 대한 방위와 거리로만 나간다).
// ?home=<AIRPORT 코드>가 홈 AIRPORT. 없거나 모르는 코드면 살아 있는 세션이 가장 많은 AIRPORT.
export function mountGlobe(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/globe", async (c) => {
    const s = await getSnapshot();
    const views = fleetView(s, loadFleet(), loadDispatchConfig().teamPattern);
    return c.json(
      globeSceneOf({
        at: new Date(),
        airports: s.airports,
        sessions: s.sessions,
        aircraft: views.map((a) => ({ registration: a.registration, callsign: a.callsign, base: a.base, flying: a.flying.length > 0 || a.flights.length > 0, retired: Boolean(a.retired) })),
        home: c.req.query("home") ?? null,
      }),
    );
  });
}
