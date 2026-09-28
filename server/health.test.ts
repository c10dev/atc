import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyError, DEFAULT_HEALTH, factsOf, healthAlerts, healthLabel, healthOf, resetFromText, type SessionState } from "./health.ts";

// AIRCRAFT health(ATC-45). 줄 모양은 실제 대화 기록(2026-09-24~28)에서 따왔고, 본문·경로·id는 지웠다.
const T = (hms: string) => `2026-09-28T${hms}Z`;
const at = (hms: string) => Date.parse(T(hms));
const base = { cwd: "/x", sessionId: "s1", version: "2.1.281", isSidechain: false, userType: "external", entrypoint: "cli" };
const prompt = (hms: string, text = "Try again") => JSON.stringify({ ...base, type: "user", timestamp: T(hms), origin: { kind: "human" }, turnOrigin: {}, message: { role: "user", content: text } });
// 다른 세션이 보낸 BRIEF는 isMeta이고 origin.kind가 peer다
const peer = (hms: string) =>
  JSON.stringify({ ...base, type: "user", isMeta: true, timestamp: T(hms), origin: { kind: "peer", from: "uds:/x.sock" }, turnOrigin: {}, message: { role: "user", content: "Another Claude session sent a message: [→ TEAM_H] ATC-44 BRIEF: DIRECT" } });
const reply = (hms: string, tools: string[] = []) =>
  JSON.stringify({ ...base, type: "assistant", timestamp: T(hms), message: { model: "claude-opus-5-5", role: "assistant", stop_reason: tools.length ? "tool_use" : "end_turn", content: [{ type: "text", text: "..." }, ...tools.map((id) => ({ type: "tool_use", id, name: "Bash", input: {} }))] } });
const result = (hms: string, id: string, deniedText?: string) =>
  JSON.stringify({ ...base, type: "user", timestamp: T(hms), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: Boolean(deniedText), content: deniedText ?? "ok" }] } });
const apiError = (hms: string, error: string, text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...base, type: "assistant", timestamp: T(hms), isApiErrorMessage: true, error, ...extra, message: { model: "<synthetic>", role: "assistant", stop_reason: "stop_sequence", content: [{ type: "text", text }] } });
const noise = (hms: string) => [JSON.stringify({ type: "queue-operation", timestamp: T(hms) }), JSON.stringify({ type: "last-prompt", sessionId: "s1" }), JSON.stringify({ type: "custom-title", customTitle: "TEAM_H" })];

const idle = (lastWriteAt = at("07:37:16")): SessionState => ({ status: "idle", lastWriteAt });
const run = (lines: string[], now: string, s: SessionState = idle()) => healthOf(factsOf(lines.join("\n")), s, at(now));

// TEAM_H, 2026-09-28: BRIEF 07:37:13, 한도 오류 07:37:16(reset 07:40), "Try again" 07:40:57, 그 뒤 READBACK
const limitLine = apiError("07:37:16", "rate_limit", "You've hit your session limit · resets 7:40am (UTC)", {
  apiErrorStatus: "429",
  quotaLimits: { status: "rejected", resetsAt: at("07:40:00") / 1000, rateLimitType: "five_hour", overageStatus: "rejected", isUsingOverage: false },
});
const teamH = [prompt("02:35:17"), reply("07:30:00"), peer("07:37:13"), limitLine, ...noise("07:37:17")];

test("TEAM_H 재생: LIMIT until 07:40Z → reset 뒤 UNANSWERED → READBACK 뒤 풀림", () => {
  const h1 = run(teamH, "07:38:00")!;
  assert.equal(h1.code, "LIMIT");
  assert.equal(h1.resetsAt, T("07:40:00.000"));
  assert.equal(h1.holds, true);
  assert.equal(healthLabel(h1, at("07:38:00")), "HOLD · LIMIT until 07:40Z");

  const h2 = run(teamH, "07:40:30")!;
  assert.equal(h2.code, "UNANSWERED");
  assert.equal(h2.since, T("07:37:13.000"));
  assert.equal(h2.holds, false);

  const after = [...teamH, prompt("07:40:57", "Try again"), reply("07:41:05")];
  assert.equal(run(after, "07:45:00"), null);
});

test("LIMIT: quotaLimits가 없으면 문구의 UTC 시각을 읽는다, 주간 한도는 weekly", () => {
  assert.equal(resetFromText("You've hit your session limit · resets 8:30pm (UTC)", at("19:00:00")), at("20:30:00"));
  assert.equal(resetFromText("resets 5am (UTC)", at("07:00:00")), at("05:00:00") + 86_400_000);
  assert.equal(resetFromText("resets 5am (Asia/Seoul)", at("07:00:00")), undefined);
  const weekly = run([prompt("07:00:00"), apiError("07:00:05", "rate_limit", "You've hit your weekly limit · resets 9pm (UTC)")], "07:10:00")!;
  assert.equal(weekly.code, "LIMIT");
  assert.equal(weekly.weekly, true);
  assert.equal(weekly.resetsAt, T("21:00:00.000"));
});

test("오류 원인 분류: 조사한 오류 여섯 가지와 모르는 것", () => {
  const c = (error: string, text: string, resetsAt?: number) => classifyError({ error, text, resetsAt });
  assert.equal(c("rate_limit", "You've hit your session limit · resets 7:40am (UTC)"), "LIMIT");
  assert.equal(c("rate_limit", "API Error: Server is temporarily limiting requests (not your usage limit) · The usage limit has been reached"), "THROTTLE");
  assert.equal(c("server_error", "API Error: Unable to connect to API: SSL certificate verification failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)."), "NETWORK");
  assert.equal(c("model_not_found", "There's an issue with the selected model (claude-ocx-native--x). It may not exist"), "MODEL");
  assert.equal(c("invalid_request", "Prompt is too long · automatic compaction failed: API Error: 400"), "CONTEXT");
  assert.equal(c("unknown", "API Error: 400 OpenAI-compatible provider: {\"model\":\"x\"}"), "PROVIDER");
  assert.equal(c("unknown", "API Error: 400 JSON schema exceeds the maximum nesting depth of 10 levels"), "PROVIDER");
  assert.equal(c("unknown", "API Error: 405 status code (no body)"), "PROVIDER");
  assert.equal(c("server_error", "API Error: 500 Internal server error"), "THROTTLE");
  assert.equal(c("authentication_failed", "Invalid API key"), "UNKNOWN");
});

test("NETWORK·MODEL·CONTEXT·PROVIDER는 ALERT, MODEL·CONTEXT·PROVIDER는 HOLD", () => {
  const one = (error: string, text: string) => run([prompt("07:00:00"), apiError("07:00:02", error, text)], "07:05:00")!;
  const net = one("server_error", "API Error: Unable to connect to API: SSL certificate verification failed");
  assert.deepEqual([net.code, net.level, net.holds], ["NETWORK", "alert", false]);
  for (const [error, text, code] of [
    ["model_not_found", "There's an issue with the selected model (x).", "MODEL"],
    ["invalid_request", "Prompt is too long · automatic compaction failed", "CONTEXT"],
    ["unknown", "API Error: 400 OpenAI-compatible provider: bad", "PROVIDER"],
  ]) {
    const h = one(error!, text!);
    assert.deepEqual([h.code, h.level, h.holds], [code, "alert", true]);
  }
  assert.equal(healthLabel(one("invalid_request", "Prompt is too long"), at("07:05:00")), "CONTEXT — RESTART");
  const unknown = one("billing_error", "Your credit balance is too low");
  assert.deepEqual([unknown.code, unknown.detail], ["UNKNOWN", "Your credit balance is too low"]);
});

test("THROTTLE: INFO, 30분 안에 3번이면 ALERT, 10분 넘게 대답 없으면 UNANSWERED", () => {
  const thr = (hms: string) => apiError(hms, "rate_limit", "API Error: Server is temporarily limiting requests (not your usage limit)");
  const once = run([prompt("07:00:00"), thr("07:00:02")], "07:03:00")!;
  assert.deepEqual([once.code, once.level, once.holds], ["THROTTLE", "info", false]);
  const thrice = run([prompt("06:50:00"), thr("06:50:02"), prompt("06:55:00"), thr("06:55:02"), prompt("07:00:00"), thr("07:00:02")], "07:03:00")!;
  assert.deepEqual([thrice.code, thrice.level], ["THROTTLE", "alert"]);
  const late = run([prompt("07:00:00"), thr("07:00:02")], "07:12:00")!;
  assert.deepEqual([late.code, late.since], ["UNANSWERED", T("07:00:00.000")]);
});

test("오류 뒤 새 지시가 오면 그 오류는 지난 것", () => {
  const lines = [prompt("07:00:00"), apiError("07:00:02", "model_not_found", "There's an issue with the selected model (x).")];
  assert.equal(run([...lines, prompt("07:01:00")], "07:02:00", { status: "busy", lastWriteAt: at("07:01:00") }), null);
  assert.equal(run([...lines, prompt("07:01:00"), reply("07:01:10")], "07:02:00"), null);
  // busy이면 오류 코드를 내지 않는다(재시도 중일 수 있다)
  assert.equal(run(lines, "07:02:00", { status: "busy", lastWriteAt: at("07:00:02") }), null);
});

test("PENDING: 도구 호출이 결과 없이 멈췄고 idle", () => {
  const h = run([prompt("07:00:00"), reply("07:00:05", ["toolu_1"])], "07:12:05")!;
  assert.deepEqual([h.code, h.level, h.since], ["PENDING", "info", T("07:00:05.000")]);
  assert.equal(healthLabel(h, at("07:12:05")), "PENDING approval 12m");
  assert.equal(run([prompt("07:00:00"), reply("07:00:05", ["toolu_1"]), result("07:00:30", "toolu_1"), reply("07:00:40")], "07:12:00"), null);
});

test("UNANSWERED: 지시 뒤 10분 대답 없음. 중단 표시·로컬 명령은 지시가 아니다", () => {
  assert.equal(run([reply("06:00:00"), prompt("07:00:00")], "07:09:00"), null);
  const h = run([reply("06:00:00"), prompt("07:00:00")], "07:14:00")!;
  assert.deepEqual([h.code, h.level, h.holds], ["UNANSWERED", "alert", false]);
  assert.equal(healthLabel(h, at("07:14:00")), "UNANSWERED 14m");
  assert.equal(run([reply("06:00:00"), prompt("07:00:00", "[Request interrupted by user]")], "07:30:00"), null);
  assert.equal(run([reply("06:00:00"), prompt("07:00:00", "<local-command-stdout>ok</local-command-stdout>")], "07:30:00"), null);
  // 메타 줄(hook이 넣은 알림)과 서브에이전트 줄은 세지 않는다
  const meta = JSON.stringify({ ...base, type: "user", isMeta: true, timestamp: T("07:00:00"), message: { role: "user", content: "hook note" } });
  const side = JSON.stringify({ ...base, type: "user", isSidechain: true, timestamp: T("07:00:00"), message: { role: "user", content: "sub task" } });
  assert.equal(run([reply("06:00:00"), meta, side], "07:30:00"), null);
});

test("HUNG: busy인데 30분 기록 없음은 INFO, 60분이면 ALERT", () => {
  const lines = [prompt("06:00:00"), reply("06:00:05", ["toolu_1"])];
  assert.equal(run(lines, "06:20:00", { status: "busy", lastWriteAt: at("06:00:05") }), null);
  const info = run(lines, "06:35:00", { status: "busy", lastWriteAt: at("06:00:05") })!;
  assert.deepEqual([info.code, info.level, info.holds], ["HUNG", "info", true]);
  const alert = run(lines, "07:05:00", { status: "busy", lastWriteAt: at("06:00:05") })!;
  assert.deepEqual([alert.code, alert.level], ["HUNG", "alert"]);
});

test("DENIED: 10분 안에 거부·hook 막힘 3번", () => {
  const deny = "Permission for this action was denied by the Claude Code auto mode classifier. Reason: x";
  const hook = 'PreToolUse:Bash hook error: ["/x/guard.mjs"]';
  const lines = [prompt("07:00:00"), reply("07:01:00", ["a"]), result("07:01:01", "a", deny), reply("07:02:00", ["b"]), result("07:02:01", "b", hook), reply("07:03:00", ["c"]), result("07:03:01", "c", deny), reply("07:03:10")];
  const h = run(lines, "07:05:00")!;
  assert.deepEqual([h.code, h.level, h.holds], ["DENIED", "info", false]);
  assert.equal(run(lines, "07:20:00"), null); // 창이 지나면 풀린다
  assert.equal(run(lines.slice(0, 6).concat(reply("07:03:10")), "07:05:00"), null); // 2번은 아직
  // 도구가 그냥 실패한 것(Exit code)은 세지 않는다
  const fails = [prompt("07:00:00"), reply("07:01:00", ["a"]), result("07:01:01", "a", "Exit code 1"), reply("07:02:00", ["b"]), result("07:02:01", "b", "Exit code 2"), reply("07:03:00", ["c"]), result("07:03:01", "c", "Exit code 1"), reply("07:03:10")];
  assert.equal(run(fails, "07:05:00"), null);
});

test("정상 세션, 빈 기록, dead 세션은 null", () => {
  assert.equal(run([prompt("07:00:00"), reply("07:00:05")], "08:00:00"), null);
  assert.equal(run([], "08:00:00"), null);
  assert.equal(run(teamH, "07:38:00", { status: "dead", lastWriteAt: null }), null);
  assert.equal(factsOf("not json\n{\"type\":\"assistant\"\n").length, 0);
});

test("사실에는 본문이 남지 않는다(오류 한 줄만)", () => {
  const facts = factsOf([prompt("07:00:00", "비밀 지시 본문"), reply("07:00:05"), limitLine].join("\n"));
  const text = JSON.stringify(facts);
  assert.ok(!text.includes("비밀"));
  assert.ok(!text.includes("..."));
});

test("healthAlerts: NETWORK는 기계에 한 번, LIMIT은 같은 reset끼리 한 번, INFO는 경보 아님", () => {
  const now = at("07:38:00");
  const net = { code: "NETWORK" as const, level: "alert" as const, since: T("07:00:00"), detail: "Unable to connect", next: "", holds: false };
  const lim = (resetsAt: string) => ({ code: "LIMIT" as const, level: "alert" as const, since: T("07:37:00"), resetsAt, detail: "limit", next: "", holds: true });
  const alerts = healthAlerts(
    [
      { sessionId: "a", name: "TEAM_A", health: net },
      { sessionId: "b", name: "TEAM_B", health: net },
      { sessionId: "c", name: "TEAM_C", health: net },
      { sessionId: "h", name: "TEAM_H", health: lim(T("07:40:00")) },
      { sessionId: "k", name: "TEAM_K", health: lim(T("07:40:00")) },
      { sessionId: "j", name: "TEAM_J", health: lim(T("09:00:00")) },
      { sessionId: "p", name: "TEAM_P", health: { ...net, code: "PENDING", level: "info" } },
      { sessionId: "q", name: "TEAM_Q", health: { ...net, code: "CONTEXT" } },
      { sessionId: "r", name: "TEAM_R", health: null },
    ],
    now,
  );
  assert.deepEqual(
    alerts.map((a) => [a.key, a.sessionIds.join(",")]),
    [
      ["health|NETWORK", "a,b,c"],
      [`health|LIMIT|${T("07:40:00")}`, "h,k"],
      [`health|LIMIT|${T("09:00:00")}`, "j"],
      ["health|CONTEXT|q", "q"],
    ],
  );
  assert.match(alerts[1]!.message, /TEAM_H, TEAM_K .*reset 07:40Z/);
});

test("임계값은 설정으로 바꾼다", () => {
  const lines = [reply("06:00:00"), prompt("07:00:00")];
  assert.equal(healthOf(factsOf(lines.join("\n")), idle(), at("07:06:00"), { ...DEFAULT_HEALTH, unansweredMin: 5 })?.code, "UNANSWERED");
});
