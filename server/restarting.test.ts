import "./test-hermetic.ts"; // 진짜 HOME·상태 폴더를 읽지 않게(ATC-190). 첫 import여야 한다
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, planDispatch, loadDispatchConfig } from "./dispatch.ts";
import { DEFAULT_FLEET } from "./crew.ts";
import { fleetView } from "./fleet.ts";
import { fleetRows, fleetStatusOf } from "./fleet-status.ts";
import type { Session, Snapshot, Ticket } from "./model.ts";
import { fold, type Op, recentPairsOf, regOfProposal, reservedOf, restartingWhyOf, syncOps, waitingOf } from "./proposals.ts";
import { DEFAULT_RESTART_GRACE_MIN, type EndedSession, normalEndOf, RESTARTING_TEXT, restartingOf } from "./restarting.ts";
import { readEndedSessions } from "./sources/claude.ts";

// AIRCRAFT identity survives /clear(ATC-91). TEAM_I, 2026-09-29: D-0068을 01:40:31Z에 만들었고(세션 04a9a868…), SUPERVISOR가 TEAM_I에서 /clear를 했다
// (대화 기록의 마지막 쓰기 01:41:20Z). 01:41:23Z에 승인했는데 01:45:33Z에 "AIRCRAFT 불가: 세션 없음"으로 SUPERSEDED됐다. 새 세션(085b1336…)은 01:49:24Z 첫 지시와 함께 떴다.
const at = (hms: string) => Date.parse(`2026-09-29T${hms}Z`);
const iso = (hms: string) => `2026-09-29T${hms}.000Z`.replace(/\.000Z\.000Z/, ".000Z");
const OLD = "04a9a868-0161-413c-a2e8-4557b4c501b1";
const NEW = "085b1336-c08f-43cf-b974-cb76e839692c";
const ATCC = "/home/c10/projects/atc";

const session = (id: string, name: string, status: Session["status"] = "idle"): Session => ({ id, agent: "claude", name, status, pid: 1, cwd: ATCC, startedAt: iso("00:00:00"), lastActiveAt: iso("01:00:00"), repo: ATCC, workspacePath: ATCC });
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: iso("00:00:00"), project: "Beta Readiness", labels: [], createdAt: iso("00:00:00"), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], ...over }) as Ticket;
function snap(now: string, over: Partial<Snapshot> = {}): Snapshot {
  return {
    at: iso(now), linear: { enabled: true, error: null, fetchedAt: iso(now) }, github: { enabled: true, error: null, fetchedAt: iso(now) }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [], workspaces: [], tickets: [ticket("VOC-82")], columns: [], claims: [], handoffs: [], alerts: [], clearances: [], airports: [{ id: "r", code: "ATCC", name: "atc", repo: ATCC }], ...over,
  };
}
const cfg = { ...DEFAULT_DISPATCH_CONFIG, teamAirports: { ...DEFAULT_DISPATCH_CONFIG.teamAirports, VOC: "ATCC" }, candidateTeams: ["VOC"], projectAirports: { "Beta Readiness": "ATCC" } };
const restartingTeamI = { registration: "TEAM_I", name: "TEAM_I", sessionId: OLD, since: iso("01:41:20"), until: iso("02:11:20") };

// D-0068: 세션 id로 만들었고(예전 기록: registration 없음), 01:41:23Z에 승인
const d0068 = (over: Record<string, unknown> = {}): Op[] => [
  { op: "create", id: "D-0068", at: iso("01:40:31"), kind: "ASSIGN", flight: "VOC-82", aircraft: OLD, aircraftName: "TEAM_I", airport: "ATCC", score: 9, factors: [], ...over } as Op,
  { op: "approve", id: "D-0068", at: iso("01:41:23") },
];
const opsAt = (now: string, sessions: Session[], restarting: typeof restartingTeamI[] = [], existing = fold(d0068())) => {
  const s = snap(now, { sessions, restarting });
  const plan = planDispatch(s, new Map(), cfg, at(now), reservedOf(existing, at(now)), DEFAULT_FLEET);
  return { plan, ops: syncOps(existing, plan, s, cfg, at(now), 68) };
};
const brief = (ops: Op[]) => ops.map((o) => `${o.op}:${o.id}${"reason" in o ? `:${o.reason}` : ""}`);

test("TEAM_I 재생: /clear 사이(세션 없음)에는 승인된 제안이 닫히지 않는다 — 전에는 01:45:33Z에 '세션 없음'으로 SUPERSEDED", () => {
  // 예전: RESTARTING을 모르니 AIRCRAFT가 계획에 없어 곧바로 닫혔다
  const before = opsAt("01:45:33", []);
  assert.deepEqual(brief(before.ops), ["supersede:D-0068:AIRCRAFT 불가: 세션 없음"]);
  // 지금: 세션이 끝난 직후(정상 종료)면 RESTARTING이라 기다린다
  const wait = opsAt("01:45:33", [], [restartingTeamI]);
  assert.deepEqual(brief(wait.ops), []);
  const ac = wait.plan.aircraft.find((a) => a.registration === "TEAM_I")!;
  assert.deepEqual([ac.available, ac.restarting, ac.reason], [false, true, `RESTARTING — ${RESTARTING_TEXT} (02:11Z까지)`]);
  // 기다리는 동안 이 AIRCRAFT에는 새 FLIGHT를 주지 않는다
  assert.deepEqual(wait.plan.assign, []);
  // 카드에는 기다린다고 적는다
  assert.deepEqual(waitingOf(fold(d0068()), wait.plan), { "D-0068": RESTARTING_TEXT });
});

test("TEAM_I 재생: 새 세션(다른 id)이 같은 이름으로 뜨면 같은 제안이 그대로 유효하다. 유예가 지나도록 안 뜨면 예전처럼 닫힌다", () => {
  // 01:49:24Z 새 세션 085b1336, 이름 TEAM_I
  const live = opsAt("01:50:00", [session(NEW, "TEAM_I")]);
  assert.deepEqual(brief(live.ops), []); // 세션 id가 바뀌었어도 REGISTRATION으로 같은 AIRCRAFT
  assert.equal(live.plan.aircraft[0]!.registration, "TEAM_I");
  assert.equal(live.plan.aircraft[0]!.restarting, undefined);
  assert.deepEqual(waitingOf(fold(d0068()), live.plan), {});
  // 유예(restartGraceMin) 안에 새 세션이 없으면 RESTARTING이 사라지고 사유와 함께 닫힌다
  const gone = opsAt("02:12:00", []);
  assert.deepEqual(brief(gone.ops), ["supersede:D-0068:AIRCRAFT 불가: 세션 없음"]);
});

test("판정 대기(proposed) 제안도 RESTARTING 동안은 닫지 않고 열린 채 센다", () => {
  const existing = fold([d0068()[0]!]); // 아직 판정 전
  const wait = opsAt("01:45:33", [], [restartingTeamI], existing);
  assert.deepEqual(brief(wait.ops), []);
  assert.equal(fold([d0068()[0]!])[0]!.status, "proposed");
  // 세션 없이 유예가 지나면 예전처럼
  assert.deepEqual(brief(opsAt("02:12:00", [], [], existing).ops), ["supersede:D-0068:AIRCRAFT 불가: 세션 없음"]);
});

test("새 제안은 registration을 담는다. 옛 줄(registration 없음)은 그때의 세션 이름으로 읽는다", () => {
  const s = snap("01:00:00", { sessions: [session("a1", "Team B")] }); // 이름 표기가 `Team B`여도 TEAM_B
  const plan = planDispatch(s, new Map(), cfg, at("01:00:00"), undefined, DEFAULT_FLEET);
  const create = syncOps([], plan, s, cfg, at("01:00:00"), 0).find((o) => o.op === "create")!;
  assert.equal(create.op === "create" && create.registration, "TEAM_B");
  assert.equal(create.op === "create" && create.aircraftName, "Team B"); // send-guard가 비교하는 이름은 그대로
  const [old] = fold(d0068());
  assert.equal(old!.registration, undefined);
  assert.equal(regOfProposal(old!), "TEAM_I");
  assert.equal(regOfProposal({ registration: "TEAM_X", aircraftName: "Team Y" }), "TEAM_X");
  assert.equal(regOfProposal({ registration: undefined, aircraftName: null, aircraft: "s9" }), "s9"); // 이름도 없는 아주 옛 줄은 세션 id 그대로
  // 옛 줄의 registration 없는 필드를 그대로 두고 새 필드만 더한 줄도 fold가 읽는다(옛 리더는 모르는 필드를 무시한다)
  assert.equal(fold(d0068({ registration: "TEAM_I" }))[0]!.registration, "TEAM_I");
});

test("wrong-aircraft 짝이 /clear를 넘어 남는다: 세션 id가 바뀌어도 24시간 안에는 같은 짝을 다시 제안하지 않는다", () => {
  const rejected = fold([...d0068().slice(0, 1), { op: "reject", id: "D-0068", at: iso("01:41:00"), reason: "wrong-aircraft", reasonCodes: ["wrong-aircraft"] }]);
  const pairs = recentPairsOf(rejected, at("01:50:00"));
  assert.deepEqual([...pairs.keys()], ["VOC-82|TEAM_I"]); // 세션 id(04a9a868…)가 아니라 REGISTRATION
  // /clear 뒤 새 세션(다른 id)이 같은 이름으로 떴다: planner는 그 짝을 뺀다
  const s = snap("01:50:00", { sessions: [session(NEW, "TEAM_I")] });
  const plan = planDispatch(s, new Map(), cfg, at("01:50:00"), reservedOf(rejected, at("01:50:00")), DEFAULT_FLEET);
  assert.deepEqual(plan.assign, []);
  assert.deepEqual(plan.blockedPairs?.map((b) => [b.flight, b.aircraft, b.aircraftName]), [["VOC-82", "TEAM_I", "TEAM_I"]]);
  // syncOps도 같은 기준이라 새로 만들지 않는다
  assert.deepEqual(syncOps(rejected, plan, s, cfg, at("01:50:00"), 68), []);
  // 다른 AIRCRAFT에는 갈 수 있다
  const other = snap("01:50:00", { sessions: [session(NEW, "TEAM_I"), session("z", "TEAM_K")] });
  assert.deepEqual(planDispatch(other, new Map(), cfg, at("01:50:00"), reservedOf(rejected, at("01:50:00")), DEFAULT_FLEET).assign.map((a) => a.aircraftName), ["TEAM_K"]);
});

test("/clear 뒤 READBACK: 보낸 제안을 새 세션이 READBACK해도 AIRCRAFT는 예약된 채, 같은 FLIGHT를 다른 짝으로 다시 내지 않는다", () => {
  const sent = fold([...d0068(), { op: "send", id: "D-0068", at: iso("01:42:00"), message: "m" }]);
  // 보낸 뒤 /clear: 예전에는 옛 세션 id가 사라져 AIRCRAFT가 비어 보였다
  const before = reservedOf(sent, at("01:50:00"));
  assert.equal(before.aircraft.get("TEAM_I"), "D-0068");
  const s = snap("01:50:00", { sessions: [session(NEW, "TEAM_I")], tickets: [ticket("VOC-82"), ticket("VOC-83", { priority: 1 })] });
  const plan = planDispatch(s, new Map(), cfg, at("01:50:00"), before, DEFAULT_FLEET);
  assert.equal(plan.aircraft[0]!.reserved, "D-0068"); // 새 세션이 이미 그 제안의 AIRCRAFT로 잡혀 있다
  assert.deepEqual(plan.assign, []); // 새 FLIGHT를 주지 않는다
  // READBACK(accept)은 제안 id로 오므로 세션 id가 바뀌어도 그대로 받는다
  const accepted = fold([...d0068(), { op: "send", id: "D-0068", at: iso("01:42:00"), message: "m" }, { op: "accept", id: "D-0068", at: iso("01:52:00") }]);
  assert.equal(accepted[0]!.status, "accepted");
  assert.equal(reservedOf(accepted, at("01:55:00")).aircraft.get("TEAM_I"), "D-0068");
  // 보낸 제안은 RESTARTING과 상관없이 자동으로 닫히지 않는다(READBACK 24시간 기다림)
  assert.deepEqual(brief(syncOps(sent, planDispatch(snap("01:50:00", { restarting: [restartingTeamI] }), new Map(), cfg, at("01:50:00"), reservedOf(sent, at("01:50:00")), DEFAULT_FLEET), snap("01:50:00"), cfg, at("01:50:00"), 68)), []);
});

test("restartingOf: 정상으로 끝난 세션이 restartGraceMin 안이고 같은 REGISTRATION의 살아 있는 세션이 없을 때만", () => {
  const ended = (over: Partial<EndedSession> = {}): EndedSession => ({ sessionId: OLD, name: "TEAM_I", endedAt: at("01:41:20"), normalEnd: true, ...over });
  const now = at("01:45:00");
  const run = (e: EndedSession[], live: { name: string; status: "busy" | "idle" | "dead" }[] = [], t = now) => restartingOf(e, live, t, DEFAULT_RESTART_GRACE_MIN);
  assert.deepEqual(run([ended()]), [{ registration: "TEAM_I", name: "TEAM_I", sessionId: OLD, since: iso("01:41:20"), until: iso("02:11:20") }]);
  assert.deepEqual(run([ended()], [], at("02:11:19")).length, 1);
  assert.deepEqual(run([ended()], [], at("02:11:20")), []); // 유예 끝
  assert.deepEqual(run([ended({ normalEnd: false })]), []); // 오류·승인 대기·응답 도중에 끝난 것은 health가 다룬다
  assert.deepEqual(run([ended({ name: "President" })]), []); // TEAM이 아닌 세션
  assert.deepEqual(run([ended()], [{ name: "Team I", status: "idle" }]), []); // 같은 REGISTRATION의 세션이 이미 떴다(`Team I`도)
  assert.equal(run([ended()], [{ name: "TEAM_I", status: "dead" }]).length, 1); // 죽은 세션 파일은 살아 있는 것이 아니다
  assert.equal(run([ended()], [{ name: "TEAM_J", status: "idle" }]).length, 1);
  // 같은 REGISTRATION의 끝난 세션이 여럿이면 가장 늦게 끝난 것
  const latest = run([ended({ sessionId: "old-1", endedAt: at("01:20:00") }), ended({ sessionId: "old-2", endedAt: at("01:41:20") })]);
  assert.deepEqual(latest.map((r) => r.sessionId), ["old-2"]);
  // restartGraceMin은 설정으로
  assert.deepEqual(restartingOf([ended()], [], at("01:50:00"), 5), []);
});

test("normalEndOf: 도구 호출 없는 답으로 끝난 대화 기록만. 승인 대기·오류·지시 뒤 무응답은 아니다", () => {
  const line = (o: object) => JSON.stringify({ timestamp: iso("01:41:00"), sessionId: OLD, ...o });
  const reply = (tools: string[] = []) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "x" }, ...tools.map((id) => ({ type: "tool_use", id, name: "Bash", input: {} }))] } });
  const prompt = line({ type: "user", turnOrigin: "human", message: { role: "user", content: "다음" } });
  const noise = [JSON.stringify({ type: "last-prompt" }), JSON.stringify({ type: "custom-title", customTitle: "TEAM_I" })];
  assert.equal(normalEndOf([prompt, reply(), ...noise].join("\n")), true);
  assert.equal(normalEndOf([prompt, reply(["t1"])].join("\n")), false); // 도구 호출이 결과 없이 멈춤
  assert.equal(normalEndOf([reply(), prompt].join("\n")), false); // 지시에 대답하지 않고 끝남
  assert.equal(normalEndOf(""), false);
});

test("FLEET: 세션은 없지만 RESTARTING인 AIRCRAFT는 status absent로 FLEET PLAN에 그대로 두고, 목록에는 RESTARTING과 대기 글이 보인다", () => {
  const s = snap("01:45:33", { sessions: [], restarting: [restartingTeamI] });
  const views = fleetView(s, { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_I: {} } }, undefined, [], at("01:45:33"));
  const v = views.find((x) => x.registration === "TEAM_I")!;
  assert.equal(v.status, "absent"); // FLEET PLAN의 판단은 그대로(다만 LAUNCH 후보에서는 뺀다)
  assert.equal(v.restarting?.registration, "TEAM_I");
  assert.equal(fleetStatusOf(v), "RESTARTING");
  const [row] = fleetRows([v], at("01:45:33"));
  assert.deepEqual([row!.status, row!.restarting?.label, row!.restarting?.until], ["RESTARTING", "세션 없음 — /clear 뒤 첫 메시지 대기", iso("02:11:20")]);
  // 세션이 뜨면 restarting은 없다
  const live = fleetView(snap("01:50:00", { sessions: [session(NEW, "TEAM_I")], restarting: [restartingTeamI] }), { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_I: {} } }, undefined, [], at("01:50:00"));
  assert.equal(live.find((x) => x.registration === "TEAM_I")!.restarting, null);
  // 유예가 지나 restarting이 없으면 예전처럼 NOT IN SERVICE
  const gone = fleetView(snap("02:12:00"), { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_I: {} } }, undefined, [], at("02:12:00")).find((x) => x.registration === "TEAM_I")!;
  assert.equal(fleetStatusOf(gone), "NOT IN SERVICE");
});

// ── 대화 기록 폴더에서 끝난 세션 읽기 ──
const root = mkdtempSync(join(tmpdir(), "atc-restarting-"));
after(() => rmSync(root, { recursive: true, force: true }));

test("readEndedSessions: 세션 파일이 없고 최근에 쓴 대화 기록만, 마지막 custom-title을 이름으로, 끝의 사실로 정상 종료를 본다", () => {
  const proj = join(root, "projects", "-home-c10-projects-atc");
  mkdirSync(proj, { recursive: true });
  const write = (id: string, lines: object[], ageMin: number) => {
    const p = join(proj, `${id}.jsonl`);
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const t = new Date(Date.now() - ageMin * 60_000);
    utimesSync(p, t, t);
  };
  const reply = (tools = false) => ({ type: "assistant", timestamp: iso("01:41:00"), message: { role: "assistant", content: [{ type: "text", text: "x" }, ...(tools ? [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] : [])] } });
  write("ended-i", [{ type: "custom-title", customTitle: "TEAM_H", sessionId: "ended-i" }, reply(), { type: "custom-title", customTitle: "TEAM_I", sessionId: "ended-i" }, { type: "last-prompt" }], 5);
  write("live-j", [{ type: "custom-title", customTitle: "TEAM_J" }, reply()], 5); // 세션 파일이 있는 것
  write("old-k", [{ type: "custom-title", customTitle: "TEAM_K" }, reply()], 300); // 오래됨
  write("crashed-l", [{ type: "custom-title", customTitle: "TEAM_L" }, reply(true)], 5); // 도구 호출 도중
  write("nameless", [reply()], 5);
  const out = readEndedSessions(new Set(["live-j"]), Date.now(), 30 * 60_000, [join(root, "projects")]);
  assert.deepEqual(out.map((e) => [e.sessionId, e.name, e.normalEnd]).sort(), [["crashed-l", "TEAM_L", false], ["ended-i", "TEAM_I", true]]);
  assert.equal(JSON.stringify(out).includes('"text"'), false); // 본문은 옮기지 않는다
  assert.deepEqual(readEndedSessions(new Set(), Date.now(), 30 * 60_000, [join(root, "no-such-dir")]), []);
});

test("restartGraceMin: dispatch.json에서 읽고 양수가 아니면 기본 30분", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-cfg-"));
  try {
    const f = join(dir, "dispatch.json");
    assert.equal(loadDispatchConfig(f).restartGraceMin, DEFAULT_RESTART_GRACE_MIN);
    for (const [v, want] of [[45, 45], [0, 30], [-5, 30], ["x", 30]] as const) {
      writeFileSync(f, JSON.stringify({ restartGraceMin: v }));
      assert.equal(loadDispatchConfig(f).restartGraceMin, want);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("보내기(release): RESTARTING이고 살아 있는 세션이 없으면 보내지 않고 이유를 준다. 세션이 뜨거나 유예가 지나면 보통대로", () => {
  const [p] = fold(d0068());
  const wait = restartingWhyOf(p!, { sessions: [], restarting: [restartingTeamI] });
  assert.match(wait!, /^TEAM_I: 세션 없음 — \/clear 뒤 첫 메시지 대기 — 새 세션이 뜬 뒤에 보낸다/);
  assert.equal(restartingWhyOf(p!, { sessions: [session(NEW, "Team I")], restarting: [restartingTeamI] }), null);
  assert.equal(restartingWhyOf(p!, { sessions: [], restarting: [] }), null); // 유예가 지나면 예전처럼(제안은 이미 닫힌다)
  assert.equal(restartingWhyOf(p!, { sessions: [session("x", "TEAM_I", "dead")], restarting: [restartingTeamI] })!.startsWith("TEAM_I:"), true);
});
