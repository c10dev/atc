import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type Plan } from "./dispatch.ts";
import type { Ticket } from "./model.ts";
import { confirmCodesOf, confirmReasonOf } from "./preflight.ts";
import { fold, gateOf, humanOf, isHeld, type Op, preflightStatsOf, reasonStatsOf, recentFlightsOf, reservedOf, syncOps } from "./proposals.ts";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const create = (id: string, flight: string, aircraft: string, minAgo: number): Op => ({
  op: "create", id, at: iso(minAgo), kind: "ASSIGN", flight, aircraft, aircraftName: `TEAM_${aircraft.toUpperCase()}`, airport: "VCDO", score: 1, factors: [],
});
const mark = (id: string, minAgo: number, verdict: "agree" | "disagree", reasonCodes?: string[]): Op => ({
  op: "crosscheck", id, by: "CROSSCHECK", model: "claude-ocx-opencode-go--muse-spark-1.3-contributor", verdict, reason: "사용자 지시를 기다림", at: iso(minAgo),
  ...(reasonCodes ? { reasonCodes } : {}),
});
const one = (ops: Op[]) => fold(ops)[0];

// CROSSCHECK 은퇴(ATC-371): 서버는 더 이상 mark로 PREFLIGHT HOLD를 걸지 않는다. 옛 preflight 줄은 기록으로 읽힌다
test("PREFLIGHT HOLD(옛 기록): HELD로 가고 FLIGHT를 잡아 두며, 판정 없이 누가·칩·이유가 남는다", () => {
  const ops: Op[] = [create("D-0024", "VOC-125", "d", 60), mark("D-0024", 50, "disagree", ["needs-human"])];
  const pre: Op[] = [{ op: "preflight", id: "D-0024", at: iso(40), by: "CROSSCHECK", model: "claude-ocx-opencode-go--muse-spark-1.3-contributor", codes: ["needs-human"], reason: "사용자 지시를 기다림" }];
  const p = one([...ops, ...pre]);
  assert.equal(p.status, "proposed");
  assert.equal(isHeld(p), true);
  assert.deepEqual(p.hold, []);
  assert.equal(p.firstHeldAt, iso(40));
  assert.deepEqual(p.preflight, { at: iso(40), by: "CROSSCHECK", model: "claude-ocx-opencode-go--muse-spark-1.3-contributor", codes: ["needs-human"], reason: "사용자 지시를 기다림" });
  assert.equal(reservedOf([p], NOW).flights.get("VOC-125"), "D-0024"); // 다른 AIRCRAFT에 다시 제안하지 않는다
  assert.equal(reservedOf([p], NOW).aircraft.has("d"), false); // AIRCRAFT는 풀어 둔다
  assert.equal(humanOf(p), null);
  assert.equal(gateOf([p]).decided, 0);
});

test("대기열로(requeue): 같은 제안이 SUPERVISOR 대기열로 돌아오고, 다시 HOLD되지 않으며, 24시간은 돌린 때부터", () => {
  const ops: Op[] = [
    create("D-0024", "VOC-125", "b", 30 * 60), mark("D-0024", 29 * 60, "disagree", ["needs-human"]),
    { op: "preflight", id: "D-0024", at: iso(29 * 60), by: "CROSSCHECK", model: "m", codes: ["needs-human"], reason: "x" },
    { op: "requeue", id: "D-0024", at: iso(10) },
  ];
  const p = one(ops);
  assert.equal(p.status, "proposed");
  assert.equal(isHeld(p), false);
  assert.equal(p.preflight, undefined);
  assert.equal(p.requeuedAt, iso(10));
  assert.equal(p.firstHeldAt, iso(29 * 60)); // 준비율에는 HOLD된 제안으로 남는다
  // 만든 지 30시간이지만 돌린 지 10분: 만료하지 않는다
  const plan: Plan = {
    at: iso(0), assign: [{ kind: "ASSIGN", flight: "VOC-125", aircraft: "b", aircraftName: "TEAM_B", airport: "VCDO", score: 1, factors: [] }], release: [], hold: [], excluded: [], slots: [],
    aircraft: [{ id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: true, reason: "PARKED", reserved: null }],
  };
  const tickets = [{ key: "VOC-125", state: "Todo", stateType: "unstarted" } as Ticket];
  assert.deepEqual(syncOps([p], plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 24), []);
  // 대기열로 돌린 제안이 아니면 HOLD 중이 아닐 때 requeue는 무시한다
  assert.equal(one([create("D-1", "VOC-1", "b", 60), { op: "requeue", id: "D-1", at: iso(5) }]).requeuedAt, undefined);
});

test("FLIGHT 보류 확정: via preflight로 닫혀 #56의 FLIGHT 보류가 걸리고, 게이트에는 세지 않으며 사유 통계에는 센다", () => {
  const held = one([
    create("D-0024", "VOC-125", "d", 60), mark("D-0024", 50, "disagree", ["needs-human"]),
    { op: "preflight", id: "D-0024", at: iso(50), by: "CROSSCHECK", model: "m", codes: ["needs-human"], reason: "사용자 모집·관찰 필요" },
  ]);
  const codes = confirmCodesOf(held);
  assert.deepEqual(codes, ["needs-human"]);
  const reason = confirmReasonOf(held, codes);
  assert.equal(reason, "사람 결정 필요 — PREFLIGHT 확정 · CROSSCHECK: 사용자 모집·관찰 필요");
  const ps = fold([
    create("D-0024", "VOC-125", "d", 60), mark("D-0024", 50, "disagree", ["needs-human"]),
    { op: "preflight", id: "D-0024", at: iso(50), by: "CROSSCHECK", model: "m", codes: ["needs-human"], reason: "사용자 모집·관찰 필요" },
    { op: "verdict", id: "D-0024", at: iso(5), verdict: "disagree", reason, via: "preflight", reasonCodes: codes },
    create("D-0009", "VOC-9", "b", 60), { op: "verdict", id: "D-0009", at: iso(5), verdict: "agree", reason: null },
  ]);
  const [p] = ps;
  assert.equal(p.status, "disagreed");
  assert.equal(humanOf(p), null);
  assert.deepEqual([...recentFlightsOf(ps, NOW).keys()], ["VOC-125"]); // 모든 AIRCRAFT에서 빠진다
  const gate = gateOf(ps);
  assert.equal(gate.decided, 1); // D-0009만
  assert.equal(gate.agreement, 1);
  assert.equal(gate.reasonCounts?.["needs-human"], 0); // 사람 판정의 칩만
  assert.equal(reasonStatsOf(ps).find((r) => r.code === "needs-human")!.count, 1); // planner 할 일 목록에는 센다
});

test("확정 칩: PREFLIGHT 칩 → HOLD 전 mark의 FLIGHT 칩 → 선행 없는 OCC HOLD는 needs-human(이유 문장에서 추정하지 않음)", () => {
  // D-0024·D-0025처럼: 칩 없는 mark 뒤에 OCC가 선행 없는 HOLD
  const occ = one([create("D-0025", "VOC-177", "b", 60), mark("D-0025", 50, "disagree"), { op: "note", id: "D-0025", at: iso(45), text: "사용자 지시 대기", caution: true }, { op: "hold", id: "D-0025", at: iso(45), blockedBy: [] }]);
  assert.deepEqual(confirmCodesOf(occ), ["needs-human"]);
  assert.equal(confirmReasonOf(occ, ["needs-human"]), "사람 결정 필요 — PREFLIGHT 확정 · OCC HOLD: 사용자 지시 대기");
  const coded = one([create("D-1", "VOC-1", "b", 60), mark("D-1", 50, "disagree", ["out-of-repo", "wrong-aircraft"]), { op: "hold", id: "D-1", at: iso(45), blockedBy: [] }]);
  assert.deepEqual(confirmCodesOf(coded), ["out-of-repo"]);
});

test("준비율: HOLD된 제안(OCC·PREFLIGHT, 돌렸거나 확정했어도)과 HOLD 없이 판정까지 간 제안", () => {
  const ps = fold([
    create("D-1", "VOC-1", "b", 60), { op: "verdict", id: "D-1", at: iso(5), verdict: "agree", reason: null }, // passed
    create("D-2", "VOC-2", "b", 60), { op: "verdict", id: "D-2", at: iso(5), verdict: "disagree", reason: "x", reasonCodes: ["wrong-aircraft"] }, // passed
    create("D-3", "VOC-3", "b", 60), { op: "hold", id: "D-3", at: iso(5), blockedBy: [] }, // held, 아직 HOLD 중
    create("D-4", "VOC-4", "b", 60), { op: "preflight", id: "D-4", at: iso(9), by: "CROSSCHECK", model: "m", codes: ["already-done"], reason: "x" },
    { op: "requeue", id: "D-4", at: iso(8) }, { op: "verdict", id: "D-4", at: iso(5), verdict: "agree", reason: null }, // held(돌린 뒤 판정)
    create("D-5", "VOC-5", "b", 60), // 아직 판정 전: 세지 않는다
  ]);
  assert.deepEqual(preflightStatsOf(ps), { held: 2, holding: 1, passed: 2, notReady: 0, readyRate: 0.5 });
  assert.equal(gateOf(ps).decided, 3); // 돌린 뒤 사람이 판정한 D-4는 게이트에 센다
  assert.deepEqual(preflightStatsOf([]), { held: 0, holding: 0, passed: 0, notReady: 0, readyRate: null });
});
