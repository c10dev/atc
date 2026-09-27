import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRoutes } from "./routes.ts";
import { criterionCheck, type GateFacts, worst } from "./waypoint-gates.ts";

const gate = (decided: number, agreement: number | null, ready = false) => ({ decided, agreement, ready, target: { decided: 20, agreement: 0.8 } });
const facts = (over: Partial<GateFacts> = {}): GateFacts => ({
  dispatchGate: gate(4, 0.75),
  scheduleGate: gate(21, 0.7),
  readiness: [
    { id: "gate", label: "2a 게이트(그림자 판정)", status: "not-ready" },
    { id: "recall", label: "RECALL", status: "ready" },
    { id: "known-gaps", label: "알려진 빈틈", status: "check" },
  ],
  dispatchMode: "shadow",
  scheduleMode: "approval",
  autoTurnOn: [
    { id: "2b", value: "shadow", target: "14일", status: "fail" },
    { id: "gate3", value: "0건", target: "≥ 10건", status: "insufficient" },
    { id: "precision", value: "97% (22건)", target: "≥ 95%", status: "pass" },
    { id: "crosscheck", value: "100% (3건)", target: "≥ 90% · 20건", status: "insufficient" },
  ],
  recalled: 0,
  ...over,
});

// atc Linear 마일스톤의 완료 기준 그대로(2026-09-27)
const M16 = [
  "DISPATCH shadow gate: 20 or more verdicts with 80% or more agreement.",
  "vocado CLAUDE.md answers `[DISPATCH D-xxxx]` and `[OCC CC-xxxx]` with READBACK.",
  "Every item on the DISPATCH tab's 2b readiness checklist is ready or checked.",
  "The SUPERVISOR switches DISPATCH mode to approval.",
];
const M17 = ["SCHEDULE shadow gate: 20 or more verdicts with 80% or more agreement.", "Label placement decided for the ATC team (workspace labels or per team).", "The SUPERVISOR switches SCHEDULE mode to approval."];
const M19 = [
  "2b has run for two weeks with the gate3 figures (READBACK 90%, DEPARTED 80%).",
  "Shadow precision 95% over 20 and CROSSCHECK per-family match 90% over 20.",
  "RECALL is in use; ATFM steps 6–10 are built.",
  "The SUPERVISOR turns each switch on.",
];

test("worst: 미달 > 데이터 부족 > 확인 필요 > 충족", () => {
  assert.equal(worst([]), "pass");
  assert.equal(worst(["pass", "check"]), "check");
  assert.equal(worst(["check", "insufficient", "pass"]), "insufficient");
  assert.equal(worst(["insufficient", "fail"]), "fail");
});

test("M16: 판정 게이트·2b 점검표·모드는 이어지고, 다른 저장소의 일은 null", () => {
  const got = M16.map((c) => criterionCheck(c, facts()));
  assert.deepEqual(got.map((x) => x && `${x.id}:${x.state}`), ["dispatch-gate:insufficient", null, "readiness-2b:fail", "dispatch-mode:fail"]);
  assert.equal(got[0]!.value, "DISPATCH 판정 4/20건 · 합의 75%");
  assert.equal(got[2]!.value, "준비 안 됨: 2a 게이트(그림자 판정)");
  const ready = facts({ dispatchGate: gate(22, 0.86, true), dispatchMode: "approval", readiness: [{ id: "known-gaps", label: "알려진 빈틈", status: "check" }] });
  assert.deepEqual(M16.map((c) => criterionCheck(c, ready)?.state ?? null), ["pass", null, "check", "pass"]);
});

test("M17: 20건을 넘겼는데 합의율이 모자라면 미달", () => {
  assert.deepEqual(M17.map((c) => criterionCheck(c, facts())?.state ?? null), ["fail", null, "pass"]);
});

test("M19: ATFM 켜는 조건 행을 묶고, RECALL은 쓴 기록이 있으면 확인 필요", () => {
  const got = M19.map((c) => criterionCheck(c, facts()));
  assert.deepEqual(got.map((x) => x && `${x.id}:${x.state}`), ["2b-run:fail", "atfm-precision:insufficient", "recall:fail", null]);
  assert.equal(got[1]!.value, "97% (22건) · 100% (3건)");
  assert.equal(criterionCheck(M19[2], facts({ recalled: 1 }))!.state, "check");
  assert.equal(criterionCheck(M19[0], facts({ autoTurnOn: [] }))!.state, "check"); // 행을 못 읽음
});

test("criterionCheck: 사실을 함수로 주면 맞는 규칙이 있을 때만 부른다", () => {
  let calls = 0;
  const lazy = () => (calls++, facts());
  assert.equal(criterionCheck("Direct assignments carry `tail:` labels.", lazy), null);
  assert.equal(calls, 0);
  assert.equal(criterionCheck(M16[0], lazy)!.id, "dispatch-gate");
  assert.equal(calls, 1);
});

test("buildRoutes: checkOf가 있으면 WAYPOINT criteria마다 checks, 없으면 null", () => {
  const ms = { id: "m16", project: "atc", name: "M16", description: `Exit criteria:\n\n${M16.map((c, i) => `${i + 1}. ${c}`).join("\n")}`, targetDate: null, progress: 0.5, sortOrder: 1, status: "next", issues: [], truncated: false, teams: ["ATC"] };
  const base = { now: Date.parse("2026-09-27T12:00:00Z"), goals: null, milestones: [ms], tickets: [], entries: [], aircraftOf: new Map<string, string>() };
  const [w] = buildRoutes({ ...base, checkOf: (c) => criterionCheck(c, facts()) }).routes[0].waypoints;
  assert.equal(w.criteria.length, 4);
  assert.deepEqual(w.checks.map((x) => x?.id ?? null), ["dispatch-gate", null, "readiness-2b", "dispatch-mode"]);
  assert.deepEqual(buildRoutes(base).routes[0].waypoints[0].checks, [null, null, null, null]);
});
