import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mountAirports } from "./airports.ts";
import { config } from "./config.ts";
import { mountController } from "./controller.ts";
import { mountFleet } from "./fleet.ts";
import { diffSnapshots, EventLog, isWarm } from "./events.ts";
import { mountMetrics } from "./metrics.ts";
import { DISPATCH_MS, mountDispatch, runDispatch } from "./proposals.ts";
import { pruneRecords, record, SAMPLE_MS, sampleOf } from "./recorder.ts";
import type { Snapshot } from "./model.ts";
import { mountSettings } from "./settings.ts";
import { buildSnapshot } from "./snapshot.ts";

const TICK_MS = 2_000;

let current: Snapshot | null = null;
let signature = "";
const listeners = new Set<(s: Snapshot) => void>();
const eventLog = new EventLog();
let lastSampleAt = 0;
let lastDispatchAt = 0;

async function tick() {
  try {
    const next = await buildSnapshot();
    const sig = JSON.stringify({ ...next, at: null });
    for (const event of eventLog.push(diffSnapshots(current, next))) {
      record({ t: event.at, kind: "event", epoch: eventLog.epoch, event });
    }
    if (isWarm(next) && Date.now() - lastSampleAt >= SAMPLE_MS) {
      lastSampleAt = Date.now();
      record({ t: next.at, kind: "sample", ...sampleOf(next) });
    }
    if (isWarm(next) && Date.now() - lastDispatchAt >= DISPATCH_MS) {
      lastDispatchAt = Date.now();
      runDispatch(next);
    }
    current = next;
    if (sig !== signature) {
      signature = sig;
      for (const l of listeners) l(next);
    }
  } catch (e) {
    console.error("[atc] snapshot failed:", e);
  }
  setTimeout(tick, TICK_MS);
}

const app = new Hono();

const getSnapshot = async () => current ?? (current = await buildSnapshot());

app.get("/api/snapshot", async (c) => c.json(await getSnapshot()));
mountController(app, getSnapshot, eventLog);
mountAirports(app);
mountMetrics(app);
mountDispatch(app, getSnapshot);
mountFleet(app, getSnapshot);
mountSettings(app);

app.get("/api/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = (s: Snapshot) => stream.writeSSE({ event: "snapshot", data: JSON.stringify(s) });
    if (current) await send(current);
    listeners.add(send);
    stream.onAbort(() => void listeners.delete(send));
    while (!stream.aborted) {
      await stream.sleep(25_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  }),
);

app.use("/*", serveStatic({ root: new URL("../web/dist", import.meta.url).pathname }));

pruneRecords();
await tick();
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) =>
  console.log(`[atc] http://localhost:${info.port}  (linear: ${config.linearApiKey ? "on" : "off"})`),
);
