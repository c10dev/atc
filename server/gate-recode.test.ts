import assert from "node:assert/strict";
import { test } from "node:test";
import { fold, gateCodesOf, gateOf, notReadyOf, type Op, recentFlightsOf } from "./proposals.ts";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const create = (id: string, flight: string, minAgo = 60): Op => ({
  op: "create", id, at: iso(minAgo), kind: "ASSIGN", flight, aircraft: "a", aircraftName: "TEAM_A", airport: "VCDO", score: 1, factors: [],
});
const mark = (id: string, verdict: "agree" | "disagree"): Op => ({ op: "crosscheck", id, by: "CROSSCHECK", model: "m", verdict, reason: "x", at: iso(50) });
const verdict = (id: string, v: "agree" | "disagree", reasonCodes?: string[], via?: "crosscheck"): Op => ({
  op: "verdict", id, at: iso(40), verdict: v, reason: null, ...(reasonCodes ? { reasonCodes } : {}), ...(via ? { via } : {}),
});
const recode = (id: string, codes: string[], minAgo = 5): Op => ({ op: "recode", id, at: iso(minAgo), by: "SUPERVISOR", codes });

test("게이트는 팀 선택만: 칩이 모두 FLIGHT 칩인 거절은 빼고 따로 센다. wrong-aircraft·other·칩 없음이 섞이면 센다", () => {
  const ps = fold([
    create("D-1", "VOC-1"), verdict("D-1", "agree"),
    create("D-2", "VOC-2"), verdict("D-2", "disagree", ["needs-human"]), // 준비 안 됨
    create("D-3", "VOC-3"), verdict("D-3", "disagree", ["needs-human", "out-of-repo"]), // 준비 안 됨
    create("D-4", "VOC-4"), verdict("D-4", "disagree", ["needs-human", "wrong-aircraft"]), // 팀 선택이 섞임
    create("D-5", "VOC-5"), verdict("D-5", "disagree", ["other"]),
    create("D-6", "VOC-6"), verdict("D-6", "disagree"), // 칩 없음
  ]);
  assert.deepEqual(ps.map(notReadyOf), [false, true, true, false, false, false]);
  const g = gateOf(ps);
  assert.equal(g.decided, 4);
  assert.equal(g.agreed, 1);
  assert.equal(g.agreement, 0.25);
  assert.equal(g.notReady, 2);
});

test("recode: 거절(disagreed)에만, 나중 것이 대신하며, 게이트만 바꾸고 FLIGHT 보류는 걸지 않는다", () => {
  const ops: Op[] = [
    create("D-0001", "VOC-125"), verdict("D-0001", "disagree"),
    create("D-0002", "VOC-9"), verdict("D-0002", "agree"),
    create("D-0003", "VOC-34"), // 아직 판정 전
    recode("D-0001", ["needs-human"], 6), recode("D-0002", ["needs-human"]), recode("D-0003", ["parent-issue"]),
  ];
  const [p1, p2, p3] = fold(ops);
  assert.deepEqual(p1.gateCodes, ["needs-human"]);
  assert.equal(p1.reasonCodes, undefined); // 판정 때의 칩은 그대로
  assert.equal(p2.gateCodes, undefined);
  assert.equal(p3.gateCodes, undefined);
  assert.deepEqual(gateCodesOf(p1), ["needs-human"]);
  // 방금(24시간 안) 판정이어도 recode로는 FLIGHT 보류가 생기지 않는다
  assert.equal(recentFlightsOf([p1], NOW).size, 0);
  // 나중 recode가 대신한다: 팀 선택 칩으로 바꾸면 다시 게이트에 든다
  const back = fold([...ops, recode("D-0001", ["wrong-aircraft"], 1)])[0];
  assert.deepEqual(back.gateCodes, ["wrong-aircraft"]);
  assert.equal(notReadyOf(back), false);
});

test("ATC-5 사례: 3/9(33%)가 옛 거절 6건 recode 뒤 3/3. CROSSCHECK 일치와 한 번 클릭은 그대로", () => {
  const ops: Op[] = [];
  for (const [i, v] of (["agree", "agree", "agree", "disagree", "disagree", "disagree", "disagree", "disagree", "disagree"] as const).entries()) {
    const id = `D-${i}`;
    ops.push(create(id, `VOC-${i}`), mark(id, v), verdict(id, v, undefined, i % 2 ? "crosscheck" : undefined));
  }
  const before = gateOf(fold(ops));
  assert.equal(before.decided, 9);
  assert.equal(before.agreed, 3);
  const codes = [["needs-human"], ["parent-issue"], ["already-done"], ["needs-human", "no-priority", "out-of-repo"], ["needs-human", "out-of-repo"], ["needs-human"]];
  const after = gateOf(fold([...ops, ...codes.map((c, k) => recode(`D-${k + 3}`, c))]));
  assert.equal(after.decided, 3);
  assert.equal(after.agreement, 1);
  assert.equal(after.notReady, 6);
  assert.deepEqual(after.preflight, { held: 0, holding: 0, passed: 3, notReady: 6, readyRate: 1 / 3 }); // 준비율도 거름을 빠져나간 것을 센다
  assert.deepEqual(after.crosscheck, before.crosscheck);
  assert.deepEqual(after.reasonCounts, before.reasonCounts); // 사유 칩 집계도 게이트 밖이라 그대로
});
