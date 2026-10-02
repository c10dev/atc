import assert from "node:assert/strict";
import { test } from "node:test";
import { homeAlertsOf, stuckRowsOf } from "../web/src/home-rows.ts";
import { proposalAskOf } from "./duty-card.ts";
import { type FollowInput, followRowOf } from "./follow.ts";
import type { Milestones } from "./milestones.ts";
import type { Ticket } from "./model.ts";
import { type Proposal, proposalsOfFlight } from "./proposals.ts";
import { type QueueInput, supervisorQueueOf } from "./supervisor-queue.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";

// HOME(ATC-377)의 순수 부분: 줄 고르기, 승인 문구, 큐 줄의 card, FLIGHT 배정 기록, FOLLOW 줄의 proposalInfo
const NOW = Date.parse("2026-10-02T09:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const alert = (key: string, level: SupervisorAlert["level"], dest: SupervisorAlert["dest"]): SupervisorAlert => ({ key, level, dest, group: "alert", cue: null, aircraft: null, flight: null, text: key, next: "", link: "#home", since: null }) as SupervisorAlert;

test("homeAlertsOf: WARNING·CAUTION 가운데 조건(alerts)만, 막힌 줄(follow|stuck)과 큐·로그·낮은 등급은 뺀다", () => {
  const items = [
    alert("alert|a", "warning", "alerts"),
    alert("alert|b", "caution", "alerts"),
    alert("follow|stuck|ATC-1|sent", "caution", "alerts"), // STUCK이 보인다
    alert("pending|proposal|D-1", "caution", "queue"),
    alert("rts|x", "warning", "log"),
    alert("alert|c", "advisory", "alerts"),
    alert("alert|d", null, "alerts"),
  ];
  assert.deepEqual(homeAlertsOf(items).map((a) => a.key), ["alert|a", "alert|b"]);
  assert.deepEqual(homeAlertsOf([]), []);
});

test("stuckRowsOf: 끝나지 않은 막힌 줄만, 같은 FLIGHT는 번들이 겹쳐도 한 번", () => {
  const row = (key: string, o: { stuck?: boolean; finished?: boolean } = {}) => ({ key, stuck: o.stuck === false ? null : { stage: "sent", code: "sent-no-readback", text: "t", since: null }, finished: Boolean(o.finished) }) as never;
  const bundles = [{ rows: [row("ATC-1"), row("ATC-2", { stuck: false }), row("ATC-3", { finished: true })] }, { rows: [row("ATC-1"), row("ATC-4")] }];
  assert.deepEqual(stuckRowsOf(bundles).map((r) => r.key), ["ATC-1", "ATC-4"]);
});

test("proposalAskOf: ASSIGN은 FLIGHT PLAN, launch는 LAUNCH가 먼저, RELEASE는 FLIGHT PLAN 없음, 거절은 24시간", () => {
  assert.match(proposalAskOf("D-1", "approve", { kind: "ASSIGN", launch: false }), /FLIGHT PLAN을 보냅니다/);
  assert.doesNotMatch(proposalAskOf("D-1", "approve", { kind: "ASSIGN", launch: false }), /LAUNCH/);
  const launch = proposalAskOf("D-2", "approve", { kind: "ASSIGN", launch: true });
  assert.match(launch, /LAUNCH하고/);
  assert.match(launch, /FLIGHT PLAN을 보냅니다/);
  const release = proposalAskOf("D-3", "approve", { kind: "RELEASE", launch: false });
  assert.match(release, /RELEASE/);
  assert.match(release, /FLIGHT PLAN은 보내지 않고/);
  assert.match(proposalAskOf("D-4", "reject", { kind: "ASSIGN", launch: false }), /24시간/);
  assert.match(proposalAskOf("D-5", "approve", undefined), /FLIGHT PLAN을 보냅니다/); // 옛 서버: 카드 종류를 모르면 ASSIGN으로
});

test("큐의 PROPOSAL 줄은 card(kind·launch)를 싣는다", () => {
  const p = (id: string, kind: "ASSIGN" | "RELEASE", launch?: true) => ({ id, kind, status: "proposed", flight: "ATC-1", aircraftName: "TEAM_A", holdAt: null, statusAt: ago(5), awaitSupervisor: undefined, undelivered: undefined, ...(launch ? { launch } : {}) });
  const inp = { proposals: [p("D-1", "ASSIGN"), p("D-2", "ASSIGN", true), p("D-3", "RELEASE")], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 3 } as unknown as QueueInput;
  const cards = Object.fromEntries(supervisorQueueOf(inp, NOW).map((i) => [i.key, i.card]));
  assert.deepEqual(cards, { "D-1": { kind: "ASSIGN", launch: false }, "D-2": { kind: "ASSIGN", launch: true }, "D-3": { kind: "RELEASE", launch: false } });
});

test("proposalsOfFlight: 그 FLIGHT만, 최근 것이 먼저, limit건까지", () => {
  const all = [{ id: "D-1", flight: "ATC-1", at: ago(300) }, { id: "D-2", flight: "ATC-2", at: ago(200) }, { id: "D-3", flight: "ATC-1", at: ago(100) }, { id: "D-4", flight: "ATC-1", at: ago(10) }];
  assert.deepEqual(proposalsOfFlight(all, "ATC-1").map((p) => p.id), ["D-4", "D-3", "D-1"]);
  assert.deepEqual(proposalsOfFlight(all, "ATC-1", 2).map((p) => p.id), ["D-4", "D-3"]);
  assert.deepEqual(proposalsOfFlight(all, "ATC-9"), []);
});

test("FOLLOW 줄의 proposalInfo: 줄을 이끄는 제안의 상태와 AIRCRAFT, 제안이 없으면 null", () => {
  const ticket = (key: string): Ticket =>
    ({ key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, priority: 3, url: `https://l/${key}`, updatedAt: ago(5), project: null, labels: [], createdAt: ago(900), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null }) as Ticket;
  const base = (over: Partial<Omit<FollowInput, "parents">>): Omit<FollowInput, "parents"> => ({ tickets: [ticket("ATC-1")], proposals: [], pulls: [], clearances: [], milestones: new Map<string, Milestones>(), following: [], progress: {}, plan: null, noDeploy: new Set(), now: NOW, ...over });
  const approved = { id: "D-7", at: ago(60), kind: "ASSIGN", flight: "ATC-1", aircraft: "f", aircraftName: "TEAM_F", airport: "ATCC", score: 1, factors: [], status: "approved", decidedAt: null, statusAt: ago(30), timeline: { approved: ago(30) }, reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: null, crosscheck: null } as unknown as Proposal;
  assert.deepEqual(followRowOf("ATC-1", base({ proposals: [approved] })).proposalInfo, { id: "D-7", status: "approved", aircraftName: "TEAM_F", departedStand: null, departedVia: null });
  assert.equal(followRowOf("ATC-1", base({})).proposalInfo, null);
});
