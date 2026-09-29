import assert from "node:assert/strict";
import { test } from "node:test";
import { answerError, closingLine, overdueBase, responseOf } from "./response.ts";

test("responseOf: 따를 지시(LAND·HOLD·CONTINUE)와 FLIGHT PLAN·RECALL·CREW CHANGE는 W/U, 알림(INFO·TRAFFIC·REPORT)은 R", () => {
  for (const t of ["LAND", "HOLD", "CONTINUE"] as const) assert.equal(responseOf("clearance", t), "W/U");
  for (const t of ["INFO", "TRAFFIC", "REPORT"] as const) assert.equal(responseOf("clearance", t), "R");
  assert.equal(responseOf("flight-plan"), "W/U");
  assert.equal(responseOf("recall"), "W/U");
  assert.equal(responseOf("crew-change"), "W/U");
  // 모르는 CLEARANCE 종류는 더 엄한 쪽(W/U)
  assert.equal(responseOf("clearance"), "W/U");
});

test("answerError: READBACK은 늘 받고, ROGER는 R만, STANDBY는 W/U만, RECALL은 READBACK만", () => {
  assert.equal(answerError("clearance", "W/U", "READBACK"), null);
  assert.equal(answerError("clearance", "R", "READBACK"), null);
  assert.equal(answerError("clearance", "R", "ROGER"), null);
  assert.match(answerError("clearance", "W/U", "ROGER")!, /ROGER는 R 메시지/);
  assert.equal(answerError("clearance", "W/U", "UNABLE"), null);
  assert.equal(answerError("clearance", "R", "UNABLE"), null);
  assert.equal(answerError("clearance", "W/U", "STANDBY"), null);
  assert.match(answerError("clearance", "R", "STANDBY")!, /STANDBY는 W\/U/);
  assert.equal(answerError("flight-plan", "W/U", "UNABLE"), null);
  assert.equal(answerError("recall", "W/U", "READBACK"), null);
  assert.match(answerError("recall", "W/U", "UNABLE")!, /RECALL/);
  assert.match(answerError("recall", "W/U", "STANDBY")!, /RECALL/);
});

test("closingLine: W/U는 세 답을, R은 ROGER를, RECALL은 READBACK <id> RECALL을 청한다", () => {
  assert.equal(
    closingLine("clearance", "W/U", "C-0007"),
    '— Reply to this message with "READBACK C-0007" if you take it, "UNABLE C-0007 — reason" if you cannot, or "STANDBY C-0007" if you need time.',
  );
  assert.equal(closingLine("clearance", "R", "C-0008"), '— When received, reply to this message with "ROGER C-0008".');
  assert.equal(closingLine("recall", "W/U", "D-0003"), '— When received, reply to this message with "READBACK D-0003 RECALL".');
  // 모든 끝줄에 READBACK이나 ROGER <id>가 있다(readiness 점검과 옛 습관)
  for (const line of [closingLine("flight-plan", "W/U", "D-0001"), closingLine("crew-change", "W/U", "CC-0001")]) assert.match(line, /"READBACK (D|CC)-0001"/);
});

test("overdueBase: 보낸 뒤 첫 STANDBY가 기준, 없거나 보내기 전 것이면 보낸 시각", () => {
  const sent = "2026-09-29T04:00:00.000Z";
  assert.equal(overdueBase(sent, null), Date.parse(sent));
  assert.equal(overdueBase(sent, undefined), Date.parse(sent));
  assert.equal(overdueBase(sent, "2026-09-29T04:05:00.000Z"), Date.parse("2026-09-29T04:05:00.000Z"));
  assert.equal(overdueBase(sent, "2026-09-29T03:55:00.000Z"), Date.parse(sent));
});
