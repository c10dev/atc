import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type DispatchConfig, planDispatch, readFlightHistory } from "./dispatch.ts";
import type { Claim, Session, Snapshot, Ticket, Workspace } from "./model.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const VCDO = "/home/c10/projects/vocado_nextjs";
const WT = "/home/c10/projects/worktrees";

const session = (id: string, name: string, status: Session["status"] = "idle", repo: string | null = VCDO): Session => ({
  id, agent: "claude", name, status, pid: 1, cwd: repo ?? "/home/c10", startedAt: daysAgo(1), lastActiveAt: daysAgo(0),
  repo, workspacePath: repo,
});
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, priority: 3,
  url: null, updatedAt: daysAgo(1), project: "Beta Readiness", labels: [], createdAt: daysAgo(2), startedAt: null,
  blocks: [], blockedBy: [], related: [], ...over,
});
const ws = (name: string, ticketKey: string | null): Workspace => ({
  path: `${WT}/${name}`, name, repo: VCDO, isMain: false, branch: null, head: "", dirty: 0, lastCommitAt: null, ticketKey,
});
const claim = (sessionId: string, wsName: string): Claim => ({
  sessionId, workspacePath: `${WT}/${wsName}`, since: daysAgo(0.1), lastAt: daysAgo(0.01), source: "hook", tool: null,
  state: "active", handedOffTo: null,
});

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    at: new Date(NOW).toISOString(), linear: { enabled: true, error: null, fetchedAt: daysAgo(0) },
    sessions: [], workspaces: [], tickets: [], columns: [], claims: [], handoffs: [], alerts: [], clearances: [],
    airports: [{ id: "r1", code: "VCDO", name: "vocado_nextjs", repo: VCDO }],
    ...over,
  };
}
const cfg = (over: Partial<DispatchConfig> = {}): DispatchConfig => ({ ...DEFAULT_DISPATCH_CONFIG, ...over });

test("후보 FLIGHT: 다른 운항사 라벨, 제외·매핑 없는 프로젝트, STAND 있음은 제외, 막힌 것은 HOLD_DEPARTURE", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A")],
    workspaces: [ws("vocado-voc-5", "VOC-5")],
    tickets: [
      ticket("VOC-1", { labels: ["symphony-pilot"] }),
      ticket("VOC-2", { project: "Vocado Visual System (SEED)" }),
      ticket("VOC-3", { project: "Somewhere Else" }),
      ticket("VOC-4", { project: null }),
      ticket("VOC-5"),
      ticket("VOC-6", { blockedBy: ["VOC-7"] }),
      ticket("VOC-7", { state: "In Progress", stateType: "started" }),
      ticket("VOC-8", { blockedBy: ["VOC-9", "VOC-999"] }),
      ticket("VOC-9", { state: "Done", stateType: "completed" }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(Object.fromEntries(p.excluded.map((e) => [e.flight, e.reason])), {
    "VOC-1": "라벨 symphony-pilot (다른 운항사)",
    "VOC-2": "배정 제외 프로젝트: Vocado Visual System (SEED)",
    "VOC-3": "배정 제외 프로젝트: Somewhere Else",
    "VOC-4": "프로젝트 없음",
    "VOC-5": "이미 STAND가 있음",
  });
  assert.deepEqual(p.hold, [{ flight: "VOC-6", blockedBy: ["VOC-7"] }]);
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-8"]);
});

test("AIRCRAFT: AIRBORNE·진행 중 STAND·소속 없음은 불가, PARKED와 끝난 STAND만 쥔 HOLDING은 가능, TEAM 아닌 세션은 무시", () => {
  const s = snap({
    sessions: [
      session("a", "TEAM_A", "busy"),
      session("b", "TEAM_B"),
      session("c", "TEAM_C"),
      session("d", "TEAM_D"),
      session("e", "TEAM_E", "idle", null),
      session("x", "President"),
    ],
    workspaces: [ws("vocado-voc-10", "VOC-10"), ws("vocado-voc-11", "VOC-11")],
    claims: [claim("c", "vocado-voc-10"), claim("d", "vocado-voc-11")],
    tickets: [ticket("VOC-10", { state: "In Progress", stateType: "started" }), ticket("VOC-11", { state: "Done", stateType: "completed" })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(
    p.aircraft.map((a) => `${a.callsign}:${a.available ? "Y" : "N"}:${a.reason}`),
    ["ALPHA:N:AIRBORNE", "BRAVO:Y:PARKED", "CHARLIE:N:HOLDING — VOC-10 진행 중", "DELTA:Y:HOLDING, 남은 FLIGHT 없음", "ECHO:N:소속 AIRPORT 없음"],
  );
});

test("점수 순으로 짝짓고, 팀 적합도가 있는 팀에 먼저 간다", () => {
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("d", "TEAM_D")],
    tickets: [
      ticket("VOC-20", { priority: 1, project: "Song Experience" }),
      ticket("VOC-21", { priority: 4 }),
      ticket("VOC-30", { state: "Done", stateType: "completed", project: "Song Experience" }),
    ],
  });
  const history = new Map([["d", ["VOC-30"]]]);
  const p = planDispatch(s, history, cfg(), NOW);
  assert.deepEqual(p.assign.map((a) => `${a.flight}→${a.aircraftName}`), ["VOC-20→TEAM_D", "VOC-21→TEAM_B"]);
  const top = p.assign[0].factors.find((f) => f.id === "affinity")!;
  assert.equal(top.value, 1);
  assert.equal(top.detail, "VOC-30");
  assert.ok(p.assign[0].score > p.assign[1].score);
});

test("충돌 위험: AIRBORNE FLIGHT와 연결된 FLIGHT는 점수가 깎인다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("b", "TEAM_B")],
    workspaces: [ws("vocado-voc-40", "VOC-40")],
    claims: [claim("a", "vocado-voc-40")],
    tickets: [
      ticket("VOC-40", { state: "In Progress", stateType: "started" }),
      ticket("VOC-41", { related: ["VOC-40"] }),
      ticket("VOC-42"),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.equal(p.assign[0].flight, "VOC-42");
  assert.equal(p.assign.length, 1);
});

test("AIRPORT 슬롯: 한도가 차면 더 배정하지 않는다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("b", "TEAM_B"), session("c", "TEAM_C")],
    tickets: [ticket("VOC-50"), ticket("VOC-51")],
  });
  const p = planDispatch(s, new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 2 } } }), NOW);
  assert.equal(p.assign.length, 1);
  assert.deepEqual(p.slots, [{ airport: "VCDO", airborne: 1, planned: 1, limit: 2 }]);
});

test("RELEASE: STAND 없이 기준 일수를 넘긴 In Progress, 코드 작업 프로젝트만", () => {
  const s = snap({
    workspaces: [ws("vocado-voc-63", "VOC-63")],
    tickets: [
      ticket("VOC-60", { state: "In Progress", stateType: "started", startedAt: daysAgo(5) }),
      ticket("VOC-61", { state: "In Progress", stateType: "started", startedAt: daysAgo(1) }),
      ticket("VOC-62", { state: "In Review", stateType: "started", startedAt: daysAgo(9) }),
      ticket("VOC-63", { state: "In Progress", stateType: "started", startedAt: daysAgo(9) }),
      ticket("VOC-64", { state: "In Progress", stateType: "started", startedAt: daysAgo(4), project: null }),
      ticket("VOC-65", { state: "In Progress", stateType: "started", startedAt: daysAgo(6), project: "Vocado Pre-seed IR & Pitch Deck" }),
      ticket("VOC-66", { state: "In Progress", stateType: "started", startedAt: daysAgo(4), project: "Song Experience" }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(p.release.map((r) => `${r.flight}:${r.days}:${r.airport}`), ["VOC-60:5:VCDO", "VOC-66:4:VCDO"]);
});

test("운항 이력: 청구 기록 파일 이름에서 FLIGHT key를 뽑는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-hist-"));
  mkdirSync(join(dir, "s1"));
  for (const p of [`${WT}/vocado-voc-191-anon`, `${WT}/vocado-voc185-song`, `${WT}/tennis-character`]) {
    writeFileSync(join(dir, "s1", encodeURIComponent(p) + ".json"), "{}");
  }
  assert.deepEqual([...readFlightHistory("VOC", dir)], [["s1", ["VOC-185", "VOC-191"]]]);
});
