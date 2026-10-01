import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { dayLineOf, type Deps, forEachLine, mountSkillUsage, readDayLines, readSessionCalls, runSkillUsage, skillUsageView, START_DAY } from "./skill-calls-run.ts";

// 가짜 대화 기록을 임시 폴더에 만든다. 실제 ~/.claude* 폴더는 읽지 않는다.
const asst = (at: string, name: string, input: object) => JSON.stringify({ type: "assistant", timestamp: at, message: { content: [{ type: "tool_use", id: "t", name, input }] } });
const human = (at: string) => JSON.stringify({ type: "user", timestamp: at, message: { content: "hi SECRET-BODY" } });
const agentName = (n: string) => JSON.stringify({ type: "agent-name", agentName: n });

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "atc-skill-calls-"));
  const repo = "/srv/atc";
  mkdirSync(join(root, "-srv-atc-controller"), { recursive: true });
  mkdirSync(join(root, "-srv-other-repo"), { recursive: true });
  // TEAM_G: GO AROUND가 이름 붙은 뒤 올바른 skill을 연다(이름공간 있는 플러그인 skill)
  writeFileSync(
    join(root, "-srv-other-repo", "g1.jsonl"),
    [agentName("TEAM_G"), human("2026-10-01T05:00:03.000Z"), asst("2026-10-01T05:00:20.000Z", "Skill", { skill: "atc-rulebook:qrh-04-go-around" }), asst("2026-10-01T05:01:00.000Z", "Agent", { subagent_type: "Explore", prompt: "x" })].join("\n") + "\n",
  );
  // TEAM_H: 다른 qrh-*를 연다
  writeFileSync(join(root, "-srv-other-repo", "h1.jsonl"), [agentName("TEAM_H"), asst("2026-10-01T05:00:30.000Z", "Skill", { skill: "qrh-02-stalled" })].join("\n") + "\n");
  // TEAM_I: 아무것도 열지 않는다
  writeFileSync(join(root, "-srv-other-repo", "i1.jsonl"), [agentName("TEAM_I"), human("2026-10-01T05:00:03.000Z"), asst("2026-10-01T05:00:30.000Z", "Bash", { command: "ls" })].join("\n") + "\n");
  // TOWER 폴더의 기록: 이름은 없고 폴더로 역할을 안다
  writeFileSync(join(root, "-srv-atc-controller", "t1.jsonl"), asst("2026-10-01T06:00:00.000Z", "Skill", { skill: "tick" }) + "\n");
  return { root, repo };
}
const named = (aircraft: string) => ({ t: "2026-10-01T05:00:00.000Z", id: "qrh-04-go-around", aircraft, subject: `C-${aircraft}` });

test("forEachLine: 줄 단위로 흘려 읽고, 마지막 줄(개행 없음)도 주며, 빈 줄도 건너뛰지 않고 그대로 준다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-skill-calls-"));
  try {
    const f = join(dir, "a.jsonl");
    writeFileSync(f, "one\ntwo\n\nlast");
    const got: string[] = [];
    forEachLine(f, (l) => got.push(l));
    assert.deepEqual(got, ["one", "two", "", "last"]);
    // 1 MB 읽기 경계를 넘는 줄
    const big = "x".repeat(2_500_000);
    writeFileSync(f, `${big}\nsmall\n`);
    const lens: number[] = [];
    forEachLine(f, (l) => lens.push(l.length));
    assert.deepEqual(lens, [2_500_000, 5]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSessionCalls: 세션 이름과 호출을 읽고(역할은 폴더로), 본문은 담지 않고, 기록 파일은 그대로다", () => {
  const { root, repo } = fixtureRoot();
  try {
    const before = readFileSync(join(root, "-srv-other-repo", "g1.jsonl"), "utf8");
    const stats = { files: 0, skipped: 0 };
    const s = readSessionCalls(0, [root], repo, stats);
    assert.equal(stats.files, 4);
    const by = Object.fromEntries(s.map((x) => [x.session, x]));
    assert.equal(by.g1!.reg, "TEAM_G");
    assert.deepEqual(by.g1!.calls.map((c) => [c.kind, c.name]), [["skill", "atc-rulebook:qrh-04-go-around"], ["agent", "Explore"]]);
    assert.equal(by.t1!.role, "tower");
    assert.equal(by.t1!.reg, null);
    assert.equal(JSON.stringify(s).includes("SECRET"), false);
    assert.equal(readFileSync(join(root, "-srv-other-repo", "g1.jsonl"), "utf8"), before);
    // since 뒤에 바뀌지 않은 파일은 읽지 않는다, 없는 폴더는 빈 목록
    assert.deepEqual(readSessionCalls(Date.now() + 60_000, [root], repo), []);
    assert.deepEqual(readSessionCalls(0, [join(root, "missing")], repo), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dayLineOf: 호출 수와 named → opened / opened-other / not-opened / no-transcript", () => {
  const { root, repo } = fixtureRoot();
  try {
    const sessions = readSessionCalls(0, [root], repo);
    const line = dayLineOf("2026-10-01", { sessions, named: [named("TEAM_G"), named("TEAM_H"), named("TEAM_I"), named("TEAM_Z"), { ...named("TEAM_G"), t: "2026-10-02T05:00:00.000Z" }] }, "2026-10-02T01:00:00.000Z");
    assert.deepEqual(line.skills, { "atc-rulebook:qrh-04-go-around": 1, "qrh-02-stalled": 1, tick: 1 });
    assert.deepEqual(line.agents, { Explore: 1 });
    assert.equal(line.sessions, 3);
    assert.deepEqual(line.qrh, { named: 4, opened: 1, openedOther: 1, notOpened: 1, noTranscript: 1, openedRate: 1 / 3 });
    assert.deepEqual(line.bySession.TOWER, { skills: 1, agents: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function depsIn(dir: string, nowIso: string, inputs = { sessions: [] as never[], named: [] as never[] }): Deps & { loads: number[] } {
  const loads: number[] = [];
  return { loads, now: () => Date.parse(nowIso), load: (since) => (loads.push(since), inputs), file: () => join(dir, "skill-usage.jsonl") };
}

test("runSkillUsage: START_DAY부터 빠진 날을 채우고(하루가 끝나고 판정 창이 닫힌 뒤), 다시 돌려도 같은 날을 두 번 쓰지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-skill-calls-"));
  try {
    assert.equal(START_DAY, "2026-10-01");
    // 아직 10-01이 끝나지 않았다
    const d0 = depsIn(dir, "2026-10-01T12:00:00.000Z");
    assert.deepEqual(runSkillUsage(d0), { written: [], skipped: [] });
    assert.deepEqual(d0.loads, []);
    // 10-02 00:05 — 하루는 끝났지만 마지막 qrh.named의 창(10분)이 아직 열려 있다
    assert.deepEqual(runSkillUsage(depsIn(dir, "2026-10-02T00:05:00.000Z")).written, []);
    const d1 = depsIn(dir, "2026-10-03T01:00:00.000Z");
    assert.deepEqual(runSkillUsage(d1).written, ["2026-10-01", "2026-10-02"]);
    assert.deepEqual(d1.loads, [Date.parse("2026-10-01T00:00:00Z")]);
    assert.deepEqual(runSkillUsage(depsIn(dir, "2026-10-03T02:00:00.000Z")).written, []);
    const lines = readDayLines(join(dir, "skill-usage.jsonl"));
    assert.deepEqual(lines.map((l) => l.day), ["2026-10-01", "2026-10-02"]);
    assert.deepEqual(lines[0]!.qrh, { named: 0, opened: 0, openedOther: 0, notOpened: 0, noTranscript: 0, openedRate: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/skills/usage: 저장된 줄과 오늘의 부분 집계를 주고, days가 틀리면 400", async () => {
  const { root, repo } = fixtureRoot();
  const dir = mkdtempSync(join(tmpdir(), "atc-skill-calls-"));
  try {
    const sessions = readSessionCalls(0, [root], repo);
    const inputs = { sessions, named: [named("TEAM_G"), named("TEAM_H"), named("TEAM_I")] };
    const deps = depsIn(dir, "2026-10-01T12:00:00.000Z", inputs as never);
    const app = new Hono();
    mountSkillUsage(app, deps);
    const res = await app.request("/api/skills/usage?days=3");
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReturnType<typeof skillUsageView>;
    assert.deepEqual(body.days, []);
    assert.equal(body.today.day, "2026-10-01");
    assert.equal(body.today.partial, true);
    assert.deepEqual(body.today.skills, { "atc-rulebook:qrh-04-go-around": 1, "qrh-02-stalled": 1, tick: 1 });
    assert.deepEqual(body.today.agents, { Explore: 1 });
    assert.deepEqual(body.today.qrh, { named: 3, opened: 1, openedOther: 1, notOpened: 1, noTranscript: 0, openedRate: 1 / 3 });
    assert.equal((await app.request("/api/skills/usage?days=0")).status, 400);
    assert.equal((await app.request("/api/skills/usage?days=x")).status, 400);
    // 저장된 날은 오늘 앞의 것만 days만큼
    const stored = depsIn(dir, "2026-10-03T12:00:00.000Z", inputs as never);
    runSkillUsage(stored);
    const v = skillUsageView(1, stored);
    assert.deepEqual(v.days.map((l) => l.day), ["2026-10-02"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
