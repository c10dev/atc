import type { Hono } from "hono";
import { loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";
import { pendingAircraftOf, type PolicyView, readDenials, summarizeDenials } from "./policy-hook.ts";
import { readRecords } from "./recorder.ts";

// GET /api/policy(ATC-369, 읽기만): AIRCRAFT PENDING 수, 지난 24시간의 policy hook 거절(class별), STALE STOP 결과.
export function policyViewOf(s: Snapshot, now = Date.now()): PolicyView {
  const cfg = loadDispatchConfig();
  const stops = readRecords(now - 86_400_000).flatMap((r) => (r.kind === "policy" && r.op === "stale-stop" ? [r] : []));
  const aircraft = pendingAircraftOf(s.sessions, cfg.teamPattern);
  return {
    pending: { count: aircraft.length, aircraft },
    denials: summarizeDenials(readDenials(), now),
    staleStop: { mode: cfg.staleStop, stopped24h: stops.filter((r) => r.ok).length, failed24h: stops.filter((r) => !r.ok).length },
  };
}

export function mountPolicy(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/policy", async (c) => c.json(policyViewOf(await getSnapshot())));
}
