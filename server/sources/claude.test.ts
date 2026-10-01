import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Workspace } from "../model.ts";
import { attachDirField, sessionEventsOf, sessionKindOf, talkEventsFile, touchesFromTranscript } from "./claude.ts";

const MAIN = "/home/c10/projects/vocado_nextjs";
const WT = "/home/c10/projects/worktrees";
const ws = (path: string, isMain = false): Workspace => ({
  path,
  name: path.split("/").pop()!,
  repo: MAIN,
  isMain,
  branch: null,
  head: "",
  dirty: null,
  lastCommitAt: null,
  ticketKey: null,
});
const workspaces = [ws(MAIN, true), ws(`${WT}/a`), ws(`${WT}/b`), ws(`${WT}/c`), ws(`${WT}/d`), ws(`${MAIN}/.claude/worktrees/n`)];

const at = (m: number) => `2026-09-26T06:${String(m).padStart(2, "0")}:00.000Z`;
const toolUse = (m: number, name: string, input: object, cwd = MAIN) =>
  JSON.stringify({ type: "assistant", cwd, timestamp: at(m), message: { content: [{ type: "tool_use", name, input }] } });

test("도구 호출만 세고 출력·본문·인자 문자열은 무시한다", () => {
  const lines = [
    toolUse(1, "Bash", { command: `cd ${WT}/a && npm test` }),
    JSON.stringify({ type: "user", timestamp: at(2), message: { content: [{ type: "tool_result", content: `${WT}/b/x.ts "tool_use"` }] } }),
    JSON.stringify({ type: "assistant", timestamp: at(3), message: { content: [{ type: "text", text: `see ${WT}/c/y.ts "tool_use"` }] } }),
    toolUse(4, "Bash", { command: `ls ${WT}/b && echo "cd ${WT}/c"` }),
    toolUse(5, "Read", { file_path: `${WT}/b/z.ts` }),
    toolUse(6, "Edit", { file_path: `${WT}/d/x.ts` }),
    toolUse(7, "Bash", { command: `cd ${MAIN} && git status` }),
    toolUse(8, "Bash", { command: `cd .claude/worktrees/n` }),
    "{broken json with \"tool_use\"",
  ].join("\n");
  const touches = touchesFromTranscript(lines, workspaces).map((t) => `${t.workspacePath.split("/").pop()}@${new Date(t.at).getUTCMinutes()}`);
  assert.deepEqual(touches, ["a@1", "d@6", "n@8"]);
});

test("워크트리 안의 cwd에서 한 작업은 그 워크트리 접촉", () => {
  const touches = touchesFromTranscript(toolUse(1, "Bash", { command: "npm test" }, `${WT}/c/src`), workspaces);
  assert.deepEqual(touches.map((t) => t.workspacePath), [`${WT}/c`]);
});

test("sessionEventsOf: 같은 세션 폴더를 여러 번 불러도 사건 수가 같고, leader 캐시에 crew 사건이 섞이지 않는다", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "atc-talk-")), "sess");
  mkdirSync(join(dir, "subagents"), { recursive: true });
  const use = (t: string, name: string, input: unknown, extra: object = {}) =>
    JSON.stringify({ type: "assistant", timestamp: t, message: { content: [{ type: "tool_use", name, input }] }, ...extra }) + "\n";
  writeFileSync(`${dir}.jsonl`, use("2026-09-28T01:00:00Z", "Edit", { file_path: "/w/s/a.ts" }));
  writeFileSync(join(dir, "subagents", "agent-1.jsonl"), use("2026-09-28T01:05:00Z", "Write", { file_path: "/w/s/b.ts" }, { isSidechain: true }));
  const first = sessionEventsOf(dir).map((e) => `${e.by}:${e.path}`);
  assert.deepEqual(first, ["leader:/w/s/a.ts", "crew:/w/s/b.ts"]);
  assert.deepEqual(sessionEventsOf(dir).map((e) => `${e.by}:${e.path}`), first);
  assert.deepEqual(talkEventsFile(`${dir}.jsonl`).map((e) => e.by), ["leader"]);
  // 파일이 자라면 새 줄만 더한다
  appendFileSync(`${dir}.jsonl`, use("2026-09-28T01:10:00Z", "Write", { file_path: "/w/s/c.ts" }));
  assert.deepEqual(sessionEventsOf(dir).map((e) => e.path), ["/w/s/a.ts", "/w/s/c.ts", "/w/s/b.ts"]);
});

// ATC-98: 세션 파일의 kind·jobId
test("sessionKindOf: bg는 background와 jobId, interactive와 kind 없음·모르는 값은 background가 아니다", () => {
  assert.deepEqual(sessionKindOf({ kind: "bg", jobId: "job-1234" }), { kind: "background", jobId: "job-1234" });
  assert.deepEqual(sessionKindOf({ kind: "background", jobId: "j" }), { kind: "background", jobId: "j" });
  assert.deepEqual(sessionKindOf({ kind: "bg" }), { kind: "background" }); // jobId를 못 읽어도 background
  assert.deepEqual(sessionKindOf({ kind: "bg", jobId: "" }), { kind: "background" });
  assert.deepEqual(sessionKindOf({ kind: "interactive", jobId: "ignored" }), { kind: "interactive" }); // jobId는 background에만
  assert.deepEqual(sessionKindOf({}), {});
  assert.deepEqual(sessionKindOf({ kind: "something-new" }), {});
});

// ATC-301: 기본이 아닌 폴더의 background 세션만 attachDir를 싣는다
test("attachDirField: bg가 기본이 아닌 폴더에서 읽힌 때만 그 폴더", () => {
  const def = "/home/c10/.claude";
  assert.deepEqual(attachDirField({ kind: "bg", configDir: "/home/c10/.claude-acct-1" }, def), { attachDir: "/home/c10/.claude-acct-1" });
  assert.deepEqual(attachDirField({ kind: "bg", configDir: def }, def), {});
  assert.deepEqual(attachDirField({ kind: "interactive", configDir: "/home/c10/.claude-acct-1" }, def), {});
  assert.deepEqual(attachDirField({ kind: "bg" }, def), {});
});
