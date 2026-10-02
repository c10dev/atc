import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 규칙 예산(ATC-361): 세션이 매번 읽는 규칙 파일이 예산을 넘거나, 두 파일에 같은 글이 되풀이되면 CI가 실패한다.
// 예산은 deploy/rules-budget.json(user 등급)에 있어서 올리려면 SUPERVISOR가 머지해야 한다.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const budget = JSON.parse(readFileSync(join(root, "deploy", "rules-budget.json"), "utf8"));
const read = (f) => readFileSync(join(root, f), "utf8");

export const sizeOf = (text) => Buffer.byteLength(text, "utf8");

// 비교용으로 코드 블록을 빼고 공백·따옴표·괄호를 접는다
export const normOf = (text) => text.replace(/```[\s\S]*?```/g, "").replace(/^---[\s\S]*?\n---/, "").replace(/[\s`*"'\[\]()]+/g, "");

// a에서 b에도 있는 글의 덩어리(window 글자 이상이 겹치는 부분을 이어 붙인 것). 다시 쓴 문장도 잡는다
export function sharedRuns(a, b, window) {
  const seen = new Set();
  for (let i = 0; i + window <= b.length; i++) seen.add(b.slice(i, i + window));
  const out = [];
  let start = -1;
  for (let i = 0; i + window <= a.length; i++) {
    const hit = seen.has(a.slice(i, i + window));
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      out.push(a.slice(start, i - 1 + window));
      start = -1;
    }
  }
  if (start >= 0) out.push(a.slice(start));
  return out;
}

test("규칙 파일은 예산 안에 있다", () => {
  for (const [file, max] of Object.entries(budget.files)) {
    const n = sizeOf(read(file));
    assert.ok(n <= max, `${file}: ${n} bytes > budget ${max}. 규칙을 docs/rules.ko.md나 설계 문서로 옮긴다. 예산을 올리는 것은 SUPERVISOR가 정한다(deploy/rules-budget.json)`);
  }
});

test("예산이 넉넉한 채로 잊히지 않는다: 파일이 예산의 85%보다 작으면 예산을 줄인다", () => {
  for (const [file, max] of Object.entries(budget.files)) {
    assert.ok(sizeOf(read(file)) >= max * 0.85, `${file}: 예산 ${max}이 실제 크기보다 너무 넉넉하다. 예산을 줄인다`);
  }
});

test("같은 규칙이 두 파일에 되풀이되지 않는다(한 규칙은 한 곳에)", () => {
  const files = Object.keys(budget.files);
  const { window, maxRunChars } = budget.shared;
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const long = sharedRuns(normOf(read(files[i])), normOf(read(files[j])), window).filter((r) => r.length > maxRunChars);
      assert.deepEqual(long, [], `${files[i]}와 ${files[j]}에 같은 글이 있다. 한 곳에만 두고 다른 쪽은 가리키기만 한다`);
    }
  }
});

test("순수 함수: 크기와 겹친 글", () => {
  assert.equal(sizeOf("가a"), 4);
  const a = normOf("- 하나의 아주 긴 규칙 문장이 여기에 있다. 끝\n```\n코드 블록은 뺀다 코드 블록은 뺀다\n```");
  const b = normOf("앞 하나의 아주 긴 규칙 문장이 여기에 있다 뒤");
  assert.deepEqual(sharedRuns(a, b, 8), ["하나의아주긴규칙문장이여기에있다"]);
  assert.deepEqual(sharedRuns(a, "전혀다른글전혀다른글전혀다른글", 8), []);
});
