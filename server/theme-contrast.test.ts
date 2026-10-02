import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 테마 토큰의 글자 대비(ATC-408, design-language 3.1): 가장 흐린 글자(--faint)와 --muted가 모든 층에서 4.5:1 이상.
// styles.css의 :root와 테마 블록에서 토큰 값을 읽고, 반투명 층(night)은 겹쳐 쌓인 그대로 바탕 위에 합성해 잰다.

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
const THEMES: Record<string, Map<string, string>> = {
  radar: ROOT,
  cockpit: new Map([...ROOT, ...block(':root[data-theme="cockpit"]')]),
  night: new Map([...ROOT, ...block(':root[data-theme="night"]')]),
};

function parse(value: string, tokens: Map<string, string>, depth = 0): RGBA {
  const v = value.trim();
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    assert.ok(depth < 10, `${v}: var() 순환`);
    const next = tokens.get(ref[1]!);
    assert.ok(next, `${ref[1]} 토큰이 없다`);
    return parse(next, tokens, depth + 1);
  }
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as RGBA;
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

for (const [theme, tokens] of Object.entries(THEMES)) {
  for (const text of ["--faint", "--muted"]) {
    test(`${theme}: ${text}는 모든 층에서 ${MIN}:1 이상`, () => {
      const fg = parse(tokens.get(text)!, tokens);
      for (const [layer, bg] of Object.entries(surfaces(tokens))) {
        const r = ratio(fg, bg);
        assert.ok(r >= MIN, `${theme} ${text} on ${layer}: ${r.toFixed(2)}:1`);
      }
    });
  }

  test(`${theme}: 세워 둔 FLIGHT STRIP의 --paper-muted는 ${MIN}:1 이상`, () => {
    const s = surfaces(tokens);
    const paper = over(parse(tokens.get("--paper-parked")!, tokens), s["--panel"]!);
    const r = ratio(parse(tokens.get("--paper-muted")!, tokens), paper);
    assert.ok(r >= MIN, `${theme} --paper-muted on --paper-parked: ${r.toFixed(2)}:1`);
  });
}
