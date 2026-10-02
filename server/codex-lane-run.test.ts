import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "./config.ts";
import { laneStates, loadLaneSwitch, readLaneOps, saveLaneSwitch } from "./codex-lane-run.ts";
import type { LanePull } from "./codex-lane.ts";

// 조용한 리뷰 레인(ATC-386)의 읽기·쓰기와 스위치(ATC-393). 상태 폴더는 시험용 임시 폴더다(test-hermetic).
const T0 = Date.parse("2026-10-02T00:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const waiting = (number: number): LanePull => ({ number, createdAt: iso(-5), reviews: [], isDraft: false, codex: { headAt: iso(0), thumbsAt: null, lastComment: null } });
const NOW = T0 + 60 * 60_000;

test("스위치: 파일이 없으면 on, off를 쓰면 off, 같은 값은 다시 쓰지 않는다", () => {
  assert.equal(loadLaneSwitch(), "on");
  saveLaneSwitch("off");
  assert.equal(loadLaneSwitch(), "off");
  assert.equal(JSON.parse(readFileSync(join(config.stateDir, "codex-lane.json"), "utf8")).auto, "off");
  saveLaneSwitch("on");
  assert.equal(loadLaneSwitch(), "on");
});

test("laneStates: 스위치가 on이고 Codex를 쓰는 저장소만 판단·기록한다", () => {
  const byRepo = new Map<string, readonly LanePull[]>([
    ["/p/uses-codex", [waiting(1)]],
    ["/p/mcc-repo", [waiting(2)]], // MCC AIRPORT: INSPECTION이 리뷰라 레인을 쓰지 않는다
  ]);
  const silent = laneStates(byRepo, NOW, 30 * 60_000, (repo) => repo !== "/p/mcc-repo");
  assert.deepEqual([...silent.keys()], ["/p/uses-codex"]);
  assert.deepEqual(readLaneOps().map((o) => [o.repo, o.op]), [["/p/uses-codex", "silent"]]);
});

test("laneStates: 스위치가 off면 아무것도 하지 않는다(새 기록도, 지난 silent 상태 사용도 없다)", () => {
  const before = readLaneOps().length;
  saveLaneSwitch("off");
  const out = laneStates(new Map([["/p/other", [waiting(3)]]]), NOW, 30 * 60_000);
  assert.equal(out.size, 0);
  assert.equal(readLaneOps().length, before);
  assert.ok(!readLaneOps().some((o) => o.repo === "/p/other"));
  saveLaneSwitch("on");
  assert.equal(laneStates(new Map([["/p/other", [waiting(3)]]]), NOW, 30 * 60_000).size, 1); // 다시 켜면 그때부터
  assert.ok(existsSync(join(config.stateDir, "codex-lane.jsonl")));
});
