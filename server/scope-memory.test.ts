import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { memoryArgsOf, oomDeltasOf, oomKillOf, readScopeOom, scopeDirsOf, scopeOomTextOf } from "./scope-memory.ts";

// 백그라운드 scope의 메모리 상한과 OOM 세기(ATC-505). 진짜 세션도 진짜 메모리 사용도 없다: 문자열과 임시 폴더만.
// launchCommandOf의 상한 켜짐·꺼짐은 session-control.test.ts

test("속성: 상한이 있으면 MemoryHigh·MemoryMax, 없으면 비어 있다", () => {
  assert.deepEqual(memoryArgsOf({ high: "20G", max: "24G" }), ["-p", "MemoryHigh=20G", "-p", "MemoryMax=24G"]);
  assert.deepEqual(memoryArgsOf(null), []);
  assert.deepEqual(memoryArgsOf(undefined), []);
});

test("memory.events: oom_kill 줄만 읽고 없으면 0", () => {
  assert.equal(oomKillOf("low 0\nhigh 12\nmax 3\noom 2\noom_kill 2\noom_group_kill 0\n"), 2);
  assert.equal(oomKillOf("oom_kill 17"), 17);
  assert.equal(oomKillOf("low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n"), 0);
  assert.equal(oomKillOf("oom_group_kill 5\n"), 0); // 다른 줄은 세지 않는다
  assert.equal(oomKillOf(""), 0);
});

test("늘어난 수: 처음 보는 scope는 기록에 있던 합계부터, 안 늘면 줄이 없다", () => {
  const now = [{ unit: "atc-claude-1.scope", kills: 3 }, { unit: "atc-claude-2.scope", kills: 0 }, { unit: "atc-claude-3.scope", kills: 2 }];
  // 1번은 2까지 기록했다(서버를 다시 띄워도 두 번 세지 않는다), 2번은 0, 3번은 처음
  const known = new Map([["atc-claude-1.scope", 2]]);
  assert.deepEqual(oomDeltasOf(now, known), [{ unit: "atc-claude-1.scope", total: 3, delta: 1 }, { unit: "atc-claude-3.scope", total: 2, delta: 2 }]);
  assert.deepEqual(oomDeltasOf(now, new Map([["atc-claude-1.scope", 3], ["atc-claude-3.scope", 2]])), []);
  assert.deepEqual(oomDeltasOf([], known), []);
});

test("CONTROL 줄: 상한이 켜져 있고 kill이 없으면 줄이 없다. 꺼졌거나 kill이 있으면 서버가 글을 정한다", () => {
  assert.equal(scopeOomTextOf({ kills7d: 0, scopes: 1 }, "on"), null);
  assert.match(scopeOomTextOf({ kills7d: 2, scopes: 1 }, "on")!, /OOM kill 2건 — 상한이 너무 낮은지/);
  assert.match(scopeOomTextOf({ kills7d: 0, scopes: 1 }, "off")!, /꺼짐/);
  assert.doesNotMatch(scopeOomTextOf({ kills7d: 1, scopes: 1 }, "off")!, /너무 낮은지/);
});

test("cgroup 읽기: atc-claude-*.scope 폴더의 memory.events만(임시 폴더의 가짜 트리)", () => {
  const root = mkdtempSync(join(tmpdir(), "atc-scope-oom-"));
  try {
    const app = join(root, "user-1000.slice", "user@1000.service", "app.slice");
    mkdirSync(join(app, "atc-claude-111.scope"), { recursive: true });
    mkdirSync(join(app, "atc-claude-222.scope"), { recursive: true });
    mkdirSync(join(app, "other.scope"), { recursive: true });
    mkdirSync(join(app, "atc-claude-notanumber.scope"), { recursive: true });
    writeFileSync(join(app, "atc-claude-111.scope", "memory.events"), "oom_kill 4\n");
    writeFileSync(join(app, "other.scope", "memory.events"), "oom_kill 9\n");
    // 222는 memory.events를 못 읽는다: 0으로 센다
    assert.deepEqual(scopeDirsOf(root).map((d) => d.split("/").at(-1)).sort(), ["atc-claude-111.scope", "atc-claude-222.scope"]);
    assert.deepEqual(readScopeOom(root).sort((a, b) => a.unit.localeCompare(b.unit)), [{ unit: "atc-claude-111.scope", kills: 4 }, { unit: "atc-claude-222.scope", kills: 0 }]);
    assert.deepEqual(readScopeOom(join(root, "missing")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
