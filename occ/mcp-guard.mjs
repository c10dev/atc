#!/usr/bin/env node
// OCC 세션의 PreToolUse hook (MCP 도구 전부). S0에서 OCC는 Linear·GitHub 등 외부 서비스를 읽기만 한다:
// 도구 이름이 get_·list_·search_·read·query·fetch로 시작하는 것만 통과시키고 나머지는 exit 2로 막는다.
// S2에서 Linear 쓰기는 linear-guard(승인된 SCHEDULE 작업과 정확히 같은 내용만)로 따로 연다 — docs/occ.md 6장.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const READ = /^(get|list|search|read|query|fetch)(_|$)/;

export function checkMcp(toolName) {
  if (typeof toolName !== "string" || !toolName.startsWith("mcp__")) return null;
  const name = toolName.split("__").pop() ?? "";
  return READ.test(name) ? null : `읽기 전용이 아닌 MCP 도구: ${name}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const reason = checkMcp(input.tool_name);
  if (reason) {
    console.error(`OCC는 S0에서 외부 서비스를 읽기만 합니다 — ${reason}. Linear·GitHub에 써야 하면 SUPERVISOR에게 보고하세요.`);
    process.exit(2);
  }
}
