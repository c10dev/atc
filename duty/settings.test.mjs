import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ALLOWED_TOOLS, check } from "./guard.mjs";
import { DUTY_TOOLS } from "./spawn.mjs";

// DUTY의 설정은 .claude/ 밖의 duty/settings.json이고 `--settings`로 준다(D0: -p는 신뢰하지 않은 폴더의 .claude/settings.json 허용 목록을 무시한다)
const settings = JSON.parse(readFileSync(new URL("settings.json", import.meta.url), "utf8"));
const NODE = "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\"";

test("설정 파일 자리: duty/settings.json이고 duty/.claude/settings.json은 없다", () => {
  assert.equal(existsSync(new URL(".claude/settings.json", import.meta.url)), false);
});

test("모델과 최상위 키: model만 정하고 mcp·환경·추가 폴더는 없다", () => {
  assert.equal(settings.model, "claude-sonnet-5-5");
  assert.deepEqual(Object.keys(settings).sort(), ["hooks", "model", "permissions"]);
  assert.deepEqual(Object.keys(settings.permissions).sort(), ["allow", "deny"], "additionalDirectories·defaultMode를 두지 않는다");
});

test("거부 목록: 쓰기·서브에이전트·메시지·웹 도구", () => {
  assert.deepEqual(settings.permissions.deny, ["Edit", "Write", "NotebookEdit", "Agent", "SendMessage", "WebFetch", "WebSearch"]);
  for (const t of settings.permissions.deny) assert.equal(ALLOWED_TOOLS.has(t), false, `${t}는 guard도 허용하지 않는다`);
});

test("허용 목록: L0 명령과 읽기 도구뿐(쓰기·gh api·curl·systemctl·kill·npm·claude·node -e 없음)", () => {
  assert.deepEqual(settings.permissions.allow, [
    "Bash(node ../controller/atcctl.mjs duty *)",
    "Bash(node /home/c10/projects/atc/controller/atcctl.mjs duty *)",
    "Bash(node ../controller/atcctl.mjs dispatch brief)",
    "Bash(node ../controller/atcctl.mjs dispatch flight *)",
    "Bash(node ../controller/atcctl.mjs schedule brief)",
    "Bash(node ../controller/atcctl.mjs crosscheck brief)",
    "Bash(node ../controller/atcctl.mjs landing queue)",
    "Bash(node ../controller/atcctl.mjs manual check)",
    "Bash(node ../controller/atcctl.mjs network)",
    "Bash(node ../controller/atcctl.mjs following)",
    "Bash(jq *)",
    "Bash(gh pr view *)",
    "Bash(gh pr list *)",
    "Bash(gh pr checks *)",
    "Bash(gh pr diff *)",
    "Bash(git log *)",
    "Bash(git show *)",
    "Bash(git diff *)",
    "Bash(git status *)",
    "Bash(git status)",
    "Read",
    "Glob",
    "Grep",
  ]);
  const text = settings.permissions.allow.join("\n");
  for (const bad of ["curl", "wget", "gh api", "gh pr merge", "gh pr create", "systemctl", "kill", "npm", "claude", "node -e", "tee", "rm ", "Edit", "Write", "SendMessage"]) assert.ok(!text.includes(bad), bad);
});

test("허용 목록의 Bash 규칙은 모두 guard도 통과시킨다(둘이 어긋나지 않는다)", () => {
  const DUTY = new URL(".", import.meta.url).pathname;
  for (const rule of settings.permissions.allow) {
    const m = /^Bash\((.*)\)$/.exec(rule);
    if (!m) continue;
    const command = m[1].replace(/ \*$/, " x").replace("/home/c10/projects/atc/controller", new URL("../controller", import.meta.url).pathname);
    const sample = /atcctl\.mjs duty x$/.test(command) ? command.replace(/duty x$/, "duty brief") : /^jq/.test(command) ? "node ../controller/atcctl.mjs duty brief | jq ." : command.replace(/ x$/, m[1].includes("gh pr") ? " 1" : "");
    assert.equal(check({ tool_name: "Bash", tool_input: { command: sample }, cwd: DUTY }), null, `${rule} → ${sample}`);
  }
});

test("--tools 목록(spawn)은 guard의 허용 도구와 같다", () => {
  assert.deepEqual(new Set(DUTY_TOOLS.split(",")), ALLOWED_TOOLS);
});

// PreToolUse guard hook: 모든 도구(`.*`)에 걸리고 fail-closed(`|| exit 2`). SendMessage 같은 다른 hook은 없다(도구 자체가 없다)
test("hook: PreToolUse 하나, matcher .*, guard.mjs || exit 2, 그 밖에는 UserPromptSubmit(brief hook)뿐", () => {
  assert.deepEqual(Object.keys(settings.hooks).sort(), ["PreToolUse", "UserPromptSubmit"]);
  const pre = settings.hooks.PreToolUse;
  assert.equal(pre.length, 1);
  assert.equal(pre[0].matcher, ".*");
  assert.equal(pre[0].hooks.length, 1);
  const h = pre[0].hooks[0];
  assert.equal(h.type, "command");
  assert.equal(h.command, `${NODE} "$CLAUDE_PROJECT_DIR/guard.mjs" || exit 2`);
  assert.equal(h.timeout, 5);
});

// UserPromptSubmit brief hook(D4): fail-open. guard와 반대로 `|| exit 0`이라 hook이 죽어도 턴은 돈다. 도구를 막는 일은 하지 않는다
test("hook: UserPromptSubmit 하나, brief-hook.mjs || exit 0(fail-open), 파일이 있다", () => {
  const ups = settings.hooks.UserPromptSubmit;
  assert.equal(ups.length, 1);
  assert.equal(ups[0].matcher, undefined);
  assert.equal(ups[0].hooks.length, 1);
  const h = ups[0].hooks[0];
  assert.equal(h.type, "command");
  assert.equal(h.command, `${NODE} "$CLAUDE_PROJECT_DIR/brief-hook.mjs" || exit 0`);
  assert.ok(h.timeout >= 6 && h.timeout <= 10, "hook 자체 제한은 fetch 제한(5초)보다 조금 길다");
  assert.ok(existsSync(new URL("brief-hook.mjs", import.meta.url)));
  assert.ok(!/exit 2/.test(h.command), "brief hook은 턴을 막지 않는다");
});
