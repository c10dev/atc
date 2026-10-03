import { useSyncExternalStore } from "react";
import { motionOn } from "./motion.ts";

// 화면 설정. 이 브라우저에만 저장된다(서버·다른 기기와 공유하지 않음).
// 테마는 styles.css의 :root[data-theme="…"] 토큰 묶음과 짝을 이룬다. swatch의 색은 server/theme-swatch.test.ts가 그 테마의 토큰과 견주니, 테마 색을 바꾸면 견본도 고친다.
export const THEMES = [
  {
    id: "radar",
    code: "RDR",
    label: "Radar Console",
    note: "ATC RADAR 스코프와 종이 스트립",
    swatch: ["#05080c", "#3ef08f", "#ffb627", "#5cd0ff", "#ece6d3"],
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
  motion: boolean; // 애니메이션(스위프, 별, 깜빡임) 저장된 선택. 화면은 SettingsView.motion(OS 움직임 줄이기 반영)을 쓴다
  clock: "utc" | "local"; // 시각 표시: 06:24Z 또는 15:24L
  density: "comfortable" | "compact"; // 밀도: 한 단계(4px)씩 낮춰 한 화면에 더 많이
  meteors: boolean; // Night Sky 유성
  fidsView: "list" | "board"; // FIDS: DEPARTURES 목록 또는 비행 단계별 보드
  fidsClosed: boolean; // FIDS에 SCHEDULED·지난 ARRIVED·CANCELLED 포함
}

const KEY = "atc.settings";
const LEGACY_THEME_KEY = "atc.theme";

// 저장된 설정에 더해 화면이 실제로 쓰는 값. motion은 OS의 움직임 줄이기까지 따진 값이다(ATC-409).
export interface SettingsView extends Settings {
  motionSaved: boolean; // 설정 창에서 고른 값(저장되는 값)
  osReduceMotion: boolean; // 운영체제가 움직임 줄이기를 요청 중
}

// 움직임 기본값은 켬. OS의 움직임 줄이기는 저장된 값과 상관없이 살아 있는 동안 늘 이긴다(motionOn).
function defaults(): Settings {
  return { theme: "radar", motion: true, clock: "utc", density: "comfortable", meteors: true, fidsView: "list", fidsClosed: false };
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

const reduceQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
let osReduce = reduceQuery?.matches ?? false;
let current = load();
let view = viewOf(current, osReduce);
const listeners = new Set<() => void>();

function viewOf(s: Settings, reduce: boolean): SettingsView {
  return { ...s, motion: motionOn(s.motion, reduce), motionSaved: s.motion, osReduceMotion: reduce };
}

function apply(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.motion = s.motion ? "on" : "off";
  root.dataset.density = s.density;
}

function changed() {
  view = viewOf(current, osReduce);
  apply(view);
  for (const fn of listeners) fn();
}

export function initSettings() {
  apply(view);
  // 창이 열려 있는 동안 OS 설정이 바뀌어도 새로 고침 없이 따른다
  reduceQuery?.addEventListener("change", (e) => {
    osReduce = e.matches;
    changed();
  });
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    // 저장만 못 할 뿐 화면은 바뀐다
  }
  changed();
}

export function useSettings(): SettingsView {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => view,
  );
}

// 2026-09-26T06:24:37Z → "06:24Z"(UTC) 또는 "15:24L"(이 브라우저의 지역 시각). 항공 표기를 따른다.
export function formatClock(iso: string | number, clock: Settings["clock"], seconds = false): string {
  const d = new Date(iso);
  if (clock === "utc") return `${d.toISOString().slice(11, seconds ? 19 : 16)}Z`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ""}L`;
}
