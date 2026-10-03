import assert from "node:assert/strict";
import { test } from "node:test";
import { assignLabels, buildPack, leaksIn, mergeFindings, parseFindings, stripDiff } from "./blind-pack.ts";

const d = (p: string, body = "+x") => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n${body}\n`;

test("라벨은 무작위지만 시드가 같으면 같고, 시드마다 두 값이 모두 나온다", () => {
  assert.deepEqual(assignLabels(7), assignLabels(7));
  const seen = new Set<string>();
  for (let s = 0; s < 40; s++) {
    const m = assignLabels(s);
    assert.notEqual(m.X, m.Y);
    seen.add(m.X);
  }
  assert.equal(seen.size, 2);
});

test("changelog.d 조각과 추가로 준 파일이 빠지고 목록에 남는다", () => {
  const r = stripDiff(d("server/a.ts") + d("changelog.d/ATC-1.md") + d("docs/arm.md"), ["docs/arm.md"]);
  assert.ok(r.diff.includes("server/a.ts"));
  assert.ok(!r.diff.includes("changelog.d"));
  assert.ok(!r.diff.includes("docs/arm.md"));
  assert.deepEqual(r.stripped.map((s) => s.path), ["changelog.d/ATC-1.md", "docs/arm.md"]);
});

test("접두사 규칙은 이름만 닮은 경로를 빼지 않는다", () => {
  assert.equal(stripDiff(d("changelog.dx/a.md")).stripped.length, 0);
});

test("leaksIn은 남은 낱말만 돌려준다", () => {
  assert.deepEqual(leaksIn("a feature-branch b", ["feature-branch", "zzz", ""]), ["feature-branch"]);
});

test("묶음에는 mapping이 없고 두 diff가 라벨로만 들어간다", () => {
  const diffs = { atc: d("a.ts", "+ATC-ARM") + d("changelog.d/x.md"), solo: d("b.ts", "+SOLO-ARM") };
  const p = buildPack({ seed: 3, base: "abc", diffs });
  assert.deepEqual(Object.keys(p.files).sort(), ["FINDINGS-TEMPLATE.md", "PROMPT.md", "X.diff", "Y.diff"]);
  const all = Object.values(p.files).join("\n");
  for (const w of ["atc", "solo", "abc"]) assert.ok(!new RegExp(`\\b${w}\\b`, "i").test(all.replace(/ATC-ARM|SOLO-ARM/g, "")), w);
  assert.ok(p.files[`${p.mapping.labels.X === "atc" ? "X" : "Y"}.diff`].includes("ATC-ARM"));
  assert.equal(JSON.stringify(p.files).includes("labels"), false);
  assert.equal(p.mapping.stripped[p.mapping.labels.X === "atc" ? "X" : "Y"].length, 1);
});

test("팔을 드러내는 낱말이 diff에 남으면 던진다", () => {
  assert.throws(() => buildPack({ seed: 1, base: "b", diffs: { atc: d("a.ts", "+see worktree-atc-9"), solo: d("b.ts") }, leakNeedles: ["worktree-atc-9"] }), /낱말/);
});

test("지적 줄을 읽고 형식이 아닌 줄은 무시한다", () => {
  const f = parseFindings("intro\nFINDING X P1 a.ts:3 — bad thing\nNONE Y\nFINDING Y P3 a.ts:1 — nope\n FINDING Y P2 b.ts:9 - minor");
  assert.deepEqual(f.map((x) => [x.label, x.sev]), [["X", "P1"], ["Y", "P2"]]);
});

test("합치기는 대응으로 팔별·리뷰어별 수와 합을 낸다", () => {
  const m = mergeFindings(
    { X: "solo", Y: "atc" },
    { claude: "FINDING X P0 a:1 — a\nFINDING Y P2 a:2 — b", codex: "FINDING X P1 a:1 — c\nFINDING X P2 a:2 — d\nNONE Y" },
  );
  assert.deepEqual(m.claude.solo, { P0: 1, P1: 0, P2: 0, p1plus: 1 });
  assert.deepEqual(m.claude.atc, { P0: 0, P1: 0, P2: 1, p1plus: 0 });
  assert.deepEqual(m.codex.solo, { P0: 0, P1: 1, P2: 1, p1plus: 1 });
  assert.deepEqual(m.total.solo, { P0: 1, P1: 1, P2: 1, p1plus: 2 });
  assert.deepEqual(m.total.atc, { P0: 0, P1: 0, P2: 1, p1plus: 0 });
});
