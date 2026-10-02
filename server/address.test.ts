import assert from "node:assert/strict";
import { test } from "node:test";
import { type AddressSession, causeOf, looksLikeTitle, resolveRecipient, standHolderOf } from "./address.ts";
import { sendAddressOf } from "./proposals.ts";
import { relayBriefOf, type Relay } from "./relay.ts";

const s = (o: Partial<AddressSession> & Pick<AddressSession, "id" | "name">): AddressSession => ({ status: "idle", ...o });

test("제목은 받는 이로 거절한다(PR·FLIGHT 제목, 이슈 키), 세션 이름·REGISTRATION은 받는다", () => {
  for (const t of ["Address FLIGHT PLANs by live session id", "PR #397 import cycles", "ATC-353", "fix(relay): x", ""]) assert.equal(looksLikeTitle(t), true, t);
  for (const n of ["TEAM_A", "OCC", "TOWER", "ALPHA"]) assert.equal(looksLikeTitle(n), false, n);
  const r = resolveRecipient([s({ id: "1", name: "TEAM_A" })], { name: "ATC-353 address by id" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.cause, "bad-recipient");
  // 제목과 같은 이름의 세션이 있어도 이름 자리의 제목은 받지 않는다
  assert.equal(resolveRecipient([s({ id: "2", name: "Fix the thing" })], { name: "Fix the thing" }).ok, false);
});

test("이름이 바뀐 세션도 저장한 id로 찾는다(그리고 job id·REGISTRATION으로도)", () => {
  const sessions = [s({ id: "sid-1", name: "TEAM_A-renamed", jobId: "job1", account: "acct-2" }), s({ id: "sid-2", name: "TEAM_B" })];
  const byId = resolveRecipient(sessions, { sessionId: "sid-1", name: "TEAM_A" });
  assert.ok(byId.ok && byId.session.name === "TEAM_A-renamed" && byId.via === "id");
  const byJob = resolveRecipient(sessions, { jobId: "job1" });
  assert.ok(byJob.ok && byJob.session.id === "sid-1" && byJob.via === "job");
  const byReg = resolveRecipient([s({ id: "x", name: "TEAM_B" })], { registration: "TEAM_B" });
  assert.ok(byReg.ok && byReg.via === "registration");
  // 죽은 세션은 찾지 않는다
  assert.equal(resolveRecipient([s({ id: "sid-1", name: "TEAM_A", status: "dead" })], { sessionId: "sid-1" }).ok, false);
});

test("같은 REGISTRATION의 세션이 둘이면 가장 최근에 움직인 쪽", () => {
  const r = resolveRecipient([s({ id: "old", name: "TEAM_A", lastActiveAt: "2026-10-02T01:00:00Z" }), s({ id: "new", name: "TEAM_A", lastActiveAt: "2026-10-02T02:00:00Z" })], { registration: "TEAM_A" });
  assert.ok(r.ok && r.session.id === "new");
});

test("STAND를 쥔 살아 있는 세션", () => {
  const sessions = [s({ id: "a", name: "TEAM_A", workspacePath: "/w/atc-1" }), s({ id: "t", name: "TOWER", workspacePath: "/main" })];
  assert.equal(standHolderOf(sessions, "/w/atc-1")?.id, "a");
  assert.equal(standHolderOf(sessions, "/w/none"), null);
  assert.equal(standHolderOf(sessions, null), null);
});

test("세션이 없는 AIRCRAFT는 absent(cause)로 거절한다", () => {
  const r = resolveRecipient([s({ id: "1", name: "TEAM_B" })], { registration: "TEAM_A" });
  assert.ok(!r.ok && r.cause === "absent");
});

test("causeOf: 사유 글을 원인으로, 명시한 원인이 먼저", () => {
  assert.equal(causeOf("no live session by that name"), "absent");
  assert.equal(causeOf("cross-ACCOUNT (a → b): TOWER cannot reach it (ATC-251)"), "cross-account");
  assert.equal(causeOf("TOWER is not running"), "tower-down");
  assert.equal(causeOf("ENOENT"), "stale-address");
  assert.equal(causeOf("something odd"), "other");
  assert.equal(causeOf("no live session", "cross-account"), "cross-account");
  assert.equal(causeOf("no live session", "bogus"), "absent");
});

test("FLIGHT PLAN 보낼 때 주소: 만들 때의 이름이 아니라 지금 살아 있는 세션(id·job id·ACCOUNT를 덧붙임)", () => {
  const sessions = [s({ id: "sid-9", name: "TEAM_A", jobId: "job9", account: "acct-3" })];
  const a = sendAddressOf({ registration: "TEAM_A", aircraftName: "TEAM_A-old" }, { sessions: sessions as never });
  assert.deepEqual(a, { sendTo: "TEAM_A", sendToId: "sid-9", sendToJobId: "job9", sendToAccount: "acct-3" });
  // 못 찾으면 옛 이름 그대로, 추가 필드 없음
  assert.deepEqual(sendAddressOf({ registration: "TEAM_Z", aircraftName: "TEAM_Z" }, { sessions: [] }), { sendTo: "TEAM_Z" });
});

test("RELAY brief: 만들 때 저장한 세션 id로 이름이 바뀌어도 보낼 세션을 준다", () => {
  const relay = { id: "R-0001", to: "TEAM_A", kind: "info", text: "hi", flight: null, pr: null, status: "queued", statusAt: "2026-10-02T10:00:00Z", at: "2026-10-02T10:00:00Z", clearance: null, reason: null, answer: null, toSessionId: "sid-1" } as Relay;
  const [b] = relayBriefOf([relay], Date.parse("2026-10-02T10:05:00Z"), [s({ id: "sid-1", name: "TEAM_A-renamed", jobId: "j", account: "acct-2" })] as never);
  assert.equal(b!.sendTo, "TEAM_A-renamed");
  assert.equal(b!.sendToId, "sid-1");
  assert.equal(b!.text, "hi"); // 글은 그대로
  const [plain] = relayBriefOf([relay], Date.parse("2026-10-02T10:05:00Z"));
  assert.equal("sendTo" in plain!, false);
});
