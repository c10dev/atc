#!/usr/bin/env node
// OCC 세션의 PreToolUse hook (MCP 도구 전부). docs/occ.md 6장.
// - 읽기 도구(get_·list_·search_·read·query·fetch로 시작)는 통과.
// - Linear 쓰기(save_issue, save_comment)는 linear-guard: SCHEDULE이 approval 모드(S2)이고, 입력이 atc가
//   발부(release)한 호출과 정확히 같고, 그 호출이 아직 한 번도 통과하지 않았을 때만 통과. 통과시키기 전에 atc에
//   한 번 쓴 것으로 기록하고(claim), 기록하지 못하면 막는다. 그 밖의 쓰기는 모두 막는다(exit 2, fail-closed).
// - `--read-only`로 부르면(CROSSCHECK) linear-guard 없이 읽기 도구만 통과. Linear 쓰기는 발부된 것도 막는다.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = process.env.ATC_URL || "http://127.0.0.1:7700";
const READ = /^(get|list|search|read|query|fetch)(_|$)/;
export const LINEAR_WRITES = new Set(["save_issue", "save_comment"]);

const nameOf = (toolName) => (typeof toolName === "string" ? (toolName.split("__").pop() ?? "") : "");

// S0·S1 규칙(동기): 읽기만 통과. Linear 쓰기는 checkLinear가 따로 판정한다.
export function checkMcp(toolName) {
  if (typeof toolName !== "string" || !toolName.startsWith("mcp__")) return null;
  const name = nameOf(toolName);
  return READ.test(name) ? null : `읽기 전용이 아닌 MCP 도구: ${name}`;
}

// 키 순서와 상관없이 같은 값인가(JSON 값만 다룬다)
export function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined).sort();
    const kb = Object.keys(b).filter((k) => b[k] !== undefined).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson(a[k], b[k]));
  }
  return false;
}

async function fetchReleased() {
  const res = await fetch(`${BASE}/api/schedule/released`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function claimReleased(body) {
  const res = await fetch(`${BASE}/api/schedule/released/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: typeof json.error === "string" ? json.error : `HTTP ${res.status}` };
  return json;
}

// linear-guard: 발부된 호출과 도구·입력이 모두 같고 아직 쓰지 않았으며 atc가 한 번 쓴 것으로 기록하면 null, 아니면 막는 이유
export async function checkLinear(toolName, toolInput, fetcher = fetchReleased, claimer = claimReleased) {
  const tool = nameOf(toolName);
  if (!LINEAR_WRITES.has(tool)) return `Linear 쓰기가 아닌 MCP 도구: ${tool}`;
  let released;
  try {
    released = await fetcher();
  } catch (e) {
    return `atc에 연결할 수 없어 쓰지 않음(${e.message})`;
  }
  if (released?.mode !== "approval") return "SCHEDULE이 S1(shadow) — Linear에 쓰지 않는다";
  const matches = (released.calls ?? []).filter((c) => c.tool === tool && sameJson(c.input, toolInput ?? {}));
  if (!matches.length) return "입력이 발부된 SCHEDULE 호출과 다름 — `atcctl schedule release`가 준 입력을 그대로 써야 함";
  if (matches.every((c) => c.used === true)) return `${matches[0].id}의 이 호출은 이미 한 번 통과함 — 같은 쓰기를 두 번 하지 않는다. Linear에 반영이 안 됐으면 SUPERVISOR에게 보고`;
  // 한 번 쓰기: atc가 기록해야 통과한다(동시에 두 번 불러도 한쪽만 기록된다)
  let claim;
  try {
    claim = await claimer({ tool, input: toolInput ?? {} });
  } catch (e) {
    return `atc에 연결할 수 없어 쓰지 않음(${e.message})`;
  }
  if (!claim || typeof claim.id !== "string") return claim?.error ?? "atc가 이 호출을 기록하지 못함";
  return null;
}

// hook 한 번의 판정. 입력을 읽지 못하면(도구 이름 없음) 막는다 — fail-closed
export async function decide(input, { readOnly = false, fetcher, claimer } = {}) {
  if (typeof input?.tool_name !== "string") return "hook 입력을 읽지 못함";
  if (!readOnly && input.tool_name.startsWith("mcp__") && LINEAR_WRITES.has(nameOf(input.tool_name))) return checkLinear(input.tool_name, input.tool_input, fetcher, claimer);
  return checkMcp(input.tool_name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const readOnly = process.argv.includes("--read-only");
  const reason = await decide(input, { readOnly });
  if (reason) {
    const who = readOnly ? "CROSSCHECK" : "OCC";
    console.error(`${who} MCP 차단 — ${reason}. Linear·GitHub에 따로 써야 하면 SUPERVISOR에게 보고하세요.`);
    process.exit(2);
  }
}
