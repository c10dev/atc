import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
const GUARD = fileURLToPath(new URL("./kill-guard.mjs", import.meta.url));
const MAIN_PATH = "/home/c10/projects/atc/hooks/kill-guard.mjs";
const NODE_RE = /"[^"]*\/bin\/node"/;

test("루트 .claude/settings.json: Bash PreToolUse가 kill-guard를 fail-closed(|| exit 2)로 건다", () => {
  const bash = settings.hooks.PreToolUse.filter((h) => h.matcher === "Bash");
  assert.equal(bash.length, 1);
  assert.equal(bash[0].hooks[0].type, "command");
  const cmd = bash[0].hooks[0].command;
  assert.match(cmd, /hooks\/kill-guard\.mjs/);
  assert.match(cmd, /\|\| exit 2$/);
});

// 설정의 명령을 그대로 bash로 돌린다(node 경로와 main 체크아웃 폴백 경로만 시험용으로 바꾼다). 시험하는 것은 hook 명령이지 kill이 아니다.
const runHook = (projectDir, fallback) => {
  const cmd = settings.hooks.PreToolUse[0].hooks[0].command.replace(MAIN_PATH, fallback).replace(NODE_RE, `"${process.execPath}"`);
  const input = JSON.stringify({ tool_input: { command: "kill 1" } });
  return spawnSync("bash", ["-c", cmd], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } });
};

test("hook 명령: 프로젝트 폴더에 hook이 없으면 main 체크아웃 것으로 돌고(exit 0), 어디에도 없으면 exit 2", () => {
  assert.equal(runHook("/nonexistent", GUARD).status, 0);
  assert.equal(runHook("/nonexistent", "/nonexistent/kill-guard.mjs").status, 2);
});
