import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLEET, type FleetFile } from "./crew.ts";
import type { Departure } from "./departures.ts";
import { DEFAULT_DISPATCH_CONFIG, planDispatch } from "./dispatch.ts";
import {
  type AbsentAircraft,
  absentOf,
  approveLaunch,
  cutAtOfText,
  LAUNCH_FAILED_WHY,
  LAUNCH_TEXT,
  LAUNCHING_TEXT,
  lastReportLineOf,
  launchCapOf,
  launchFailsOf,
  launchReleaseWhyOf,
  launchViewOf,
  resumeLines,
  resumePlansOf,
  stuckHintOf,
  stuckLaunchOf,
} from "./dispatch-launch.ts";
import { followingOf } from "./following.ts";
import type { Session, Snapshot, Ticket, Workspace } from "./model.ts";
import { fold, formatFlightPlan, type Op, reservedOf, syncOps, waitingOf } from "./proposals.ts";

// LAUNCH on approve와 RESUME 카드(ATC-129). 2026-09-29: 백그라운드 TEAM_G(2b7110c1)는 마지막 턴 04:34:21Z 뒤 60분 쉬어
// 05:34:30Z에 daemon이 거뒀다("bg retire 2b7110c1: settled, idle 60m"). 그 뒤 FLEET에 absent로 남아 DISPATCH 후보에서 빠졌다.
const at = (hms: string) => Date.parse(`2026-09-29T${hms}Z`);
const iso = (hms: string) => new Date(at(hms)).toISOString();
const ATCC = "/home/c10/projects/atc";
const WT = `${ATCC}/.claude/worktrees`;

const session = (id: string, name: string, status: Session["status"] = "idle", origin: Session["origin"] = "background"): Session => ({
  id, agent: "claude", name, status, pid: 1, cwd: ATCC, startedAt: iso("00:00:00"), lastActiveAt: iso("05:00:00"), repo: ATCC, workspacePath: ATCC, origin,
});
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: iso("00:00:00"),
  project: null, labels: [], createdAt: iso("00:00:00"), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], ...over,
});
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    at: iso("06:00:00"), linear: { enabled: true, error: null, fetchedAt: iso("06:00:00") }, github: { enabled: true, error: null, fetchedAt: iso("06:00:00") }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [], workspaces: [], tickets: [ticket("ATC-200")], columns: [], claims: [], handoffs: [], alerts: [], clearances: [],
    airports: [{ id: "r", code: "ATCC", name: "atc", repo: ATCC }], ...over,
  };
}
const cfg = { ...DEFAULT_DISPATCH_CONFIG, candidateTeams: ["ATC"] };
const fleet: FleetFile = { ...DEFAULT_FLEET, aircraft: { TEAM_G: { base: "ATCC" }, TEAM_H: { base: "ATCC" } } };
const absentG = (over: Partial<AbsentAircraft> = {}): AbsentAircraft => ({ registration: "TEAM_G", launchedAt: iso("03:03:23"), jobId: "2b7110c1", cut: null, ...over });
const brief = (ops: Op[]) => ops.map((o) => `${o.op}:${o.id}${"reason" in o && o.reason ? `:${o.reason}` : ""}`);

// ── 후보 ──

test("absentOf: atc가 띄운 적이 있고 등록부에 있는 AIRCRAFT만. 살아 있음·RESTARTING·등록부에 없음·RETIRED·LAUNCH 기록 없음(데스크톱)은 빠진다", () => {
  const launches = new Map([
    ["TEAM_G", { t: iso("03:03:23"), jobId: "2b7110c1", permissionMode: "auto" }],
    ["TEAM_I", { t: iso("02:32:11"), jobId: "a7bd6d77" }], // 지금 살아 있음
    ["TEAM_J", { t: iso("03:03:44"), jobId: "647369e3" }], // RESTARTING
    ["TEAM_K", { t: iso("03:14:32"), jobId: "0edf3386" }], // 등록부에 없음
    ["TEAM_Q", { t: iso("03:14:32") }], // RETIRED
  ]);
  const out = absentOf(launches, {
    liveRegs: new Set(["TEAM_I", "TEAM_A"]), // TEAM_A는 데스크톱(LAUNCH 기록 없음)
    restarting: new Set(["TEAM_J"]),
    registered: new Set(["TEAM_G", "TEAM_I", "TEAM_J", "TEAM_Q", "TEAM_A", "TEAM_B"]), // TEAM_B: 등록부에만, atc가 띄운 적 없음
    retired: new Set(["TEAM_Q"]),
  });
  assert.deepEqual(out, [{ registration: "TEAM_G", launchedAt: iso("03:03:23"), jobId: "2b7110c1", permissionMode: "auto", cut: null }]);
});

test("후보: 세션 없는 백그라운드 AIRCRAFT가 배정되고 카드는 launch. AOG·cut 뒤 reset 전은 빠진다", () => {
  const plan = planDispatch(snap({ absent: [absentG()] }), new Map(), cfg, at("06:00:00"), undefined, fleet);
  assert.deepEqual(plan.assign.map((a) => [a.flight, a.registration, a.launch]), [["ATC-200", "TEAM_G", true]]);
  const ac = plan.aircraft.find((a) => a.registration === "TEAM_G")!;
  assert.deepEqual([ac.available, ac.launch, ac.airport], [true, true, "ATCC"]);
  // AOG
  const aog = planDispatch(snap({ absent: [absentG()] }), new Map(), cfg, at("06:00:00"), undefined, { ...fleet, aircraft: { TEAM_G: { base: "ATCC", aog: { reason: "점검", at: iso("05:00:00") } } } });
  assert.deepEqual(aog.assign, []);
  // LIMIT: cut 뒤 reset 전
  const cut = { sessionId: "2b7110c1-x", cutAt: iso("04:30:00"), resetsAt: iso("07:40:00"), report: null };
  const held = planDispatch(snap({ absent: [absentG({ cut })] }), new Map(), cfg, at("06:00:00"), undefined, fleet);
  assert.deepEqual(held.assign, []);
  assert.equal(held.aircraft[0]!.reason, "HOLD · LIMIT (cut 04:30Z) until 07:40Z");
  // 데스크톱 AIRCRAFT는 absent 목록에 없으니(LAUNCH 기록 없음) 후보가 아니다
  assert.deepEqual(planDispatch(snap(), new Map(), cfg, at("06:00:00"), undefined, fleet).assign, []);
});

test("launch 카드: syncOps가 launch를 실어 만들고, 카드는 LAUNCH on approve", () => {
  const s = snap({ absent: [absentG()] });
  const plan = planDispatch(s, new Map(), cfg, at("06:00:00"), undefined, fleet);
  const ops = syncOps([], plan, s, cfg, at("06:00:00"), 0);
  assert.equal(ops.length, 1);
  const p = fold(ops)[0]!;
  assert.deepEqual([p.flight, p.aircraftName, p.registration, p.launch], ["ATC-200", "TEAM_G", "TEAM_G", true]);
  assert.deepEqual(launchViewOf([p], launchCapOf([], [p], 6)), { [p.id]: LAUNCH_TEXT });
});

// ── 상한 ──

test("상한: 살아 있는 백그라운드 세션 + 승인됐지만 아직 세션이 없는 launch 카드가 ATC_MAX_LAUNCHED에 닿으면 카드는 기다린다", () => {
  const create = (id: string, reg: string): Op => ({ op: "create", id, at: iso("06:00:00"), kind: "ASSIGN", flight: `ATC-${id.slice(2)}`, aircraft: `absent:${reg}`, aircraftName: reg, registration: reg, airport: "ATCC", score: 1, factors: [], launch: true });
  const ps = fold([create("D-0001", "TEAM_G"), { op: "approve", id: "D-0001", at: iso("06:01:00") }, create("D-0002", "TEAM_H")]);
  const sessions = [session("i", "TEAM_I"), session("t", "TOWER"), session("a", "TEAM_A", "idle", "desktop"), session("x", "TEAM_X", "dead")];
  const cap = launchCapOf(sessions, ps, 2);
  // TEAM_I(백그라운드) 1 + 승인된 D-0001 1. TOWER(관제)·데스크톱·죽은 세션은 세지 않는다
  assert.deepEqual(cap, { launched: 1, pending: 1, max: 2, full: true, holders: "AIRCRAFT 1 · 그 밖 0" });
  const view = launchViewOf(ps, cap);
  assert.equal(view["D-0001"], LAUNCH_TEXT);
  assert.match(view["D-0002"]!, /^LAUNCH 대기 — 백그라운드 1 \+ 승인된 LAUNCH 1 \/ 상한 2/);
  // D-0001의 세션이 뜨면 pending에서 빠진다(이제 launched로 센다)
  assert.deepEqual(launchCapOf([...sessions, session("g", "TEAM_G")], ps, 3), { launched: 2, pending: 0, max: 3, full: false, holders: "AIRCRAFT 2 · 그 밖 0" });
});

test("상한이 찼으면 승인도 LAUNCH도 하지 않는다", async () => {
  const log: string[] = [];
  const r = await approveLaunch("D-0002", {
    live: false,
    cap: { launched: 5, pending: 1, max: 6, full: true },
    approve: { op: "approve", id: "D-0002", at: iso("06:02:00") },
    append: (ops) => log.push(...ops.map((o) => o.op)),
    launch: async () => (log.push("LAUNCH"), { ok: true, jobId: "abc123" }),
    now: () => iso("06:02:01"),
  });
  assert.equal(r.status, 409);
  assert.deepEqual(log, []);
});

// ── 승인 → LAUNCH → (새 세션) → 보내기 ──

const d0010 = (): Op[] => [
  { op: "create", id: "D-0010", at: iso("06:00:00"), kind: "ASSIGN", flight: "ATC-200", aircraft: "absent:TEAM_G", aircraftName: "TEAM_G", registration: "TEAM_G", airport: "ATCC", score: 3, factors: [], launch: true },
];

test("순서: 승인을 먼저 적고 띄운 뒤 LAUNCH 결과를 적는다. 새 세션이 뜨기 전에는 보내지 않고, 뜨면 보낸다", async () => {
  const log: Op[] = [...d0010()];
  const order: string[] = [];
  const r = await approveLaunch("D-0010", {
    live: false,
    cap: { launched: 1, pending: 0, max: 6, full: false },
    approve: { op: "approve", id: "D-0010", at: iso("06:02:00") },
    append: (ops) => (order.push(...ops.map((o) => o.op)), log.push(...ops)),
    launch: async () => (order.push("LAUNCH"), { ok: true, jobId: "b943177e" }),
    now: () => iso("06:02:05"),
  });
  assert.deepEqual(r, { ok: true, status: 200 });
  assert.deepEqual(order, ["approve", "LAUNCH", "launch"]);
  const p = fold(log)[0]!;
  assert.deepEqual([p.status, p.launched], ["approved", { at: iso("06:02:05"), ok: true, by: "SUPERVISOR", jobId: "b943177e" }]);
  // 세션이 아직 없음: 보내지 않는다(RESTARTING처럼 승인은 그대로)
  assert.equal(launchReleaseWhyOf(p, { sessions: [] }), `TEAM_G: ${LAUNCHING_TEXT} — 새 세션이 뜬 뒤에 보낸다(승인은 그대로다)`);
  // 새 세션(이름 TEAM_G)이 떴다: 보낸다
  assert.equal(launchReleaseWhyOf(p, { sessions: [session("new", "TEAM_G", "busy")] }), null);
  // launch 카드가 아니면 상관없다
  assert.equal(launchReleaseWhyOf({ ...p, launch: undefined }, { sessions: [] }), null);
});

test("이미 세션이 떠 있으면 띄우지 않고 승인만 한다", async () => {
  const order: string[] = [];
  const r = await approveLaunch("D-0010", {
    live: true,
    cap: { launched: 6, pending: 0, max: 6, full: true }, // 상한이 찼어도 띄울 것이 없으니 승인된다
    approve: { op: "approve", id: "D-0010", at: iso("06:02:00") },
    append: (ops) => order.push(...ops.map((o) => o.op)),
    launch: async () => (order.push("LAUNCH"), { ok: true }),
    now: () => iso("06:02:05"),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(order, ["approve"]);
});

test("LAUNCH 뒤 새 세션이 CREW BRIEFING으로 AIRBORNE이어도 유예 동안 닫지 않고, 카드에 LAUNCHING. 유예가 지나도 세션이 없으면 LAUNCH 실패로 닫는다", () => {
  const log: Op[] = [...d0010(), { op: "approve", id: "D-0010", at: iso("06:02:00") }, { op: "launch", id: "D-0010", at: iso("06:02:05"), ok: true, by: "SUPERVISOR", jobId: "b943177e" }];
  const existing = fold(log);
  // RESTARTING 유예를 꺼도(restartGraceMin 0) launch 카드는 launchCardTimeoutMin(기본 30분) 동안 기다린다(ATC-507)
  const opsAtWith = (c: typeof cfg, hms: string, sessions: Session[], absent: AbsentAircraft[]) => {
    const s = snap({ sessions, absent });
    const plan = planDispatch(s, new Map(), c, at(hms), reservedOf(existing, at(hms)), fleet);
    return { plan, ops: syncOps(existing, plan, s, c, at(hms), 10) };
  };
  const opsAt = (hms: string, sessions: Session[], absent: AbsentAircraft[]) => opsAtWith({ ...cfg, restartGraceMin: 0 }, hms, sessions, absent);
  // 아직 세션 없음(absent)
  const wait = opsAt("06:03:00", [], [absentG()]);
  assert.deepEqual(brief(wait.ops), []);
  assert.deepEqual(waitingOf(existing, wait.plan), { "D-0010": LAUNCHING_TEXT });
  // 새 세션이 CREW BRIEFING을 읽는 중(busy = AIRBORNE)
  assert.deepEqual(brief(opsAt("06:04:00", [session("new", "TEAM_G", "busy")], []).ops), []);
  // 30분(launchCardTimeoutMin)이 지나도 세션이 없다. restartGraceMin이 0이어도 같다
  assert.deepEqual(brief(opsAt("06:33:00", [], [absentG()]).ops), [`supersede:D-0010:${LAUNCH_FAILED_WHY} — LAUNCH 뒤 30분 동안 새 세션이 뜨지 않음`]);
  // restartGraceMin은 launch 카드의 시간을 옮기지 않는다: 45여도 30분, launchCardTimeoutMin이 옮긴다
  assert.deepEqual(brief(opsAtWith({ ...cfg, restartGraceMin: 45 }, "06:33:00", [], [absentG()]).ops), [`supersede:D-0010:${LAUNCH_FAILED_WHY} — LAUNCH 뒤 30분 동안 새 세션이 뜨지 않음`]);
  assert.deepEqual(brief(opsAtWith({ ...cfg, restartGraceMin: 0, launchCardTimeoutMin: 10 }, "06:13:00", [], [absentG()]).ops), [`supersede:D-0010:${LAUNCH_FAILED_WHY} — LAUNCH 뒤 10분 동안 새 세션이 뜨지 않음`]);
});

test("LAUNCH 실패: 카드는 사유와 함께 닫히고 보내지 않는다. FOLLOWING에 하루 뜨고, 짝 규칙은 시작하지 않아 다음 계획에 다시 나온다", async () => {
  const log: Op[] = [...d0010()];
  const r = await approveLaunch("D-0010", {
    live: false,
    cap: { launched: 1, pending: 0, max: 6, full: false },
    approve: { op: "approve", id: "D-0010", at: iso("06:02:00") },
    append: (ops) => log.push(...ops),
    launch: async () => ({ ok: false, error: "/home/c10/projects/atc를 신뢰하지 않음" }),
    now: () => iso("06:02:05"),
  });
  assert.equal(r.status, 502);
  assert.deepEqual(brief(log.slice(1)), ["approve:D-0010", "launch:D-0010", `supersede:D-0010:${LAUNCH_FAILED_WHY} — /home/c10/projects/atc를 신뢰하지 않음`]);
  const p = fold(log)[0]!;
  assert.equal(p.status, "superseded");
  assert.equal(p.launched?.ok, false);
  // 보낼 수 없다(superseded), 이유는 카드에 남는다
  assert.match(p.reason!, /^LAUNCH 실패/);
  // FOLLOWING
  const fails = launchFailsOf([p], at("06:10:00"));
  assert.equal(fails.length, 1);
  const items = followingOf({ proposals: [p], tickets: [ticket("ATC-200")], workspaces: [], pulls: [], logbook: [], departures: [], now: at("06:10:00"), launchFails: fails });
  assert.deepEqual(items.map((f) => [f.flight, f.issues.map((i) => i.code)]), [["ATC-200", ["launch"]]]);
  assert.equal(launchFailsOf([p], at("06:02:05") + 86_400_000).length, 0); // 하루 뒤 빠진다
  // 다음 계획: 같은 짝이 다시 제안된다(SUPERVISOR가 다시 승인할 수 있다 — 스스로 다시 띄우지는 않는다)
  const s = snap({ absent: [absentG()] });
  const plan = planDispatch(s, new Map(), cfg, at("06:10:00"), reservedOf([p], at("06:10:00")), fleet);
  assert.deepEqual(brief(syncOps([p], plan, s, cfg, at("06:10:00"), 10)), ["create:D-0011"]);
});

// ── LAUNCH 루프(ATC-213) ──
// 2026-09-30: 사람을 기다리다 idle로 끝난 TEAM_F(40bb5e74)가 pid 없는 blocked 줄로 남아, LAUNCH는 "이미 떠 있음"으로 거절하고
// 계획은 absent라 카드를 또 냈다(TEAM_F·TEAM_K 카드 11건). STALE 규칙(session-control.test.ts)이 근본 원인이고, 아래는 같은 일이 다른 이유로 되풀이될 때의 차단

const alreadyUp = (jobId: string) => `TEAM_F 세션이 이미 떠 있음(bg ${jobId})`;

test("stuckLaunchOf: 마지막 시도가 '이미 떠 있음'으로 거절됐고 그 job이 끝나지 않았을 때만", () => {
  const rec = { t: iso("10:06:24"), ok: false, error: alreadyUp("40bb5e74") };
  assert.deepEqual(stuckLaunchOf(rec, () => "blocked"), { jobId: "40bb5e74", at: iso("10:06:24"), state: "blocked" });
  assert.deepEqual(stuckLaunchOf(rec, () => "working"), { jobId: "40bb5e74", at: iso("10:06:24"), state: "working" });
  // job이 끝났거나(사람이 STOP했다) 파일을 못 읽으면 막힌 것이 아니다
  for (const st of ["stopped", "done", "failed"]) assert.equal(stuckLaunchOf(rec, () => st), null);
  assert.equal(stuckLaunchOf(rec, () => null), null);
  // 뒤에 성공했거나 다른 이유로 실패했거나 기록이 없다
  assert.equal(stuckLaunchOf({ ...rec, ok: true }, () => "blocked"), null);
  assert.equal(stuckLaunchOf({ t: rec.t, ok: false, error: "상한 6(ATC_MAX_LAUNCHED)" }, () => "blocked"), null);
  assert.equal(stuckLaunchOf(undefined, () => "blocked"), null);
});

test("absentOf: 막힌 LAUNCH가 있으면 stuck을 싣는다", () => {
  const launches = new Map([["TEAM_F", { t: iso("05:40:00"), jobId: "40bb5e74" }]]);
  const input = { liveRegs: new Set<string>(), restarting: new Set<string>(), registered: new Set(["TEAM_F"]), retired: new Set<string>() };
  const stuck = { jobId: "40bb5e74", at: iso("10:06:24"), state: "blocked" };
  assert.deepEqual(absentOf(launches, input, () => null, () => stuck)[0]!.stuck, stuck);
  assert.equal("stuck" in absentOf(launches, input)[0]!, false);
});

test("막힌 AIRCRAFT는 카드를 다시 내지 않는다. 사람이 그 job을 STOP하면 풀려 다시 나온다", () => {
  const fleetF: FleetFile = { ...DEFAULT_FLEET, aircraft: { TEAM_F: { base: "ATCC" } } };
  const absentF = (over: Partial<AbsentAircraft> = {}): AbsentAircraft => ({ registration: "TEAM_F", launchedAt: iso("05:40:00"), jobId: "40bb5e74", cut: null, ...over });
  const stuck = { jobId: "40bb5e74", at: iso("10:06:24"), state: "blocked" };
  const blocked = planDispatch(snap({ absent: [absentF({ stuck })] }), new Map(), cfg, at("10:10:00"), undefined, fleetF);
  assert.deepEqual(blocked.assign, []);
  const ac = blocked.aircraft.find((a) => a.registration === "TEAM_F")!;
  assert.equal(ac.available, false);
  assert.match(ac.reason!, /^LAUNCH 막힘 — bg 40bb5e74가 아직 목록에 남아 있음/);
  assert.ok(ac.reason!.includes(stuckHintOf("40bb5e74")));
  // 풀린 뒤(stuck 없음)에는 카드가 다시 나온다
  const freed = planDispatch(snap({ absent: [absentF()] }), new Map(), cfg, at("10:10:00"), undefined, fleetF);
  assert.deepEqual(freed.assign.map((a) => [a.flight, a.registration, a.launch]), [["ATC-200", "TEAM_F", true]]);
});

test("FOLLOWING: '이미 떠 있음'으로 실패한 카드는 남은 job을 정리하라고 말한다. 다른 실패는 그대로", () => {
  const mk = (error: string) => {
    const log = [...d0010()];
    log.push({ op: "approve", id: "D-0010", at: iso("06:02:00") }, { op: "launch", id: "D-0010", at: iso("06:02:05"), ok: false, by: "SUPERVISOR", error }, { op: "supersede", id: "D-0010", at: iso("06:02:05"), reason: `${LAUNCH_FAILED_WHY} — ${error}` });
    const p = fold(log)[0]!;
    return followingOf({ proposals: [p], tickets: [ticket("ATC-200")], workspaces: [], pulls: [], logbook: [], departures: [], now: at("06:10:00"), launchFails: launchFailsOf([p], at("06:10:00")) })[0]!.issues.find((i) => i.code === "launch")!.text;
  };
  assert.match(mk(alreadyUp("40bb5e74")), /FLEET에서 그 세션을 STOP하거나 그 안에서 답한다/);
  assert.doesNotMatch(mk("/home/c10/projects/atc를 신뢰하지 않음"), /STOP/);
});

// ── RESUME ──

const wrap = (hms: string) => JSON.stringify({ type: "user", isMeta: true, usageLimitNote: "wrap_up", timestamp: iso(hms), message: { role: "user", content: "[limit]" } });
const say = (hms: string, text: string, tool = false) =>
  JSON.stringify({ type: "assistant", timestamp: iso(hms), message: { role: "assistant", content: [{ type: "text", text }, ...(tool ? [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] : [])] } });
const ask = (hms: string, text: string) => JSON.stringify({ type: "user", timestamp: iso(hms), turnOrigin: "human", message: { role: "user", content: text } });

test("cut: 마지막 지시 뒤 wrap_up이 있고 그 뒤 새 지시가 없으면 cut 시각. 마지막 보고 줄도 읽는다", () => {
  const cut = [ask("03:05:00", "ATC-200 진행"), say("04:30:00", "작업 중", true), wrap("04:30:10"), say("04:34:21", "테스트 8개 중 6개 통과.\nWIP 커밋 abc1234 — 남은 것: docs")].join("\n");
  assert.equal(cutAtOfText(cut), at("04:30:10"));
  assert.equal(lastReportLineOf(cut), "WIP 커밋 abc1234 — 남은 것: docs");
  // 한도가 풀린 뒤 새 지시가 왔으면(새 턴) cut이 아니다
  assert.equal(cutAtOfText(`${cut}\n${ask("07:45:00", "계속")}`), null);
  assert.equal(cutAtOfText([ask("03:05:00", "x"), say("04:30:00", "끝")].join("\n")), null);
});

const departures: Departure[] = [
  { t: iso("03:10:00"), flight: "ATC-200", aircraft: null, stand: `${WT}/atc-200-x`, branch: "worktree-atc-200-x", repo: ATCC, via: "stand" },
  { t: iso("03:10:30"), flight: "ATC-200", aircraft: "TEAM_G", stand: `${WT}/atc-200-x`, branch: "worktree-atc-200-x", repo: ATCC, via: "claim" },
];
const stand: Workspace = { path: `${WT}/atc-200-x`, name: "atc-200-x", repo: ATCC, isMain: false, branch: "worktree-atc-200-x", head: "abc1234def", dirty: 2, lastCommitAt: iso("04:20:00"), ticketKey: "ATC-200", pushed: false };
const inProgress = ticket("ATC-200", { state: "In Progress", stateType: "started", startedAt: iso("03:05:00") });
const cutG = { sessionId: "2b7110c1-a44b", cutAt: iso("04:30:10"), resetsAt: iso("07:40:00"), report: "WIP 커밋 abc1234 — 남은 것: docs" };

test("RESUME: cut, reset 지남, 새 턴 없음 → 같은 FLIGHT·REGISTRATION의 RESUME 카드(launch). STAND·브랜치·마지막 커밋·마지막 보고 줄을 싣는다", () => {
  const s = snap({ tickets: [inProgress], workspaces: [stand], absent: [absentG({ cut: cutG })] });
  // reset 전: 없다
  assert.deepEqual(resumePlansOf(s, departures, new Map(), at("07:00:00")), []);
  // reset 뒤
  const [r] = resumePlansOf(s, departures, new Map(), at("07:41:00"));
  assert.deepEqual([r!.flight, r!.registration, r!.launch, r!.airport], ["ATC-200", "TEAM_G", true, "ATCC"]);
  assert.deepEqual(r!.resume, {
    cutAt: iso("04:30:10"), resetsAt: iso("07:40:00"), stand: `${WT}/atc-200-x`, branch: "worktree-atc-200-x",
    commit: { sha: "abc1234", at: iso("04:20:00"), pushed: false }, report: "WIP 커밋 abc1234 — 남은 것: docs",
  });
  // cut이 없으면(새 턴이 왔음) 없다. FLIGHT가 끝났거나 LOGBOOK에 있으면 없다
  assert.deepEqual(resumePlansOf(snap({ tickets: [inProgress], absent: [absentG()] }), departures, new Map(), at("07:41:00")), []);
  assert.deepEqual(resumePlansOf(snap({ tickets: [{ ...inProgress, stateType: "completed", state: "Done" }], absent: [absentG({ cut: cutG })] }), departures, new Map(), at("07:41:00")), []);
  assert.deepEqual(resumePlansOf(s, departures, new Map([["ATC-200", "atc#300"]]), at("07:41:00")), []);
  // reset을 모르면 없다(LIMIT이 풀릴 때까지 HOLD)
  assert.deepEqual(resumePlansOf(snap({ tickets: [inProgress], absent: [absentG({ cut: { ...cutG, resetsAt: null } })] }), departures, new Map(), at("09:00:00")), []);
});

test("RESUME: 한 FLIGHT(cut)에 한 번. 거절해도 다시 만들지 않고, 그 AIRCRAFT는 새 FLIGHT를 받지 않는다", () => {
  const s = snap({ tickets: [inProgress, ticket("ATC-201")], workspaces: [stand], absent: [absentG({ cut: cutG })] });
  const now = at("07:41:00");
  const resumes = resumePlansOf(s, departures, new Map(), now);
  const plan = planDispatch(s, new Map(), cfg, now, undefined, fleet, new Map(), [], new Map(), undefined, resumes);
  assert.deepEqual(plan.assign, []); // ATC-201은 TEAM_G에 가지 않는다
  assert.match(plan.aircraft.find((a) => a.registration === "TEAM_G")!.reason, /^RESUME — ATC-200/);
  const first = syncOps([], plan, s, cfg, now, 20);
  assert.deepEqual(brief(first), ["create:D-0021"]);
  const p = fold(first)[0]!;
  assert.deepEqual([p.flight, p.registration, p.launch, p.resume?.cutAt], ["ATC-200", "TEAM_G", true, iso("04:30:10")]);
  // 다음 계획: 그대로 열려 있고 또 만들지 않는다
  assert.deepEqual(brief(syncOps([p], plan, s, cfg, now + 300_000, 21)), []);
  // SUPERVISOR가 거절해도 같은 cut으로는 다시 만들지 않는다
  const rejected = fold([...first, { op: "reject", id: "D-0021", at: iso("07:50:00"), reason: "직접 처리" }]);
  assert.deepEqual(brief(syncOps(rejected, plan, s, cfg, now + 600_000, 21)), []);
  // FLIGHT PLAN: 이어서, 처음부터 다시 하지 않는다
  const text = formatFlightPlan(p, inProgress, "TEAM_G", null, now);
  assert.match(text, /^\[DISPATCH D-0021\] FLIGHT PLAN · /);
  assert.match(text, /RESUME — This FLIGHT was cut by a usage LIMIT at 04:30Z\. Resume, don't restart — continue from the remaining work\./);
  assert.match(text, /STAND .*atc-200-x · branch worktree-atc-200-x · last commit abc1234 \(04:20Z\) — not on origin yet/);
  assert.match(text, /CAPTAIN's last report: WIP 커밋 abc1234 — 남은 것: docs/);
  // 세션에 보내는 글은 영어(ATC-126): RESUME 줄에 한국어가 없다(CAPTAIN 보고 줄은 쓴 그대로)
  const resumePart = text.split("\n").filter((l) => /^(RESUME|STAND) /.test(l)).join("\n");
  assert.doesNotMatch(resumePart, /[가-힣]/);
  assert.match(resumeLines({ ...p.resume!, commit: null, stand: null, branch: null, report: null }, now).join("\n"), /STAND unknown · branch unknown · no last commit \(worktree not found\)/);
});

test("RESUME 카드: 세션이 다시 떴으면(사람이 열었음) 닫고 ATC-86대로. 승인된 카드는 FLIGHT가 In Progress인 동안 AIRCRAFT 사정으로 닫지 않는다", () => {
  const s = snap({ tickets: [inProgress], workspaces: [stand], absent: [absentG({ cut: cutG })] });
  const now = at("07:41:00");
  const created = syncOps([], planDispatch(s, new Map(), cfg, now, undefined, fleet, new Map(), [], new Map(), undefined, resumePlansOf(s, departures, new Map(), now)), s, cfg, now, 20);
  // 사람이 TEAM_G 세션을 다시 열었다(absent가 아님)
  const live = snap({ tickets: [inProgress], workspaces: [stand], sessions: [session("g2", "TEAM_G", "idle", "desktop")] });
  const livePlan = planDispatch(live, new Map(), cfg, now + 60_000, undefined, fleet, new Map(), [], new Map(), undefined, resumePlansOf(live, departures, new Map(), now + 60_000));
  assert.match(brief(syncOps(fold(created), livePlan, live, cfg, now + 60_000, 21))[0]!, /^supersede:D-0021:AIRCRAFT 불가: 세션이 다시 떴음/);
  // 승인되고 LAUNCH됨 → 새 세션이 떴다(RESUME은 이제 계획에 없다). FLIGHT가 In Progress인 동안 그대로
  const approved = fold([...created, { op: "approve", id: "D-0021", at: iso("07:42:00") }, { op: "launch", id: "D-0021", at: iso("07:42:05"), ok: true, by: "SUPERVISOR" }]);
  const busy = snap({ tickets: [inProgress], workspaces: [stand], sessions: [session("g3", "TEAM_G", "busy")] });
  const busyPlan = planDispatch(busy, new Map(), cfg, now + 120_000, reservedOf(approved, now + 120_000), fleet);
  assert.deepEqual(brief(syncOps(approved, busyPlan, busy, cfg, now + 120_000, 21)), []);
  assert.equal(launchReleaseWhyOf(approved[0]!, busy), null); // 보낼 수 있다
});

test("승인은 적혔는데 LAUNCH 기록이 없다(승인과 LAUNCH 사이에 서버가 멈춤): 유예 동안은 두고, 지나면 LAUNCH 실패로 닫는다. 다시 띄우지 않는다", () => {
  const log: Op[] = [...d0010(), { op: "approve", id: "D-0010", at: iso("06:02:00") }];
  const existing = fold(log);
  const opsAt = (hms: string, s: Snapshot) => {
    const plan = planDispatch(s, new Map(), cfg, at(hms), reservedOf(existing, at(hms)), fleet);
    return syncOps(existing, plan, s, cfg, at(hms), 10);
  };
  assert.deepEqual(brief(opsAt("06:20:00", snap({ absent: [absentG()] }))), []);
  const ops = opsAt("06:32:00", snap({ absent: [absentG()] }));
  assert.equal(ops.length, 1); // supersede 하나뿐 — 새로 띄우는 일은 없다
  assert.match(brief(ops)[0]!, /^supersede:D-0010:LAUNCH 실패 — 승인 뒤 30분 동안 LAUNCH 기록이 없음/);
  assert.equal(launchFailsOf(fold([...log, ...ops]), at("06:40:00")).length, 1); // FOLLOWING
  // 세션이 이미 떠 있어 LAUNCH 없이 승인만 한 카드는 닫지 않는다
  assert.deepEqual(brief(opsAt("06:32:00", snap({ sessions: [session("g", "TEAM_G")] }))), []);
});

test("RESUME: DEPARTURE LOG의 저장소가 어느 AIRPORT도 아니면 카드를 만들지 않는다. 착수 기록 없는 tail: FLIGHT는 등록부 base AIRPORT로", () => {
  const elsewhere = departures.map((d) => ({ ...d, repo: "/home/c10/projects/unknown" }));
  const s = snap({ tickets: [inProgress], workspaces: [stand], absent: [absentG({ cut: cutG })] });
  assert.deepEqual(resumePlansOf(s, elsewhere, new Map(), at("07:41:00")), []);
  const tailed = snap({ tickets: [{ ...inProgress, labels: ["tail:TEAM_G"] }], absent: [absentG({ cut: cutG })] });
  assert.deepEqual(resumePlansOf(tailed, [], new Map(), at("07:41:00")), []); // base를 모름
  assert.deepEqual(resumePlansOf(tailed, [], new Map(), at("07:41:00"), () => "ATCC").map((r) => [r.flight, r.airport]), [["ATC-200", "ATCC"]]);
});
