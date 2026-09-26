import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMcp } from "./mcp-guard.mjs";

test("MCP guard: 읽기 도구만 통과, 쓰기·삭제·머지는 차단, MCP가 아닌 도구는 관여하지 않음", () => {
  for (const t of ["mcp__abc__get_issue", "mcp__abc__list_comments", "mcp__gh__search_pull_requests", "mcp__x__query", "mcp__x__read_page"]) {
    assert.equal(checkMcp(t), null, t);
  }
  for (const t of ["mcp__abc__save_issue", "mcp__abc__save_comment", "mcp__gh__merge_pull_request", "mcp__sb__execute_sql", "mcp__sb__apply_migration", "mcp__abc__delete_comment", "mcp__x__getaway"]) {
    assert.notEqual(checkMcp(t), null, t);
  }
  assert.equal(checkMcp("Bash"), null);
});
