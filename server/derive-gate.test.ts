import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim, Session, Snapshot, Ticket, Workspace } from "./model.ts";
import { buildIndex, isGateCleanup, isParkedAtGate, isStripVisible } from "../web/src/derive.ts";

const WT = "/home/c10/projects/worktrees";
const session = (id: string, status: Session["status"]): Session => ({
  id, agent: "claude", name: id.toUpperCase(), status, pid: 1, cwd: "/x", startedAt: "2026-09-29T00:00:00.000Z", lastActiveAt: null, repo: null, workspacePath: null,
});
const ticket = (key: string, stateType: Ticket["stateType"]): Ticket => ({
  key, title: key, state: stateType, stateType, stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: null,
  project: null, labels: [], createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [],
});
const ws = (name: string, ticketKey: string | null): Workspace => ({ path: `${WT}/${name}`, name, repo: "/r", isMain: false, branch: null, head: "", dirty: 0, lastCommitAt: null, ticketKey });
const claim = (sessionId: string, w: Workspace, state: Claim["state"] = "active"): Claim => ({
  sessionId, workspacePath: w.path, since: "2026-09-29T00:00:00.000Z", lastAt: "2026-09-29T00:00:00.000Z", source: "hook", tool: null, state, handedOffTo: null,
});
const idxOf = (over: Partial<Snapshot>) =>
  buildIndex({ sessions: [], workspaces: [], tickets: [], claims: [], alerts: [], airports: [], atfm: { mains: [], groundStops: [] }, ...over } as unknown as Snapshot);

test("isParkedAtGate: ARRIVED + NORDO 점유는 true, ARRIVED + busy 점유는 false", () => {
  const w = ws("a-1", "ATC-1");
  const nordo = idxOf({ sessions: [session("s1", "dead")], workspaces: [w], tickets: [ticket("ATC-1", "completed")], claims: [claim("s1", w)] });
  assert.equal(isParkedAtGate(w, nordo), true);
  const busy = idxOf({ sessions: [session("s1", "busy")], workspaces: [w], tickets: [ticket("ATC-1", "completed")], claims: [claim("s1", w)] });
  assert.equal(isParkedAtGate(w, busy), false);
});

test("isParkedAtGate: ENROUTE + NORDO는 false, CANCELLED는 true, FLIGHT 없음은 false", () => {
  const w = ws("a-2", "ATC-2");
  const enroute = idxOf({ sessions: [session("s1", "dead")], workspaces: [w], tickets: [ticket("ATC-2", "started")], claims: [claim("s1", w)] });
  assert.equal(isParkedAtGate(w, enroute), false);
  const cancelled = idxOf({ sessions: [session("s1", "dead")], workspaces: [w], tickets: [ticket("ATC-2", "canceled")], claims: [claim("s1", w)] });
  assert.equal(isParkedAtGate(w, cancelled), true);
  const bare = ws("adhoc", null);
  assert.equal(isParkedAtGate(bare, idxOf({ workspaces: [bare] })), false);
  assert.equal(isParkedAtGate(w, idxOf({ workspaces: [w] })), false); // 티켓을 모르면 접지 않는다
});

test("isParkedAtGate: 점유 없는 ARRIVED STAND와 HANDOFF된 busy 점유는 true", () => {
  const w = ws("a-3", "ATC-3");
  assert.equal(isParkedAtGate(w, idxOf({ workspaces: [w], tickets: [ticket("ATC-3", "completed")] })), true);
  const idx = idxOf({ sessions: [session("s1", "busy")], workspaces: [w], tickets: [ticket("ATC-3", "completed")], claims: [claim("s1", w, "handed-off")] });
  assert.equal(isParkedAtGate(w, idx), true);
});

test("isGateCleanup: 모든 STAND가 끝난 FLIGHT의 것이고 busy가 아닐 때만", () => {
  const done = ws("a-4", "ATC-4");
  const live = ws("a-5", "ATC-5");
  const tickets = [ticket("ATC-4", "completed"), ticket("ATC-5", "started")];
  const at = (status: Session["status"], ws_: Workspace[]) =>
    idxOf({ sessions: [session("s1", status)], workspaces: [done, live], tickets, claims: ws_.map((w) => claim("s1", w)) });
  assert.equal(isGateCleanup(session("s1", "dead"), at("dead", [done])), true);
  assert.equal(isGateCleanup(session("s1", "idle"), at("idle", [done])), true);
  assert.equal(isGateCleanup(session("s1", "busy"), at("busy", [done])), false);
  assert.equal(isGateCleanup(session("s1", "dead"), at("dead", [live])), false); // 진짜 문제인 NORDO
  assert.equal(isGateCleanup(session("s1", "dead"), at("dead", [done, live])), false);
  assert.equal(isGateCleanup(session("s1", "dead"), at("dead", [])), false); // 쥔 STAND 없음
});

test("isStripVisible: busy, 쥔 STAND가 있음, blocked job만 보이고 PARKED는 숨긴다", () => {
  const w = ws("a-6", "ATC-6");
  const idx = idxOf({ sessions: [session("s1", "idle"), session("s2", "idle"), session("s3", "idle"), session("s4", "busy")], workspaces: [w], tickets: [ticket("ATC-6", "started")], claims: [claim("s1", w)] });
  assert.equal(isStripVisible(session("s1", "idle"), idx), true); // 쥔 STAND
  assert.equal(isStripVisible(session("s2", "idle"), idx), false); // PARKED
  assert.equal(isStripVisible({ ...session("s3", "idle"), job: { state: "blocked" } } as Session, idx), true); // NEEDS YOU
  assert.equal(isStripVisible(session("s4", "busy"), idx), true);
});
