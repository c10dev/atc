import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changed, fuelFile, lastRecord, lastRecordWith, limitsOf, lineOf, parseRecord, recordOf, run } from "./fuel-statusline.mjs";

// statusline 입력 모양은 Claude Code 2.1.283의 statusline 입력 생성 코드에서 따왔다(ATC-55 Step 0)
const SCRIPT = new URL("./fuel-statusline.mjs", import.meta.url).pathname;
const T = "2026-09-28T15:00:00.000Z";
const now = Date.parse(T);
const input = (rate_limits, extra = {}) => ({
  session_id: "sess-1",
  transcript_path: "/must/not/read",
  cwd: "/x",
  model: { id: "claude-opus-5-5", display_name: "Opus" },
  context_window: { total_input_tokens: 120000, context_window_size: 1000000, used_percentage: 12, current_usage: null },
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

test("기록 모양: t, sessionId, 숫자만 남긴 rate_limits, 창 크기, 모델 id. 다른 입력(표시 이름·비용·경로·사용량)은 두지 않는다", () => {
  const r = recordOf(input(RL), now);
  assert.deepEqual(r, { t: T, sessionId: "sess-1", rate_limits: RL, context_window_size: 1000000, model: "claude-opus-5-5" });
  const text = JSON.stringify(r);
  for (const leak of ["/must/not/read", "Opus", "1.2", "120000", "total_input"]) assert.equal(text.includes(leak), false, leak);
});

test("rate_limits가 없어도(API 키 경로) 창 크기·모델 id가 있으면 기록한다. 셋 다 없거나 틀리면 기록하지 않는다", () => {
  assert.deepEqual(recordOf(input(null), now), { t: T, sessionId: "sess-1", context_window_size: 1000000, model: "claude-opus-5-5" });
  const bare = { session_id: "sess-1", transcript_path: "/x" };
  assert.equal(recordOf(bare, now), null);
  assert.equal(recordOf({ ...bare, rate_limits: { five_hour: { used_percentage: "82", resets_at: 1 } }, model: { id: "has space" }, context_window: { context_window_size: "1000000" } }, now), null);
  assert.equal(recordOf({ ...bare, context_window: { context_window_size: 1.5 } }, now), null);
  assert.equal(recordOf({ ...bare, context_window: { context_window_size: -5 } }, now), null);
  assert.deepEqual(recordOf({ ...bare, model: { id: "claude-sonnet-5-5[1m]" } }, now), { t: T, sessionId: "sess-1", model: "claude-sonnet-5-5[1m]" });
  assert.equal(recordOf({ ...bare, model: { id: "a".repeat(200) } }, now), null);
  assert.equal(recordOf({ ...input(RL), session_id: "../x" }, now), null);
  assert.deepEqual(limitsOf({ five_hour: { used_percentage: 101, resets_at: 1 }, seven_day: { used_percentage: 12.34, resets_at: 5.4, extra: "x" }, other: {} }), {
    seven_day: { used_percentage: 12.3, resets_at: 5 },
  });
  // spend_limit(gateway 경로)도 같은 모양
  assert.deepEqual(limitsOf({ spend_limit: { used_percentage: 3, resets_at: 9 } }), { spend_limit: { used_percentage: 3, resets_at: 9 } });
});

test("parseRecord·lastRecord: 서버가 읽는 규칙. 옛 줄(rate_limits만)도 새 줄도 읽고, 모양이 틀린 줄은 건너뛴다", () => {
  const good = JSON.stringify({ t: T, sessionId: "sess-1", rate_limits: RL });
  assert.deepEqual(parseRecord(good), { t: T, sessionId: "sess-1", rate_limits: RL });
  const fresh = JSON.stringify({ t: T, sessionId: "sess-1", context_window_size: 200000, model: "claude-sonnet-5-5", rate_limits: RL, extra: "x" });
  assert.deepEqual(parseRecord(fresh), { t: T, sessionId: "sess-1", rate_limits: RL, context_window_size: 200000, model: "claude-sonnet-5-5" });
  assert.deepEqual(parseRecord(JSON.stringify({ t: T, sessionId: "sess-1", context_window_size: 200000 })), { t: T, sessionId: "sess-1", context_window_size: 200000 });
  assert.equal(parseRecord(JSON.stringify({ t: T, sessionId: "sess-1", context_window_size: 12, model: "a b" })), null); // 틀린 값은 버려서 남는 것이 없다
  assert.equal(parseRecord('{"t":"x","sessionId":"s","rate_limits":{}}'), null);
  assert.equal(parseRecord("not json"), null);
  assert.deepEqual(lastRecord(`${good}\n{"broken"\n\n`), parseRecord(good));
});

test("lastRecordWith: 그 값이 있는 마지막 줄(FUEL REMAINING은 rate_limits, 창 크기는 context_window_size)", () => {
  const a = { t: T, sessionId: "s", rate_limits: RL, context_window_size: 1000000, model: "claude-opus-5-5" };
  const b = { t: "2026-09-28T15:05:00.000Z", sessionId: "s", context_window_size: 200000, model: "claude-sonnet-5-5" };
  const text = `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`;
  assert.deepEqual(lastRecordWith(text, "rate_limits"), a);
  assert.deepEqual(lastRecordWith(text, "context_window_size"), b);
  assert.deepEqual(lastRecord(text), b);
  assert.equal(lastRecordWith(`${JSON.stringify({ t: T, sessionId: "s", rate_limits: RL })}\n`, "context_window_size"), null);
});

test("상태 줄 글: FUEL 5h 82% · 7d 40%. rate_limits가 없으면 빈 글", () => {
  assert.equal(lineOf(recordOf(input(RL), now)), "FUEL 5h 82% · 7d 40%");
  assert.equal(lineOf(recordOf(input(null), now)), "");
});

test("changed: 새 기록에 담긴 값 중 앞 기록에 없거나 다른 것이 있을 때만", () => {
  const full = recordOf(input(RL), now);
  assert.equal(changed(null, full), true);
  assert.equal(changed(full, recordOf(input(RL), now + 1)), false);
  assert.equal(changed(full, recordOf(input(null), now)), false); // rate_limits가 잠깐 없어도 줄이 늘지 않는다
  assert.equal(changed(recordOf(input(null), now), full), true); // 앞 줄에 없던 rate_limits가 생김
  assert.equal(changed(full, recordOf(input(RL, { model: { id: "claude-sonnet-5-5" } }), now)), true);
  assert.equal(changed(full, recordOf(input(RL, { context_window: { context_window_size: 200000 } }), now)), true);
  assert.equal(changed({ t: T, sessionId: "sess-1", rate_limits: RL }, full), true); // 옛 줄 뒤에 처음 한 번
});

test("run: 담은 값이 바뀔 때만 덧붙인다. rate_limits 없는 기록도 남긴다", () => {
  const s = sandbox();
  try {
    assert.deepEqual(run(input(RL), { dir: s.dir, now }), { line: "FUEL 5h 82% · 7d 40%", written: true });
    assert.equal(run(input(RL), { dir: s.dir, now: now + 60_000 }).written, false);
    const next = { ...RL, five_hour: { used_percentage: 83, resets_at: 1790000000 } };
    assert.equal(run(input(next), { dir: s.dir, now: now + 120_000 }).written, true);
    const lines = readFileSync(fuelFile(s.dir, "sess-1"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.rate_limits.five_hour.used_percentage), [82.4, 83]);
    // rate_limits가 없는 입력: 앞 기록과 창·모델이 같으면 줄이 늘지 않는다
    assert.deepEqual(run(input(null), { dir: s.dir, now }), { line: "", written: false });
    // 창이나 모델이 바뀌면(/model) 한 줄. rate_limits가 없으면 그것 없이 남는다
    assert.deepEqual(run(input(null, { model: { id: "claude-sonnet-5-5" }, context_window: { context_window_size: 200000 } }), { dir: s.dir, now: now + 180_000 }), { line: "", written: true });
    assert.equal(run(input(null, { model: { id: "claude-sonnet-5-5" }, context_window: { context_window_size: 200000 } }), { dir: s.dir, now: now + 240_000 }).written, false);
    // 그 뒤 rate_limits가 돌아와도 숫자가 그대로면(앞 줄엔 없으니) 한 번 남는다
    assert.equal(run(input(next, { model: { id: "claude-sonnet-5-5" }, context_window: { context_window_size: 200000 } }), { dir: s.dir, now: now + 300_000 }).written, true);
    assert.equal(run(input(next, { model: { id: "claude-sonnet-5-5" }, context_window: { context_window_size: 200000 } }), { dir: s.dir, now: now + 360_000 }).written, false);
    const all = readFileSync(fuelFile(s.dir, "sess-1"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(all.length, 4);
    assert.deepEqual(all.slice(1).map((l) => [l.context_window_size, l.model, Boolean(l.rate_limits)]), [[1000000, "claude-opus-5-5", true], [200000, "claude-sonnet-5-5", false], [200000, "claude-sonnet-5-5", true]]);
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
