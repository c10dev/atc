// 화면 테마. styles.css의 :root[data-theme="…"] 토큰 묶음과 짝을 이룬다.
export const THEMES = [
  { id: "radar", code: "RDR", label: "Radar Console" },
  { id: "cockpit", code: "EFIS", label: "Glass Cockpit" },
  { id: "night", code: "NIGHT", label: "Night Sky" },
] as const;
export type Theme = (typeof THEMES)[number]["id"];

const KEY = "atc.theme";

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === value)) return value as Theme;
  } catch {
    // 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 기본 테마
  }
  return "radar";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // 저장만 못 할 뿐 화면은 바뀐다
  }
}
