import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mountAirports } from "./airports.ts";
import { mountAtfm, runAtfm } from "./atfm-run.ts";
import { mountAutoland, runAutoland } from "./autoland-run.ts";
import { mountJudges, runJudges } from "./judges/run.ts";
import { config } from "./config.ts";
import { mountController } from "./controller.ts";
import { mountLandingReview } from "./landing-review.ts";
import { mccLandInfo, mountMcc } from "./mcc-run.ts";
import { mountMilestones, runMilestones } from "./milestones-run.ts";
import { mountUpdate } from "./update-run.ts";
import { mountCrewChange } from "./crew-change.ts";
import { mountCheckride } from "./checkride.ts";
import { mountFleet } from "./fleet.ts";
import { addLogbookFuel, aircraftContexts, mountFuel } from "./fuel-run.ts";
import { fuelWatch } from "./fuel-watch.ts";
import { mountFleetPlan, runFleetPlan } from "./fleet-plan-run.ts";
import { launchAircraft, MAX_LAUNCHED, mountSessionControl } from "./session-control.ts";
import { mountHumanCheck } from "./human-check-run.ts";
import { mountStandFree, proposalArrived, runStandFree, standFreeCandidates, standFreeTimeliness } from "./standfree-run.ts";
import { mountFollowing } from "./following.ts";
import { recordDepartures } from "./departures.ts";
import { loadLogbook, mountLogbook, runLogbook } from "./logbook.ts";
import { diffSnapshots, EventLog, isWarm } from "./events.ts";
import { mountMetrics } from "./metrics.ts";
import { mountNetwork } from "./network.ts";
import { mountRoutes } from "./routes.ts";
import { refreshOverlap } from "./overlap-run.ts";
import { allProposals, DISPATCH_MS, mountDispatch, runDispatch } from "./proposals.ts";
import { pruneRecords, record, SAMPLE_MS, sampleOf } from "./recorder.ts";
import type { Snapshot } from "./model.ts";
import { mountSchedule } from "./schedule.ts";
import { mountSettings } from "./settings.ts";
import { mountSquelch } from "./squelch-run.ts";
import { buildSnapshot } from "./snapshot.ts";
import { currentAlerts, runSupervisorAlerts } from "./supervisor-alerts-run.ts";
import { mountVoice } from "./voice-run.ts";
import type { AlertEvent } from "./supervisor-alerts.ts";
import { entryScript } from "./version.ts";
import { join } from "node:path";
import { githubStartupWarning, githubSwitch } from "./github-switch.ts";

const TICK_MS = 2_000;

let current: Snapshot | null = null;
let signature = "";
const listeners = new Set<(s: Snapshot) => void>();
const alertListeners = new Set<(e: AlertEvent) => void>(); // SUPERVISOR alerts(ATC-87)
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
// 서비스가 시작한 커밋(MCC RETURN TO SERVICE가 비교한다, docs/mcc.md). git이 없으면 null
const head = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 5000 }).trim() || null;
  } catch {
    return null;
  }
})();
const version = () => ({ build, startedAt, head });

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
      void refreshOverlap(next); // 파일 겹침(ATC-71): 이번 주기에 읽은 것은 다음 계획부터 쓴다
      runDispatch(next);
      runFleetPlan(next); // FLEET PLAN(docs/fleet.md 8.6): 같은 주기에 그림자 제안. claude agents를 읽어 기다리지 않는다
    }
    if (isWarm(next)) recordDepartures(next); // FLIGHT의 첫 STAND·claim과 HANDOFF를 착수 기록에(바뀔 때만). 첫 번은 기준선
    if (isWarm(next)) runLogbook(next, addLogbookFuel); // 10분마다 머지된 PR을 LOGBOOK에 적는다
    if (isWarm(next)) runMilestones(next); // OOOI(ATC-123): 처음 본 이정표를 FLIGHT RECORDER에 한 번(1분에 한 번, 이미 있는 기록만 읽는다)
    if (isWarm(next)) runStandFree(next); // 5분마다 STAND 없는 FLIGHT의 ARRIVED 후보(ATC-72). ARRIVED는 OCC가 확인해 적는다
    if (isWarm(next)) runAtfm(next); // 출발 중지 시작·끝, 1분마다 ATFM 데이터와 그림자 판정(docs/atfm.md)
    if (isWarm(next)) runAutoland(next); // AUTOLAND(ATC-34): GitHub을 새로 읽을 때마다 갱신·머지 한 주기(스위치가 off면 GROUND STOP만 본다)
    if (isWarm(next)) runJudges(next); // 판정 계열(ATC-36): 스위치가 off가 아닐 때만 1분에 한 번, CLASSIFY 초안 몇 건

    // SUPERVISOR alerts(ATC-87): 새로 생기거나 사라진 key를 `alert` 이벤트로. 스냅샷이 안 바뀌어도(RTS 결과 같은 파일 기록) 센다
    const alertEvent = isWarm(next) ? runSupervisorAlerts(next) : null;
    if (alertEvent) for (const l of alertListeners) l(alertEvent);

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
mountController(app, getSnapshot, eventLog, (s) => fuelWatch(s), mccLandInfo);
mountLandingReview(app, getSnapshot);
mountHumanCheck(app, getSnapshot);
mountAirports(app);
mountMetrics(app);
mountDispatch(app, getSnapshot, (s) => fuelWatch(s), {
  candidates: standFreeCandidates,
  timeliness: () => standFreeTimeliness(),
  arrived: (p, s) => proposalArrived(p, s, addLogbookFuel),
}, {
  // LAUNCH on approve(ATC-129): FLEET LAUNCH와 같은 길. 옵션은 그 AIRCRAFT의 마지막 atc LAUNCH와 같게
  max: MAX_LAUNCHED,
  launch: (s, reg, proposal) => {
    const a = s.absent?.find((x) => x.registration === reg);
    return launchAircraft(s, reg, { permissionMode: a?.permissionMode, model: a?.model }, "SUPERVISOR", proposal);
  },
});
mountStandFree(app, getSnapshot, addLogbookFuel);
mountCrewChange(app);
mountFleet(app, getSnapshot, (sessions, teamPattern) => aircraftContexts(sessions, teamPattern));
mountFuel(app, getSnapshot, loadLogbook);
mountSessionControl(app, getSnapshot);
mountFleetPlan(app, getSnapshot);
mountCheckride(app, getSnapshot);
mountLogbook(app);
mountNetwork(app, getSnapshot);
mountRoutes(app, getSnapshot);
mountSchedule(app, getSnapshot, allProposals);
mountFollowing(app, getSnapshot);
mountVoice(app, currentAlerts); // 음성 콜아웃(ATC-140): WAV만 만든다(소리는 브라우저)
mountMilestones(app, getSnapshot);
mountAtfm(app, getSnapshot);
mountAutoland(app, getSnapshot);
mountMcc(app, getSnapshot, () => head);
const update = mountUpdate(app, getSnapshot, () => head); // UPDATE bar(ATC-82)
// 자동 RTS(ATC-84): mcc 모드가 rts·land+rts일 때만 일한다. 그 밖의 모드나 시험 서버는 아무것도 하지 않는다
setInterval(() => {
  update
    .pass()
    .then((r) => r.started && console.log(`[atc] auto RTS started: ${r.why}`))
    .catch(() => {});
}, 30_000).unref();
mountSettings(app);
mountJudges(app);
mountSquelch(app); // SQUELCH S1(ATC-94): 아직 어떤 hook도 부르지 않고 shadow라 버리지 않는다

app.get("/api/supervisor-alerts", (c) => c.json({ items: currentAlerts() })); // 지금 있는 알림 key 전체(읽기만)

app.get("/api/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = (s: Snapshot) => stream.writeSSE({ event: "snapshot", data: JSON.stringify(s) });
    // 연결(재연결 포함)마다 먼저 번들을 알려 주고, 바뀌면 다시 보낸다
    const sendVersion = () => stream.writeSSE({ event: "version", data: JSON.stringify(version()) });
    const onVersion = () => void sendVersion();
    const sendAlert = (e: AlertEvent) => stream.writeSSE({ event: "alert", data: JSON.stringify(e) });
    await sendVersion();
    if (current) await send(current);
    const items = currentAlerts();
    await sendAlert({ raised: items, cleared: [], initial: true, items });
    listeners.add(send);
    alertListeners.add(sendAlert);
    versionListeners.add(onVersion);
    stream.onAbort(() => {
      listeners.delete(send);
      alertListeners.delete(sendAlert);
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
// 시험 서버가 SUPERVISOR의 토큰으로 GitHub를 폴링하면 시작할 때 한 줄 경고한다(ATC-161)
const ghWarn = githubStartupWarning({ enabled: githubSwitch().enabled, stateDir: config.stateDir, prodStateDir: join(config.home, ".local/state/atc") });
if (ghWarn) console.warn(ghWarn);
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) =>
  console.log(`[atc] http://localhost:${info.port}  (linear: ${config.linearApiKey ? "on" : "off"}) pid ${process.pid} ppid ${process.ppid}`),
);
// 누가 껐는지 다음에 읽을 수 있게(ATC-134): 신호를 받으면 로그를 남기고 신호 관례대로(128+번호) 끝낸다. 보낸 쪽은 Node가 알 수 없다
for (const [sig, code] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]] as const) {
  process.on(sig, () => {
    console.log(`[atc] ${sig} received (pid ${process.pid}, port ${config.port}, up ${Math.round(process.uptime())}s) — exiting`);
    process.exit(code);
  });
}
