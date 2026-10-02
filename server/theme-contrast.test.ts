import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 테마 토큰의 대비(ATC-408 → ATC-438, design-language 3.1, design-system 4절): 화면이 실제로 그리는 (글자 토큰, 바탕 토큰, 최소 비율) 짝을
// 한 표(PAIRS)에 선언하고 styles.css에 있는 모든 테마에서 잰다. 새 테마(라이트 포함)는 표를 못 넘으면 들어올 수 없다.
// styles.css의 :root와 `:root[data-theme="…"] {` 블록에서 토큰 값을 읽고, 반투명 층과 color-mix는 겹쳐 쌓인 그대로 바탕 위에 합성해 잰다.

const CSS = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const MIN = 4.5;

type RGBA = [number, number, number, number];

function block(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} 블록이 없다`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out.set(m[1]!, m[2]!.trim());
  return out;
}

const ROOT = block(":root");
// 테마는 styles.css에서 찾는다: radar는 :root 자체, 나머지는 `:root[data-theme="이름"] {` 블록(그 안에 선언만 있는 것)
const THEMES: Record<string, Map<string, string>> = { radar: ROOT };
for (const m of CSS.matchAll(/^:root\[data-theme="([\w-]+)"\] \{/gm)) THEMES[m[1]!] = new Map([...ROOT, ...block(`:root[data-theme="${m[1]}"]`)]);

// 쉼표로 나누되 괄호 안은 건드리지 않는다
function splitTop(v: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of v) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  return out.concat(cur.trim());
}

// 색 하나를 읽는다: #hex, rgb(a)(), var(--토큰), transparent, color-mix(in srgb, 색 N%, 색). 두 번째 색이 반투명이면 결과도 반투명이라 아래 층에 합성한다
function parse(value: string, tokens: Map<string, string>, depth = 0): RGBA {
  const v = value.trim();
  assert.ok(depth < 10, `${v}: var() 순환`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    const next = tokens.get(ref[1]!);
    assert.ok(next, `${ref[1]} 토큰이 없다`);
    return parse(next, tokens, depth + 1);
  }
  if (v === "transparent") return [0, 0, 0, 0];
  const mix = v.match(/^color-mix\((.*)\)$/);
  if (mix) {
    const [space, first, second] = splitTop(mix[1]!);
    assert.equal(space, "in srgb", `${v}: srgb만 읽는다`);
    const pct = first!.match(/^(.*)\s+([\d.]+)%$/);
    assert.ok(pct, `${v}: 첫 색에 비율이 없다`);
    const a = parse(pct[1]!, tokens, depth + 1);
    const b = parse(second!, tokens, depth + 1);
    const wa = (Number(pct[2]) / 100) * a[3], wb = (1 - Number(pct[2]) / 100) * b[3];
    const alpha = wa + wb;
    return alpha === 0 ? [0, 0, 0, 0] : ([0, 1, 2].map((i) => (a[i]! * wa + b[i]! * wb) / alpha).concat(alpha) as RGBA);
  }
  const hex = v.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const rgb = v.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`읽을 수 없는 색: ${v}`);
}

const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as RGBA;

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(fg: RGBA, bg: RGBA): number {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// 층은 바탕(0) < 패널(1) < 카드(2) < 떠 있는 것(3)으로 겹쳐 놓인다(:root 주석). 반투명 층은 아래 층 위에 합성한다.
function surfaces(tokens: Map<string, string>): Record<string, RGBA> {
  const c = (name: string) => parse(tokens.get(name)!, tokens);
  const bg = c("--bg");
  const chrome = over(c("--chrome"), bg);
  const panel = over(c("--panel"), bg);
  const panel2 = over(c("--panel-2"), panel);
  const panel3 = over(c("--panel-3"), panel2);
  return { "--bg": bg, "--chrome": chrome, "--panel": panel, "--panel-2": panel2, "--panel-3": panel3 };
}


const LAYERS = "LAYERS";
interface Pair {
  fg: string; // 글자(또는 선) 색: 토큰이나 색 식
  bg: string; // 바탕: 토큰이나 색 식, 또는 LAYERS(바탕·chrome·패널 다섯 층 전부)
  min: number;
  over?: string; // 바탕이 반투명이면 얹히는 층(기본 --panel)
  why: string;
}

const TEXT = 4.5; // WCAG 1.4.3 본문 글자
const UI = 3; // WCAG 1.4.11 컨트롤 테두리·포커스 링

// 선언표: 화면이 실제로 그리는 짝. 최소 비율을 낮추지 않는다. 지금 못 넘는 짝은 KNOWN에 고칠 단위와 함께 둔다.
// --line(구분선)·--fids-line·--paper-line은 장식이라 1.4.11 대상이 아니어서 표에 없다. 컨트롤 테두리는 --line-strong이다.
export const PAIRS: Pair[] = [
  ...["--text", "--muted", "--faint"].map((fg) => ({ fg, bg: LAYERS, min: TEXT, why: "글자 3단" })),
  ...["--radar", "--amber", "--cyan", "--alert", "--blue"].map((fg) => ({ fg, bg: LAYERS, min: TEXT, why: "신호색 글자(.atfm-tag의 --panel-3 위 글자 포함)" })),
  { fg: "--line-strong", bg: LAYERS, min: UI, why: "컨트롤 테두리" },
  { fg: "--cyan", bg: LAYERS, min: UI, why: "포커스 링(:focus-visible outline)" },
  ...["--paper-ink", "--paper-muted", "--stamp-red", "--stamp-amber", "--stamp-blue", "--stamp-gray"].flatMap((fg) =>
    ["--paper", "--paper-parked"].map((bg) => ({ fg, bg, min: TEXT, why: "FLIGHT STRIP 종이" })),
  ),
  ...["--fids-title", "--flap-ink", "--fids-count"].flatMap((fg) =>
    ["--fids-bg", "--fids-card"].map((bg) => ({ fg, bg, min: TEXT, why: "FIDS 판" })),
  ),
  { fg: "--bg", bg: "--phase-cleared", min: TEXT, why: ".pr-badge.is-cleared" },
  { fg: "--text", bg: "color-mix(in srgb, var(--phase-approach) 22%, transparent)", min: TEXT, why: ".pr-badge.is-approach" },
  { fg: "#fff", bg: "--alert", min: TEXT, why: ".los-tag" },
  { fg: "--text", bg: "color-mix(in srgb, var(--cyan) 10%, var(--chrome))", min: TEXT, why: ".new-version-bar·.update-bar" },
  { fg: "--text", bg: "color-mix(in srgb, var(--amber) 10%, var(--chrome))", min: TEXT, why: ".update-bar 호박" },
];

// 지금 못 넘는 짝: 키는 `테마 fg on bg`, 값은 고칠 단위. 고쳐지면 지우고, 목록에 없는 실패는 테스트를 깬다.
const KNOWN: Record<string, string> = {
  "radar --alert on --panel-3": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 4.16:1
  "radar --line-strong on --bg": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.58:1
  "radar --line-strong on --chrome": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.44:1
  "radar --line-strong on --panel": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.32:1
  "radar --line-strong on --panel-2": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.04:1
  "radar --line-strong on --panel-3": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 1.77:1
  "radar --stamp-red on --paper-parked": "unfiled: darken the stamp inks on parked paper or lighten --paper-parked", // 3.04:1
  "radar --stamp-amber on --paper": "unfiled: darken the stamp inks on parked paper or lighten --paper-parked", // 3.56:1
  "radar --stamp-amber on --paper-parked": "unfiled: darken the stamp inks on parked paper or lighten --paper-parked", // 2.24:1
  "radar --stamp-blue on --paper-parked": "unfiled: darken the stamp inks on parked paper or lighten --paper-parked", // 3.26:1
  "radar --stamp-gray on --paper-parked": "unfiled: darken the stamp inks on parked paper or lighten --paper-parked", // 3.31:1
  "radar #fff on --alert": "unfiled: .los-tag text colour (dark on --alert) or a lighter-text token", // 3.32:1
  "cockpit --alert on --panel-3": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 4.30:1
  "cockpit --line-strong on --panel": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.95:1
  "cockpit --line-strong on --panel-2": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.64:1
  "cockpit --line-strong on --panel-3": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.28:1
  "cockpit #fff on --alert": "unfiled: .los-tag text colour (dark on --alert) or a lighter-text token", // 3.27:1
  "night --line-strong on --bg": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.28:1
  "night --line-strong on --chrome": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.30:1
  "night --line-strong on --panel": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.37:1
  "night --line-strong on --panel-2": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.40:1
  "night --line-strong on --panel-3": "ATC-439: the theme generator re-expresses the palettes; raise --line-strong / --alert there", // 2.24:1
  "night #fff on --alert": "unfiled: .los-tag text colour (dark on --alert) or a lighter-text token", // 2.73:1
};

const expr = (v: string) => (v.startsWith("--") ? `var(${v})` : v);

function results(theme: string, tokens: Map<string, string>): { key: string; line: string; pass: boolean }[] {
  const layers = surfaces(tokens);
  const out: { key: string; line: string; pass: boolean }[] = [];
  for (const p of PAIRS) {
    const beds: [string, RGBA][] =
      p.bg === LAYERS ? Object.entries(layers) : [[p.bg, over(parse(expr(p.bg), tokens), layers[p.over ?? "--panel"]!)]];
    for (const [name, bed] of beds) {
      const r = ratio(over(parse(expr(p.fg), tokens), bed), bed);
      const key = `${theme} ${p.fg} on ${p.bg === LAYERS ? name : p.bg}`;
      out.push({ key, pass: r >= p.min, line: `${key}: ${r.toFixed(2)}:1, 최소 ${p.min}:1 (${p.why})` });
    }
  }
  return out;
}

test("styles.css에서 radar·cockpit·night 테마를 찾는다", () => {
  for (const t of ["radar", "cockpit", "night"]) assert.ok(THEMES[t], `${t} 테마가 없다`);
});

for (const [theme, tokens] of Object.entries(THEMES)) {
  test(`${theme}: 선언표의 모든 짝이 최소 비율 이상(알려진 예외 제외)`, () => {
    const bad = results(theme, tokens).filter((f) => !f.pass && !(f.key in KNOWN));
    assert.deepEqual(bad.map((f) => f.line), []);
  });
}

test("KNOWN 예외는 아직 실패하는 짝만 가리킨다(고쳐졌으면 지운다)", () => {
  const all = new Map(Object.entries(THEMES).flatMap(([t, tk]) => results(t, tk).map((f) => [f.key, f] as const)));
  for (const key of Object.keys(KNOWN)) {
    assert.ok(all.has(key), `${key}: 표에 없는 짝`);
    assert.ok(!all.get(key)!.pass, `${key}: 이제 통과한다. KNOWN에서 지운다`);
  }
});
