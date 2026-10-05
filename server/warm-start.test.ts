import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { diffSnapshots, EventLog, isWarm } from "./events.ts";
import type { Alert, PullRequest, Snapshot } from "./model.ts";
import { parseWarmStartConfig, readWarmCache, writeWarmCache } from "./warm-start-run.ts";
import { parseCache, SAVE_EVERY_MS, WarmStart } from "./warm-start.ts";

const T0 = Date.parse("2026-10-05T12:00:00Z");
const MIN = 60_000;

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    at: new Date(T0).toISOString(),
    linear: { enabled: true, error: null, fetchedAt: new Date(T0).toISOString() },
    github: { enabled: true, error: null, fetchedAt: new Date(T0).toISOString() },
    atfm: { mains: [], groundStops: [] },
    pulls: [{ number: 7, repo: "atc" } as unknown as PullRequest],
    sessions: [],
    workspaces: [],
    tickets: [],
    columns: [],
    airports: [],
    claims: [],
    handoffs: [],
    alerts: [],
    clearances: [],
    ...over,
  };
}
const cold = (over: Partial<Snapshot> = {}) => snap({ linear: { enabled: true, error: null, fetchedAt: null }, github: { enabled: true, error: null, fetchedAt: null }, pulls: [], ...over });
const cacheText = (s: Snapshot, at = T0) => JSON.stringify({ savedAt: new Date(at).toISOString(), snapshot: s });

test("parseCache: 최대 나이 안의 따뜻한 캐시는 복원, 깨졌거나 오래됐거나 미래 시각이면 null", () => {
  const ok = parseCache(cacheText(snap()), T0 + 3 * MIN, 10 * MIN);
  assert.equal(ok?.snapshot.pulls.length, 1);
  assert.equal(parseCache(cacheText(snap()), T0 + 11 * MIN, 10 * MIN), null, "too old");
  assert.equal(parseCache(cacheText(snap(), T0 + 20 * MIN), T0, 10 * MIN), null, "future");
  assert.equal(parseCache("{not json", T0, 10 * MIN), null, "corrupt");
  assert.equal(parseCache("", T0, 10 * MIN), null, "empty");
  assert.equal(parseCache(JSON.stringify({ savedAt: "x", snapshot: snap() }), T0, 10 * MIN), null, "bad time");
  assert.equal(parseCache(JSON.stringify({ savedAt: new Date(T0).toISOString(), snapshot: { pulls: 1 } }), T0, 10 * MIN), null, "bad shape");
});

test("복원본은 restored 표시와 나이를 달아 내주고, 원본은 건드리지 않는다", () => {
  const w = new WarmStart();
  const saved = snap();
  w.restore(parseCache(cacheText(saved), T0 + MIN, 10 * MIN), 10 * MIN);
  const shown = w.display(null, T0 + 2 * MIN);
  assert.equal(shown?.pulls.length, 1);
  assert.deepEqual(shown?.restored, { savedAt: new Date(T0).toISOString(), ageSec: 120 });
  assert.equal(saved.restored, undefined);
  // 살아 있는 콜드 스냅샷이 있어도 따뜻해질 때까지는 복원본을 보인다
  const live = cold();
  assert.equal(w.settle(live, T0 + 2 * MIN), false);
  assert.equal(w.display(live, T0 + 2 * MIN)?.pulls.length, 1);
});

test("첫 살아 있는 따뜻한 스냅샷이 복원본을 바꾼다", () => {
  const w = new WarmStart();
  w.restore(parseCache(cacheText(snap()), T0, 10 * MIN), 10 * MIN);
  const live = snap({ pulls: [] });
  assert.equal(w.settle(live, T0 + MIN), true);
  assert.equal(w.active(), false);
  const shown = w.display(live, T0 + MIN);
  assert.equal(shown, live);
  assert.equal(shown?.restored, undefined);
  assert.equal(w.settle(live, T0 + 2 * MIN), false, "once");
});

test("살아 있는 것이 계속 콜드여도 복원본은 최대 나이에서 물러난다", () => {
  const w = new WarmStart();
  w.restore(parseCache(cacheText(snap()), T0, 10 * MIN), 10 * MIN);
  assert.equal(w.settle(cold(), T0 + 10 * MIN), false);
  assert.equal(w.settle(cold(), T0 + 10 * MIN + 1), true);
  assert.equal(w.display(cold(), T0 + 11 * MIN)?.restored, undefined);
});

test("복원본에서 이벤트·경보·판정이 나오지 않는다: 비교는 살아 있는 스냅샷끼리만", () => {
  const conflict: Alert = { kind: "conflict", message: "x", workspacePath: "/w", sessionIds: ["a", "b"] };
  const saved = snap({ alerts: [conflict], pulls: [{ number: 7, repo: "atc" } as unknown as PullRequest] });
  const w = new WarmStart();
  w.restore(parseCache(cacheText(saved), T0, 10 * MIN), 10 * MIN);
  // 서버의 tick과 같은 순서: current는 살아 있는 스냅샷만. 복원본은 current에 들어가지 않는다
  const log = new EventLog();
  let current: Snapshot | null = null;
  const live1 = cold();
  assert.deepEqual(log.push(diffSnapshots(current, live1)), [], "first tick: nothing to compare");
  current = live1;
  assert.equal(isWarm(live1), false, "live data decides warmth");
  assert.equal(w.display(current, T0)?.alerts.length, 1, "the screen sees the restored alert");
  assert.equal(isWarm(current), false);
  // 살아 있는 것이 따뜻해지면서 경보가 없다: 복원본의 경보가 "해제"로 기록되면 안 된다
  const live2 = snap({ alerts: [], pulls: [] });
  assert.deepEqual(log.push(diffSnapshots(current, live2)), [], "cold → warm is not compared");
  w.settle(live2, T0 + MIN);
  current = live2;
  const live3 = snap({ alerts: [], pulls: [] });
  assert.deepEqual(log.push(diffSnapshots(current, live3)), [], "no alert.cleared from the restored data");
});

test("저장: 따뜻한 살아 있는 스냅샷만, 최대 1분에 한 번", () => {
  const w = new WarmStart();
  assert.equal(w.saveText(cold(), T0), null, "cold is not saved");
  const first = w.saveText(snap(), T0);
  assert.ok(first);
  assert.equal(parseCache(first, T0, 10 * MIN)?.snapshot.pulls.length, 1);
  assert.equal(w.saveText(snap(), T0 + SAVE_EVERY_MS - 1), null, "throttled");
  assert.ok(w.saveText(snap(), T0 + SAVE_EVERY_MS), "after a minute");
});

test("설정 파일: 기본 on·10분, off, 범위 밖 maxAgeMin은 기본값", () => {
  assert.deepEqual(parseWarmStartConfig(null), { mode: "on", maxAgeMin: 10 });
  assert.deepEqual(parseWarmStartConfig({ mode: "off", maxAgeMin: 30 }), { mode: "off", maxAgeMin: 30 });
  assert.equal(parseWarmStartConfig({ maxAgeMin: 0 }).maxAgeMin, 10);
  assert.equal(parseWarmStartConfig({ maxAgeMin: 9999 }).maxAgeMin, 10);
  assert.equal(parseWarmStartConfig({ mode: "yes" }).mode, "on");
});

test("캐시 파일: 쓰고 읽기, 스위치 off·없음·깨짐·오래됨은 콜드 스타트, 파일을 지워도 안전", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-warm-"));
  try {
    const file = join(dir, "warm-snapshot.json");
    const on = { mode: "on", maxAgeMin: 10 } as const;
    assert.equal(readWarmCache(T0, on, file), null, "missing");
    await writeWarmCache(cacheText(snap()), file);
    assert.equal(readWarmCache(T0 + MIN, on, file)?.snapshot.pulls.length, 1);
    assert.equal(readWarmCache(T0 + MIN, { mode: "off", maxAgeMin: 10 }, file), null, "switch off");
    assert.equal(readWarmCache(T0 + 11 * MIN, on, file), null, "too old");
    writeFileSync(file, "garbage");
    assert.equal(readWarmCache(T0, on, file), null, "corrupt");
    await writeWarmCache(cacheText(snap()), file);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).snapshot.pulls.length, 1, "atomic replace");
    await writeWarmCache("x", join(dir, "no/such/dir/file")); // 실패해도 던지지 않는다
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
