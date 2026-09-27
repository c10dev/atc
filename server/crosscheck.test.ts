import assert from "node:assert/strict";
import { test } from "node:test";
import { type Crosscheck, crosscheckRateOf, type HumanDecision, modelFamily, oneClickOf, viaOf } from "./crosscheck.ts";

test("via 입력: crosscheck만 그대로, 나머지(없음 포함)는 manual", () => {
  assert.equal(viaOf({ via: "crosscheck" }), "crosscheck");
  assert.equal(viaOf({ via: "manual" }), "manual");
  assert.equal(viaOf({ via: "CROSSCHECK" }), "manual");
  assert.equal(viaOf({ via: 1 }), "manual");
  assert.equal(viaOf({}), "manual");
});

test("oneClick: 한 번 클릭이 가능했던 판정(판정 전 mark + via 기록) 중 crosscheck 건수", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 8, 26, 0, m)).toISOString();
  const mark = (m: number): Crosscheck => ({ by: "CROSSCHECK", model: "muse", verdict: "agree", reason: "r", at: at(m) });
  const h = (via?: HumanDecision["via"]): HumanDecision => ({ verdict: "agree", at: at(10), reason: null, ...(via ? { via } : {}) });
  assert.deepEqual(oneClickOf([]), { count: 0, decided: 0 });
  assert.deepEqual(
    oneClickOf([
      { crosscheck: mark(5), human: h("crosscheck") }, // 셈, 한 번 클릭
      { crosscheck: mark(5), human: h("manual") }, // 셈, 직접
      { crosscheck: null, human: h("manual") }, // mark 없음 → 한 번 클릭 불가, 안 셈
      { crosscheck: mark(15), human: h("crosscheck") }, // 판정 뒤 mark → 안 셈
      { crosscheck: mark(5), human: h() }, // via 없는 옛 판정 → 안 셈
      { crosscheck: mark(5), human: null }, // 판정 없음
    ]),
    { count: 1, decided: 2 },
  );
});

test("modelFamily: 경로 접두어·[1m]·-contributor를 떼어 계열로, 없으면 unknown", () => {
  assert.equal(modelFamily("claude-ocx-opencode-go--muse-spark-1.3-contributor"), "muse-spark-1.3");
  assert.equal(modelFamily("claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]"), "muse-spark-1.3");
  assert.equal(modelFamily("muse-spark-1.3-contributor"), "muse-spark-1.3");
  assert.equal(modelFamily("claude-ocx-native--gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(modelFamily("gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(modelFamily("unknown"), "unknown");
  assert.equal(modelFamily(""), "unknown");
  assert.equal(modelFamily(undefined), "unknown");
});

test("byModel은 계열로 묶는다: 같은 Muse의 이름 셋이 한 줄, unknown은 따로", () => {
  const mark = (model: string): Crosscheck => ({ by: "CROSSCHECK", model, verdict: "agree", reason: "r", at: "2026-09-27T00:00:00Z" });
  const human = (verdict: "agree" | "disagree"): HumanDecision => ({ verdict, at: "2026-09-27T01:00:00Z", reason: null });
  const r = crosscheckRateOf([
    { crosscheck: mark("claude-ocx-opencode-go--muse-spark-1.3-contributor"), human: human("agree") },
    { crosscheck: mark("claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]"), human: human("agree") },
    { crosscheck: mark("muse-spark-1.3-contributor"), human: human("disagree") },
    { crosscheck: mark("unknown"), human: human("agree") },
    { crosscheck: mark("claude-ocx-native--gpt-5.6-terra"), human: human("agree") },
  ]);
  assert.deepEqual(r.byModel, {
    "gpt-5.6-terra": { marked: 1, matched: 1, rate: 1 },
    "muse-spark-1.3": { marked: 3, matched: 2, rate: 2 / 3 },
    unknown: { marked: 1, matched: 1, rate: 1 },
  });
  assert.equal(r.marked, 5); // 전체 합계는 그대로
});
