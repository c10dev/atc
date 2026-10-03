import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { readJsonl } from "./mcc.ts";
import { parseDays } from "./readability-run.ts";
import { type TouchInput, touchesView } from "./touches.ts";

// SUPERVISOR TOUCHES(ATC-512)의 읽기. 요청이 올 때 기존 기록 일곱 파일을 읽어 순수 계산(touches.ts)에 넘긴다. 아무것도 쓰지 않는다.
const f = (name: string) => join(config.stateDir, name);

export function readTouchInput(): TouchInput {
  return {
    releases: readJsonl(f("releases.jsonl")),
    relays: readJsonl(f("relays.jsonl")),
    proposals: readJsonl(f("proposals.jsonl")),
    schedule: readJsonl(f("schedule.jsonl")),
    fleetPlan: readJsonl(f("fleet-plan.jsonl")),
    mcc: readJsonl(f("mcc.jsonl")),
    autoland: readJsonl(f("autoland.jsonl")),
  };
}

export function mountTouches(app: Hono): void {
  app.get("/api/touches", (c) => {
    const p = parseDays(c.req.query("days") ?? "14");
    if (!p.ok) return c.json({ error: p.error }, 400);
    try {
      return c.json(touchesView(readTouchInput(), Date.now(), p.days));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
