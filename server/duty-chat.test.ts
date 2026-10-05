import assert from "node:assert/strict";
import { test } from "node:test";
import { chatFromHistory, emptyChat, foldDuty, headLine, itemOfLine, olderItems, readoutState, type DutyStatusView, type DutyWire } from "./duty-chat.ts";

const STATUS: DutyStatusView = { enabled: true, state: "idle", error: null, account: "acct-2", sessionId: "abcd1234", model: null, context: 12_345, cap: 250_000, costUsd: null, rates: [], queued: 0, blocked: false };
const t = "2026-09-30T00:00:00.000Z";
const fold = (es: DutyWire[]) => es.reduce(foldDuty, foldDuty(emptyChat(), { type: "status", ...STATUS }));

test("스트리밍: 조각은 이어 붙이고, 완성된 글이 오면 조각을 지우고 한 덩어리로", () => {
  let c = fold([{ type: "user", text: "hi", t }, { type: "state", state: "thinking", queued: 0, t }, { type: "text", text: "안", final: false, t }, { type: "text", text: "녕", final: false, t }]);
  assert.equal(c.streaming, "안녕");
  assert.equal(c.status!.state, "thinking");
  c = foldDuty(c, { type: "text", text: "안녕하세요", final: true, t });
  assert.equal(c.streaming, "");
  assert.deepEqual(c.items.map((i) => [i.kind, "text" in i ? i.text : ""]), [["user", "hi"], ["text", "안녕하세요"]]);
  c = foldDuty(c, { type: "state", state: "idle", queued: 0, t });
  assert.equal(c.status!.state, "idle");
});

test("도구 줄·알림·NEW SHIFT 줄이 순서대로 쌓이고, 사용량은 헤더 숫자만 바꾼다", () => {
  const c = fold([
    { type: "tool", name: "Bash", summary: "atcctl duty brief", error: false, t },
    { type: "tool", name: "Bash", summary: "blocked", error: true, t },
    { type: "notice", text: "limit", t },
    { type: "usage", turn: { context: 20_000, costUsd: 0.5 }, rates: [{ window: "five_hour", utilization: 0.2, resetsAt: 1 }], t },
    { type: "shift", t },
  ]);
  assert.deepEqual(c.items.map((i) => i.kind), ["tool", "tool", "notice", "shift"]);
  assert.equal(c.status!.context, 20_000);
  assert.equal(c.status!.costUsd, 0.5);
  assert.equal(c.status!.rates.length, 1);
});

test("state 이벤트는 대기 수·막힘·오류를 옮기고, 상태를 모르는 채로는 아무것도 하지 않는다", () => {
  const c = fold([{ type: "state", state: "down", error: "boom", queued: 0, blocked: true, t }]);
  assert.deepEqual([c.status!.state, c.status!.error, c.status!.blocked], ["down", "boom", true]);
  assert.equal(readoutState(c.status!), "down");
  assert.equal(foldDuty(emptyChat(), { type: "state", state: "idle", t }).status, null);
});

test("기록으로 목록을 새로 만든다(사용량 줄은 그리지 않는다)", () => {
  const c = chatFromHistory([
    { t, kind: "shift", n: 0 },
    { t, kind: "user", text: "q", image: "a.png", n: 1 },
    { t, kind: "text", text: "a", n: 2 },
    { t, kind: "usage", turn: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, context: 2, costUsd: 0, turns: 1, ms: 1, interrupted: false }, n: 3 },
  ], STATUS);
  assert.deepEqual(c.items.map((i) => i.kind), ["shift", "user", "text"]);
  assert.equal(c.status, STATUS);
});

test("머리줄: DUTY · acct-2 · context 12/250k", () => {
  assert.equal(headLine(STATUS), "DUTY · acct-2 · context 12/250k");
  assert.equal(headLine({ ...STATUS, context: null }), "DUTY · acct-2 · context —/250k");
});

test("itemOfLine·olderItems: 줄 번호 n을 항목에 싣고, 앞쪽 쪽의 id는 h<n>으로 안 바뀐다(ATC-479)", () => {
  const lines = [
    { t, kind: "user" as const, text: "a", n: 7 },
    { t, kind: "usage" as const, turn: { context: 1, costUsd: null }, n: 8 },
    { t, kind: "text" as const, text: "b", n: 9 },
    { t, kind: "account" as const, from: "acct-1", to: "acct-2", by: "SUPERVISOR", n: 10 },
  ];
  const older = olderItems(lines as never);
  assert.deepEqual(older.map((i) => [i.id, i.kind, i.n]), [["h7", "user", 7], ["h9", "text", 9], ["h10", "notice", 10]], "사용량 줄은 그리지 않고 id는 줄 번호에서 딴다");
  assert.equal(itemOfLine({ t, kind: "usage", turn: { context: 1, costUsd: null } } as never), null);
  assert.equal("n" in itemOfLine({ t, kind: "shift" })!, false, "줄 번호가 없으면 n도 없다(SSE로 막 들어온 줄과 같다)");
  const c = chatFromHistory(lines as never, null, 5);
  assert.equal(c.older, 5);
  assert.deepEqual(c.items.map((i) => i.n), [7, 9, 10]);
});
