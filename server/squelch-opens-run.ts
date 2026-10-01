import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { parseDays } from "./readability-run.ts";
import { forEachLine, readSessionCalls } from "./skill-calls-run.ts";
import type { SessionCalls } from "./skill-calls.ts";
import { type Decision, decisionOf, opensTable, TICK_WINDOW_MS } from "./squelch-opens.ts";

// GET /api/squelch/opens?days=N (ATC-297): 역할마다 어떤 필드가 tick을 열었고 그 tick이 일을 했는지, v2의 그림자 결과(wrongSkips)와 함께.
// squelch.jsonl(우리 기록)과 관제 세션 대화 기록의 도구 호출 시각(이름 없이)을 읽기만 한다. 값은 어디에도 없다.

const DAY_MS = 86_400_000;
export interface OpensDeps {
  now: () => number;
  file: () => string;
  sessions: (sinceMs: number) => SessionCalls[];
}
export const realDeps = (): OpensDeps => ({
  now: Date.now,
  file: () => join(config.stateDir, "squelch.jsonl"),
  sessions: (sinceMs) => readSessionCalls(sinceMs, undefined, undefined, undefined, { uses: true }),
});

// 줄 단위로 흘려 읽는다. 창 밖의 줄은 버린다
export function readDecisions(file: string, sinceMs: number): Decision[] {
  const out: Decision[] = [];
  if (!existsSync(file)) return out;
  forEachLine(file, (l) => {
    if (!l) return;
    const d = decisionOf(l);
    if (d && Date.parse(d.t) >= sinceMs) out.push(d);
  });
  return out;
}

export function opensView(days: number, deps: OpensDeps = realDeps()) {
  const now = deps.now();
  const since = now - days * DAY_MS;
  const decisions = readDecisions(deps.file(), since);
  const sessions = deps.sessions(since - TICK_WINDOW_MS);
  const usesByRole = new Map<string, number[]>();
  for (const s of sessions) {
    if (!s.role || !s.uses) continue;
    const l = usesByRole.get(s.role) ?? [];
    for (const u of s.uses) l.push(Date.parse(u));
    usesByRole.set(s.role, l);
  }
  for (const l of usesByRole.values()) l.sort((a, b) => a - b);
  return { at: new Date(now).toISOString(), days, since: new Date(since).toISOString(), roles: opensTable(decisions, (role) => usesByRole.get(role) ?? null, now) };
}

export function mountSquelchOpens(app: Hono, deps: OpensDeps = realDeps()) {
  app.get("/api/squelch/opens", (c) => {
    const p = parseDays(c.req.query("days"));
    if (!p.ok) return c.json({ error: p.error }, 400);
    try {
      return c.json(opensView(p.days, deps));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
