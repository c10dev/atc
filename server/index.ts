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
import { mountRelay } from "./relay-run.ts";
import { mountLandingReview } from "./landing-review.ts";
import { mccLandInfo, mountMcc, rtsState } from "./mcc-run.ts";
import { mountMilestones, runMilestones } from "./milestones-run.ts";
import { mountUpdate } from "./update-run.ts";
import { mountCrewChange } from "./crew-change.ts";
import { mountCheckride } from "./checkride.ts";
import { mountFleet } from "./fleet.ts";
import { addLogbookFuel, aircraftContexts, mountFuel } from "./fuel-run.ts";
import { fuelWatch } from "./fuel-watch.ts";
import { mountFleetPlan, runFleetPlan } from "./fleet-plan-run.ts";
import { mountFreshStart } from "./fresh-start-run.ts";
import { launchAircraft, MAX_LAUNCHED, mountSessionControl } from "./session-control.ts";
import { mountApplyNow } from "./apply-now-run.ts";
import { mountControlBulk } from "./control-bulk-run.ts";
import { defaultActDeps, mountControlRecycle, runControlRecycle } from "./control-recycle-run.ts";
import { readCursor } from "./controller.ts";
import { loadMcc, mccDeploys, readMccRecords } from "./mcc.ts";
import { mountHumanCheck } from "./human-check-run.ts";
import { mountStandFree, proposalArrived, runStandFree, standFreeCandidates, standFreeTimeliness } from "./standfree-run.ts";
import { arrivalMissingOf, followingNow, mountFollowing } from "./following.ts";
import { foldReports, readReports } from "./arrival-report.ts";
import { readWips, wipView } from "./charter-wip.ts";
import { restartSafetyOf } from "./occ-safe.ts";
import { recordDepartures } from "./departures.ts";
import { loadLogbook, mountLogbook, runLogbook } from "./logbook.ts";
import { diffSnapshots, EventLog, isWarm } from "./events.ts";
import { mountMetrics } from "./metrics.ts";
import { mountNetwork } from "./network.ts";
import { mountGlobe } from "./globe-api.ts";
import { mountRoutes } from "./routes.ts";
import { refreshOverlap } from "./overlap-run.ts";
import { allProposals, DISPATCH_MS, mountDispatch, runDispatch } from "./proposals.ts";
import { pruneRecords, record, SAMPLE_MS, sampleOf } from "./recorder.ts";
import type { Snapshot } from "./model.ts";
import { mountDetail } from "./detail-run.ts";
import { mountIdeas } from "./ideas-run.ts";
import { mountFlightState } from "./flight-state-run.ts";
import { mountFollow } from "./follow-run.ts";
import { mountPrMerge } from "./pr-merge-run.ts";
import { mountSchedule } from "./schedule.ts";
import { mountSettings } from "./settings.ts";
import { mountAccounts } from "./accounts-run.ts";
import { mountSquelchOpens } from "./squelch-opens-run.ts";
import { mountSquelch } from "./squelch-run.ts";
import { mountTick } from "./tick-run.ts";
import { buildSnapshot } from "./snapshot.ts";
import { currentAlerts, runSummary, runSupervisorAlerts, summaryNow } from "./supervisor-alerts-run.ts";
import { mountQrh, runQrh } from "./qrh-run.ts";
import { mountDuty } from "./duty-api.ts";
import { duty, mountDutyRun } from "./duty-run.ts";
import { mountDutyL1 } from "./duty-l1-run.ts";
import { mountSupervisorQueue } from "./supervisor-queue-run.ts";
import { parseTopics, type SupervisorSummary } from "./supervisor-summary.ts";
import { mountRadio, RadioFeed } from "./radio-run.ts";
import { mountReadability, startReadability } from "./readability-run.ts";
import { mountSkillUsage, startSkillUsage } from "./skill-calls-run.ts";
import type { Transmission } from "./radio.ts";
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
const summaryListeners = new Set<(s: SupervisorSummary) => void>(); // SUPERVISOR SUMMARY(ATC-153)
const radioFeed = new RadioFeed(); // RADIO(ATC-170): 듣는 이가 있을 때만 기록을 읽는다
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
    if (isWarm(next)) runQrh(next); // QRH shadow(ATC-288): 서버가 체크리스트를 부를 조건을 처음 본 때만 FLIGHT RECORDER에 한 줄. 보내는 글은 바뀌지 않는다

    // SUPERVISOR alerts(ATC-87): 새로 생기거나 사라진 key를 `alert` 이벤트로. 스냅샷이 안 바뀌어도(RTS 결과 같은 파일 기록) 센다
    const alertEvent = isWarm(next) ? runSupervisorAlerts(next) : null;
    if (alertEvent) for (const l of alertListeners) l(alertEvent);
    // SUPERVISOR SUMMARY(ATC-153): 알림 목록을 센 직후, 내용이 바뀐 때만 `summary` 이벤트로
    const summary = isWarm(next) ? runSummary(next) : null;
    if (summary) for (const l of summaryListeners) l(summary);
    radioFeed.poll();

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
mountRelay(app, getSnapshot); // SUPERVISOR RELAY(ATC-271): 화면에서 AIRCRAFT에게 보내는 글. 만들기는 화면의 클릭뿐(fromThisApp)
mountLandingReview(app, getSnapshot);
mountHumanCheck(app, getSnapshot);
mountAirports(app);
mountMetrics(app);
mountDispatch(app, getSnapshot, (s) => fuelWatch(s), {
  candidates: standFreeCandidates,
  timeliness: () => standFreeTimeliness(),
  arrived: (p, s) => proposalArrived(p, s, addLogbookFuel),
}, {
  // LAUNCH on approve(ATC-129): FLEET LAUNCH와 같은 길. 옵션은 그 AIRCRAFT의 마지막 atc LAUNCH와 같게.
  // ACCOUNT: RESUME은 끊긴 ACCOUNT를 이름으로 댄다. 다른 카드는 이름을 대지 않아 LAUNCH ACCOUNT가 먼저고, 마지막 ACCOUNT는 그다음이다(ATC-239)
  max: MAX_LAUNCHED,
  launch: (s, reg, proposal, resume) => {
    const a = s.absent?.find((x) => x.registration === reg);
    return launchAircraft(s, reg, { permissionMode: a?.permissionMode, lastModel: a?.model ?? null, ...(resume ? { account: a?.account } : { lastAccount: a?.account ?? null }) }, "SUPERVISOR", proposal);
  },
}, (s, now, inFlight) => {
  // ATC-169: 머지됐는데 도착 보고가 없는 FLIGHT와 OCC 재시작 안전 시점(읽기만)
  const arrivalMissing = arrivalMissingOf(followingNow(s, now), foldReports(readReports()), now);
  const wip = wipView(readWips(), now);
  return { arrivalMissing, restartSafety: restartSafetyOf({ inFlight, arrivalMissing, wip, now }) };
});
mountStandFree(app, getSnapshot, addLogbookFuel);
mountCrewChange(app);
mountFleet(app, getSnapshot, (sessions, teamPattern) => aircraftContexts(sessions, teamPattern));
mountFuel(app, getSnapshot, loadLogbook);
mountSessionControl(app, getSnapshot);
mountFleetPlan(app, getSnapshot);
mountFreshStart(app, getSnapshot); // FRESH START(ATC-73): 승인된 ASSIGN을 새 세션의 첫 프롬프트로(SUPERVISOR 클릭만)
mountCheckride(app, getSnapshot);
mountLogbook(app);
mountNetwork(app, getSnapshot);
mountGlobe(app, getSnapshot);
mountRoutes(app, getSnapshot);
mountSchedule(app, getSnapshot, allProposals);
mountPrMerge(app, getSnapshot); // PR MERGE 버튼(DUTY G2): SUPERVISOR 클릭만, user 등급 CLEARED PR만 GitHub에 머지한다
mountFlightState(app); // FLIGHT 상태 버튼(DUTY G3): SUPERVISOR 클릭만 Linear에 쓴다
mountDetail(app, getSnapshot); // FLIGHT·PR drawer(DUTY G1): 읽기 전용, 60초 캐시
mountIdeas(app); // IDEAS 서랍(DUTY G4): atc 저장소 idea 이슈 읽기 전용, 60초 캐시
mountFollowing(app, getSnapshot);
mountFollow(app, getSnapshot); // FOLLOW F1(ATC-276): 따라가는 번들의 줄별 단계(읽기만)와 follow.json 설정(Origin 검사)
mountRadio(app); // RADIO R1(ATC-170): 기록된 교신을 합친 목록(읽기만)
mountReadability(app); // READABILITY R0(ATC-176): 교신 질의 하루 기록(readability.jsonl)과 오늘의 부분 지표
startReadability();
mountSkillUsage(app); // SKILL-CALL READER(ATC-289): Skill·sub-agent 호출 수와 qrh.named → opened(skill-usage.jsonl, 읽기만)
startSkillUsage();
mountVoice(app, currentAlerts); // 음성 콜아웃(ATC-140): WAV만 만든다(소리는 브라우저)
mountMilestones(app, getSnapshot);
mountQrh(app); // QRH shadow(ATC-288): qrh.named 줄을 읽기만 한다
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
// CONTROL RECYCLE(ATC-166): 스위치가 off(기본)면 아무것도 하지 않는다. shadow는 "재시작했을 것"만 FLIGHT RECORDER에 남긴다. 1분에 한 번
const recycleFacts = {
  now: Date.now,
  towerEvents: () => eventLog.since(readCursor("controller")).events.length,
  rtsBusy: async () => {
    const last = rtsState(readMccRecords()).last;
    if (last?.result === "running") return `RTS 진행 중(${last.to.slice(0, 7)})`;
    // GitHub을 못 읽으면(main·CI를 모름) RTS도 시작하지 못하므로 상태를 못 읽은 것은 막지 않는다
    const st = await update.status().catch(() => null);
    if (st && (st.kind === "running" || st.kind === "starting")) return st.why;
    if (st?.kind === "available" && mccDeploys(loadMcc().mode)) return `곧 시작함(${st.why})`;
    return null;
  },
};
const recycleAct = defaultActDeps(() => current?.fuelAccounts);
// LAUNCH ACCOUNT APPLY NOW(ATC-244): 같은 안전 조건·같은 STOP → LAUNCH. 기다리는 APPLY는 RECYCLE 주기에 이어 간다
const applyNow = mountApplyNow(app, getSnapshot, { facts: recycleFacts, act: recycleAct });
mountControlBulk(app, getSnapshot, { facts: recycleFacts, act: defaultActDeps(() => current?.fuelAccounts, "SUPERVISOR") }); // CONTROL SESSIONS 일괄 동작(ATC-255): 미리 보기는 읽기만, 실행은 Origin 검사
setInterval(() => {
  if (!current) return;
  const s = current;
  void runControlRecycle(s, { ...recycleFacts, act: recycleAct }).catch((e) => console.error("[atc] control recycle failed:", e));
  void applyNow.tick();
}, 60_000).unref();
mountControlRecycle(app);
mountSettings(app);
mountAccounts(app, getSnapshot);
mountJudges(app);
mountSquelch(app); // SQUELCH S1(ATC-94): 아직 어떤 hook도 부르지 않고 shadow라 버리지 않는다
mountSquelchOpens(app); // SQUELCH opens-by-field(ATC-297): 어떤 필드가 tick을 열었고 그 tick이 일을 했는지(읽기만)
mountTick(app); // `atcctl tick <역할>`(ATC-297): 브리핑에 할 일이 있는가(읽기만)

mountSupervisorQueue(app, getSnapshot, () => update.status(), () => eventLog.since(null).events); // SUPERVISOR QUEUE(ATC-194, 읽기만)
mountDuty(app, getSnapshot, () => update.status(), (l) => duty().recordDraft(l)); // DUTY L0(ATC-219): brief 읽기와 초안 붙이기(밖으로 나가는 동작 없음)
mountDutyL1(app); // DUTY D7a: STAND 만들기·치우기와 Linear 쓰기(duty.json l1이 켜졌을 때만, Origin 있는 요청 거절)
mountDutyRun(app); // DUTY D2(ATC-220): 글 보내기·중단·NEW SHIFT(Origin 검사)·기록·상태. duty.json enabled가 꺼져 있으면 아무것도 띄우지 않는다
app.get("/api/supervisor-alerts", (c) => c.json({ items: currentAlerts() })); // 지금 있는 알림 key 전체(읽기만)

// 알림 요약(ATC-153, 읽기만): 메뉴 막대·브라우저·atc-app이 같은 숫자를 읽는다. 아직 스냅샷이 없으면 503
app.get("/api/supervisor-summary", (c) => (current ? c.json(summaryNow(current)) : c.json({ error: "snapshot not ready" }, 503)));

// ?topics=snapshot,alert,version,summary,radio,duty: 받을 이벤트를 고른다. 없으면 summary·radio·duty를 뺀 전부(지금까지와 같다). ping은 늘 보낸다. 모르는 이름은 400
app.get("/api/events", (c) => {
  const parsed = parseTopics(c.req.query("topics"));
  if (!parsed.ok) return c.json({ error: `unknown topics: ${parsed.unknown.join(", ")}` }, 400);
  const want = parsed.topics;
  return streamSSE(c, async (stream) => {
    const send = (s: Snapshot) => stream.writeSSE({ event: "snapshot", data: JSON.stringify(s) });
    // 연결(재연결 포함)마다 먼저 번들을 알려 주고, 바뀌면 다시 보낸다
    const sendVersion = () => stream.writeSSE({ event: "version", data: JSON.stringify(version()) });
    const onVersion = () => void sendVersion();
    const sendAlert = (e: AlertEvent) => stream.writeSSE({ event: "alert", data: JSON.stringify(e) });
    const sendSummary = (s: SupervisorSummary) => stream.writeSSE({ event: "summary", data: JSON.stringify(s) });
    if (want.has("version")) await sendVersion();
    if (want.has("snapshot") && current) await send(current);
    if (want.has("alert")) {
      const items = currentAlerts();
      await sendAlert({ raised: items, cleared: [], initial: true, items });
    }
    if (want.has("summary") && current) await sendSummary(summaryNow(current));
    const sendRadio = (txs: Transmission[]) => stream.writeSSE({ event: "radio", data: JSON.stringify({ transmissions: txs }) });
    const unRadio = want.has("radio") ? radioFeed.subscribe(sendRadio) : null;
    // DUTY(ATC-220): 연결하자마자 지금 상태 하나, 그 뒤로 스트림 이벤트(글 조각·도구 줄·상태·사용량). 꺼져 있으면 상태만 오고 프로세스는 만들지 않는다
    const sendDuty = (e: object) => stream.writeSSE({ event: "duty", data: JSON.stringify(e) });
    let unDuty: (() => void) | null = null;
    if (want.has("duty")) {
      await sendDuty({ type: "status", ...duty().status() });
      unDuty = duty().subscribe((e) => void sendDuty(e));
    }
    if (want.has("snapshot")) listeners.add(send);
    if (want.has("alert")) alertListeners.add(sendAlert);
    if (want.has("version")) versionListeners.add(onVersion);
    if (want.has("summary")) summaryListeners.add(sendSummary);
    stream.onAbort(() => {
      listeners.delete(send);
      alertListeners.delete(sendAlert);
      versionListeners.delete(onVersion);
      summaryListeners.delete(sendSummary);
      unRadio?.();
      unDuty?.();
    });
    // 연결하자마자 ping 하나(ATC-210): 초기 이벤트가 없는 스트림(topics=radio)은 첫 ping까지 25초 동안 조용했다. 첫 이벤트를 기다리는 클라이언트(atc-app RadioStream의 onUp)가 바로 알게 한다.
    // 이벤트 이름·데이터·topics는 그대로다. ping은 늘 data가 비어 있고 스냅샷·알림이 아니다
    await stream.writeSSE({ event: "ping", data: "" });
    while (!stream.aborted) {
      await stream.sleep(25_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  });
});

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
