import assert from "node:assert/strict";
import { test } from "node:test";
import { accountHoldLabel, accountHoldOf, accountHolds, classifyError, cutResetOf, DEFAULT_HEALTH, factsOf, healthAlerts, healthLabel, healthOf, LIMIT_WINDOW_MS, lastFactAt, mergeHealth, type PushRecord, resetFromText, type SessionState, settleCut, stalledOf } from "./health.ts";

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

// ── ACCOUNT(ATC-51): 사용 한도는 ACCOUNT의 것 ──
const limitAt = (resetsAt?: string, weekly = false) => ({ code: "LIMIT" as const, level: "alert" as const, since: T("07:37:00"), ...(resetsAt ? { resetsAt } : {}), ...(weekly ? { weekly } : {}), detail: "limit", next: "", holds: true });

test("healthAlerts: ACCOUNT를 알면 LIMIT을 ACCOUNT끼리 한 번 묶고 붙들린 형제를 적는다. 모르는 세션은 reset 시각으로", () => {
  const now = at("07:38:00");
  const alerts = healthAlerts(
    [
      { sessionId: "k", name: "TEAM_K", account: "pro-2", health: limitAt(T("07:40:00")) },
      { sessionId: "l", name: "TEAM_L", account: "pro-2", health: limitAt(T("09:00:00")) },
      { sessionId: "m", name: "TEAM_M", account: "pro-2", health: null },
      { sessionId: "a", name: "TEAM_A", account: "default", health: limitAt(T("07:40:00")) },
      { sessionId: "b", name: "TEAM_B", account: "default", health: { ...limitAt(), code: "PENDING", level: "info", holds: false } },
      { sessionId: "s", name: "structure", account: null, health: limitAt(T("07:40:00")) },
    ],
    now,
  );
  assert.deepEqual(
    alerts.map((a) => [a.key, a.sessionIds.join(",")]),
    [
      ["health|LIMIT|account:pro-2", "k,l"],
      ["health|LIMIT|account:default", "a"],
      [`health|LIMIT|${T("07:40:00")}`, "s"],
    ],
  );
  // 같은 ACCOUNT 안에서 reset이 다르면 가장 늦은 reset
  assert.equal(alerts[0]!.message, "LIMIT (account pro-2) — TEAM_K, TEAM_L 사용 한도, reset 09:00Z까지 HOLD · 같은 ACCOUNT도 HOLD: TEAM_M");
  assert.equal(alerts[1]!.message, "LIMIT (account default) — TEAM_A 사용 한도, reset 07:40Z까지 HOLD · 같은 ACCOUNT도 HOLD: TEAM_B");
  assert.equal(alerts[2]!.message, "LIMIT — structure 사용 한도, reset 07:40Z까지 HOLD");
});

test("accountHolds: LIMIT 하나가 같은 ACCOUNT의 형제를 reset까지 붙든다. 걸린 AIRCRAFT 자신은 제 health로 보인다", () => {
  const xs = [
    { name: "TEAM_K", account: "pro-2", health: limitAt(T("07:40:00")) },
    { name: "TEAM_L", account: "pro-2", health: null },
    { name: "TEAM_A", account: "default", health: null },
  ];
  const holds = accountHolds(xs, at("07:38:00"));
  assert.deepEqual([...holds.keys()], ["pro-2"]);
  assert.equal(accountHoldOf(holds, "pro-2", "TEAM_K"), null);
  assert.deepEqual(accountHoldOf(holds, "pro-2", "team_l"), { account: "pro-2", resetsAt: T("07:40:00"), by: ["TEAM_K"] });
  assert.equal(accountHoldOf(holds, "default", "TEAM_A"), null);
  assert.equal(accountHoldLabel(holds.get("pro-2")!, at("07:38:00")), "HOLD · LIMIT (account pro-2) until 07:40Z");
  // reset이 지나면 붙들지 않는다
  assert.equal(accountHolds(xs, at("07:40:00")).size, 0);
});

test("accountHolds: ACCOUNT를 모르면(라벨 없음) 붙들지 않고, reset을 모르는 LIMIT은 풀릴 때까지, 주간이면 표시", () => {
  assert.equal(accountHolds([{ name: "TEAM_K", account: null, health: limitAt(T("07:40:00")) }], at("07:38:00")).size, 0);
  const holds = accountHolds(
    [
      { name: "TEAM_K", account: "main", health: limitAt() },
      { name: "TEAM_L", account: "main", health: limitAt("2026-10-03T07:40:00.000Z", true) },
    ],
    at("07:38:00"),
  );
  const h = holds.get("main")!;
  assert.deepEqual(h.by, ["TEAM_K", "TEAM_L"]);
  assert.equal(accountHoldLabel(h, at("07:38:00")), "HOLD · LIMIT (account main, weekly) until 10-03 07:40Z");
  assert.equal(accountHolds([{ name: "TEAM_K", account: "main", health: limitAt() }], at("23:59:00")).size, 1);
});

test("임계값은 설정으로 바꾼다", () => {
  const lines = [reply("06:00:00"), prompt("07:00:00")];
  assert.equal(healthOf(factsOf(lines.join("\n")), idle(), at("07:06:00"), { ...DEFAULT_HEALTH, unansweredMin: 5 })?.code, "UNANSWERED");
});

// ATC-47 push: hooks/health.mjs가 남긴 한 줄과 대화 기록(pull)을 합친다
const push = (t: string, extra: Partial<PushRecord> = {}): PushRecord => ({ t: T(t), event: "StopFailure", ...extra });
const facts = (ls: string[]) => factsOf(ls.join("\n"));
// 세션 파일이 busy이고 기록이 멈춰 있어 pull이 HUNG을 내는 상태(승인 대기 중 흔하다)
const hungFacts = () => facts([prompt("06:00:00"), reply("06:00:05", ["toolu_1"])]);
const hungState: SessionState = { status: "busy", lastWriteAt: at("06:00:05") };

test("push가 pull보다 새로우면 push가 이긴다: 승인 대기(PENDING)가 30분 HUNG보다 먼저", () => {
  const pull = healthOf(hungFacts(), hungState, at("07:00:00"))!;
  assert.equal(pull.code, "HUNG"); // push가 없으면 30분 뒤 HUNG
  const merged = mergeHealth(push("07:30:00", { event: "permission_prompt", code: "PENDING" }), pull, hungFacts());
  assert.deepEqual([merged!.code, merged!.level, merged!.since, merged!.holds], ["PENDING", "info", T("07:30:00.000"), false]);
  assert.equal(healthLabel(merged!, at("07:30:00")), "PENDING approval 0m");
  // 대화 기록에 아직 사실이 없어도(transcript를 못 찾는 세션) push만으로 코드가 선다
  assert.equal(mergeHealth(push("07:30:00", { event: "permission_prompt", code: "PENDING" }), null, [])!.code, "PENDING");
});

test("pull이 더 새로우면 pull이 이긴다: 그 뒤 파일이 움직였으면 push는 지난 것", () => {
  const lines = hungFacts().concat(); // 마지막 사실 06:00:05
  const pull = healthOf(lines, hungState, at("07:00:00"))!;
  // push(06:00:05)와 같은 시각 → pull이 남는다(같으면 pull 우선)
  assert.equal(mergeHealth(push("06:00:05", { event: "permission_prompt", code: "PENDING" }), pull, lines)!.code, "HUNG");
  // push가 더 이르면 pull
  assert.equal(mergeHealth(push("06:00:04", { event: "permission_prompt", code: "PENDING" }), pull, lines)!.code, "HUNG");
  // push가 더 나중이면 push
  assert.equal(mergeHealth(push("07:30:00", { event: "permission_prompt", code: "PENDING" }), pull, lines)!.code, "PENDING");
  assert.equal(lastFactAt(lines), at("06:00:05"));
});

test("StopFailure push: error를 같은 classifyError로 옮기고, LIMIT은 문구에서 reset을 읽는다", () => {
  const h = mergeHealth(push("07:37:16", { code: "LIMIT", error: "rate_limit", line: "You've hit your session limit · resets 7:40am (UTC)" }), null, [])!;
  assert.deepEqual([h.code, h.level, h.holds, h.resetsAt], ["LIMIT", "alert", true, T("07:40:00.000")]);
  assert.equal(healthLabel(h, at("07:38:00")), "HOLD · LIMIT until 07:40Z");
  // push 기록의 코드는 hook이 classifyError로 정한다(여기 분류기는 그대로 신뢰). 모르면 원문
  const net = mergeHealth(push("07:00:00", { code: "NETWORK", error: "server_error", line: "Unable to connect to API" }), null, [])!;
  assert.deepEqual([net.code, net.level, net.holds], ["NETWORK", "alert", false]);
  // 시각이 깨진 줄, push 없음은 pull 그대로
  assert.equal(mergeHealth({ t: "nope", event: "Stop" }, null, []), null);
  assert.equal(mergeHealth(null, null, []), null);
});

test("clear(코드 없는 줄)는 pull을 낮추지 않는다", () => {
  const lines = hungFacts();
  const pull = healthOf(lines, hungState, at("07:00:00"))!;
  // Stop·idle_prompt는 코드가 없다 → pull(HUNG)이 그대로 선다
  assert.equal(mergeHealth(push("07:30:00", { event: "Stop" }), pull, lines), pull);
  assert.equal(mergeHealth(push("07:30:00", { event: "idle_prompt" }), pull, lines)!.code, "HUNG");
  // 새 StopFailure가 pull보다 새로우면 새 코드로 바뀐다
  assert.equal(mergeHealth(push("07:31:00", { code: "MODEL", error: "model_not_found", line: "issue with the selected model" }), pull, lines)!.code, "MODEL");
});


// ── 오류 없이 한도로 잘린 턴(ATC-86) ──
// TEAM_G(7cae8be1, ATC-72)와 TEAM_H(b8a9ff31, ATC-77), 2026-09-28. 대화 기록 줄의 키 구조는 실제 그대로, 본문은 표시 문자열로 바꿨다.
// 한도 안내는 usageLimitNote "wrap_up"인 isMeta 사용자 줄이고, 그 뒤 턴이 정상 Stop으로 끝났다(StopFailure 없음). 다음 사람 지시 앞에 "release" 줄이 온다
const NOTE_TEXT = "[Usage limit reached; a short grace allowance remains ... NOTE-TEXT-must-not-survive]";
const limitNote = (hms: string, note: "wrap_up" | "release" = "wrap_up", day = "2026-09-28") =>
  JSON.stringify({ ...base, type: "user", isMeta: true, turnCompanion: true, usageLimitNote: note, timestamp: `${day}T${hms}Z`, message: { role: "user", content: note === "wrap_up" ? NOTE_TEXT : "[Earlier usage-limit notes no longer apply. Continue working normally.]" } });
const nextDay = (hms: string, text: string) => JSON.stringify({ ...base, type: "user", timestamp: `2026-09-29T${hms}Z`, turnOrigin: "human", message: { role: "user", content: text } });

// ATC-167: 안내 뒤 마지막 대답이 end_turn(정상 마무리)이면 cut이 아니다. 잘린 모양은 마지막 대답이 end_turn이 아닌 것(도구 결과를 받은 뒤 다음 대답 없이 멈춤)이다. 결과 없는 도구 호출은 PENDING이 먼저다.
// TEAM_G: 일하다가 18:10:48에 안내, 마지막 도구 하나 더, 18:10:58에 도구 결과를 받은 뒤 멈춤(잘림)
const teamG = [prompt("14:00:00", "ATC-72 진행"), reply("18:10:23"), reply("18:10:45", ["g1"]), result("18:10:48", "g1"), limitNote("18:10:48"), reply("18:10:53", ["g2"]), result("18:10:58", "g2"), ...noise("18:10:58")];
// TEAM_H: 18:10:15 안내, 18:10:27에 도구 결과를 받은 뒤 멈춤(잘림)
const teamHcut = [prompt("12:00:00", "ATC-77 진행"), reply("18:10:13", ["h1"]), result("18:10:15", "h1"), limitNote("18:10:15"), reply("18:10:21", ["h2"]), result("18:10:27", "h2")];
// 같은 안내 뒤 정상 마무리(end_turn)로 끝난 세션: 잘리지 않았다
const teamGwrapped = [...teamG.slice(0, 7), reply("18:11:06"), ...noise("18:11:06")];

test("cut LIMIT: G·H 재생 — 안내 뒤 도구 결과만 받고 멈추면 HOLD · LIMIT (cut 18:10Z). 오류 줄이 없어도, 본문은 남기지 않는다", () => {
  const g = run(teamG, "19:00:00", idle(at("18:11:06")))!;
  assert.equal(g.code, "LIMIT");
  assert.equal(g.cut, true);
  assert.equal(g.cutAt, "2026-09-28T18:10:48.000Z");
  assert.equal(g.since, "2026-09-28T18:10:48.000Z");
  assert.equal(g.level, "alert");
  assert.equal(g.holds, true); // DISPATCH는 cut LIMIT도 LIMIT처럼 건너뛴다
  assert.equal(g.resetsAt, undefined); // reset은 ACCOUNT의 FUEL 기록에서(settleCut)
  assert.equal(healthLabel(g, at("19:00:00")), "HOLD · LIMIT (cut 18:10Z)");
  assert.match(g.next, /RESUME/);
  assert.equal(JSON.stringify(g).includes("NOTE-TEXT"), false);
  const h = run(teamHcut, "19:00:00", idle(at("18:10:39")))!;
  assert.equal(healthLabel(h, at("19:00:00")), "HOLD · LIMIT (cut 18:10Z)");
  assert.equal(h.cutAt, "2026-09-28T18:10:15.000Z");
  // 사실에는 안내 시각과 종류만 있다
  assert.deepEqual(factsOf(limitNote("18:10:48")), [{ t: at("18:10:48"), kind: "limit-note", note: "wrap_up" }]);
});

test("ATC-167: 안내 뒤 end_turn으로 정상 마무리하고 쉬면 cut LIMIT이 아니다(health 없음). 도구 결과만 받고 멈추거나 대답이 없으면 cut 그대로", () => {
  assert.equal(run(teamGwrapped, "19:00:00", idle(at("18:11:06"))), null);
  assert.equal(run(teamGwrapped, "2026-09-30T00:00:00".slice(11), idle(at("18:11:06"))), null); // 시간이 지나도 LIMIT이 되살아나지 않는다
  assert.equal(factsOf(teamGwrapped.join("\n")).filter((f) => f.kind === "reply").at(-1)!.kind === "reply" && (factsOf(teamGwrapped.join("\n")).filter((f) => f.kind === "reply").at(-1) as { stop?: string }).stop, "end_turn");
  // 안내 뒤 대답이 하나도 없이 멈춘 것도 cut
  assert.equal(run([prompt("14:00:00"), reply("18:10:45", ["g1"]), result("18:10:48", "g1"), limitNote("18:10:48")], "19:00:00", idle(at("18:10:48")))!.cut, true);
  // 마무리 뒤 새 안내가 오고 도구 결과만 받고 멈추면 다시 cut
  const again = [...teamGwrapped.slice(0, 8), limitNote("18:20:00"), reply("18:20:05", ["g9"]), result("18:20:08", "g9")];
  assert.equal(run(again, "19:00:00", idle(at("18:20:05")))!.cutAt, "2026-09-28T18:20:00.000Z");
});

test("cut LIMIT: 안내가 있어도 아직 일하는 중(busy), 안내가 마지막 지시보다 앞, release가 뒤에 오면 아니다", () => {
  assert.equal(run(teamG.slice(0, 6), "18:10:55", { status: "busy", lastWriteAt: at("18:10:53") }), null); // 마무리 중
  assert.equal(run([...teamG, prompt("19:00:00", "계속")], "19:05:00", idle(at("19:00:00"))), null); // 새 지시가 오면 풀림
  assert.equal(run([...teamG, limitNote("19:00:00", "release"), reply("19:00:05")], "19:05:00", idle(at("19:00:05"))), null);
  assert.equal(run([prompt("14:00:00"), limitNote("14:30:00"), reply("14:30:10"), peer("15:00:00"), reply("15:01:00")], "15:10:00", idle(at("15:01:00"))), null); // 다른 세션의 BRIEF도 지시다
});

test("cut LIMIT: 안내 뒤 정말 API 오류로 끝나면 그 오류(cut 아님)가 이긴다", () => {
  const later = [...teamG.slice(0, 7), apiError("18:11:00", "rate_limit", "You've hit your session limit · resets 11:10pm (UTC)", { quotaLimits: { resetsAt: at("23:10:00") / 1000, rateLimitType: "five_hour" } })];
  const h = run(later, "19:00:00", idle(at("18:11:00")))!;
  assert.equal(h.code, "LIMIT");
  assert.equal(h.cut, undefined);
  assert.equal(h.resetsAt, T("23:10:00.000"));
});

test("cutResetOf: 잘린 시각 직전의 같은 ACCOUNT 기록에서, 그때 아직 오지 않은 reset을 가진 창 중 holdPct 이상. 지금 FUEL이 버린 창도 기록에서 되짚는다", () => {
  const rl = (five: number, seven = 30, reset5 = at("23:10:00"), reset7 = at("23:59:59") + 3 * 86_400_000) => ({ five_hour: { used_percentage: five, resets_at: reset5 / 1000 }, seven_day: { used_percentage: seven, resets_at: reset7 / 1000 } });
  const recs = [
    { t: T("17:00:00"), sessionId: "tower", rate_limits: rl(80) },
    { t: T("18:09:00"), sessionId: "tower", rate_limits: rl(100) },
    { t: T("18:20:00"), sessionId: "tower", rate_limits: rl(2, 31, at("23:10:00") + 5 * 3600_000) }, // 잘린 뒤의 기록은 쓰지 않는다
    { t: T("18:08:00"), sessionId: "occ", rate_limits: rl(96) },
  ];
  const cut = at("18:10:48");
  assert.deepEqual(cutResetOf(cut, recs, 95), { resetsAt: at("23:10:00"), weekly: false });
  // 주간 한도가 찼으면 weekly, 둘 다 찼으면 늦은 쪽
  assert.deepEqual(cutResetOf(cut, [{ t: T("18:09:00"), sessionId: "tower", rate_limits: rl(40, 100) }], 95), { resetsAt: at("23:59:59") + 3 * 86_400_000, weekly: true });
  // 찬 창이 없거나 기록이 없으면 모른다
  assert.equal(cutResetOf(cut, [{ t: T("18:09:00"), sessionId: "tower", rate_limits: rl(50, 50) }], 95), null);
  assert.equal(cutResetOf(cut, [], 95), null);
  assert.equal(cutResetOf(cut, [{ t: T("18:09:00"), sessionId: "tower" }], 95), null);
  // 잘린 시각보다 앞선 reset은 지난 창의 것
  assert.equal(cutResetOf(cut, [{ t: T("18:09:00"), sessionId: "tower", rate_limits: rl(100, 0, at("17:00:00")) }], 95), null);
});

test("settleCut: reset 전에는 LIMIT (cut) until reset, reset이 지나면 RESUME 필요(alert, 보여 주기만). reset을 모르면 5시간까지 그대로", () => {
  const g = run(teamG, "19:00:00", idle(at("18:11:06")))!;
  const reset = { resetsAt: at("23:10:00"), weekly: false };
  const before = settleCut(g, reset, at("20:00:00"));
  assert.equal(before.code, "LIMIT");
  assert.equal(before.resetsAt, T("23:10:00.000"));
  assert.equal(healthLabel(before, at("20:00:00")), "HOLD · LIMIT (cut 18:10Z) until 23:10Z");
  const wk = settleCut(g, { resetsAt: at("23:10:00"), weekly: true }, at("20:00:00"));
  assert.equal(healthLabel(wk, at("20:00:00")), "HOLD · LIMIT (weekly, cut 18:10Z) until 23:10Z");
  const after = settleCut(g, reset, at("23:10:01"));
  assert.equal(after.code, "RESUME");
  assert.equal(after.level, "alert");
  assert.equal(after.holds, false); // 표시만: DISPATCH·FLEET PLAN은 바뀌지 않는다
  assert.equal(after.since, T("23:10:00.000"));
  assert.equal(after.cutAt, "2026-09-28T18:10:48.000Z");
  assert.equal(healthLabel(after, at("23:30:00")), "RESUME 필요");
  assert.match(after.detail, /reset 23:10Z/);
  assert.match(after.next, /계속/);
  assert.match(after.next, /메시지를 보내지 않는다/);
  assert.equal(settleCut(g, null, at("20:00:00")), g); // cut + 5시간(23:10:48) 전
  assert.equal(settleCut(g, null, at("23:30:00")).code, "RESUME"); // 그 뒤엔 풀린 것(ATC-167)
  const plain = healthOf(factsOf([prompt("14:00:00"), apiError("14:00:05", "rate_limit", "hit · resets 11:10pm (UTC)")].join("\n")), idle(), at("14:10:00"))!;
  assert.equal(settleCut(plain, reset, at("23:30:00")), plain); // cut이 아닌 LIMIT은 그대로
});

test("ATC-167: reset이 지난 cut은 RESUME, reset을 모르는 cut은 5시간(LIMIT_WINDOW_MS) 뒤 RESUME, 그 전엔 HOLD · LIMIT 그대로", () => {
  const cut = run(teamG, "19:00:00", idle(at("18:11:06")))!;
  const past = settleCut(cut, { resetsAt: at("20:00:00"), weekly: false }, at("21:00:00"));
  assert.equal(past.code, "RESUME");
  assert.equal(past.resetsAt, T("20:00:00.000"));
  // reset을 모름: cut(18:10:48) + 5시간 = 23:10:48
  assert.equal(LIMIT_WINDOW_MS, 5 * 3_600_000);
  assert.equal(settleCut(cut, null, at("23:10:47")), cut);
  const late = settleCut(cut, null, at("23:30:00"));
  assert.equal(late.code, "RESUME");
  assert.equal(late.level, "alert");
  assert.equal(late.holds, false);
  assert.equal(late.resetsAt, "2026-09-28T23:10:48.000Z");
  assert.equal(late.cutAt, cut.cutAt);
  assert.match(late.detail, /reset 시각을 몰라/);
  assert.equal(healthLabel(late, at("23:30:00")), "RESUME 필요"); // 같은 RESUME 카드·경보 경로
  // FUEL이 진짜 reset을 알면 그쪽이 이긴다(5시간보다 늦은 reset이면 아직 HOLD)
  assert.equal(settleCut(cut, { resetsAt: at("23:59:00"), weekly: false }, at("23:30:00")).code, "LIMIT");
  // cut이 아닌 LIMIT은 settleCut이 건드리지 않는다
  const plain = run(teamH, "07:38:00")!;
  assert.equal(settleCut(plain, null, at("23:30:00")), plain);
});

test("ATC-167: reset을 모르는 오류 LIMIT은 5시간 뒤 풀린다(영원히 LIMIT이 아니다). reset을 알면 전처럼", () => {
  const noReset = [prompt("07:00:00"), apiError("07:00:05", "rate_limit", "You've hit your usage limit")];
  const early = run(noReset, "11:59:00", idle(at("07:00:05")))!;
  assert.equal(early.code, "LIMIT");
  assert.equal(early.resetsAt, undefined);
  assert.equal(run(noReset, "12:00:05", idle(at("07:00:05"))), null); // 07:00:05 + 5h
  // reset이 있고 지났으면 UNANSWERED 그대로
  assert.equal(run(teamH, "07:40:30")!.code, "UNANSWERED");
  // push LIMIT(StopFailure)도 reset이 없으면 5시간 뒤 pull로 돌아간다. reset 문구가 있으면 그대로 LIMIT
  const push = (line: string): PushRecord => ({ t: T("07:00:06"), event: "StopFailure", code: "LIMIT", line });
  const facts = factsOf(noReset.slice(0, 1).join("\n"));
  assert.equal(mergeHealth(push("You've hit your usage limit"), null, facts, at("11:59:00"))!.code, "LIMIT");
  assert.equal(mergeHealth(push("You've hit your usage limit"), null, facts, at("12:01:00")), null);
  assert.equal(mergeHealth(push("You've hit your session limit · resets 11:10pm (UTC)"), null, facts, at("12:01:00"))!.code, "LIMIT");
});

test("RESUME: 새 지시가 오면 풀린다(대화 기록의 다음 사람 지시와 release 줄). 하루 지난 cut은 날짜와 함께", () => {
  const resumed = [...teamG, nextDay("01:33:25", "ATC-72 계속"), limitNote("01:33:25", "release", "2026-09-29"), reply("01:33:34")];
  assert.equal(run(resumed, "01:40:00", idle(at("01:33:34").valueOf())), null);
  const g = settleCut(run(teamG, "19:00:00", idle(at("18:11:06")))!, { resetsAt: at("23:10:00"), weekly: false }, Date.parse("2026-09-29T19:00:00Z"));
  assert.equal(g.code, "RESUME");
  assert.match(g.detail, /cut 09-28 18:10Z/);
});

test("mergeHealth: cut LIMIT·RESUME은 대화 기록이 따라오기 전이라도 hook의 UserPromptSubmit·PostToolUse로 풀리고, Stop은 지우지 않는다. quota_auto_resume_fired는 RESUME만 푼다", () => {
  const facts = factsOf(teamG.join("\n"));
  const cut = run(teamG, "19:00:00", idle(at("18:11:06")))!;
  const resume = settleCut(cut, { resetsAt: at("23:10:00"), weekly: false }, Date.parse("2026-09-29T01:30:00Z"));
  const push = (event: string, t: string): PushRecord => ({ t: `2026-09-29T${t}Z`, event });
  assert.equal(mergeHealth({ t: T("18:11:07"), event: "Stop" }, cut, facts), cut); // 잘린 턴의 Stop
  for (const e of ["UserPromptSubmit", "PostToolUse"]) {
    assert.equal(mergeHealth(push(e, "01:33:25.000"), cut, facts), null, e);
    assert.equal(mergeHealth(push(e, "01:33:25.000"), resume, facts), null, e);
  }
  assert.equal(mergeHealth(push("quota_auto_resume_fired", "01:33:25.000"), resume, facts), null);
  assert.equal(mergeHealth(push("quota_auto_resume_fired", "01:33:25.000"), cut, facts), cut); // cut LIMIT(reset 전)은 fired로 풀지 않는다
  assert.equal(mergeHealth(push("quota_auto_resume_stale", "01:33:25.000"), resume, facts), resume);
  // 잘린 시각보다 앞선 push는 상관없다
  assert.equal(mergeHealth({ t: T("18:00:00"), event: "PostToolUse" }, cut, factsOf([prompt("14:00:00"), reply("17:00:00"), limitNote("18:10:48")].join("\n"))), cut);
});

test("STALLED: In Progress FLIGHT를 쥐고 idle로 60분 넘게, 열린 PR이 없을 때만. busy·PR 있음·FLIGHT 없음은 아니다", () => {
  const f = (key: string, hasPr = false) => ({ key, hasPr });
  const ok = stalledOf({ status: "idle", lastActiveAt: at("10:00:00"), flights: [f("ATC-77")] }, at("11:05:00"))!;
  assert.equal(ok.code, "STALLED");
  assert.equal(ok.level, "info");
  assert.equal(ok.holds, false);
  assert.equal(ok.since, T("10:00:00.000"));
  assert.match(ok.detail, /ATC-77 In Progress/);
  assert.equal(healthLabel(ok, at("11:05:00")), "STALLED 1h05m");
  assert.match(ok.next, /계속/);
  assert.equal(stalledOf({ status: "idle", lastActiveAt: at("10:00:00"), flights: [f("ATC-77")] }, at("10:59:00")), null); // 60분 전
  assert.equal(stalledOf({ status: "busy", lastActiveAt: at("10:00:00"), flights: [f("ATC-77")] }, at("12:00:00")), null);
  assert.equal(stalledOf({ status: "idle", lastActiveAt: at("10:00:00"), flights: [f("ATC-77", true)] }, at("12:00:00")), null);
  assert.equal(stalledOf({ status: "idle", lastActiveAt: at("10:00:00"), flights: [] }, at("12:00:00")), null);
  assert.equal(stalledOf({ status: "idle", lastActiveAt: null, flights: [f("ATC-77")] }, at("12:00:00")), null);
  // FLIGHT가 둘이고 하나만 PR이 있으면 PR 없는 쪽으로
  assert.match(stalledOf({ status: "idle", lastActiveAt: at("10:00:00"), flights: [f("A-1", true), f("A-2")] }, at("12:00:00"))!.detail, /A-2 In Progress/);
  // stalledMin은 설정으로
  assert.equal(stalledOf({ status: "idle", lastActiveAt: at("10:00:00"), flights: [f("A-1")] }, at("10:20:00"), { ...DEFAULT_HEALTH, stalledMin: 15 })?.code, "STALLED");
});

test("healthAlerts: RESUME은 ALERT로 SUPERVISOR의 \"계속\"을 말하고, cut LIMIT은 cut 시각이 붙고, STALLED(info)는 경보가 아니다", () => {
  const cut = run(teamG, "19:00:00", idle(at("18:11:06")))!;
  const resume = settleCut(cut, { resetsAt: at("23:10:00"), weekly: false }, at("23:30:00"));
  const stalled = stalledOf({ status: "idle", lastActiveAt: at("10:00:00"), flights: [{ key: "ATC-77", hasPr: false }] }, at("12:00:00"))!;
  const a = healthAlerts([{ sessionId: "g", name: "TEAM_G", health: resume }, { sessionId: "h", name: "TEAM_H", health: stalled }], at("23:30:00"));
  assert.equal(a.length, 1);
  assert.equal(a[0]!.code, "RESUME");
  assert.match(a[0]!.message, /^RESUME — TEAM_G: 한도가 풀렸다\(reset 23:10Z\)/);
  assert.match(a[0]!.message, /"계속"을 보낸다/);
  const c = healthAlerts([{ sessionId: "g", name: "TEAM_G", health: cut }], at("19:00:00"));
  assert.match(c[0]!.message, /TEAM_G\(cut 18:10Z\) 사용 한도/);
});
