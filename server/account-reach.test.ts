import assert from "node:assert/strict";
import { test } from "node:test";
import { launchSplitWarning, unreachableAircraft, unreachableAircraftWarning, unreachableWhy } from "./account-reach.ts";
import type { Session } from "./model.ts";
import { crossAccountWhyOf, fold, type Op, waitingOf } from "./proposals.ts";

// ATC-251: SendMessage는 같은 ACCOUNT에만 닿는다. 보내기 전에 예측하고 이유를 말한다
const session = (name: string, account?: string, status: Session["status"] = "idle"): Session => ({ id: name, agent: "claude", name, status, ...(account ? { account } : {}) }) as unknown as Session;
const create = { op: "create", id: "D-0001", at: "2026-10-01T06:00:00.000Z", kind: "ASSIGN", flight: "ATC-9", aircraft: "sid", aircraftName: "TEAM_H", airport: "ATCC", score: 9, factors: [] } as Op;
const approved: Op[] = [create, { op: "approve", id: "D-0001", at: "2026-10-01T06:01:00.000Z" }];

test("unreachableWhy: 둘 다 알고 다를 때만 사유, 모르거나 같으면 null", () => {
  assert.match(unreachableWhy({ fromName: "OCC", from: "acct-3", toName: "TEAM_H", to: "acct-1" })!, /TEAM_H는 ACCOUNT acct-1에 있고 OCC는 acct-3에 있어/);
  assert.equal(unreachableWhy({ fromName: "OCC", from: "acct-1", toName: "TEAM_H", to: "acct-1" }), null);
  assert.equal(unreachableWhy({ fromName: "OCC", from: null, toName: "TEAM_H", to: "acct-1" }), null);
  assert.equal(unreachableWhy({ fromName: "OCC", from: "acct-1", toName: "TEAM_H", to: undefined }), null);
});

test("launchSplitWarning: AIRCRAFT acct-1 / 관제 acct-3이면 경고, 같거나 한쪽이 각 home이면 없다", () => {
  assert.match(launchSplitWarning({ aircraft: "acct-1", control: "acct-3" })!, /AIRCRAFT acct-1, 관제 세션 acct-3/);
  assert.equal(launchSplitWarning({ aircraft: "acct-1", control: "acct-1" }), null);
  assert.equal(launchSplitWarning({ aircraft: "acct-1", control: null }), null);
  assert.equal(launchSplitWarning({}), null);
});

test("unreachableAircraft: OCC와 다른 ACCOUNT의 AIRCRAFT만, 이름순", () => {
  const rows = unreachableAircraft("acct-3", [{ name: "TEAM_B", account: "acct-1" }, { name: "TEAM_A", account: "acct-1" }, { name: "TEAM_C", account: "acct-3" }, { name: "TEAM_D", account: null }]);
  assert.deepEqual(rows.map((r) => r.name), ["TEAM_A", "TEAM_B"]);
  assert.equal(unreachableAircraft(null, [{ name: "TEAM_A", account: "acct-1" }]).length, 0);
  assert.match(unreachableAircraftWarning("acct-3", rows)!, /TEAM_A\(acct-1\), TEAM_B\(acct-1\)/);
  assert.equal(unreachableAircraftWarning("acct-3", []), null);
});

test("crossAccountWhyOf: release 거절 — OCC(acct-3)와 TEAM_H(acct-1)는 닿지 않는다, 같은 ACCOUNT·모름·죽은 OCC·launch 카드는 통과", () => {
  const [p] = fold(approved);
  assert.match(crossAccountWhyOf(p!, { sessions: [session("OCC", "acct-3"), session("TEAM_H", "acct-1")] })!, /TEAM_H는 ACCOUNT acct-1에 있고 OCC는 acct-3에 있어/);
  assert.equal(crossAccountWhyOf(p!, { sessions: [session("OCC", "acct-1"), session("TEAM_H", "acct-1")] }), null);
  assert.equal(crossAccountWhyOf(p!, { sessions: [session("OCC"), session("TEAM_H", "acct-1")] }), null);
  assert.equal(crossAccountWhyOf(p!, { sessions: [session("OCC", "acct-3", "dead"), session("TEAM_H", "acct-1")] }), null);
  assert.equal(crossAccountWhyOf({ ...p!, launch: true }, { sessions: [session("OCC", "acct-3"), session("TEAM_H", "acct-1")] }), null);
});

test("waitingOf: ACCOUNT가 다르면 DISPATCH 카드에 ACCOUNT 불일치 글이 뜬다. sessions를 안 주면 전과 같다", () => {
  const props = fold(approved);
  const sessions = { sessions: [session("OCC", "acct-3"), session("TEAM_H", "acct-1")] };
  assert.match(waitingOf(props, { aircraft: [] }, undefined, sessions)["D-0001"]!, /^ACCOUNT 불일치 — TEAM_H는 ACCOUNT acct-1/);
  assert.deepEqual(waitingOf(props, { aircraft: [] }), {});
});
