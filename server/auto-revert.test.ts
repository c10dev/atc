import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AutoRevertLine,
  clearableStops,
  dutyLineOf,
  fixTextOf,
  isRevertPr,
  lowerAutoland,
  lowerMcc,
  AUTO_REVERT_MODES,
  guardPhaseOf,
  needsRerun,
  pollStepOf,
  writeRed,
  mergedBackOf,
  parseAutoRevert,
  rerunOf,
  RERUN_WAIT_MS,
  rerunVerdictOf,
  revertDaysOf,
  prOfSubject,
  type RevertCommit,
  type RevertInput,
  redHeadsOf,
  revertBodyOf,
  revertDecisionOf,
  revertTitleOf,
  stoppedOf,
} from "./auto-revert.ts";
import { destOf, DEST_PREFIXES } from "./supervisor-alerts.ts";
import { modeSegments, needsConfirm } from "./settings-policy.ts";
import { swOf, switchViews } from "./test-switch-views.ts";
import { DEFAULT_AUTOLAND, type AutolandState, planAutoland } from "./autoland.ts";
import type { PullRequest } from "./model.ts";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

const c = (sha: string, over: Partial<RevertCommit> = {}): RevertCommit => ({ sha, pr: null, by: null, revert: false, green: false, files: [], ...over });
const lander = (sha: string, pr: number, by: "mcc" | "autoland" = "mcc", files: string[] = ["server/x.ts"]) => c(sha, { pr, by, files });
const green = (sha: string) => c(sha, { green: true });

const input = (commits: RevertCommit[], over: Partial<RevertInput> = {}): RevertInput => ({
  airport: "ATCC",
  head: { sha: commits[0]?.sha ?? "h", state: "failure", failing: ["check"] },
  commits,
  inflight: false,
  lines: [],
  now: NOW,
  migrationOf: (files) => files.find((f) => f.startsWith("supabase/migrations/")) ?? null,
  userTierOf: (files) => (files.some((f) => f.startsWith("deploy/") || f.includes("guard")) ? "user 등급 경로" : null),
  ...over,
});

test("스위치(ATC-394): 처음부터 켜져 있다. 꺼지는 것은 정확히 off일 때뿐, shadow는 없다", () => {
  assert.equal(parseAutoRevert(null).mode, "on");
  assert.equal(parseAutoRevert({}).mode, "on");
  assert.equal(parseAutoRevert({ mode: "on" }).mode, "on");
  assert.equal(parseAutoRevert({ mode: "off" }).mode, "off");
  assert.equal(parseAutoRevert({ mode: "shadow" }).mode, "on"); // 예전 값은 기본으로
  assert.equal(parseAutoRevert({ mode: "OFF" }).mode, "on");
  assert.deepEqual([...AUTO_REVERT_MODES], ["off", "on"]);
});

test("PR 번호는 머지 커밋과 squash 제목에서만 읽는다", () => {
  assert.equal(prOfSubject("Merge pull request #397 from chaehy5665/worktree-x"), 397);
  assert.equal(prOfSubject("Fix the thing (#12)"), 12);
  assert.equal(prOfSubject("Fix the thing #12 in the middle"), null);
  assert.equal(prOfSubject("direct push to main"), null);
});

test("main이 빨갛지 않으면 하지 않는다", () => {
  for (const state of ["success", "pending", "none"] as const) {
    const d = revertDecisionOf(input([lander("a1", 1)], { head: { sha: "a1", state, failing: [] } }));
    assert.equal(d.act, "none");
  }
});

test("lander 머지 하나가 깼으면 그 머지를 되돌린다: 체크 이름과 누가 머지했는지를 담는다", () => {
  const d = revertDecisionOf(input([lander("a1", 7, "autoland"), green("g0")]));
  assert.deepEqual(d, { act: "revert", commit: "a1", pr: 7, by: "autoland", check: "check" });
  const two = revertDecisionOf(input([lander("a1", 7), green("g0")], { head: { sha: "a1", state: "failure", failing: ["build", "Application Check"] } }));
  assert.equal(two.act === "revert" && two.check, "build, Application Check");
});

test("사람의 머지는 자동으로 되돌리지 않는다: 범위에 있으면 hold", () => {
  const human = c("h1", { pr: 5, by: null });
  const d = revertDecisionOf(input([human, lander("a1", 7), green("g0")]));
  assert.equal(d.act, "hold");
  assert.match(d.act === "hold" ? d.why : "", /사람의 머지/);
  // 사람의 머지가 head여도, 뒤에 있어도 같다. 마지막 초록 앞(범위 밖)의 사람 머지는 상관없다
  assert.equal(revertDecisionOf(input([lander("a1", 7), human, green("g0")])).act, "hold");
  assert.equal(revertDecisionOf(input([lander("a1", 7), green("g0"), human])).act, "revert");
  // PR이 아닌 직접 push도 모르는 커밋이다
  assert.equal(revertDecisionOf(input([lander("a1", 7), c("x9"), green("g0")])).act, "hold");
});

test("lander 머지가 둘 이상이면 가장 새 것부터, 되돌린 뒤 다시 보면 다음 것", () => {
  const range = [lander("a3", 30), lander("a2", 20), lander("a1", 10), green("g0")];
  const first = revertDecisionOf(input(range));
  assert.equal(first.act === "revert" && first.pr, 30);
  // 30을 되돌린 revert PR이 머지돼 head가 revert 머지(빨강)다: 다시 보면 다음으로 새 20
  const afterFirst = [c("r1", { pr: 31, revert: true }), ...range];
  const lines: AutoRevertLine[] = [{ at: iso(5), op: "revert-opened", airport: "ATCC", head: "a3", pr: 30, revertPr: 31 }];
  const second = revertDecisionOf(input(afterFirst, { lines }));
  assert.equal(second.act === "revert" && second.pr, 20);
  // 둘 다 되돌렸는데도 빨가면 하나 남은 10
  const lines2: AutoRevertLine[] = [...lines, { at: iso(3), op: "revert-opened", airport: "ATCC", head: "r1", pr: 20, revertPr: 32 }];
  const third = revertDecisionOf(input([c("r2", { pr: 32, revert: true }), ...afterFirst], { lines: lines2 }));
  assert.equal(third.act === "revert" && third.pr, 10);
  // 모두 되돌렸는데도 빨가면 더 할 것이 없다: hold
  const lines3: AutoRevertLine[] = [...lines2, { at: iso(1), op: "revert-opened", airport: "ATCC", head: "r2", pr: 10, revertPr: 33 }];
  assert.equal(revertDecisionOf(input([c("r3", { pr: 33, revert: true }), c("r2", { pr: 32, revert: true }), ...afterFirst], { lines: lines3 })).act, "hold");
});

test("되돌림의 되돌림은 없다: revert 머지는 후보가 아니다", () => {
  // 범위에 revert 머지뿐이면(lander 머지가 없다) 되돌릴 것이 없다
  const d = revertDecisionOf(input([c("r1", { pr: 31, revert: true }), green("g0")]));
  assert.equal(d.act, "hold");
  // by가 있는 lander 머지처럼 보여도 우리 revert면 건너뛴다
  const d2 = revertDecisionOf(input([c("r1", { pr: 31, by: "mcc", revert: true }), lander("a1", 7), green("g0")]));
  assert.equal(d2.act === "revert" && d2.pr, 7);
});

test("K1 마이그레이션 경로와 K3(user 등급) 경로의 PR은 되돌리지 않고 hold", () => {
  const k1 = revertDecisionOf(input([lander("a1", 7, "autoland", ["web/a.ts", "supabase/migrations/2026_x.sql"]), green("g0")]));
  assert.equal(k1.act, "hold");
  assert.match(k1.act === "hold" ? k1.why : "", /K1/);
  const k3 = revertDecisionOf(input([lander("a1", 7, "mcc", ["controller/guard.mjs"]), green("g0")]));
  assert.equal(k3.act, "hold");
  assert.match(k3.act === "hold" ? k3.why : "", /K3/);
  assert.equal(k3.act === "hold" && k3.pr, 7);
  // 더 새 머지가 K3이면 그보다 오래된 머지를 건너뛰어 되돌리지 않는다(가장 새 것부터, 막히면 멈춘다)
  const newestK3 = revertDecisionOf(input([lander("a2", 8, "mcc", ["deploy/x.mjs"]), lander("a1", 7), green("g0")]));
  assert.equal(newestK3.act, "hold");
  // 바뀐 파일을 못 읽었으면 안전하게 hold
  assert.equal(revertDecisionOf(input([c("a1", { pr: 7, by: "mcc", files: null }), green("g0")])).act, "hold");
});

test("AIRPORT마다 하나: 열린 revert PR이 있으면 기다린다", () => {
  const d = revertDecisionOf(input([lander("a1", 7), green("g0")], { inflight: true }));
  assert.equal(d.act, "none");
});

test("breaker: 1시간 안에 새 빨간 head가 둘이면 멈춘다", () => {
  const lines: AutoRevertLine[] = [{ at: iso(40), op: "red", airport: "ATCC", head: "old1" }];
  const d = revertDecisionOf(input([lander("a1", 7), green("g0")], { lines }));
  assert.equal(d.act, "stop");
  // 1시간 넘게 지난 빨간 head는 세지 않는다
  assert.equal(revertDecisionOf(input([lander("a1", 7), green("g0")], { lines: [{ at: iso(61), op: "red", airport: "ATCC", head: "old1" }] })).act, "revert");
  // 다른 AIRPORT의 빨간 head는 세지 않는다
  assert.equal(revertDecisionOf(input([lander("a1", 7), green("g0")], { lines: [{ at: iso(10), op: "red", airport: "VCDO", head: "old1" }] })).act, "revert");
  // 같은 head를 다시 본 것은 하나다
  assert.equal(revertDecisionOf(input([lander("a1", 7), green("g0")], { lines: [{ at: iso(10), op: "red", airport: "ATCC", head: "a1" }] })).act, "revert");
});

test("breaker: 우리 revert 머지가 빨간 것은 새 빨간 head로 세지 않는다(같은 사고)", () => {
  const lines: AutoRevertLine[] = [
    { at: iso(30), op: "red", airport: "ATCC", head: "a3" },
    { at: iso(20), op: "revert-opened", airport: "ATCC", head: "a3", pr: 30, revertPr: 31 },
    { at: iso(10), op: "red", airport: "ATCC", head: "r1", own: true },
  ];
  assert.deepEqual(redHeadsOf(lines, "ATCC", NOW), ["a3"]);
  const d = revertDecisionOf(input([c("r1", { pr: 31, revert: true }), lander("a3", 30), lander("a2", 20), green("g0")], { lines }));
  assert.equal(d.act === "revert" && d.pr, 20);
});

test("breaker가 멈춘 채로는 되돌리지 않고, SUPERVISOR의 스위치(mode 줄)가 푼다", () => {
  const stop: AutoRevertLine = { at: iso(30), op: "stop", airport: "ATCC", head: "h" };
  assert.equal(stoppedOf([stop], "ATCC")?.op, "stop");
  assert.equal(stoppedOf([stop], "VCDO"), null);
  assert.equal(stoppedOf([stop, { at: iso(5), op: "mode", detail: "off → on" }], "ATCC"), null);
  assert.equal(revertDecisionOf(input([lander("a1", 7), green("g0")], { lines: [stop] })).act, "none");
  assert.equal(revertDecisionOf(input([lander("a1", 7), green("g0")], { lines: [stop, { at: iso(5), op: "mode" }] })).act, "revert");
});

test("마지막 초록 head에서 거슬러 오르기를 멈춘다: 초록 앞의 lander 머지는 후보가 아니다", () => {
  const d = revertDecisionOf(input([lander("a2", 8), green("g1"), lander("a1", 7)]));
  assert.equal(d.act === "revert" && d.pr, 8);
  // 헤드 바로 뒤가 초록이고 범위에 우리 revert만 있으면(범위가 비었다면) 하지 않는다
  assert.equal(revertDecisionOf(input([green("g1")])).act, "none");
});

test("lane 낮추기: AUTOLAND merge → update, MCC land → shadow(land+rts → rts). 이미 낮으면 건드리지 않는다", () => {
  assert.equal(lowerAutoland("merge"), "update");
  assert.equal(lowerAutoland("update"), null);
  assert.equal(lowerAutoland("off"), null);
  assert.equal(lowerMcc("land"), "shadow");
  assert.equal(lowerMcc("land+rts"), "rts");
  assert.equal(lowerMcc("rts"), null);
  assert.equal(lowerMcc("shadow"), null);
});

test("GROUND STOP은 우리 revert PR이 있던 빨간 head의 stop만, on에서만, 다음 초록 head에서 푼다", () => {
  const stops = [
    { airport: "VCDO", repo: "/r/v", sha: "red1" },
    { airport: "ATCC", repo: "/r/a", sha: "red2" },
  ];
  const lines: AutoRevertLine[] = [{ at: iso(10), op: "revert-opened", airport: "VCDO", head: "red1", pr: 3, revertPr: 4 }];
  const mains = [
    { repo: "/r/v", sha: "green1", state: "success" },
    { repo: "/r/a", sha: "green2", state: "success" },
  ];
  assert.deepEqual(clearableStops("on", stops, mains, lines).map((s) => s.airport), ["VCDO"]); // ATCC는 사람이 건 stop 같은 것이라 그대로
  assert.deepEqual(clearableStops("off", stops, mains, lines), []);
  // 아직 빨갛거나 같은 head거나 진행 중이면 풀지 않는다
  assert.deepEqual(clearableStops("on", stops, [{ repo: "/r/v", sha: "red1", state: "success" }], lines), []);
  assert.deepEqual(clearableStops("on", stops, [{ repo: "/r/v", sha: "r2", state: "failure" }], lines), []);
  assert.deepEqual(clearableStops("on", stops, [{ repo: "/r/v", sha: "g", state: "pending" }], lines), []);
});

test("우리 revert PR만 예외: 기록에 있고 GitHub의 revert 브랜치 이름일 때", () => {
  const lines: AutoRevertLine[] = [{ at: iso(1), op: "revert-opened", airport: "ATCC", head: "a1", pr: 7, revertPr: 8 }];
  assert.equal(isRevertPr(lines, "ATCC", 8, "revert-7-fix-x"), true);
  assert.equal(isRevertPr(lines, "ATCC", 8, "fix-x"), false); // 이름이 다르면 아니다
  assert.equal(isRevertPr(lines, "ATCC", 9, "revert-9-x"), false); // 기록에 없으면 아니다
  assert.equal(isRevertPr(lines, "VCDO", 8, "revert-7-x"), false); // 다른 AIRPORT
});

test("AUTOLAND: GROUND STOP이어도 CLEARED인 revert PR만 머지 후보, 나머지는 멈춘 채", () => {
  const pr = (number: number, branch: string): PullRequest => ({ repo: "/r/v", number, branch, head: `h${number}`, draft: false, landing: "CLEARED", blocks: [], readyAt: iso(5) }) as unknown as PullRequest;
  const st: AutolandState = { inflight: [], groundStops: [{ airport: "VCDO", repo: "/r/v", sha: "red", failing: ["x"], at: iso(9) }], clearedShas: [], skip: [], merged: [], reviewRequests: [] };
  const run = (pulls: PullRequest[], revert?: (p: PullRequest) => boolean, mode: "merge" | "update" = "merge") =>
    planAutoland({ cfg: { ...DEFAULT_AUTOLAND, mode }, airports: [{ code: "VCDO", repo: "/r/v" }], pulls, st, exclusionOf: () => null, now: NOW, revert });
  const isRev = (p: PullRequest) => p.number === 2;
  const view = run([pr(1, "feat"), pr(2, "revert-1-feat")], isRev);
  assert.equal(view.airports[0].status, "merge");
  assert.equal(view.airports[0].number, 2);
  assert.equal(run([pr(1, "feat")], isRev).airports[0].status, "groundstop");
  assert.equal(run([pr(1, "feat"), pr(2, "revert-1-feat")]).airports[0].status, "groundstop"); // 예외 함수가 없으면 막힌다(스위치 off)
  assert.equal(run([pr(1, "feat"), pr(2, "revert-1-feat")], isRev, "update").airports[0].status, "groundstop"); // update 모드는 머지하지 않는다
});

test("글: revert PR 제목에는 ATC key가 없고, FIX·DUTY 글은 영어다", () => {
  assert.doesNotMatch(revertTitleOf(7), /[A-Z]+-\d+/);
  const body = revertBodyOf({ pr: 7, prUrl: "https://github.com/o/r/pull/7", commit: "abcdef123456", head: "123456789", check: "check", by: "autoland" });
  assert.match(body, /AUTOLAND/);
  assert.match(body, /abcdef1/);
  assert.match(body, /failing check: check/);
  const fix = fixTextOf({ pr: 7, prUrl: "https://github.com/o/r/pull/7", flight: "ATC-9", check: "check", head: "123456789", revertPr: 8 });
  assert.match(fix, /ATC-9/);
  assert.match(fix, /failing check: check/);
  assert.match(fix, /revert PR #8/);
  assert.doesNotMatch(fix, /[ᄀ-ᇿ가-힯]/);
  assert.match(dutyLineOf({ at: iso(1), op: "revert-opened", airport: "ATCC", head: "123456789", pr: 7, revertPr: 8, check: "check" }) ?? "", /opened #8 reverting PR #7/);
  assert.match(dutyLineOf({ at: iso(1), op: "hold", airport: "ATCC", head: "123456789", detail: "K3" }) ?? "", /HOLD/);
  assert.match(dutyLineOf({ at: iso(1), op: "stop", airport: "ATCC", detail: "two reds" }) ?? "", /STOP/);
  assert.equal(dutyLineOf({ at: iso(1), op: "red", airport: "ATCC" }), null);
  assert.match(dutyLineOf({ at: iso(1), op: "flake", airport: "ATCC", head: "123456789", check: "check" }) ?? "", /flake caught/);
  assert.match(dutyLineOf({ at: iso(1), op: "misfire", airport: "ATCC", pr: 7, by2: 9, kind: "revert-of-revert" }) ?? "", /merged back unchanged/);
  assert.equal(dutyLineOf({ at: iso(1), op: "rerun", airport: "ATCC" }), null);
});

test("설정 창: 스위치 한 줄과 ⚠ 확인, 알림 목적지", () => {
  const segs = modeSegments(switchViews({ autoRevert: "on" }));
  const seg = segs.find((s) => s.key === "autoRevert");
  assert.equal(seg?.value, "on");
  assert.equal(seg?.warn, true);
  assert.equal(needsConfirm(swOf("autoRevert"), "off", "on"), true);
  assert.equal(needsConfirm(swOf("autoRevert"), "on", "off"), false);
  assert.ok((DEST_PREFIXES as readonly string[]).includes("revert"));
  assert.equal(destOf({ key: "revert|stop|ATCC|2026-10-02T00:00:00.000Z" }), "alerts");
});

// ── flake 방어(ATC-394) ──
const T = "2026-10-02T10:00:00.000Z";
const at = (min: number) => Date.parse(T) + min * 60_000;
const started = [{ id: 11, attempt: 1 }, { id: 12, attempt: 1 }];
const run = (id: number, attempt: number, status: string, conclusion: string | null) => ({ id, attempt, status, conclusion });

test("rerunVerdictOf: wait until every re-run run finished; green only when all passed; red if any fails", () => {
  assert.equal(rerunVerdictOf(started, [run(11, 2, "in_progress", null), run(12, 2, "completed", "success")], T, at(5)), "wait");
  assert.equal(rerunVerdictOf(started, [run(11, 2, "completed", "success"), run(12, 2, "completed", "success")], T, at(5)), "green"); // flake
  assert.equal(rerunVerdictOf(started, [run(11, 2, "completed", "success"), run(12, 2, "completed", "failure")], T, at(5)), "red");
});

test("rerunVerdictOf: a run whose attempt did not move yet still shows the OLD failure, so it is not a verdict", () => {
  assert.equal(rerunVerdictOf(started, [run(11, 1, "completed", "failure"), run(12, 1, "completed", "failure")], T, at(1)), "wait");
  assert.equal(rerunVerdictOf(started, [run(11, 1, "completed", "failure"), run(12, 1, "completed", "failure")], T, at(60)), "timeout");
  assert.equal(rerunVerdictOf(started, [], T, at(1)), "wait");
  assert.equal(rerunVerdictOf(started, [run(11, 2, "queued", null), run(12, 2, "queued", null)], T, at(RERUN_WAIT_MS / 60_000 + 1)), "timeout");
});

test("rerunOf: the re-run state of one head", () => {
  const lines: AutoRevertLine[] = [
    { at: T, op: "rerun", airport: "ATCC", head: "h1", runs: started },
    { at: T, op: "rerun", airport: "ATCC", head: "h2", runs: started },
    { at: T, op: "flake", airport: "ATCC", head: "h2" },
  ];
  assert.equal(rerunOf(lines, "ATCC", "h1").started?.runs?.length, 2);
  assert.equal(rerunOf(lines, "ATCC", "h1").flake, false);
  assert.equal(rerunOf(lines, "ATCC", "h2").flake, true);
  assert.equal(rerunOf(lines, "ATCC", "h3").started, null);
  assert.equal(rerunOf(lines, "OTHR", "h1").started, null);
});

test("a flake is not a red head: the breaker counts only heads that were red again", () => {
  // flake는 red 줄을 쓰지 않는다(확인된 빨강만 red). 그래서 한 시간에 flake가 둘이어도 breaker는 멈추지 않는다
  const lines: AutoRevertLine[] = [
    { at: iso(1), op: "flake", airport: "VCDO", head: "f1" },
    { at: iso(2), op: "flake", airport: "VCDO", head: "f2" },
  ];
  const d = revertDecisionOf(input([lander("r3", 7), green("g0")], { head: { sha: "r3", state: "failure", failing: ["check"] }, lines }));
  assert.equal(d.act, "revert"); // 첫 진짜 빨강이라 breaker가 아니라 되돌림
});

// ── misfire와 날짜별 수 ──
const files = [{ filename: "a.ts", sha: "s1" }, { filename: "b.ts", sha: "s2" }];

test("mergedBackOf: a revert of our revert, or the same files again, within 24 h counts as a misfire", () => {
  const revertedAt = "2026-10-02T10:00:00Z";
  assert.deepEqual(mergedBackOf({ files }, 8, revertedAt, [{ number: 9, branch: "revert-8-abc", mergedAt: "2026-10-02T12:00:00Z" }]), { pr: 9, kind: "revert-of-revert" });
  assert.deepEqual(mergedBackOf({ files }, 8, revertedAt, [{ number: 10, branch: "fix/x", mergedAt: "2026-10-02T12:00:00Z", files: [...files].reverse() }]), { pr: 10, kind: "same-files" });
  // 파일이 하나라도 다르면(수정해서 다시 올림) misfire가 아니다
  assert.equal(mergedBackOf({ files }, 8, revertedAt, [{ number: 10, branch: "fix/x", mergedAt: "2026-10-02T12:00:00Z", files: [files[0]!, { filename: "b.ts", sha: "other" }] }]), null);
  // 24시간이 지났거나 revert보다 먼저 머지된 것은 아니다
  assert.equal(mergedBackOf({ files }, 8, revertedAt, [{ number: 9, branch: "revert-8-abc", mergedAt: "2026-10-03T10:30:00Z" }]), null);
  assert.equal(mergedBackOf({ files }, 8, revertedAt, [{ number: 9, branch: "revert-8-abc", mergedAt: "2026-10-02T09:00:00Z" }]), null);
  // 원래 파일을 못 읽었으면 revert-of-revert만 본다. 다른 revert PR의 revert는 아니다
  assert.equal(mergedBackOf({ files: null }, 8, revertedAt, [{ number: 10, branch: "fix/x", mergedAt: "2026-10-02T12:00:00Z", files }]), null);
  assert.equal(mergedBackOf({ files }, 8, revertedAt, [{ number: 9, branch: "revert-80-abc", mergedAt: "2026-10-02T12:00:00Z" }]), null);
});

test("revertDaysOf: per UTC day, reverts, flakes caught and misfires", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const lines: AutoRevertLine[] = [
    { at: "2026-10-02T01:00:00Z", op: "revert-opened", airport: "ATCC", revertPr: 5 },
    { at: "2026-10-02T02:00:00Z", op: "flake", airport: "ATCC" },
    { at: "2026-10-02T03:00:00Z", op: "flake", airport: "ATCC" },
    { at: "2026-10-01T09:00:00Z", op: "misfire", airport: "ATCC" },
    { at: "2026-10-01T10:00:00Z", op: "hold", airport: "ATCC" },
    { at: "2026-09-20T10:00:00Z", op: "revert-opened", airport: "ATCC" }, // 창 밖
  ];
  const days = revertDaysOf(lines, 3, now);
  assert.deepEqual(days.map((d) => d.day), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(days[2], { day: "2026-10-02", reverts: 1, flakes: 2, misfires: 0, holds: 0, stops: 0 });
  assert.deepEqual(days[1], { day: "2026-10-01", reverts: 0, flakes: 0, misfires: 1, holds: 1, stops: 0 });
});

// ── flake 방어의 단계(cycle의 길을 정하는 순수 함수) ──
test("guardPhaseOf: fresh → rerunning → confirmed, and a head already decided (flake, hold, revert, stop) is skipped", () => {
  const L = (op: AutoRevertLine["op"], head = "h1", airport = "ATCC"): AutoRevertLine => ({ at: T, op, airport, head });
  assert.equal(guardPhaseOf([], "ATCC", "h1"), "fresh");
  assert.equal(guardPhaseOf([L("rerun")], "ATCC", "h1"), "rerunning");
  assert.equal(guardPhaseOf([L("rerun"), L("red")], "ATCC", "h1"), "confirmed");
  for (const op of ["flake", "hold", "revert-opened", "revert-failed", "stop"] as const) assert.equal(guardPhaseOf([L("rerun"), L(op)], "ATCC", "h1"), "decided", op);
  // 다른 head·다른 AIRPORT의 줄은 보지 않는다
  assert.equal(guardPhaseOf([L("flake", "h2"), L("flake", "h1", "OTHR")], "ATCC", "h1"), "fresh");
});

test("needsRerun: revert and breaker stop wait for a confirmed red; hold and none do not", () => {
  for (const act of ["revert", "stop"] as const) {
    assert.equal(needsRerun("fresh", act), true);
    assert.equal(needsRerun("rerunning", act), true);
    assert.equal(needsRerun("confirmed", act), false);
  }
  for (const act of ["hold", "none"] as const) assert.equal(needsRerun("fresh", act), false);
});

test("pollStepOf: green is a flake (nothing reverted), a re-run that never finishes holds, red is confirmed", () => {
  assert.equal(pollStepOf("wait"), "wait");
  assert.equal(pollStepOf("green"), "flake");
  assert.equal(pollStepOf("timeout"), "hold");
  assert.equal(pollStepOf("red"), "confirmed");
});

test("writeRed: only a confirmed red gets a red line, once (so a flake never counts toward the breaker)", () => {
  assert.equal(writeRed("fresh", false), false);
  assert.equal(writeRed("rerunning", false), false);
  assert.equal(writeRed("confirmed", false), true);
  assert.equal(writeRed("confirmed", true), false);
});

test("the whole path on two flaky heads in an hour: no red lines, so the third real red head reverts instead of tripping the breaker", () => {
  const lines: AutoRevertLine[] = [];
  for (const head of ["f1", "f2"]) {
    let phase = guardPhaseOf(lines, "VCDO", head);
    assert.equal(needsRerun(phase, "revert"), true);
    lines.push({ at: iso(5), op: "rerun", airport: "VCDO", head });
    phase = guardPhaseOf(lines, "VCDO", head);
    assert.equal(pollStepOf("green"), "flake");
    lines.push({ at: iso(4), op: "flake", airport: "VCDO", head });
    assert.equal(guardPhaseOf(lines, "VCDO", head), "decided");
  }
  assert.equal(lines.some((l) => l.op === "red"), false);
  const d = revertDecisionOf(input([lander("r3", 7), green("g0")], { head: { sha: "r3", state: "failure", failing: ["check"] }, lines }));
  assert.equal(d.act, "revert");
});
