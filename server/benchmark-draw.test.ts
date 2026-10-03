import assert from "node:assert/strict";
import { test } from "node:test";
import { draw, KINDS, parseCandidates, SIZES, stratumOf, type Candidate } from "./benchmark-draw.ts";

// 6개 층에 각 4개, 일부는 파일이 겹친다
function pool(): Candidate[] {
  const out: Candidate[] = [];
  let n = 1;
  for (const size of SIZES)
    for (const kind of KINDS)
      for (let i = 0; i < 4; i++) {
        out.push({ key: `ATC-${100 + n}`, size, kind, files: [`${kind}/f${n}.ts`], flags: {} });
        n++;
      }
  out[0].files.push("shared/a.ts");
  out[5].files.push("shared/a.ts");
  out[8].files.push("lib/");
  out[13].files.push("lib/x.ts");
  out[20].files.push("shared/b.ts");
  out[22].files.push("shared/b.ts");
  return out;
}

test("같은 시드와 같은 입력은 같은 결과, 입력 순서와 무관", () => {
  const a = draw(pool(), { seed: 7 });
  assert.deepEqual(draw(pool(), { seed: 7 }), a);
  assert.deepEqual(draw([...pool()].reverse(), { seed: 7 }), a);
  assert.notDeepEqual(draw(pool(), { seed: 8 }).drawn, a.drawn);
});

test("플래그가 붙은 후보는 뽑지 않고 이유를 보고한다", () => {
  const p = pool();
  p[1].flags = { blocked: true };
  p[2].flags = { userTier: true, hardToReverse: true };
  const r = draw(p, { seed: 1 });
  assert.deepEqual(r.excluded, [
    { key: p[1].key, reasons: ["blocked"] },
    { key: p[2].key, reasons: ["userTier", "hardToReverse"] },
  ]);
  assert.ok(!r.drawn.some((d) => d.key === p[1].key || d.key === p[2].key));
  assert.equal(r.eligible, 22);
});

test("층을 고르게 채운다: 12개면 층마다 2개, 10개면 층마다 1~2개", () => {
  for (let seed = 0; seed < 20; seed++) {
    const r = draw(pool(), { seed });
    assert.equal(r.drawn.length, 12);
    for (const s of Object.values(r.strata)) assert.equal(s.drawn, 2);
    const r10 = draw(pool(), { seed, count: 10 });
    for (const s of Object.values(r10.strata)) assert.ok(s.drawn === 1 || s.drawn === 2);
    assert.equal(Object.values(r10.strata).filter((s) => s.drawn === 2).length, 4);
  }
});

test("한 층의 풀이 모자라면 남는 층이 메우고 경고한다", () => {
  const docsS = pool().filter((c) => stratumOf(c) === "S-docs");
  const p = pool().filter((c) => stratumOf(c) !== "S-docs" || c.key === docsS[0].key);
  const r = draw(p, { seed: 3 });
  assert.equal(r.drawn.length, 12);
  assert.equal(r.strata["S-docs"].drawn, 1);
  assert.ok(r.warnings.some((w) => w.includes("S-docs")));
});

test("겹치는 쌍 2~3개를 고르고 겹친 파일을 보고한다(서로 다른 이슈, 뽑힌 목록 안에)", () => {
  for (let seed = 0; seed < 20; seed++) {
    const r = draw(pool(), { seed, pairs: 3 });
    assert.equal(r.overlapPairs.length, 3);
    const keys = r.overlapPairs.flatMap((p) => [p.a, p.b]);
    assert.equal(new Set(keys).size, 6);
    for (const k of keys) assert.ok(r.drawn.some((d) => d.key === k));
    for (const p of r.overlapPairs) assert.ok(p.shared.every((f) => f.startsWith("shared/") || f.startsWith("lib/")));
  }
});

test("겹치는 쌍이 모자라면 조용히 채우지 않고 경고한다", () => {
  const p = pool().map((c) => ({ ...c, files: [`only/${c.key}.ts`] }));
  const r = draw(p, { seed: 1 });
  assert.equal(r.overlapPairs.length, 0);
  assert.ok(r.warnings.some((w) => w.includes("겹치는 쌍")));
});

test("후보가 모자라면 있는 만큼만 뽑고 보고한다", () => {
  const r = draw(pool().slice(0, 8), { seed: 1 });
  assert.equal(r.drawn.length, 8);
  assert.ok(r.warnings.some((w) => w.includes("후보 풀이 작다")));
});

test("팔 순서: 층 안에서 번갈아 균형", () => {
  for (let seed = 0; seed < 20; seed++) {
    const r = draw(pool(), { seed });
    for (const s of Object.keys(r.strata)) {
      const firsts = r.drawn.filter((d) => stratumOf(d) === s).map((d) => d.armOrder[0]);
      assert.equal(firsts.filter((x) => x === "atc").length, firsts.length / 2, s);
    }
  }
});

test("잘못된 입력은 던진다", () => {
  assert.throws(() => parseCandidates({}));
  assert.throws(() => parseCandidates([{ key: "A", size: "L", kind: "docs" }]));
  assert.throws(() => parseCandidates([{ key: "A", size: "S", kind: "docs", flags: { nope: true } }]));
  assert.throws(() => parseCandidates([{ key: "A", size: "S", kind: "docs" }, { key: "A", size: "S", kind: "docs" }]));
  assert.throws(() => draw(pool(), { seed: 1, count: 20 }));
});
