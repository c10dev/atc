import assert from "node:assert/strict";
import { test } from "node:test";
import { K3_SHAPE, workOrderCheck, workOrderRejection } from "./work-order-check.ts";

const GOOD = "## Goal\nCatch bad bodies.\n\n## Done when\n- It rejects.\n\n## K effects\nNone\n\n## Measure\nNone\n";
const without = (title: string) => GOOD.replace(new RegExp(`## ${title}\\n[^#]*`), "");
const withK = (k: string) => GOOD.replace("None\n\n## Measure", `${k}\n\n## Measure`);

test("a complete body passes with no errors and no warnings", () => {
  assert.deepEqual(workOrderCheck(GOOD), { errors: [], warnings: [] });
});

test("a missing or empty Goal, Done when or K effects is rejected, all at once", () => {
  assert.match(workOrderCheck(without("Goal")).errors.join(), /Goal/);
  assert.match(workOrderCheck(without("Done when")).errors.join(), /Done when/);
  assert.match(workOrderCheck(without("K effects")).errors.join(), /K effects/);
  assert.match(workOrderCheck(GOOD.replace("Catch bad bodies.", "")).errors.join(), /Goal/);
  assert.match(workOrderCheck(GOOD.replace("- It rejects.", "  ")).errors.join(), /Done when/);
  assert.match(workOrderCheck(GOOD.replace("None\n\n## Measure", "\n\n## Measure")).errors.join(), /K effects/);
  assert.equal(workOrderCheck("just text").errors.length, 3);
});

test("section names match the release hash: Korean and alternate names pass", () => {
  assert.deepEqual(workOrderCheck("## 목표\nx\n\n## 완료 기준\nx\n\n## K 효과\nNone\n\n## Measure\nNone").errors, []);
  assert.deepEqual(workOrderCheck("## Goal:\nx\n\n## Exit criteria\nx\n\n## K effect\nNone\n\n## Measure\nNone").errors, []);
});

test("K3: none, a shapeless K3 line and a wrong label are rejected with the line shape and the labels", () => {
  for (const k of ["K3: none", "- K3: None.", "K3 something", "K3[Nope]: change x | files: a.ts", "K3[Security Weaken]: change x"]) {
    const e = workOrderCheck(withK(k)).errors;
    assert.equal(e.length, 1, k);
    assert.ok(e[0]!.includes(K3_SHAPE) && e[0]!.includes("Security Weaken"), k);
  }
  assert.match(workOrderCheck(withK("K3: none")).errors[0]!, /K3: none/);
});

test("a readable K3 line passes, also when Linear escaped the Markdown", () => {
  assert.deepEqual(workOrderCheck(withK("K3[Security Weaken]: loosen the guard | files: duty/guard.mjs")).errors, []);
  assert.deepEqual(workOrderCheck(withK("K3\\[Security Weaken\\]: loosen the guard | files: server/k3\\_allow.ts")).errors, []);
});

test("Measure: missing or invalid only warns; None and a valid block do not", () => {
  const m = workOrderCheck(without("Measure"));
  assert.deepEqual(m.errors, []);
  assert.match(m.warnings.join(), /Measure.*None/);
  const bad = workOrderCheck(GOOD.replace("Measure\nNone", "Measure\nmetric: nonsense"));
  assert.deepEqual(bad.errors, []);
  assert.match(bad.warnings.join(), /읽지 못함.*None/);
  assert.deepEqual(workOrderCheck(GOOD.replace("## Measure\nNone", "## Measure\nmetric: leak:PROPOSAL\ndirection: down\nwindow: 7d")).warnings, []);
});

test("the rejection text names every part", () => {
  const t = workOrderRejection(workOrderCheck("x").errors);
  assert.ok(/Goal/.test(t) && /Done when/.test(t) && /K effects/.test(t));
});
