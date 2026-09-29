#!/usr/bin/env node
// MCC 세션의 PreToolUse hook (Agent·Task, ATC-135). MCC는 하위 에이전트로 INSPECTOR(mcc/.claude/agents/inspector.md) 하나만 부른다.
// 다른 하위 에이전트, 이름 없는 호출은 막는다. 막으면 exit 2, 입력을 못 읽어도 막는다(fail-closed).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// 막을 이유, 통과면 null
export function checkAgent(toolName, input) {
  if (toolName !== "Agent" && toolName !== "Task") return "Agent·Task 도구가 아님";
  if (input?.subagent_type !== "inspector") return `하위 에이전트는 inspector만 부른다: ${input?.subagent_type ?? "(이름 없음)"}`;
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const reason = checkAgent(input.tool_name, input.tool_input);
  if (reason) {
    console.error(`MCC 하위 에이전트 차단 — ${reason}. INSPECTION에는 inspector만 부릅니다.`);
    process.exit(2);
  }
}
