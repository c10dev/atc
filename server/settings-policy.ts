import type { ServerSettings } from "./settings.ts";

// 설정 창의 계산(ATC-131). SUPERVISOR 정책 스위치(AUTOMATION: LANDING·OPERATIONS)의 "지금 모드 한 줄", ⚠ 모드로 올릴 때 확인이 필요한지, 마지막 분류 기억, 설정 찾기.
// 저장 값과 PUT /api/settings는 그대로다. 여기는 화면에 보이는 이름과 판단만 다룬다.
export type PolicyKey = "autoland" | "autolandReview" | "mcc" | "jev" | "fuelHold" | "review" | "reposition" | "recycle" | "duty" | "dutyCharter" | "dutyReview" | "autoApprove" | "autoApproveLaunch" | "autoDispatch" | "scheduleAuto" | "fleetPlanAuto";

// ⚠ 모드(올리면 atc가 더 많이 쓰거나 밖으로 내보낸다). 화면의 경고 문구가 ⚠로 시작하는 모드와 같다
export const RISKY: Record<PolicyKey, readonly string[]> = {
  autoland: ["update", "merge"],
  autolandReview: ["delegate"], // 머지 리뷰 pass가 rating:SEC·보안 게이트 PR의 AUTOLAND 머지 근거가 된다(ATC-328)
  mcc: ["land", "land+rts", "rts"], // rts도 ⚠: 사용자가 머지한 main을 서버가 스스로 배포한다(MCC_WARN)
  jev: ["replay", "shadow"], // 티켓 제목과 허용한 칸이 TypeSafe로 나간다
  fuelHold: ["on"],
  review: ["deepseek"], // 보안 PR도 REVIEW 세션에 보낸다
  reposition: ["auto"], // atc가 쉬는 AIRCRAFT의 base를 스스로 옮긴다(멈추고 다른 저장소에서 다시 띄움)
  recycle: ["on"], // atc가 관제 세션을 스스로 STOP·LAUNCH한다(shadow는 기록만)
  dutyCharter: ["on"], // OCC가 DUTY의 CHARTER REQUEST를 SCHEDULE 초안으로 만든다(shadow는 만들었을 초안만 기록)
  dutyReview: ["on"], // 서버가 SUPERVISOR의 글 없이 DUTY 턴을 시작해 운영을 점검하고 Backlog 제안을 남긴다(ATC-396). 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  duty: ["on"], // 서버가 `claude -p` 프로세스를 띄우고 ACCOUNT의 FUEL을 쓴다(SUPERVISOR가 글을 보낼 때만)
  autoApprove: ["on"], // 서버가 CROSSCHECK가 agree한 ASSIGN·SCHEDULE 초안을 스스로 승인한다(shadow는 기록만, blind·HELD·disagree는 그대로 SUPERVISOR 몫)
  scheduleAuto: ["on"], // 서버가 SCHEDULE 초안(CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW)을 사람 판정 없이 승인한다(ATC-370). 기본 on, off는 SUPERVISOR 몫
  fleetPlanAuto: ["on"], // 서버가 FLEET PLAN 제안(LAUNCH·STOP·RESTART·REFRESH·AOG)을 사람 승인 없이 실행한다(ATC-370). 기본 on, off는 SUPERVISOR 몫
  autoDispatch: ["on"], // 서버가 필터·상한을 통과한 ASSIGN·launch를 CROSSCHECK·사람 없이 승인한다(ATC-367, K3). 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  autoApproveLaunch: ["on"], // 서버가 launch 카드를 스스로 승인하고 세션을 띄운다(상한·FUEL hold·막힘·실패 뒤 대기·하루 상한을 지킬 때만)
};

export const isRisky = (key: PolicyKey, mode: string): boolean => RISKY[key].includes(mode);

// 지금 모드에서 to로 옮길 때 확인 단계가 필요한가. 같은 값이면 저장할 것이 없고, ⚠ 모드로 가면(⚠에서 ⚠로도) 늘 확인한다. 내리는 것은 그대로 저장
export const needsConfirm = (key: PolicyKey, from: string, to: string): boolean => from !== to && isRisky(key, to);

// CONTROL RECYCLE의 세션별 auto 스위치(ATC-175): alert → auto로 올리면 mode `on`처럼 ⚠ 확인이 필요하다(모든 세션). 내리는 것은 확인 없이 저장.
// OCC는 문구가 따로다: 도착 보고 틈과 CHARTER REQUEST가 닫힌 뒤(ATC-169)에만 켠다
export function recycleAutoGuardOf(session: string, wasAuto: boolean, to: "auto" | "alert"): { line: string; warn: boolean } | null {
  if (to !== "auto" || wasAuto) return null;
  const base = "auto ⚠ 이 세션도 atc가 스스로 STOP·LAUNCH한다(CAP을 넘고 턴 사이이며 안전한 순간에, 스위치가 on일 때).";
  return { line: session === "OCC" ? `${base} OCC는 도착 보고 기록·wip CHARTER REQUEST 매뉴얼(ATC-169)이 돌고 있을 때만 켠다.` : base, warn: true };
}

// REVIEW의 보이는 이름. 저장 값은 dispatch.json의 `deepseek` 그대로다(옛 이름, 뜻은 "REVIEW 세션에 보냄")
export const reviewLabel = (v: string): string => (v === "deepseek" ? "sonnet (deepseek)" : v);

export interface ModeSegment {
  key: PolicyKey;
  label: string; // AUTOLAND, MCC, JEV, FUEL HOLD, REVIEW
  value: string; // 보이는 값
  warn: boolean;
}
// 탭 맨 위 한 줄: `AUTOLAND off · MCC land · JEV off · FUEL HOLD off · REVIEW exclude`. ⚠ 모드는 warn
export function modeSegments(s: Pick<ServerSettings, "autoland" | "mcc" | "review"> & Partial<Pick<ServerSettings, "judges" | "fuel" | "controlRecycle" | "fleetPlan" | "duty" | "dispatchAuto" | "autonomyAuto">>): ModeSegment[] {
  const seg = (key: PolicyKey, label: string, mode: string, value = mode): ModeSegment => ({ key, label, value, warn: isRisky(key, mode) });
  return [
    seg("autoland", "AUTOLAND", s.autoland.mode),
    ...(s.autoland.reviewedSecurity ? [seg("autolandReview", "AUTOLAND REVIEW", s.autoland.reviewedSecurity)] : []),
    seg("mcc", "MCC", s.mcc.mode),
    seg("jev", "JEV", s.judges?.jev.mode ?? "off"),
    seg("fuelHold", "FUEL HOLD", s.fuel?.hold ? "on" : "off"),
    seg("review", "REVIEW", s.review.security, reviewLabel(s.review.security)),
    ...(s.controlRecycle ? [seg("recycle", "CONTROL RECYCLE", s.controlRecycle.mode)] : []),
    ...(s.fleetPlan ? [seg("reposition", "REPOSITION", s.fleetPlan.reposition)] : []),
    ...(s.duty ? [seg("duty", "DUTY", s.duty.enabled ? "on" : "off")] : []),
    ...(s.duty?.charter ? [seg("dutyCharter", "DUTY CHARTER", s.duty.charter)] : []),
    ...(s.duty && typeof s.duty.review === "boolean" ? [seg("dutyReview", "DUTY REVIEW", s.duty.review ? "on" : "off")] : []),
    ...(s.autonomyAuto ? [seg("scheduleAuto", "SCHEDULE AUTO", s.autonomyAuto.schedule), seg("fleetPlanAuto", "FLEET PLAN AUTO", s.autonomyAuto.fleetPlan)] : []),
    ...(s.dispatchAuto ? [seg("autoApprove", "AUTO APPROVE", s.dispatchAuto.approve), seg("autoApproveLaunch", "AUTO LAUNCH", s.dispatchAuto.launch), seg("autoDispatch", "AUTO DISPATCH", s.dispatchAuto.auto)] : []),
  ];
}
export const modeLine = (segs: readonly ModeSegment[]): string => segs.map((x) => `${x.label} ${x.value}`).join(" · ");

// 설정 창이 다시 열릴 때 마지막 분류. 저장된 값이 없거나 모르는 값이면 fallback(화면).
// 옛 AUTOMATION 탭(한 탭이던 때)은 LANDING으로 연다
export const settingsTabOf = <T extends string>(stored: string | null | undefined, ids: readonly T[], fallback: T): T => {
  const id = stored === "automation" ? "landing" : stored;
  return ids.find((x) => x === id) ?? fallback;
};

// 설정 창 왼쪽 메뉴의 분류. landing·operations는 AUTOMATION 묶음(SUPERVISOR 정책 스위치)
export type SettingsTab = "display" | "linear" | "agents" | "accounts" | "alerts" | "landing" | "operations";

// 설정 찾기의 색인: 블록마다 분류, 제목 코드(화면의 h3), 한국어 이름, 찾을 말(줄 이름·환경 변수·저장 값).
// 블록을 더하거나 옮기면 여기도 고친다(settings-policy.test.ts가 분류마다 하나 이상인지 본다)
export interface SettingsEntry {
  tab: SettingsTab;
  code: string;
  label: string;
  words: string;
}
export const SETTINGS_INDEX: readonly SettingsEntry[] = [
  { tab: "display", code: "THEME", label: "테마", words: "radar cockpit night sky 색 다크 라이트" },
  { tab: "display", code: "MOTION", label: "애니메이션", words: "스위프 별 깜빡임 움직임" },
  { tab: "display", code: "TIME", label: "시각 표시", words: "utc 현지 시계 clock last contact" },
  { tab: "display", code: "DENSITY", label: "밀도", words: "촘촘하게 compact comfortable" },
  { tab: "display", code: "METEORS", label: "유성(Night Sky 테마에서만)", words: "night" },
  { tab: "linear", code: "CONNECTION", label: "Linear 연결", words: "connected 동기화 error" },
  { tab: "linear", code: "WORKSPACE", label: "Linear 설정", words: "api key team teams LINEAR_API_KEY LINEAR_TEAM_KEY LINEAR_TEAM_KEYS 키 팀" },
  { tab: "agents", code: "SOURCES", label: "에이전트", words: "claude code codex claim hook 세션" },
  { tab: "agents", code: "CONTROL", label: "관제 세션", words: "control sessions launch stop tower occ mcc" },
  { tab: "agents", code: "STANDS", label: "점유 규칙", words: "stand handoff airport 폴더 ATC_CLAIM_TTL_MIN ATC_HANDOFF_GRACE_MIN ATC_PROJECTS_DIR 유예" },
  { tab: "agents", code: "CALLSIGNS", label: "콜사인", words: "team 음성 알파벳 alpha" },
  { tab: "accounts", code: "ACCOUNTS", label: "ACCOUNT 폴더", words: "account add login 계정 추가 로그인 CLAUDE_CONFIG_DIR statusline health hook acct plan usage refresh 요금제 한도 사용량" },
  { tab: "alerts", code: "NOTIFY", label: "브라우저 알림", words: "notification 알림 권한" },
  { tab: "alerts", code: "SOUND", label: "소리", words: "warning caution call 방해 금지 quiet 톤" },
  { tab: "alerts", code: "VOICE", label: "음성 콜아웃", words: "tts piper espeak kokoro 목소리 무전 radio" },
  { tab: "landing", code: "AUTOLAND", label: "착륙 자동화", words: "update merge ground stop autoland.mode" },
  { tab: "landing", code: "MCC", label: "atc 착륙·RETURN TO SERVICE", words: "shadow land rts land+rts rollback 배포 shadow gate mcc.mode" },
  { tab: "landing", code: "REVIEW", label: "Codex 한도 때 착륙 리뷰", words: "보안 pr sonnet deepseek exclude externalReview.security" },
  { tab: "operations", code: "FUEL", label: "사용 한도 HOLD", words: "dispatch hold 사용량 한도 fuel.hold" },
  { tab: "operations", code: "AUTO APPROVE", label: "일치 기반 자동 승인", words: "dispatch schedule crosscheck agree blind launch 자동 승인 autoApprove autoApproveLaunch via auto" },
  { tab: "operations", code: "SCHEDULE·FLEET PLAN AUTO", label: "SCHEDULE·FLEET PLAN 자동 적용", words: "schedule fleet plan 자동 적용 사람 없이 off on misfire 오작동 scheduleAuto fleetPlanAuto schedule.auto fleet-plan.auto backlog" },
  { tab: "operations", code: "REPOSITION", label: "소속 AIRPORT 옮기기", words: "base fleet plan approval auto fleet-plan.reposition" },
  { tab: "operations", code: "CONTROL RECYCLE", label: "관제 세션 자동 재시작", words: "cap 컨텍스트 context 재시작 auto alert controlRecycle.mode" },
  { tab: "operations", code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", words: "duty chat 채팅 서랍 drawer claude acct-2 duty.enabled 대화 shift charter 차터 duty.charter CHARTER REQUEST OCC" },
  { tab: "operations", code: "JUDGES", label: "판정 계열", words: "jev typesafe replay shadow judges.jev" },
];

// 찾기: 빈칸으로 나눈 말이 모두 코드·이름·찾을 말 안에 있는 블록. 대소문자는 가리지 않는다.
// 코드가 첫 말로 시작하는 블록을 앞에, 나머지는 색인 순서대로
export function settingsSearch(query: string, index: readonly SettingsEntry[] = SETTINGS_INDEX): SettingsEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = index.filter((e) => {
    const hay = `${e.code} ${e.label} ${e.words}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const lead = (e: SettingsEntry) => (e.code.toLowerCase().startsWith(terms[0]) ? 0 : 1);
  return hits.map((e, i) => ({ e, i })).sort((a, b) => lead(a.e) - lead(b.e) || a.i - b.i).map((x) => x.e);
}
