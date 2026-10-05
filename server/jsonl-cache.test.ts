import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { JsonlCache } from "./jsonl-cache.ts";

// 덧붙이기 JSONL 캐시(ATC-537): 늘 통째로 읽은 결과와 같아야 한다
const dir = mkdtempSync(join(tmpdir(), "atc-jsonl-cache-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const fileOf = () => join(dir, `f${n++}.jsonl`);
const full = (text: string): unknown[] =>
  text.split("\n").flatMap((l) => {
    if (!l) return [];
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

test("파일이 없으면 빈 배열, 생기면 읽는다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  assert.deepEqual(c.read(f).lines, []);
  writeFileSync(f, line({ a: 1 }));
  assert.deepEqual(c.read(f).lines, [{ a: 1 }]);
});

test("바뀌지 않으면 같은 배열(읽지 않는다), 덧붙이면 새 줄만 더해진다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  writeFileSync(f, line({ i: 1 }) + line({ i: 2 }));
  const a = c.read(f);
  assert.equal(c.read(f).lines, a.lines);
  assert.equal(c.read(f).gen, a.gen);
  appendFileSync(f, line({ i: 3 }) + line({ i: 4 }));
  const b = c.read(f);
  assert.deepEqual(b.lines, [{ i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }]);
  assert.notEqual(b.gen, a.gen);
  assert.deepEqual(a.lines, [{ i: 1 }, { i: 2 }]); // 앞서 돌려준 배열은 그대로
});

test("한글 같은 여러 바이트 글자가 있어도 덧붙인 만큼만 읽어 같은 결과", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  let text = "";
  for (let i = 0; i < 20; i++) {
    const l = line({ i, t: "한글 ✈ 글자".repeat(i % 3 + 1) });
    appendFileSync(f, l);
    text += l;
    assert.deepEqual(c.read(f).lines, full(text));
  }
});

test("줄바꿈이 없는 마지막 조각은 완결될 때까지 캐시하지 않는다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  writeFileSync(f, line({ i: 1 }) + '{"i":2,"x":"ab');
  assert.deepEqual(c.read(f).lines, [{ i: 1 }]); // 조각은 파싱되지 않는다
  appendFileSync(f, 'cd"}');
  assert.deepEqual(c.read(f).lines, [{ i: 1 }, { i: 2, x: "abcd" }]); // 줄바꿈 없이 완결된 JSON은 통째로 읽을 때처럼 읽힌다
  appendFileSync(f, "\n" + line({ i: 3 }));
  assert.deepEqual(c.read(f).lines, [{ i: 1 }, { i: 2, x: "abcd" }, { i: 3 }]);
  appendFileSync(f, '{"i":4');
  appendFileSync(f, "}\n");
  assert.deepEqual(c.read(f).lines, full(`${line({ i: 1 })}{"i":2,"x":"abcd"}\n${line({ i: 3 })}${line({ i: 4 })}`));
});

test("깨진 줄은 건너뛰고, 건너뛴 채로 이어 읽는다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  writeFileSync(f, line({ i: 1 }) + "not json\n");
  assert.deepEqual(c.read(f).lines, [{ i: 1 }]);
  appendFileSync(f, line({ i: 2 }));
  assert.deepEqual(c.read(f).lines, [{ i: 1 }, { i: 2 }]);
});

test("줄어든 파일은 처음부터 다시 읽는다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  writeFileSync(f, line({ i: 1 }) + line({ i: 2 }) + line({ i: 3 }));
  c.read(f);
  truncateSync(f, Buffer.byteLength(line({ i: 1 })));
  assert.deepEqual(c.read(f).lines, [{ i: 1 }]);
  appendFileSync(f, line({ i: 9 }));
  assert.deepEqual(c.read(f).lines, [{ i: 1 }, { i: 9 }]);
});

test("교체한 파일(inode가 바뀜)은 더 커도 처음부터 다시 읽는다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  writeFileSync(f, line({ i: 1 }) + line({ i: 2 }));
  c.read(f);
  const next = `${f}.new`;
  writeFileSync(next, line({ z: 1 }) + line({ z: 2 }) + line({ z: 3 }) + line({ z: 4 }));
  renameSync(next, f);
  assert.deepEqual(c.read(f).lines, [{ z: 1 }, { z: 2 }, { z: 3 }, { z: 4 }]);
});

test("제자리에서 다시 쓴 파일은 같은 크기여도, 더 커져도 처음부터 다시 읽는다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  writeFileSync(f, line({ i: 1 }) + line({ i: 2 }));
  c.read(f);
  const before = statSync(f).mtimeMs;
  writeFileSync(f, line({ i: 7 }) + line({ i: 8 })); // 같은 크기, 같은 inode
  while (statSync(f).mtimeMs === before) writeFileSync(f, line({ i: 7 }) + line({ i: 8 }));
  assert.deepEqual(c.read(f).lines, [{ i: 7 }, { i: 8 }]);
  writeFileSync(f, line({ q: "다시 쓴 줄 하나" }) + line({ q: 2 }) + line({ q: 3 })); // 더 커졌지만 앞이 다르다
  assert.deepEqual(c.read(f).lines, [{ q: "다시 쓴 줄 하나" }, { q: 2 }, { q: 3 }]);
});

test("임의로 덧붙이고 끊고 이어도 늘 통째로 읽은 결과와 같다", () => {
  const f = fileOf();
  const c = new JsonlCache<unknown>();
  let text = "";
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let step = 0; step < 200; step++) {
    const l = line({ step, pad: "x".repeat(Math.floor(rnd() * 40)), k: "한" });
    const cut = rnd() < 0.4 ? Math.floor(rnd() * l.length) : l.length; // 가끔 줄 중간까지만 쓴다
    const part = Buffer.from(l).subarray(0, cut === l.length ? undefined : Buffer.byteLength(l.slice(0, cut)));
    appendFileSync(f, part);
    text += part.toString("utf8");
    assert.deepEqual(c.read(f).lines, full(text));
    if (cut < l.length) {
      const rest = Buffer.from(l).subarray(part.length);
      appendFileSync(f, rest);
      text += rest.toString("utf8");
      assert.deepEqual(c.read(f).lines, full(text));
    }
  }
});

test("parse 함수가 돌려준 값을 줄 대신 쓰고, undefined는 건너뛴다", () => {
  const f = fileOf();
  const c = new JsonlCache<number>((raw) => ((raw as { v?: number }).v !== undefined ? (raw as { v: number }).v * 2 : undefined));
  writeFileSync(f, line({ v: 1 }) + line({ w: 1 }) + line({ v: 3 }));
  assert.deepEqual(c.read(f).lines, [2, 6]);
});
