import type { Hono } from "hono";
import { type CallCount, callCountsOf, type LinearCallLine, loadRetries, noteLinesOf } from "./linear-call.ts";
import { parseDays } from "./readability-run.ts";
import { readRecords, record } from "./recorder.ts";

// LINEAR CALL의 읽기 길(ATC-561). 쓰기는 없다: atcctl이 보낸 시도 기록을 FLIGHT RECORDER에 한 줄씩 옮기는 note뿐(값은 모두 enum 검사를 거친다).
const DAY = 86_400_000;

export interface CallsData {
  retries: number;
  days: number;
  counts: CallCount[]; // 새 날부터
  total: { failedAttempts: number; recovered: number; gaveUp: number };
}
export function callsData(days = 7, now = Date.now(), lines: readonly LinearCallLine[] = readRecords(now - days * DAY).flatMap((r) => (r.kind === "linear-call" ? [r] : [])), retries = loadRetries()): CallsData {
  const counts = callCountsOf(lines, now - days * DAY, now + 1);
  return { retries, days, counts, total: counts.reduce((a, c) => ({ failedAttempts: a.failedAttempts + c.failedAttempts, recovered: a.recovered + c.recovered, gaveUp: a.gaveUp + c.gaveUp }), { failedAttempts: 0, recovered: 0, gaveUp: 0 }) };
}

export function mountLinearCalls(app: Hono) {
  app.get("/api/linear-calls", (c) => {
    const p = parseDays(c.req.query("days"));
    if (!p.ok) return c.json({ error: p.error }, 400);
    return c.json(callsData(p.days));
  });
  app.post("/api/linear-calls/note", async (c) => {
    // atcctl은 Origin을 보내지 않는다. 브라우저 쪽 요청(Origin이 있다)은 받지 않는다
    if (c.req.header("origin")) return c.json({ error: "atcctl만 보낼 수 있음" }, 403);
    const body = await c.req.json().catch(() => null);
    const lines = noteLinesOf(body);
    for (const l of lines) record(l);
    return c.json({ recorded: lines.length });
  });
}
