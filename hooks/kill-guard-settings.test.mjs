import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
const GUARD = fileURLToPath(new URL("./kill-guard.mjs", import.meta.url));
const MAIN_PATH = "/home/c10/projects/atc/hooks/kill-guard.mjs";
const PINNED = "/home/c10/.nvm/versions/node/v24.19.0/bin/node";

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
  const cmd = settings.hooks.PreToolUse[0].hooks[0].command.replace(MAIN_PATH, fallback).replace(PINNED, process.execPath);
  const input = JSON.stringify({ tool_input: { command: "kill 1" } });
  return spawnSync("bash", ["-c", cmd], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } });
};

test("hook 명령: 프로젝트 폴더에 hook이 없으면 main 체크아웃 것으로 돌고(exit 0), 어디에도 없으면 exit 2", () => {
  assert.equal(runHook("/nonexistent", GUARD).status, 0);
  assert.equal(runHook("/nonexistent", "/nonexistent/kill-guard.mjs").status, 2);
});

// ATC-451: 클라우드 세션처럼 고정 node가 없는 호스트. 설정의 명령을 그대로 돌리되 고정 경로만 존재하지 않는 경로로 바꾸고 PATH를 조절한다
const runBash = (bashCommand, { pinned, pathDirs }) => {
  const cmd = settings.hooks.PreToolUse[0].hooks[0].command.replace(PINNED, pinned).replace(MAIN_PATH, GUARD);
  const input = JSON.stringify({ tool_input: { command: bashCommand } });
  return spawnSync("/bin/bash", ["-c", cmd], { input, encoding: "utf8", env: { PATH: pathDirs.join(":"), CLAUDE_PROJECT_DIR: "/nonexistent" } });
};

test("hook 명령: 고정 node가 없고 PATH에 node가 있으면 그 node로 돈다(ls는 통과, pkill은 막힌다)", () => {
  const bin = mkdtempSync(join(tmpdir(), "kg-"));
  try {
    symlinkSync(process.execPath, join(bin, "node"));
    const opt = { pinned: "/nonexistent/bin/node", pathDirs: [bin] };
    assert.equal(runBash("ls", opt).status, 0);
    assert.equal(runBash('pkill -f "node server/index.ts"', opt).status, 2);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test("hook 명령: 고정 node도 PATH의 node도 없으면 exit 2(fail-closed)", () => {
  const empty = mkdtempSync(join(tmpdir(), "kg-"));
  try {
    assert.equal(runBash("ls", { pinned: "/nonexistent/bin/node", pathDirs: [empty] }).status, 2);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("hook 명령: 고정 node가 있으면 PATH에 node가 없어도 그 node로 돈다", () => {
  const empty = mkdtempSync(join(tmpdir(), "kg-"));
  try {
    const opt = { pinned: process.execPath, pathDirs: [empty] };
    assert.equal(runBash("ls", opt).status, 0);
    assert.equal(runBash('pkill -f "node server/index.ts"', opt).status, 2);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
