import assert from "node:assert/strict";
import { test } from "node:test";
import { activityFromTrack, activityLabel, activityOf, activityText, activityTrackOf, agoText, cleanText } from "./activity.ts";
import { liveViewOf } from "./fleet-live.ts";
import { fleetRows } from "./fleet-status.ts";
import type { AircraftView } from "./fleet.ts";
import type { Snapshot } from "./model.ts";
import { sampleOf } from "./recorder.ts";
import { DEFAULT_TEAM_PATTERN } from "./registration.ts";

// ACTIVITY(ATC-97). 줄 모양은 실제 대화 기록(2026-09-29)에서 따왔다: 블록 하나마다 assistant 줄 하나(같은 message.id),
// 도구 결과 user 줄에는 toolUseResult(원문)가 붙는다. 본문·경로·id는 지웠다
const T = (hms: string) => `2026-09-29T${hms}Z`;
const base = { cwd: "/x", sessionId: "s1", version: "2.1.290", gitBranch: "main", isSidechain: false, userType: "external", entrypoint: "cli", slug: "x" };
const prompt = (hms: string, text = "go") =>
  JSON.stringify({ ...base, type: "user", timestamp: T(hms), origin: { kind: "human" }, turnOrigin: {}, promptId: "p1", permissionMode: "auto", message: { role: "user", content: text } });
const thinking = (hms: string) =>
  JSON.stringify({ ...base, type: "assistant", timestamp: T(hms), requestId: "req_1", message: { id: "msg_1", model: "claude-opus-5-5", role: "assistant", content: [{ type: "thinking", thinking: "secret plan", signature: "sig" }] } });
const text = (hms: string, body = "assistant says hi") =>
  JSON.stringify({ ...base, type: "assistant", timestamp: T(hms), requestId: "req_1", message: { id: "msg_1", model: "claude-opus-5-5", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: body }] } });
const use = (hms: string, id: string, name: string, input: Record<string, unknown>, sidechain = false) =>
  JSON.stringify({
    ...base,
    isSidechain: sidechain,
    type: "assistant",
    timestamp: T(hms),
    requestId: "req_1",
    wireToolInputs: { [id]: input },
    message: { id: "msg_1", model: "claude-opus-5-5", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input, caller: { type: "direct" } }] },
  });
const result = (hms: string, id: string, out = "ok") =>
  JSON.stringify({
    ...base,
    type: "user",
    timestamp: T(hms),
    promptId: "p1",
    sourceToolAssistantUUID: "u1",
    toolUseResult: { stdout: out, stderr: "", interrupted: false },
    message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content: out, is_error: false }] },
  });
const noise = (hms: string) => [
  JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: T(hms), content: "queued prompt text" }),
  JSON.stringify({ ...base, type: "attachment", timestamp: T(hms), attachment: { type: "hook_success", content: "hook output" } }),
  JSON.stringify({ ...base, type: "system", subtype: "stop_hook_summary", timestamp: T(hms), level: "info" }),
  JSON.stringify({ type: "last-prompt", lastPrompt: "go", sessionId: "s1" }),
  JSON.stringify({ type: "custom-title", customTitle: "TEAM_H", sessionId: "s1" }),
];
const tail = (...lines: (string | string[])[]) => lines.flat().join("\n") + "\n";

test("Bash: description이 라벨, 결과가 없으면 tool phase", () => {
  const a = activityOf(tail(prompt("10:00:00"), thinking("10:00:02"), use("10:00:05", "toolu_1", "Bash", { command: "npm test", description: "Run the test suite" })));
  assert.deepEqual(a, { tool: "Bash", label: "Run the test suite", at: T("10:00:05.000"), phase: "tool" });
  assert.equal(activityText(a!, Date.parse(T("10:00:17"))), "Bash · Run the test suite · 12s");
});

test("Edit·Read·Write: 파일 이름만", () => {
  assert.equal(activityOf(tail(use("10:00:00", "t1", "Edit", { file_path: "/home/u/repo/server/activity.ts", old_string: "a", new_string: "b" })))!.label, "activity.ts");
  assert.equal(activityLabel("Read", { file_path: "/a/b/README.md" }), "README.md");
  assert.equal(activityLabel("Write", { file_path: "/a/b/new.txt", content: "file body" }), "new.txt");
});

test("MCP 도구: `<server> <tool>`", () => {
  const a = activityOf(tail(use("10:00:00", "t1", "mcp__claude_ai_Linear__save_issue", { title: "t", description: "issue body" })));
  assert.equal(a!.tool, "mcp__claude_ai_Linear__save_issue");
  assert.equal(a!.label, "claude_ai_Linear save_issue");
  assert.equal(activityLabel("mcp__playwright__browser_click", {}), "playwright browser_click");
  assert.equal(activityText(a!, Date.parse(T("10:00:03"))), "MCP · claude_ai_Linear save_issue · 3s");
});

test("Agent·Task·Skill·SendMessage, 그 밖에는 라벨 없음", () => {
  assert.equal(activityOf(tail(use("10:00:00", "t1", "Agent", { description: "Survey fleet files", prompt: "long secret prompt", subagent_type: "Explore" })))!.label, "Survey fleet files");
  assert.equal(activityLabel("Task", { description: "Find callers", prompt: "p" }), "Find callers");
  assert.equal(activityLabel("Skill", { skill: "atc-task", args: "ATC-97" }), "atc-task");
  assert.equal(activityLabel("SendMessage", { to: "team-lead", message: "report body" }), "team-lead");
  assert.equal(activityLabel("Grep", { pattern: "secret" }), null);
  assert.equal(activityLabel("Bash", { command: "rm -rf /tmp/x" }), null); // description이 없으면 command를 쓰지 않는다
});

test("도구가 끝나고 모델을 기다리면 model, at은 결과 시각", () => {
  const t = tail(prompt("10:00:00"), use("10:00:05", "t1", "Bash", { command: "ls", description: "List files" }), result("10:00:09", "t1"), noise("10:00:10"), thinking("10:00:12"));
  assert.deepEqual(activityOf(t), { tool: "Bash", label: "List files", at: T("10:00:09.000"), phase: "model" });
  assert.equal(activityText(activityOf(t)!, Date.parse(T("10:00:39"))), "model · Bash · List files · 30s");
});

test("idle: 세션 상태가 idle이면 idle, at은 마지막 기록", () => {
  const t = tail(prompt("10:00:00"), use("10:00:05", "t1", "Read", { file_path: "/x/a.ts" }), result("10:00:06", "t1"), text("10:00:20"), noise("10:00:21"));
  const a = activityOf(t, "idle")!;
  assert.deepEqual(a, { tool: "Read", label: "a.ts", at: T("10:00:20.000"), phase: "idle" });
  assert.equal(activityText(a, Date.parse(T("10:03:20"))), "idle · Read · a.ts · 3m");
  assert.equal(activityOf(t, "dead"), null);
});

test("병렬 도구: 결과가 아직 없는 마지막 도구를 보인다", () => {
  const t = tail(use("10:00:00", "t1", "Read", { file_path: "/x/a.ts" }), use("10:00:00", "t2", "Bash", { command: "sleep 9", description: "Wait" }), result("10:00:01", "t1"));
  assert.deepEqual(activityOf(t), { tool: "Bash", label: "Wait", at: T("10:00:00.000"), phase: "tool" });
});

test("새 지시 뒤 도구가 없으면 tool null(thinking), 결과 없이 끝난 앞 도구는 지운다", () => {
  const t = tail(use("10:00:00", "t1", "Bash", { command: "x", description: "Interrupted run" }), prompt("10:01:00", "[Request interrupted by user]"), prompt("10:01:05"), thinking("10:01:06"));
  const a = activityOf(t)!;
  assert.deepEqual(a, { tool: null, label: null, at: T("10:01:05.000"), phase: "model" });
  assert.equal(activityText(a, Date.parse(T("10:01:10"))), "thinking · 5s");
});

test("서브에이전트 줄(isSidechain)과 메타 줄은 보지 않는다", () => {
  const meta = JSON.stringify({ ...base, type: "user", isMeta: true, timestamp: T("10:00:09"), message: { role: "user", content: "skill body" } });
  const t = tail(use("10:00:00", "t1", "Agent", { description: "Look around", prompt: "p" }), use("10:00:05", "s1", "Bash", { command: "x", description: "sub" }, true), meta);
  assert.deepEqual(activityOf(t), { tool: "Agent", label: "Look around", at: T("10:00:00.000"), phase: "tool" });
});

test("빈 끝, 기록 없는 끝, 줄 중간에서 잘린 끝", () => {
  assert.equal(activityOf(""), null);
  assert.equal(activityOf(tail(noise("10:00:00"))), null);
  const full = tail(prompt("10:00:00"), use("10:00:05", "t1", "Bash", { command: "npm test", description: "Run tests" }), result("10:00:30", "t1", "all passed"));
  // 끝이 줄 중간에서 잘렸다(쓰는 중): 잘린 결과 줄은 버리고 앞의 도구 호출을 본다
  const cut = full.slice(0, full.length - 40);
  assert.deepEqual(activityOf(cut), { tool: "Bash", label: "Run tests", at: T("10:00:05.000"), phase: "tool" });
  // 앞이 줄 중간에서 잘렸다
  assert.equal(activityOf(full.slice(30))!.phase, "model");
});

test("라벨: 제어 문자·방향 문자를 빼고 60자로 자른다", () => {
  assert.equal(cleanText("Run\u0007 the\n\ttests\u202e now\u0000"), "Run the tests now");
  const long = "x".repeat(200);
  const l = activityLabel("Bash", { description: long })!;
  assert.equal(l.length, 60);
  assert.ok(l.endsWith("…"));
  assert.equal(activityLabel("Edit", { file_path: "/x/evil\u001b[31mname.ts" }), "evil [31mname.ts");
  assert.equal(activityLabel("Bash", { description: "   " }), null);
  assert.equal(activityOf(tail(use("10:00:00", "t1", "Weird\u0007Tool\nName", {})))!.tool, "Weird Tool Name");
});

test("본문은 없다: Bash command, 도구 결과, 프롬프트, assistant 글, thinking이 나오지 않는다", () => {
  const SECRET_CMD = "curl -H 'Authorization: Bearer sk-SECRET-123' https://x";
  const SECRET_OUT = "RESULT-BODY-TOKEN-999";
  const t = tail(
    prompt("10:00:00", "PROMPT-BODY-777"),
    thinking("10:00:01"),
    text("10:00:02", "ASSISTANT-BODY-555"),
    use("10:00:03", "t1", "Bash", { command: SECRET_CMD, description: "Fetch status" }),
    result("10:00:04", "t1", SECRET_OUT),
    use("10:00:05", "t2", "Write", { file_path: "/x/out.txt", content: "FILE-BODY-333" }),
    use("10:00:06", "t3", "Agent", { description: "Check", prompt: "AGENT-PROMPT-444" }),
    use("10:00:07", "t4", "SendMessage", { to: "lead", message: "MESSAGE-BODY-222" }),
  );
  for (const status of ["busy", "idle"] as const) {
    for (let i = 0; i < t.length; i += 97) {
      const out = JSON.stringify([activityOf(t.slice(i), status), activityTrackOf(t.slice(i))]);
      for (const secret of ["sk-SECRET", "curl", SECRET_OUT, "PROMPT-BODY", "ASSISTANT-BODY", "FILE-BODY", "AGENT-PROMPT", "MESSAGE-BODY", "secret plan"]) {
        assert.ok(!out.includes(secret), `${secret} leaked at ${i}: ${out}`);
      }
    }
  }
});

test("activityFromTrack: 캐시한 추적 값에 상태만 얹는다", () => {
  const track = activityTrackOf(tail(use("10:00:00", "t1", "Bash", { command: "x", description: "d" })))!;
  assert.equal(activityFromTrack(track, "busy")!.phase, "tool");
  assert.equal(activityFromTrack(track, "idle")!.phase, "idle");
  assert.equal(activityFromTrack(null, "busy"), null);
});

test("agoText", () => {
  assert.equal(agoText(-5), "0s");
  assert.equal(agoText(59_999), "59s");
  assert.equal(agoText(4 * 60_000 + 10), "4m");
  assert.equal(agoText(125 * 60_000), "2h05m");
  assert.equal(agoText(120 * 60_000), "2h");
});

// 스냅샷 → FLEET 줄은 도구·라벨·시각·phase만 싣고, FLIGHT RECORDER sample에는 ACTIVITY가 들어가지 않는다
test("FLEET 줄에 activity가 실리고, sample 줄에는 없다", () => {
  const activity = { tool: "Bash", label: "Run tests", at: T("10:00:00.000"), phase: "tool" as const };
  const session = { id: "s1", agent: "claude" as const, name: "TEAM_A", status: "busy" as const, pid: 1, cwd: "/w", startedAt: T("09:00:00"), lastActiveAt: T("10:00:00"), repo: null, workspacePath: null, activity };
  const live = liveViewOf({ sessions: [session], claims: [], workspaces: [] }, ["TEAM_A"], DEFAULT_TEAM_PATTERN, () => null, Date.parse(T("10:00:10")));
  assert.deepEqual(live.get("TEAM_A")!.activity, activity);
  const view = { registration: "TEAM_A", callsign: "A", actuals: { week: 0, weekOnTime: null }, ...live.get("TEAM_A")! } as unknown as AircraftView;
  assert.deepEqual(fleetRows([view], Date.parse(T("10:00:10")))[0]!.activity, activity);
  const snapshot = { sessions: [session], claims: [], alerts: [], pulls: [], clearances: [] } as unknown as Snapshot;
  assert.ok(!JSON.stringify(sampleOf(snapshot)).includes("Run tests"));
  assert.deepEqual(Object.keys(sampleOf(snapshot)).sort(), ["airborne", "alerts", "claims", "conflicts", "holding", "landing", "pendingClearances"]);
});
