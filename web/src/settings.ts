import { useSyncExternalStore } from "react";

// 화면 설정. 이 브라우저에만 저장된다(서버·다른 기기와 공유하지 않음).
// 테마는 styles.css의 :root[data-theme="…"] 토큰 묶음과 짝을 이룬다.
export const THEMES = [
  {
    id: "radar",
    code: "RDR",
    label: "Radar Console",
    note: "ATC RADAR 스코프와 종이 스트립",
    swatch: ["#080d12", "#3ef08f", "#ffb627", "#5cd0ff", "#ece6d3"],
  },
  {
    id: "cockpit",
    code: "EFIS",
    label: "Glass Cockpit",
    note: "조종석 계기, 색 하나에 뜻 하나",
    swatch: ["#060a14", "#ff5fdc", "#29e0ff", "#3cf06e", "#ffbf1f"],
  },
  {
    id: "night",
    code: "NIGHT",
    label: "Night Sky",
    note: "흐르는 별밭과 오늘의 달",
    swatch: ["#080c24", "#ffd98a", "#9ec2ff", "#7fe8ff", "#c3adff"],
  },
] as const;
export type Theme = (typeof THEMES)[number]["id"];

export interface Settings {
  theme: Theme;
  motion: boolean; // 애니메이션(스위프, 별, 깜빡임)
  clock: "utc" | "local"; // 시각 표시: 06:24Z 또는 15:24L
  meteors: boolean; // Night Sky 유성
  fidsView: "list" | "board"; // FIDS: DEPARTURES 목록 또는 비행 단계별 보드
  fidsClosed: boolean; // FIDS에 SCHEDULED·지난 ARRIVED·CANCELLED 포함
}

const KEY = "atc.settings";
const LEGACY_THEME_KEY = "atc.theme";

function defaults(): Settings {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { theme: "radar", motion: !reduce, clock: "utc", meteors: true, fidsView: "list", fidsClosed: false };
}

function load(): Settings {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
    const merged = { ...base, ...(legacyTheme ? { theme: legacyTheme as Theme } : {}), ...saved };
    if (!THEMES.some((t) => t.id === merged.theme)) merged.theme = base.theme;
    return merged;
  } catch {
    // 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 기본값
    return base;
  }
}

let current = load();
const listeners = new Set<() => void>();

function apply(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.motion = s.motion ? "on" : "off";
}

export function initSettings() {
  apply(current);
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  apply(current);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    // 저장만 못 할 뿐 화면은 바뀐다
  }
  for (const fn of listeners) fn();
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

// 2026-09-26T06:24:37Z → "06:24Z"(UTC) 또는 "15:24L"(이 브라우저의 지역 시각). 항공 표기를 따른다.
export function formatClock(iso: string | number, clock: Settings["clock"], seconds = false): string {
  const d = new Date(iso);
  if (clock === "utc") return `${d.toISOString().slice(11, seconds ? 19 : 16)}Z`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ""}L`;
}
