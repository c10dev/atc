import assert from "node:assert/strict";
import { test } from "node:test";
import { type BulkSession, allControlDown, bulkCountsOf, bulkPlanOf, bulkRunOrderOf, driftOf, expectMismatch, heldOf, intendedAccountOf } from "./control-bulk.ts";
import { type BulkDeps, runBulkRows } from "./control-bulk-run.ts";

const S = (name: string, o: Partial<BulkSession> = {}): BulkSession => ({ name, live: "background", current: "acct-1", intended: "acct-1", blocks: [], ...o });
const ALL = (o: Partial<BulkSession> = {}) => ["REVIEW", "MCC", "TOWER", "CROSSCHECK", "OCC"].map((n) => S(n, o)); // 일부러 섞어 둔다
const ok = [
  { label: "acct-1", refused: null, maxLaunched: null, running: 0 },
  { label: "acct-3", refused: null, maxLaunched: null, running: 0 },
];

test("intendedAccountOf: LAUNCH ACCOUNT → 관제 세션 라벨 → default, 등록부에 없는 라벨은 무시, 등록부가 비면 null", () => {
  const base = { labels: ["acct-1", "acct-3"], defaultLabel: "acct-1" };
  assert.equal(intendedAccountOf({ ...base, preferred: "acct-3", home: "acct-1" }), "acct-3");
  assert.equal(intendedAccountOf({ ...base, preferred: null, home: "acct-3" }), "acct-3");
  assert.equal(intendedAccountOf({ ...base, preferred: "gone", home: "gone2" }), "acct-1");
  assert.equal(intendedAccountOf({ labels: [], defaultLabel: null, preferred: "acct-3", home: "acct-3" }), null);
});

test("bulkPlanOf launch: TOWER·OCC·MCC·CROSSCHECK·REVIEW 순서, 떠 있는 것은 skip", () => {
  const sessions = ALL({ live: null, current: null }).map((s) => (s.name === "REVIEW" ? { ...s, live: "background" as const, current: "acct-1" } : s));
  const rows = bulkPlanOf({ op: "launch", sessions, targets: ok });
  assert.deepEqual(rows.map((r) => r.name), ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW"]);
  assert.deepEqual(rows.map((r) => r.order), [1, 2, 3, 4, 5]);
  assert.equal(rows.find((r) => r.name === "REVIEW")!.action, "skip");
  assert.equal(rows.find((r) => r.name === "TOWER")!.action, "launch");
});

test("bulkPlanOf launch: 로그인 안 된 ACCOUNT·상한이 찬 ACCOUNT는 사유와 함께 skip", () => {
  const sessions = ALL({ live: null, current: null });
  const refused = bulkPlanOf({ op: "launch", sessions, targets: [{ label: "acct-1", refused: "로그인되어 있지 않음", maxLaunched: null, running: 0 }] });
  assert.ok(refused.every((r) => r.action === "skip" && /로그인/.test(r.reason)));
  const capped = bulkPlanOf({ op: "launch", sessions, targets: [{ label: "acct-1", refused: null, maxLaunched: 3, running: 1 }] });
  assert.deepEqual(capped.map((r) => r.action), ["launch", "launch", "skip", "skip", "skip"]); // 1 + 2 = 3, 그다음부터 상한
  assert.match(capped[2]!.reason, /상한 3/);
});

test("bulkPlanOf restart: drift는 intended로 옮기고, 떠 있지 않은 것은 launch, tmux·데스크톱은 skip", () => {
  const rows = bulkPlanOf({
    op: "restart",
    sessions: [S("TOWER", { current: "acct-3" }), S("OCC", { live: null, current: null }), S("MCC", { live: "tmux" }), S("CROSSCHECK", { live: "other" }), S("REVIEW")],
    targets: ok,
  });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.TOWER!.action, "restart");
  assert.equal(by.TOWER!.drift, true);
  assert.deepEqual([by.TOWER!.from, by.TOWER!.to], ["acct-3", "acct-1"]);
  assert.match(by.TOWER!.reason, /acct-3 → acct-1/);
  assert.equal(by.OCC!.action, "launch");
  assert.equal(by.MCC!.action, "skip");
  assert.equal(by.CROSSCHECK!.action, "skip");
  assert.equal(by.REVIEW!.action, "restart");
  assert.equal(by.REVIEW!.drift, false);
});

test("bulkPlanOf restart: 같은 ACCOUNT 재시작은 상한에 얹지 않는다, drift 이동은 얹는다", () => {
  const cap = [{ label: "acct-1", refused: null, maxLaunched: 2, running: 2 }];
  const same = bulkPlanOf({ op: "restart", sessions: [S("TOWER"), S("OCC")], targets: cap });
  assert.deepEqual(same.map((r) => r.action), ["restart", "restart"]);
  const moved = bulkPlanOf({ op: "restart", sessions: [S("TOWER", { current: "acct-3" })], targets: cap });
  assert.equal(moved[0]!.action, "skip");
  assert.match(moved[0]!.reason, /상한 2/);
});

test("bulkPlanOf align: 어긋난 세션만. 맞는 것·떠 있지 않은 것은 skip", () => {
  const rows = bulkPlanOf({ op: "align", sessions: [S("TOWER", { current: "acct-3" }), S("OCC"), S("MCC", { live: null, current: null })], targets: ok });
  assert.deepEqual(rows.map((r) => r.action), ["restart", "skip", "skip"]);
  assert.match(rows[1]!.reason, /ACCOUNT 맞음/);
});

test("bulkPlanOf stop: bg·tmux는 stop, 데스크톱·없음은 skip, 실행은 거꾸로", () => {
  const rows = bulkPlanOf({ op: "stop", sessions: [S("TOWER"), S("OCC", { live: "tmux" }), S("MCC", { live: "other" }), S("CROSSCHECK", { live: null }), S("REVIEW")], targets: ok });
  assert.deepEqual(rows.map((r) => r.action), ["stop", "stop", "skip", "skip", "stop"]);
  assert.deepEqual(bulkRunOrderOf("stop", rows).map((r) => r.name), ["REVIEW", "OCC", "TOWER"]);
  assert.deepEqual(bulkRunOrderOf("restart", rows).map((r) => r.name), ["TOWER", "OCC", "REVIEW"]);
});

test("등록부가 없으면(intended null) drift가 없다", () => {
  assert.equal(driftOf(S("TOWER", { current: null, intended: null })), false);
  assert.equal(driftOf(S("TOWER", { current: "acct-3", intended: null })), false);
  assert.equal(driftOf(S("TOWER", { live: null, current: "acct-3" })), false);
  assert.equal(driftOf(S("TOWER", { current: "acct-3" })), true);
});

test("heldOf: 막을 것이 있는 stop·restart만. launch는 막을 것이 없다", () => {
  assert.equal(heldOf({ action: "restart", blocks: ["턴 사이가 아님"] }), true);
  assert.equal(heldOf({ action: "stop", blocks: [] }), false);
  assert.equal(heldOf({ action: "launch", blocks: ["x"] }), false);
  assert.equal(heldOf({ action: "skip", blocks: ["x"] }), false);
});

test("expectMismatch: 미리 본 행동과 다른 세션 이름", () => {
  const rows = bulkPlanOf({ op: "restart", sessions: [S("TOWER"), S("OCC", { live: null, current: null })], targets: ok });
  assert.deepEqual(expectMismatch(rows, { TOWER: "restart", OCC: "launch" }), []);
  assert.deepEqual(expectMismatch(rows, { TOWER: "restart", OCC: "restart" }), ["OCC"]);
  assert.deepEqual(expectMismatch(rows, {}), ["TOWER", "OCC"]);
});

const fakes = (fail: string[] = []) => {
  const log: string[] = [];
  const res = (n: string) => (fail.includes(n) ? { ok: false, error: "boom" } : { ok: true, jobId: `j-${n}` });
  const deps: BulkDeps = {
    launch: async (n, to) => (log.push(`launch ${n} ${to}`), res(n)),
    stop: async (n) => (log.push(`stop ${n}`), res(n)),
    restart: async (n, to) => (log.push(`restart ${n} ${to}`), res(n)),
  };
  return { deps, log };
};

test("runBulkRows: 계획 순서대로, held는 force 없이는 하지 않는다", async () => {
  const rows = bulkPlanOf({ op: "restart", sessions: [S("TOWER", { current: "acct-3" }), S("OCC", { blocks: ["열린 CREW CHANGE 1건"] }), S("MCC")], targets: ok });
  const expect = { TOWER: "restart", OCC: "restart", MCC: "restart" };
  const a = fakes();
  const r = await runBulkRows(a.deps, "restart", rows, expect, false);
  assert.deepEqual(a.log, ["restart TOWER acct-1", "restart MCC acct-1"]);
  assert.equal(r.find((x) => x.name === "OCC")!.held, true);
  assert.deepEqual(bulkCountsOf(r), { done: 2, failed: 0, held: 1, skipped: 0 });
  const b = fakes();
  await runBulkRows(b.deps, "restart", rows, expect, true);
  assert.deepEqual(b.log, ["restart TOWER acct-1", "restart OCC acct-1", "restart MCC acct-1"]);
});

test("runBulkRows: launch·restart는 첫 실패에서 멈추고, stop은 실패해도 나머지를 내린다", async () => {
  const launchRows = bulkPlanOf({ op: "launch", sessions: [S("TOWER", { live: null }), S("OCC", { live: null }), S("MCC", { live: null })], targets: ok });
  const expect = { TOWER: "launch", OCC: "launch", MCC: "launch" };
  const a = fakes(["OCC"]);
  const r = await runBulkRows(a.deps, "launch", launchRows, expect, false);
  assert.deepEqual(a.log, ["launch TOWER acct-1", "launch OCC acct-1"]);
  assert.equal(r[2]!.skipped, "OCC가 실패해 멈춤");
  assert.deepEqual(bulkCountsOf(r), { done: 1, failed: 1, held: 0, skipped: 1 });
  const stopRows = bulkPlanOf({ op: "stop", sessions: [S("TOWER"), S("OCC"), S("MCC")], targets: ok });
  const b = fakes(["OCC"]);
  const s = await runBulkRows(b.deps, "stop", stopRows, { TOWER: "stop", OCC: "stop", MCC: "stop" }, false);
  assert.deepEqual(b.log, ["stop MCC", "stop OCC", "stop TOWER"]);
  assert.deepEqual(bulkCountsOf(s), { done: 2, failed: 1, held: 0, skipped: 0 });
});

test("runBulkRows: 미리 본 뒤 계획이 바뀐 세션은 하지 않는다", async () => {
  const rows = bulkPlanOf({ op: "restart", sessions: [S("TOWER"), S("OCC")], targets: ok });
  const a = fakes();
  const r = await runBulkRows(a.deps, "restart", rows, { TOWER: "restart", OCC: "launch" }, false);
  assert.deepEqual(a.log, ["restart TOWER acct-1"]);
  assert.match(r[1]!.skipped!, /계획이 바뀜/);
});

test("allControlDown: 목록이 있고 LAUNCH 가능한 세션이 모두 live가 없을 때만", () => {
  const live = [{ id: "a" }];
  assert.equal(allControlDown(null), false);
  assert.equal(allControlDown([]), false);
  assert.equal(allControlDown([{ launch: "bg", live: [] }, { launch: "bg", live: [] }, { launch: null, live }]), true); // ENGINEERING(배지만)은 센 것이 아니다
  assert.equal(allControlDown([{ launch: "bg", live: [] }, { launch: "bg", live }]), false);
});
