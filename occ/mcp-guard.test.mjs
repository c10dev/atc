import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMcp, decide } from "./mcp-guard.mjs";

test("MCP guard: 읽기 도구만 통과, 쓰기·삭제·머지는 차단, MCP가 아닌 도구는 관여하지 않음", () => {
  for (const t of ["mcp__abc__get_issue", "mcp__abc__list_comments", "mcp__gh__search_pull_requests", "mcp__x__query", "mcp__x__read_page"]) {
    assert.equal(checkMcp(t), null, t);
  }
  for (const t of ["mcp__abc__save_issue", "mcp__abc__save_comment", "mcp__gh__merge_pull_request", "mcp__sb__execute_sql", "mcp__sb__apply_migration", "mcp__abc__delete_comment", "mcp__x__getaway"]) {
    assert.notEqual(checkMcp(t), null, t);
  }
  assert.equal(checkMcp("Bash"), null);
});

test("linear-guard: S2(approval)에서 발부된 호출과 도구·입력이 정확히 같을 때만 통과", async () => {
  const { checkLinear, sameJson } = await import("./mcp-guard.mjs");
  const released = {
    mode: "approval",
    calls: [
      { id: "S-0001", tool: "save_issue", input: { id: "VOC-195", addLabels: ["BUILD", "M", "rating:SEC"] } },
      { id: "S-0001", tool: "save_comment", input: { issueId: "VOC-195", body: "[OCC S-0001] 분류 …" } },
    ],
  };
  const ok = () => Promise.resolve(released);
  assert.equal(await checkLinear("mcp__x__save_issue", { addLabels: ["BUILD", "M", "rating:SEC"], id: "VOC-195" }, ok), null); // 키 순서는 상관없음
  assert.equal(await checkLinear("mcp__x__save_comment", { issueId: "VOC-195", body: "[OCC S-0001] 분류 …" }, ok), null);
  assert.match(await checkLinear("mcp__x__save_issue", { id: "VOC-195", addLabels: ["BUILD", "M"] }, ok), /발부된 SCHEDULE 호출과 다름/);
  assert.match(await checkLinear("mcp__x__save_issue", { id: "VOC-195", addLabels: ["BUILD", "M", "rating:SEC"], state: "Done" }, ok), /다름/);
  assert.match(await checkLinear("mcp__x__save_issue", { id: "VOC-999", addLabels: ["BUILD", "M", "rating:SEC"] }, ok), /다름/);
  assert.match(await checkLinear("mcp__x__delete_comment", {}, ok), /Linear 쓰기가 아닌/);
  assert.match(await checkLinear("mcp__x__save_issue", released.calls[0].input, () => Promise.resolve({ ...released, mode: "shadow" })), /S1\(shadow\)/);
  assert.match(await checkLinear("mcp__x__save_issue", released.calls[0].input, () => Promise.reject(new Error("ECONNREFUSED"))), /연결할 수 없어/);
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson({ a: 1, b: undefined }, { a: 1 }), true);
});

test("--read-only(CROSSCHECK): 발부된 Linear 쓰기도 막고 읽기만 통과, 입력을 못 읽으면 막음", async () => {
  const input = { issueId: "VOC-1", body: "x" };
  const fetcher = async () => ({ mode: "approval", calls: [{ id: "S-0001", tool: "save_comment", input }] });
  const write = { tool_name: "mcp__linear__save_comment", tool_input: input };
  assert.equal(await decide(write, { fetcher }), null); // OCC: 발부된 호출이면 통과
  assert.match(await decide(write, { readOnly: true, fetcher }), /읽기 전용이 아닌/);
  assert.equal(await decide({ tool_name: "mcp__linear__get_issue" }, { readOnly: true }), null);
  assert.match(await decide({ tool_name: "mcp__github__merge_pull_request" }, { readOnly: true }), /읽기 전용이 아닌/);
  assert.match(await decide({}, { readOnly: true }), /읽지 못함/);
});
