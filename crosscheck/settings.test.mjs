import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check } from "../controller/guard.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const settings = JSON.parse(readFileSync(new URL(".claude/settings.json", import.meta.url), "utf8"));

test("CROSSCHECK 설정: mark에 남는 모델(env)이 세션 모델과 같고, 쓰기·메시지·게시 도구는 막는다", () => {
  assert.ok(settings.model, "model이 필요함");
  assert.equal(settings.env?.ATC_CROSSCHECK_MODEL, settings.model);
  // DeepSeek(flash-helper와 같은 모델)은 FLEET 규칙상 판정에 쓰지 않는다
  assert.doesNotMatch(settings.model, /deepseek/i);
  for (const t of ["Edit", "Write", "NotebookEdit", "SendMessage", "Agent", "Artifact"]) assert.ok(settings.permissions.deny.includes(t), t);
  const hooks = settings.hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  assert.ok(hooks.every((c) => c.endsWith("exit 2")), "hook은 fail-closed");
});

test("CROSSCHECK 세션은 명령 앞 환경 변수로 모델 이름을 바꿀 수 없다", () => {
  const opts = { crosscheck: true };
  assert.equal(check("node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
  assert.notEqual(check("ATC_CROSSCHECK_MODEL=x node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
  assert.notEqual(check("env ATC_CROSSCHECK_MODEL=x node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
  assert.notEqual(check("export ATC_CROSSCHECK_MODEL=x; node ../controller/atcctl.mjs dispatch crosscheck D-0001 agree -- 'x'", HERE, opts), null);
});
