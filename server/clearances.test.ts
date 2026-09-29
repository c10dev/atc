import assert from "node:assert/strict";
import { test } from "node:test";
import { type ClearanceOp, clearanceAnswerError, fold, isClearanceOverdue, isPending } from "./clearances.ts";

const T0 = Date.parse("2026-09-29T04:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const issue = (id: string, type: "HOLD" | "INFO" | "LAND" = "HOLD"): ClearanceOp => ({
  op: "issue", id, at: iso(0), to: "s-b", toName: "TEAM_B", type, stand: null, flight: "ATC-7", text: "t",
});
const one = (ops: ClearanceOp[]) => fold(ops)[0];
const OVERDUE = 10 * 60_000;

test("fold: READBACK·ROGER는 readbackAt과 무엇으로 닫혔는지, UNABLE은 사유와 함께 닫힌다", () => {
  const rb = one([issue("C-0001"), { op: "readback", id: "C-0001", at: iso(1) }]);
  assert.equal(rb.readbackAt, iso(1));
  assert.equal(rb.ackWord, "READBACK");
  const roger = one([issue("C-0002", "INFO"), { op: "roger", id: "C-0002", at: iso(2) }]);
  assert.equal(roger.readbackAt, iso(2));
  assert.equal(roger.ackWord, "ROGER");
  const unable = one([issue("C-0003"), { op: "unable", id: "C-0003", at: iso(3), reason: "PR이 아직 CI 중" }]);
  assert.equal(unable.unableAt, iso(3));
  assert.equal(unable.unableReason, "PR이 아직 CI 중");
  assert.equal(unable.readbackAt, null);
  for (const c of [rb, roger, unable]) assert.equal(isPending(c), false);
});

test("fold: 먼저 온 닫힘만 남는다. 취소는 전처럼 READBACK 뒤에도 된다", () => {
  const c = one([issue("C-0001"), { op: "unable", id: "C-0001", at: iso(1), reason: "r" }, { op: "readback", id: "C-0001", at: iso(2) }]);
  assert.equal(c.readbackAt, null);
  assert.equal(c.unableAt, iso(1));
  const land = one([issue("C-0002", "LAND"), { op: "readback", id: "C-0002", at: iso(1) }, { op: "cancel", id: "C-0002", at: iso(5) }]);
  assert.equal(land.readbackAt, iso(1));
  assert.equal(land.cancelledAt, iso(5));
});

test("STANDBY: 첫 STANDBY부터 overdue 10분을 한 번 다시 세고, 두 번째는 세기만 한다", () => {
  const ops: ClearanceOp[] = [issue("C-0001"), { op: "standby", id: "C-0001", at: iso(8) }];
  const once = one(ops);
  assert.equal(once.standbyAt, iso(8));
  assert.equal(once.standbys, 1);
  assert.equal(isPending(once), true);
  // STANDBY가 없었으면 11분에 overdue, STANDBY 뒤에는 18분이 지나야
  assert.equal(isClearanceOverdue(one([issue("C-0001")]), T0 + 11 * 60_000, OVERDUE), true);
  assert.equal(isClearanceOverdue(once, T0 + 11 * 60_000, OVERDUE), false);
  assert.equal(isClearanceOverdue(once, T0 + 19 * 60_000, OVERDUE), true);
  const twice = one([...ops, { op: "standby", id: "C-0001", at: iso(17) }]);
  assert.equal(twice.standbyAt, iso(8));
  assert.equal(twice.standbys, 2);
  assert.equal(isClearanceOverdue(twice, T0 + 19 * 60_000, OVERDUE), true);
  // 닫힌 뒤의 STANDBY는 무시한다
  const closed = one([issue("C-0002"), { op: "readback", id: "C-0002", at: iso(1) }, { op: "standby", id: "C-0002", at: iso(2) }]);
  assert.equal(closed.standbyAt, undefined);
});

test("clearanceAnswerError: 그 CLEARANCE의 응답 속성과 닫힘을 본다", () => {
  const hold = one([issue("C-0001", "HOLD")]);
  const info = one([issue("C-0002", "INFO")]);
  assert.equal(clearanceAnswerError(hold, "readback"), null);
  assert.equal(clearanceAnswerError(hold, "unable"), null);
  assert.equal(clearanceAnswerError(hold, "standby"), null);
  assert.match(clearanceAnswerError(hold, "roger")!, /ROGER는 R 메시지/);
  assert.equal(clearanceAnswerError(info, "roger"), null);
  assert.equal(clearanceAnswerError(info, "readback"), null);
  assert.match(clearanceAnswerError(info, "standby")!, /STANDBY는 W\/U/);
  // 이미 READBACK·ROGER로 닫힌 것에 다시 온 READBACK·ROGER는 받는다(전과 같다). 다른 답은 이미 닫혔다고 거절
  const rb = one([issue("C-0003"), { op: "readback", id: "C-0003", at: iso(1) }]);
  assert.equal(clearanceAnswerError(rb, "readback"), null);
  assert.match(clearanceAnswerError(rb, "unable")!, /이미 READBACK으로 닫힘/);
  const rg = one([issue("C-0005", "INFO"), { op: "roger", id: "C-0005", at: iso(1) }]);
  assert.equal(clearanceAnswerError(rg, "readback"), null);
  assert.equal(clearanceAnswerError(rg, "roger"), null);
  assert.match(clearanceAnswerError(rg, "unable")!, /이미 ROGER로 닫힘/);
  const un = one([issue("C-0004"), { op: "unable", id: "C-0004", at: iso(1), reason: "r" }]);
  assert.match(clearanceAnswerError(un, "readback")!, /이미 UNABLE로 닫힘/);
  // 취소는 언제든
  assert.equal(clearanceAnswerError(un, "cancel"), null);
});
