import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedPurposeOf, crashedOf, freshRefusal, parseServerSendSwitch, serverSendCountsOf, suspendedOf, twiceOf, wrongOf } from "./server-send.ts";

// ATC-562 SERVER SEND의 순수 판단: 스위치, 첫 발송·재시도, 잘못 보냄·두 번 보냄, 확인 멈춤, 날마다의 수
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const ON = parseServerSendSwitch(null);

test("스위치: 기본 on, 꺼지는 것은 정확히 off뿐(shadow 같은 값은 없다)", () => {
  assert.deepEqual(ON, { first: "on", resend: "on", retry: "on" });
  assert.deepEqual(parseServerSendSwitch({ first: "off", resend: "shadow", retry: 0 }), { first: "off", resend: "on", retry: "on" });
});

test("승인된 카드의 길: first, 재시도는 한 번(1분 뒤), 두 번 닿지 않으면 OCC, LAUNCH 카드·꺼진 스위치는 아님", () => {
  const card = (over = {}) => ({ kind: "ASSIGN", status: "approved", ...over });
  assert.deepEqual(approvedPurposeOf(card(), ON, NOW), { purpose: "first" });
  assert.match((approvedPurposeOf(card(), { ...ON, first: "off" }, NOW) as { skip: string }).skip, /first off/);
  assert.match((approvedPurposeOf(card({ launch: true }), ON, NOW) as { skip: string }).skip, /LAUNCH 카드/);
  assert.match((approvedPurposeOf(card({ undelivered: { at: iso(0.5), n: 1 } }), ON, NOW) as { skip: string }).skip, /재시도 대기/);
  assert.deepEqual(approvedPurposeOf(card({ undelivered: { at: iso(0.5), n: 1 } }), ON, NOW, false), { purpose: "retry" });
  assert.deepEqual(approvedPurposeOf(card({ undelivered: { at: iso(2), n: 1 } }), ON, NOW), { purpose: "retry" });
  assert.match((approvedPurposeOf(card({ undelivered: { at: iso(2), n: 1 } }), { ...ON, retry: "off" }, NOW) as { skip: string }).skip, /retry off/);
  assert.match((approvedPurposeOf(card({ undelivered: { at: iso(2), n: 2 } }), ON, NOW) as { skip: string }).skip, /OCC에게 넘김/);
  assert.match((approvedPurposeOf(card({ status: "sent" }), ON, NOW) as { skip: string }).skip, /승인된 ASSIGN이 아님/);
});

test("잘못 보냄(기대 0): 받은 세션이 CAPTAIN이 아님, 글이 저장된 글과 다름, 보낼 수 없는 상태", () => {
  const ok = { sessionReg: "TEAM_B", proposalReg: "TEAM_B", sentHash: "h", storedHash: "h", status: "sent" };
  assert.deepEqual(wrongOf(ok), []);
  assert.equal(wrongOf({ ...ok, sessionReg: "TEAM_C" }).length, 1);
  assert.equal(wrongOf({ ...ok, sessionReg: null }).length, 1);
  assert.equal(wrongOf({ ...ok, storedHash: "other" }).length, 1);
  assert.equal(wrongOf({ ...ok, status: "superseded" }).length, 1);
  assert.equal(wrongOf({ sessionReg: "X", proposalReg: "Y", sentHash: "a", storedHash: null, status: null }).length, 3);
});

test("두 번 보냄: 같은 세션에 같은 FLIGHT PLAN 두 번 — overdue 뒤의 재송신 한 번은 빼고 센다", () => {
  const d = (min: number, purpose: "first" | "retry" | "resend", sessionId = "s1") => ({ t: iso(min), id: "D-1", sessionId, purpose });
  assert.deepEqual(twiceOf([d(30, "first"), d(15, "resend")]), []);
  assert.equal(twiceOf([d(30, "first"), d(25, "resend")]).length, 1); // overdue 전 재송신
  assert.equal(twiceOf([d(30, "first"), d(29, "first")]).length, 1);
  assert.equal(twiceOf([d(30, "first"), d(15, "resend"), d(1, "resend")]).length, 1); // 두 번째 재송신
  assert.deepEqual(twiceOf([d(30, "first"), d(1, "first", "s2")]), []); // 다른 세션(새로 뜬 세션)
});

test("같은 거절은 다시 적지 않는다, 크래시 흔적, 확인 멈춤과 스위치를 바꾸면 풀림", () => {
  const L = (min: number, op: string, rest: Record<string, unknown> = {}) => ({ t: iso(min), kind: "server-send", op, id: "D-1", ...rest });
  assert.equal(freshRefusal([L(5, "refused", { check: "x" })], "D-1", "x"), false);
  assert.equal(freshRefusal([L(5, "refused", { check: "x" })], "D-1", "y"), true);
  assert.equal(freshRefusal([L(5, "refused", { check: "x" }), L(4, "failed")], "D-1", "x"), true);
  const sent = { id: "D-1", status: "sent", sentVia: "server", timeline: { sent: iso(2) } };
  assert.equal(crashedOf(sent, [], NOW), true);
  assert.equal(crashedOf(sent, [L(1.9, "deliver")], NOW), false);
  assert.equal(crashedOf({ ...sent, timeline: { sent: iso(0.5) } }, [], NOW), false);
  assert.equal(crashedOf({ ...sent, sentVia: undefined }, [], NOW), false);
  const unseen = L(1, "confirm", { msgId: "m", seen: false });
  assert.equal(suspendedOf([L(20, "confirm", { seen: true }), unseen]).suspended, true);
  assert.equal(suspendedOf([unseen, { t: iso(0), kind: "policy", op: "server-send-mode" }]).suspended, false);
  assert.equal(suspendedOf([unseen, L(0, "confirm", { seen: true })]).suspended, false);
});

test("날마다의 수: 보냄·잘못 보냄·두 번 보냄·거절(사유별)·실패·안 보임·넘김. 0도 보인다", () => {
  const L = (min: number, op: string, rest: Record<string, unknown> = {}) => ({ t: iso(min), kind: "server-send", op, id: "D-1", ...rest });
  const c = serverSendCountsOf(
    [
      L(60, "deliver", { sessionId: "s", purpose: "first", wrong: [] }),
      L(59, "deliver", { sessionId: "s", purpose: "first", wrong: ["보낸 글이 저장된 글과 다름"] }),
      L(50, "refused", { check: "a" }),
      L(49, "refused", { check: "a" }),
      L(48, "refused", { check: "b" }),
      L(40, "failed"),
      L(30, "confirm", { seen: false }),
      L(20, "handback"),
      { t: iso(10), kind: "dispatch", op: "send" },
    ],
    NOW,
    7,
  );
  assert.equal(c.days.length, 7);
  assert.deepEqual(c.total, { delivered: 2, wrong: 1, twice: 1, refused: 3, failed: 1, unseen: 1, handback: 1 });
  assert.deepEqual(c.reasons, [{ reason: "a", n: 2 }, { reason: "b", n: 1 }]);
  assert.deepEqual(serverSendCountsOf([], NOW, 7).total, { delivered: 0, wrong: 0, twice: 0, refused: 0, failed: 0, unseen: 0, handback: 0 });
});
