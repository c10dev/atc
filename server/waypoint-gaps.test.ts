import assert from "node:assert/strict";
import { test } from "node:test";
import type { Milestone, MilestoneIssue } from "./sources/linear-projects.ts";
import { waypointGapsOf } from "./waypoint-gaps.ts";

const issue = (key: string, stateType: string, state = stateType): MilestoneIssue => ({ key, title: `${key} 제목`, state, stateType, completedAt: null });
const ms = (project: string, name: string, sortOrder: number, over: Partial<Milestone> = {}): Milestone => ({
  id: `${project}:${name}`, project, name, description: "", targetDate: null, progress: 0, sortOrder, status: "unstarted", issues: [], truncated: false, ...over,
});

test("waypointGapsOf: ROUTE마다 지금 구간과 그다음 WAYPOINT의 완료 기준·이슈, 취소 이슈와 끝난 ROUTE는 뺀다", () => {
  const milestones = [
    ms("Song Catalog", "Foundation", 1, { status: "done" }),
    ms("Song Catalog", "Beta Ready", 2, {
      status: "next", description: "Exit criteria:\n1. 곡 페이지 공개\n2. 검색 동작", issues: [issue("VOC-1", "completed", "Done"), issue("VOC-2", "canceled", "Canceled"), issue("VOC-3", "started", "In Progress")],
    }),
    ms("Song Catalog", "Web Surface", 3, { status: "done" }),
    ms("Song Catalog", "Launch", 4, { description: "1. 공개 발표" }),
    ms("Song Catalog", "Later", 5),
    ms("Lyrics", "M1", 1, { status: "done" }), // 모두 지남 → 뺀다
    ms("Old", "X", 1, { status: "next" }), // 끝난 ROUTE → 뺀다
  ];
  const got = waypointGapsOf(milestones, [{ name: "Old", targetDate: null, progress: 1, state: "completed" }]);
  assert.deepEqual(got.map((g) => g.route), ["Song Catalog"]);
  const [active, next] = got[0].waypoints;
  assert.equal(got[0].waypoints.length, 2);
  assert.deepEqual([active.name, active.state, next.name, next.state], ["Beta Ready", "active", "Launch", "planned"]);
  assert.deepEqual(active.criteria, ["곡 페이지 공개", "검색 동작"]);
  assert.deepEqual(active.issues.map((i) => [i.key, i.state]), [["VOC-1", "Done"], ["VOC-3", "In Progress"]]);
  assert.deepEqual(next.criteria, ["공개 발표"]);
  assert.equal(active.description, null); // 번호 목록이 있으면 설명은 싣지 않는다
  assert.equal(active.id, "Song Catalog:Beta Ready");
});

test("waypointGapsOf: 다음 WAYPOINT가 없으면 지금 구간만, 목표를 못 읽어도 동작", () => {
  const got = waypointGapsOf([ms("atc", "M15", 1, { status: "next", description: "Exit when the gate is on." }), ms("atc", "M14", 0, { status: "done" })], null);
  assert.deepEqual(got[0].waypoints.map((w) => w.name), ["M15"]);
  assert.deepEqual([got[0].waypoints[0].criteria, got[0].waypoints[0].description], [[], "Exit when the gate is on."]); // 목록이 없으면 설명 그대로
  assert.deepEqual(waypointGapsOf([], null), []);
});
