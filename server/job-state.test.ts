import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { blockedAlerts, type Job, parseJob, readJob, sinceOf } from "./job-state.ts";

// 2026-09-29(Claude Code 2.1.284)의 state.json 모양. intent는 CREW BRIEFING 전체라 읽으면 안 된다
const base = {
  tempo: "idle", tokens: 12, template: "bg", name: "TEAM_I", sessionId: "b331700b-x", daemonShort: "b331700b", cliVersion: "2.1.284",
  cwd: "/x", createdAt: "2026-09-29T02:00:00.000Z", updatedAt: "2026-09-29T02:29:10.000Z", firstTerminalAt: null, lastTerminalAt: null,
  intent: "[ATC FLEET] CREW BRIEFING SECRET-BRIEFING", output: "SECRET-OUTPUT", providerEnv: { KEY: "SECRET-ENV" }, linkScanPath: "/SECRET/path",
};
const line = (at: string, state: string) => JSON.stringify({ at, state, detail: "", text: "" });

test("working: 상태와 한 줄만, needs·suggestedReply 없음", () => {
  const j = parseJob({ ...base, state: "working", detail: "PR 리뷰 중" }, null);
  assert.deepEqual(j, { state: "working", detail: "PR 리뷰 중", needs: null, suggestedReply: null, since: "2026-09-29T02:29:10.000Z" });
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
  assert.deepEqual(Object.keys(j!).sort(), ["detail", "needs", "since", "state", "suggestedReply"]);
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
