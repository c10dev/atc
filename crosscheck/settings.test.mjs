import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check, CROSSCHECK_MODELS } from "../controller/guard.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const settings = JSON.parse(readFileSync(new URL(".claude/settings.json", import.meta.url), "utf8"));

test("CROSSCHECK 설정: 모델은 허용 목록 안, mark의 모델은 settings가 아니라 guard가 붙이고, 쓰기·메시지·게시 도구는 막는다", () => {
  assert.ok(settings.model, "model이 필요함");
  assert.match(settings.model, CROSSCHECK_MODELS);
  // settings env에 모델을 적어 두면 Desktop처럼 다른 모델로 돌 때 거짓 이름이 남는다
  assert.equal(settings.env?.ATC_CROSSCHECK_MODEL, undefined);
  // OCC(Sonnet)와 다른 모델이 다시 본다. ocx 경로는 끊었다(2026-09-29)
  assert.doesNotMatch(settings.model, /sonnet|ocx|deepseek/i);
  for (const t of ["Edit", "Write", "NotebookEdit", "SendMessage", "Agent", "Artifact"]) assert.ok(settings.permissions.deny.includes(t), t);
  const hooks = settings.hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  assert.ok(hooks.every((c) => c.endsWith("exit 2")), "hook은 fail-closed");
  // Bash는 guard --crosscheck --gh-read. gh는 읽기 전용 view·checks·list만 allow에 둔다
  assert.ok(hooks.some((c) => c.includes("guard.mjs\" --crosscheck --gh-read ||")), "Bash guard 옵션");
  const gh = settings.permissions.allow.filter((a) => a.startsWith("Bash(gh "));
  assert.deepEqual(gh.sort(), ["Bash(gh pr checks *)", "Bash(gh pr list *)", "Bash(gh pr view *)"]);
});

test("CROSSCHECK 세션은 명령 앞 환경 변수로 모델 이름을 바꿀 수 없다", () => {
  const opts = { crosscheck: true };
  assert.equal(check("node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
  assert.notEqual(check("ATC_CROSSCHECK_MODEL=x node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
  assert.notEqual(check("env ATC_CROSSCHECK_MODEL=x node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
  assert.notEqual(check("export ATC_CROSSCHECK_MODEL=x; node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
});

test("CROSSCHECK 읽기: 허용은 ../docs 하나(additionalDirectories)이고, Read·Glob·Grep은 read-guard가 뿌리 밖을 막는다", () => {
  assert.deepEqual(settings.permissions.additionalDirectories, ["../docs"]);
  // 파일 읽기 allow 규칙으로 범위를 넓히지 않는다
  assert.deepEqual(settings.permissions.allow.filter((a) => /^(Read|Glob|Grep)\b/.test(a)), []);
  for (const t of ["Edit", "Write", "NotebookEdit"]) assert.ok(settings.permissions.deny.includes(t), t);
  const read = settings.hooks.PreToolUse.find((h) => h.matcher === "Read|Glob|Grep");
  assert.ok(read, "Read|Glob|Grep hook");
  assert.match(read.hooks[0].command, /read-guard\.mjs" \|\| exit 2$/);
});
