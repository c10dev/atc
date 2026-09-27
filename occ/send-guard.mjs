#!/usr/bin/env node
// OCC 세션의 PreToolUse hook (SendMessage). 어느 경우든 atc가 approval 모드(2b)여야 한다.
// DISPATCH: 메시지가 [DISPATCH D-xxxx]로 시작하고, 받는 사람이 그 제안의 CAPTAIN이며,
// - FLIGHT PLAN: 그 제안이 sent 상태이고 본문이 atc가 만든 FLIGHT PLAN과 정확히 같을 때
// - RECALL([DISPATCH D-xxxx] RECALL …): 그 제안이 recalling 상태이고 본문이 atc가 만든 RECALL 문구와 정확히 같을 때
// CREW CHANGE: 메시지가 [OCC CC-xxxx]로 시작하고, 그 CREW CHANGE가 sent 상태(`atcctl crew-change send`로 발부됨)이며,
//   받는 사람이 그 AIRCRAFT(REGISTRATION)이고 본문이 발부 때 저장된 문구와 정확히 같을 때
// 아니면(atc에 연결할 수 없을 때도) exit 2로 막는다.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = process.env.ATC_URL || "http://127.0.0.1:7700";

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(3000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
// D-xxxx → {proposal, mode}, CC-xxxx → {change, mode}. 없으면 null
const fetchRecord = (id) =>
  id.startsWith("CC-")
    ? fetchJson(`/api/fleet/crew-changes/${encodeURIComponent(id)}`)
    : fetchJson(`/api/dispatch/proposals/${encodeURIComponent(id)}`);

// SendMessage의 to는 "TEAM_B" 또는 "TEAM_B [e698d1]"
const bareName = (to) => String(to ?? "").replace(/\s*\[[0-9a-f]+\]\s*$/i, "").trim();

// CREW CHANGE([OCC CC-xxxx] …). DISPATCH와 같은 순서로 확인한다
async function checkCrewChange(toolInput, message, id, fetcher) {
  let found;
  try {
    found = await fetcher(id);
  } catch (e) {
    return `atc에 연결할 수 없어 보내지 않음(${e.message})`;
  }
  if (!found?.change) return `${id} CREW CHANGE가 atc에 없음`;
  const { change, mode } = found;
  if (mode !== "approval") return "지금은 2a(shadow) — CREW CHANGE를 보내지 않는다(SUPERVISOR가 직접 붙여 넣는다)";
  if (change.id !== id) return `${id} 조회 결과가 다른 CREW CHANGE(${change.id})임`;
  if (change.status !== "sent") return `${id}는 보낼 상태가 아님(${change.status}) — 먼저 crew-change send`;
  if (!change.registration || bareName(toolInput.to) !== change.registration) return `받는 사람이 ${id}의 AIRCRAFT(${change.registration})가 아님`;
  if (!change.message || message.trim() !== String(change.message).trim()) return "문구가 crew-change send가 돌려준 CREW CHANGE와 다름 — 그대로 보내야 함";
  return null;
}

export async function checkSend(toolInput, fetcher = fetchRecord) {
  const message = typeof toolInput?.message === "string" ? toolInput.message : null;
  if (!message) return "메시지가 문자열이 아님(구조화된 메시지는 보내지 않는다)";
  const cc = message.match(/^\[OCC (CC-\d{4,})\]/);
  if (cc) return checkCrewChange(toolInput, message, cc[1], fetcher);
  const m = message.match(/^\[DISPATCH (D-\d{4,})\]( RECALL\b)?/);
  if (!m) return "OCC는 FLIGHT PLAN([DISPATCH D-xxxx]로 시작)·RECALL과 CREW CHANGE([OCC CC-xxxx]로 시작)만 보낼 수 있음";
  let found;
  try {
    found = await fetcher(m[1]);
  } catch (e) {
    return `atc에 연결할 수 없어 보내지 않음(${e.message})`;
  }
  if (!found) return `${m[1]} 제안이 atc에 없음`;
  const { proposal, mode } = found;
  if (mode !== "approval") return "지금은 2a(shadow) — FLIGHT PLAN·RECALL을 보내지 않는다";
  const recall = Boolean(m[2]);
  if (recall && proposal.status !== "recalling") return `${proposal.id}는 RECALL 요청된 제안이 아님(${proposal.status})`;
  if (!recall && proposal.status !== "sent") return `${proposal.id}는 보낼 상태가 아님(${proposal.status}) — 먼저 dispatch release`;
  if (bareName(toolInput.to) !== proposal.aircraftName) return `받는 사람이 ${proposal.id}의 CAPTAIN(${proposal.aircraftName})이 아님`;
  const expected = recall ? proposal.recallMessage : proposal.message;
  if (!expected || message.trim() !== String(expected).trim())
    return recall ? "문구가 dispatch recall-send가 돌려준 RECALL과 다름 — 그대로 보내야 함" : "문구가 dispatch release가 돌려준 FLIGHT PLAN과 다름 — 그대로 보내야 함";
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const reason = await checkSend(input.tool_input);
  if (reason) {
    console.error(`OCC 전송 차단 — ${reason}`);
    process.exit(2);
  }
}
