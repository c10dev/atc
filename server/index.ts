import { mountLanes } from "./codex-lane-run.ts";
import { supervisorGate, verdictFor } from "./supervisor-auth.ts";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { routePath } from "hono/route";
import { streamSSE } from "hono/streaming";
import { mountAirports } from "./airports.ts";
import { mountAtfm } from "./atfm-run.ts";
import { mountAutoland } from "./autoland-run.ts";
import { mountJudges } from "./judges/run.ts";
import { config } from "./config.ts";
import { mountController } from "./controller.ts";
import { mountRelay } from "./relay-run.ts";
import { mountDecisionCards } from "./decision-card-run.ts";
import { mountLandingReview } from "./landing-review.ts";
import { mccLandInfo, mountMcc, rtsState } from "./mcc-run.ts";
import { mountMilestones } from "./milestones-run.ts";
import { mountUpdate } from "./update-run.ts";
import { mountCrewChange } from "./crew-change.ts";
import { mountCheckride } from "./checkride.ts";
import { mountFleet } from "./fleet.ts";
import { addLogbookFuel, aircraftContexts, mountFuel } from "./fuel-run.ts";
import { fuelWatch } from "./fuel-watch.ts";
import { mountFleetPlan } from "./fleet-plan-run.ts";
import { mountFreshStart } from "./fresh-start-run.ts";
import { launchForCard, MAX_LAUNCHED, mountSessionControl } from "./session-control.ts";
import { createJobRunner, jobs, provideService, serviceOf } from "./job-registry.ts";
import { mountApplyNow } from "./apply-now-run.ts";
import { mountControlBulk } from "./control-bulk-run.ts";
import { defaultActDeps, mountControlRecycle } from "./control-recycle-run.ts";
import { readCursor } from "./controller.ts";
import { loadMcc, mccDeploys, readMccRecords } from "./mcc.ts";
import { mountHumanCheck } from "./human-check-run.ts";
import { mountStandFree, proposalArrived, standFreeCandidates, standFreeTimeliness } from "./standfree-run.ts";
import { arrivalMissingOf, followingNow, mountFollowing } from "./following.ts";
import { foldReports, readReports } from "./arrival-report.ts";
import { readWips, wipView } from "./charter-wip.ts";
import { restartSafetyOf } from "./occ-safe.ts";
import { loadLogbook, mountLogbook } from "./logbook.ts";
import { diffSnapshots, EventLog, isWarm } from "./events.ts";
import { mountMetrics } from "./metrics.ts";
import { mountNetwork } from "./network-run.ts";
import { mountGlobe } from "./globe-api.ts";
import { loadRoutes } from "./routes-load.ts";
import { mountRoutes } from "./routes-run.ts";
import { allProposals, mountDispatch } from "./proposals.ts";
import { mountAutonomyAuto } from "./autonomy-auto-run.ts";
import { pruneRecords, record } from "./recorder.ts";
import type { Snapshot } from "./model.ts";
import { mountDetail } from "./detail-run.ts";
import { mountIdeas } from "./ideas-run.ts";
import { arrivedOpenOf } from "./arrived-open.ts";
import { defaultStateDeps, mountFlightState } from "./flight-state-run.ts";
import { mountFollow } from "./follow-run.ts";
import { mountPrMerge } from "./pr-merge-run.ts";
import { mountSchedule } from "./schedule.ts";
import { mountSettings } from "./settings.ts";
import { mountMigrate } from "./migrate-api.ts";
import { mountPolicy } from "./policy-run.ts";
import { mountAccounts } from "./accounts-run.ts";
import { mountControlShare } from "./control-share-run.ts";
import { mountJobLiveness } from "./job-liveness-run.ts";
import { mountSquelchOpens } from "./squelch-opens-run.ts";
import { migrateOnce, mountSquelch } from "./squelch-run.ts";
import { mountSquelchSwitch } from "./squelch-switch-run.ts";
import { mountTick } from "./tick-run.ts";
import { buildSnapshot } from "./snapshot.ts";
import { mountHomeFlow } from "./home-flow-run.ts";
import { mountSinceLook } from "./since-look-run.ts";
import { mountStatus } from "./status-run.ts";
import { currentAlerts, endsNow, runSummary, runSupervisorAlerts, summaryNow } from "./supervisor-alerts-run.ts";
import { mountQrh } from "./qrh-run.ts";
import { mountDuty } from "./duty-api.ts";
import { mountReleases, releaseFromChat } from "./release-run.ts";
import { applyWrite } from "./linear-overlay.ts";
import { onLocalState } from "./sources/linear.ts";
import { duty, mountDutyRun } from "./duty-run.ts";
import { chatReleaseHooks, setSnapshotPeek } from "./chat-release-run.ts";
import { defaultL1Deps, mountDutyL1 } from "./duty-l1-run.ts";
import { mountDutyReview, reviewHooks } from "./duty-review-run.ts";
import { duplicateHooks } from "./title-dup-run.ts";
import { mountLeaks } from "./leaks-run.ts";
import { mountTouches } from "./touches-run.ts";
import { mountEffectCheck } from "./effect-check-run.ts";
import { mountMisfire } from "./misfire-run.ts";
import { mountOrphanFlight } from "./orphan-flight-run.ts";
import { mountClearanceMoot } from "./clearance-moot-run.ts";
import { mountEventLoopLag } from "./event-loop-lag-run.ts";
import { mountRedMain, runRedMain } from "./red-main-run.ts";
import { mountJobTiming } from "./job-timing-run.ts";
import { jobTimer, timed } from "./job-timing.ts";
import { mountLandingGap } from "./landing-gap-run.ts";
import { mountStuckUnserved } from "./stuck-unserved-run.ts";
import { mountLinearCalls } from "./linear-call-run.ts";
import { mountStopCheck } from "./control-stop-check-run.ts";
import { mountSupervisorQueue, supervisorQueueNow } from "./supervisor-queue-run.ts";
import { mountNotices } from "./notices-run.ts";
import { parseTopics, type SupervisorSummary } from "./supervisor-summary.ts";
import { mountRadio, RadioFeed } from "./radio-run.ts";
import { mountReadability } from "./readability-run.ts";
import { mountSkillUsage } from "./skill-calls-run.ts";
import type { Transmission } from "./radio.ts";
import { mountVoice } from "./voice-run.ts";
import type { AlertEvent } from "./supervisor-alerts.ts";
import { entryScript } from "./version.ts";
import { join } from "node:path";
import { githubStartupWarning, githubSwitch } from "./github-switch.ts";
import { WarmStart } from "./warm-start.ts";
import { loadWarmStartConfig, readWarmCache, writeWarmCache } from "./warm-start-run.ts";

const TICK_MS = 2_000;

let current: Snapshot | null = null;
// atc 자신의 Linear 쓰기가 성공하면 이미 만든 스냅샷에도 새 상태를 싣는다(ATC-448): 바로 다음 /api/releases가 옛 상태를 보지 않는다
onLocalState((key, next) => {
  if (current) current = { ...current, tickets: applyWrite(current.tickets, new Map(), key, next, 0).tickets };
});
// WARM START(ATC-539): 재시작 직후 저장해 둔 마지막 스냅샷. 화면과 /api/snapshot만 본다. `current`에는 넣지 않는다(이벤트 비교·잡·알림·DISPATCH·AUTOLAND·MCC는 살아 있는 것만)
const warm = new WarmStart();
{
  const cfg = loadWarmStartConfig();
  warm.restore(readWarmCache(Date.now(), cfg), cfg.maxAgeMin * 60_000);
}
const shown = () => warm.display(current, Date.now());
let signature = "";
const listeners = new Set<(s: Snapshot) => void>();
const alertListeners = new Set<(e: AlertEvent) => void>(); // SUPERVISOR alerts(ATC-87)
const summaryListeners = new Set<(s: SupervisorSummary) => void>(); // SUPERVISOR SUMMARY(ATC-153)
const radioFeed = new RadioFeed(); // RADIO(ATC-170): 듣는 이가 있을 때만 기록을 읽는다
const eventLog = new EventLog();
// 주기로 도는 서버 일(ATC-393): server/jobs/ 폴더의 선언을 읽어 돌린다. index.ts는 일을 하나씩 적지 않는다
const runner = createJobRunner(jobs, { current: () => current, now: Date.now, service: serviceOf });

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
    const next = await timed("tick:buildSnapshot", buildSnapshot); // 잰 시간은 job-timing/에만 적는다(ATC-525)
    const sig = timed("tick:signature", () => JSON.stringify({ ...next, at: null }));
    timed("tick:events", () => {
      for (const event of eventLog.push(diffSnapshots(current, next))) {
        record({ t: event.at, kind: "event", epoch: eventLog.epoch, event });
      }
    });
    // 주기로 도는 일(ATC-393): server/jobs/의 선언이 순서대로. 스냅샷이 따뜻할 때만(샘플·DISPATCH·착수 기록·LOGBOOK·OOOI·STAND 없는 FLIGHT·ATFM·AUTOLAND·판정·QRH)
    timed("tick:jobs", () => runner.tick(next, isWarm(next))); // 잡마다의 시간은 러너가 job:<이름>으로 따로 잰다

    // SUPERVISOR alerts(ATC-87): 새로 생기거나 사라진 key를 `alert` 이벤트로. 스냅샷이 안 바뀌어도(RTS 결과 같은 파일 기록) 센다
    const alertEvent = isWarm(next) ? timed("tick:alerts", () => runSupervisorAlerts(next)) : null;
    if (alertEvent) for (const l of alertListeners) l(alertEvent);
    if (isWarm(next)) runRedMain(next); // RED MAIN(ATC-536): 큐 줄의 올림·닫힘을 센다(읽기·기록만)
    // SUPERVISOR SUMMARY(ATC-153): 알림 목록을 센 직후, 내용이 바뀐 때만 `summary` 이벤트로
    if (isWarm(next)) await timed("tick:queue", () => supervisorQueueNow(async () => next, () => update.status())).catch(() => null); // 요약의 todo가 큐와 같은 수(ATC-454)
    const summary = isWarm(next) ? timed("tick:summary", () => runSummary(next)) : null;
    if (summary) for (const l of summaryListeners) l(summary);
    timed("tick:radio", () => radioFeed.poll());

    current = next;
    // 살아 있는 따뜻한 스냅샷만 1분에 한 번 저장한다. 스위치가 꺼지면 저장도 복원본 보이기도 멈춘다. 복원본을 막 버렸으면 화면에 살아 있는 것을 보낸다
    const { save, ended: settled } = warm.tick(next, Date.now(), () => loadWarmStartConfig().mode);
    if (save) void writeWarmCache(save);
    if (warm.active()) signature = sig; // 복원본을 보이는 동안 화면은 이미 그것을 받았다
    else if (settled || sig !== signature) {
      signature = sig;
      for (const l of listeners) l(next);
    }
  } catch (e) {
    console.error("[atc] snapshot failed:", e);
  }
  setTimeout(tick, TICK_MS);
}

const app = new Hono();

// SUPERVISOR 자격(ATC-373): /api 아래 쓰기는 에이전트가 쓰는 길(atcctl 등, supervisor-auth.ts의 허용 목록) 말고는 모두 SUPERVISOR의 비밀을 요구한다. 어느 라우트보다 먼저 건다
app.use("/api/*", supervisorGate());
app.use("/api/*", async (c, next) => {
  const t0 = performance.now();
  try {
    await next();
  } finally {
    jobTimer.span(`http:${c.req.method} ${routePath(c, -1)}`, performance.now() - t0); // 맞은 길의 패턴으로 센다(모르는 길은 "/api/*" 하나로 모인다). 스트림 길은 wallMs가 연결 시간이다(ATC-525)
  }
});
app.get("/api/supervisor/auth", (c) => c.json({ verdict: verdictFor(c) })); // 이 요청의 자격이 맞는지(valid·invalid·missing·unpaired·insecure). 해시와 비밀은 싣지 않는다

const getSnapshot = async () => current ?? (current = await buildSnapshot());

app.get("/api/snapshot", async (c) => c.json(shown() ?? (await getSnapshot()))); // 복원본이면 restored 표시가 붙는다(WARM START)
app.get("/api/version", (c) => c.json(version()));
mountController(app, getSnapshot, eventLog, (s) => fuelWatch(s), mccLandInfo);
mountRelay(app, getSnapshot); // SUPERVISOR RELAY(ATC-271): 화면에서 AIRCRAFT에게 보내는 글. 만들기는 화면의 클릭뿐(fromThisApp)
mountDecisionCards(app); // 관제 세션의 DECISION 카드(ATC-352): 올리기는 atcctl, 답하기는 화면의 클릭뿐
mountLandingReview(app, getSnapshot);
mountHumanCheck(app, getSnapshot);
mountAirports(app);
mountMetrics(app, getSnapshot);
mountDispatch(app, getSnapshot, (s) => fuelWatch(s), {
  candidates: standFreeCandidates,
  timeliness: () => standFreeTimeliness(),
  arrived: (p, s) => proposalArrived(p, s, addLogbookFuel),
}, {
  // LAUNCH on approve(ATC-129): FLEET LAUNCH와 같은 길. 옵션은 그 AIRCRAFT의 마지막 atc LAUNCH와 같게.
  // ACCOUNT: RESUME은 끊긴 ACCOUNT를 이름으로 댄다. 다른 카드는 이름을 대지 않아 LAUNCH ACCOUNT가 먼저고, 마지막 ACCOUNT는 그다음이다(ATC-239)
  max: MAX_LAUNCHED,
  launch: (s, reg, proposal, resume, flight) => launchForCard(s, reg, proposal, resume, "SUPERVISOR", flight),
}, (s, now, inFlight) => {
  // ATC-169: 머지됐는데 도착 보고가 없는 FLIGHT와 OCC 재시작 안전 시점(읽기만)
  const arrivalMissing = arrivalMissingOf(followingNow(s, now, undefined, false), foldReports(readReports()), now);
  const wip = wipView(readWips(), now);
  return { arrivalMissing, restartSafety: restartSafetyOf({ inFlight, arrivalMissing, wip, now }) };
}, loadRoutes);
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
mountAutonomyAuto(app);
mountPrMerge(app, getSnapshot); // PR MERGE 버튼(DUTY G2): SUPERVISOR 클릭만, user 등급 CLEARED PR만 GitHub에 머지한다
mountReleases(app, getSnapshot); // 발권 기록(ATC-362): 화면 클릭·일괄 확인(Origin 검사)과 attested 증언
// FLIGHT 상태 버튼(DUTY G3): SUPERVISOR 클릭만 Linear에 쓴다. closable(ATC-473): STAND 없는 ARRIVED인데 아직 started인 FLIGHT만 Done으로 옮길 수 있다(HOME의 ARRIVED 줄과 같은 목록)
mountFlightState(app, { ...defaultStateDeps, closable: async (key) => arrivedOpenOf((await getSnapshot()).tickets, loadLogbook()).some((a) => a.flight === key) });
mountDetail(app, getSnapshot); // FLIGHT·PR drawer(DUTY G1): 읽기 전용, 60초 캐시
mountIdeas(app); // IDEAS 서랍(DUTY G4): atc 저장소 idea 이슈 읽기 전용, 60초 캐시
mountFollowing(app, getSnapshot);
mountFollow(app, getSnapshot); // FOLLOW F1(ATC-276): 따라가는 번들의 줄별 단계(읽기만)와 follow.json 설정(Origin 검사)
mountRadio(app); // RADIO R1(ATC-170): 기록된 교신을 합친 목록(읽기만)
mountReadability(app); // READABILITY R0(ATC-176): 교신 질의 하루 기록(readability.jsonl)과 오늘의 부분 지표
mountSkillUsage(app); // SKILL-CALL READER(ATC-289): Skill·sub-agent 호출 수와 qrh.named → opened(skill-usage.jsonl, 읽기만)
mountVoice(app, currentAlerts); // 음성 콜아웃(ATC-140): WAV만 만든다(소리는 브라우저)
mountMilestones(app, getSnapshot);
mountQrh(app); // QRH shadow(ATC-288): qrh.named 줄을 읽기만 한다
mountAtfm(app, getSnapshot);
mountAutoland(app, getSnapshot);
mountMigrate(app); // 마이그레이션 리허설 기록 읽기(ATC-368). 스위치는 설정 창(PUT /api/settings)뿐
mountMcc(app, getSnapshot, () => head);
const update = mountUpdate(app, getSnapshot, () => head); // UPDATE bar(ATC-82)
// CONTROL RECYCLE(ATC-166)의 안전 조건·동작: 라우트(APPLY NOW·일괄 동작)와 주기 일(server/jobs/control-recycle.ts)이 같이 쓴다
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
// 주기 일이 이름으로 받는 것(mount가 돌려준 객체와 이 파일에서 만든 것). 일을 더해도 여기는 그대로다
provideService("eventLog", eventLog);
provideService("update", update);
provideService("applyNow", applyNow);
provideService("recycleDeps", { facts: recycleFacts, act: recycleAct });
mountControlRecycle(app);
mountSettings(app);
mountPolicy(app, getSnapshot); // AIRCRAFT policy hook(ATC-369): PENDING 수와 거절을 class별로(읽기만)
mountAccounts(app, getSnapshot);
mountJudges(app);
try {
  // SQUELCH ships on(ATC-553): 배포 뒤 첫 시작에 모든 역할을 on·v2로 한 번 올린다(기록이 있으면 아무것도 안 한다)
  const m = migrateOnce();
  if (m === "migrated") console.log("[atc] squelch: ATC-553 — 모든 역할을 on·v2로 올림(squelch.json의 migrated에 옛 값)");
  else if (m === "unreadable") console.warn("[atc] squelch: squelch.json을 읽을 수 없음 — 올리지 않고 shadow·v1로 둔다");
} catch (e) {
  console.warn(`[atc] squelch: 올리기 실패 — ${e instanceof Error ? e.message : e}`);
}
mountSquelch(app); // SQUELCH(ATC-94): 판정 API. 기본은 on·v2(ATC-553)
mountControlShare(app); // CONTROL SHARE(ATC-551): 관제 몫과 일을 한 turn당 토큰(읽기만)
mountSquelchOpens(app); // SQUELCH opens-by-field(ATC-297): 어떤 필드가 tick을 열었고 그 tick이 일을 했는지(읽기만)
mountSquelchSwitch(app); // SQUELCH 스위치(ATC-552): 역할마다 mode·heartbeatMin·fingerprint를 SUPERVISOR 화면에서(Origin 검사)
mountTick(app); // `atcctl tick <역할>`(ATC-297): 브리핑에 할 일이 있는가(읽기만)

mountSupervisorQueue(app, getSnapshot, () => update.status(), () => eventLog.since(null).events); // SUPERVISOR QUEUE(ATC-194, 읽기만)
mountNotices(app, getSnapshot, () => update.status()); // NOTICES(ATC-447): 사이드바 머리의 알림 세 개(읽기만)
mountEffectCheck(app, getSnapshot); // EFFECT CHECK(ATC-402): 배포한 FLIGHT가 `## Measure`에 적은 것을 바꿨는지 재고 effect-verdicts.jsonl에 평결을 남긴다(재기만, 끄는 스위치는 설정 창)
mountTouches(app); // SUPERVISOR TOUCHES(ATC-512): 기존 기록만 읽는다
mountLeaks(app, getSnapshot, () => update.status()); // LEAK COUNTER(ATC-363): 릴리스 뒤에도 사람이 거치는 단계를 leaks.jsonl에 열릴 때·닫힐 때 한 줄씩 센다(세기만)
mountLanes(app); // 조용한 리뷰 레인(ATC-386): 날짜별 착륙 수와 REVIEW 한 레인으로 착륙한 수(읽기만)
mountMisfire(app); // 자동 운항 MISFIRE(ATC-367): 서버가 승인한 카드가 나중에 틀렸다고 드러난 수를 날짜별 승인 대비 몫으로(읽기만)
mountDuty(app, getSnapshot, () => update.status(), (l) => duty().recordDraft(l)); // DUTY L0(ATC-219): brief 읽기와 초안 붙이기(밖으로 나가는 동작 없음)
setSnapshotPeek(() => current);
mountDutyL1(app, { ...defaultL1Deps, ...reviewHooks(getSnapshot), ...duplicateHooks(getSnapshot), ...chatReleaseHooks(() => duty().supervisorTurn()) }); // DUTY D7a: STAND 만들기·치우기와 Linear 쓰기(duty.json l1이 켜졌을 때만, Origin 있는 요청 거절). REVIEW 턴(ATC-396)에는 Backlog만·중복 거절
mountDutyReview(app, getSnapshot); // DUTY REVIEW(ATC-396): 주기·트리거로 서버가 DUTY 턴을 시작한다(duty.json review, 기본 켜짐, SUPERVISOR만 끈다). 읽기 GET /api/duty/review
mountDutyRun(app, undefined, (text) => void releaseFromChat(text, getSnapshot).catch(() => {})); // DUTY D2(ATC-220): 글 보내기·중단·NEW SHIFT(Origin 검사)·기록·상태. duty.json enabled가 꺼져 있으면 아무것도 띄우지 않는다
mountStatus(app, getSnapshot, currentAlerts); // STATUS(ATC-384): "현재 상태"·"ATC-n 어디까지"에 한 번에 답하는 읽기 전용 요약
provideService("flowDeps", { updateStatus: () => update.status(), alerts: currentAlerts });
mountJobLiveness(app); // JOB LIVENESS(ATC-534): 스위치·수·최근 줄(읽기)
mountLinearCalls(app); // LINEAR CALL(ATC-561): 구간·원인별 실패·복구·포기 수(읽기)와 atcctl의 시도 기록 받기
mountStopCheck(app); // CONTROL STOP CHECK(ATC-521): 스위치·수·열린 중복·최근 결정(읽기)과 오탐 표시(SUPERVISOR 화면만)
mountLandingGap(app); // 착륙 간격 규칙(ATC-501): 스위치와 에피소드·MISFIRE 수(읽기만)
mountStuckUnserved(app); // 막힘 알림 새 문구(ATC-522): 스위치와 쓴 알림 수(읽기만)
mountJobTiming(app); // JOB TIMING(ATC-525): 스위치와 일별 시간(읽기만)
mountRedMain(app); // RED MAIN(ATC-536): 스위치와 올림·스스로 닫힘 수(읽기만)
mountEventLoopLag(app); // EVENT LOOP LAG(ATC-538): 스위치와 에피소드·MISFIRE 수(읽기만)
mountClearanceMoot(app); // 이유를 잃은 CLEARANCE(ATC-515): 스위치와 MISFIRE 수(읽기만)
mountOrphanFlight(app); // ORPHAN FLIGHT(ATC-516): 스위치와 에피소드·MISFIRE 수(읽기만)
mountHomeFlow(app, getSnapshot, () => update.status(), currentAlerts); // HOME 흐름판(ATC-499): 판정·칸·주체·묶은 할 일(읽기만, 새 GitHub·Linear 호출 없음)
mountSinceLook(app, getSnapshot, currentAlerts); // SINCE YOU LAST LOOKED(ATC-383): 본 뒤 바뀐 것의 수(읽기)와 마지막 본 시각 옮기기(SUPERVISOR 화면만)
app.get("/api/supervisor-alerts", (c) => c.json({ items: currentAlerts() })); // 지금 있는 알림 key 전체(읽기만)
app.get("/api/supervisor-alerts/ends", (c) => (current ? c.json(endsNow(current)) : c.json({ error: "snapshot not ready" }, 503))); // 끝 규칙이 뺀 알림과 24시간 안에 돌아온 수, 같은 상태의 CAUTION 전후(읽기만, ATC-385)

// 알림 요약(ATC-153, 읽기만): 메뉴 막대·브라우저·atc-app이 같은 숫자를 읽는다. 아직 스냅샷이 없으면 503
app.get("/api/supervisor-summary", async (c) => {
  if (!current) return c.json({ error: "snapshot not ready" }, 503);
  await supervisorQueueNow(async () => current!, () => update.status()).catch(() => null); // todo는 큐가 센 수(ATC-454)
  return c.json(summaryNow(current));
});

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
    const first = shown();
    if (want.has("snapshot") && first) await send(first);
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
runner.startTimers(); // every 일의 타이머와 start 일(ATC-393)
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
