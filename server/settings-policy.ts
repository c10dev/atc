import type { SwitchView } from "./switch-def.ts";

// 설정 창의 계산(ATC-131). SUPERVISOR 정책 스위치(AUTOMATION: LANDING·OPERATIONS)의 "지금 모드 한 줄", ⚠ 모드로 올릴 때 확인이 필요한지, 마지막 분류 기억, 설정 찾기.
// 저장 값과 PUT /api/settings는 그대로다. 여기는 화면에 보이는 이름과 판단만 다룬다.
// 스위치 목록·⚠ 모드·이름은 server/switches/의 선언에서 온다(ATC-393): GET /api/settings의 `switches`(SwitchView)를 받아 쓴다. 이 파일에는 스위치마다 적는 줄이 없다.

// ⚠ 모드(올리면 atc가 더 많이 쓰거나 밖으로 내보낸다). 화면의 경고 문구가 ⚠로 시작하는 모드와 같다. 목록은 스위치 선언의 risky
export const isRisky = (sw: Pick<SwitchView, "risky">, mode: string): boolean => sw.risky.includes(mode);

// 지금 모드에서 to로 옮길 때 확인 단계가 필요한가. 같은 값이면 저장할 것이 없고, ⚠ 모드로 가면(⚠에서 ⚠로도) 늘 확인한다. 내리는 것은 그대로 저장
export const needsConfirm = (sw: Pick<SwitchView, "risky">, from: string, to: string): boolean => from !== to && isRisky(sw, to);

// CONTROL RECYCLE의 세션별 auto 스위치(ATC-175): alert → auto로 올리면 mode `on`처럼 ⚠ 확인이 필요하다(모든 세션). 내리는 것은 확인 없이 저장.
// OCC는 문구가 따로다: 도착 보고 틈과 CHARTER REQUEST가 닫힌 뒤(ATC-169)에만 켠다
export function recycleAutoGuardOf(session: string, wasAuto: boolean, to: "auto" | "alert"): { line: string; warn: boolean } | null {
  if (to !== "auto" || wasAuto) return null;
  const base = "auto ⚠ 이 세션도 atc가 스스로 STOP·LAUNCH한다(CAP을 넘고 턴 사이이며 안전한 순간에, 스위치가 on일 때).";
  return { line: session === "OCC" ? `${base} OCC는 도착 보고 기록·wip CHARTER REQUEST 매뉴얼(ATC-169)이 돌고 있을 때만 켠다.` : base, warn: true };
}

export interface ModeSegment {
  key: string;
  label: string; // AUTOLAND, MCC, JEV, FUEL HOLD, REVIEW …
  value: string; // 보이는 값
  warn: boolean;
}
// 탭 맨 위 한 줄: `AUTOLAND off · MCC land · JEV off · FUEL HOLD off · REVIEW exclude`. ⚠ 모드는 warn. 줄에 보이지 않는 스위치(세션별 CAP 같은 구조)는 뺀다
export function modeSegments(switches: readonly SwitchView[]): ModeSegment[] {
  return switches
    .filter((x) => x.line)
    .sort((a, b) => a.lineOrder - b.lineOrder || a.key.localeCompare(b.key))
    .map((x) => ({ key: x.key, label: x.label, value: x.display[x.value] ?? x.value, warn: isRisky(x, x.value) }));
}
export const modeLine = (segs: readonly ModeSegment[]): string => segs.map((x) => `${x.label} ${x.value}`).join(" · ");

// 설정 창이 다시 열릴 때 마지막 분류. 저장된 값이 없거나 모르는 값이면 fallback(화면).
// 옛 AUTOMATION 탭(한 탭이던 때)은 LANDING으로 연다
export const settingsTabOf = <T extends string>(stored: string | null | undefined, ids: readonly T[], fallback: T): T => {
  const id = stored === "automation" ? "landing" : stored;
  return ids.find((x) => x === id) ?? fallback;
};

// 설정 창 왼쪽 메뉴의 분류. landing·operations는 AUTOMATION 묶음(SUPERVISOR 정책 스위치)
export type SettingsTab = "display" | "linear" | "agents" | "accounts" | "airports" | "alerts" | "landing" | "operations";

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
  { tab: "airports", code: "AIRPORTS", label: "AIRPORT 등록부(개설·이름·닫기·팀 머지)", words: "airport 저장소 repo open close rename 개설 이름 코드 teamsMerge 팀 머지 스위치 register ~/projects" },
  { tab: "alerts", code: "NOTIFY", label: "브라우저 알림", words: "notification 알림 권한" },
  { tab: "alerts", code: "SOUND", label: "소리", words: "warning caution call 방해 금지 quiet 톤" },
  { tab: "alerts", code: "VOICE", label: "음성 콜아웃", words: "tts piper espeak kokoro 목소리 무전 radio" },
];

// 정책 스위치의 블록(landing·operations)은 선언에서 온다(ATC-393): 같은 블록 code의 스위치를 한 항목으로 모으고, 찾을 말은 이어 붙인다.
// 정적 항목 뒤에 searchOrder 순으로 놓는다
export function settingsIndexOf(switches: readonly SwitchView[]): SettingsEntry[] {
  const blocks = new Map<string, { entry: SettingsEntry; order: number; words: string[] }>();
  for (const sw of [...switches].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))) {
    const b = blocks.get(sw.block.code);
    if (b) {
      if (sw.block.words) b.words.push(sw.block.words);
      continue;
    }
    blocks.set(sw.block.code, { entry: { tab: sw.group, code: sw.block.code, label: sw.block.label, words: "" }, order: sw.block.searchOrder, words: sw.block.words ? [sw.block.words] : [] });
  }
  const fromSwitches = [...blocks.values()].sort((a, b) => a.order - b.order || a.entry.code.localeCompare(b.entry.code)).map((b) => ({ ...b.entry, words: b.words.join(" ") }));
  return [...SETTINGS_INDEX, ...fromSwitches];
}

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
