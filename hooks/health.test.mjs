import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLEAR_EVENTS, PENDING_TYPES, QUOTA_TYPES, lastPushRecord, recordOf, run, sessionFile } from "./health.mjs";

const SCRIPT = new URL("./health.mjs", import.meta.url).pathname;
const T = "2026-09-28T07:37:16.000Z";
const now = Date.parse(T);
const input = (extra) => ({ session_id: "sess-1", hook_event_name: "StopFailure", cwd: "/x", transcript_path: "/must/not/read", ...extra });

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "atc-health-"));
  return { base, dir: join(base, "state"), done: () => rmSync(base, { recursive: true, force: true }) };
}
const lines = (s) => readFileSync(sessionFile(s.dir, "sess-1"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("StopFailure 한 줄: error를 classifyError로 코드로 옮기고 오류 한 줄만 둔다", () => {
  const cases = [
    ["rate_limit", "You've hit your session limit · resets 7:40am (UTC)", "LIMIT"],
    ["server_error", "API Error: Unable to connect to API: SSL certificate verification failed", "NETWORK"],
    ["model_not_found", "There's an issue with the selected model (x).", "MODEL"],
    ["invalid_request", "Prompt is too long · automatic compaction failed", "CONTEXT"],
    ["unknown", "API Error: 400 OpenAI-compatible provider: bad", "PROVIDER"],
    ["unknown", "API Error: 405 status code (no body)", "PROVIDER"],
    ["server_error", "API Error: 500 Internal server error", "THROTTLE"],
    ["billing_error", "Your credit balance is too low", "UNKNOWN"],
  ];
  for (const [error, text, code] of cases) {
    const rec = recordOf(input({ error, last_assistant_message: text }), now);
    assert.deepEqual([rec.t, rec.event, rec.code, rec.error], [T, "StopFailure", code, error]);
    assert.equal(rec.line, text);
  }
  // 오류 원문이 없으면 error_details에서, 둘 다 없으면 line 없이
  assert.equal(recordOf(input({ error: "unknown", error_details: "boom" }), now).line, "boom");
  const bare = recordOf(input({}), now);
  assert.deepEqual(bare, { t: T, event: "StopFailure", code: "UNKNOWN", error: "unknown" });
});

test("본문은 두지 않는다: 오류 한 줄만, 200자까지", () => {
  const body = "첫 줄 오류 요약\n이 아래는 지시 본문이다: 비밀 지시";
  const rec = recordOf(input({ error: "unknown", last_assistant_message: body }), now);
  assert.equal(rec.line, "첫 줄 오류 요약");
  assert.ok(!JSON.stringify(rec).includes("비밀"));
  const long = recordOf(input({ error: "unknown", last_assistant_message: "x".repeat(500) }), now);
  assert.equal(long.line.length, 200);
  // 앞의 줄이 공백뿐이면 다음 줄
  assert.equal(recordOf(input({ error: "unknown", last_assistant_message: "\n\n진짜 오류" }), now).line, "진짜 오류");
});

test("Notification: permission_prompt·elicitation_dialog는 PENDING, idle_prompt는 코드 없음", () => {
  assert.deepEqual(recordOf({ session_id: "s", hook_event_name: "Notification", notification_type: "permission_prompt" }, now), { t: T, event: "permission_prompt", code: "PENDING" });
  assert.deepEqual(recordOf({ session_id: "s", hook_event_name: "Notification", notification_type: "elicitation_dialog" }, now), { t: T, event: "elicitation_dialog", code: "PENDING" });
  assert.deepEqual(recordOf({ session_id: "s", hook_event_name: "Notification", notification_type: "idle_prompt" }, now), { t: T, event: "idle_prompt" });
  assert.equal(recordOf({ session_id: "s", hook_event_name: "Notification", notification_type: "something_else" }, now), null);
});

test("Stop·PostToolUse·UserPromptSubmit은 코드를 지우는 줄, 그 밖의 이벤트는 아무것도 남기지 않는다. 본문은 두지 않는다", () => {
  assert.deepEqual(recordOf({ hook_event_name: "Stop" }, now), { t: T, event: "Stop" });
  assert.deepEqual(recordOf({ hook_event_name: "PostToolUse", tool_name: "Edit" }, now), { t: T, event: "PostToolUse" });
  // ATC-86: 지시가 들어온 순간. prompt 본문·Stop의 마지막 답은 옮기지 않는다
  assert.deepEqual(recordOf({ hook_event_name: "UserPromptSubmit", prompt: "BODY-must-not-survive" }, now), { t: T, event: "UserPromptSubmit" });
  assert.deepEqual(recordOf({ hook_event_name: "Stop", last_assistant_message: "BODY-must-not-survive" }, now), { t: T, event: "Stop" });
  for (const e of ["SessionStart", "PreToolUse", "SubagentStop"]) assert.equal(recordOf({ hook_event_name: e }, now), null);
  assert.ok(CLEAR_EVENTS.has("Stop") && CLEAR_EVENTS.has("PostToolUse") && CLEAR_EVENTS.has("UserPromptSubmit") && PENDING_TYPES.has("permission_prompt"));
});

test("Notification quota_auto_resume_*: 코드 없이 시각만 남긴다(fired가 RESUME을 푼다)", () => {
  assert.deepEqual([...QUOTA_TYPES].sort(), ["quota_auto_resume_disabled", "quota_auto_resume_fired", "quota_auto_resume_stale"]);
  for (const type of QUOTA_TYPES) assert.deepEqual(recordOf({ hook_event_name: "Notification", notification_type: type, message: "BODY-must-not-survive" }, now), { t: T, event: type });
});

test("run: 세션마다 health/<sessionId>.jsonl에 추가만 한다. 이상한 세션 id는 무시", () => {
  const s = sandbox();
  try {
    assert.ok(run(input({ error: "rate_limit", last_assistant_message: "You've hit your session limit · resets 7:40am (UTC)" }), { dir: s.dir, now }));
    run({ session_id: "sess-1", hook_event_name: "Notification", notification_type: "permission_prompt" }, { dir: s.dir, now: now + 1000 });
    run({ session_id: "sess-1", hook_event_name: "PostToolUse" }, { dir: s.dir, now: now + 2000 });
    assert.deepEqual(lines(s).map((r) => [r.event, r.code ?? null, r.error ?? null]), [
      ["StopFailure", "LIMIT", "rate_limit"],
      ["permission_prompt", "PENDING", null],
      ["PostToolUse", null, null],
    ]);
    assert.equal(run({ session_id: "../x", hook_event_name: "Stop" }, { dir: s.dir }), null);
    assert.equal(run({ session_id: "sess-2", hook_event_name: "SessionStart" }, { dir: s.dir }), null);
  } finally {
    s.done();
  }
});

test("lastPushRecord: 끝에서 첫 유효한 줄 하나. 깨진 줄은 건너뛴다", () => {
  assert.deepEqual(lastPushRecord('{"t":"a","event":"Stop"}\n{"t":"b","event":"permission_prompt","code":"PENDING"}\n'), { t: "b", event: "permission_prompt", code: "PENDING" });
  assert.deepEqual(lastPushRecord('{"t":"a","event":"Stop"}\n{broken\n'), { t: "a", event: "Stop" });
  assert.equal(lastPushRecord(""), null);
  assert.equal(lastPushRecord('{"t":"a","event":5}\n'), null);
});

test("fail open: 잘못된 stdin, 쓸 수 없는 상태 폴더에도 출력 없이 exit 0", () => {
  const s = sandbox();
  try {
    const notDir = join(s.base, "a-file");
    writeFileSync(notDir, "x"); // 상태 폴더 자리에 파일 → 쓸 수 없음(ENOTDIR)
    // 운영 상태 폴더(~/.local/state/atc)에 쓰지 않도록 늘 시험 폴더를 준다
    for (const [stdin, env] of [["{broken", { ATC_STATE_DIR: s.dir }], [JSON.stringify(input({ error: "unknown" })), { ATC_STATE_DIR: notDir }], [JSON.stringify(input({ error: "rate_limit", last_assistant_message: "limit" })), { ATC_STATE_DIR: s.dir }]]) {
      const r = spawnSync(process.execPath, [SCRIPT], { input: stdin, env: { ...process.env, ...env }, encoding: "utf8", timeout: 5000 });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
    }
    // ATC_STATE_DIR를 주면 그 아래 health/에 쓴다
    spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(input({ error: "rate_limit", last_assistant_message: "You've hit your session limit" })), env: { ...process.env, ATC_STATE_DIR: s.dir }, encoding: "utf8", timeout: 5000 });
    assert.equal(lines(s).at(-1).code, "LIMIT");
  } finally {
    s.done();
  }
});
