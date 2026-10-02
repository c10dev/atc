import assert from "node:assert/strict";
import { test } from "node:test";
import { alertLevel, groupAlerts } from "../web/src/aviation.ts";
import type { AlertKind } from "./model.ts";

const idx = {
  wsByPath: new Map([
    ["/ws/done", { ticketKey: "ATC-1" }],
    ["/ws/gone", { ticketKey: "ATC-2" }],
    ["/ws/live", { ticketKey: "ATC-3" }],
    ["/ws/none", { ticketKey: null }],
  ]),
  ticketByKey: new Map([
    ["ATC-1", { stateType: "completed" as const }],
    ["ATC-2", { stateType: "canceled" as const }],
    ["ATC-3", { stateType: "started" as const }],
  ]),
};
const level = (kind: AlertKind, workspacePath?: string) => alertLevel({ kind, workspacePath }, idx);

test("ALERT 등급: WARNING은 conflict·stranded, CAUTION은 health·no-workspace·unattended", () => {
  assert.equal(level("conflict", "/ws/live"), "warning");
  assert.equal(level("stranded"), "warning");
  for (const k of ["health", "no-workspace", "unattended"] as const) assert.equal(level(k), "caution");
});

test("ALERT 등급: orphan은 STAND의 FLIGHT가 ARRIVED·CANCELLED면 ADVISORY, 아니면 CAUTION", () => {
  assert.equal(level("orphan", "/ws/done"), "advisory"); // ARRIVED
  assert.equal(level("orphan", "/ws/gone"), "advisory"); // CANCELLED
  assert.equal(level("orphan", "/ws/live"), "caution"); // ENROUTE
  assert.equal(level("orphan", "/ws/none"), "caution"); // STAND에 FLIGHT 없음
  assert.equal(level("orphan", "/ws/unknown"), "caution"); // STAND를 모름
  assert.equal(level("orphan"), "caution");
});

test("ALERT 목록: 등급 순서, 같은 등급 안에서는 종류별로 묶고 빈 등급은 뺀다", () => {
  const list: { kind: AlertKind; workspacePath?: string }[] = [
    { kind: "orphan", workspacePath: "/ws/done" },
    { kind: "health" },
    { kind: "conflict" },
    { kind: "unattended" },
    { kind: "health" },
  ];
  const groups = groupAlerts(list, (a) => alertLevel(a, idx));
  assert.deepEqual(
    groups.map((g) => [g.level, g.alerts.map((a) => a.kind)]),
    [
      ["warning", ["conflict"]],
      ["caution", ["health", "health", "unattended"]],
      ["advisory", ["orphan"]],
    ],
  );
  assert.deepEqual(groupAlerts([], () => "caution"), []);
});

test("health: 관제 세션 blocked 규칙 위반은 WARNING, 다른 health는 CAUTION (ATC-352)", () => {
  assert.equal(alertLevel({ kind: "health", key: "health|CONTROL-BLOCKED|s1" }, idx), "warning");
  assert.equal(alertLevel({ kind: "health", key: "health|BLOCKED|s1" }, idx), "caution");
});
