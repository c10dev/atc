import type { Hono } from "hono";
import { misfireView } from "./misfire.ts";
import { allProposals } from "./proposals.ts";
import { parseDays } from "./readability-run.ts";

// GET /api/dispatch/misfire?days=N (ATC-367): 자동 승인 MISFIRE를 날짜별 승인 대비 몫으로. 읽기만 한다(proposals.jsonl).
export function mountMisfire(app: Hono) {
  app.get("/api/dispatch/misfire", (c) => {
    const p = parseDays(c.req.query("days") ?? "7");
    if (!p.ok) return c.json({ error: p.error }, 400);
    return c.json(misfireView(allProposals(), Date.now(), p.days));
  });
}
