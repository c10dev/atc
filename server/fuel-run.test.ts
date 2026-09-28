import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fuelDays, fuelFiles, parseAgentMeta, readFuelFile } from "./fuel-run.ts";

const root = mkdtempSync(join(tmpdir(), "atc-fuel-"));
after(() => rmSync(root, { recursive: true, force: true }));

const SID = "11111111-1111-4111-8111-111111111111";
const line = (id: string, output = 5) =>
  `${JSON.stringify({
    type: "assistant",
    isSidechain: false,
    message: { id, model: "claude-opus-5-5", content: [{ type: "text", text: "body" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: output } },
    requestId: `req_${id}`,
    timestamp: "2026-09-28T10:00:00Z",
    sessionId: SID,
  })}\n`;

test("fuelFiles: 본 대화 기록과 subagents(workflows 아래까지)를 찾고, 기간 전에 바뀐 파일은 뺀다", () => {
  const proj = join(root, "projects", "-home-x");
  mkdirSync(join(proj, SID, "subagents", "workflows", "wf_1"), { recursive: true });
  writeFileSync(join(proj, `${SID}.jsonl`), line("m1"));
  writeFileSync(join(proj, SID, "subagents", "agent-abc.jsonl"), line("m2"));
  writeFileSync(join(proj, SID, "subagents", "agent-abc.meta.json"), "{}");
  writeFileSync(join(proj, SID, "subagents", "workflows", "wf_1", "agent-def.jsonl"), line("m3"));
  writeFileSync(join(proj, SID, "subagents", "workflows", "wf_1", "journal.jsonl"), line("m4"));
  writeFileSync(join(proj, "old.jsonl"), line("m5"));
  const old = new Date("2026-01-01T00:00:00Z");
  utimesSync(join(proj, "old.jsonl"), old, old);
  const files = fuelFiles(Date.parse("2026-09-01T00:00:00Z"), join(root, "projects"));
  assert.deepEqual(
    files.map((f) => [f.path.slice(proj.length + 1), f.session, f.crew, f.agent]).sort(),
    [
      [`${SID}.jsonl`, SID, false, null],
      [`${SID}/subagents/agent-abc.jsonl`, SID, true, "abc"],
      [`${SID}/subagents/workflows/wf_1/agent-def.jsonl`, SID, true, "def"],
    ].sort(),
  );
});

test("readFuelFile: 지난번 바이트 뒤만 읽고, 쓰다 만 끝줄은 다음에, 줄면 처음부터", () => {
  const path = join(root, "offset.jsonl");
  const f = { path, session: SID, crew: false, agent: null, mtime: 0 };
  writeFileSync(path, line("a") + line("b"));
  let r = readFuelFile(f);
  assert.equal(r.state.records.size, 2);
  assert.equal(r.bytes, (line("a") + line("b")).length);
  assert.equal(readFuelFile(f).bytes, 0);

  const c = line("c");
  appendFileSync(path, c.slice(0, 20)); // 쓰는 중
  r = readFuelFile(f);
  assert.equal(r.bytes, 0);
  assert.equal(r.state.records.size, 2);
  appendFileSync(path, c.slice(20));
  r = readFuelFile(f);
  assert.equal(r.bytes, c.length);
  assert.equal(r.state.records.size, 3);

  // 같은 요청의 더 큰 사본이 뒤에 붙으면 파일 안 기록이 바뀐다
  appendFileSync(path, line("c", 500));
  r = readFuelFile(f);
  assert.equal(r.state.records.size, 3);
  assert.equal(r.state.records.get("c|req_c")?.output, 500);

  writeFileSync(path, line("z"));
  r = readFuelFile(f);
  assert.deepEqual([...r.state.records.keys()], ["z|req_z"]);
});

test("readFuelFile: CREW 파일은 meta의 agentType·spawnDepth만 읽는다", () => {
  const dir = join(root, "crew");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent-q.jsonl"), line("q"));
  writeFileSync(join(dir, "agent-q.meta.json"), JSON.stringify({ agentType: "ui-qa", description: "secret brief", spawnDepth: 1 }));
  const r = readFuelFile({ path: join(dir, "agent-q.jsonl"), session: SID, crew: true, agent: "q", mtime: 0 });
  assert.deepEqual(r.state.meta, { agentType: "ui-qa", spawnDepth: 1 });
  assert.equal([...r.state.records.values()][0].sidechain, true);
  assert.equal(parseAgentMeta("{"), null);
});

test("fuelDays: 기본 7일, 1–30일", () => {
  assert.equal(fuelDays(undefined), 7);
  assert.equal(fuelDays("abc"), 7);
  assert.equal(fuelDays("0"), 7);
  assert.equal(fuelDays("3"), 3);
  assert.equal(fuelDays("400"), 30);
});
