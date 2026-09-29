import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { blockedAlerts, type Job, parseJob, readJob, settleJob, sinceOf } from "./job-state.ts";

// 2026-09-29(Claude Code 2.1.284)의 state.json 모양. intent는 CREW BRIEFING 전체라 읽으면 안 된다
const base = {
  tempo: "idle", tokens: 12, template: "bg", name: "TEAM_I", sessionId: "b331700b-x", daemonShort: "b331700b", cliVersion: "2.1.284",
  cwd: "/x", createdAt: "2026-09-29T02:00:00.000Z", updatedAt: "2026-09-29T02:29:10.000Z", firstTerminalAt: null, lastTerminalAt: null,
  intent: "[ATC FLEET] CREW BRIEFING SECRET-BRIEFING", output: "SECRET-OUTPUT", providerEnv: { KEY: "SECRET-ENV" }, linkScanPath: "/SECRET/path",
};
const line = (at: string, state: string) => JSON.stringify({ at, state, detail: "", text: "" });

test("working: 상태와 한 줄만, needs·suggestedReply 없음", () => {
  const j = parseJob({ ...base, state: "working", detail: "PR 리뷰 중" }, null);
  assert.deepEqual(j, { state: "working", detail: "PR 리뷰 중", needs: null, suggestedReply: null, since: "2026-09-29T02:29:10.000Z", tempo: "idle", writtenAt: "2026-09-29T02:29:10.000Z" });
});

test("blocked: needs·suggestedReply를 싣는다", () => {
  const j = parseJob({ ...base, state: "blocked", tempo: "blocked", detail: "PR open; awaiting merge", needs: "message when PR merges", suggestedReply: "PR merged, continue" }, null);
  assert.equal(j?.state, "blocked");
  assert.equal(j?.needs, "message when PR merges");
  assert.equal(j?.suggestedReply, "PR merged, continue");
});

test("done·stopped·failed는 needs를 싣지 않는다(옛 needs가 남아 있어도)", () => {
  for (const state of ["done", "stopped", "failed"]) {
    const j = parseJob({ ...base, state, detail: state, needs: "stale need", suggestedReply: "stale" }, null);
    assert.equal(j?.state, state);
    assert.equal(j?.needs, null);
    assert.equal(j?.suggestedReply, null);
  }
});

test("모르는 state·모양은 null, 모르는 필드는 무시", () => {
  assert.equal(parseJob({ ...base, state: "hibernating" }), null);
  assert.equal(parseJob({ detail: "x" }), null);
  assert.equal(parseJob(null), null);
  assert.equal(parseJob("working"), null);
  assert.equal(parseJob([]), null);
  const j = parseJob({ ...base, state: "working", futureField: { a: 1 }, detail: 5 });
  assert.equal(j?.detail, "");
  assert.deepEqual(Object.keys(j!).sort(), ["detail", "needs", "since", "state", "suggestedReply", "tempo", "writtenAt"]);
});

test("intent·output·providerEnv·linkScanPath는 결과 어디에도 없다", () => {
  const j = parseJob({ ...base, state: "blocked", detail: "d", needs: "n", suggestedReply: "r" }, line("2026-09-29T02:10:00.000Z", "blocked"));
  const text = JSON.stringify(j);
  for (const secret of ["SECRET-BRIEFING", "SECRET-OUTPUT", "SECRET-ENV", "SECRET/path", "CREW BRIEFING"]) assert.ok(!text.includes(secret), secret);
});

test("since: timeline 끝에서 지금 state가 이어진 첫 줄", () => {
  const tl = [
    line("2026-09-29T01:00:00.000Z", "working"),
    line("2026-09-29T01:10:00.000Z", "blocked"),
    line("2026-09-29T01:20:00.000Z", "working"),
    line("2026-09-29T01:30:00.000Z", "blocked"),
    line("2026-09-29T01:40:00.000Z", "blocked"),
  ].join("\n");
  assert.equal(sinceOf(tl, "blocked"), "2026-09-29T01:30:00.000Z");
  assert.equal(sinceOf(tl, "working"), null); // 마지막 줄이 다른 state면 모른다
  assert.equal(sinceOf(`{"at":"broken\n${tl}`, "blocked"), "2026-09-29T01:30:00.000Z"); // 잘린 첫 줄
  assert.equal(sinceOf(line("2026-09-29T01:00:00.000Z", "working"), "working"), "2026-09-29T01:00:00.000Z");
  assert.equal(sinceOf("", "working"), null);
  // timeline이 없으면 updatedAt
  assert.equal(parseJob({ ...base, state: "working" }, "")?.since, "2026-09-29T02:29:10.000Z");
  assert.equal(parseJob({ ...base, state: "blocked" }, tl)?.since, "2026-09-29T01:30:00.000Z");
});

test("긴 글과 제어 문자는 자르고 지운다", () => {
  const j = parseJob({ ...base, state: "blocked", detail: `a\u0007b${"x".repeat(500)}`, needs: "  ", suggestedReply: "y".repeat(900) });
  assert.ok(j!.detail.length <= 300 && !j!.detail.includes("\u0007"));
  assert.equal(j!.needs, null);
  assert.equal(j!.suggestedReply!.length, 600);
});

test("readJob: 파일이 없거나 깨졌거나 id가 이상하면 null, 바뀌면 다시 읽는다, 읽기만 한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-jobs-"));
  assert.equal(readJob("b331700b", dir), null); // 없음
  assert.equal(readJob("../etc", dir), null);
  assert.equal(readJob(null, dir), null);
  mkdirSync(join(dir, "b331700b"));
  writeFileSync(join(dir, "b331700b", "state.json"), "{not json");
  assert.equal(readJob("b331700b", dir), null); // 깨짐
  writeFileSync(join(dir, "b331700b", "state.json"), JSON.stringify({ ...base, state: "working", detail: "일하는 중" }));
  assert.equal(readJob("b331700b", dir)?.detail, "일하는 중");
  writeFileSync(join(dir, "b331700b", "state.json"), JSON.stringify({ ...base, state: "blocked", detail: "기다림", needs: "답 필요" }));
  writeFileSync(join(dir, "b331700b", "timeline.jsonl"), `${line("2026-09-29T02:00:00.000Z", "working")}\n${line("2026-09-29T02:05:00.000Z", "blocked")}\n`);
  const j = readJob("b331700b", dir);
  assert.equal(j?.state, "blocked");
  assert.equal(j?.since, "2026-09-29T02:05:00.000Z");
});

test("BLOCKED 경보: 기준 분 미만은 없고, 넘으면 needs와 함께, blocked를 벗어나면 사라진다", () => {
  const now = Date.parse("2026-09-29T03:00:00.000Z");
  const blocked = (minAgo: number): Job => ({ state: "blocked", detail: "d", needs: "message when PR merges", suggestedReply: null, since: new Date(now - minAgo * 60_000).toISOString() });
  const x = (job: Job | null) => [{ id: "s1", name: "TEAM_I", job }];
  assert.deepEqual(blockedAlerts(x(blocked(2)), now, 3), []);
  const over = blockedAlerts(x(blocked(5)), now, 3);
  assert.equal(over.length, 1);
  assert.equal(over[0].key, "health|BLOCKED|s1");
  assert.deepEqual(over[0].sessionIds, ["s1"]);
  assert.match(over[0].message, /BLOCKED — TEAM_I이 5분째 사람을 기다림: message when PR merges/);
  assert.match(over[0].message, /claude attach/);
  assert.equal(blockedAlerts(x(blocked(3)), now, 3).length, 1); // 딱 기준
  // 풀림: working이 되거나 job이 없으면 경보 없음
  assert.deepEqual(blockedAlerts(x({ ...blocked(9), state: "working", needs: null }), now, 3), []);
  assert.deepEqual(blockedAlerts(x(null), now, 3), []);
  // since를 모르면 세지 않는다
  assert.deepEqual(blockedAlerts(x({ ...blocked(9), since: null }), now, 3), []);
});

// ATC-133: 답한 뒤에도 blocked로 남은 job
const stale = (over: Partial<Job> = {}): Job => ({ state: "blocked", detail: "SUPERVISOR의 답 그대로", needs: "message when PR merges", suggestedReply: "go", since: "2026-09-29T07:04:00.000Z", tempo: "blocked", ...over });

test("settleJob: tempo가 active면 blocked는 끝났다 — working으로 보이고 파일의 원래 모습은 남긴다 (H)", () => {
  const j = settleJob(stale({ tempo: "active" }), null)!;
  assert.equal(j.state, "working");
  assert.equal(j.detail, ""); // 답한 글을 요청처럼 보이지 않는다
  assert.equal(j.needs, null);
  assert.equal(j.suggestedReply, null);
  assert.deepEqual(j.settled, { from: "blocked", since: "2026-09-29T07:04:00.000Z", reason: "tempo", resumedAt: null });
});

test("settleJob: since 뒤의 대화 기록 활동이 있으면 tempo가 idle이어도 working (J)", () => {
  const j = settleJob(stale({ tempo: "idle" }), "2026-09-29T07:05:00.000Z")!;
  assert.equal(j.state, "working");
  assert.deepEqual(j.settled, { from: "blocked", since: "2026-09-29T07:04:00.000Z", reason: "turn", resumedAt: "2026-09-29T07:05:00.000Z" });
});

test("settleJob: 진짜 blocked는 그대로 — 뒤 턴이 없거나 blocked 때 마지막 턴(GRACE 안)뿐이다", () => {
  for (const tempo of ["blocked", "idle"]) {
    const j = stale({ tempo });
    assert.equal(settleJob(j, null), j);
    assert.equal(settleJob(j, "2026-09-29T07:03:00.000Z"), j); // 이전 활동
    assert.equal(settleJob(j, "2026-09-29T07:04:10.000Z"), j); // 마지막 턴의 꼬리(GRACE 30초 안)
  }
  const w: Job = { ...stale(), state: "working", needs: null, suggestedReply: null };
  assert.equal(settleJob(w, "2026-09-29T09:00:00.000Z"), w);
  assert.equal(settleJob(null, null), null);
});

test("BLOCKED 경보: 이미 일하는 blocked job은 울리지 않고, 진짜 blocked는 울린다. detail은 요청으로 쓰지 않는다", () => {
  const now = Date.parse("2026-09-29T07:30:00.000Z");
  const run = (job: Job, lastActiveAt: string | null) => blockedAlerts([{ id: "s1", name: "TEAM_H", job, lastActiveAt }], now, 3);
  assert.deepEqual(run(stale({ tempo: "active" }), null), []);
  assert.deepEqual(run(stale({ tempo: "idle" }), "2026-09-29T07:20:00.000Z"), []);
  const real = run(stale({ tempo: "blocked" }), "2026-09-29T07:04:00.000Z");
  assert.equal(real.length, 1);
  assert.match(real[0].message, /26분째 사람을 기다림: message when PR merges/);
  assert.doesNotMatch(run(stale({ needs: null }), null)[0].message, /SUPERVISOR의 답/);
});

test("parseJob: tempo를 싣는다", () => {
  assert.equal(parseJob({ ...base, state: "blocked", tempo: "active" })?.tempo, "active");
  assert.equal(parseJob({ state: "blocked" })?.tempo, null);
});

// ATC-138: working을 거치지 않고 다시 blocked가 되면 since는 옛 기다림이다 — 가장 최근에 쓴 때와 견준다
test("settleJob: 07:24부터 blocked, 그 뒤 턴들, 07:44에 새 needs로 다시 blocked(tempo blocked)면 NEEDS YOU (H)", () => {
  const reblocked = stale({ since: "2026-09-29T07:24:00.000Z", writtenAt: "2026-09-29T07:44:00.000Z", needs: "new: which branch should I use?", detail: "waiting for the answer", tempo: "blocked" });
  assert.equal(settleJob(reblocked, "2026-09-29T07:40:00.000Z"), reblocked); // 사이의 턴
  assert.equal(settleJob(reblocked, "2026-09-29T07:44:10.000Z"), reblocked); // blocked를 쓴 턴의 꼬리(GRACE 안)
  assert.equal(settleJob(reblocked, "2026-09-29T07:58:00.000Z"), reblocked); // 그 뒤 턴이 있어도 tempo가 blocked이고 needs가 있으면 끝난 것이 아니다
  assert.equal(settleJob(reblocked, null), reblocked);
});

test("settleJob: tempo가 blocked가 아니어도 턴이 쓴 때보다 이르면 아직 기다림, 늦으면 끝남", () => {
  const j = stale({ since: "2026-09-29T07:24:00.000Z", writtenAt: "2026-09-29T07:44:00.000Z", tempo: "idle" });
  assert.equal(settleJob(j, "2026-09-29T07:40:00.000Z"), j); // 07:24 뒤이지만 07:44에 다시 적은 것보다 이르다
  const done = settleJob(j, "2026-09-29T07:50:00.000Z")!;
  assert.equal(done.state, "working");
  assert.deepEqual(done.settled, { from: "blocked", since: "2026-09-29T07:24:00.000Z", reason: "turn", resumedAt: "2026-09-29T07:50:00.000Z" });
  // tempo가 blocked이면(needs가 비었어도) 턴만으로는 끝난 것으로 보지 않는다
  const empty = stale({ tempo: "blocked", needs: null });
  assert.equal(settleJob(empty, "2026-09-29T09:00:00.000Z"), empty);
  // 쓴 때를 모르면 since로 견준다(ATC-133 그대로)
  assert.equal(settleJob(stale({ tempo: "idle", writtenAt: null }), "2026-09-29T07:05:00.000Z")!.state, "working");
  // tempo가 active면 언제나 끝남
  assert.equal(settleJob(stale({ tempo: "active", writtenAt: "2026-09-29T07:44:00.000Z" }), null)!.state, "working");
});

test("BLOCKED 경보: 다시 blocked가 된 진짜 기다림과 오래된 진짜 기다림은 울리고, 답 뒤 일하는 job은 울리지 않는다", () => {
  const now = Date.parse("2026-09-29T08:00:00.000Z");
  const run = (job: Job, lastActiveAt: string | null) => blockedAlerts([{ id: "s1", name: "TEAM_H", job, lastActiveAt }], now, 3);
  const reblocked = stale({ since: "2026-09-29T07:24:00.000Z", writtenAt: "2026-09-29T07:44:00.000Z", needs: "new needs", tempo: "blocked" });
  const a = run(reblocked, "2026-09-29T07:50:00.000Z");
  assert.equal(a.length, 1);
  assert.match(a[0].message, /new needs/);
  // 오래된 진짜 기다림: 몇 시간이어도 울린다
  assert.equal(run(stale({ since: "2026-09-29T02:00:00.000Z", writtenAt: "2026-09-29T02:00:00.000Z", tempo: "blocked" }), "2026-09-29T02:00:00.000Z").length, 1);
  assert.equal(run(stale({ since: "2026-09-29T02:00:00.000Z", writtenAt: "2026-09-29T02:00:00.000Z", tempo: "idle" }), "2026-09-29T02:00:00.000Z").length, 1);
  // 답한 뒤 일하는 job(ATC-133)은 그대로 울리지 않는다
  assert.deepEqual(run(stale({ tempo: "idle" }), "2026-09-29T07:20:00.000Z"), []);
});

test("parseJob: writtenAt은 updatedAt, 없으면 파일 mtime, 둘 다 없으면 null", () => {
  assert.equal(parseJob({ state: "blocked", updatedAt: "2026-09-29T07:44:00.000Z" }, null, Date.parse("2026-09-29T07:50:00.000Z"))?.writtenAt, "2026-09-29T07:44:00.000Z");
  assert.equal(parseJob({ state: "blocked" }, null, Date.parse("2026-09-29T07:50:00.000Z"))?.writtenAt, "2026-09-29T07:50:00.000Z");
  assert.equal(parseJob({ state: "blocked" })?.writtenAt, null);
});
