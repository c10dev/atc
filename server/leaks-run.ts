import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { type LeakRecord, type OpenLeak, leakItemsOf, leakView, openFromRecords, reconcile } from "./leaks.ts";
import type { Snapshot } from "./model.ts";
import { parseDays } from "./readability-run.ts";
import { collectQueueInput } from "./supervisor-queue-run.ts";
import { supervisorQueueOf } from "./supervisor-queue.ts";
import type { UpdateStatus } from "./update.ts";

// LEAK COUNTER(ATC-363)의 기록과 읽기. 계산은 leaks.ts(순수). leaks.jsonl은 추가만 한다: leak이 열릴 때와 닫힐 때만 한 줄.
export const LEAKS_FILE = () => join(config.stateDir, "leaks.jsonl");
export const TICK_MS = 60_000;

export function readLeaks(file = LEAKS_FILE()): LeakRecord[] {
  if (!existsSync(file)) return [];
  const out: LeakRecord[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l) continue;
    try {
      const r = JSON.parse(l);
      if (r?.v === 1 && (r.ev === "open" || r.ev === "close") && typeof r.id === "string") out.push(r);
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return out;
}

export function appendLeaks(recs: readonly LeakRecord[], file = LEAKS_FILE()): void {
  if (!recs.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function mountLeaks(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>) {
  let open: Map<string, OpenLeak> | null = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const s = await getSnapshot();
      // GitHub를 아직 못 읽었으면 PR 항목이 통째로 빠져 있다: 열지도 닫지도 않는다
      if (s.github.enabled && !s.github.fetchedAt) return;
      const inp = await collectQueueInput(s, updateStatus, now);
      open ??= openFromRecords(readLeaks(), now);
      appendLeaks(reconcile(open, leakItemsOf(supervisorQueueOf(inp, now), inp), now));
    } catch (e) {
      console.warn(`[atc] leaks: ${e instanceof Error ? e.message : e}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 30_000).unref();
  setInterval(() => void tick(), TICK_MS).unref();

  app.get("/api/leaks", (c) => {
    const p = parseDays(c.req.query("days") ?? "7");
    if (!p.ok) return c.json({ error: p.error }, 400);
    try {
      return c.json(leakView(readLeaks(), Date.now(), p.days));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
