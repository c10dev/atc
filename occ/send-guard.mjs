#!/usr/bin/env node
// DISPATCH 세션의 PreToolUse hook (SendMessage).
// 통과 조건: atc가 approval 모드(2b)이고, 메시지가 [DISPATCH D-xxxx]로 시작하며, 그 제안이 sent 상태이고,
// 받는 사람이 그 제안의 CAPTAIN이며, 본문이 atc가 만든 FLIGHT PLAN과 정확히 같을 때. 아니면 exit 2로 막는다.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = process.env.ATC_URL || "http://127.0.0.1:7700";

async function fetchProposal(id) {
  const res = await fetch(`${BASE}/api/dispatch/proposals/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(3000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// SendMessage의 to는 "TEAM_B" 또는 "TEAM_B [e698d1]"
const bareName = (to) => String(to ?? "").replace(/\s*\[[0-9a-f]+\]\s*$/i, "").trim();

export async function checkSend(toolInput, fetcher = fetchProposal) {
  const message = typeof toolInput?.message === "string" ? toolInput.message : null;
  if (!message) return "메시지가 문자열이 아님(구조화된 메시지는 보내지 않는다)";
  const m = message.match(/^\[DISPATCH (D-\d{4,})\]/);
  if (!m) return "DISPATCH는 FLIGHT PLAN([DISPATCH D-xxxx]로 시작)만 보낼 수 있음";
  let found;
  try {
    found = await fetcher(m[1]);
  } catch (e) {
    return `atc에 연결할 수 없어 보내지 않음(${e.message})`;
  }
  if (!found) return `${m[1]} 제안이 atc에 없음`;
  const { proposal, mode } = found;
  if (mode !== "approval") return "지금은 2a(shadow) — FLIGHT PLAN을 보내지 않는다";
  if (proposal.status !== "sent") return `${proposal.id}는 보낼 상태가 아님(${proposal.status}) — 먼저 dispatch release`;
  if (bareName(toolInput.to) !== proposal.aircraftName) return `받는 사람이 ${proposal.id}의 CAPTAIN(${proposal.aircraftName})이 아님`;
  if (message.trim() !== String(proposal.message ?? "").trim()) return "문구가 dispatch release가 돌려준 FLIGHT PLAN과 다름 — 그대로 보내야 함";
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const reason = await checkSend(input.tool_input);
  if (reason) {
    console.error(`DISPATCH 전송 차단 — ${reason}`);
    process.exit(2);
  }
}
