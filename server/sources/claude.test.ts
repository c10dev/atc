import assert from "node:assert/strict";
import { test } from "node:test";
import type { Workspace } from "../model.ts";
import { touchesFromTranscript } from "./claude.ts";

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
