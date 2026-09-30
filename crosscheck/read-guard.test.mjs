import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkRead, rootsOf } from "./read-guard.mjs";

// 가짜 HOME(ATC-190): 진짜 ~/.claude·~/.local/state/atc를 realpath하지 않게, 없는 임시 경로로 "홈 아래 경로"를 시험한다
const FAKE_HOME = join(tmpdir(), "atc-fake-home");
const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const ATC = join(HERE, "..");
const TRANSCRIPT = join(FAKE_HOME, ".claude/projects/-x-crosscheck/abc-123.jsonl");
const roots = rootsOf({ dir: HERE, transcriptPath: TRANSCRIPT, sessionId: "abc-123" });
const ok = (tool, input) => assert.equal(checkRead(tool, input, { cwd: HERE, roots }), null, JSON.stringify(input));
const no = (tool, input) => assert.notEqual(checkRead(tool, input, { cwd: HERE, roots }), null, JSON.stringify(input));

test("read-guard: crosscheck/, ../docs/, 이 세션의 도구 출력만", () => {
  ok("Read", { file_path: "../docs/fleet.md" });
  ok("Read", { file_path: join(ATC, "docs/guide/reviewing.md") });
  ok("Read", { file_path: "CLAUDE.md" });
  ok("Read", { file_path: join(HERE, ".claude/skills/tick/SKILL.md") });
  ok("Read", { file_path: join(FAKE_HOME, ".claude/projects/-x-crosscheck/abc-123/tool-results/out.txt") });
  ok("Grep", { pattern: "WAKE", path: "../docs" });
  ok("Grep", { pattern: "WAKE" }); // path 없으면 cwd(crosscheck/)
  ok("Glob", { pattern: "**/*.md", path: "../docs" });
  no("Read", { file_path: "../server/index.ts" });
  no("Read", { file_path: "../docs/../server/index.ts" });
  no("Read", { file_path: "../CLAUDE.md" });
  no("Read", { file_path: join(FAKE_HOME, ".local/state/atc/proposals.jsonl") });
  no("Read", { file_path: "/home/c10/projects/vocado_nextjs/package.json" });
  no("Read", { file_path: join(FAKE_HOME, ".claude/projects/-x-crosscheck/other-session.jsonl") });
  no("Read", { file_path: join(FAKE_HOME, ".claude/projects/-x-crosscheck/other-session/tool-results/out.txt") });
  no("Read", {});
  no("Grep", { pattern: "x", path: ".." });
  no("Grep", { pattern: "x", path: "../server" });
  no("Glob", { pattern: "../server/*.ts", path: "../docs" });
  no("Glob", { pattern: "/home/c10/**", path: "../docs" });
  no("Glob", { pattern: "**/*.ts", path: ".." });
  // 다른 도구에는 관여하지 않는다
  assert.equal(checkRead("Bash", { command: "cat ../server/index.ts" }, { cwd: HERE, roots }), null);
});

test("read-guard: session_id가 이상하면 도구 출력 폴더를 열지 않는다", () => {
  const r = rootsOf({ dir: HERE, transcriptPath: TRANSCRIPT, sessionId: "../../.." });
  assert.equal(r.length, 2);
});

// settings와 같은 방식으로 hook CLI를 부른다
const runHook = (input) => spawnSync(process.execPath, [join(HERE, "read-guard.mjs")], { input: JSON.stringify(input), encoding: "utf8" });

test("read-guard CLI: docs는 exit 0, 소스·상태 폴더는 exit 2, 입력을 못 읽으면 exit 2", () => {
  const base = { cwd: HERE, transcript_path: TRANSCRIPT, session_id: "abc-123" };
  assert.equal(runHook({ ...base, tool_name: "Read", tool_input: { file_path: join(ATC, "docs/fleet.md") } }).status, 0);
  const blocked = runHook({ ...base, tool_name: "Read", tool_input: { file_path: join(ATC, "server/index.ts") } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /CROSSCHECK 읽기 차단/);
  assert.equal(runHook({ ...base, tool_name: "Read", tool_input: { file_path: join(FAKE_HOME, ".local/state/atc/fleet.json") } }).status, 2);
  assert.equal(spawnSync(process.execPath, [join(HERE, "read-guard.mjs")], { input: "nope", encoding: "utf8" }).status, 2);
});
