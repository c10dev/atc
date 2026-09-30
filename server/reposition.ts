// FLEET PLAN REPOSITION의 순수 부분(ATC-179, docs/fleet.md 8.6): 모드·설정 읽기, 자동 모드의 가드, 알림 문구.
// 화면 번들도 supervisor-alerts.ts를 통해 이 파일을 가져오므로 node·config를 import하지 않는다. 파일 읽기·쓰기는 fleet-plan-run.ts.

// off: 아무것도 안 함, shadow(기본): would만 기록, approval: FLEET PLAN 카드를 SUPERVISOR가 승인, auto: atc가 스스로(가드 아래)
export const REPOSITION_MODES = ["off", "shadow", "approval", "auto"] as const;
export type RepositionMode = (typeof REPOSITION_MODES)[number];

export const REPOSITION_DEFAULT_DAILY_MAX = 4;

export interface RepositionConfig {
  mode: RepositionMode;
  dailyMax: number; // auto: 하루(24시간)에 옮기는 AIRCRAFT 수 상한
}

// fleet-plan.json의 `reposition`·`repositionDailyMax`. 모르는 값은 기본값(shadow, 4)
export function parseReposition(raw: unknown): RepositionConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = r.repositionDailyMax;
  return {
    mode: REPOSITION_MODES.includes(r.reposition as RepositionMode) ? (r.reposition as RepositionMode) : "shadow",
    dailyMax: typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 50 ? n : REPOSITION_DEFAULT_DAILY_MAX,
  };
}

// FLIGHT RECORDER의 `fleet` `reposition` 사건에서 온 것(ok인 것만 옮긴 것이다)
export interface RepositionEvent {
  aircraft: string;
  from: string;
  to: string;
  at: string;
  ok: boolean;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// 지난 24시간에 옮긴 수(base를 바꾼 것: 성공, 또는 LAUNCH가 실패했지만 base는 바뀐 것)
export const movedInDay = (events: readonly (RepositionEvent & { baseChanged?: boolean })[], now: number): number =>
  events.filter((e) => (e.ok || e.baseChanged) && now - Date.parse(e.at) < DAY).length;

// 이 AIRCRAFT를 to로 옮기면 minDwell 안에 직전 base로 되돌리는 것인가(flapping)
export function isFlap(events: readonly RepositionEvent[], aircraft: string, to: string, now: number, minDwellMin: number): boolean {
  const last = events
    .filter((e) => e.aircraft === aircraft && (e.ok || (e as { baseChanged?: boolean }).baseChanged))
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1);
  return !!last && last.from === to && now - Date.parse(last.at) < minDwellMin * MIN;
}

export interface AutoCandidate {
  key: string;
  aircraft: string | null;
  airport: string | null;
}
export interface AutoDecision<T extends AutoCandidate> {
  act: T[]; // 지금 스스로 옮길 것
  toApproval: string | null; // 있으면 auto를 approval로 되돌린다(flapping). 그 사유
  skipped: string[]; // 오늘 상한 때문에 카드로 남긴 것 등
}

// 자동 모드의 가드(순수). flaps가 하나라도 있으면 아무것도 옮기지 않고 approval로 돌린다.
// 하루 상한(dailyMax)을 넘는 것은 옮기지 않고 열린 카드로 둔다(SUPERVISOR가 승인할 수 있다)
export function autoRepositionOf<T extends AutoCandidate>(i: {
  ready: readonly T[];
  flaps: readonly { aircraft: string; to: string; from: string }[];
  events: readonly (RepositionEvent & { baseChanged?: boolean })[];
  now: number;
  dailyMax: number;
}): AutoDecision<T> {
  if (i.flaps.length) {
    const f = i.flaps[0];
    return { act: [], toApproval: `${f.aircraft}가 ${f.from} → ${f.to}로 되돌아가려 함(직전에 ${f.to} → ${f.from}로 옮김)`, skipped: [] };
  }
  const room = Math.max(0, i.dailyMax - movedInDay(i.events, i.now));
  const act = i.ready.slice(0, room);
  return { act, toApproval: null, skipped: i.ready.slice(room).map((c) => `${c.aircraft ?? "?"} → ${c.airport ?? "?"}: 하루 상한 ${i.dailyMax}`) };
}

// ── 알림 문구(supervisor-alerts.ts가 쓴다) ──
export interface RepositionRecordLike {
  t: string;
  aircraft: string;
  from: string;
  to: string;
  ok: boolean;
  by: string; // supervisor | auto
  stage?: "stop" | "base" | "launch" | "precheck";
  error?: string;
}
// 옮김: 자동이면 ADVISORY(옮긴 것을 알린다), 실패는 CAUTION. LAUNCH가 실패했지만 base가 바뀐 경우는 그렇게 말한다
export function repositionAlertTextOf(r: RepositionRecordLike): { text: string; next: string; level: "advisory" | "caution" } {
  const move = `${r.aircraft} ${r.from} → ${r.to}`;
  if (r.ok) return { text: `REPOSITION — ${move}${r.by === "auto" ? " (자동)" : ""}: 세션을 ${r.to} 저장소에서 새로 띄움`, next: "", level: "advisory" };
  const why = r.error ? ` — ${r.error}` : "";
  if (r.stage === "launch") return { text: `REPOSITION — ${move}: 멈추고 base를 ${r.to}로 바꿨지만 LAUNCH가 실패함${why}`, next: `base는 ${r.to}로 남는다. 다음 DISPATCH가 ABSENT로 LAUNCH 카드를 낸다`, level: "caution" };
  return { text: `REPOSITION — ${move}: 실패(${r.stage ?? "?"})${why}`, next: r.stage === "stop" ? "세션 상태를 FLEET 탭에서 본다" : "옛 세션은 멈추지 않았고 base도 그대로다", level: "caution" };
}
// auto가 flapping 때문에 approval로 돌아옴: ADVISORY
export const repositionFlapAlertText = (reason: string): { text: string; next: string } => ({
  text: `REPOSITION — 자동 모드를 approval로 되돌림: ${reason}`,
  next: "설정 창 AUTOMATION 탭에서 원인을 본 뒤 다시 auto로 올린다",
});
