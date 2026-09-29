import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeFuel, parseFuelLines } from "./fuel.ts";
import { sessionLeaks } from "./fuel-leaks.ts";
import { factsOf, healthOf } from "./health.ts";

// SQUELCH S0(docs/squelch.md "S0 as probed")가 남긴 차단된 tick의 줄 모양. 세션 폴더의 대화 기록에서 키 구조만 따왔고
// 경로·id·시각은 시험용 값이다. 차단된 tick은 user·assistant 줄이 없이 이 네 줄만 남긴다:
// queue-operation ×2, system scheduled_task_fire, system informational("UserPromptSubmit operation blocked by hook").
const S = "11111111-1111-4111-8111-111111111111";
const T = (min: number) => new Date(Date.parse("2026-09-29T03:00:00Z") + min * 60_000).toISOString();
const at = (min: number) => Date.parse(T(min));
const base = { isSidechain: false, userType: "external", entrypoint: "cli", cwd: "/x/control", sessionId: S, version: "2.1.284", gitBranch: "HEAD" };

const blockedTick = (min: number): string[] => [
  JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: T(min), sessionId: S, content: "/tick" }),
  JSON.stringify({ type: "queue-operation", operation: "dequeue", timestamp: T(min), sessionId: S }),
  JSON.stringify({ ...base, type: "system", subtype: "scheduled_task_fire", content: "Running scheduled task (Sep 29 3:03am)", isMeta: false, timestamp: T(min), taskId: "237b4e4a", cron: "*/3 * * * *", prompt: "/tick" }),
  JSON.stringify({ ...base, type: "system", subtype: "informational", content: "UserPromptSubmit operation blocked by hook:\nSQUELCH QUIET since 03:03\n\nOriginal prompt: /tick", isMeta: false, timestamp: T(min), level: "warning", preventContinuation: true }),
];

// 통과한 tick: /tick 사용자 줄, 답, 그리고 usage가 든 요청 줄
const prompt = (min: number) => JSON.stringify({ ...base, type: "user", timestamp: T(min), origin: { kind: "human" }, turnOrigin: {}, message: { role: "user", content: "/tick" } });
const reply = (min: number, id: string, cacheRead: number, write = 3_000) =>
  JSON.stringify({
    ...base,
    type: "assistant",
    timestamp: T(min),
    requestId: `req_${id}`,
    effort: "high",
    message: {
      id: `msg_${id}`,
      model: "claude-sonnet-5-5",
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "..." }],
      usage: { input_tokens: 2, cache_creation_input_tokens: write, cache_read_input_tokens: cacheRead, output_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: write, ephemeral_5m_input_tokens: 0 } },
    },
  });

// 03:00 통과, 03:03~03:45 열네 번 차단, 03:48 하트비트로 통과
const real = [prompt(0), reply(0, "a", 100_000), prompt(48), reply(48, "b", 103_000)];
const blocked = Array.from({ length: 14 }, (_, i) => blockedTick(3 + i * 3)).flat();
const withBlocked = [...real.slice(0, 2), ...blocked, ...real.slice(2)];
const text = (ls: string[]) => `${ls.join("\n")}\n`;

test("health: 차단된 tick 줄은 사실(fact)이 아니다 — 있든 없든 같다", () => {
  assert.deepEqual(factsOf(text(withBlocked)), factsOf(text(real)));
  assert.equal(factsOf(text(blocked)).length, 0);
});

test("health: 차단만 쌓인 세션은 UNANSWERED·HUNG·PENDING이 아니다", () => {
  const only = [...real.slice(0, 2), ...blocked];
  const facts = factsOf(text(only));
  // 쉬는 세션(claude agents는 차단된 tick 동안 idle만 보인다). 마지막 대답 뒤 두 시간이 지나도
  assert.equal(healthOf(facts, { status: "idle", lastWriteAt: at(45) }, at(180)), null);
  // 새 기록이 계속 쓰여도(차단 줄) busy가 아니므로 HUNG은 없다
  assert.equal(healthOf(facts, { status: "idle", lastWriteAt: at(42) }, at(46)), null);
});

test("FUEL: 차단된 tick은 요청이 아니다 — 기록·unknown·synthetic이 그대로", () => {
  const a = parseFuelLines(text(withBlocked));
  const b = parseFuelLines(text(real));
  assert.equal(a.records.length, 2);
  assert.deepEqual(a.records, b.records);
  assert.deepEqual([a.unknown, a.synthetic, a.compactions.length, a.modelCommands.length], [0, 0, 0, 0]);
  assert.equal(parseFuelLines(text(blocked)).records.length, 0);
  assert.equal(parseFuelLines(text(blocked)).unknown, 0);
});

test("FUEL LEAK: 차단 구간이 있어도 하트비트 tick은 1h 안이면 LEAK이 아니고, 요청도 늘지 않는다", () => {
  const rec = [...dedupeFuel(parseFuelLines(text(withBlocked)).records).values()];
  assert.equal(rec.length, 2);
  // 03:00 → 03:48은 1시간 캐시 안(3,000 토큰만 새로 씀)이라 다시 쓴 것이 없다
  assert.deepEqual(sessionLeaks(rec, [], []), []);
  // 1시간을 넘긴 하트비트는 원래대로 coldCache로 읽힌다(차단 줄이 원인이 아니다)
  const cold = [...dedupeFuel(parseFuelLines(text([...real.slice(0, 2), ...blocked, prompt(70), reply(70, "c", 0, 103_000)])).records).values()];
  const [leak] = sessionLeaks(cold, [], []);
  assert.equal(leak?.rule, "coldCache");
});
