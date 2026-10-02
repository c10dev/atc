import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BASELINE, type Counts, countsOf, type Finding, lintCss, lintTsx, lintWeb, ratchetOf } from "./css-lint.ts";

const rules = (fs: Finding[]) => fs.map((f) => f.rule);
const css = (text: string, file = "web/src/views/X.css") => lintCss(text, file);

test("color-literal: hex, rgb(·hsl(·oklch( 리터럴은 걸리고 var()·transparent·currentColor는 통과", () => {
  assert.deepEqual(rules(css(".a { color: #fff; }")), ["color-literal"]);
  assert.deepEqual(rules(css(".a { background: #ff8f3a80; }")), ["color-literal"]);
  assert.deepEqual(rules(css(".a { background: rgba(0, 0, 0, 0.35); }")), ["color-literal"]);
  assert.deepEqual(rules(css(".a { color: hsl(10 20% 30%); border-color: oklch(0.7 0.1 200); }")), ["color-literal", "color-literal"]);
  assert.deepEqual(rules(css(".a { background: linear-gradient(0deg, #000, #fff); }")), ["color-literal"]); // 선언마다 한 번
  assert.deepEqual(css(".a { color: var(--text); background: transparent; border-color: currentColor; outline-color: inherit; }"), []);
  assert.deepEqual(css(".a { background: color-mix(in srgb, var(--alert) 20%, transparent); }"), []);
  assert.deepEqual(css('.a::after { content: "#fff"; background: url(data:image/svg+xml;utf8,<svg fill=\'%23fff\'/>); }'), []); // 문자열·url 안은 아니다
  assert.deepEqual(css("/* color: #fff; */ .a { color: var(--text); }"), []); // 주석
});

test("color-literal: styles.css의 :root·테마 블록 토큰 정의는 허용, 다른 곳의 --이름 정의는 아니다", () => {
  assert.deepEqual(css(":root { --bg: #05080c; --panel: rgb(1, 2, 3); }", "web/src/styles.css"), []);
  assert.deepEqual(css(':root[data-theme="night"] { --bg: #0a0b1e; }', "web/src/styles.css"), []);
  assert.deepEqual(rules(css(".a { --mine: #fff; }", "web/src/styles.css")), ["color-literal"]); // :root가 아님
  assert.deepEqual(rules(css(":root { --bg: #05080c; }", "web/src/views/X.css")), ["color-literal"]); // styles.css가 아님
  assert.deepEqual(rules(css(":root { color: #fff; }", "web/src/styles.css")), ["color-literal"]); // 토큰 정의가 아니라 선언
});

test("font-size-px: px·rem 리터럴은 걸리고 var(--text-…)·%는 통과, font 약식은 크기 칸만 본다", () => {
  assert.deepEqual(rules(css(".a { font-size: 12px; }")), ["font-size-px"]);
  assert.deepEqual(rules(css(".a { font-size: 0.75rem; }")), ["font-size-px"]);
  assert.deepEqual(rules(css(".a { font: 700 11px var(--mono); }")), ["font-size-px"]);
  assert.deepEqual(css(".a { font-size: var(--text-sm); }"), []);
  assert.deepEqual(css(".b { font-size: 90%; } .c { font-size: calc(var(--text-sm) * 1.1); }"), []);
  assert.deepEqual(css(".a { font: 700 var(--text-2xs)/15px var(--mono); }"), []); // line-height의 px는 font-size가 아니다
  assert.deepEqual(css(".a { line-height: 16px; letter-spacing: 1px; }"), []);
});

test("font-size-em(ATC-410): font-size와 font 약식의 em은 걸리고 var·%·line-height의 em은 통과", () => {
  assert.deepEqual(rules(css(".a { font-size: 1.2em; }")), ["font-size-em"]);
  assert.deepEqual(rules(css(".a { font: 700 0.9em var(--mono); }")), ["font-size-em"]);
  assert.deepEqual(css(".a { font-size: var(--text-sm); } .b { font-size: 90%; } .c { font: 700 var(--text-xs)/1.4em var(--mono); } .d { padding: 1em; }"), []);
  assert.deepEqual(rules(css(".a { font-size: 1.5rem; }")), ["font-size-px"]); // rem은 em 규칙이 아니라 font-size-px
});

test("spacing-literal(ATC-410): 간격 속성의 0이 아닌 px는 걸리고 0·var(--space-…)·em·%는 통과, 토큰 정의는 허용", () => {
  assert.deepEqual(rules(css(".a { padding: 8px; margin: 0 12px; gap: 4px; }")), ["spacing-literal", "spacing-literal", "spacing-literal"]);
  assert.equal(rules(css(".a { padding-top: 6px; margin-inline: 2px; row-gap: 3px; column-gap: 3px; inset: 4px; top: -2px; left: 1px; }")).length, 7);
  assert.deepEqual(rules(css(".a { padding: calc(var(--space-2) + 3px); }")), ["spacing-literal"]);
  assert.deepEqual(css(".a { padding: 0; margin: 0px auto; gap: var(--space-2); inset: 0; top: 50%; left: 1em; padding: var(--space-1) var(--space-3, 12px); }"), []);
  assert.deepEqual(css(".a { width: 12px; height: 4px; border: 1px solid var(--line); line-height: 16px; transform: translateX(8px); }"), []); // 간격 속성이 아니다
  assert.deepEqual(css(":root { --space-3: 12px; --gutter: 24px; }", "web/src/styles.css"), []); // 토큰 정의
  assert.deepEqual(css(':root[data-theme="night"] { --space-3: 12px; }', "web/src/styles.css"), []);
});

test("radius-literal(ATC-410): var(--radius-…)·50%·0이 아닌 border-radius는 걸린다, 세부 속성도", () => {
  assert.deepEqual(rules(css(".a { border-radius: 4px; }")), ["radius-literal"]);
  assert.deepEqual(rules(css(".a { border-radius: 999px; } .b { border-top-left-radius: 6px; }")), ["radius-literal", "radius-literal"]);
  assert.deepEqual(rules(css(".a { border-radius: var(--radius-md) 4px; }")), ["radius-literal"]);
  assert.deepEqual(rules(css(".a { border-radius: 0.5rem; }")), ["radius-literal"]);
  assert.deepEqual(css(".a { border-radius: var(--radius-md); } .b { border-radius: 50%; } .c { border-radius: var(--radius-sm) var(--radius-sm) 0 0; } .d { border-radius: 0; }"), []);
  assert.deepEqual(css(":root { --radius-md: 8px; --radius-sm: 4px; }", "web/src/styles.css"), []); // 토큰 정의
});

test("z-index-literal: var(--z-…)만 통과(auto 포함), 숫자는 걸린다", () => {
  assert.deepEqual(rules(css(".a { z-index: 10; }")), ["z-index-literal"]);
  assert.deepEqual(rules(css(".a { z-index: 9999 !important; }")), ["z-index-literal"]);
  assert.deepEqual(rules(css(".a { z-index: -1; }")), ["z-index-literal"]);
  assert.deepEqual(rules(css(".a { z-index: var(--other); }")), ["z-index-literal"]);
  assert.deepEqual(css(".a { z-index: var(--z-drawer); } .b { z-index: calc(var(--z-drawer) + 1); } .c { z-index: auto; }"), []);
});

test("transition-all: transition: all과 transition-property: all은 걸리고 이름 있는 속성은 통과", () => {
  assert.deepEqual(rules(css(".a { transition: all 0.2s ease; }")), ["transition-all"]);
  assert.deepEqual(rules(css(".a { transition: color 0.1s, all 0.2s; }")), ["transition-all"]);
  assert.deepEqual(rules(css(".a { transition-property: all; }")), ["transition-all"]);
  assert.deepEqual(css(".a { transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast); transition-property: opacity, transform; }"), []);
  assert.deepEqual(css(".a { transition: none; }"), []);
});

test("outline-none: :focus-visible 규칙이 없으면 걸리고, 같은 선택자(자손 포함)의 규칙이 있으면 통과", () => {
  assert.deepEqual(rules(css(".a { outline: none; }")), ["outline-none"]);
  assert.deepEqual(rules(css(".a { outline: 0; }")), ["outline-none"]);
  assert.deepEqual(rules(css(".a { outline-style: none; }")), ["outline-none"]);
  assert.deepEqual(rules(css(".a:focus { outline: none; }")), ["outline-none"]);
  assert.deepEqual(rules(css(".a:focus-visible { outline: none; }")), ["outline-none"]); // 자기 자신은 대체가 아니다
  assert.deepEqual(css(".a { outline: none; } .a:focus-visible { outline: 2px solid var(--cyan); }"), []);
  assert.deepEqual(css(".a:focus { outline: none; } .a:focus-visible { box-shadow: var(--ring); }"), []);
  assert.deepEqual(css(".a:focus:not(:focus-visible) { outline: none; } .a:focus-visible { outline: 2px solid var(--cyan); }"), []);
  assert.deepEqual(css(".a { outline: none; }\n.a:focus-visible .hit { stroke: var(--cyan); }"), []); // 눈에 보이는 대체(자손)
  assert.deepEqual(rules(css(".a { outline: none; } .b:focus-visible { outline: 2px solid red; }")), ["outline-none"]); // 다른 선택자
  assert.deepEqual(css(".a { outline: 1px solid var(--line); }"), []);
});

test("css: 줄 번호, @media 안, 여러 선언, 마지막 ;없는 선언", () => {
  const fs = css(".a {\n  color: var(--text);\n}\n@media (max-width: 700px) {\n  .a {\n    color: #fff\n  }\n}\n");
  assert.deepEqual(fs.map((f) => `${f.rule}@${f.line}`), ["color-literal@6"]);
  assert.match(fs[0].text, /color: #fff/);
  // 쉼표로 이은 선택자도 각각 확인한다
  assert.deepEqual(css(".a:focus, .b:focus { outline: none; } .a:focus-visible { outline: 2px solid red; }").length, 1);
});

const tsx = (text: string, file = "web/src/X.tsx") => lintTsx(text, file);

test("tsx: style={{…}}의 색·font-size 리터럴과 SVG 색 속성은 걸리고 var()·주석·일반 문자열은 통과", () => {
  assert.deepEqual(rules(tsx('<div style={{ color: "#fff" }} />')), ["color-literal"]);
  assert.deepEqual(rules(tsx("<div style={{ background: `rgba(0,0,0,.4)`, fontSize: 12 }} />")), ["color-literal", "font-size-px"]);
  assert.deepEqual(rules(tsx('<div style={{ fontSize: "0.8rem" }} />')), ["font-size-px"]);
  assert.deepEqual(rules(tsx('<circle fill="#20264a" stroke="rgb(1,2,3)" />')), ["color-literal", "color-literal"]);
  assert.deepEqual(tsx('<div style={{ color: "var(--text)", fontSize: "var(--text-sm)", width: 12 }} />'), []);
  assert.deepEqual(tsx('<circle fill="var(--radar)" />'), []);
  assert.deepEqual(tsx('// PR 한 줄: "vocado_nextjs#400"\nconst a = "#fff"; /* #abc */'), []); // style 밖의 문자열·주석은 보지 않는다
  assert.deepEqual(tsx('<div style={{ color: "var(--a)" }} /> // style={{ color: "#fff" }}'), []);
  // 줄 번호
  assert.equal(tsx('const a = 1;\n<div style={{ color: "#fff" }} />')[0].line, 2);
});

test("tsx(ATC-410): style의 간격·둥근 모서리·em 글자 크기도 같은 규칙", () => {
  assert.deepEqual(rules(tsx("<div style={{ padding: 8, marginTop: 4 }} />")), ["spacing-literal", "spacing-literal"]);
  assert.deepEqual(rules(tsx('<div style={{ gap: "6px", borderRadius: 4, fontSize: "1.1em" }} />')), ["font-size-em", "spacing-literal", "radius-literal"]);
  assert.deepEqual(tsx('<div style={{ padding: 0, gap: "var(--space-2)", borderRadius: "var(--radius-md)", top: "50%", width: 12 }} />'), []);
  assert.deepEqual(tsx("<div style={{ borderRadius: '50%' }} />"), []);
});

test("ratchetOf: 늘었거나 기준선에 없는 칸은 added, 줄어든 칸은 dropped, 같으면 비어 있다", () => {
  const base: Counts = { "web/src/a.css": { "color-literal": 2 }, "web/src/b.css": { "outline-none": 1 } };
  assert.deepEqual(ratchetOf(base, base), { added: [], dropped: [] });
  assert.deepEqual(ratchetOf({ ...base, "web/src/a.css": { "color-literal": 3 } }, base).added, [{ file: "web/src/a.css", rule: "color-literal", was: 2, now: 3 }]);
  assert.deepEqual(ratchetOf({ ...base, "web/src/new.css": { "z-index-literal": 1 } }, base).added, [{ file: "web/src/new.css", rule: "z-index-literal", was: 0, now: 1 }]); // 새 파일
  assert.deepEqual(ratchetOf({ ...base, "web/src/a.css": { "color-literal": 2, "transition-all": 1 } }, base).added, [{ file: "web/src/a.css", rule: "transition-all", was: 0, now: 1 }]); // 새 규칙
  assert.deepEqual(ratchetOf({ "web/src/a.css": { "color-literal": 1 } }, base).dropped, [
    { file: "web/src/a.css", rule: "color-literal", was: 2, now: 1 },
    { file: "web/src/b.css", rule: "outline-none", was: 1, now: 0 },
  ]);
  // 새 hex 색이 하나 더해지면 added가 생긴다(아래 ratchet 테스트가 실패하는 조건)
  const withHex = countsOf([...Object.values(base).flatMap(() => []), ...css(".x { color: #abc; }", "web/src/a.css")]);
  assert.equal(ratchetOf(withHex, { "web/src/a.css": {} }).added.length, 1);
});

// web/src의 모든 .css·.tsx를 읽어 기준선(web/css-lint-baseline.json)과 비교한다. 새 위반만 실패한다
test("ratchet: web/src의 위반은 web/css-lint-baseline.json보다 늘지 않는다", () => {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Counts;
  const findings = lintWeb();
  const r = ratchetOf(countsOf(findings), baseline);
  const where = (file: string, rule: string) => findings.filter((f) => f.file === file && f.rule === rule).map((f) => `  ${f.file}:${f.line} ${f.text}`).join("\n");
  assert.deepEqual(
    r.added,
    [],
    `새 CSS 토큰 위반(docs/design-language.md 5절 13번):\n${r.added.map((a) => `${a.file} ${a.rule}: ${a.was} → ${a.now}\n${where(a.file, a.rule)}`).join("\n")}\n` +
      "색은 var(--…) 토큰, 글자 크기는 var(--text-…), 간격은 var(--space-…), 둥근 모서리는 var(--radius-…), z-index는 var(--z-…), transition은 속성 이름, outline: none에는 :focus-visible 규칙을 쓴다.",
  );
  assert.deepEqual(r.dropped, [], `위반이 줄었다. 기준선을 낮춘다: node server/css-lint.ts --update\n${r.dropped.map((d) => `${d.file} ${d.rule}: ${d.was} → ${d.now}`).join("\n")}`);
});
