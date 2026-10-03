import type { Hono } from "hono";
import type { Snapshot } from "./model.ts";
import { noticesOf } from "./notices.ts";
import { releaseReadyNow } from "./release-run.ts";
import { currentAlerts } from "./supervisor-alerts-run.ts";
import { supervisorQueueNow } from "./supervisor-queue-run.ts";
import type { UpdateStatus } from "./update.ts";

// GET /api/notices(ATC-447, 읽기만): 사이드바 머리의 알림 세 개. 계산은 notices.ts(순수). 스냅샷이 아직 없으면 503
export function mountNotices(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>) {
  app.get("/api/notices", async (c) => {
    const s = await getSnapshot();
    if (!s) return c.json({ error: "snapshot not ready" }, 503);
    const now = Date.now();
    const queue = await supervisorQueueNow(async () => s, updateStatus, now);
    return c.json(noticesOf({ now, ready: releaseReadyNow(s), tickets: s.tickets, pulls: s.pulls ?? [], queue: queue.items, alerts: currentAlerts() }));
  });
}
