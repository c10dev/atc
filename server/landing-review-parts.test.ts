import assert from "node:assert/strict";
import { test } from "node:test";
import { DIFF_MAX, diffPacketOf, splitDiff } from "./landing-review.ts";
import { diffFromFiles, type ReviewSource } from "./sources/github.ts";

// 큰 PR의 diff를 쪽으로 나눠 읽기(ATC-489). 합성 diff만 쓴다(네트워크 없음)
const file = (name: string, lines: number, w = 60) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${Array.from({ length: lines }, (_, i) => `+${name}:${i} ${"x".repeat(w)}`).join("\n")}\n`;
const BIG = Array.from({ length: 40 }, (_, i) => file(`src/f${i}.ts`, 140)).join(""); // 약 40만 자
const headersOf = (d: string) => [...d.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map((m) => m[1]);

test("약 40만 자 diff는 80,000자 이하의 쪽으로 나뉘고, 이으면 원래 diff와 글자까지 같다", () => {
  assert.ok(BIG.length > 380_000);
  const parts = splitDiff(BIG, DIFF_MAX);
  assert.ok(parts.length >= 5);
  for (const p of parts) assert.ok(p.text.length <= DIFF_MAX);
  assert.equal(parts.map((p) => p.text).join(""), BIG);
});

test("쪽은 파일 경계에서 끊어, 파일이 두 번 나오거나 빠지지 않는다", () => {
  const parts = splitDiff(BIG, DIFF_MAX);
  const seen = parts.flatMap((p) => headersOf(p.text));
  assert.deepEqual(seen, headersOf(BIG));
  assert.equal(new Set(seen).size, 40);
  for (const p of parts) assert.deepEqual(p.files, headersOf(p.text)); // 쪽의 파일 이름은 그 쪽의 머리들
});

test("한 파일이 한 쪽보다 크면 줄 경계에서 끊고, 이어지는 쪽은 그 파일 이름을 단다", () => {
  const huge = file("big.ts", 3000); // 약 200,000자
  const d = file("a.ts", 2) + huge + file("z.ts", 2);
  const parts = splitDiff(d, DIFF_MAX);
  assert.equal(parts.map((p) => p.text).join(""), d);
  for (const p of parts) assert.ok(p.text.length <= DIFF_MAX);
  // 줄 중간에서 끊지 않는다: 끝이 개행이 아닌 쪽은 diff의 마지막 쪽뿐이어야 하고 그 마지막도 개행으로 끝난다
  for (const p of parts) assert.ok(p.text.endsWith("\n"));
  const withBig = parts.filter((p) => p.files.includes("big.ts"));
  assert.ok(withBig.length >= 3);
  assert.deepEqual(parts[0]!.files, ["a.ts"]); // 큰 파일은 새 쪽에서 시작한다
  assert.deepEqual(parts[1]!.files, ["big.ts"]);
  assert.deepEqual(parts.at(-1)!.files.slice(-1), ["z.ts"]);
});

test("줄 하나가 max보다 길어도 글자는 잃지 않는다", () => {
  const d = `diff --git a/m.js b/m.js\n+${"y".repeat(250)}\n`;
  const parts = splitDiff(d, 100);
  assert.equal(parts.map((p) => p.text).join(""), d);
  for (const p of parts) assert.ok(p.text.length <= 100);
});

test("빈 diff는 빈 쪽 하나", () => {
  assert.deepEqual(splitDiff("", DIFF_MAX), [{ text: "", files: [] }]);
});

const SRC = (diff: string, extra: Partial<ReviewSource> = {}) => ({ diff, diffSource: "pr-diff" as const, removedFiles: [], unreadFiles: [], ...extra });

test("작은 diff: 1쪽 하나이고 오늘의 자료와 같은 값(diff는 통째, diffChars는 전체, 잘림 없음)", () => {
  const d = file("a.ts", 3);
  const r = diffPacketOf(SRC(d), undefined);
  assert.deepEqual(r, { part: 1, parts: 1, partFiles: ["a.ts"], diff: d, diffSource: "pr-diff", diffTruncated: false, diffChars: d.length });
  assert.deepEqual(diffPacketOf(SRC(d), "1"), r);
});

test("큰 diff: part를 주면 그 쪽, 1쪽의 diffChars는 전체 길이, 모든 쪽을 읽으면 diffTruncated는 false", () => {
  const first = diffPacketOf(SRC(BIG), undefined);
  assert.ok(first.parts >= 5 && first.part === 1);
  assert.equal(first.diffChars, BIG.length);
  assert.equal(first.diffTruncated, false);
  let joined = "";
  for (let n = 1; n <= first.parts; n++) {
    const r = diffPacketOf(SRC(BIG), String(n));
    assert.equal(r.part, n);
    assert.equal(r.parts, first.parts);
    joined += r.diff;
  }
  assert.equal(joined, BIG);
});

test("범위 밖이거나 정수가 아닌 part는 400", () => {
  const d = file("a.ts", 3);
  for (const bad of ["0", "2", "-1", "x", "1.5", ""]) assert.throws(() => diffPacketOf(SRC(d), bad), (e) => (e as { status?: number }).status === 400, bad);
});

test("files-api: patch가 없는 파일이 있으면 diffTruncated: true와 그 파일 이름. 없으면 false", () => {
  const rows = [
    { filename: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" },
    { filename: "assets/logo.png", status: "added", patch: null },
    { filename: "old.env", status: "removed" },
  ];
  const f = diffFromFiles(rows);
  assert.deepEqual(f.unread, ["assets/logo.png", "old.env"]);
  const r = diffPacketOf(SRC(f.diff, { diffSource: "files-api", removedFiles: f.removed, unreadFiles: f.unread }), undefined);
  assert.equal(r.diffTruncated, true);
  assert.deepEqual((r as { unreadFiles?: string[] }).unreadFiles, ["assets/logo.png", "old.env"]);
  assert.deepEqual((r as { removedFiles?: string[] }).removedFiles, ["old.env"]);
  assert.equal(r.diffSource, "files-api");
  // 모든 파일에 patch가 있는 files-api 자료는 잘림이 아니다
  const ok = diffFromFiles([rows[0]!]);
  assert.equal(diffPacketOf(SRC(ok.diff, { diffSource: "files-api", unreadFiles: ok.unread }), undefined).diffTruncated, false);
});
