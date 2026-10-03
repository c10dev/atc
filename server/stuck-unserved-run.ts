import type { Hono } from "hono";
import { loadDispatchConfig } from "./dispatch.ts";
import { readRecords } from "./recorder.ts";
import { stuckUnservedCountOf } from "./stuck-unserved.ts";

// 막힘 알림 새 문구(ATC-522)의 읽기. 스위치는 dispatch.json의 stuckUnserved이고 설정 창에서만 바꾼다(atcctl 명령 없음, K3)
export function mountStuckUnserved(app: Hono) {
  app.get("/api/stuck-unserved", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const now = Date.now();
    return c.json({ switch: loadDispatchConfig().stuckUnserved, days, alerts: stuckUnservedCountOf(readRecords(now - days * 86_400_000), now, days) });
  });
}
