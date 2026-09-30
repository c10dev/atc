import assert from "node:assert/strict";
import { test } from "node:test";
import { type ApplyAircraft, type ApplyControl, type ApplyInputs, type ApplyRow, APPLY_PENDING_MS, applyNowPlanOf, countsOf, pendingLiveOf, pendingOfFile } from "./apply-now.ts";
import { runApplyRows } from "./apply-now-run.ts";

// LAUNCH ACCOUNT APPLY NOW(ATC-244): 계획(순수)과 실행 흐름(가짜 deps). 실제 세션은 멈추지 않는다.
const ac = (registration: string, over: Partial<ApplyAircraft> = {}): ApplyAircraft => ({ registration, current: "acct-2", session: "background", idle: true, retired: false, aog: false, flights: [], openPr: false, assigned: false, launchedRecently: false, limitCut: false, ...over });
const ct = (name: string, over: Partial<ApplyControl> = {}): ApplyControl => ({ name, current: "acct-2", session: "background", idle: true, blocks: [], ...over });
const base = (over: Partial<ApplyInputs> = {}): ApplyInputs => ({
  aircraft: [],
  control: [],
  launchAccount: { aircraft: "acct-3", control: "acct-3" },
  targets: [{ label: "acct-2", refused: null, maxLaunched: null, running: 0 }, { label: "acct-3", refused: null, maxLaunched: null, running: 0 }],
  ...over,
});
const by = (rows: ApplyRow[]) => Object.fromEntries(rows.map((r) => [`${r.kind}|${r.name}`, r.action]));

test("계획: 종류마다 LAUNCH ACCOUNT에 있지 않은 세션만 행이 되고, 행동은 안전 조건이 정한다", () => {
  const rows = applyNowPlanOf(
    base({
      aircraft: [
        ac("TEAM_A"), // 쉬는 중 → move-now
        ac("TEAM_B", { idle: false, flights: ["ATC-1"] }), // FLIGHT 중
        ac("TEAM_C", { openPr: true }),
        ac("TEAM_D", { assigned: true }),
        ac("TEAM_E", { launchedRecently: true }),
        ac("TEAM_F", { limitCut: true }),
        ac("TEAM_G", { current: "acct-3" }), // 이미 목표: 행 없음
        ac("TEAM_H", { session: null }), // 세션 없음: 행 없음
        ac("TEAM_I", { retired: true }), // 퇴역: 행 없음
        ac("TEAM_J", { session: "other" }), // 데스크톱·터미널
        ac("TEAM_K", { aog: true }),
      ],
      control: [ct("TOWER"), ct("OCC", { blocks: ["열린 CREW CHANGE 1건"] }), ct("MCC", { idle: false }), ct("REVIEW", { session: "other" }), ct("CROSSCHECK", { current: "acct-3" }), ct("ENGINEERING", { session: null })],
    }),
  );
  assert.deepEqual(by(rows), {
    "aircraft|TEAM_A": "move-now",
    "aircraft|TEAM_B": "after-flight",
    "aircraft|TEAM_C": "after-flight",
    "aircraft|TEAM_D": "after-flight",
    "aircraft|TEAM_E": "after-flight",
    "aircraft|TEAM_F": "after-flight",
    "aircraft|TEAM_J": "skip",
    "aircraft|TEAM_K": "skip",
    "control|TOWER": "move-now",
    "control|OCC": "wait-safe",
    "control|MCC": "wait-safe",
    "control|REVIEW": "skip",
  });
  assert.match(rows.find((r) => r.name === "OCC")!.reason, /CREW CHANGE/);
  assert.match(rows.find((r) => r.name === "MCC")!.reason, /턴 사이가 아님/);
  assert.match(rows.find((r) => r.name === "TEAM_B")!.reason, /ATC-1/);
});

test("계획: 목표 ACCOUNT가 거절하면(로그인 안 됨·FUEL hold) 안전한 세션도 skip이고 사유가 ACCOUNT를 말한다. 기다릴 세션은 그대로", () => {
  const i = base({ aircraft: [ac("TEAM_A"), ac("TEAM_B", { openPr: true })], control: [ct("TOWER")], targets: [{ label: "acct-3", refused: "FUEL hold 수준: 사용 92%", maxLaunched: null, running: 0 }] });
  const a = by(applyNowPlanOf(i));
  assert.equal(a["aircraft|TEAM_A"], "skip");
  assert.equal(a["aircraft|TEAM_B"], "after-flight");
  assert.equal(a["control|TOWER"], "skip");
  assert.match(applyNowPlanOf(i)[0].reason, /acct-3: FUEL hold/);
});

test("계획: ACCOUNT 상한(maxLaunched)은 이번 move-now까지 세어 넘치면 skip", () => {
  const i = base({ aircraft: [ac("TEAM_A"), ac("TEAM_B"), ac("TEAM_C")], launchAccount: { aircraft: "acct-3", control: null }, targets: [{ label: "acct-3", refused: null, maxLaunched: 3, running: 1 }] });
  assert.deepEqual(by(applyNowPlanOf(i)), { "aircraft|TEAM_A": "move-now", "aircraft|TEAM_B": "move-now", "aircraft|TEAM_C": "skip" });
  assert.match(applyNowPlanOf(i)[2].reason, /상한 3/);
});

test("계획: LAUNCH ACCOUNT가 없으면(각 home) 그 종류는 행이 없다. 등록부에 없는 목표는 skip", () => {
  assert.deepEqual(applyNowPlanOf(base({ aircraft: [ac("TEAM_A")], control: [ct("TOWER")], launchAccount: { aircraft: null, control: null } })), []);
  const r = applyNowPlanOf(base({ aircraft: [ac("TEAM_A")], launchAccount: { aircraft: "acct-9", control: null } }));
  assert.equal(r[0].action, "skip");
  assert.match(r[0].reason, /등록부에 없음/);
});

test("계획: 순서는 AIRCRAFT(REGISTRATION 순) 다음 관제 세션(고정 순서)", () => {
  const rows = applyNowPlanOf(base({ aircraft: [ac("TEAM_B"), ac("TEAM_A")], control: [ct("TOWER"), ct("OCC")] }));
  assert.deepEqual(rows.map((r) => r.name), ["TEAM_A", "TEAM_B", "TOWER", "OCC"]);
});

test("pending: 24시간 안이고 LAUNCH ACCOUNT가 그대로인 종류만 남고, 설정이 바뀌면 그 종류는 끝, 24시간이 지나면 모두 끝", () => {
  const p = { at: "2026-09-30T00:00:00.000Z", aircraft: "acct-3", control: "acct-3" };
  const t0 = Date.parse(p.at);
  assert.deepEqual(pendingLiveOf(p, { aircraft: "acct-3", control: "acct-3" }, t0 + 1000), { aircraft: "acct-3", control: "acct-3" });
  assert.deepEqual(pendingLiveOf(p, { aircraft: "acct-1", control: "acct-3" }, t0 + 1000), { aircraft: null, control: "acct-3" });
  assert.equal(pendingLiveOf(p, { aircraft: null, control: null }, t0 + 1000), null);
  assert.notEqual(pendingLiveOf(p, { aircraft: "acct-3", control: "acct-3" }, t0 + APPLY_PENDING_MS - 1), null);
  assert.equal(pendingLiveOf(p, { aircraft: "acct-3", control: "acct-3" }, t0 + APPLY_PENDING_MS), null);
  assert.equal(pendingLiveOf(null, { aircraft: "acct-3", control: null }, t0), null);
  assert.equal(pendingLiveOf({ ...p, at: "garbage" }, { aircraft: "acct-3", control: "acct-3" }, t0), null);
});

test("pending 파일: 모양이 맞는 칸만 읽는다", () => {
  assert.equal(pendingOfFile(null), null);
  assert.equal(pendingOfFile({ aircraft: "acct-3" }), null);
  assert.deepEqual(pendingOfFile({ at: "x", aircraft: "acct-3", control: "BAD LABEL" }), { at: "x", aircraft: "acct-3", control: null });
});

test("실행: 한 번에 한 세션, 매번 계획을 새로 읽고, 옮긴 세션은 다시 옮기지 않는다", async () => {
  const moved: string[] = [];
  let plans = 0;
  const all = (): ApplyRow[] => applyNowPlanOf(base({ aircraft: [ac("TEAM_A"), ac("TEAM_B", { openPr: true }), ac("TEAM_C")].filter((a) => !moved.includes(a.registration)), control: [] }));
  const r = await runApplyRows({ plan: async () => (plans++, all()), move: async (x) => (moved.push(x.name), { ok: true, jobId: `job-${x.name}` }) }, { aircraft: true, control: true });
  assert.deepEqual(moved, ["TEAM_A", "TEAM_C"]);
  assert.equal(plans, 3);
  assert.equal(r.stoppedAt, null);
  assert.deepEqual(by(r.rows), { "aircraft|TEAM_B": "after-flight" });
  assert.deepEqual(countsOf(r.rows, r.results), { moved: 2, failed: 0, waiting: 1, skipped: 0 });
});

test("실행: 첫 실패에서 멈추고 나머지는 옛 세션 그대로(손대지 않음)", async () => {
  const touched: string[] = [];
  const rows = () => applyNowPlanOf(base({ aircraft: [ac("TEAM_A"), ac("TEAM_B"), ac("TEAM_C")], control: [ct("TOWER")] }));
  const r = await runApplyRows({ plan: async () => rows(), move: async (x) => (touched.push(x.name), x.name === "TEAM_B" ? { ok: false, error: "launch 실패" } : { ok: true }) }, { aircraft: true, control: true });
  assert.deepEqual(touched, ["TEAM_A", "TEAM_B"]);
  assert.equal(r.stoppedAt, "aircraft|TEAM_B");
  assert.deepEqual(countsOf(r.rows, r.results), { moved: 1, failed: 1, waiting: 0, skipped: 0 });
});

test("실행: 선택하지 않은 종류는 건드리지 않는다(pending이 한 종류만 남았을 때)", async () => {
  const touched: string[] = [];
  const r = await runApplyRows({ plan: async () => applyNowPlanOf(base({ aircraft: [ac("TEAM_A")], control: [ct("TOWER")] })), move: async (x) => (touched.push(x.name), { ok: true }) }, { aircraft: false, control: true });
  assert.deepEqual(touched, ["TOWER"]);
  assert.equal(r.rows.some((x) => x.kind === "aircraft"), false);
});
