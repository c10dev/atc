import { readFileSync, statSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mountAirports } from "./airports.ts";
import { config } from "./config.ts";
import { mountController } from "./controller.ts";
import { mountCrewChange } from "./crew-change.ts";
import { mountCheckride } from "./checkride.ts";
import { mountFleet } from "./fleet.ts";
import { mountLogbook, runLogbook } from "./logbook.ts";
import { diffSnapshots, EventLog, isWarm } from "./events.ts";
import { mountMetrics } from "./metrics.ts";
import { mountNetwork } from "./network.ts";
import { DISPATCH_MS, mountDispatch, runDispatch } from "./proposals.ts";
import { pruneRecords, record, SAMPLE_MS, sampleOf } from "./recorder.ts";
import type { Snapshot } from "./model.ts";
import { mountSchedule } from "./schedule.ts";
import { mountSettings } from "./settings.ts";
import { buildSnapshot } from "./snapshot.ts";
import { entryScript } from "./version.ts";

const TICK_MS = 2_000;

let current: Snapshot | null = null;
let signature = "";
const listeners = new Set<(s: Snapshot) => void>();
const eventLog = new EventLog();
let lastSampleAt = 0;
let lastDispatchAt = 0;

// 지금 내주는 화면 번들. index.html이 바뀌었을 때만 다시 읽는다(재시작 없이 다시 빌드해도 알아챈다).
const DIST = new URL("../web/dist", import.meta.url).pathname;
const startedAt = new Date().toISOString();
let build: string | null = null;
let buildStamp = "";
const versionListeners = new Set<() => void>();

function checkBuild() {
  let stamp = "missing";
  try {
    const st = statSync(`${DIST}/index.html`);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {}
  if (stamp === buildStamp) return;
  buildStamp = stamp;
  let next: string | null = null;
  try {
    next = entryScript(readFileSync(`${DIST}/index.html`, "utf8"));
  } catch {}
  if (next === build) return;
  build = next;
  console.log(`[atc] build: ${build ?? "none"}`);
  for (const l of versionListeners) l();
}
const version = () => ({ build, startedAt });

async function tick() {
  checkBuild();
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
    if (isWarm(next)) runLogbook(next); // 10분마다 머지된 PR을 LOGBOOK에 적는다

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
app.get("/api/version", (c) => c.json(version()));
mountController(app, getSnapshot, eventLog);
mountAirports(app);
mountMetrics(app);
mountDispatch(app, getSnapshot);
mountCrewChange(app);
mountFleet(app, getSnapshot);
mountCheckride(app, getSnapshot);
mountLogbook(app);
mountNetwork(app, getSnapshot);
mountSchedule(app, getSnapshot);
mountSettings(app);

app.get("/api/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = (s: Snapshot) => stream.writeSSE({ event: "snapshot", data: JSON.stringify(s) });
    // 연결(재연결 포함)마다 먼저 번들을 알려 주고, 바뀌면 다시 보낸다
    const sendVersion = () => stream.writeSSE({ event: "version", data: JSON.stringify(version()) });
    const onVersion = () => void sendVersion();
    await sendVersion();
    if (current) await send(current);
    listeners.add(send);
    versionListeners.add(onVersion);
    stream.onAbort(() => {
      listeners.delete(send);
      versionListeners.delete(onVersion);
    });
    while (!stream.aborted) {
      await stream.sleep(25_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  }),
);

// index.html은 늘 다시 확인하게 한다(새로고침·새 탭이 예전 번들을 잡지 않게). 번들 파일은 이름에 해시가 있다.
app.use("/*", serveStatic({ root: DIST, onFound: (path, c) => void (path.endsWith(".html") && c.header("Cache-Control", "no-cache")) }));

pruneRecords();
await tick();
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) =>
  console.log(`[atc] http://localhost:${info.port}  (linear: ${config.linearApiKey ? "on" : "off"})`),
);
