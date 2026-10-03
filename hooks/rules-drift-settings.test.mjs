import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// ATC-295: 루트 .claude/settings.json이 rules-drift hook을 걸고, 감시 파일이 바뀌면 다음 턴에 diff가 들어가며, hook이 절대 막지 않는다
const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
const HOOK = fileURLToPath(new URL("./rules-drift.mjs", import.meta.url));
const MAIN_PATH = "/home/c10/projects/atc/hooks/rules-drift.mjs";
const PINNED = "/home/c10/.nvm/versions/node/v24.19.0/bin/node";
const FILES = "CLAUDE.md,AGENTS.md,docs/design-language.md,.claude/skills/atc-task/SKILL.md";
const commandOf = (event) => settings.hooks[event][0].hooks[0].command;

test("루트 .claude/settings.json: SessionStart는 start, UserPromptSubmit과 PostToolUse는 check, 같은 ref·감시 파일", () => {
  for (const [event, mode] of [["SessionStart", "start"], ["UserPromptSubmit", "check"], ["PostToolUse", "check"]]) {
    assert.equal(settings.hooks[event].length, 1, event);
    const h = settings.hooks[event][0];
    assert.equal(h.hooks[0].type, "command");
    assert.equal(h.hooks[0].timeout, 5);
    if (event === "PostToolUse") assert.equal(h.matcher, "*");
    const cmd = h.hooks[0].command;
    assert.match(cmd, new RegExp(`hooks/rules-drift\\.mjs.*"\\$f" ${mode} `), event);
    assert.ok(cmd.includes("--ref origin/main"), event);
    assert.ok(cmd.includes(`--files ${FILES}`), event);
    // 절대 막지 않는다: 어떤 일이 있어도 exit 0. fail-closed(exit 2)가 아니다
    assert.match(cmd, /; exit 0$/, event);
    assert.ok(!/exit 2/.test(cmd), event);
  }
});

test("kill-guard는 그대로 fail-closed(|| exit 2)", () => {
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /hooks\/kill-guard\.mjs.*\|\| exit 2$/);
});

// 설정의 명령을 그대로 bash로 돌린다(node 경로와 main 체크아웃 폴백 경로만 시험용으로 바꾼다)
const runHook = (event, { projectDir, fallback = HOOK, stdin, stateDir }) => {
  const cmd = commandOf(event).replace(MAIN_PATH, fallback).replace(PINNED, process.execPath);
  return spawnSync("bash", ["-c", cmd], { input: stdin, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ATC_STATE_DIR: stateDir }, timeout: 8000 });
};

test("hook 명령은 막지 않는다: 깨진 stdin, hook 파일이 어디에도 없음, 상태 폴더가 쓸 수 없음 모두 exit 0, 출력 없음", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-"));
  try {
    const bad = runHook("UserPromptSubmit", { projectDir: dir, stdin: "not json", stateDir: dir });
    assert.deepEqual([bad.status, bad.stdout], [0, ""]);
    const missing = runHook("UserPromptSubmit", { projectDir: "/nonexistent", fallback: "/nonexistent/rules-drift.mjs", stdin: "{}", stateDir: dir });
    assert.equal(missing.status, 0); // node가 파일을 못 열어도 exit 0
    const file = join(dir, "afile");
    writeFileSync(file, "x");
    const unwritable = runHook("SessionStart", { projectDir: dir, stdin: JSON.stringify({ session_id: "s1", source: "startup", cwd: dir }), stateDir: file });
    assert.deepEqual([unwritable.status, unwritable.stdout], [0, ""]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("감시 파일이 바뀌면(origin/main이 움직이면) 다음 턴에 diff가 들어가고, 프로젝트 폴더에 hook이 없으면 main 체크아웃 것으로 돈다", () => {
  const dir = mkdtempSync(join(tmpdir(), "rd-"));
  const remote = join(dir, "remote.git");
  const repo = join(dir, "repo");
  const state = join(dir, "state");
  try {
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    git(dir, "init", "-q", "-b", "main", repo);
    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(join(repo, ".claude/skills/atc-task"), { recursive: true });
    const design = (n) => Array.from({ length: n }, (_, i) => `rule ${i}`).join("\n") + "\n";
    writeFileSync(join(repo, "CLAUDE.md"), "root rules\n");
    writeFileSync(join(repo, "docs/design-language.md"), design(10));
    writeFileSync(join(repo, ".claude/skills/atc-task/SKILL.md"), "task skill\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "origin", "main");
    git(repo, "fetch", "-q", "origin");
    // 이 repo에는 hooks/가 없다 → 명령이 main 체크아웃 폴백(여기서는 이 저장소의 hook)으로 돈다
    const session = { session_id: "scratch-1", cwd: repo };
    const start = runHook("SessionStart", { projectDir: repo, stdin: JSON.stringify({ ...session, hook_event_name: "SessionStart", source: "startup" }), stateDir: state });
    assert.deepEqual([start.status, start.stdout], [0, ""]);
    const quiet = runHook("UserPromptSubmit", { projectDir: repo, stdin: JSON.stringify({ ...session, hook_event_name: "UserPromptSubmit" }), stateDir: state });
    assert.deepEqual([quiet.status, quiet.stdout], [0, ""], "바뀐 것이 없으면 말하지 않는다");

    // 한 줄을 바꿔 origin/main에 올린다(작업 트리는 그대로: --ref가 따라간다)
    writeFileSync(join(repo, "docs/design-language.md"), design(10).replace("rule 3\n", "rule 3 changed\n"));
    git(repo, "commit", "-q", "-am", "edit one line");
    git(repo, "push", "-q", "origin", "main");
    git(repo, "fetch", "-q", "origin");
    const out = runHook("UserPromptSubmit", { projectDir: repo, stdin: JSON.stringify({ ...session, hook_event_name: "UserPromptSubmit" }), stateDir: state });
    assert.equal(out.status, 0);
    const ctx = JSON.parse(out.stdout).hookSpecificOutput;
    assert.equal(ctx.hookEventName, "UserPromptSubmit");
    assert.match(ctx.additionalContext, /docs\/design-language\.md/);
    assert.match(ctx.additionalContext, /^-rule 3$/m);
    assert.match(ctx.additionalContext, /^\+rule 3 changed$/m);
    // 한 번 받았으면 다시 말하지 않는다
    const again = runHook("UserPromptSubmit", { projectDir: repo, stdin: JSON.stringify({ ...session, hook_event_name: "UserPromptSubmit" }), stateDir: state });
    assert.equal(again.stdout, "");

    // atc-task skill도 감시한다
    writeFileSync(join(repo, ".claude/skills/atc-task/SKILL.md"), "task skill v2\n");
    git(repo, "commit", "-q", "-am", "edit skill");
    git(repo, "push", "-q", "origin", "main");
    git(repo, "fetch", "-q", "origin");
    const skill = runHook("UserPromptSubmit", { projectDir: repo, stdin: JSON.stringify({ ...session, hook_event_name: "UserPromptSubmit" }), stateDir: state });
    assert.match(JSON.parse(skill.stdout).hookSpecificOutput.additionalContext, /\.claude\/skills\/atc-task\/SKILL\.md/);

    // 긴 문서를 크게 고치면 diff는 150줄에서 잘리고 파일을 다시 읽으라고 한다(막지 않는다)
    writeFileSync(join(repo, "docs/design-language.md"), design(400).replace(/rule/g, "new rule"));
    git(repo, "commit", "-q", "-am", "rewrite");
    git(repo, "push", "-q", "origin", "main");
    git(repo, "fetch", "-q", "origin");
    const big = runHook("UserPromptSubmit", { projectDir: repo, stdin: JSON.stringify({ ...session, hook_event_name: "UserPromptSubmit" }), stateDir: state });
    assert.equal(big.status, 0);
    const text = JSON.parse(big.stdout).hookSpecificOutput.additionalContext;
    assert.ok(text.split("\n").length <= 160, `diff가 잘리지 않음: ${text.split("\n").length}줄`);
    assert.match(text, /Read로 다시 읽는다/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
