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
  const claimed = [];
  const claimer = async (body) => (claimed.push(body), { id: "S-0001", call: 0 });
  assert.equal(await checkLinear("mcp__x__save_issue", { addLabels: ["BUILD", "M", "rating:SEC"], id: "VOC-195" }, ok, claimer), null); // 키 순서는 상관없음
  assert.equal(await checkLinear("mcp__x__save_comment", { issueId: "VOC-195", body: "[OCC S-0001] 분류 …" }, ok, claimer), null);
  assert.deepEqual(claimed.map((c) => c.tool), ["save_issue", "save_comment"]); // 통과 전에 atc에 한 번 쓴 것으로 기록
  assert.match(await checkLinear("mcp__x__save_issue", { id: "VOC-195", addLabels: ["BUILD", "M"] }, ok), /발부된 SCHEDULE 호출과 다름/);
  assert.match(await checkLinear("mcp__x__save_issue", { id: "VOC-195", addLabels: ["BUILD", "M", "rating:SEC"], state: "Done" }, ok), /다름/);
  assert.match(await checkLinear("mcp__x__save_issue", { id: "VOC-999", addLabels: ["BUILD", "M", "rating:SEC"] }, ok), /다름/);
  assert.match(await checkLinear("mcp__x__delete_comment", {}, ok), /Linear 쓰기가 아닌/);
  assert.match(await checkLinear("mcp__x__save_issue", released.calls[0].input, () => Promise.resolve({ ...released, mode: "shadow" })), /S1\(shadow\)/);
  assert.match(await checkLinear("mcp__x__save_issue", released.calls[0].input, () => Promise.reject(new Error("ECONNREFUSED"))), /연결할 수 없어/);
  // 한 번 쓰기: 이미 통과한 호출, atc가 기록을 거절, 기록 요청이 실패 — 모두 막는다(fail-closed)
  const usedList = () => Promise.resolve({ mode: "approval", calls: [{ ...released.calls[1], used: true }] });
  assert.match(await checkLinear("mcp__x__save_comment", released.calls[1].input, usedList, claimer), /이미 한 번 통과함/);
  assert.match(await checkLinear("mcp__x__save_issue", released.calls[0].input, ok, async () => ({ error: "S-0001의 이 호출은 이미 한 번 통과함" })), /이미 한 번 통과함/);
  assert.match(await checkLinear("mcp__x__save_issue", released.calls[0].input, ok, () => Promise.reject(new Error("timeout"))), /연결할 수 없어/);
  assert.match(await checkLinear("mcp__x__save_issue", released.calls[0].input, ok, async () => ({})), /기록하지 못함/);
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson({ a: 1, b: undefined }, { a: 1 }), true);
});

test("--read-only(CROSSCHECK): 발부된 Linear 쓰기도 막고 읽기만 통과, 입력을 못 읽으면 막음", async () => {
  const input = { issueId: "VOC-1", body: "x" };
  const fetcher = async () => ({ mode: "approval", calls: [{ id: "S-0001", tool: "save_comment", input }] });
  const write = { tool_name: "mcp__linear__save_comment", tool_input: input };
  const claimer = async () => ({ id: "S-0001", call: 0 });
  assert.equal(await decide(write, { fetcher, claimer }), null); // OCC: 발부된 호출이면 통과
  assert.match(await decide(write, { readOnly: true, fetcher }), /읽기 전용이 아닌/);
  assert.equal(await decide({ tool_name: "mcp__linear__get_issue" }, { readOnly: true }), null);
  assert.match(await decide({ tool_name: "mcp__github__merge_pull_request" }, { readOnly: true }), /읽기 전용이 아닌/);
  assert.match(await decide({}, { readOnly: true }), /읽지 못함/);
});

test("linear-guard: WAYPOINT에 넣는 NEW(ATC-8)는 발부된 호출(milestone id 포함)과 정확히 같을 때만 통과", async () => {
  const { checkLinear } = await import("./mcp-guard.mjs");
  const { callsOf } = await import("../server/schedule.ts");
  const payload = { title: "곡 검색 동작", body: "## 목표\nx", project: "Song Catalog", milestone: { id: "m-7", name: "Beta Ready" }, gap: true, similar: [] };
  const op = { id: "S-0020", at: "", kind: "NEW", flight: null, payload, reason: "r", status: "released", statusAt: "", verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null };
  const calls = callsOf(op, undefined, "Vocado");
  assert.equal(calls[0].input.milestone, "m-7");
  const released = async () => ({ mode: "approval", calls: calls.map((c) => ({ id: "S-0020", ...c })) });
  const claimer = async () => ({ id: "S-0020", call: 0 });
  assert.equal(await checkLinear("mcp__linear__save_issue", { ...calls[0].input }, released, claimer), null);
  const { milestone: _m, ...without } = calls[0].input;
  assert.match(await checkLinear("mcp__linear__save_issue", without, released, claimer), /다름/); // milestone을 빼면 막는다
  assert.match(await checkLinear("mcp__linear__save_issue", { ...calls[0].input, milestone: "Beta Ready" }, released, claimer), /다름/); // id 대신 이름도 막는다
  assert.match(await checkLinear("mcp__linear__save_issue", { ...calls[0].input, milestone: "m-8" }, released, claimer), /다름/);
});

test("linear-guard: SCHEDULE WAYPOINT(ATC-77)는 발부된 {id, milestone} 그대로일 때만 통과 — 상태·담당·다른 FLIGHT를 얹으면 막는다", async () => {
  const { checkLinear } = await import("./mcp-guard.mjs");
  const { callsOf } = await import("../server/schedule.ts");
  const payload = { route: "Song Catalog", milestone: { id: "m-7", name: "Beta Ready" } };
  const op = { id: "S-0031", at: "", kind: "WAYPOINT", flight: "VOC-201", payload, reason: "r", status: "released", statusAt: "", verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null };
  const calls = callsOf(op, undefined, "Vocado");
  assert.deepEqual(calls[0].input, { id: "VOC-201", milestone: "m-7" });
  const released = async () => ({ mode: "approval", calls: calls.map((c) => ({ id: "S-0031", ...c })) });
  const claimer = async () => ({ id: "S-0031", call: 0 });
  assert.equal(await checkLinear("mcp__linear__save_issue", { milestone: "m-7", id: "VOC-201" }, released, claimer), null);
  assert.match(await checkLinear("mcp__linear__save_issue", { id: "VOC-201", milestone: "Beta Ready" }, released, claimer), /다름/);
  assert.match(await checkLinear("mcp__linear__save_issue", { id: "VOC-202", milestone: "m-7" }, released, claimer), /다름/);
  assert.match(await checkLinear("mcp__linear__save_issue", { id: "VOC-201", milestone: "m-7", state: "Done" }, released, claimer), /다름/);
  assert.match(await checkLinear("mcp__linear__save_issue", { id: "VOC-201", milestone: "m-7", assignee: "me" }, released, claimer), /다름/);
});
