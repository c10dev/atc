import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { check, CROSSCHECK_MODELS, REVIEW_MODELS } from "../controller/guard.mjs";
import { checkRead, rootsOf } from "./read-guard.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const settings = JSON.parse(readFileSync(new URL(".claude/settings.json", import.meta.url), "utf8"));

test("REVIEW 설정: 모델은 Claude Sonnet, 기록의 모델은 guard가 붙이고, 쓰기·메시지·게시 도구와 gh는 막는다", () => {
  assert.match(settings.model, REVIEW_MODELS);
  assert.doesNotMatch(settings.model, CROSSCHECK_MODELS); // CROSSCHECK(Opus)와 모델을 섞지 않는다
  assert.doesNotMatch(settings.model, /ocx/i); // ocx 경로는 끊었다(2026-09-29)
  assert.equal(settings.env?.ATC_REVIEW_MODEL, undefined);
  for (const t of ["Edit", "Write", "NotebookEdit", "SendMessage", "Agent", "Artifact"]) assert.ok(settings.permissions.deny.includes(t), t);
  const hooks = settings.hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  assert.ok(hooks.every((c) => c.endsWith("exit 2")), "hook은 fail-closed");
  assert.ok(hooks.some((c) => c.includes('guard.mjs" --review ||')), "Bash guard 옵션");
  assert.deepEqual(settings.permissions.allow.filter((a) => a.startsWith("Bash(gh ")), []); // diff는 atc가 준다
  assert.deepEqual(settings.permissions.additionalDirectories, ["../docs"]);
  assert.deepEqual(settings.permissions.allow.filter((a) => /^(Read|Glob|Grep)\b/.test(a)), []);
});

test("REVIEW 세션은 명령 앞 환경 변수로 모델 이름을 바꿀 수 없다", () => {
  const cmd = "node ../controller/atcctl.mjs landing review vocado_nextjs#385 --head abc1234 --verdict pass -- 'ok'";
  assert.equal(check(cmd, HERE, { review: true }), null);
  for (const pre of ["ATC_REVIEW_MODEL=x ", "env ATC_REVIEW_MODEL=x ", "export ATC_REVIEW_MODEL=x; "]) assert.notEqual(check(pre + cmd, HERE, { review: true }), null, pre);
});

test("REVIEW 읽기: review/와 docs/만. atc 소스·운영 상태·crosscheck/는 막는다", () => {
  const roots = rootsOf();
  assert.equal(checkRead("Read", { file_path: join(HERE, "CLAUDE.md") }, { cwd: HERE, roots }), null);
  assert.equal(checkRead("Read", { file_path: join(HERE, "..", "docs", "occ.md") }, { cwd: HERE, roots }), null);
  for (const f of ["../server/landing.ts", "../crosscheck/CLAUDE.md", "/home/c10/.local/state/atc/landing-reviews.jsonl", "../.env.local"]) {
    assert.notEqual(checkRead("Read", { file_path: f }, { cwd: HERE, roots }), null, f);
  }
  // hook으로 부르면 exit 2
  const r = spawnSync(process.execPath, [join(HERE, "read-guard.mjs")], { input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: "../server/landing.ts" }, cwd: HERE }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /착륙 리뷰\(REVIEW\) 읽기 차단/);
});

// SQUELCH(docs/squelch.md 5장, ATC-109): UserPromptSubmit hook은 guard가 아니다. 평범한 /tick만 서버에 묻고, 어떤 오류든 통과시킨다.
// 그래서 `|| exit 2`가 붙으면 안 된다. 그리고 PreToolUse guard hook은 그대로다.
const GUARD_HOOKS = [
  ["Bash", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/../controller/guard.mjs\" --review || exit 2"],
  ["mcp__.*", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/../occ/mcp-guard.mjs\" --read-only || exit 2"],
  ["Read|Glob|Grep", "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/read-guard.mjs\" || exit 2"],
  ["Edit|Write|MultiEdit|NotebookEdit|SendMessage|Agent|Task|Artifact", "echo '착륙 리뷰 세션(REVIEW)은 파일을 고치거나 메시지를 보내거나 하위 에이전트를 부르지 않습니다 — 리뷰는 atcctl landing review로만.' >&2; exit 2"],
];

test("SQUELCH hook: review 역할로 걸려 있고 exit 2가 없다", () => {
  const ups = settings.hooks.UserPromptSubmit;
  assert.equal(ups.length, 1);
  assert.equal(ups[0].hooks.length, 1);
  const h = ups[0].hooks[0];
  assert.equal(h.type, "command");
  assert.equal(h.command, "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"$CLAUDE_PROJECT_DIR/../controller/squelch.mjs\" review");
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
