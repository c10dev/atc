import type { Hono } from "hono";
import { CONTROL_ROLES, type ControlData, type ControlSession, type ControlSummary, controlDataOf, type DayRow, dayRows, summarize } from "./control-share.ts";
import { scanFuel } from "./fuel-run.ts";
import { tokenSum } from "./fuel.ts";
import { parseDays } from "./readability-run.ts";
import { readSessionCalls } from "./skill-calls-run.ts";

// GET /api/control-share?days=N (ATC-551): 날마다·역할마다 관제 몫과 일을 한 관제 turn 하나의 토큰. 대화 기록의 토큰 수와 시각만 읽는다(FUEL 읽기와 ATC-289 읽기, 새로 나가는 데이터 없음).

const DAY_MS = 86_400_000;
export const dayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

// [fromMs, toMs)의 날별 표. 읽기만 한다
export function readControlRows(fromMs: number, toMs: number): DayRow[] {
  const scan = scanFuel(fromMs, []);
  const tokens = [...scan.records.values()].map((r) => ({ session: r.session, t: r.t, tokens: tokenSum(r) }));
  const sessions: ControlSession[] = readSessionCalls(fromMs, undefined, undefined, undefined, { uses: true })
    .filter((s) => s.role)
    .map((s) => ({ session: s.session, role: s.role!, turns: s.turns.map((t) => Date.parse(t)), uses: (s.uses ?? []).map((t) => Date.parse(t)) }));
  return dayRows(tokens, sessions, fromMs, toMs);
}

// effect-check가 쓰는 꼴: 창 앞뒤를 덮는 만큼 읽는다
export const controlDataSince = (nowMs: number, days: number): ControlData => controlDataOf(readControlRows(dayStart(nowMs) - days * DAY_MS, nowMs + 1));

export interface ControlView {
  at: string;
  days: number;
  rows: DayRow[];
  total: Record<string, ControlSummary>; // "all"(모든 관제)와 역할마다
}
export function controlView(days: number, now = Date.now(), read: (from: number, to: number) => DayRow[] = readControlRows): ControlView {
  const rows = read(dayStart(now) - (days - 1) * DAY_MS, now + 1);
  const total: Record<string, ControlSummary> = { all: summarize(rows) };
  for (const r of CONTROL_ROLES) total[r] = summarize(rows, r);
  return { at: new Date(now).toISOString(), days, rows, total };
}

export function mountControlShare(app: Hono) {
  app.get("/api/control-share", (c) => {
    const p = parseDays(c.req.query("days"));
    if (!p.ok) return c.json({ error: p.error }, 400);
    try {
      return c.json(controlView(p.days));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
