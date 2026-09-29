import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkAgent } from "./agent-guard.mjs";
import { CAP, capNotice, contextTokensOf } from "./context-cap.mjs";
import { checkInspector } from "./inspector-guard.mjs";
import { lastInspected, summarize, tokensOf } from "./packet-size.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const CTL = "node ../controller/atcctl.mjs";
const agent = readFileSync(new URL(".claude/agents/inspector.md", import.meta.url), "utf8");

test("inspector 정의: Opus, 읽기 도구만, hook은 fail-closed", () => {
  const front = agent.split("---")[1];
  assert.match(front, /^name: inspector$/m);
  assert.match(front, /^model: opus$/m);
  assert.match(front, /^tools: Read, Grep, Glob, Bash$/m);
  for (const t of ["Edit", "Write", "SendMessage", "Agent", "Artifact"]) assert.doesNotMatch(front.match(/^tools:.*$/m)[0], new RegExp(t));
  const cmds = [...front.matchAll(/command: (".*")$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(cmds.length, 2);
  assert.ok(cmds.every((c) => c.endsWith("|| exit 2")));
  assert.ok(cmds.some((c) => c.includes("inspector-guard.mjs")));
  assert.ok(cmds.some((c) => c.includes("read-guard.mjs")));
});

test("inspector Bash: mcc packet과 gh pr diff만. inspect·land·rts·escalate와 나머지는 막는다", () => {
  const ok = (c) => assert.equal(checkInspector(c, HERE), null, c);
  const no = (c) => assert.notEqual(checkInspector(c, HERE), null, c);
  ok(`${CTL} mcc packet 110`);
  ok("gh pr diff 110 --repo chaehy5665/atc");
  ok("gh pr diff 110 --repo chaehy5665/atc --name-only");
  for (const w of [
    `${CTL} mcc inspect 110 --head abc1234 --verdict pass -- 'ok'`,
    `${CTL} mcc escalate 110 -- 'x'`,
    `${CTL} mcc land 110 --head abc1234`,
    `${CTL} mcc rts`,
    `${CTL} mcc queue`,
    `${CTL} manual ack`,
    `${CTL} mcc packet 110 && ${CTL} mcc land 110 --head abc1234`,
    `${CTL} mcc packet 110; ${CTL} mcc rts`,
    `${CTL} mcc packet 110 | jq .`,
    "gh pr diff 110 --repo other/repo",
    "gh pr view 110 --repo chaehy5665/atc",
    "gh pr merge 110 --repo chaehy5665/atc",
    "git status",
    "cat /etc/passwd",
    "",
  ])
    no(w);
  assert.notEqual(checkInspector(undefined, HERE), null);
});

test("inspector 실행: 막는 명령과 입력을 못 읽을 때 exit 2, 허용 명령은 0", () => {
  const run = (input) => spawnSync("node", [`${HERE}/inspector-guard.mjs`], { input, cwd: HERE });
  assert.equal(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: `${CTL} mcc packet 1` }, cwd: HERE })).status, 0);
  assert.equal(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: `${CTL} mcc rts` }, cwd: HERE })).status, 2);
  assert.equal(run("not json").status, 2);
  assert.equal(run(JSON.stringify({ tool_name: "Read", tool_input: {} })).status, 2);
});

test("MCC Agent: inspector만 부른다", () => {
  assert.equal(checkAgent("Agent", { subagent_type: "inspector", prompt: "PR 1" }), null);
  assert.equal(checkAgent("Task", { subagent_type: "inspector" }), null);
  assert.notEqual(checkAgent("Agent", { subagent_type: "general-purpose" }), null);
  assert.notEqual(checkAgent("Agent", { prompt: "no name" }), null);
  assert.notEqual(checkAgent("Agent", undefined), null);
  const run = (input) => spawnSync("node", [`${HERE}/agent-guard.mjs`], { input });
  assert.equal(run(JSON.stringify({ tool_name: "Agent", tool_input: { subagent_type: "inspector" } })).status, 0);
  assert.equal(run(JSON.stringify({ tool_name: "Agent", tool_input: { subagent_type: "Explore" } })).status, 2);
  assert.equal(run("").status, 2);
});

const line = (u, extra = {}) => JSON.stringify({ type: "assistant", message: { usage: u }, ...extra });

test("컨텍스트 CAP: 마지막 요청의 input+cache read+cache write, 넘으면 안내", () => {
  assert.equal(contextTokensOf([]), null);
  assert.equal(contextTokensOf(["not json", JSON.stringify({ type: "user" })]), null);
  const lines = [line({ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }), JSON.stringify({ type: "user" }), line({ input_tokens: 1, cache_read_input_tokens: 149_000, cache_creation_input_tokens: 2000 })];
  assert.equal(contextTokensOf(lines), 151_001);
  // 사이드체인(하위 에이전트) 줄은 세션 컨텍스트가 아니다
  assert.equal(contextTokensOf([line({ input_tokens: 5000 }), line({ input_tokens: 900_000 }, { isSidechain: true })]), 5000);
  assert.equal(capNotice(null), null);
  assert.equal(capNotice(CAP), null);
  assert.match(capNotice(CAP + 1000), /STOP하고 LAUNCH/);
  assert.match(capNotice(200_000), /200k/);
});

test("컨텍스트 CAP hook: 기록이 크면 안내를 찍고, 어떤 경우에도 exit 0", () => {
  const run = (input) => spawnSync("node", [`${HERE}/context-cap.mjs`], { input });
  assert.equal(run("not json").status, 0);
  assert.equal(run(JSON.stringify({ transcript_path: "/nonexistent" })).status, 0);
  assert.equal(run("not json").stdout.toString(), "");
});

test("packet-size: 최근 n건 PR(마지막 INSPECTION 시각순)과 요약", () => {
  const recs = [
    { op: "inspect", pr: 1, at: "2026-01-01T00:00:01Z" },
    { op: "land", pr: 1, at: "2026-01-01T00:00:02Z" },
    { op: "inspect", pr: 2, at: "2026-01-01T00:00:03Z" },
    { op: "inspect", pr: 1, at: "2026-01-01T00:00:04Z" },
    { op: "inspect", pr: 3, at: "2026-01-01T00:00:05Z" },
  ];
  assert.deepEqual(lastInspected(recs, 2), [1, 3]);
  assert.deepEqual(lastInspected(recs, 10), [2, 1, 3]);
  assert.equal(tokensOf("x".repeat(400)), 100);
  assert.deepEqual(summarize([{ tokens: 100 }, { tokens: 300, cut: true }, { tokens: 200 }]), { n: 3, mean: 200, median: 200, p90: 300, max: 300, cut: 1 });
  assert.deepEqual(summarize([]), { n: 0, mean: 0, median: 0, p90: 0, max: 0, cut: 0 });
});
