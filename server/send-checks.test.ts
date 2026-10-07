import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { contentHashOf, sealWorkOrder } from "./input-binding.ts";
import { type CheckedSend, checkServerSend, isChecked, READBACK_OVERDUE_MS, serverRepeatWhy } from "./send-checks.ts";
import { deliverChecked } from "./session-socket.ts";

// ATC-562: 서버의 발송 검사. 같은 resolveSend(send-guard와 같은 함수)에 두 번 보내지 않음을 더하고, 통과하면 CheckedSend 하나를 만든다
const NOW = Date.parse("2026-10-07T10:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const TEXT = sealWorkOrder('[DISPATCH D-0101] FLIGHT PLAN @WOHASH · BRAVO (TEAM_B)\nFLIGHT ATC-1 · AIRPORT ATCC · PRIORITY High\nwork\n— Reply to this message with "READBACK D-0101 @WOHASH" if you take it, exactly like that.').text;
const proposal = (over: Record<string, unknown> = {}) => ({ id: "D-0101", status: "sent", aircraftName: "TEAM_B", message: TEXT, sentVia: "server", sentAt: iso(0), ...over });
const session = { id: "sess-b", name: "TEAM_B" };
const input = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({ proposal: proposal(p), mode: "approval", session, purpose: "first" as const, prior: [], now: NOW, ...over });

test("통과하면 저장된 글 그대로, 해시·세션 id·목적이 든 CheckedSend 하나를 만든다(이 모듈만 만든다)", async () => {
  const r = await checkServerSend(input());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([r.send.id, r.send.sessionId, r.send.to, r.send.text, r.send.textHash, r.send.purpose], ["D-0101", "sess-b", "TEAM_B", TEXT, contentHashOf(TEXT), "first"]);
  assert.equal(isChecked(r.send), true);
  assert.equal(Object.isFrozen(r.send), true);
  // 같은 모양으로 만든 객체는 검사를 거친 것이 아니다
  assert.equal(isChecked({ ...r.send }), false);
});

test("두 번 보내지 않음: 이번 차례에 이미 나간 발송이 있으면 first·retry를 막는다. 옛 차례(undelivered 전)의 발송은 보지 않는다", async () => {
  const prior = [{ at: iso(0), sessionId: "sess-b", purpose: "first" as const }];
  const r = await checkServerSend(input({ prior }));
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : "", /서버가 이미 보냄/);
  const old = [{ at: iso(30), sessionId: "sess-b", purpose: "first" as const }];
  assert.equal((await checkServerSend(input({ prior: old }))).ok, true);
});

test("서버가 적은 send가 아니면(그 사이 OCC가 보냄) 서버는 쓰지 않는다", async () => {
  const r = await checkServerSend(input({}, { sentVia: undefined }));
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : "", /sentVia server\)이 아님\(OCC\)/);
});

test("재송신(resend): overdue 전·이미 한 번·SUPERVISOR 대기·READBACK 뒤(accepted)는 막고, overdue가 지나면 한 번", async () => {
  const sentAt = iso(11);
  const first = [{ at: sentAt, sessionId: "sess-b", purpose: "first" as const }];
  const resend = (p: Record<string, unknown>, prior = first, now = NOW) => checkServerSend({ ...input({ purpose: "resend", prior, now }), proposal: proposal({ sentAt, ...p }) });
  assert.equal((await resend({})).ok, true);
  assert.match(serverRepeatWhy({ proposal: proposal({ sentAt }), purpose: "resend", prior: first, now: Date.parse(sentAt) + READBACK_OVERDUE_MS - 1 }) ?? "", /overdue 전/);
  assert.match(serverRepeatWhy({ proposal: proposal({ sentAt, standbyAt: iso(5) }), purpose: "resend", prior: first, now: NOW }) ?? "", /overdue 전/); // 첫 STANDBY부터 다시 센다
  assert.match(serverRepeatWhy({ proposal: proposal({ sentAt }), purpose: "resend", prior: [...first, { at: iso(1), sessionId: "sess-b", purpose: "resend" }], now: NOW }) ?? "", /이미 한 번 다시 보냄/);
  assert.match(serverRepeatWhy({ proposal: proposal({ sentAt, awaitSupervisor: { at: iso(2), reason: "x" } }), purpose: "resend", prior: first, now: NOW }) ?? "", /SUPERVISOR를 기다림/);
  const answered = await resend({ status: "accepted" });
  assert.equal(answered.ok, false);
  assert.match(!answered.ok ? answered.reason : "", /보낼 상태가 아님\(accepted\)/);
  assert.match(serverRepeatWhy({ proposal: proposal({ sentAt }), purpose: "resend", prior: [], now: NOW }) ?? "", /보낸 기록이 없음/);
});

test("검사를 건너뛴 객체는 쓰지 않는다: 형 변환으로 만든 CheckedSend도 deliverChecked가 거절한다", async () => {
  const fake = { kind: "flight-plan", id: "D-0101", sessionId: "sess-b", to: "TEAM_B", text: TEXT, textHash: contentHashOf(TEXT), purpose: "first", checkedAt: iso(0) } as unknown as CheckedSend;
  const r = await deliverChecked(fake, { configDirs: [], connect: () => assert.fail("소켓을 열면 안 된다") });
  assert.deepEqual(r, { ok: false, stage: "unchecked", why: "send-checks가 만든 발송이 아님 — 쓰지 않는다", cause: "other" });
});

// ── 컴파일 증명(tsc가 이 파일을 본다): 검사를 건너뛴 길은 타입 검사를 통과하지 못한다 ──
// 부르지 않는 함수다(Node는 타입을 지우고 돌리므로 실제로 부르면 위의 런타임 거절이 막는다).
// 아래 줄에서 타입 오류가 사라지면(누가 CheckedSend의 brand를 없애거나 deliverChecked가 맨 글·받는 이를 받게 하면) "@ts-expect-error가 쓰이지 않음"으로 tsc가 실패한다
export function uncheckedPathsDoNotCompile() {
  const deps = { configDirs: [] as string[] };
  // @ts-expect-error 맨 글과 받는 이는 받지 않는다
  void deliverChecked("[DISPATCH D-0101] …", deps);
  // @ts-expect-error 같은 칸을 가진 객체 글자도 CheckedSend가 아니다(brand가 없다)
  void deliverChecked({ kind: "flight-plan", id: "D-0101", sessionId: "s", to: "TEAM_B", text: TEXT, textHash: "h", purpose: "first", checkedAt: "t" }, deps);
  const plain: { kind: "flight-plan"; id: string; sessionId: string; to: string; text: string; textHash: string; purpose: "first"; checkedAt: string } = { kind: "flight-plan", id: "D-0101", sessionId: "s", to: "TEAM_B", text: TEXT, textHash: "h", purpose: "first", checkedAt: "t" };
  // @ts-expect-error 검사 결과가 아닌 값은 넘길 수 없다
  void deliverChecked(plain, deps);
}
