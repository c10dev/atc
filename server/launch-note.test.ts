import test from "node:test";
import assert from "node:assert/strict";
import { nextLaunchLabel, nextLaunchNote } from "./launch-note.ts";

test("nextLaunchNote: override shows next LAUNCH with home", () => {
  assert.equal(nextLaunchNote("acct-1", "acct-2"), "next LAUNCH acct-1 (home acct-2)");
  assert.equal(nextLaunchNote("acct-1", null), "next LAUNCH acct-1 (home default)");
  assert.equal(nextLaunchNote("acct-1", undefined), "next LAUNCH acct-1 (home default)");
});

test("nextLaunchNote: cleared or same as home shows nothing", () => {
  assert.equal(nextLaunchNote(null, "acct-2"), null);
  assert.equal(nextLaunchNote(undefined, null), null);
  assert.equal(nextLaunchNote("acct-2", "acct-2"), null);
});

test("nextLaunchLabel: label only, nothing when cleared", () => {
  assert.equal(nextLaunchLabel("acct-1"), "next LAUNCH acct-1");
  assert.equal(nextLaunchLabel(null), null);
  assert.equal(nextLaunchLabel(undefined), null);
});
