import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fuelFile, lastRecord, limitsOf, lineOf, parseRecord, recordOf, run } from "./fuel-statusline.mjs";

// statusline 입력 모양은 Claude Code 2.1.283의 statusline 입력 생성 코드에서 따왔다(ATC-55 Step 0)
const SCRIPT = new URL("./fuel-statusline.mjs", import.meta.url).pathname;
const T = "2026-09-28T15:00:00.000Z";
const now = Date.parse(T);
const input = (rate_limits, extra = {}) => ({
  session_id: "sess-1",
  transcript_path: "/must/not/read",
  cwd: "/x",
  model: { id: "claude-opus-5-5", display_name: "Opus" },
  workspace: { current_dir: "/x", project_dir: "/x" },
  cost: { total_cost_usd: 1.2 },
  ...(rate_limits ? { rate_limits } : {}),
  ...extra,
});
const RL = { five_hour: { used_percentage: 82.4, resets_at: 1790000000 }, seven_day: { used_percentage: 40, resets_at: 1790500000 } };

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "atc-fuel-"));
  return { base, dir: join(base, "state"), done: () => rmSync(base, { recursive: true, force: true }) };
}

test("기록 모양: t, sessionId, 숫자만 남긴 rate_limits. 다른 입력(모델·비용·경로)은 두지 않는다", () => {
  const r = recordOf(input(RL), now);
  assert.deepEqual(r, { t: T, sessionId: "sess-1", rate_limits: RL });
  assert.equal(JSON.stringify(r).includes("/must/not/read"), false);
  assert.equal(JSON.stringify(r).includes("claude-opus"), false);
});

test("rate_limits가 없거나(API 키 경로) 숫자가 아니면 기록하지 않는다. 틀린 창만 빠진다", () => {
  assert.equal(recordOf(input(null), now), null);
  assert.equal(recordOf(input({ five_hour: { used_percentage: "82", resets_at: 1 } }), now), null);
  assert.equal(recordOf({ ...input(RL), session_id: "../x" }, now), null);
  assert.deepEqual(limitsOf({ five_hour: { used_percentage: 101, resets_at: 1 }, seven_day: { used_percentage: 12.34, resets_at: 5.4, extra: "x" }, other: {} }), {
    seven_day: { used_percentage: 12.3, resets_at: 5 },
  });
  // spend_limit(gateway 경로)도 같은 모양
  assert.deepEqual(limitsOf({ spend_limit: { used_percentage: 3, resets_at: 9 } }), { spend_limit: { used_percentage: 3, resets_at: 9 } });
});

test("parseRecord·lastRecord: 서버가 읽는 규칙. 모양이 틀린 줄은 건너뛴다", () => {
  const good = JSON.stringify({ t: T, sessionId: "sess-1", rate_limits: RL });
  assert.deepEqual(parseRecord(good), { t: T, sessionId: "sess-1", rate_limits: RL });
  assert.equal(parseRecord('{"t":"x","sessionId":"s","rate_limits":{}}'), null);
  assert.equal(parseRecord("not json"), null);
  assert.deepEqual(lastRecord(`${good}\n{"broken"\n\n`), parseRecord(good));
});

test("상태 줄 글: FUEL 5h 82% · 7d 40%", () => {
  assert.equal(lineOf(recordOf(input(RL), now)), "FUEL 5h 82% · 7d 40%");
});

test("run: 숫자가 바뀔 때만 덧붙인다", () => {
  const s = sandbox();
  try {
    assert.deepEqual(run(input(RL), { dir: s.dir, now }), { line: "FUEL 5h 82% · 7d 40%", written: true });
    assert.equal(run(input(RL), { dir: s.dir, now: now + 60_000 }).written, false);
    const next = { ...RL, five_hour: { used_percentage: 83, resets_at: 1790000000 } };
    assert.equal(run(input(next), { dir: s.dir, now: now + 120_000 }).written, true);
    const lines = readFileSync(fuelFile(s.dir, "sess-1"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.rate_limits.five_hour.used_percentage), [82.4, 83]);
    assert.deepEqual(run(input(null), { dir: s.dir, now }), { line: "", written: false });
  } finally {
    s.done();
  }
});

test("명령으로: 상태 줄을 출력하고 exit 0. --quiet면 출력 없음. 깨진 입력도 exit 0", () => {
  const s = sandbox();
  try {
    const env = { ...process.env, ATC_STATE_DIR: s.dir };
    const a = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(input(RL)), env, encoding: "utf8" });
    assert.equal(a.status, 0);
    assert.equal(a.stdout, "FUEL 5h 82% · 7d 40%\n");
    const b = spawnSync(process.execPath, [SCRIPT, "--quiet"], { input: JSON.stringify(input(RL)), env, encoding: "utf8" });
    assert.deepEqual([b.status, b.stdout], [0, ""]);
    const c = spawnSync(process.execPath, [SCRIPT], { input: "{", env, encoding: "utf8" });
    assert.deepEqual([c.status, c.stdout], [0, ""]);
    assert.equal(readFileSync(fuelFile(s.dir, "sess-1"), "utf8").trim().split("\n").length, 1);
  } finally {
    s.done();
  }
});
