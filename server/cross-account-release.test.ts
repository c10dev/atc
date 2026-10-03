import "./test-hermetic.ts"; // 진짜 HOME·상태 폴더를 읽지 않게(ATC-190). 첫 import여야 한다
import assert from "node:assert/strict";
import { test } from "node:test";
import { crossAccountAircraftWhy } from "./account-reach.ts";
import { DEFAULT_FLEET } from "./crew.ts";
import { DEFAULT_DISPATCH_CONFIG, planDispatch } from "./dispatch.ts";
import { isCrossAccountClosed, misfireOf, misfireView } from "./misfire.ts";
import type { Session, Snapshot, Ticket } from "./model.ts";
import { crossAccountCardWaitsOf, fold, type Op, reservedOf, syncOps } from "./proposals.ts";
import { followRowOf } from "./follow.ts";

// ATC-458: OCC가 닿지 못하는(다른 ACCOUNT) 살아 있는 AIRCRAFT는 계획이 고르지 않고, 그 AIRCRAFT의 열린 카드는 스위치가 켜져 있으면 닫는다.
const T0 = "2026-10-03T06:00:00.000Z";
const NOW = Date.parse("2026-10-03T06:30:00.000Z");
const ATCC = "/home/c10/projects/atc";
const session = (name: string, account?: string, status: Session["status"] = "idle"): Session =>
  ({ id: `id-${name}`, agent: "claude", name, status, pid: 1, cwd: ATCC, startedAt: T0, lastActiveAt: T0, repo: ATCC, workspacePath: ATCC, ...(account ? { account } : {}) }) as unknown as Session;
const ticket = (key: string): Ticket =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: T0, project: "Beta Readiness", labels: [], createdAt: T0, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [] }) as Ticket;
const snap = (sessions: Session[]): Snapshot =>
  ({ at: T0, linear: { enabled: true, error: null, fetchedAt: T0 }, github: { enabled: true, error: null, fetchedAt: T0 }, pulls: [], atfm: { mains: [], groundStops: [] }, sessions, workspaces: [], tickets: [ticket("ATC-9")], columns: [], claims: [], handoffs: [], alerts: [], clearances: [], airports: [{ id: "r", code: "ATCC", name: "atc", repo: ATCC }] }) as unknown as Snapshot;
const cfgOf = (crossAccountRelease: "on" | "off") => ({ ...DEFAULT_DISPATCH_CONFIG, crossAccountRelease, candidateTeams: ["ATC"], teamAirports: { ...DEFAULT_DISPATCH_CONFIG.teamAirports, ATC: "ATCC" }, projectAirports: { "Beta Readiness": "ATCC" } });
const planOf = (s: Snapshot, existing = fold([]), mode: "on" | "off" = "on") => planDispatch(s, new Map(), cfgOf(mode), NOW, reservedOf(existing, NOW), DEFAULT_FLEET);

const cross = snap([session("OCC", "acct-3"), session("TEAM_H", "acct-1")]);

test("crossAccountAircraftWhy: 둘 다 알고 다를 때만 — 이유에 두 ACCOUNT와 고치는 길, 모르면 null", () => {
  const why = crossAccountAircraftWhy({ name: "TEAM_H", account: "acct-1" }, { account: "acct-3" })!;
  assert.match(why, /^ACCOUNT 불일치 — TEAM_H는 ACCOUNT acct-1에 있고 OCC는 acct-3에 있어/);
  assert.match(why, /ACCOUNT CHANGE·APPLY NOW/);
  assert.equal(crossAccountAircraftWhy({ name: "TEAM_H", account: "acct-1" }, { account: "acct-1" }), null);
  assert.equal(crossAccountAircraftWhy({ name: "TEAM_H", account: "acct-1" }, { account: null }), null);
  assert.equal(crossAccountAircraftWhy({ name: "TEAM_H", account: "acct-1" }, undefined), null);
  assert.equal(crossAccountAircraftWhy({ name: "TEAM_H" }, { account: "acct-3" }), null);
});

test("계획: OCC와 ACCOUNT가 다른 AIRCRAFT는 available false, 같거나 모르면 배정한다", () => {
  const p = planOf(cross);
  const ac = p.aircraft.find((a) => a.name === "TEAM_H")!;
  assert.deepEqual([ac.available, ac.crossAccount], [false, true]);
  assert.match(ac.reason, /^ACCOUNT 불일치 — TEAM_H는 ACCOUNT acct-1에 있고 OCC는 acct-3에 있어/);
  assert.deepEqual(p.assign, []);
  for (const sessions of [[session("OCC", "acct-1"), session("TEAM_H", "acct-1")], [session("OCC"), session("TEAM_H", "acct-1")], [session("OCC", "acct-3"), session("TEAM_H")]]) {
    const q = planOf(snap(sessions));
    assert.equal(q.aircraft.find((a) => a.name === "TEAM_H")!.available, true);
    assert.deepEqual(q.assign.map((a) => a.aircraftName), ["TEAM_H"]);
  }
});

const card = (status: "proposed" | "approved", via?: "auto"): Op[] => [
  { op: "create", id: "D-0001", at: T0, kind: "ASSIGN", flight: "ATC-9", aircraft: "id-TEAM_H", aircraftName: "TEAM_H", registration: "TEAM_H", airport: "ATCC", score: 9, factors: [] } as Op,
  ...(status === "approved" ? [{ op: "approve", id: "D-0001", at: "2026-10-03T06:01:00.000Z", ...(via ? { via } : {}) } as Op] : []),
];
const briefOf = (ops: Op[]) => ops.map((o) => `${o.op}:${o.id}${"reason" in o ? `:${o.reason}` : ""}`);

test("스위치 on: 열린 카드(제안·승인)는 AIRCRAFT 불가 + ACCOUNT 불일치 사유로 닫혀 FLIGHT가 계획으로 돌아온다", () => {
  for (const status of ["proposed", "approved"] as const) {
    const existing = fold(card(status, "auto"));
    const ops = syncOps(existing, planOf(cross, existing), cross, cfgOf("on"), NOW, 1);
    const [line] = briefOf(ops);
    assert.match(line!, /^supersede:D-0001:AIRCRAFT 불가: ACCOUNT 불일치 — TEAM_H는 ACCOUNT acct-1에 있고 OCC는 acct-3에 있어/);
    assert.equal(ops.length, 1);
  }
});

test("스위치 off: 계획 규칙만 적용 — 카드는 닫히지 않고 기다린다(ATC-251 사유는 waitingOf가 낸다)", () => {
  for (const status of ["proposed", "approved"] as const) {
    const existing = fold(card(status));
    assert.deepEqual(briefOf(syncOps(existing, planOf(cross, existing, "off"), cross, cfgOf("off"), NOW, 1)), []);
  }
});

test("ACCOUNT가 같아지면 카드는 그대로 둔다(닫지 않는다)", () => {
  const same = snap([session("OCC", "acct-1"), session("TEAM_H", "acct-1")]);
  const existing = fold(card("approved"));
  assert.deepEqual(briefOf(syncOps(existing, planOf(same, existing), same, cfgOf("on"), NOW, 1)), []);
});

test("닫힌 카드: misfireOf는 자동 승인이면 wrong-aircraft, 같은 짝은 판정이 아니라서 다시 후보가 된다", () => {
  const existing = fold(card("approved", "auto"));
  const ops = syncOps(existing, planOf(cross, existing), cross, cfgOf("on"), NOW, 1);
  const closed = fold([...card("approved", "auto"), ...ops]);
  assert.equal(closed[0]!.status, "superseded");
  assert.equal(isCrossAccountClosed(closed[0]!), true);
  assert.equal(misfireOf(closed[0]!), "wrong-aircraft");
  // 같은 짝 24시간 규칙에 걸리지 않는다(AIRCRAFT가 닿게 되면 바로 후보)
  const reach = snap([session("OCC", "acct-1"), session("TEAM_H", "acct-1")]);
  const again = syncOps(closed, planOf(reach, closed), reach, cfgOf("on"), NOW, 2);
  assert.deepEqual(again.map((o) => o.op), ["create"]);
});

test("카운터: misfireView가 닫은 날짜별·합계로 센다. 다른 사유와 사람이 승인한 카드도 센다", () => {
  const existing = fold(card("approved"));
  const ops = syncOps(existing, planOf(cross, existing), cross, cfgOf("on"), NOW, 1);
  const closed = fold([...card("approved"), ...ops]);
  const other = fold([{ op: "create", id: "D-0002", at: T0, kind: "ASSIGN", flight: "ATC-8", aircraft: "x", aircraftName: "TEAM_B", airport: "ATCC", score: 1, factors: [] } as Op, { op: "supersede", id: "D-0002", at: T0, reason: "AIRCRAFT 불가: AIRBORNE" } as Op]);
  const v = misfireView([...closed, ...other], NOW, 2);
  assert.deepEqual([v.today.crossAccount, v.daily[0]!.crossAccount, v.total.crossAccount], [1, 0, 1]);
});

test("카드·FOLLOW: 승인됐는데 ACCOUNT 불일치로 못 보내는 카드는 짧은 사유를 낸다. 한쪽이 모르면 없다", () => {
  const props = fold(card("approved"));
  const waits = crossAccountCardWaitsOf(props, cross);
  assert.equal(waits["D-0001"], "ACCOUNT 불일치 — TEAM_H(acct-1) ≠ OCC(acct-3), OCC가 닿지 못함");
  assert.deepEqual(crossAccountCardWaitsOf(props, snap([session("OCC"), session("TEAM_H", "acct-1")])), {});
  assert.deepEqual(crossAccountCardWaitsOf(fold(card("proposed")), cross), {});
  const t = ticket("ATC-9");
  const inp = { tickets: [t], proposals: props, pulls: [], clearances: [], milestones: new Map(), following: [], progress: {}, plan: null, noDeploy: new Set<string>(), now: Date.parse("2026-10-03T06:20:00.000Z") };
  const without = followRowOf("ATC-9", inp);
  assert.equal(without.now, "승인 19분 · 발송 없음");
  const withWaits = followRowOf("ATC-9", { ...inp, cardWaits: waits });
  assert.equal(withWaits.now, "승인 19분 · ACCOUNT 불일치 — TEAM_H(acct-1) ≠ OCC(acct-3), OCC가 닿지 못함");
  assert.equal(withWaits.stuck?.text, withWaits.now);
});
