import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { check, checkMarkModel, CROSSCHECK_MODELS, MCC_MODELS, REVIEW_MODELS } from "../controller/guard.mjs";
import { MCC_MODELS as SERVER_MCC_MODELS } from "../server/mcc.ts";
import { checkRead, rootsOf } from "./read-guard.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const REPO = join(HERE, "..");
const settings = JSON.parse(readFileSync(new URL(".claude/settings.json", import.meta.url), "utf8"));
const CTL = "node ../controller/atcctl.mjs";

test("MCC 설정: Claude, guard --mcc --gh-read, 모델은 guard가 붙이고, 쓰기·메시지·게시 도구는 막는다", () => {
  assert.equal(settings.model, "opus");
  assert.equal(settings.env?.ATC_MCC_MODEL, undefined);
  for (const t of ["Edit", "Write", "NotebookEdit", "SendMessage", "Artifact"]) assert.ok(settings.permissions.deny.includes(t), t);
  // ATC-135: Agent는 inspector만(허용 규칙 + agent-guard hook), 다른 하위 에이전트는 hook이 막는다
  assert.ok(!settings.permissions.deny.includes("Agent"));
  assert.ok(settings.permissions.allow.includes("Agent(inspector)"));
  const hooks = settings.hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  assert.ok(hooks.every((c) => c.endsWith("exit 2")), "hook은 fail-closed");
  assert.ok(hooks.some((c) => c.includes('guard.mjs" --mcc --gh-read ||')), "Bash guard 옵션");
  assert.ok(hooks.some((c) => c.includes('read-guard.mjs" ||')), "읽기 guard");
  // gh는 읽기만(머지·댓글·api 없음)
  const gh = settings.permissions.allow.filter((a) => a.startsWith("Bash(gh "));
  assert.deepEqual(gh, ["Bash(gh pr view *)", "Bash(gh pr diff *)", "Bash(gh pr checks *)", "Bash(gh pr list *)"]);
  assert.deepEqual(settings.permissions.additionalDirectories, [".."]);
});

test("MCC 모델: 서버와 guard가 같은 규칙. Claude만, ocx로 돌린 다른 모델·Muse·DeepSeek은 아님", () => {
  assert.equal(MCC_MODELS.source, SERVER_MCC_MODELS.source);
  for (const m of ["claude-opus-5-5", "claude-sonnet-5", "claude-fable-5-1", "claude-haiku-4-5-20251001"]) assert.match(m, MCC_MODELS, m);
  for (const m of ["claude-ocx-opencode-go--deepseek-v4.1-flash", "muse-spark-1.3-contributor", "deepseek-v4.1-flash", "gpt-5.6-terra"]) assert.doesNotMatch(m, MCC_MODELS, m);
  assert.doesNotMatch("claude-opus-5-5", REVIEW_MODELS);
  // CROSSCHECK도 Opus다(2026-09-29). 쓰기 권한은 모델이 아니라 guard 모드(--mcc·--crosscheck)로 가른다
  assert.match("claude-opus-5-5", CROSSCHECK_MODELS);
});

test("MCC Bash: manual·mcc 명령·읽기 gh·jq만. 다른 atcctl, gh 쓰기, git·systemctl은 막는다", () => {
  const ok = (c) => assert.equal(check(c, HERE, { mcc: true, ghRead: true }), null, c);
  const no = (c) => assert.notEqual(check(c, HERE, { mcc: true, ghRead: true }), null, c);
  ok(`${CTL} manual check`);
  ok(`${CTL} mcc queue | jq '.pulls[0]'`);
  ok(`${CTL} mcc packet 110`);
  ok(`${CTL} mcc inspect 110 --head abc1234 --verdict pass -- 'ok'`);
  ok(`${CTL} mcc land 110 --head abc1234`);
  ok("gh pr diff 110 --repo chaehy5665/atc");
  no(`${CTL} brief`);
  no(`${CTL} dispatch release D-0001`);
  no(`${CTL} landing review atc#110 --head abc1234 --verdict pass -- 'ok'`);
  no("gh pr merge 110");
  no("gh pr comment 110 --body x");
  no("gh api -X PUT repos/o/r/pulls/1/merge");
  no("git merge --ff-only origin/main");
  no("systemctl --user restart atc");
  no(`ATC_MCC_MODEL=claude-opus-5-5 ${CTL} mcc land 110 --head abc1234`);
});

test("다른 관제 세션(TOWER·OCC·CROSSCHECK·REVIEW)은 mcc 쓰기를 못 한다. 읽기(queue·packet)는 TOWER·OCC만", () => {
  for (const w of ["inspect 1 --head abc1234 --verdict pass -- 'ok'", "escalate 1 -- 'x'", "land 1 --head abc1234", "rts"]) {
    for (const opts of [{}, { ghRead: true }, { crosscheck: true }, { review: true }]) assert.notEqual(check(`${CTL} mcc ${w}`, HERE, opts), null, `${w} ${JSON.stringify(opts)}`);
  }
  assert.equal(check(`${CTL} mcc queue`, HERE, {}), null);
  assert.equal(check(`${CTL} mcc packet 1`, HERE, { ghRead: true }), null);
  assert.notEqual(check(`${CTL} mcc queue`, HERE, { review: true }), null);
});

test("MCC 쓰기의 실제 모델: 기록의 마지막 assistant 모델이 Claude일 때만 ATC_MCC_MODEL을 붙인다", () => {
  const tx = (model) => `${JSON.stringify({ type: "assistant", message: { model } })}\n`;
  const cmd = `${CTL} mcc land 110 --head abc1234`;
  assert.deepEqual(checkMarkModel(cmd, HERE, tx("claude-opus-5-5"), "mcc"), { command: `ATC_MCC_MODEL='claude-opus-5-5' ${cmd}`, model: "claude-opus-5-5" });
  assert.match(checkMarkModel(cmd, HERE, tx("deepseek-v4.1-flash"), "mcc").reason, /MCC로 쓸 수 없음/);
  assert.match(checkMarkModel(cmd, HERE, null, "mcc").reason, /transcript/);
  assert.match(checkMarkModel(`${cmd} | jq .`, HERE, tx("claude-opus-5-5"), "mcc").reason, /단독/);
  // 읽기는 모델을 보지 않는다
  assert.deepEqual(checkMarkModel(`${CTL} mcc queue`, HERE, null, "mcc"), { command: `${CTL} mcc queue` });
});

test("MCC 읽기: atc 저장소는 읽고, .env*·저장소 밖·운영 상태·저장소 맨 위 Grep은 막는다", () => {
  const roots = rootsOf();
  for (const f of ["../server/mcc.ts", "../docs/mcc.md", "CLAUDE.md", "../package.json"]) {
    assert.equal(checkRead("Read", { file_path: f }, { cwd: HERE, roots }), null, f);
  }
  for (const f of ["../.env.local", "../.env.example", "/home/c10/.local/state/atc/mcc.jsonl", "/home/c10/.claude/settings.json", "../../vocado_nextjs/AGENTS.md"]) {
    assert.notEqual(checkRead("Read", { file_path: f }, { cwd: HERE, roots }), null, f);
  }
  assert.equal(checkRead("Grep", { pattern: "mccModelOf", path: join(REPO, "server") }, { cwd: HERE, roots }), null);
  assert.match(checkRead("Grep", { pattern: "KEY", path: REPO }, { cwd: HERE, roots }) ?? "", /맨 위/);
  assert.match(checkRead("Grep", { pattern: "KEY", path: join(REPO, "server"), glob: "**/.env*" }, { cwd: HERE, roots }) ?? "", /비밀/);
  assert.notEqual(checkRead("Glob", { pattern: "../../*", path: HERE }, { cwd: HERE, roots }), null);
  const r = spawnSync(process.execPath, [join(HERE, "read-guard.mjs")], { input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: "../.env.local" }, cwd: HERE }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /MCC 읽기 차단/);
});

test("hook으로 부른 guard --mcc: Claude 기록이면 모델을 붙여 통과, 다른 모델이면 exit 2", () => {
  const guard = join(REPO, "controller", "guard.mjs");
  const dir = mkdtempSync(join(tmpdir(), "mcc-guard-"));
  const run = (model) => {
    const transcript = join(dir, `${model}.jsonl`);
    writeFileSync(transcript, `${JSON.stringify({ type: "assistant", message: { model } })}\n`);
    const command = `${CTL} mcc land 110 --head abc1234`;
    return spawnSync(process.execPath, [guard, "--mcc", "--gh-read"], { input: JSON.stringify({ tool_input: { command }, cwd: HERE, transcript_path: transcript }) });
  };
  const ok = run("claude-opus-5-5");
  assert.equal(ok.status, 0);
  assert.match(JSON.parse(ok.stdout.toString()).hookSpecificOutput.updatedInput.command, /^ATC_MCC_MODEL='claude-opus-5-5' node/);
  const bad = run("deepseek-v4.1-flash");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr.toString(), /MCC 쓰기 차단/);
});

// SQUELCH(docs/squelch.md 5장, ATC-109): UserPromptSubmit hook은 guard가 아니다. 평범한 /tick만 서버에 묻고, 어떤 오류든 통과시킨다.
// 그래서 `|| exit 2`가 붙으면 안 된다. 그리고 PreToolUse guard hook은 그대로다.
const GUARD_HOOKS = [
  ["Bash", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/../controller/guard.mjs\" --mcc --gh-read || exit 2"],
  ["mcp__.*", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/../occ/mcp-guard.mjs\" --read-only || exit 2"],
  ["Read|Glob|Grep", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/read-guard.mjs\" || exit 2"],
  ["Edit|Write|MultiEdit|NotebookEdit|SendMessage|Artifact", "echo 'MCC는 파일을 고치거나 메시지를 보내지 않습니다 — 착륙은 atcctl mcc로만.' >&2; exit 2"],
  // ATC-135: 하위 에이전트는 inspector 하나만(agent-guard.mjs)
  ["Agent|Task", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/agent-guard.mjs\" || exit 2"],
];

test("SQUELCH hook: mcc 역할로 걸려 있고 exit 2가 없다", () => {
  const ups = settings.hooks.UserPromptSubmit;
  assert.equal(ups.length, 1);
  assert.equal(ups[0].hooks.length, 2);
  const h = ups[0].hooks[0];
  assert.equal(h.type, "command");
  assert.equal(h.command, "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/../controller/squelch.mjs\" mcc");
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
