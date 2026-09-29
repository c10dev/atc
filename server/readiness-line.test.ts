import assert from "node:assert/strict";
import { test } from "node:test";
import { atfmAlertOf, dispatchLineParts, followingExceptions, lineText, scheduleLineParts } from "../web/src/readiness-line.ts";

const gate = { decided: 12, agreement: 0.92, target: { decided: 20, agreement: 0.85 }, crosscheck: { matched: 28, marked: 30, rate: 0.93 } };
const items = (...s: string[]) => s.map((status, i) => ({ id: `i${i}`, status }));

test("DISPATCH 한 줄: 2b, gate, agree, CROSSCHECK 순서와 기호", () => {
  const parts = dispatchLineParts({ mode: "shadow", readiness2b: { items: items("ready", "ready", "ready", "ready", "ready", "not-ready", "check", "ready") }, gate });
  assert.equal(lineText(parts), "READINESS · 2b 6/8 ✗ · gate 12/20 ✗ · agree 92% ✓ · CROSSCHECK 93%");
  assert.deepEqual(parts.map((p) => p.state), ["bad", "bad", "ok", "info"]);
});

test("2b는 확인 필요만 있으면 기호 없이, 다 준비되면 ✓", () => {
  assert.equal(lineText(dispatchLineParts({ readiness2b: { items: items("ready", "check") } })), "READINESS · 2b 1/2");
  assert.equal(lineText(dispatchLineParts({ readiness2b: { items: items("ready", "ready") } })), "READINESS · 2b 2/2 ✓");
});

test("판정 5건 미만이면 합의율에 기호를 붙이지 않는다(데이터 부족)", () => {
  const parts = dispatchLineParts({ gate: { ...gate, decided: 3, agreement: 1 } });
  assert.equal(lineText(parts), "READINESS · gate 3/20 ✗ · agree 100% · CROSSCHECK 93%");
});

test("합의율이 기준 아래면 ✗, 합의율이 없으면 —", () => {
  assert.equal(dispatchLineParts({ gate: { ...gate, decided: 30, agreement: 0.5 } }).find((p) => p.id === "agree")?.mark, "✗");
  const none = dispatchLineParts({ gate: { ...gate, agreement: null } }).find((p) => p.id === "agree");
  assert.deepEqual([none?.value, none?.mark, none?.state], ["—", null, "info"]);
});

test("STAGE 3는 STAGE 3 블록이 보일 때만 낀다", () => {
  const g3 = { dispatched: 2, ready: false, target: { dispatched: 10 } };
  assert.equal(dispatchLineParts({ mode: "shadow", gate, gate3: { ...g3, dispatched: 0 } }).some((p) => p.id === "stage3"), false);
  assert.equal(lineText(dispatchLineParts({ mode: "shadow", gate3: g3 })), "READINESS · S3 2/10 ✗");
  assert.equal(lineText(dispatchLineParts({ mode: "approval", gate3: { ...g3, dispatched: 0 } })), "READINESS · S3 0/10 ✗");
});

test("옛 서버: 필드가 없으면 그 조각만 빠지고 던지지 않는다", () => {
  assert.deepEqual(dispatchLineParts({}), []);
  assert.equal(lineText(dispatchLineParts({})), "READINESS");
  assert.equal(lineText(dispatchLineParts({ gate: { decided: 4 } })), "READINESS · gate 4 · agree —");
  assert.equal(lineText(dispatchLineParts({ gate: { decided: 12, target: gate.target } })), "READINESS · gate 12/20 ✗ · agree —");
  assert.equal(lineText(dispatchLineParts({ readiness2b: { items: [] }, gate: { ...gate, crosscheck: undefined } })), "READINESS · gate 12/20 ✗ · agree 92% ✓");
  assert.equal(lineText(dispatchLineParts({ gate: { ...gate, crosscheck: {} } })), "READINESS · gate 12/20 ✗ · agree 92% ✓ · CROSSCHECK —");
  assert.equal(lineText(scheduleLineParts({})), "READINESS");
});

test("SCHEDULE 한 줄: gate, agree, CROSSCHECK, WAYPOINT 없는 ROUTE", () => {
  assert.equal(lineText(scheduleLineParts({ gate, routesWithoutWaypoints: [{}, {}] })), "READINESS · gate 12/20 ✗ · agree 92% ✓ · CROSSCHECK 93% · WAYPOINT 없는 ROUTE 2");
  assert.equal(lineText(scheduleLineParts({ gate, routesWithoutWaypoints: null })), "READINESS · gate 12/20 ✗ · agree 92% ✓ · CROSSCHECK 93%");
});

test("ATFM 예외: 걸린 GROUND STOP이나 main CI 실패", () => {
  assert.deepEqual(atfmAlertOf(null), { active: false, stops: 0, mainsFailing: 0 });
  assert.deepEqual(atfmAlertOf({}), { active: false, stops: 0, mainsFailing: 0 });
  assert.equal(atfmAlertOf({ groundStops: [{ enforced: false }], mains: [{ state: "success" }, { state: "pending" }] }).active, false);
  assert.deepEqual(atfmAlertOf({ groundStops: [{ enforced: true }, { enforced: false }] }), { active: true, stops: 1, mainsFailing: 0 });
  assert.deepEqual(atfmAlertOf({ mains: [{ state: "failure" }] }), { active: true, stops: 0, mainsFailing: 1 });
});

test("FLIGHT FOLLOWING 예외: 지연·불일치가 있는 FLIGHT만", () => {
  const rows = [{ flight: "A", issues: [] }, { flight: "B", issues: [{ kind: "delay" }] }, { flight: "C" }, { flight: "D", issues: [{ kind: "mismatch" }] }];
  assert.deepEqual(followingExceptions(rows).map((r) => r.flight), ["B", "D"]);
  assert.deepEqual(followingExceptions(undefined), []);
});
