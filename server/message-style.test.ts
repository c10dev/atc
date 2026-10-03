import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { messageCases } from "./message-style-cases.ts";

// ATC-359: 문구를 쉬운 영어로 고쳐도 guard와 세션이 읽는 것은 그대로여야 한다.
// 고치기 전 출력(fixtures/message-before.json)과 지금 출력에서 "지켜야 할 것"을 뽑아 견준다. 스타일은 docs/message-style.md.
const before: Record<string, string> = JSON.parse(readFileSync(new URL("./fixtures/message-before.json", import.meta.url), "utf8"));
const after = messageCases();

const sorted = (xs: string[]) => [...xs].sort();
const all = (s: string, re: RegExp) => s.match(re) ?? [];

// 지켜야 할 것: 머리 줄 통째, id, 따옴표 안 화법, 대문자 낱말(화법·REGISTRATION·FLIGHT 용어), #n·head·경로·명령 옵션
export function protectedOf(text: string): Record<string, string[]> {
  return {
    firstLine: text.startsWith("[") ? [text.split("\n")[0]] : [],
    ids: sorted(all(text, /\b(?:D|C|CC)-\d{4}\b/g)),
    quoted: sorted(all(text, /"[^"\n]*"/g)),
    caps: sorted(all(text, /\b[A-Z][A-Z0-9_]*[A-Z0-9]\b/g)),
    refs: sorted(all(text, /#\d+|\bhead [0-9a-f]{7}\b|--[a-z-]+|origin\/main|[\w./-]+\.ts/g)),
  };
}

for (const key of Object.keys(before)) {
  test(`문구 ${key}: 머리·id·화법 낱말·참조가 고치기 전과 같다`, () => {
    assert.ok(key in after, key);
    const b = protectedOf(before[key]);
    const a = protectedOf(after[key]);
    // 개수까지 같아야 한다
    for (const part of Object.keys(b)) assert.deepEqual(a[part], b[part], `${key}.${part}`);
  });
}

test("문구 사례가 빠지지 않았다", () => {
  assert.deepEqual(sorted(Object.keys(after)), sorted(Object.keys(before)));
});

test("guard가 읽는 머리는 바이트 그대로: [DISPATCH D-…], [OCC CC-…], [ATC FLEET]", () => {
  assert.match(after.flightPlan, /^\[DISPATCH D-0007\] FLIGHT PLAN · BRAVO \(TEAM_B\)\n/);
  assert.match(after.recall, /^\[DISPATCH D-0007\] RECALL · BRAVO \(TEAM_B\)\n/);
  assert.match(after.crewMessage, /^\[OCC CC-0003\] CREW CHANGE · /);
  assert.match(after.crewText, /^\[ATC FLEET\] CREW CHANGE · /);
});

test("끝줄의 화법 낱말: 큰따옴표 안 문구는 한 글자도 다르지 않다", () => {
  const wu = after.closingClearanceWU;
  assert.ok(wu.includes('"READBACK C-0007"') && wu.includes('"UNABLE C-0007 — reason"') && wu.includes('"STANDBY C-0007"'));
  assert.ok(after.closingClearanceR.includes('"ROGER C-0008"'));
  assert.ok(after.closingRecall.includes('"READBACK D-0003 RECALL"'));
});

test("LAND·GO AROUND 문구에서 코드가 읽는 표지: PR ahead (#n), head <7자리>, UNABLE", () => {
  assert.match(after.landNext, /PR ahead \(#411\)/);
  for (const k of ["goDirty", "goBehind", "goPrev"]) {
    assert.match(after[k], /^GO AROUND: /);
    assert.match(after[k], /head abcdef1\b/);
    assert.match(after[k], /answer UNABLE with the reason/);
  }
});

// 스타일: 한 문장은 짧게(docs/message-style.md 규칙 1)
test("스타일: 사례의 한 문장은 35낱말 이하", () => {
  for (const [key, text] of Object.entries(after)) {
    if (key === "flightPlan" || key === "assignment") continue; // 이슈 본문에서 옮긴 글이 섞인다
    for (const line of text.split("\n")) {
      for (const sentence of line.split(/(?<=[.;?!])\s+|\s·\s/)) {
        const n = sentence.split(/\s+/).filter(Boolean).length;
        assert.ok(n <= 35, `${key}: ${n} words: ${sentence}`);
      }
    }
  }
});
