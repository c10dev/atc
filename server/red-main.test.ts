import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutoRevertLine } from "./auto-revert.ts";
import { type RedMainLine, parseRedMainSwitch, redMainCounterOf, redMainHoldsOf, redMainKey, redMainText, syncEpisodes } from "./red-main.ts";
import { type QueueInput, supervisorQueueOf } from "./supervisor-queue.ts";

const HEAD = "a".repeat(40);
const HUMAN = "b".repeat(40);
const hold: AutoRevertLine = { at: "2026-10-05T01:00:00Z", op: "hold", airport: "ATCC", head: HEAD, foreign: { sha: HUMAN, pr: 570 }, detail: "human merge" };
const main = (over: Partial<{ sha: string | null; state: string; failing: string[] }> = {}) => ({ airport: "ATCC", repo: "c10dev/atc", sha: HEAD, state: "failure", failing: ["check"], ...over });
const pull = (number: number, checks: string[], repo = "c10dev/atc") => ({ repo, number, blocks: [{ code: "checks-failed", checks }] });

test("seeded HOLD + 같은 체크로 실패한 PR 셋: head마다 한 줄이 셋을 모두 적는다", () => {
  const holds = redMainHoldsOf({ lines: [hold], mains: [main()], pulls: [pull(601, ["check"]), pull(602, ["check", "lint"]), pull(603, ["check"]), pull(604, ["lint"]), pull(605, ["check"], "other/repo")] });
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0].blocked, [601, 602, 603]);
  assert.deepEqual(holds[0].checks, ["check"]);
  assert.equal(holds[0].foreign.pr, 570);
  const t = redMainText(holds[0]);
  assert.match(t.detail, /check/);
  assert.match(t.detail, /#601, #602, #603/);
  assert.match(t.detail, /aaaaaaa/);
  assert.match(t.need, /PR #570/);
});

test("QUEUE에는 NEEDS YOU 한 줄(PR마다가 아니라)", () => {
  const holds = redMainHoldsOf({ lines: [hold], mains: [main()], pulls: [pull(601, ["check"]), pull(602, ["check"]), pull(603, ["check"])] });
  const items = supervisorQueueOf({ proposals: [], schedule: { mode: "shadow", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 30, redMain: holds } as unknown as QueueInput, Date.now());
  const rows = items.filter((i) => i.key.startsWith("main-red|"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "NEEDS YOU");
  assert.equal(rows[0].key, `main-red|ATCC|${HEAD}`);
  assert.match(rows[0].detail ?? "", /#601, #602, #603/);
});

test("main이 초록이거나 새 head가 오거나 HOLD가 사람 커밋 때문이 아니면 줄이 없다", () => {
  const pulls = [pull(601, ["check"])];
  assert.deepEqual(redMainHoldsOf({ lines: [hold], mains: [main({ state: "success", failing: [] })], pulls }), []);
  assert.deepEqual(redMainHoldsOf({ lines: [hold], mains: [main({ sha: "c".repeat(40) })], pulls }), []);
  assert.deepEqual(redMainHoldsOf({ lines: [{ ...hold, foreign: undefined }], mains: [main()], pulls }), []);
  assert.deepEqual(redMainHoldsOf({ lines: [hold], mains: [main({ sha: null })], pulls }), []);
});

test("에피소드: head마다 한 번 올리고, main이 초록이 되면 스스로 닫히며, 닫힌 head는 다시 올리지 않는다", () => {
  const [h] = redMainHoldsOf({ lines: [hold], mains: [main()], pulls: [pull(601, ["check"])] });
  const at = "2026-10-05T02:00:00Z";
  const first = syncEpisodes([], [h], false, at);
  assert.deepEqual(first.map((l) => l.op), ["raised"]);
  assert.deepEqual(syncEpisodes(first, [h], false, at), []); // 이미 열림: 다시 올리지 않는다
  const closed = syncEpisodes(first, [], false, "2026-10-05T03:00:00Z");
  assert.deepEqual(closed.map((l) => [l.op, l.end]), [["closed", "cleared"]]);
  assert.deepEqual(syncEpisodes([...first, ...closed], [h], false, at), []); // 닫힌 head는 다시 올리지 않는다
  assert.equal(redMainKey(h), `ATCC|${HEAD}`);
});

test("스위치로 끄면 열린 줄이 switch로 닫히고 카운터는 스스로 닫힌 것과 따로 센다", () => {
  const [h] = redMainHoldsOf({ lines: [hold], mains: [main()], pulls: [] });
  const raised = syncEpisodes([], [h], false, "2026-10-05T02:00:00Z");
  const off = syncEpisodes(raised, [], true, "2026-10-05T02:30:00Z");
  assert.equal(off[0].end, "switch");
  const lines: RedMainLine[] = [...raised, ...off, { at: "2026-10-05T04:00:00Z", op: "raised", airport: "ATCC", head: "d".repeat(40) }, { at: "2026-10-05T05:00:00Z", op: "closed", airport: "ATCC", head: "d".repeat(40), end: "cleared" }];
  assert.deepEqual(redMainCounterOf(lines, Date.parse("2026-10-06T00:00:00Z"), 7), { raised: 2, closedBySelf: 1, closedBySwitch: 1, open: 0, days: 7 });
});

test("스위치는 기본 on이고 정확히 off일 때만 꺼진다", () => {
  assert.equal(parseRedMainSwitch(undefined), "on");
  assert.equal(parseRedMainSwitch("shadow"), "on");
  assert.equal(parseRedMainSwitch("off"), "off");
});

test("스위치로 껐다 다시 켜면 아직 빨간 head의 줄이 새로 올라 카운터의 open이 화면과 맞는다", () => {
  const [h] = redMainHoldsOf({ lines: [hold], mains: [main()], pulls: [] });
  const raised = syncEpisodes([], [h], false, "2026-10-05T02:00:00Z");
  const off = syncEpisodes(raised, [], true, "2026-10-05T02:30:00Z");
  const again = syncEpisodes([...raised, ...off], [h], false, "2026-10-05T03:00:00Z");
  assert.deepEqual(again.map((l) => l.op), ["raised"]);
  assert.equal(redMainCounterOf([...raised, ...off, ...again], Date.parse("2026-10-06T00:00:00Z"), 7).open, 1);
});
