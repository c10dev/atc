import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DUTY_DIR, DUTY_TOOLS, dutyArgvOf } from "./spawn.mjs";

const ID = "0f8e7c1e-2b6a-4c3d-9d10-5a1b2c3d4e5f";
const DIR = dirname(fileURLToPath(import.meta.url));

test("새 대화: 정확한 명령줄(D0가 잰 것 + --tools·--strict-mcp-config·--settings)", () => {
  const r = dutyArgvOf({ sessionId: ID });
  assert.equal(r.command, "claude");
  assert.equal(r.cwd, DIR);
  assert.equal(r.sessionId, ID);
  assert.deepEqual(r.args, [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--include-hook-events",
    "--replay-user-messages",
    "--strict-mcp-config",
    "--tools", "Bash,Read,Glob,Grep,Edit,Write",
    "--settings", join(DIR, "settings.json"),
    "--session-id", ID,
  ]);
  assert.ok(existsSync(join(DUTY_DIR, "settings.json")), "--settings가 가리키는 파일이 있다");
});

test("id를 안 주면 새 UUID를 만든다", () => {
  const a = dutyArgvOf();
  const b = dutyArgvOf();
  assert.match(a.sessionId, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(a.args.at(-1), a.sessionId);
});

test("이어 가기: --resume <id>(--session-id가 아님), id가 없거나 UUID가 아니면 오류", () => {
  const r = dutyArgvOf({ resume: true, sessionId: ID });
  assert.deepEqual(r.args.slice(-2), ["--resume", ID]);
  assert.ok(!r.args.includes("--session-id"));
  assert.throws(() => dutyArgvOf({ resume: true }), /sessionId/);
  assert.throws(() => dutyArgvOf({ sessionId: "not-a-uuid" }), /UUID/);
  assert.throws(() => dutyArgvOf({ sessionId: "x; rm -rf /" }), /UUID/);
});

test("도구 목록은 DUTY_TOOLS 그대로, claude 경로와 폴더는 바꿀 수 있다", () => {
  assert.equal(DUTY_TOOLS, "Bash,Read,Glob,Grep,Edit,Write");
  const r = dutyArgvOf({ sessionId: ID, claudeBin: "/x/claude", dir: "/tmp/somewhere/duty" });
  assert.equal(r.command, "/x/claude");
  assert.equal(r.cwd, "/tmp/somewhere/duty");
  assert.equal(r.args[r.args.indexOf("--settings") + 1], "/tmp/somewhere/duty/settings.json");
});
