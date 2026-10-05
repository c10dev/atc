import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readRecords } from "./recorder.ts";

// FLIGHT RECORDER 읽기 캐시(ATC-537): 날짜 파일이 자라도, since가 달라도 통째로 읽은 결과와 같다
const dir = mkdtempSync(join(tmpdir(), "atc-rec-cache-"));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(dir, { recursive: true });
const J = (o: unknown) => `${JSON.stringify(o)}\n`;
const ack = (t: string, consumer = "x") => ({ t, kind: "ack", consumer });

test("자란 날짜 파일, since 거르기, 새 날짜 파일, 깨진 줄이 통째로 읽은 결과와 같다", () => {
  const d1 = join(dir, "2026-10-04.jsonl");
  const d2 = join(dir, "2026-10-05.jsonl");
  writeFileSync(d1, J(ack("2026-10-04T10:00:00.000Z", "a")) + "garbage\n" + J(ack("2026-10-04T23:00:00.000Z", "b")));
  const since = Date.parse("2026-10-04T12:00:00.000Z");
  assert.deepEqual(readRecords(since, dir).map((r) => (r as { consumer: string }).consumer), ["b"]);
  assert.deepEqual(readRecords(Date.parse("2026-10-04T00:00:00.000Z"), dir).map((r) => (r as { consumer: string }).consumer), ["a", "b"]);
  appendFileSync(d1, J(ack("2026-10-04T23:30:00.000Z", "c")));
  writeFileSync(d2, J(ack("2026-10-05T00:00:01.000Z", "d")));
  assert.deepEqual(readRecords(since, dir).map((r) => (r as { consumer: string }).consumer), ["b", "c", "d"]);
  appendFileSync(d2, '{"t":"2026-10-05T00:00:02.000Z","kind":"ack","consumer":"e"'); // 줄이 끝나지 않았다
  assert.deepEqual(readRecords(since, dir).map((r) => (r as { consumer: string }).consumer), ["b", "c", "d"]);
  appendFileSync(d2, "}\n");
  assert.deepEqual(readRecords(since, dir).map((r) => (r as { consumer: string }).consumer), ["b", "c", "d", "e"]);
});

test("돌려준 배열을 바꿔도 다음 읽기에 영향이 없다", () => {
  const since = Date.parse("2026-10-04T00:00:00.000Z");
  const a = readRecords(since, dir);
  a.length = 0;
  assert.ok(readRecords(since, dir).length > 0);
});
