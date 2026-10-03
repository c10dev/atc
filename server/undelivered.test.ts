import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET } from "./crew.ts";
import { DEFAULT_DISPATCH_CONFIG, planDispatch } from "./dispatch.ts";
import { followingOf, type FollowInput, undeliveredOf, UNABLE_KEEP_MS } from "./following.ts";
import type { Session, Snapshot, Ticket } from "./model.ts";
import { canApply, DELIVERY_FAILED_WHY, fold, humanOf, NO_SESSION_SEND_WHY, noLiveSessionWhyOf, type Op, recentPairsOf, reservedOf, syncOps } from "./proposals.ts";
import { radioOf } from "./radio.ts";
import { RESTARTING_TEXT } from "./restarting.ts";

// ATC-183: OCC가 보낸다고 한 FLIGHT PLAN이 닿지 않은 경우. 없는 세션으로 보내지 않고, 실패를 알리는 길이 있다
const ATCC = "/home/c10/projects/atc";
const at = (hms: string) => Date.parse(`2026-09-30T${hms}Z`);
const iso = (hms: string) => `2026-09-30T${hms}.000Z`;

const session = (id: string, name: string, status: Session["status"] = "idle"): Session => ({ id, agent: "claude", name, status, pid: 1, cwd: ATCC, startedAt: iso("00:00:00"), lastActiveAt: iso("07:00:00"), repo: ATCC, worktree: null, branch: null, ticketKey: null } as unknown as Session);
const ticket = (key: string): Ticket =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: iso("00:00:00"), project: "Beta Readiness", labels: [], createdAt: iso("00:00:00"), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [] }) as unknown as Ticket;
const snap = (now: string, over: Partial<Snapshot> = {}): Snapshot =>
  ({
    at: iso(now), linear: { enabled: true, error: null, fetchedAt: iso(now) }, github: { enabled: true, error: null, fetchedAt: iso(now) }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [], workspaces: [], tickets: [ticket("ATC-9")], columns: [], claims: [], handoffs: [], alerts: [], clearances: [], airports: [{ id: "r", code: "ATCC", name: "atc", repo: ATCC }], ...over,
  }) as unknown as Snapshot;
const cfg = { ...DEFAULT_DISPATCH_CONFIG, teamAirports: { ...DEFAULT_DISPATCH_CONFIG.teamAirports, ATC: "ATCC" }, candidateTeams: ["ATC"], projectAirports: { "Beta Readiness": "ATCC" } };

const create = { op: "create", id: "D-0001", at: iso("06:00:00"), kind: "ASSIGN", flight: "ATC-9", aircraft: "sid", aircraftName: "TEAM_H", airport: "ATCC", score: 9, factors: [] } as Op;
const approved: Op[] = [create, { op: "approve", id: "D-0001", at: iso("06:01:00") }];
const sentOps: Op[] = [...approved, { op: "send", id: "D-0001", at: iso("06:02:00"), message: "[DISPATCH D-0001] FLIGHT PLAN" }];
const undelivered = (atHms: string, reason = "no such session"): Op => ({ op: "undelivered", id: "D-0001", at: iso(atHms), reason });

test("noLiveSessionWhyOf: 살아 있는 세션이 있으면 null, 없으면(RESTARTING이든 아니든) 보내지 않는다, launch 카드는 뺀다", () => {
  const [p] = fold(approved);
  assert.equal(noLiveSessionWhyOf(p!, { sessions: [session("s1", "TEAM_H")] }), null);
  // 같은 REGISTRATION의 다른 표기(세션 이름)도 산 세션이다
  assert.equal(noLiveSessionWhyOf(p!, { sessions: [session("s1", "Team H")] }), null);
  // 세션이 없다
  assert.equal(noLiveSessionWhyOf(p!, { sessions: [] }), `TEAM_H: ${NO_SESSION_SEND_WHY}`);
  assert.equal(NO_SESSION_SEND_WHY, "AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)");
  // 죽은 세션은 산 세션이 아니다
  assert.match(noLiveSessionWhyOf(p!, { sessions: [session("s1", "TEAM_H", "dead")] })!, /AIRCRAFT 세션 없음/);
  // 다른 AIRCRAFT의 세션은 아니다
  assert.match(noLiveSessionWhyOf(p!, { sessions: [session("s2", "TEAM_G")] })!, /AIRCRAFT 세션 없음/);
  // 유예가 지나 RESTARTING이 없어진 뒤(ABSENT)도 같다 — RESTARTING 정보 없이 세션만 본다
  assert.match(noLiveSessionWhyOf(p!, { sessions: [], ...{ restarting: [] } } as never)!, /LAUNCH 필요/);
  // launch 카드는 LAUNCH가 FLIGHT PLAN을 첫 프롬프트로 가져가므로 뺀다
  assert.equal(noLiveSessionWhyOf({ ...p!, launch: true }, { sessions: [] }), null);
});

test("undelivered: sent를 approved로 돌린다. 승인 시각은 지키고 SUPERVISOR 판정이 되지 않는다", () => {
  const before = fold(sentOps)[0]!;
  assert.equal(before.status, "sent");
  const decided = humanOf(before);
  const [p] = fold([...sentOps, undelivered("06:03:00")]);
  assert.equal(p!.status, "approved");
  assert.equal(p!.statusAt, iso("06:03:00"));
  assert.equal(p!.timeline.approved, iso("06:01:00")); // 승인 시각은 그대로
  assert.equal(p!.timeline.sent, undefined);
  assert.equal(p!.message, null);
  assert.deepEqual(p!.undelivered, { at: iso("06:03:00"), reason: "no such session", n: 1, cause: "absent" });
  assert.deepEqual(humanOf(p!), decided); // 사람 판정(승인)은 그대로, 새 판정이 아니다
  assert.equal(p!.decidedAt, before.decidedAt);
  // 다음 release가 다시 send할 수 있다
  assert.equal(canApply(p!, "send"), true);
  const [again] = fold([...sentOps, undelivered("06:03:00"), { op: "send", id: "D-0001", at: iso("06:10:00"), message: "m2" }, undelivered("06:11:00", "again")]);
  assert.equal(again!.status, "approved");
  assert.deepEqual(again!.undelivered, { at: iso("06:11:00"), reason: "again", n: 2, cause: "other" });
});

test("undelivered: sent가 아니면 아무것도 바꾸지 않는다", () => {
  for (const ops of [[create], approved, [...sentOps, { op: "accept", id: "D-0001", at: iso("06:05:00") } as Op]]) {
    const before = fold(ops)[0]!;
    const after = fold([...ops, undelivered("06:20:00")])[0]!;
    assert.equal(after.status, before.status);
    assert.equal(after.undelivered, undefined);
  }
});

const opsAt = (now: string, sessions: Session[], restarting: { registration: string; name: string; sessionId: string; since: string; until: string }[] = [], existing = fold([...sentOps, undelivered("06:03:00", "no such session")])) => {
  const s = snap(now, { sessions, restarting } as Partial<Snapshot>);
  const plan = planDispatch(s, new Map(), cfg, at(now), reservedOf(existing, at(now)), DEFAULT_FLEET);
  return syncOps(existing, plan, s, cfg, at(now), 1);
};
const brief = (ops: Op[]) => ops.map((o) => `${o.op}:${o.id}${"reason" in o ? `:${o.reason}` : ""}`);

test("동기화: 돌아온 approved는 세션이 없으면 'AIRCRAFT 불가: 전달 실패 — 사유'로 닫히고, 세션이 있거나 RESTARTING이면 그대로 둔다", () => {
  // AIRCRAFT가 더는 후보가 아니다(세션 없음, RESTARTING도 아님)
  assert.deepEqual(brief(opsAt("06:20:00", [])), [`supersede:D-0001:${DELIVERY_FAILED_WHY} — no such session`]);
  // 세션이 돌아왔다: 그대로 approved로 둔다(다음 release가 다시 보낸다)
  assert.deepEqual(brief(opsAt("06:20:00", [session("s1", "TEAM_H")])), []);
  // /clear 뒤 첫 메시지를 기다리는 중: 기다린다
  const restarting = [{ registration: "TEAM_H", name: "TEAM_H", sessionId: "old", since: iso("06:15:00"), until: iso("06:45:00") }];
  assert.deepEqual(brief(opsAt("06:20:00", [], restarting)), []);
  // 전달 실패 기록이 없는 approved는 예전 사유 그대로
  const plain = fold(approved);
  assert.deepEqual(brief(opsAt("06:20:00", [], [], plain)), ["supersede:D-0001:AIRCRAFT 불가: 세션 없음"]);
});

test("전달 실패로 닫힌 제안은 SUPERVISOR 판정이 아니라 24시간 짝 규칙을 시작하지 않는다", () => {
  const ops: Op[] = [...sentOps, undelivered("06:03:00"), { op: "supersede", id: "D-0001", at: iso("06:20:00"), reason: `${DELIVERY_FAILED_WHY} — no such session` }];
  const closed = fold(ops);
  assert.equal(closed[0]!.status, "superseded");
  assert.equal(recentPairsOf(closed, at("06:30:00")).size, 0);
  // 같은 사유가 아닌 AIRCRAFT 불가는 예전처럼 짝을 막는다
  const plain = fold([...approved, { op: "supersede", id: "D-0001", at: iso("06:20:00"), reason: "AIRCRAFT 불가: 세션 없음" }]);
  assert.equal(recentPairsOf(plain, at("06:30:00")).size, 1);
});

const input = (over: Partial<FollowInput>): FollowInput => ({ proposals: [], tickets: [], workspaces: [], pulls: [], logbook: [], departures: [], now: at("07:00:00"), ...over });

test("FOLLOWING: 전달 실패는 CAUTION(warn) 한 건, 시도마다 한 번, 하루 뒤 사라진다", () => {
  const [p] = fold([...sentOps, undelivered("06:03:00", "no such session")]);
  const list = undeliveredOf([p!], at("07:00:00"));
  assert.deepEqual(list, [{ flight: "ATC-9", id: "D-0001", aircraft: "TEAM_H", reason: "no such session", at: iso("06:03:00") }]);
  const [f] = followingOf(input({ proposals: [p!], tickets: [ticket("ATC-9")], undelivered: list }));
  const issues = f!.issues.filter((i) => i.code === "undelivered");
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.severity, "warn");
  assert.match(issues[0]!.text, /TEAM_H D-0001 FLIGHT PLAN이 닿지 않음 — no such session/);
  assert.equal(issues[0]!.key, `ATC-9|undelivered|D-0001|${iso("06:03:00")}`);
  // 제안이 닫힌 뒤에도 하루는 보인다(제안 목록에 없어도 대상이 된다)
  const [g] = followingOf(input({ proposals: [], tickets: [ticket("ATC-9")], undelivered: list }));
  assert.equal(g!.issues.some((i) => i.code === "undelivered"), true);
  // 하루가 지나면 사라진다
  assert.deepEqual(undeliveredOf([p!], at("06:03:00") + UNABLE_KEEP_MS), []);
  // 전달 실패가 없는 제안에는 없다
  assert.deepEqual(undeliveredOf(fold(sentOps), at("07:00:00")), []);
});

test("RADIO: 닿지 않은 FLIGHT PLAN 호출은 닫혀 undelivered로 표시되고, 다시 보내면 같은 id의 새 호출이 생긴다", () => {
  const proposals: Op[] = [...sentOps, undelivered("06:03:00", "no such session"), { op: "send", id: "D-0001", at: iso("06:10:00"), message: "m2" }];
  const txs = radioOf({ clearances: [], proposals, crewChanges: [], reports: [], mcc: [], rts: [] });
  const calls = txs.filter((t) => t.kind === "FLIGHT PLAN");
  assert.equal(calls.length, 2);
  const [first, second] = calls;
  assert.equal(first!.id, "D-0001#undelivered1");
  assert.equal(first!.undelivered, "no such session");
  assert.equal(first!.closedBy, "undelivered");
  assert.equal(first!.open, undefined);
  assert.equal(first!.overdueAt, undefined);
  assert.equal(first!.freq, "DELIVERY");
  assert.equal(second!.id, "D-0001");
  assert.equal(second!.open, true);
  assert.equal(second!.undelivered, undefined);
  // id는 모두 다르다
  assert.equal(new Set(txs.map((t) => t.id)).size, txs.length);
});

test("상태 문구: RESTARTING_TEXT를 쓰는 기존 경로는 그대로다", () => {
  assert.match(RESTARTING_TEXT, /세션 없음/);
});
