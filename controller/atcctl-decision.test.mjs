import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionText, parseDecisionArgs, tickPlan } from "./atcctl.mjs";

test("decision file: key, --ask, 2+ --option, optional --pr/--head", () => {
  const r = parseDecisionArgs(["file", "tower", "pr#7@abc1234", "--ask", "Merge PR 7?", "--option", "merge", "--option", "hold", "--pr", "7", "--head", "abc1234"]);
  assert.deepEqual(r, { sub: "file", role: "tower", body: { role: "tower", key: "pr#7@abc1234", ask: "Merge PR 7?", options: ["merge", "hold"], pr: { number: 7, head: "abc1234" } } });
  assert.equal(parseDecisionArgs(["file", "occ", "k", "--ask", "a", "--option", "x", "--option", "y"]).body.pr, undefined);
});

test("decision: bad role, missing key, unknown option, --head without --pr", () => {
  assert.throws(() => parseDecisionArgs(["file", "team_e", "k"]), /역할/);
  assert.throws(() => parseDecisionArgs(["file", "tower"]), /decision file/);
  assert.throws(() => parseDecisionArgs(["file", "tower", "k", "--approve", "1"]), /알 수 없는 옵션/);
  assert.throws(() => parseDecisionArgs(["file", "tower", "k", "--head", "abc1234"]), /--pr/);
  assert.throws(() => parseDecisionArgs(["file", "tower", "k", "--ask"]), /값이 필요/);
  assert.throws(() => parseDecisionArgs(["merge", "tower", "k"]), /decision file/);
});

test("decision ack|withdraw|list", () => {
  assert.deepEqual(parseDecisionArgs(["ack", "mcc", "dc-0003"]), { sub: "ack", role: "mcc", id: "DC-0003" });
  assert.deepEqual(parseDecisionArgs(["withdraw", "duty", "DC-0003"]), { sub: "withdraw", role: "duty", id: "DC-0003" });
  assert.deepEqual(parseDecisionArgs(["list", "crosscheck"]), { sub: "list", role: "crosscheck" });
  assert.throws(() => parseDecisionArgs(["ack", "mcc", "C-0003"]), /DC-0001/);
  assert.throws(() => parseDecisionArgs(["list", "mcc", "x"]), /decision list/);
});

test("decisionText: filed tells the session to end its turn; duplicate says so; list shows answers", () => {
  const d = { id: "DC-0001", key: "k", status: "open" };
  assert.match(decisionText({ sub: "file", role: "tower" }, { decision: d, duplicate: false }), /^DC-0001 FILED .*End your turn now/);
  assert.match(decisionText({ sub: "file", role: "tower" }, { decision: d, duplicate: true }), /ALREADY FILED/);
  assert.match(decisionText({ sub: "ack", role: "tower" }, { decision: { ...d, status: "answered" } }), /answer read/);
  assert.equal(decisionText({ sub: "list", role: "occ" }, { decisions: [] }), "DECISION none open for occ");
  assert.match(decisionText({ sub: "list", role: "occ" }, { decisions: [{ ...d, status: "answered", answer: { choice: 1, text: "ok" } }] }), /DC-0001 ANSWERED \[k\] — option 2 · ok/);
});

test("tickPlan: SUPERVISOR의 DECISION 답은 REASONS 뒤, 브리핑 앞에 한 줄씩 (ATC-352)", () => {
  const plan = tickPlan("mcc", { changed: false, line: "" }, { act: true, reasons: ["decision-answered"], answers: ["DECISION DC-0001 [k] ANSWERED by SUPERVISOR — option 1 (go) — act on it"], brief: { pulls: [] } });
  assert.equal(plan.lines[0], "TICK ACT mcc");
  assert.equal(plan.lines[1], "REASONS: decision-answered");
  assert.match(plan.lines[2], /^DECISION DC-0001/);
  assert.equal(plan.ack, null);
});
