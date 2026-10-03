import type { StripChip, StripState } from "./control-strip.ts";
import type { Transmission } from "./radio.ts";

// 아래 CONTROL 패널의 계산(ATC-445, docs/layout.md 7.2·Z5). 브라우저에서도 도는 순수 함수만 둔다. 화면은 web/src/ControlPanel.tsx.
// 칩 하나의 상태는 server/control-strip.ts가 정한다: 여기서는 순서, 좁은 화면의 `OK n`, 높이 한계, 단축키, 선택한 세션의 교신만 센다.

// 칩 순서: SUPERVISOR의 손이 필요한 것(DOWN, NEEDS)이 먼저, 그다음 LATE, WORKING, OK. 같은 상태는 이름순으로 고정한다
const ORDER: Record<StripState, number> = { down: 0, needs: 1, late: 2, working: 3, ok: 4 };
export const panelChipsOf = (chips: readonly StripChip[]): StripChip[] => [...chips].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));

// 색만으로 알리지 않는다: 칩마다 점 옆에 이 글자가 늘 붙는다
export const CHIP_WORD: Record<StripState, string> = { ok: "OK", working: "WORKING", needs: "NEEDS", late: "LATE", down: "DOWN" };

// SUPERVISOR가 봐야 하는 세션 수(머리의 `CONTROL 2`): NEEDS와 DOWN
export const needingCount = (chips: readonly StripChip[]): number => chips.filter((c) => c.state === "needs" || c.state === "down").length;

// 좁은 화면(≤ 860px, E5): 손이 필요한 칩만 보이고 나머지는 `OK n`. LATE는 OK가 아니라서 칩으로 남는다(OK n에 숨기면 거짓이 된다)
export function narrowChipsOf(chips: readonly StripChip[]): { shown: StripChip[]; ok: number } {
  const sorted = panelChipsOf(chips);
  const shown = sorted.filter((c) => c.state === "down" || c.state === "needs" || c.state === "late");
  return { shown, ok: sorted.length - shown.length };
}

// 높이: 위쪽 가장자리를 끌거나 키보드로 바꾼다. 화면 높이의 70%를 넘지 않고 아래로는 MIN_PANEL_H 아래로 가지 않는다
export const MIN_PANEL_H = 160;
export const DEFAULT_PANEL_H = 320;
export const PANEL_STEP = 24;
export const clampPanelHeight = (h: number, viewportH: number): number => Math.round(Math.min(Math.max(h, MIN_PANEL_H), Math.max(MIN_PANEL_H, viewportH * 0.7)));
// 저장된 값(문자열)을 읽는다. 숫자가 아니면 기본값
export const storedPanelHeight = (raw: string | null | undefined, viewportH: number): number => {
  const n = Number(raw);
  return clampPanelHeight(raw && Number.isFinite(n) ? n : DEFAULT_PANEL_H, viewportH);
};

// 접고 여는 단축키: Ctrl+`. 입력 칸에서 치는 글자는 건드리지 않는다
export const isPanelToggleKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean =>
  e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "`" || e.key === "Dead");

// 선택한 세션의 최근 교신: 보낸 쪽이나 받는 쪽 이름이 그 세션이다(`MCC`, `TOWER` …). 오래된 것부터, 끝에서 limit개
export function controlRadioOf(txs: readonly Transmission[], name: string, limit = 12): Transmission[] {
  const me = name.toUpperCase();
  return txs.filter((t) => t.from.toUpperCase() === me || t.to.toUpperCase() === me).slice(-limit);
}

// 어느 주소가 패널을 여는가: 옛 #fleet/control(설정 창, 서버 경보 링크)과 새 #control
export const opensControlPanel = (hash: string): boolean => /^#?(?:fleet\/)?control$/.test(hash);

// 아래 패널의 탭(ATC-455, S1c): CONTROL 옆에 BRAKES. VS Code의 PROBLEMS·OUTPUT·TERMINAL 탭처럼 머리에 나란히 선다
export const PANEL_TABS = ["control", "brakes"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
export const PANEL_TAB_LABEL: Record<PanelTab, string> = { control: "CONTROL", brakes: "BRAKES" };
// 저장된 값(문자열)을 읽는다. 모르는 값이면 CONTROL
export const storedPanelTab = (raw: string | null | undefined): PanelTab => ((PANEL_TABS as readonly string[]).includes(raw ?? "") ? (raw as PanelTab) : "control");
// 탭 줄의 화살표 키: ←→는 둘레를 돌고 Home·End는 양 끝. 다른 키는 null(탭 줄이 가져가지 않는다)
export function nextPanelTab(cur: PanelTab, key: string): PanelTab | null {
  const i = PANEL_TABS.indexOf(cur);
  if (key === "ArrowRight") return PANEL_TABS[(i + 1) % PANEL_TABS.length]!;
  if (key === "ArrowLeft") return PANEL_TABS[(i + PANEL_TABS.length - 1) % PANEL_TABS.length]!;
  if (key === "Home") return PANEL_TABS[0]!;
  if (key === "End") return PANEL_TABS[PANEL_TABS.length - 1]!;
  return null;
}
// 접힌 머리의 BRAKES 탭 옆 글자: 실제로 걸린 GROUND STOP과 수동 출발 중지의 합. 없으면 빈 글자(탭은 아무것도 덧붙이지 않는다). 색만으로 알리지 않는다: `1 STOP`, `2 STOPS`
export function brakesTabWord(groundStops: number, manualStops: number): string {
  const n = Math.max(0, Math.trunc(groundStops)) + Math.max(0, Math.trunc(manualStops));
  return n === 0 ? "" : `${n} ${n === 1 ? "STOP" : "STOPS"}`;
}
