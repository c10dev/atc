import assert from "node:assert/strict";
import { test } from "node:test";
import { standBranch, standDirName, standDoneVerdict, standNameOf, standPath, worktreePaths } from "./duty-stand.ts";

test("STAND 이름: 소문자·숫자·하이픈, 40자까지, ATC key 없음", () => {
  for (const n of ["charter-desk", "a", "d7a", "design-2", "x-y-z"]) assert.deepEqual(standNameOf(n), { ok: true, name: n }, n);
  for (const n of ["", "A", "Charter", "a_b", "a b", "-a", "a-", "a--b", "a/b", "../x", "a.b", "ü", "a\n", "x".repeat(41), "atc-235", "atc-235-x", "design-atc-1", "design-atc-12-x", undefined, null, 5, {}]) {
    assert.equal(standNameOf(n).ok, false, JSON.stringify(n));
  }
  assert.equal(standNameOf("x".repeat(40)).ok, true);
  assert.equal(standNameOf("atc-office").ok, true, "atc- 뒤가 숫자가 아니면 key가 아니다");
});

test("STAND 경로와 브랜치: .claude/worktrees/duty-<이름>, claude/duty-<이름>", () => {
  assert.equal(standDirName("x"), "duty-x");
  assert.equal(standBranch("x"), "claude/duty-x");
  assert.equal(standPath("/r", "x"), "/r/.claude/worktrees/duty-x");
});

test("worktree list --porcelain에서 경로를 뽑는다", () => {
  assert.deepEqual(worktreePaths("worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/duty-x\nHEAD def\nbranch refs/heads/claude/duty-x\n"), ["/r", "/r/.claude/worktrees/duty-x"]);
  assert.deepEqual(worktreePaths(""), []);
});

test("stand-done: 등록돼 있어야 하고, 깨끗하거나 이미 머지됐을 때만", () => {
  assert.deepEqual(standDoneVerdict({ registered: false, dirty: false, merged: false }), { ok: false, status: 404, error: "그런 DUTY STAND가 없음" });
  assert.deepEqual(standDoneVerdict({ registered: true, dirty: false, merged: false }), { ok: true, force: false });
  assert.deepEqual(standDoneVerdict({ registered: true, dirty: false, merged: true }), { ok: true, force: false });
  assert.deepEqual(standDoneVerdict({ registered: true, dirty: true, merged: true }), { ok: true, force: true });
  const r = standDoneVerdict({ registered: true, dirty: true, merged: false });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.status, 409);
});
