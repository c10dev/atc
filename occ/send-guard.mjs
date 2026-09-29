#!/usr/bin/env node
// OCC 세션의 PreToolUse hook (SendMessage). 어느 경우든 atc가 approval 모드(2b)여야 한다.
// DISPATCH: 메시지가 [DISPATCH D-xxxx]로 시작하고, 받는 사람이 그 제안의 CAPTAIN이며,
// - FLIGHT PLAN: 그 제안이 sent 상태이고 본문이 atc가 만든 FLIGHT PLAN과 정확히 같을 때
// - RECALL([DISPATCH D-xxxx] RECALL …): 그 제안이 recalling 상태이고 본문이 atc가 만든 RECALL 문구와 정확히 같을 때
// CREW CHANGE: 메시지가 [OCC CC-xxxx]로 시작하고, 그 CREW CHANGE가 sent 상태(`atcctl crew-change send`로 발부됨)이며,
//   받는 사람이 그 AIRCRAFT(REGISTRATION)이고 본문이 발부 때 저장된 문구와 정확히 같을 때
// 아니면(atc에 연결할 수 없을 때도) exit 2로 막는다.
// ID로 보내기(ATC-119): 본문이 머리만이면([DISPATCH D-xxxx], [DISPATCH D-xxxx] RECALL, [OCC CC-xxxx]. 뒤에 공백만 허용)
// 위의 확인을 모두 그대로 하고, 통과하면 hook이 저장된 문구로 메시지를 바꿔 넣는다(PreToolUse의 updatedInput).
// 그러니 OCC는 문구를 다시 치지 않는다. 전체 문구를 그대로 보내는 길도 그대로 열려 있다(정확히 같을 때만)
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
// 머리만 있는 본문(뒤에 공백만): 머리 문자열을 돌려준다. 아니면 null
const HEADER_ONLY = /^(\[DISPATCH D-\d{4,}\](?: RECALL)?|\[OCC CC-\d{4,}\])\s*$/;
const headerOnlyOf = (message) => HEADER_ONLY.exec(message)?.[1] ?? null;

// 저장된 문구가 머리 다음에 오는지(머리만 보낼 때 그 문구로 바꿔 넣어도 되는지). 아니면 사유
function storedForHeader(header, stored) {
  const text = String(stored ?? "").trim();
  if (!text.startsWith(header)) return "저장된 문구가 이 머리로 시작하지 않아 바꿔 넣지 않음";
  return text;
}

// { reason } | { message }. message는 실제로 보낼 문구: 머리만 보냈으면 저장된 문구, 전체 문구면 보낸 그대로
async function resolveCrewChange(toolInput, message, id, fetcher) {
  let found;
  try {
    found = await fetcher(id);
  } catch (e) {
    return { reason: `atc에 연결할 수 없어 보내지 않음(${e.message})` };
  }
  if (!found?.change) return { reason: `${id} CREW CHANGE가 atc에 없음` };
  const { change, mode } = found;
  if (mode !== "approval") return { reason: "지금은 2a(shadow) — CREW CHANGE를 보내지 않는다(SUPERVISOR가 직접 붙여 넣는다)" };
  if (change.id !== id) return { reason: `${id} 조회 결과가 다른 CREW CHANGE(${change.id})임` };
  if (change.status !== "sent") return { reason: `${id}는 보낼 상태가 아님(${change.status}) — 먼저 crew-change send` };
  if (!change.registration || bareName(toolInput.to) !== change.registration) return { reason: `받는 사람이 ${id}의 AIRCRAFT(${change.registration})가 아님` };
  if (!change.message) return { reason: "문구가 crew-change send가 돌려준 CREW CHANGE와 다름 — 그대로 보내야 함" };
  const header = headerOnlyOf(message);
  if (header) {
    const stored = storedForHeader(header, change.message);
    return stored.startsWith(header) ? { message: stored } : { reason: stored };
  }
  if (message.trim() !== String(change.message).trim()) return { reason: "문구가 crew-change send가 돌려준 CREW CHANGE와 다름 — 그대로 보내야 함" };
  return { message };
}

export async function resolveSend(toolInput, fetcher = fetchRecord) {
  const message = typeof toolInput?.message === "string" ? toolInput.message : null;
  if (!message) return { reason: "메시지가 문자열이 아님(구조화된 메시지는 보내지 않는다)" };
  const cc = message.match(/^\[OCC (CC-\d{4,})\]/);
  if (cc) return resolveCrewChange(toolInput, message, cc[1], fetcher);
  const m = message.match(/^\[DISPATCH (D-\d{4,})\]( RECALL\b)?/);
  if (!m) return { reason: "OCC는 FLIGHT PLAN([DISPATCH D-xxxx]로 시작)·RECALL과 CREW CHANGE([OCC CC-xxxx]로 시작)만 보낼 수 있음" };
  let found;
  try {
    found = await fetcher(m[1]);
  } catch (e) {
    return { reason: `atc에 연결할 수 없어 보내지 않음(${e.message})` };
  }
  if (!found) return { reason: `${m[1]} 제안이 atc에 없음` };
  const { proposal, mode } = found;
  if (mode !== "approval") return { reason: "지금은 2a(shadow) — FLIGHT PLAN·RECALL을 보내지 않는다" };
  const recall = Boolean(m[2]);
  if (recall && proposal.status !== "recalling") return { reason: `${proposal.id}는 RECALL 요청된 제안이 아님(${proposal.status})` };
  if (!recall && proposal.status !== "sent") return { reason: `${proposal.id}는 보낼 상태가 아님(${proposal.status}) — 먼저 dispatch release` };
  if (bareName(toolInput.to) !== proposal.aircraftName) return { reason: `받는 사람이 ${proposal.id}의 CAPTAIN(${proposal.aircraftName})이 아님` };
  const expected = recall ? proposal.recallMessage : proposal.message;
  const wrong = recall ? "문구가 dispatch recall-send가 돌려준 RECALL과 다름 — 그대로 보내야 함" : "문구가 dispatch release가 돌려준 FLIGHT PLAN과 다름 — 그대로 보내야 함";
  if (!expected) return { reason: wrong };
  const header = headerOnlyOf(message);
  if (header) {
    const stored = storedForHeader(header, expected);
    return stored.startsWith(header) ? { message: stored } : { reason: stored };
  }
  if (message.trim() !== String(expected).trim()) return { reason: wrong };
  return { message };
}

// 막는 사유(없으면 null). 머리만 보낸 경우도 통과하면 null이다: 바꿔 넣을 문구는 resolveSend가 준다
export async function checkSend(toolInput, fetcher = fetchRecord) {
  return (await resolveSend(toolInput, fetcher)).reason ?? null;
}

// hook이 stdout에 내는 JSON. 머리만 보냈으면 저장된 문구로 바꿔 넣고(allow + updatedInput), 전체 문구면 아무것도 내지 않는다
export function hookOutputOf(toolInput, message) {
  if (message === toolInput.message) return null;
  const updated = { ...toolInput, message };
  if (typeof toolInput.content === "string") updated.content = message; // 하네스가 붙이는 사본
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "send-guard: 머리를 atc에 저장된 문구로 바꿔 넣음",
      updatedInput: updated,
      // 보낸 세션의 대화 기록에 실제로 나간 문구가 남는다(도구 결과는 머리만 되풀이한다)
      additionalContext: `send-guard가 머리를 저장된 문구로 바꿔 보냈다. 실제로 나간 문구:\n${message}`,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const r = await resolveSend(input.tool_input);
  if (r.reason) {
    console.error(`OCC 전송 차단 — ${r.reason}`);
    process.exit(2);
  }
  const out = hookOutputOf(input.tool_input, r.message);
  if (out) process.stdout.write(JSON.stringify(out));
}
