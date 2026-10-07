import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { config } from "./config.ts";
import { FUEL_CACHE_FORMAT, pruneShards, shardName } from "./fuel-cache.ts";
import { dropFuelMemory, flushFuelCache, freshEnough, fuelChangeSeq, fuelFiles, projectsRoots, scanFuel, startFuelCache, startFuelWatch, stopFuelCache } from "./fuel-run.ts";
import { classifyFuelPath, FuelTree } from "./fuel-tree.ts";

// FUEL 읽기 캐시와 감시(ATC-83). 임시 ~/.claude(config.claudeDir)와 임시 캐시 폴더만 쓴다. 진짜 ~/.cache/atc는 건드리지 않는다
// 상태 폴더도 임시로 둔다: 운영 fleet.json의 ACCOUNT 등록부를 읽으면 진짜 transcript까지 훑어 메모리가 수십 GB로 부푼다(2026-09-30 OOM)
const root = mkdtempSync(join(tmpdir(), "atc-fuelcache-"));
const realClaudeDir = config.claudeDir;
const realStateDir = config.stateDir;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
const projects = join(config.claudeDir, "projects");
const cacheDir = join(root, "cache", "fuel");
after(() => {
  stopFuelCache();
  config.claudeDir = realClaudeDir;
  config.stateDir = realStateDir;
  rmSync(root, { recursive: true, force: true });
});

test("FUEL이 훑는 폴더는 모두 임시 폴더 안이다(운영 ACCOUNT 등록부를 읽지 않는다)", () => {
  assert.deepEqual(projectsRoots(), [projects]);
});

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const BODY = "SECRET-BODY-TEXT-do-not-cache";
const req = (id: string, session: string, over: { out?: number; side?: boolean; requestId?: string | null; model?: string; t?: string } = {}) =>
  `${JSON.stringify({
    type: "assistant",
    isSidechain: over.side ?? false,
    message: { id, model: over.model ?? "claude-opus-5-5", content: [{ type: "text", text: BODY }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: over.out ?? 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: 40 } } },
    ...(over.requestId === null ? {} : { requestId: over.requestId ?? `req_${id}` }),
    timestamp: over.t ?? "2026-09-28T10:00:00Z",
    sessionId: session,
    version: "2.1.284",
  })}\n`;
const compact = (session: string) => `${JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: "2026-09-28T10:30:00Z", sessionId: session, compactMetadata: { trigger: "auto", preTokens: 900, postTokens: 90 } })}\n`;
const named = (name: string) => `${JSON.stringify({ type: "agent-name", agentName: name })}\n`;
const modelCmd = (session: string) => `${JSON.stringify({ type: "user", isSidechain: false, sessionId: session, timestamp: "2026-09-28T10:40:00Z", message: { role: "user", content: "<local-command-stdout>Set model to `claude-sonnet-5-5`</local-command-stdout>" } })}\n`;

const proj = join(projects, "-home-x");
mkdirSync(join(proj, S1, "subagents", "workflows", "wf_1"), { recursive: true });
mkdirSync(join(proj, S2), { recursive: true });
const main1 = join(proj, `${S1}.jsonl`);
const main2 = join(proj, `${S2}.jsonl`);
const crew = join(proj, S1, "subagents", "agent-abc.jsonl");
const crewDeep = join(proj, S1, "subagents", "workflows", "wf_1", "agent-def.jsonl");
writeFileSync(main1, named("TEAM_K") + req("m1", S1) + req("m1", S1, { out: 9 }) + req("m2", S1, { t: "2026-09-28T10:10:00Z" }) + compact(S1) + modelCmd(S1) + req("m3", S1, { requestId: null, model: "deepseek-x", t: "2026-09-28T10:20:00Z" }));
writeFileSync(main2, req("n1", S2, { t: "2026-09-28T11:00:00Z" }) + req("m2", S1, { t: "2026-09-28T10:10:00Z", out: 7 })); // 다른 파일의 같은 요청(전역 중복)
writeFileSync(crew, req("c1", S1, { side: true, out: 3 }));
writeFileSync(join(proj, S1, "subagents", "agent-abc.meta.json"), JSON.stringify({ agentType: "ui-builder", spawnDepth: 1, description: BODY }));
writeFileSync(crewDeep, req("c2", S1, { side: true }));
const SINCE = Date.parse("2026-01-01T00:00:00Z");

// 결과를 비교 가능한 모양으로(Map의 넣은 순서까지 본다)
const shape = (scan: ReturnType<typeof scanFuel>) => ({
  records: [...scan.records.values()],
  compactions: scan.compactions,
  modelCommands: scan.modelCommands,
  unknown: [...scan.unknownBySession],
  names: [...scan.names],
  agents: [...scan.agents],
  files: scan.files,
});
const cold = () => {
  stopFuelCache(); // 캐시·감시 없음 = 옛 동작
  return scanFuel(SINCE, []);
};
const withCache = () => {
  stopFuelCache();
  startFuelCache(cacheDir);
  return scanFuel(SINCE, []);
};
const shards = () => (existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => f.endsWith(".json")) : []);

test("classifyFuelPath: fuelFiles의 걷기와 같은 규칙(본 기록, subagents 3단계까지의 agent-*, 그 밖은 아님)", () => {
  assert.deepEqual(classifyFuelPath(["-p", `${S1}.jsonl`]), { session: S1, crew: false, agent: null });
  assert.deepEqual(classifyFuelPath(["-p", S1, "subagents", "agent-abc.jsonl"]), { session: S1, crew: true, agent: "abc" });
  assert.deepEqual(classifyFuelPath(["-p", S1, "subagents", "a", "b", "c", "agent-z.jsonl"]), { session: S1, crew: true, agent: "z" });
  assert.equal(classifyFuelPath(["-p", S1, "subagents", "a", "b", "c", "d", "agent-z.jsonl"]), null); // 4단계는 걷지 않는다
  assert.equal(classifyFuelPath(["-p", S1, "subagents", "journal.jsonl"]), null);
  assert.equal(classifyFuelPath(["-p", S1, "subagents", "agent-abc.meta.json"]), null);
  assert.equal(classifyFuelPath(["-p", S1, "other", "agent-abc.jsonl"]), null);
  assert.equal(classifyFuelPath([`${S1}.jsonl`]), null);
  // 걷기와 같은 결과인지 실제 트리로도 본다
  const walked = fuelFiles(0, projects);
  const listed = new FuelTree(projects, (s, r) => fuelFiles(s, r)).list(0); // 감시 없이 = 전체 걷기
  assert.deepEqual(listed, walked);
  assert.equal(walked.length, 4);
});

test("FuelTree: 감시가 되면 새 파일과 바뀐 파일이 목록에 오르고 changed로 넘어오며, 감시가 없으면 전체를 걷는다", async (t) => {
  const tree = new FuelTree(projects, (s, r) => fuelFiles(s, r));
  let events = 0;
  if (!tree.start(() => events++)) return t.skip("이 환경은 recursive fs.watch가 없음(전체 걷기로 돌아감)");
  try {
    tree.list(0); // 첫 목록 = 전체 걷기
    const fresh = join(proj, "33333333-3333-4333-8333-333333333333.jsonl");
    writeFileSync(fresh, req("z1", "33333333-3333-4333-8333-333333333333"));
    const t0 = Date.now();
    while (!tree.list(0).some((f) => f.path === fresh) && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
    assert.ok(tree.list(0).some((f) => f.path === fresh), "감시가 새 파일을 알려야 한다");
    assert.ok(events > 0 && tree.seq > 0);
    assert.ok(tree.takeChanged().some((f) => f.path === fresh));
    assert.deepEqual(tree.takeChanged(), []); // 한 번 넘겨주면 비운다
    rmSync(fresh);
    const t1 = Date.now();
    while (tree.list(0).some((f) => f.path === fresh) && Date.now() - t1 < 3000) await new Promise((r) => setTimeout(r, 25));
    assert.ok(!tree.list(0).some((f) => f.path === fresh), "지운 파일은 목록에서 빠진다");
  } finally {
    tree.stop();
  }
  const noWatch = new FuelTree(projects, (s, r) => fuelFiles(s, r)); // start 안 함 = 감시 없음
  assert.equal(noWatch.watching, false);
  assert.equal(noWatch.list(0).length, 4);
});

test("캐시가 있어도 없어도 FUEL 결과가 같다(재시작 뒤 0바이트, 새 줄은 그 줄만)", () => {
  const expected = shape(cold());
  assert.equal(expected.records.length > 0, true);

  // 캐시를 켜고 처음부터 읽은 결과(디스크에도 쓴다)
  const first = withCache();
  assert.deepEqual(shape(first), expected);
  assert.ok(first.bytes > 0);
  assert.equal(flushFuelCache(), 0);
  assert.equal(shards().length, 4);

  // 재시작: 메모리를 버리고 캐시에서 이어 읽는다 — 결과는 같고 읽은 바이트는 0
  dropFuelMemory();
  const again = scanFuel(SINCE, []);
  assert.equal(again.bytes, 0);
  assert.deepEqual(shape(again), expected);

  // 재시작 뒤 새 줄: 그 줄만 읽고, 처음부터 읽은 것과 같다
  const add = req("m9", S1, { out: 11, t: "2026-09-28T12:00:00Z" });
  appendFileSync(main1, add);
  dropFuelMemory();
  const next = scanFuel(SINCE, []);
  assert.equal(next.bytes, Buffer.byteLength(add));
  const expectedNext = shape(cold());
  assert.deepEqual(shape(next), expectedNext);
  assert.equal(expectedNext.records.length, expected.records.length + 1);
});

test("캐시가 못 읽거나 낡았거나 다른 형식이거나 다른 파일이면 무시하고 다시 만든다", () => {
  const expected = shape(cold());
  const brokenBy: Record<string, (file: string) => void> = {
    "깨진 JSON": (f) => writeFileSync(f, "{ not json"),
    "다른 형식 버전": (f) => writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), format: FUEL_CACHE_FORMAT + 1 })),
    "빈 파일": (f) => writeFileSync(f, ""),
    "낡음(캐시 크기가 파일보다 큼)": (f) => writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), size: 10 ** 9 })),
    "다른 파일(앞머리 지문)": (f) => writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), head: "0".repeat(40) })),
    "다른 inode": (f) => writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), ino: 1 })),
    "모양이 이상한 기록": (f) => writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), records: [{ key: 1 }] })),
  };
  for (const [why, damage] of Object.entries(brokenBy)) {
    withCache();
    flushFuelCache();
    for (const f of shards()) damage(join(cacheDir, f));
    dropFuelMemory();
    const scan = scanFuel(SINCE, []);
    assert.deepEqual(shape(scan), expected, `${why}: 결과가 같아야 한다`);
    assert.ok(scan.bytes > 0, `${why}: 처음부터 다시 읽어야 한다`);
    assert.equal(flushFuelCache(), 0);
    dropFuelMemory();
    assert.equal(scanFuel(SINCE, []).bytes, 0, `${why}: 다시 만든 캐시는 쓸 수 있어야 한다`);
    stopFuelCache();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("파일이 줄어들면(다시 쓰면) 캐시를 버리고 처음부터 읽는다", () => {
  const before = readFileSync(crew, "utf8");
  withCache();
  flushFuelCache();
  writeFileSync(crew, req("c1", S1, { side: true, out: 3 }).slice(0, 40) + "\n"); // 캐시보다 작은 다른 내용
  dropFuelMemory();
  const scan = scanFuel(SINCE, []);
  assert.equal(scan.records.has("c1|req_c1"), false);
  writeFileSync(crew, before);
  stopFuelCache();
  rmSync(cacheDir, { recursive: true, force: true });
});

test("캐시에는 대화 본문이 들어가지 않는다(FuelRecord와 요약 필드만)", () => {
  withCache();
  flushFuelCache();
  const all = shards().map((f) => readFileSync(join(cacheDir, f), "utf8")).join("\n");
  assert.ok(all.length > 0);
  assert.equal(all.includes(BODY), false, "본문이 캐시에 있으면 안 된다");
  assert.equal(all.includes("description"), false, "meta의 description도 버린다");
  assert.ok(all.includes("ui-builder"), "agentType은 남는다");
  stopFuelCache();
  rmSync(cacheDir, { recursive: true, force: true });
});

test("pruneShards: 지워진 기록의 캐시와 옛 임시 파일만 지운다", () => {
  withCache();
  flushFuelCache();
  writeFileSync(join(cacheDir, "stray.json.123.tmp"), "x");
  writeFileSync(join(cacheDir, "notes.txt"), "keep"); // 캐시가 아닌 파일은 건드리지 않는다
  const keep = new Set([shardName(main1), shardName(main2), shardName(crew)]); // crewDeep은 지워졌다고 본다
  const removed = pruneShards(cacheDir, keep);
  assert.equal(removed, 2);
  assert.equal(shards().length, 3);
  assert.ok(existsSync(join(cacheDir, "notes.txt")));
  assert.equal(pruneShards(join(root, "none"), keep), 0);
  stopFuelCache();
  rmSync(cacheDir, { recursive: true, force: true });
});

test("감시를 켠 채 읽어도 결과가 같고, 새 줄이 오면 60초 캐시가 REFRESH_MIN_MS 뒤 다시 센다", async (t) => {
  const expected = shape(cold());
  stopFuelCache();
  if (!startFuelWatch()) return t.skip("이 환경은 recursive fs.watch가 없음");
  assert.deepEqual(shape(scanFuel(SINCE, [])), expected);
  const seq0 = fuelChangeSeq();
  appendFileSync(main2, req("n2", S2, { t: "2026-09-28T13:00:00Z" }));
  const t0 = Date.now();
  while (fuelChangeSeq() === seq0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
  assert.ok(fuelChangeSeq() > seq0, "감시가 새 줄을 알려야 한다");
  const scan = scanFuel(SINCE, []);
  assert.equal(scan.records.has("n2|req_n2"), true);
  stopFuelCache();
  // 위 줄은 다음 시험을 위해 되돌린다
  truncateSync(main2, Buffer.byteLength(req("n1", S2, { t: "2026-09-28T11:00:00Z" }) + req("m2", S1, { t: "2026-09-28T10:10:00Z", out: 7 })));
});

test("freshEnough: 캐시 시간 안이고 새 변경이 없거나 변경이 REFRESH_MIN_MS 안이면 그대로, 변경이 있고 그 뒤면 다시 센다", () => {
  const seq = fuelChangeSeq();
  const last = { at: 1_000_000, seq };
  assert.equal(freshEnough(last, last.at + 10_000, 60_000), true); // 변경 없음
  assert.equal(freshEnough(last, last.at + 61_000, 60_000), false); // 캐시 시간이 지남
  assert.equal(freshEnough({ ...last, seq: seq - 1 }, last.at + 2_000, 60_000), true); // 변경이 있어도 5초 안
  assert.equal(freshEnough({ ...last, seq: seq - 1 }, last.at + 6_000, 60_000), false); // 변경이 있고 5초 뒤
});
