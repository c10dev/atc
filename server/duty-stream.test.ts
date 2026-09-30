import assert from "node:assert/strict";
import { test } from "node:test";
import { createDutyParser, type DutyEvent, toolSummaryOf } from "./duty-stream.ts";

const feedAll = (lines: unknown[]): { events: DutyEvent[]; bad: number } => {
  const p = createDutyParser();
  const events = lines.flatMap((l) => p.feed(typeof l === "string" ? l : JSON.stringify(l)));
  return { events, bad: p.malformed() };
};

// D0에서 잰 줄의 모양(docs/duty.md "D0 as probed")
const INIT = { type: "system", subtype: "init", session_id: "s1", model: "claude-sonnet-5-5", tools: ["Bash"] };
const DELTA = (t: string) => ({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } });
const ASSISTANT = (content: unknown[]) => ({ type: "assistant", message: { role: "assistant", content, stop_reason: null, usage: {} } });
const RESULT = { type: "result", subtype: "success", is_error: false, result: "ONE", total_cost_usd: 0.035, num_turns: 1, duration_ms: 2204, usage: { input_tokens: 3, cache_read_input_tokens: 10000, cache_creation_input_tokens: 500, output_tokens: 12 } };

test("한 턴: init, 조각, 완성된 글, 결과 → text·usage·state idle. 턴의 끝은 result", () => {
  const { events } = feedAll([INIT, DELTA("O"), DELTA("NE"), ASSISTANT([{ type: "text", text: "ONE" }]), RESULT]);
  assert.deepEqual(events[0], { type: "init", sessionId: "s1", model: "claude-sonnet-5-5" });
  assert.deepEqual(events.slice(1, 4), [
    { type: "text", text: "O", final: false },
    { type: "text", text: "NE", final: false },
    { type: "text", text: "ONE", final: true },
  ]);
  const usage = events.find((e) => e.type === "usage")!;
  assert.equal(usage.type === "usage" && usage.turn?.context, 10503);
  assert.equal(usage.type === "usage" && usage.turn?.costUsd, 0.035);
  assert.deepEqual(events.at(-1), { type: "state", state: "idle" });
  // assistant 줄만으로는 턴이 끝난 것이 아니다
  assert.ok(!feedAll([ASSISTANT([{ type: "text", text: "x" }])]).events.some((e) => e.type === "state"));
});

test("도구: 이름과 한 줄 요약만(입력 전체·출력은 싣지 않는다). guard가 거절한 오류 결과는 그 도구 이름의 오류 줄", () => {
  const { events } = feedAll([
    ASSISTANT([{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "node ../controller/atcctl.mjs duty brief\nsecond line", description: "secret-ish" } }]),
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: "PreToolUse:Bash hook error: [\"/usr/bin/node\" \"$CLAUDE_PROJECT_DIR/guard.mjs\" || exit 2]: blocked by duty guard" }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", is_error: false, content: "OUTPUT NOT SHOWN" }] } },
  ]);
  assert.deepEqual(events, [
    { type: "tool", id: "toolu_1", name: "Bash", summary: "node ../controller/atcctl.mjs duty brief", error: false },
    { type: "tool", id: "toolu_1", name: "Bash", summary: "blocked by duty guard", error: true },
  ]);
  assert.ok(!JSON.stringify(events).includes("secret-ish"));
  assert.ok(!JSON.stringify(events).includes("OUTPUT NOT SHOWN"));
});

test("toolSummaryOf: 모르는 도구·이상한 입력은 빈 요약, 긴 명령은 자른다", () => {
  assert.equal(toolSummaryOf("Edit", { file_path: "/x" }), "");
  assert.equal(toolSummaryOf("Bash", null), "");
  assert.equal(toolSummaryOf("Bash", { command: "a".repeat(300) }).length, 80);
  assert.equal(toolSummaryOf("Read", { file_path: "/repo/a.ts" }), "/repo/a.ts");
});

test("rate_limit_event → 5시간·7일 창. 창이 없으면 이벤트 없음", () => {
  const { events } = feedAll([
    { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: 1 }, seven_day: { utilization: 0.82, resetsAt: 2 } } } },
    { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
  ]);
  assert.deepEqual(events, [{ type: "usage", turn: null, rates: [{ window: "five_hour", utilization: 0.3, resetsAt: 1 }, { window: "seven_day", utilization: 0.82, resetsAt: 2 }] }]);
});

test("중단(interrupt): error_during_execution 결과는 알림 없이 idle. 그 밖의 오류 종료는 notice + idle", () => {
  const interrupted = feedAll([{ type: "result", subtype: "error_during_execution", is_error: true, usage: {} }]).events;
  assert.ok(!interrupted.some((e) => e.type === "notice"));
  assert.deepEqual(interrupted.at(-1), { type: "state", state: "idle" });
  const limit = feedAll([{ type: "result", subtype: "success", is_error: true, result: "You've hit your limit", usage: {} }]).events;
  assert.deepEqual(limit.find((e) => e.type === "notice"), { type: "notice", text: "You've hit your limit" });
  assert.deepEqual(limit.at(-1), { type: "state", state: "idle" });
});

test("재생된 사용자 줄, 훅 이벤트, control_response, thinking, 모르는 줄은 무시하고, 깨진 줄은 세기만 한다", () => {
  const { events, bad } = feedAll([
    { type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] }, isReplay: true },
    { type: "system", subtype: "hook_started", hook_name: "PreToolUse" },
    { type: "system", subtype: "hook_response", output: "x" },
    { type: "system", subtype: "status", status: "requesting" },
    { type: "control_response", response: { subtype: "success" } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "" } } },
    ASSISTANT([{ type: "thinking", thinking: "", signature: "s" }]),
    { type: "brand-new-type", x: 1 },
    "",
    "{not json",
    "[1,2]",
    '{"no":"type"}',
  ]);
  assert.deepEqual(events, []);
  assert.equal(bad, 3);
});
