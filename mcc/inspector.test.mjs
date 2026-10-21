import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkAgent } from "./agent-guard.mjs";
import { CAP, STEP, capNotice, contextTokensOf, lastNoticeTokensOf } from "./context-cap.mjs";
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
  assert.match(capNotice(CAP + 1000), /recycle\.mode/);
  assert.match(capNotice(200_000), /200k/);
});

// hook 출력은 대화 기록에 attachment(hook_success) 줄로 남는다
const noticeLine = (tokens) => JSON.stringify({ type: "attachment", attachment: { type: "hook_success", hookEvent: "UserPromptSubmit", stdout: `${capNotice(tokens)}\n`, content: capNotice(tokens) } });

test("컨텍스트 CAP: 한 세션에 한 번, 그 뒤로는 지난 안내보다 50k 더 커졌을 때만", () => {
  assert.equal(STEP, 50_000);
  assert.equal(lastNoticeTokensOf([]), null);
  assert.equal(lastNoticeTokensOf([noticeLine(154_321)]), 154_000);
  assert.equal(lastNoticeTokensOf([noticeLine(151_000), line({ input_tokens: 1 }), noticeLine(203_000)]), 203_000);
  // 매뉴얼·프롬프트에 든 같은 글자는 안내가 아니다
  const manual = JSON.stringify({ type: "attachment", attachment: { type: "instructions", files: [{ content: "`[MCC CONTEXT CAP] …` 안내" }] } });
  const prompt = JSON.stringify({ type: "user", message: { content: capNotice(190_000) } });
  assert.equal(lastNoticeTokensOf([manual, prompt, "not json [MCC CONTEXT CAP]"]), null);
  // 첫 안내는 CAP을 넘을 때, 다음은 50k 더 커졌을 때
  assert.match(capNotice(151_000, null), /151k/);
  assert.equal(capNotice(170_000, 151_000), null);
  assert.equal(capNotice(200_999, 151_000), null);
  assert.match(capNotice(201_000, 151_000), /201k/);
  assert.equal(capNotice(140_000, 151_000), null); // CAP 아래면 지난 안내와 상관없이 없음
});

test("컨텍스트 CAP hook: 지난 안내가 대화 기록에 있으면 50k 더 커질 때까지 조용하다", () => {
  const dir = mkdtempSync(join(tmpdir(), "context-cap-"));
  try {
    const run = (lines) => {
      const path = join(dir, "t.jsonl");
      writeFileSync(path, lines.join("\n") + "\n");
      const r = spawnSync("node", [`${HERE}/context-cap.mjs`], { input: JSON.stringify({ transcript_path: path }) });
      return [r.status, r.stdout.toString()];
    };
    const ctx = (n) => line({ input_tokens: 1, cache_read_input_tokens: n - 1 });
    assert.deepEqual(run([ctx(100_000)]), [0, ""]);
    const [first, out] = run([ctx(160_000)]);
    assert.equal(first, 0);
    assert.match(out, /^\[MCC CONTEXT CAP\] 이 세션의 컨텍스트가 160k 토큰으로/);
    assert.deepEqual(run([ctx(160_000), noticeLine(160_000), ctx(209_000)]), [0, ""]);
    assert.match(run([ctx(160_000), noticeLine(160_000), ctx(210_000)])[1], /210k/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
