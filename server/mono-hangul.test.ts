// C2(ATC-324): docs/design-language.md 3.5 규칙 2 — 한글 문장은 mono가 아니라 sans. `.mono` 요소가 여는 태그 바로 뒤에 한글 글을 직접 담으면 걸린다.
// 정규식으로 보는 얕은 검사라 `{…}`·자식 태그 뒤의 글은 못 본다: 거짓 경보를 피하려는 선택이다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const HANGUL = /[가-힣]/;
const OPEN = /<(\w+)\b(?:[^<>]|=>)*?className=(?:"([^"]*)"|\{`([^`]*)`\})(?:[^<>]|=>)*?(?<!=)>([^<{]*)/g;

export function monoHangul(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(OPEN)) {
    const cls = (m[2] ?? m[3] ?? "").split(/\s+/);
    if (cls.includes("mono") && HANGUL.test(m[4])) out.push(m[4].trim().replace(/\s+/g, " ").slice(0, 60));
  }
  return out;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });

test("monoHangul: .mono 요소 안의 한글 글은 걸리고, 코드·숫자와 sans 요소는 통과", () => {
  assert.deepEqual(monoHangul('<span className="mono">STAND 없음 · 보고</span>'), ["STAND 없음 · 보고"]);
  assert.deepEqual(monoHangul('<p className="x mono y">목표 <b>1</b></p>'), ["목표"]);
  assert.deepEqual(monoHangul('<span className="mono">{id}</span>는 등록됨'), []);
  assert.deepEqual(monoHangul('<span className="mono">ATC-1</span> 착륙'), []);
  assert.deepEqual(monoHangul('<span className="muted">목표 <span className="mono">x</span></span>'), []); // 바깥은 sans, 안쪽 mono는 코드
});

test("web/src: .mono 요소에 한글 문장이 없다", () => {
  const bad = walk("web/src").flatMap((f) => monoHangul(readFileSync(f, "utf8")).map((t) => `${f}: ${t}`));
  assert.deepEqual(bad, []);
});
