#!/usr/bin/env node
// Claude Code hook(ATC-47): 세션이 멈춘 순간을 health/<sessionId>.jsonl에 한 줄로 남긴다(push).
//   StopFailure                        API 오류로 턴이 끝났다 → {t, event, code, error, line?}
//   Notification permission_prompt·elicitation_dialog → code PENDING, idle_prompt → 코드 없음
//   Stop·PostToolUse·UserPromptSubmit  세션이 다시 움직였다 → 코드를 지우는 줄(ATC-86: UserPromptSubmit 더함)
//   Notification quota_auto_resume_fired·_stale·_disabled  CLI의 한도 자동 이어가기(ATC-86) → 코드 없는 줄. fired가 RESUME을 푼다
// 코드는 server/health.ts의 classifyError로 뽑아 pull 분류기와 같은 규칙을 쓴다(ATC-45).
// 코드, 시각, 오류 한 줄(≤200자)만 둔다 — 본문은 두지 않는다. 출력 없이 항상 exit 0.
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyError, firstLine } from "../server/health.ts";

const SESSION_RE = /^[\w-]{1,128}$/;
// 코드를 지우는 이벤트: 세션이 다시 돌기 시작했다
export const CLEAR_EVENTS = new Set(["Stop", "PostToolUse", "UserPromptSubmit"]);
// 한도 자동 이어가기(quota auto-resume) notification_type. 시각만 남긴다
export const QUOTA_TYPES = new Set(["quota_auto_resume_fired", "quota_auto_resume_stale", "quota_auto_resume_disabled"]);
// 대기 코드를 만드는 notification_type
export const PENDING_TYPES = new Set(["permission_prompt", "elicitation_dialog"]);

const stateDir = () => process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");
export const sessionFile = (dir, sessionId) => join(dir, "health", `${sessionId}.jsonl`);

// hook 입력 하나 → 기록 한 줄. 남길 것이 없으면 null (순수)
export function recordOf(input, now = Date.now()) {
  const event = input?.hook_event_name;
  const t = new Date(now).toISOString();
  if (event === "StopFailure") {
    const error = typeof input.error === "string" && input.error ? input.error : "unknown";
    const raw = typeof input.last_assistant_message === "string" ? input.last_assistant_message : typeof input.error_details === "string" ? input.error_details : "";
    const line = firstLine(raw);
    return { t, event, code: classifyError({ error, text: line }), error, ...(line ? { line } : {}) };
  }  if (event === "Notification") {
    const type = input.notification_type;
    if (PENDING_TYPES.has(type)) return { t, event: type, code: "PENDING" };
    if (type === "idle_prompt" || QUOTA_TYPES.has(type)) return { t, event: type }; // 혼자서는 코드가 아니다
    return null;
  }
  if (CLEAR_EVENTS.has(event)) return { t, event }; // 앞의 코드를 지운다
  return null;
}

// 파일 끝의 마지막 기록 하나 (순수). 서버가 같은 규칙으로 읽는다
export function lastPushRecord(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"event"')) continue;
    try {
      const r = JSON.parse(lines[i]);
      if (r && typeof r === "object" && typeof r.event === "string" && typeof r.t === "string") return r;
    } catch {}
  }
  return null;
}

// stdin 입력 하나를 처리해 한 줄을 덧붙인다. 실패는 조용히 삼킨다(세션을 막지 않는다)
export function run(input, { dir = stateDir(), now = Date.now() } = {}) {
  const sessionId = input?.session_id;
  if (!sessionId || !SESSION_RE.test(sessionId)) return null;
  const rec = recordOf(input, now);
  if (!rec) return null;
  mkdirSync(join(dir, "health"), { recursive: true });
  appendFileSync(sessionFile(dir, sessionId), JSON.stringify(rec) + "\n");
  return rec;
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    run(JSON.parse(readFileSync(0, "utf8")));
  } catch {}
  process.exit(0);
}
