// 테마 생성기(design-system S1, ATC-439): 테마 하나는 짧은 입력 목록이고, 이 순수 함수가 색 토큰 값을 전부 낸다.
// 출력은 styles.css의 테마 블록에 표식 주석 사이로 커밋된다(web/gen-themes.ts). 페이지가 뜰 때는 아무것도 돌지 않는다.
// 도메인 토큰(--paper-*, --fids-*, --blk-*, --phase-* …)은 손으로 둔다. 도메인 모양이 테마마다 다르기 때문이다.

export type Rgb = [number, number, number];

export interface ThemeInputs {
  name: string; // styles.css의 테마: radar는 :root, 나머지는 :root[data-theme="이름"]
  bg: string; // 앱 바탕(층 0)
  surface: string; // 패널(층 1)의 색. 바탕에서 이 색 쪽으로 면이 올라간다(면에 도는 색조)
  fg: string; // 가장 밝은 글자
  hues: { radar: string; amber: string; cyan: string; alert: string; blue: string }; // 신호 다섯 색
  depth: number; // 카드(--panel-2)와 떠 있는 면(--panel-3)이 패널에서 올라가는 정도. 1이 기준
  contrast: number; // 선(--line, --line-strong)이 바탕에서 떨어지는 정도. 1이 기준
  glass?: boolean; // true면 면과 선이 반투명(night): 겹쳐 쌓은 색이 같도록 알파를 얹는다
}

// 팔레트 중립 11단. 단마다 하나의 일을 한다(design-system 3절 L0). 값은 "바탕에서 surface 쪽으로 간 거리"(panel = 1)의 배수.
export const STEPS = [
  { n: 1, token: "--bg", job: "앱 바탕(층 0)", at: 0 },
  { n: 2, token: "--scope", job: "RADAR 스코프의 안쪽 면: 바탕보다 한 숨 밝다", at: 0.19 },
  { n: 3, token: "--chrome", job: "위에 붙는 콘솔·레일(층 0.5)", at: 0.45 },
  { n: 4, token: "--panel", job: "패널(층 1)", at: 1 },
  { n: 5, token: "--panel-2", job: "카드, 호버 면(층 2)", at: 1.83 },
  { n: 6, token: "--panel-3", job: "떠 있는 것, 눌린 면(층 3)", at: 2.65 },
  { n: 7, token: "--line", job: "구분선, 장식 테두리(대비 요구 없음)", at: 3.3 },
  { n: 8, token: "--line-strong", job: "컨트롤 테두리(WCAG 1.4.11, 3:1 목표)", at: 5.1 },
  { n: 9, token: "--faint", job: "가장 흐린 글자(4.5:1 이상)", at: -0.5 },
  { n: 10, token: "--muted", job: "보조 글자", at: -0.34 },
  { n: 11, token: "--text", job: "본문 글자", at: -0 },
] as const;
// at이 양수면 바탕→surface 방향의 면, 음수면 fg에서 글자 그늘색(TEXT_SHADE) 쪽으로 간 비율(0 = fg 그대로)
const TEXT_SHADE = 5.25; // 글자 그늘색 = 바탕에서 surface 쪽으로 이 배수만큼 간 색(글자에 면의 색조가 묻는다)

// glass의 층별 알파(night): 겹쳐 쌓인 층이 solid와 같은 색으로 보이도록 색을 거꾸로 푼다
const GLASS_ALPHA: Record<string, number> = { "--scope": 0.3, "--chrome": 0.55, "--panel": 0.5, "--panel-2": 0.6, "--panel-3": 0.85 };
const GLASS_LINE_ALPHA: Record<string, number> = { "--line": 0.13, "--line-strong": 0.3 };

export function parseHex(hex: string): Rgb {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`#rrggbb만 읽는다: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
}
export const toHex = (c: Rgb) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rgb;
const rgba = (c: Rgb, a: number) => `rgba(${c.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(", ")}, ${a})`;

export interface Generated {
  palette: Record<string, string>; // --n-1 … --n-11, --hue-radar … --hue-blue
  semantic: Record<string, string>; // --bg … --text, --radar … --blue: 팔레트를 var()로 가리킨다
}

export function generate(i: ThemeInputs): Generated {
  const bg = parseHex(i.bg), surface = parseHex(i.surface), fg = parseHex(i.fg);
  const palette: Record<string, string> = {};
  const semantic: Record<string, string> = {};
  const solid: Record<string, Rgb> = {};
  for (const s of STEPS) {
    if (s.at < 0) solid[s.token] = mix(fg, mix(bg, surface, TEXT_SHADE), -s.at);
    else if (s.token === "--line" || s.token === "--line-strong") solid[s.token] = mix(bg, surface, s.at * (s.token === "--line" ? i.contrast : 1 + (i.contrast - 1) * 1.35));
    else solid[s.token] = mix(bg, surface, s.token === "--panel-2" || s.token === "--panel-3" ? 1 + (s.at - 1) * i.depth : s.at);
  }
  solid["--text"] = fg;
  // 쌓임: chrome은 바탕 위, panel도 바탕 위, panel-2는 panel 위, panel-3은 panel-2 위(theme-contrast.test.ts와 같은 순서)
  const under: Record<string, string> = { "--chrome": "--bg", "--panel": "--bg", "--panel-2": "--panel", "--panel-3": "--panel-2", "--scope": "--bg" };
  for (const s of STEPS) {
    let value: string;
    if (i.glass && s.token in GLASS_ALPHA) {
      const a = GLASS_ALPHA[s.token]!;
      const below = solid[under[s.token]!]!;
      value = rgba(mix(below, solid[s.token]!, 1 / a), a);
    } else if (i.glass && s.token in GLASS_LINE_ALPHA) {
      value = rgba(fg, GLASS_LINE_ALPHA[s.token]! * i.contrast);
    } else {
      value = toHex(solid[s.token]!);
    }
    palette[`--n-${s.n}`] = value;
    semantic[s.token] = `var(--n-${s.n})`;
  }
  for (const [name, hex] of Object.entries(i.hues)) {
    palette[`--hue-${name}`] = hex.toLowerCase();
    semantic[`--${name}`] = `var(--hue-${name})`;
  }
  return { palette, semantic };
}

// ── 세 테마의 입력(커밋되는 단일 출처) ──
export const THEMES: ThemeInputs[] = [
  {
    name: "radar",
    bg: "#05080c",
    surface: "#0f1720",
    fg: "#dde6ee",
    hues: { radar: "#3ef08f", amber: "#ffb627", cyan: "#5cd0ff", alert: "#ff4a4a", blue: "#8aa8ff" },
    depth: 1,
    contrast: 1,
  },
  {
    name: "cockpit",
    bg: "#060a14",
    surface: "#0d1528",
    fg: "#f2f5fa",
    hues: { radar: "#3cf06e", amber: "#ffbf1f", cyan: "#29e0ff", alert: "#ff4d4d", blue: "#29e0ff" },
    depth: 1,
    contrast: 1.36,
  },
  {
    name: "night",
    bg: "#03040d",
    surface: "#0b0e24",
    fg: "#eef0ff",
    hues: { radar: "#ffd98a", amber: "#9ec2ff", cyan: "#7fe8ff", alert: "#ff6b85", blue: "#c3adff" },
    depth: 1.7,
    contrast: 1,
    glass: true,
  },
];

// ── CSS에 쓰기 ──
const selectorOf = (name: string) => (name === "radar" ? ":root" : `:root[data-theme="${name}"]`);
export const beginMark = (name: string) => `  /* theme-gen:${name} begin (generated: web/src/theme-gen.ts의 입력을 고치고 \`node web/gen-themes.ts\`를 돌린다. 손으로 고치지 않는다) */`;
export const endMark = (name: string) => `  /* theme-gen:${name} end */`;

export function block(i: ThemeInputs): string {
  const g = generate(i);
  const lines = [beginMark(i.name)];
  lines.push("  /* 팔레트: 단마다 일이 하나다(docs/design-system.md 5절). 화면과 kit은 쓰지 않고 아래 의미 토큰만 쓴다 */");
  for (const [k, v] of Object.entries(g.palette)) lines.push(`  ${k}: ${v};`);
  for (const [k, v] of Object.entries(g.semantic)) lines.push(`  ${k}: ${v};`);
  lines.push(endMark(i.name));
  return lines.join("\n");
}

// styles.css 문자열의 표식 사이를 생성 결과로 바꾼 새 문자열. 표식이 없으면 던진다(첫 삽입은 insertBlocks).
export function applyGenerated(css: string, themes: ThemeInputs[] = THEMES): string {
  let out = css;
  for (const t of themes) {
    const b = out.indexOf(beginMark(t.name));
    const e = out.indexOf(endMark(t.name));
    if (b < 0 || e < b) throw new Error(`styles.css에 theme-gen:${t.name} 표식이 없다`);
    out = out.slice(0, b) + block(t) + out.slice(e + endMark(t.name).length);
  }
  return out;
}
