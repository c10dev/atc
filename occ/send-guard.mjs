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
// work-order 해시(ATC-555): 저장된 FLIGHT PLAN의 머리에 해시(@xxxxxx)가 있으면 그 글에서 다시 계산한 해시와 같아야 보낸다(막기만 더한다).
// 해시가 없는 옛 FLIGHT PLAN은 전처럼 보낸다. 계산은 server/input-binding.ts(순수, 서버와 같은 함수)
// 검사 규칙은 server/send-checks.ts 한 곳에 있다(ATC-562): 이 hook과 atc 서버가 같은 함수를 부른다. 여기는 atc에 묻는 fetcher와 hook 입출력만 둔다.
// 이 hook은 OCC의 SendMessage이므로 caller "occ"로 부른다: 서버가 이미 보낸(sentVia server) FLIGHT PLAN은 막는다(막기만 더한다)
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkSend as sharedCheck, resolveSend as sharedResolve } from "../server/send-checks.ts";

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

// { reason } | { message }. message는 실제로 보낼 문구: 머리만 보냈으면 저장된 문구, 전체 문구면 보낸 그대로
export const resolveSend = (toolInput, fetcher = fetchRecord) => sharedResolve(toolInput, fetcher, "occ");

// 막는 사유(없으면 null). 머리만 보낸 경우도 통과하면 null이다: 바꿔 넣을 문구는 resolveSend가 준다
export const checkSend = (toolInput, fetcher = fetchRecord) => sharedCheck(toolInput, fetcher, "occ");

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
