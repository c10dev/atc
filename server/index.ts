import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { config } from "./config.ts";
import type { Snapshot } from "./model.ts";
import { buildSnapshot } from "./snapshot.ts";

const TICK_MS = 2_000;

let current: Snapshot | null = null;
let signature = "";
const listeners = new Set<(s: Snapshot) => void>();

async function tick() {
  try {
    const next = await buildSnapshot();
    const sig = JSON.stringify({ ...next, at: null });
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

app.get("/api/snapshot", async (c) => c.json(current ?? (current = await buildSnapshot())));

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

await tick();
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) =>
  console.log(`[atc] http://localhost:${info.port}  (linear: ${config.linearApiKey ? "on" : "off"})`),
);
