import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { check, CROSSCHECK_MODELS, REVIEW_MODELS } from "../controller/guard.mjs";
import { checkRead, rootsOf } from "./read-guard.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const settings = JSON.parse(readFileSync(new URL(".claude/settings.json", import.meta.url), "utf8"));

test("REVIEW 설정: 모델은 DeepSeek V4.1 Flash, 기록의 모델은 guard가 붙이고, 쓰기·메시지·게시 도구와 gh는 막는다", () => {
  assert.match(settings.model, REVIEW_MODELS);
  assert.doesNotMatch(settings.model, CROSSCHECK_MODELS); // CROSSCHECK(Muse)와 계열을 섞지 않는다
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
