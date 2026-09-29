import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const settings = JSON.parse(readFileSync(new URL(".claude/settings.json", import.meta.url), "utf8"));

// SQUELCH(docs/squelch.md 5장, ATC-109): UserPromptSubmit hook은 guard가 아니다. 평범한 /tick만 서버에 묻고, 어떤 오류든 통과시킨다.
// 그래서 `|| exit 2`가 붙으면 안 된다. 그리고 PreToolUse guard hook은 그대로다.
const GUARD_HOOKS = [
  ["Bash", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/guard.mjs\" || exit 2"],
];

test("SQUELCH hook: tower 역할로 걸려 있고 exit 2가 없다", () => {
  const ups = settings.hooks.UserPromptSubmit;
  assert.equal(ups.length, 1);
  assert.equal(ups[0].hooks.length, 1);
  const h = ups[0].hooks[0];
  assert.equal(h.type, "command");
  assert.equal(h.command, "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/squelch.mjs\" tower");
  assert.equal(h.timeout, 5);
  assert.doesNotMatch(h.command, /exit\s+2/);
  assert.doesNotMatch(h.command, /\|\|/);
  assert.equal(ups[0].matcher, undefined, "UserPromptSubmit은 matcher를 쓰지 않는다");
});

test("SQUELCH를 걸어도 PreToolUse guard hook은 그대로다", () => {
  const pre = settings.hooks.PreToolUse.map((h) => [h.matcher, h.hooks.map((x) => x.command).join("\n")]);
  assert.deepEqual(pre, GUARD_HOOKS);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ["PreToolUse", "UserPromptSubmit"]);
});
