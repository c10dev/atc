import assert from "node:assert/strict";
import { test } from "node:test";
import { type Crosscheck, type HumanDecision, oneClickOf, viaOf } from "./crosscheck.ts";

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
