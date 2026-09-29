import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { contextSizesOf, DEFAULT_PRICES_FILE, fuelDays, fuelFiles, parseAgentMeta, readFuelFile, readFuelHistory, readFuelRecords, readPrices, readStatusWindows } from "./fuel-run.ts";

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

test("readPrices: 저장소 표 위에 상태 폴더 표를 모델 단위로 덮고, 없는 덮개는 넘어가며, 깨진 파일은 errors로", () => {
  const dir = join(root, "prices");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, "base.json");
  const over = join(dir, "over.json");
  writeFileSync(base, JSON.stringify({ source: "base", writeMult: { "5m": 1.25, "1h": 2 }, models: { a: { in: 1, out: 2, readMult: 0.1 }, b: { in: 3, out: 4, readMult: 0.1 } } }));
  let p = readPrices([base, join(dir, "missing.json")]);
  assert.deepEqual(Object.keys(p.table.models).sort(), ["a", "b"]);
  assert.deepEqual(p.files, [base]);
  assert.deepEqual(p.errors, []);
  writeFileSync(over, JSON.stringify({ source: "local", models: { b: { in: 5, out: 6, readMult: 0.1 } } }));
  p = readPrices([base, over]);
  assert.equal(p.table.models.b.in, 5);
  assert.equal(p.table.models.a.in, 1);
  assert.equal(p.table.source, "local");
  writeFileSync(over, "{ broken");
  p = readPrices([base, over]);
  assert.equal(p.table.models.b.in, 3);
  assert.equal(p.errors.length, 1);
  assert.ok(p.errors[0].startsWith(`${over}: 읽지 못함`));
  assert.deepEqual(readPrices([join(dir, "none.json")]).errors, [`${join(dir, "none.json")}: 없음`]);
});

test("저장소 가격표(server/fuel-prices.json)는 오류 없이 읽힌다", () => {
  const p = readPrices([DEFAULT_PRICES_FILE]);
  assert.deepEqual(p.errors, []);
  assert.ok(p.table.source);
  assert.ok(Object.keys(p.table.models).length > 0);
  // Sonnet 5.5는 Sonnet 5와 정가가 같다
  assert.deepEqual(p.table.models["claude-sonnet-5-5"], p.table.models["claude-sonnet-5"]);
});

test("readFuelFile: /model 출력 줄을 세션의 modelCommands로 쌓는다(끝줄이 늦게 와도)", () => {
  const path = join(root, "modelcmd.jsonl");
  const f = { path, session: SID, crew: false, agent: null, mtime: 0 };
  const cmd = (t: string, model: string) => `${JSON.stringify({ type: "user", isSidechain: false, message: { role: "user", content: `<local-command-stdout>Set model to \`${model}\`</local-command-stdout>` }, timestamp: t, sessionId: SID })}\n`;
  writeFileSync(path, line("a") + cmd("2026-09-28T10:30:00Z", "claude-sonnet-5-5"));
  let r = readFuelFile(f);
  assert.deepEqual(r.state.modelCommands.map((c) => c.model), ["claude-sonnet-5-5"]);
  const c2 = cmd("2026-09-28T10:40:00Z", "claude-sonnet-5-5[1m]");
  appendFileSync(path, c2.slice(0, 30));
  assert.equal(readFuelFile(f).state.modelCommands.length, 1);
  appendFileSync(path, c2.slice(30));
  r = readFuelFile(f);
  assert.deepEqual(r.state.modelCommands.map((c) => c.model), ["claude-sonnet-5-5", "claude-sonnet-5-5[1m]"]);
  // contextSizesOf까지: 마지막 /model이 [1m]이라 120k라도 창은 1M
  const size = contextSizesOf({ records: r.state.records, compactions: [], modelCommands: r.state.modelCommands }, {}).get(SID)!;
  assert.deepEqual([size.window, size.windowSource], [1_000_000, "model-command"]);
});

test("readFuelRecords·readStatusWindows: 옛 줄과 새 줄이 섞인 fuel/ 폴더. FUEL REMAINING은 rate_limits, 창은 context_window_size가 있는 마지막 줄", () => {
  const dir = join(root, "fuel");
  mkdirSync(dir, { recursive: true });
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const RL = { five_hour: { used_percentage: 50, resets_at: 1790000000 } };
  const j = (o: object) => `${JSON.stringify(o)}\n`;
  // A: 옛 줄만(rate_limits만)
  writeFileSync(join(dir, `${A}.jsonl`), j({ t: "2026-09-28T10:00:00.000Z", sessionId: A, rate_limits: RL }));
  // B: 새 줄. 마지막 줄에는 rate_limits가 없다(API 키 경로로 바뀜)
  writeFileSync(join(dir, `${B}.jsonl`), j({ t: "2026-09-28T10:00:00.000Z", sessionId: B, rate_limits: RL, context_window_size: 1000000, model: "claude-opus-5-5" }) + j({ t: "2026-09-28T11:00:00.000Z", sessionId: B, context_window_size: 200000, model: "claude-sonnet-5-5" }));
  // C: 파일 이름과 sessionId가 다르다
  writeFileSync(join(dir, `${C}.jsonl`), j({ t: "2026-09-28T10:00:00.000Z", sessionId: A, rate_limits: RL, context_window_size: 200000 }));
  assert.deepEqual(readFuelRecords(dir).map((r) => [r.sessionId === A ? "A" : "B", r.t.slice(11, 13)]).sort(), [["A", "10"], ["B", "10"]]);
  const w = readStatusWindows(dir);
  assert.deepEqual([...w.keys()], [B]);
  assert.deepEqual(w.get(B), { t: "2026-09-28T11:00:00.000Z", window: 200000, model: "claude-sonnet-5-5" });
});

test("readFuelHistory: 세션의 statusline 기록 전체(파일 끝 512KB). 파일이 없거나 sessionId·이름이 다르거나 이상한 id면 빈 값(ATC-86)", () => {
  const dir = join(root, "fuel-history");
  mkdirSync(dir, { recursive: true });
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const RL = { five_hour: { used_percentage: 100, resets_at: 1790000000 } };
  const j = (o: object) => `${JSON.stringify(o)}\n`;
  writeFileSync(join(dir, `${A}.jsonl`), j({ t: "2026-09-28T17:00:00.000Z", sessionId: A, rate_limits: RL }) + j({ t: "2026-09-28T18:00:00.000Z", sessionId: A, rate_limits: RL, context_window_size: 1000000 }) + j({ t: "2026-09-28T19:00:00.000Z", sessionId: "other", rate_limits: RL }));
  const rows = readFuelHistory([A, "missing-session", "../etc/passwd"], dir);
  assert.deepEqual(rows.map((r) => r.t.slice(11, 13)), ["17", "18"]); // 다른 sessionId의 줄은 뺀다
});
