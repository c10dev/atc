import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDutyText, flaggedLine } from "./duty-language.ts";

const flags = (s: string) => checkDutyText(s).flagged;

test("한국어·영어·섞인 줄은 플래그가 아니다", () => {
  assert.deepEqual(checkDutyText("지금 QUEUE에 두 건이 있습니다."), { checked: 1, flagged: 0 });
  assert.deepEqual(checkDutyText("Two items are waiting."), { checked: 1, flagged: 0 });
  assert.equal(flags("PR 머지는 SUPERVISOR가 합니다 (merge is yours)"), 0);
});

test("한글이 있는 줄의 한자어 표기는 통과한다", () => {
  assert.equal(flags("대한민국(大韓民國) 관련 이슈입니다"), 0);
});

test("가나만, 한자만 있는 줄은 플래그", () => {
  assert.equal(flags("これは日本語の文です"), 1);
  assert.equal(flags("カタカナだけ"), 1);
  assert.equal(flags("这是中文句子"), 1);
  assert.equal(flaggedLine("漢字"), true);
});

test("줄 단위로 센다", () => {
  assert.deepEqual(checkDutyText("hello\n这是中文\n안녕\n\nこんにちは"), { checked: 4, flagged: 2 });
});

test("코드 블록, 인라인 코드, URL, 경로, 파일 이름은 보지 않는다", () => {
  assert.deepEqual(checkDutyText("```\n日本語のコード\n```\nok"), { checked: 1, flagged: 0 });
  assert.deepEqual(checkDutyText("~~~js\n中文\n~~~"), { checked: 0, flagged: 0 });
  assert.equal(flags("see `日本語` here"), 0);
  assert.equal(flags("https://example.com/日本語"), 0);
  assert.equal(flags("docs/日本語/メモ"), 0);
  assert.equal(flags('the file "日本語.md" exists'), 0);
});

test("BEGIN DATA … END DATA 안은 보지 않고 밖은 본다", () => {
  const t = "intro\nBEGIN DATA\n日本語の本文\n这是中文\nEND DATA\n밖의 글\n这是中文";
  assert.deepEqual(checkDutyText(t), { checked: 3, flagged: 1 });
});

test("빈 글", () => {
  assert.deepEqual(checkDutyText(""), { checked: 0, flagged: 0 });
  assert.deepEqual(checkDutyText("  \n\n"), { checked: 0, flagged: 0 });
  assert.deepEqual(checkDutyText("---"), { checked: 0, flagged: 0 });
});
