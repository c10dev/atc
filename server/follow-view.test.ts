import assert from "node:assert/strict";
import { test } from "node:test";
import type { FollowBundle, FollowRow } from "./follow.ts";
import { FOLLOW_STAGES } from "./follow.ts";
import { followRowOf, stagesShown } from "./follow-view.ts";

const row = (key: string, na: string[] = []) =>
  ({ key, stages: Object.fromEntries(FOLLOW_STAGES.map((s) => [s, { done: false, at: null, na: na.includes(s) }])) }) as unknown as FollowRow;
const bundle = (rows: FollowRow[]) => ({ parent: "ATC-1", rows }) as unknown as FollowBundle;

test("followRowOf: 어느 번들에 있든 key로 찾고, 따라가지 않으면 null", () => {
  const bundles = [bundle([row("ATC-1")]), bundle([row("ATC-2"), row("ATC-3")])];
  assert.equal(followRowOf(bundles, "ATC-3")?.key, "ATC-3");
  assert.equal(followRowOf(bundles, "ATC-9"), null);
  assert.equal(followRowOf([], "ATC-1"), null);
  assert.equal(followRowOf(undefined, "ATC-1"), null);
});

test("stagesShown: 이 FLIGHT에 없는 단계는 빼고 순서는 그대로", () => {
  assert.deepEqual(stagesShown(row("ATC-1")), [...FOLLOW_STAGES]);
  assert.deepEqual(stagesShown(row("ATC-1", ["pr", "landed", "deployed"])), ["todo", "proposed", "approved", "sent", "readback", "ci"]);
});
