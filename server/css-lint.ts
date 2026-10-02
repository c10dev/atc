// CSS 토큰 린트(ATC-294): docs/design-language.md 5절 13번 "Tokens only"를 기계로 확인한다. 새 의존성 없이 정규식과 작은 토크나이저만 쓴다.
// 순수 함수 lintCss·lintTsx와, web/src 전체를 읽어 세는 lintTree. 비교(ratchet)는 css-lint.test.ts가 web/css-lint-baseline.json과 한다.
// 이 파일은 server/에 둔다: npm test의 glob이 web/을 보지 않고 package.json은 바꾸지 않기 때문이다.
// 기준선 갱신: `node server/css-lint.ts --update`(줄어든 칸을 낮출 때, 새 위반을 받아들일 때가 아니다).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const RULES = ["color-literal", "font-size-px", "font-size-em", "spacing-literal", "radius-literal", "z-index-literal", "transition-all", "outline-none"] as const;
export type Rule = (typeof RULES)[number];

export interface Finding {
  file: string;
  line: number;
  rule: Rule;
  text: string; // 위반한 선언이나 조각(한 줄)
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const HAS_COLOR = new RegExp(COLOR.source);
const SIZE_PX = /(?:^|[^\w.-])-?\d*\.?\d+(?:px|rem)\b/;
const SIZE_EM = /(?:^|[^\w.-])-?\d*\.?\d+em\b/; // rem은 앞이 영문자라 걸리지 않는다
// 간격 속성(ATC-410, Q6): padding·margin·gap·inset·top/right/bottom/left와 그 세부 속성. 0이 아닌 px 리터럴은 var(--space-…)로
const SPACING_PROP = /^(?:padding|margin|inset)(?:-[a-z]+)*$|^(?:row-|column-)?gap$|^(?:top|right|bottom|left)$/;
const PX_NONZERO = /(?:^|[^\w.-])-?(?:0*[1-9]\d*\.?\d*|0*\.\d*[1-9]\d*)px\b/;
// 둥근 모서리: 세부 속성(border-top-left-radius …)도 같다
const RADIUS_PROP = /^border(?:-[a-z]+)*-radius$/;
// var(--radius-…)·50%·0·전역 키워드만 통과
const RADIUS_OK = /^(?:var\(--radius-[\w-]+\)|50%|0|inherit|initial|unset|revert)$/;

// 같은 길이로 가린다(줄 번호를 지킨다): 주석은 공백, 문자열 안은 공백(따옴표는 남김)
function blank(text: string, withStrings: boolean): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (withStrings && (c === '"' || c === "'")) {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      out += c + text.slice(i + 1, j).replace(/[^\n]/g, " ") + (text[j] === c ? c : "");
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const lineOf = (text: string, at: number) => text.slice(0, at).split("\n").length;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

interface Rule_ {
  prelude: string;
  at: number; // 규칙 시작 위치(원문)
  decls: { prop: string; value: string; at: number }[];
  atRule: boolean;
}

// 아주 작은 CSS 읽기: 규칙(선택자와 선언)을 펼쳐 모은다. @media 같은 안쪽 규칙도 펼친다
function rulesOf(text: string): Rule_[] {
  const out: Rule_[] = [];
  const stack: Rule_[] = [];
  let start = 0;
  const flushDecl = (end: number) => {
    const top = stack.at(-1);
    const chunk = text.slice(start, end);
    const colon = chunk.indexOf(":");
    if (top && !top.atRule && colon > 0 && chunk.slice(0, colon).trim()) top.decls.push({ prop: chunk.slice(0, colon).trim().toLowerCase(), value: chunk.slice(colon + 1).trim(), at: start + chunk.search(/\S/) });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      const prelude = text.slice(start, i).trim();
      const r: Rule_ = { prelude, at: start + (text.slice(start, i).search(/\S/) < 0 ? 0 : text.slice(start, i).search(/\S/)), decls: [], atRule: prelude.startsWith("@") && !/^@(?:font-face|page)\b/.test(prelude) };
      stack.push(r);
      out.push(r);
      start = i + 1;
    } else if (c === ";") {
      flushDecl(i);
      start = i + 1;
    } else if (c === "}") {
      flushDecl(i);
      stack.pop();
      start = i + 1;
    }
  }
  return out;
}

// styles.css의 :root와 테마 블록: 토큰(--이름)을 정의하는 곳이라 색 리터럴이 허용된다
const isTokenBlock = (file: string, r: Rule_) => /(^|\/)styles\.css$/.test(file) && /^:root\b/.test(r.prelude);

export function lintCss(raw: string, file: string): Finding[] {
  const text = blank(raw, true);
  const rules = rulesOf(text);
  const out: Finding[] = [];
  const add = (rule: Rule, at: number, snippet: string) => out.push({ file, line: lineOf(text, at), rule, text: oneLine(snippet) });
  const focusVisible = rules.filter((r) => !r.atRule).flatMap((r) => r.prelude.split(",").map((s) => s.trim()).filter((s) => s.includes(":focus-visible")).map((s) => ({ sel: s, r })));
  for (const r of rules) {
    if (r.atRule) continue;
    for (const d of r.decls) {
      const decl = `${d.prop}: ${d.value}`;
      const value = d.value.replace(/url\([^)]*\)/g, "url()");
      // color-literal: 토큰 블록의 --이름 정의는 허용
      if (!(d.prop.startsWith("--") && isTokenBlock(file, r))) {
        if (HAS_COLOR.test(value)) add("color-literal", d.at, decl); // 선언마다 한 번(그라디언트 점이 늘어도 한 칸)
      }
      // font-size-px: font-size와 font 약식의 px·rem 리터럴(var(--text-…)는 통과)
      // font 약식은 크기 칸만 본다: "/15px" 같은 line-height는 font-size가 아니다
      const sizePart = (d.prop === "font" ? value.replace(/\/\s*[^\s]+/, "") : value).replace(/var\([^)]*\)/g, "var()");
      if ((d.prop === "font-size" || d.prop === "font") && SIZE_PX.test(sizePart)) add("font-size-px", d.at, decl);
      if ((d.prop === "font-size" || d.prop === "font") && SIZE_EM.test(sizePart)) add("font-size-em", d.at, decl);
      // spacing-literal: 0이 아닌 px(var() 안은 토큰 줄이라 보지 않는다)
      if (SPACING_PROP.test(d.prop) && PX_NONZERO.test(value.replace(/var\([^)]*\)/g, "var()"))) add("spacing-literal", d.at, decl);
      // radius-literal: 값 조각마다 var(--radius-…)·50%·0이어야 한다
      if (RADIUS_PROP.test(d.prop) && value.replace(/!important/i, "").split(/[\s/]+/).filter(Boolean).some((part) => !RADIUS_OK.test(part))) add("radius-literal", d.at, decl);
      // z-index-literal: var(--z-…)만. auto는 쌓임 맥락을 만들지 않아 허용
      if (d.prop === "z-index" && !/var\(--z-[\w-]+\)/.test(value) && value.trim() !== "auto") add("z-index-literal", d.at, decl);
      // transition-all
      if ((d.prop === "transition" && /(?:^|,)\s*all\b/.test(value)) || (d.prop === "transition-property" && /\ball\b/.test(value))) add("transition-all", d.at, decl);
      // outline-none: 같은 파일에 같은 선택자의 :focus-visible 규칙(자손 선택자 포함, 눈에 보이는 대체)이 없을 때
      if ((d.prop === "outline" && /^(?:none|0)\b/.test(value.trim())) || (d.prop === "outline-style" && /^none\b/.test(value.trim()))) {
        const bases = r.prelude.split(",").map((s) => s.trim().replace(/:focus(?::not\(:focus-visible\))?$|:focus-visible$/, ""));
        const covered = bases.every((b) => focusVisible.some((f) => f.r !== r && (f.sel === `${b}:focus-visible` || f.sel.startsWith(`${b}:focus-visible `))));
        if (!covered) add("outline-none", d.at, `${r.prelude} { ${decl} }`);
      }
    }
  }
  return out;
}

// 주석만 가린다(문자열 안의 //는 그대로)
function blankJs(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// style={{ … }}의 바깥 괄호 짝을 찾는다
function styleBlocks(text: string): { at: number; body: string }[] {
  const out: { at: number; body: string }[] = [];
  for (const m of text.matchAll(/style=\{\{/g)) {
    let depth = 2;
    let j = m.index! + m[0].length;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    out.push({ at: m.index!, body: text.slice(m.index! + m[0].length, j - 2) });
  }
  return out;
}

export function lintTsx(raw: string, file: string): Finding[] {
  const text = blankJs(raw);
  const out: Finding[] = [];
  const add = (rule: Rule, at: number, snippet: string) => out.push({ file, line: lineOf(text, at), rule, text: oneLine(snippet) });
  for (const b of styleBlocks(text)) {
    for (const m of b.body.matchAll(COLOR)) add("color-literal", b.at, `style ${m[0]}`);
    for (const m of b.body.matchAll(/\bfontSize\s*:\s*(?:\d|["'`]\s*-?\d*\.?\d+(?:px|rem)\b)/g)) add("font-size-px", b.at, `style ${m[0]}`);
  }
  for (const b of styleBlocks(text)) {
    for (const m of b.body.matchAll(/\bfontSize\s*:\s*["'`]\s*-?\d*\.?\d+em\b/g)) add("font-size-em", b.at, `style ${m[0]}`);
    // 간격: 숫자 값(React가 px로 읽는다)과 "12px" 문자열. 0과 var(--space-…)는 통과
    for (const m of b.body.matchAll(/\b((?:padding|margin|inset)(?:Top|Right|Bottom|Left|Inline|Block)?(?:Start|End)?|rowGap|columnGap|gap|top|right|bottom|left)\s*:\s*([^,}]*)/g)) {
      const v = m[2].replace(/var\([^)]*\)/g, "var()");
      if (/^\s*-?(?:0*[1-9]\d*\.?\d*|0*\.\d*[1-9]\d*)\s*$/.test(v) || PX_NONZERO.test(v)) add("spacing-literal", b.at, `style ${m[0].trim()}`);
    }
    for (const m of b.body.matchAll(/\b(border(?:Top|Bottom)?(?:Left|Right)?Radius)\s*:\s*([^,}]*)/g)) {
      const v = m[2].trim().replace(/^["'`]|["'`]$/g, "");
      if (v.split(/[\s/]+/).filter(Boolean).some((part) => !RADIUS_OK.test(part))) add("radius-literal", b.at, `style ${m[0].trim()}`);
    }
  }
  // SVG 속성의 색 리터럴(fill="#20264a")
  for (const m of text.matchAll(/\b(?:fill|stroke|stopColor|floodColor|lightingColor|color)=\{?["'`](#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\()/g)) add("color-literal", m.index!, m[0]);
  return out;
}

export type Counts = Record<string, Record<string, number>>; // 파일 → 규칙 → 개수

export function countsOf(findings: readonly Finding[]): Counts {
  const out: Counts = {};
  for (const f of findings) {
    out[f.file] ??= {};
    out[f.file][f.rule] = (out[f.file][f.rule] ?? 0) + 1;
  }
  // 키 순서를 고정한다(기준선 diff가 읽히게)
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, Object.fromEntries(Object.keys(out[k]).sort().map((r) => [r, out[k][r]]))]));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(css|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// root(web/src)의 모든 .css·.tsx. file은 repo 기준 경로(web/src/…)
export function lintTree(root: string, repo: string): Finding[] {
  const out: Finding[] = [];
  for (const p of walk(root)) {
    const file = relative(repo, p).split("\\").join("/");
    const text = readFileSync(p, "utf8");
    out.push(...(p.endsWith(".css") ? lintCss(text, file) : lintTsx(text, file)));
  }
  return out;
}

export interface RatchetResult {
  added: { file: string; rule: string; was: number; now: number }[]; // 기준선보다 늘었거나 기준선에 없는 칸
  dropped: { file: string; rule: string; was: number; now: number }[]; // 기준선보다 줄어 낮출 수 있는 칸
}

export function ratchetOf(now: Counts, baseline: Counts): RatchetResult {
  const added: RatchetResult["added"] = [];
  const dropped: RatchetResult["dropped"] = [];
  for (const file of new Set([...Object.keys(now), ...Object.keys(baseline)])) {
    for (const rule of new Set([...Object.keys(now[file] ?? {}), ...Object.keys(baseline[file] ?? {})])) {
      const n = now[file]?.[rule] ?? 0;
      const b = baseline[file]?.[rule] ?? 0;
      if (n > b) added.push({ file, rule, was: b, now: n });
      else if (n < b) dropped.push({ file, rule, was: b, now: n });
    }
  }
  return { added, dropped };
}

// ── 기준선 갱신 CLI: node server/css-lint.ts --update ──
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = join(REPO, "web/css-lint-baseline.json");
export const lintWeb = () => lintTree(join(REPO, "web/src"), REPO);

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--update")) {
  const counts = countsOf(lintWeb());
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log(`css-lint: ${BASELINE} 갱신(${Object.keys(counts).length}개 파일)`);
}
