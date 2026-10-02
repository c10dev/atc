import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 설정 창의 테마 견본(web/src/settings.ts THEMES[].swatch)이 styles.css의 테마 토큰과 같다(ATC-415, 결정 Q6: .ts는 css-lint 밖).
// 견본마다 다섯 칸이 어느 토큰인지 아래 표가 정한다. 테마 색을 바꾸면 견본도 같이 바꿔야 이 시험이 통과한다.
const CSS = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const TS = readFileSync(new URL("../web/src/settings.ts", import.meta.url), "utf8");

const PINS: Record<string, readonly string[]> = {
  radar: ["--bg", "--radar", "--amber", "--cyan", "--paper"],
  cockpit: ["--bg", "--magenta", "--cyan", "--radar", "--amber"],
  night: ["--sky", "--gold", "--amber", "--cyan", "--blue"],
};

function block(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} 블록이 없다`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+?);/gm)) out.set(m[1]!, m[2]!.trim());
  return out;
}
const ROOT = block(":root");
const TOKENS: Record<string, Map<string, string>> = {
  radar: ROOT,
  cockpit: new Map([...ROOT, ...block(':root[data-theme="cockpit"]')]),
  night: new Map([...ROOT, ...block(':root[data-theme="night"]')]),
};

function resolve(name: string, tokens: Map<string, string>, depth = 0): string {
  assert.ok(depth < 10, `${name}: var() 순환`);
  const v = tokens.get(name);
  assert.ok(v, `${name} 토큰이 없다`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(ref[1]!, tokens, depth + 1) : v.toLowerCase();
}

function swatches(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of TS.matchAll(/id:\s*"(\w+)"[\s\S]*?swatch:\s*\[([^\]]+)\]/g)) out[m[1]!] = [...m[2]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!.toLowerCase());
  return out;
}

test("테마 견본의 색은 그 테마 블록의 토큰과 같다", () => {
  const found = swatches();
  assert.deepEqual(Object.keys(found).sort(), Object.keys(PINS).sort(), "THEMES와 이 시험의 표가 같은 테마를 가진다");
  for (const [theme, pins] of Object.entries(PINS)) {
    assert.equal(found[theme]!.length, pins.length, `${theme} 견본 칸 수`);
    pins.forEach((token, i) => assert.equal(found[theme]![i], resolve(token, TOKENS[theme]!), `${theme} 견본 ${i + 1}번째(${token})가 토큰과 다르다`));
  }
});

test("테마 블록에서만 정의되던 --magenta·--gold·--display는 :root에 기본값이 있다", () => {
  for (const name of ["--magenta", "--gold", "--display"]) assert.ok(ROOT.has(name), `${name}의 :root 기본값이 없다`);
});
