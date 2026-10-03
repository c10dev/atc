import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NEUTRALIZED_HEADER, neutralize } from "./solo-claude-md.ts";

// solo 팔 CLAUDE.md(ATC-462): 교신 규칙만 빠지고 코드·검증·문서·git 규칙은 남고, 같은 입력은 같은 출력이다.
const ROOT = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");

test("교신 절과 그 참조가 빠진다", () => {
  const out = neutralize(ROOT);
  assert.ok(!out.includes("## 교신"));
  assert.ok(!out.includes("[DISPATCH"));
  assert.ok(!out.includes("READBACK C-"));
  assert.ok(!out.includes("ARRIVED"));
  assert.ok(!out.includes('(아래 "교신")'));
});

test("코드·검증·문서·git 규칙의 절은 그대로 남는다", () => {
  const out = neutralize(ROOT);
  for (const h of ["## 작업 위치", "## 검증", "## 운영", "## git과 PR", "## 코드", "## 용어와 문서", "## 계획·DUTY·Linear"]) assert.ok(out.includes(h), h);
  assert.ok(out.includes("`npm test`, `npx tsc --noEmit -p .`, `npx vite build`가 모두 통과해야 한다"));
  assert.ok(out.includes("PR은 Draft로 올리지 않는다"));
});

test("남은 본문은 원문에서 교신 절과 그 참조 문장만 뺀 것이다", () => {
  const out = neutralize(ROOT).slice(NEUTRALIZED_HEADER.length);
  const start = ROOT.indexOf("\n## 교신");
  assert.ok(start > 0);
  const expected = (ROOT.slice(0, start).replace(' 세션끼리 주고받는 글은 영어다(아래 "교신").', "").trimEnd() + "\n");
  assert.equal(out, expected);
});

test("결정적이다: 두 번 만들면 같고, 이미 만든 글은 다시 만들 수 없다", () => {
  const a = neutralize(ROOT);
  assert.equal(neutralize(ROOT), a);
  assert.equal(createHash("sha256").update(a).digest("hex"), createHash("sha256").update(neutralize(ROOT)).digest("hex"));
  assert.throws(() => neutralize(a), /교신/);
});

test("구조가 바뀌면 조용히 넘어가지 않고 던진다", () => {
  assert.throws(() => neutralize("# x\n\n## 코드\n\n- a\n"), /절이 없다/);
  assert.throws(() => neutralize("## 용어\n\n- b\n\n## 교신\n\n- c\n"), /문장이 없다/);
  // 교신 표지가 다른 절에 새면 던진다
  const leaked = ROOT.replace("## 코드", "## 코드\n\n- [DISPATCH D-0001] 답한다");
  assert.throws(() => neutralize(leaked), /교신 표지가 남았다/);
});
