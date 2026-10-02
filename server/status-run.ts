import type { Hono } from "hono";
import { followNow } from "./follow-run.ts";
import { readMccRecords } from "./mcc.ts";
import { rtsState } from "./mcc-run.ts";
import { milestonesNow } from "./milestones-run.ts";
import type { Snapshot } from "./model.ts";
import { sinceLookNow } from "./since-look-run.ts";
import { statusOf } from "./status.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";

// GET /api/status[?flight=ATC-n | ?topic=글](ATC-384, 읽기만): 현재 상태와 FLIGHT 진행을 한 번에. 계산은 status.ts(순수).
// 마지막 본 시각(SINCE LAST LOOK)은 읽기만 하고 옮기지 않는다. 스냅샷이 아직 없으면 503
export function mountStatus(app: Hono, getSnapshot: () => Promise<Snapshot>, alerts: () => readonly SupervisorAlert[]) {
  app.get("/api/status", async (c) => {
    const s = await getSnapshot();
    if (!s) return c.json({ error: "snapshot not ready" }, 503);
    const now = Date.now();
    const items = alerts();
    const rts = rtsState(readMccRecords()).last;
    return c.json(
      statusOf({
        at: new Date(now).toISOString(),
        sinceLook: sinceLookNow(s, items, now),
        rows: followNow(s, now).bundles.flatMap((b) => b.rows),
        alerts: items,
        rts: rts ? { result: rts.result, at: rts.at, from: rts.from, to: rts.to } : null,
        tickets: s.tickets,
        pulls: s.pulls ?? [],
        milestones: milestonesNow(s, now),
        query: { flight: c.req.query("flight"), topic: c.req.query("topic") },
      }),
    );
  });
}
