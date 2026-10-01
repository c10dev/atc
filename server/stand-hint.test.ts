import assert from "node:assert/strict";
import { test } from "node:test";
import { STAND_NEEDS_HINT, standNeedsHint } from "./stand-hint.ts";

test("STAND 힌트: needs가 Entering worktree 승인일 때만(ATC-252)", () => {
  assert.equal(standNeedsHint("approve Entering worktree"), STAND_NEEDS_HINT);
  assert.equal(standNeedsHint("Approve entering worktree /x"), STAND_NEEDS_HINT);
  assert.equal(standNeedsHint("approve Bash"), null);
  assert.equal(standNeedsHint(null), null);
  assert.equal(standNeedsHint(""), null);
});

test("worktree-voc-… 브랜치·폴더도 claude/voc-…와 같은 key로 읽는다(ATC-252)", async () => {
  const { keyInName } = await import("./linear-keys.ts");
  const keys = ["VOC", "ATC"];
  assert.equal(keyInName("worktree-voc-170-fix-x", keys), "VOC-170");
  assert.equal(keyInName("claude/voc-170-fix-x", keys), "VOC-170");
  assert.equal(keyInName("/home/c10/projects/vocado_nextjs/.claude/worktrees/voc-170-fix-x", keys), "VOC-170");
});
