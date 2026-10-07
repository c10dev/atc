import assert from "node:assert/strict";
import { test } from "node:test";
import { recycleAutoGuardOf, isRisky, modeLine, modeSegments, needsConfirm, SETTINGS_INDEX, settingsIndexOf, settingsSearch, settingsTabOf } from "./settings-policy.ts";
import { swOf, switchViews } from "./test-switch-views.ts";

// 스위치 목록·⚠ 모드·이름은 server/switches/의 선언에서 온다(ATC-393). 이 시험은 선언된 값으로 같은 계산을 확인한다.
const INDEX = settingsIndexOf(switchViews());

test("modeLine: 선언된 스위치를 한 줄로, 기본은 꺼짐(자동 운항·SCHEDULE·FLEET PLAN·CODEX LANE은 기본 on)", () => {
  assert.equal(
    modeLine(modeSegments(switchViews())),
    "AUTOLAND off · AUTOLAND REVIEW off · MCC shadow · K APPROVAL on · MCC SERVER AUTO on · REMOVAL GUARD on · JEV off · FUEL HOLD off · REVIEW exclude · CODEX LANE on · CONTROL RECYCLE off · REPOSITION shadow · SERVER SEND on · CONTROL WAKE TOWER wake · CONTROL WAKE OCC wake · CONTROL WAKE MCC wake · DUTY off · DUTY CHARTER off · DUTY REVIEW on · DUTY REVIEW EMPTY on · DUTY REVIEW SKIP on · DUTY L1 off · AUTO REVERT on · EFFECT CHECK on · SCHEDULE AUTO on · FLEET PLAN AUTO on · AUTO APPROVE off · AUTO LAUNCH off · AUTO DISPATCH on · K3 HOLD on · K3 RELAUNCH off",
  );
});

test("modeSegments: ⚠ 모드만 warn, REVIEW deepseek는 보이는 이름으로, 줄에 안 보이는 스위치는 뺀다", () => {
  const six = { autolandMode: "merge", autolandReviewedSecurity: "delegate", mccMode: "land", reviewSecurity: "deepseek", fuelHold: "on", judgesJev: "shadow" };
  const segs = modeSegments(switchViews(six)).filter((x) => x.key in six);
  assert.deepEqual(segs.map((x) => x.warn), [true, true, true, true, true, true]);
  assert.equal(modeLine(segs), "AUTOLAND merge · AUTOLAND REVIEW delegate · MCC land · JEV shadow · FUEL HOLD on · REVIEW sonnet (deepseek)");
  assert.deepEqual(modeSegments(switchViews()).filter((x) => x.key in six).map((x) => x.warn), [false, false, false, false, false, false]);
  const keys = modeSegments(switchViews()).map((x) => x.key);
  for (const hidden of ["controlRecycleCaps", "controlRecycleAuto", "dutyAccount"]) assert.ok(!keys.includes(hidden), hidden);
});

test("needsConfirm: ⚠ 모드로 올릴 때만, 내리거나 같은 값은 아니다", () => {
  assert.equal(needsConfirm(swOf("autolandReviewedSecurity"), "off", "delegate"), true); // 보안 위임은 ⚠
  assert.equal(needsConfirm(swOf("autolandReviewedSecurity"), "delegate", "off"), false);
  assert.equal(needsConfirm(swOf("autolandMode"), "off", "update"), true);
  assert.equal(needsConfirm(swOf("autolandMode"), "off", "merge"), true);
  assert.equal(needsConfirm(swOf("autolandMode"), "merge", "update"), true); // ⚠에서 ⚠로도
  assert.equal(needsConfirm(swOf("autolandMode"), "merge", "off"), false);
  assert.equal(needsConfirm(swOf("autolandMode"), "update", "update"), false);
  for (const m of ["land", "land+rts", "rts"]) assert.equal(needsConfirm(swOf("mccMode"), "shadow", m), true);
  assert.equal(needsConfirm(swOf("mccMode"), "land", "shadow"), false);
  for (const m of ["replay", "shadow"]) assert.equal(needsConfirm(swOf("judgesJev"), "off", m), true);
  assert.equal(needsConfirm(swOf("judgesJev"), "replay", "off"), false);
  assert.equal(needsConfirm(swOf("fuelHold"), "off", "on"), true);
  assert.equal(needsConfirm(swOf("fuelHold"), "on", "off"), false);
  assert.equal(needsConfirm(swOf("reviewSecurity"), "exclude", "deepseek"), true);
  assert.equal(needsConfirm(swOf("reviewSecurity"), "deepseek", "exclude"), false);
});

test("isRisky: MCC shadow는 기본이라 ⚠가 아니지만 JEV shadow는 ⚠", () => {
  assert.equal(isRisky(swOf("mccMode"), "shadow"), false);
  assert.equal(isRisky(swOf("judgesJev"), "shadow"), true);
});

test("REVIEW: 저장 값 deepseek은 sonnet (deepseek)로만 보이고 exclude는 그대로", () => {
  assert.deepEqual(swOf("reviewSecurity").display, { deepseek: "sonnet (deepseek)" });
  assert.equal(modeSegments(switchViews({ reviewSecurity: "exclude" })).find((x) => x.key === "reviewSecurity")!.value, "exclude");
});

test("settingsTabOf: 저장된 탭이 있으면 그것, 없거나 모르는 값이면 화면", () => {
  const ids = ["display", "linear", "agents", "landing"] as const;
  assert.equal(settingsTabOf("agents", ids, "display"), "agents");
  assert.equal(settingsTabOf(null, ids, "display"), "display");
  assert.equal(settingsTabOf("gone", ids, "display"), "display");
  assert.equal(settingsTabOf(undefined, ids, "display"), "display");
});

test("settingsTabOf: 옛 AUTOMATION 탭은 LANDING으로 연다", () => {
  const ids = ["display", "landing", "operations"] as const;
  assert.equal(settingsTabOf("automation", ids, "display"), "landing");
  assert.equal(settingsTabOf("operations", ids, "display"), "operations");
});

test("settingsSearch: 코드·한국어 이름·찾을 말, 대소문자 무시, 모든 말이 맞아야", () => {
  assert.deepEqual(settingsSearch("fuel", INDEX).map((e) => e.code), ["FUEL"]);
  assert.deepEqual(settingsSearch("목소리", INDEX).map((e) => e.code), ["VOICE"]);
  assert.deepEqual(settingsSearch("음성", INDEX).map((e) => e.code), ["CALLSIGNS", "VOICE"]);
  assert.deepEqual(settingsSearch("LINEAR_API_KEY", INDEX).map((e) => e.code), ["WORKSPACE"]);
  assert.deepEqual(settingsSearch("로그인", INDEX).map((e) => e.tab), ["accounts"]);
  assert.deepEqual(settingsSearch("control recycle", INDEX).map((e) => e.code), ["CONTROL RECYCLE"]);
  assert.deepEqual(settingsSearch("   ", INDEX), []);
  assert.deepEqual(settingsSearch("없는말", INDEX), []);
});

test("settingsSearch: 코드가 첫 말로 시작하는 블록이 앞", () => {
  const codes = settingsSearch("control", INDEX).map((e) => e.code);
  assert.deepEqual(codes.slice(0, 2), ["CONTROL", "CONTROL RECYCLE"]);
  // shadow는 MCC·JUDGES의 찾을 말. 둘 다 코드로 시작하지 않으니 색인 순서
  assert.deepEqual(settingsSearch("shadow", INDEX).map((e) => e.code), ["MCC", "JUDGES"]);
});

test("설정 색인: 분류마다 블록이 하나 이상, 같은 코드는 한 번", () => {
  for (const tab of ["display", "linear", "agents", "accounts", "alerts", "landing", "operations"]) {
    assert.ok(INDEX.some((e) => e.tab === tab), tab);
  }
  assert.equal(new Set(INDEX.map((e) => e.code)).size, INDEX.length);
  assert.ok(SETTINGS_INDEX.every((e) => e.tab !== "landing" && e.tab !== "operations")); // 정책 스위치 블록은 선언에서 온다
});

// ATC-393 이전에 SETTINGS_INDEX에 손으로 적던 정책 블록과 같다(코드·이름·찾을 말·순서). CODEX LANE(ATC-393)만 새로 더해졌다
test("설정 색인: 선언에서 만든 정책 블록이 옛 손으로 적은 항목과 같다", () => {
  const old = [
    ["landing", "AUTOLAND", "착륙 자동화", "update merge ground stop autoland.mode autoland 넘김 handoff 제외 사유 LANDING land holder 오작동 autolandHandoff"],
    ["landing", "MCC", "atc 착륙·RETURN TO SERVICE", "shadow land rts land+rts rollback 배포 shadow gate mcc.mode k approval kApproval K3 발권 user 등급 착륙 release server auto 서버 자동 착륙 land rts mcc.serverAuto 오작동 misfire removal guard removalGuard 지우기 기능 삭제 Removed"],
    ["landing", "REVIEW", "Codex 한도 때 착륙 리뷰", "보안 pr sonnet deepseek exclude externalReview.security"],
    ["landing", "MIGRATE", "마이그레이션 리허설", "migrate 마이그레이션 리허설 hostedDb 시험 DB PITR migrateRehearsal"],
    ["landing", "AUTO REVERT", "main이 빨개지면 lander 머지 자동 되돌림", "revert 되돌림 main red 빨간 breaker autoRevert flake groundstop"],
    ["landing", "RED MAIN", "빨간 main이 사람의 머지로 HOLD되면 QUEUE 한 줄", "red main 빨간 main hold auto-revert 사람의 머지 막힌 PR checks-failed queue needs you redMain"],
    ["operations", "FUEL", "사용 한도 HOLD", "dispatch hold 사용량 한도 fuel.hold"],
    ["operations", "AUTO APPROVE", "일치 기반 자동 승인", "dispatch schedule agree blind launch 자동 승인 autoApprove autoApproveLaunch via auto"],
    ["operations", "STALE STOP", "끝난 FLIGHT의 멈춘 AIRCRAFT 정리", "stale stop pending hung 멈춘 정리 staleStop"],
    ["operations", "K3 HOLD", "K3 줄이 있는 FLIGHT는 allow 없이 보내지 않음", "k3 hold allow 발권 declaration 선언 release 화면 classifier nuisance miss 오작동 k3Hold"],
    ["operations", "K3 RELAUNCH", "K3 FLIGHT에 쉬는 AIRCRAFT를 멈추고 새로 띄우는 카드", "k3 relaunch stop launch fresh 새로 띄움 쉬는 AIRCRAFT fleet plan 카드 오작동 k3Relaunch"],
    ["operations", "ACCOUNT RELEASE", "ACCOUNT가 달라 닿지 않는 AIRCRAFT의 카드를 닫음", "account 불일치 mismatch cross 닿지 않는 occ release 풀기 카드 supersede wrong-aircraft crossAccountRelease"],
    ["operations", "FRESH START", "새 FLIGHT마다 세션을 새로 띄우기", "fresh start 자동 새 세션 restart stop launch 대화 context always over off 오작동 freshStart fresh-start.json"],
    ["operations", "SOLO", "WAKE L·M FLIGHT는 CAPTAIN 혼자(CREW 없이)", "solo crew captain 혼자 팀원 subagent wake l m h multi-area 여러 영역 flight plan 오작동 soloDefault solo-default.json"],
    ["operations", "EFFECT CHECK", "배포 효과 확인(## Measure 평결)", "effect check measure 평결 improved not improved worse too little data 효과 측정 effect-check.json 틀림 misfire"],
    ["operations", "PARKED", "RELEASE 화면의 PARKED 절과 그 발권", "parked backlog 손으로 올린 hand-filed release 발권 접힌 releaseParked"],
    ["operations", "SCOPE MEMORY", "백그라운드 세션 scope의 메모리 상한(OOM이 scope 안에서 끝나게)", "scope memory 메모리 oom kill cgroup memoryhigh memorymax launch bgMemoryCap"],
    ["operations", "DUPLICATE TITLE", "작업 지시서 제목이 열린 이슈와 거의 같으면 거절·표시", "duplicate title 중복 제목 비슷한 same-title-ok 409 parked possible duplicate duplicateTitle"],
    ["operations", "CHAT RELEASE", "SUPERVISOR 채팅 글이 시작한 턴의 create --release를 발권으로 받음", "chat release 채팅 발권 create --release 작업 지시서 chatRelease"],
    ["operations", "VERIFY GATE", "무거운 검증 명령의 동시 실행 상한", "verify gate 검증 동시 실행 줄 npm test tsc vite build 슬롯 OOM verifyGate verify remote desktop 데스크톱 원격 LAN ssh verifyRemote"],
    ["operations", "BROWSER GATE", "브라우저(Playwright) 동시 실행 상한", "browser gate 브라우저 playwright chrome headless 동시 실행 줄 슬롯 CPU browserGate"],
    ["operations", "SCHEDULE·FLEET PLAN AUTO", "SCHEDULE·FLEET PLAN 자동 적용", "schedule fleet plan 자동 적용 사람 없이 off on misfire 오작동 scheduleAuto fleetPlanAuto schedule.auto fleet-plan.auto backlog"],
    ["operations", "REPOSITION", "소속 AIRPORT 옮기기", "base fleet plan approval auto fleet-plan.reposition"],
    ["operations", "CONTROL RECYCLE", "관제 세션 자동 재시작", "cap 컨텍스트 context 재시작 auto alert controlRecycle.mode carry over 넘겨 줌 overdue CLEARANCE RESEND 답 없음 controlRecycleCarry"],
    ["operations", "CONTROL WAKE", "관제 세션을 /loop 대신 일이 생길 때 깨움", "control wake 깨움 event wake /loop loop tick 관제 TOWER OCC MCC WAKE RESULT 오작동 misfire 깨우지 못함 메뉴 할 일 없음 control-wake.json controlWakeTower controlWakeOcc controlWakeMcc"],
    ["operations", "DUTY", "DUTY 채팅(atc 안의 대화 상대)", "duty chat 채팅 서랍 drawer claude acct-2 duty.enabled 대화 shift charter 차터 duty.charter CHARTER REQUEST OCC empty duty.reviewEmpty DUTY REVIEW EMPTY skip duty.reviewSkip DUTY REVIEW SKIP 건너뛰기 l1 duty.l1 DUTY L1 stand linear"],
    ["operations", "JUDGES", "판정 계열", "jev typesafe replay shadow judges.jev"],
    ["operations", "LANDING GAP", "착륙 없음 막힘 규칙(HOME)", "landing gap 착륙 없음 막힘 p90 기준 landingGap"],
    ["operations", "CONTROL STOP CHECK", "관제 세션 STOP 확인·중복 경고", "control stop check 관제 세션 멈춤 확인 state.json stopped 중복 job 경고 controlStopCheck"],
    ["operations", "ORPHAN FLIGHT", "주인 잃은 FLIGHT 감지", "orphan flight 주인 잃은 세션 끊김 한도 limit resume 새 세션 orphanFlight"],
    ["operations", "STUCK UNSERVED", "받을 AIRCRAFT가 없는 Todo의 막힘 알림 문구", "stuck unserved 막힘 알림 문구 no-aircraft unqualified no-tail 받을 AIRCRAFT 없음 LAUNCH stuckUnserved"],
    ["operations", "CONTROL ABSENT", "없는 관제 세션 다시 띄우기·알림", "control absent 관제 세션 없음 다시 띄움 relaunch 재부팅 reboot job gone 증거 controlAbsentRelaunch escalate 알림 warning annunciator 되풀이 ack 확인 오탐 controlAbsentEscalate quiet 조용한 시간 방해 금지 소리 passQuiet controlAbsentQuietPass limit 한도 분 minutes controlAbsentLimit control-absent.json"],
    ["operations", "CONTEST GUARD", "자리 잡은 DISPATCH 카드를 더 나은 배정이 밀어내지 않음", "contest guard 경합 보호 더 나은 배정 밀어냄 displaced supersede settled settle 카드 나이 contestGuard"],
    ["operations", "JOB LIVENESS", "백그라운드 job 프로세스 확인", "job liveness 백그라운드 job 프로세스 사라짐 job gone absent roster pid init 죽음 approved 카드 jobLiveness"],
    ["operations", "JOB TIMING", "서버 일별 시간 측정", "job timing 잡 시간 측정 cpu 서버 부하 steady jobTiming"],
    ["operations", "EVENT LOOP LAG", "서버 느림 알림(이벤트 루프 지연)", "event loop lag 이벤트 루프 지연 서버 느림 p99 job timing misfire eventLoopLag"],
    ["operations", "LINEAR RETRY", "Linear 호출 다시 시도 횟수", "linear retry 다시 시도 재시도 fetch failed 네트워크 실패 백오프 atcctl linearRetries"],
    ["operations", "CLEARANCE ENDED", "받는 세션이 끝난 CLEARANCE 닫기", "clearance ended addressee ended 받는 세션 끝남 dead undeliverable overdue RESEND 닫기 clearanceEnded"],
    ["operations", "CLEARANCE MOOT", "이유를 잃은 CLEARANCE 정리", "clearance moot 이유 잃은 취소 cancel 머지된 PR 브리핑 clearanceMoot"],
    ["operations", "WARM START", "재시작 직후 마지막 스냅샷 보이기", "warm start 웜 스타트 재시작 스냅샷 복원 restored warm-snapshot warmStart"],
    ["operations", "STALE REPLY", "닫혔거나 밀린 부름에 온 답 거절", "stale reply 옛 id 거절 refused superseded 다시 보낸 READBACK UNABLE STANDBY latest call staleReply"],
    ["operations", "READBACK HASH", "FLIGHT PLAN READBACK의 work-order 해시 확인", "readback hash 해시 work order 작업 지시서 FLIGHT PLAN 인용 quote @sha 바뀐 지시서 tamper 거절 refused input binding WO-23 readbackHash"],
    ["operations", "SERVER SEND", "서버가 FLIGHT PLAN을 세션에 직접 보냄", "server send 서버 발송 세션 소켓 socket flight plan 첫 발송 재송신 resend 재시도 retry undelivered 닿지 않음 sentVia server 오작동 misfire 잘못 보냄 두 번 server-send.json serverSendFirst serverSendResend serverSendRetry resend 재송신 overdue retry 재시도 undelivered"],
  ];
  const got = INDEX.filter((e) => (e.tab === "landing" || e.tab === "operations") && e.code !== "CODEX LANE").map((e) => [e.tab, e.code, e.label, e.words]);
  assert.deepEqual(got, old);
  assert.deepEqual(INDEX.filter((e) => e.tab === "landing").map((e) => e.code), ["AUTOLAND", "MCC", "REVIEW", "MIGRATE", "AUTO REVERT", "CODEX LANE", "RED MAIN"]);
});

test("recycleAutoGuardOf(ATC-175): alert → auto는 ⚠ 확인, auto → alert와 같은 값은 확인 없이. OCC는 문구가 따로", () => {
  for (const name of ["TOWER", "OCC", "MCC"]) {
    const g = recycleAutoGuardOf(name, false, "auto");
    assert.equal(g?.warn, true, name);
    assert.match(g!.line, /^auto ⚠ /);
    assert.equal(recycleAutoGuardOf(name, true, "auto"), null);
    assert.equal(recycleAutoGuardOf(name, true, "alert"), null);
    assert.equal(recycleAutoGuardOf(name, false, "alert"), null);
  }
  assert.match(recycleAutoGuardOf("OCC", false, "auto")!.line, /OCC는 도착 보고/);
  assert.doesNotMatch(recycleAutoGuardOf("TOWER", false, "auto")!.line, /OCC는/);
});

test("DUTY(ATC-220): OPERATIONS 색인에서 찾히고, 켜는 것은 ⚠ 확인이 필요하다", () => {
  assert.deepEqual(settingsSearch("duty", INDEX).map((e) => [e.tab, e.code]), [["operations", "DUTY"]]);
  assert.deepEqual(settingsSearch("서랍", INDEX).map((e) => e.code), ["DUTY"]);
  assert.ok(isRisky(swOf("dutyEnabled"), "on"));
  assert.ok(needsConfirm(swOf("dutyEnabled"), "off", "on"));
  assert.ok(!needsConfirm(swOf("dutyEnabled"), "on", "off"));
  const seg = modeSegments(switchViews({ dutyEnabled: "on" })).find((x) => x.key === "dutyEnabled");
  assert.deepEqual(seg && [seg.label, seg.value, seg.warn], ["DUTY", "on", true]);
});

test("DUTY CHARTER(ATC-233): on은 ⚠ 확인, shadow·off는 그대로, 정책 한 줄과 색인에 보인다", () => {
  assert.ok(isRisky(swOf("dutyCharter"), "on"));
  assert.ok(!isRisky(swOf("dutyCharter"), "shadow"));
  assert.ok(needsConfirm(swOf("dutyCharter"), "shadow", "on"));
  assert.ok(!needsConfirm(swOf("dutyCharter"), "on", "shadow"));
  const seg = modeSegments(switchViews({ dutyCharter: "on" })).find((x) => x.key === "dutyCharter");
  assert.deepEqual(seg && [seg.label, seg.value, seg.warn], ["DUTY CHARTER", "on", true]);
  assert.deepEqual(settingsSearch("duty.charter", INDEX).map((e) => e.code), ["DUTY"]);
});

test("DUTY L1(ATC-349): on은 ⚠ 확인, off는 바로, 정책 한 줄과 색인에 보인다", () => {
  assert.ok(isRisky(swOf("dutyL1"), "on"));
  assert.ok(!isRisky(swOf("dutyL1"), "off"));
  assert.ok(needsConfirm(swOf("dutyL1"), "off", "on"));
  assert.ok(!needsConfirm(swOf("dutyL1"), "on", "off"));
  const seg = modeSegments(switchViews({ dutyL1: "on" })).find((x) => x.key === "dutyL1");
  assert.deepEqual(seg && [seg.label, seg.value, seg.warn], ["DUTY L1", "on", true]);
  assert.deepEqual(settingsSearch("duty.l1", INDEX).map((e) => e.code), ["DUTY"]);
});
