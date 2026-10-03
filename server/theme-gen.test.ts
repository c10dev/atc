import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyGenerated, block, generate, parseHex, STEPS, THEMES, toHex } from "../web/src/theme-gen.ts";

// 테마 생성기(ATC-439, design-system S1): 순수 함수, 커밋된 CSS와 출력의 일치, 손으로 쓰던 값과의 허용 오차.
const CSS = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("같은 입력은 같은 출력이고, 팔레트 11단과 신호 다섯 색을 낸다", () => {
  for (const t of THEMES) {
    const a = generate(t), b = generate(structuredClone(t));
    assert.deepEqual(a, b);
    for (let n = 1; n <= 11; n++) assert.ok(a.palette[`--n-${n}`], `${t.name} --n-${n}`);
    assert.equal(Object.keys(a.palette).filter((k) => k.startsWith("--hue-")).length, 5);
    for (const s of STEPS) assert.equal(a.semantic[s.token], `var(--n-${s.n})`);
    for (const [hue, hex] of Object.entries(t.hues)) assert.equal(a.palette[`--hue-${hue}`], hex);
  }
});

test("단은 밝아지는 순서로 서고, 입력 contrast가 선을 바탕에서 더 멀리 둔다", () => {
  const t = THEMES[0]!;
  const lum = (v: string) => parseHex(v).reduce((x, y) => x + y, 0);
  const g = generate(t).palette;
  const order = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => lum(g[`--n-${n}`]!));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  const hi = generate({ ...t, contrast: 1.5 }).palette;
  assert.ok(lum(hi["--n-8"]!) > lum(g["--n-8"]!));
  assert.equal(hi["--n-4"], g["--n-4"], "panel은 contrast와 상관없다");
});

test("바탕과 글자는 그대로 나온다", () => {
  for (const t of THEMES) {
    const g = generate(t).palette;
    assert.equal(g["--n-1"], toHex(parseHex(t.bg)));
    assert.equal(g["--n-11"], toHex(parseHex(t.fg)));
  }
});

test("glass 테마는 면과 선이 반투명이고 solid 테마는 아니다", () => {
  for (const t of THEMES) {
    const g = generate(t).palette;
    for (const n of [2, 3, 4, 5, 6, 7, 8]) assert.equal(g[`--n-${n}`]!.startsWith("rgba("), !!t.glass, `${t.name} --n-${n}`);
  }
});

test("커밋된 styles.css의 테마 블록은 생성기 출력과 같다(손으로 고치지 않았다)", () => {
  for (const t of THEMES) assert.ok(CSS.includes(block(t)), `${t.name}: styles.css의 theme-gen 블록이 생성기 출력과 다르다. node web/gen-themes.ts`);
  assert.equal(applyGenerated(CSS), CSS);
});

test("생성한 토큰은 생성 블록 밖에서 다시 정해지지 않는다", () => {
  const generated = new Set(THEMES.flatMap((t) => Object.keys({ ...generate(t).palette, ...generate(t).semantic })));
  for (const t of THEMES) {
    const sel = t.name === "radar" ? ":root {" : `:root[data-theme="${t.name}"] {`;
    const start = CSS.indexOf(sel);
    const body = CSS.slice(start, CSS.indexOf("\n}", start));
    const outside = body.slice(0, body.indexOf(`/* theme-gen:${t.name} begin`)) + body.slice(body.indexOf(`/* theme-gen:${t.name} end */`));
    for (const m of outside.matchAll(/^\s*(--[\w-]+):/gm)) assert.ok(!generated.has(m[1]!), `${t.name}: ${m[1]}는 생성기가 쓴다. 입력을 고친다`);
  }
});

// 손으로 쓰던 값(ATC-439 전의 styles.css). 허용 오차 안에서 같은 색이어야 한다(채널당 /255).
const TOLERANCE = 12;
const TODAY: Record<string, Record<string, string>> = {
  radar: { "--bg": "#05080c", "--scope": "#070c0f", "--chrome": "#0b1118", "--panel": "#0f1720", "--panel-2": "#182330", "--panel-3": "#212e3d", "--line": "#2a3a4c", "--line-strong": "#3d5470", "--faint": "#8797a9", "--muted": "#a3b0bf", "--text": "#dde6ee" },
  cockpit: { "--bg": "#060a14", "--scope": "#070c18", "--chrome": "#080d1a", "--panel": "#0d1528", "--panel-2": "#142038", "--panel-3": "#1c2b4a", "--line": "#2c3d66", "--line-strong": "#4260a0", "--faint": "#8e9dbe", "--muted": "#b0bdd6", "--text": "#f2f5fa" },
  // night는 반투명이라 위에서 아래로 쌓은 색으로 잰다(아래 compose)
  night: { "--bg": "#03040d", "--scope": "rgba(8, 10, 32, 0.3)", "--chrome": "rgba(6, 8, 26, 0.55)", "--panel": "rgba(18, 24, 58, 0.5)", "--panel-2": "rgba(28, 36, 82, 0.6)", "--panel-3": "rgba(40, 50, 108, 0.85)", "--line": "rgba(170, 190, 255, 0.16)", "--line-strong": "rgba(190, 205, 255, 0.34)", "--faint": "#929bc8", "--muted": "#aab3d9", "--text": "#eef0ff" },
};
const HUES: Record<string, Record<string, string>> = {
  radar: { radar: "#3ef08f", amber: "#ffb627", cyan: "#5cd0ff", alert: "#ff4a4a", blue: "#8aa8ff" },
  cockpit: { radar: "#3cf06e", amber: "#ffbf1f", cyan: "#29e0ff", alert: "#ff4d4d", blue: "#29e0ff" },
  night: { radar: "#ffd98a", amber: "#9ec2ff", cyan: "#7fe8ff", alert: "#ff6b85", blue: "#c3adff" },
};

type C = [number, number, number, number];
function color(v: string): C {
  const h = v.match(/^#([0-9a-f]{6})$/i);
  if (h) return [...parseHex(v), 1] as C;
  const r = v.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/)!;
  return [+r[1]!, +r[2]!, +r[3]!, +r[4]!];
}
const over = (t: C, u: C): C => [0, 1, 2].map((i) => t[i]! * t[3] + u[i]! * (1 - t[3])).concat(1) as C;
// 면은 chrome·panel·scope이 바탕 위, panel-2는 panel 위, panel-3은 panel-2 위, 선은 panel 위(theme-contrast.test.ts와 같다)
function compose(get: (k: string) => string): Record<string, C> {
  const bg = color(get("--bg"));
  const panel = over(color(get("--panel")), bg);
  const panel2 = over(color(get("--panel-2")), panel);
  const out: Record<string, C> = { "--bg": bg, "--scope": over(color(get("--scope")), bg), "--chrome": over(color(get("--chrome")), bg), "--panel": panel, "--panel-2": panel2, "--panel-3": over(color(get("--panel-3")), panel2) };
  for (const k of ["--line", "--line-strong"]) out[k] = over(color(get(k)), panel);
  for (const k of ["--faint", "--muted", "--text"]) out[k] = color(get(k));
  return out;
}

for (const t of THEMES) {
  test(`${t.name}: 생성한 색이 손으로 쓰던 값과 채널당 ${TOLERANCE} 이내다`, () => {
    const g = generate(t);
    const now = compose((k) => g.palette[g.semantic[k]!.match(/var\((--n-\d+)\)/)![1]!]!);
    const before = compose((k) => TODAY[t.name]![k]!);
    for (const k of Object.keys(before)) {
      const d = Math.max(...[0, 1, 2].map((i) => Math.abs(now[k]![i]! - before[k]![i]!)));
      assert.ok(d <= TOLERANCE, `${t.name} ${k}: 차이 ${d.toFixed(1)}`);
    }
  });
  test(`${t.name}: 신호 다섯 색은 손으로 쓰던 값 그대로다`, () => {
    assert.deepEqual(t.hues, HUES[t.name]);
  });
}
