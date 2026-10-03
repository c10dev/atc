import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, planDispatch } from "./dispatch.ts";
import type { Claim, Session, Snapshot, Ticket } from "./model.ts";
import { type OrphanInput, openEpisodesOf, orphanCounterOf, orphanDue, orphanFlightsByReg, orphansOf, orphanStep, type OrphanStepCtx, orphanViewOf, parseOrphanSwitch, resumeTextOf } from "./orphan-flight.ts";
import { appendOrphanEvents, loadOrphanSwitch, readOrphanEvents, saveOrphanSwitch } from "./orphan-flight-run.ts";
import { relayInputOf } from "./relay.ts";

// ORPHAN FLIGHT(ATC-516). 2026-10-03의 TEAM_O·VOC-317을 fixture로 쓴다: 순수 함수만, 실제 상태 폴더 없음
const T = (hhmm: string) => Date.parse(`2026-10-03T${hhmm}:00.000Z`);
const iso = (hhmm: string) => new Date(T(hhmm)).toISOString();
const VCDO = "/home/c10/projects/vocado_nextjs";
const STAND = "/home/c10/projects/vocado_nextjs/.claude/worktrees/voc-317-landing";

const sess = (id: string, status: Session["status"], lastActiveAt: string, startedAt = iso("05:49")) => ({ id, name: "TEAM_O", status, startedAt, lastActiveAt });
const tk = (key: string, over: Partial<Ticket> = {}) => ({ key, stateType: "started", labels: [] as string[], ...over }) as Pick<Ticket, "key" | "stateType" | "labels">;
const D0652 = { id: "D-0652", kind: "ASSIGN", flight: "VOC-317", aircraft: "6bc31035", aircraftName: "TEAM_O", registration: "TEAM_O", status: "departed", timeline: { accepted: iso("05:50"), departed: iso("05:54") }, departedStand: STAND, at: iso("05:49") } as OrphanInput["proposals"][number];

// 6bc31035는 07:46에 한도로 끊겼고, 새 TEAM_O 세션 eeafa5df가 07:47부터 살아 있다. STAND 점유는 이미 없다(180분 TTL)
const base = (over: Partial<OrphanInput> = {}): OrphanInput => ({
  now: T("07:48"),
  sessions: [sess("6bc31035", "dead", iso("07:46")), sess("eeafa5df", "idle", iso("07:50"), iso("07:47"))],
  tickets: [tk("VOC-317"), tk("VOC-352", { stateType: "unstarted" })],
  proposals: [D0652],
  departures: [{ t: iso("05:54"), flight: "VOC-317", stand: STAND }],
  workspaces: [{ path: STAND, ticketKey: "VOC-317" }],
  claims: [],
  landed: new Set<string>(),
  owned: new Set<string>(),
  ...over,
});
const FACTS = { commit: "65abab9", uncommitted: 12, deletions: 3 };

test("1. 2026-10-03: VOC-317이 orphan(since 07:46), 알림·HOME 줄은 grace 뒤(08:01), STAND 사실은 FLIGHT 기록에서", () => {
  for (const at of ["07:48", "07:52"]) {
    const [o] = orphansOf(base({ now: T(at) }));
    assert.deepEqual([o?.flight, o?.registration, o?.since, o?.stand], ["VOC-317", "TEAM_O", iso("07:46"), STAND]);
    assert.equal(orphanDue(o!, T(at)), false); // 07:46 + 15분 = 08:01 전
  }
  const [o] = orphansOf(base({ now: T("07:52") }));
  assert.equal(orphanDue(o!, T("08:00")), false);
  assert.equal(orphanDue(o!, T("08:01")), true);
  // 11:28: 점유는 없고(claims 빈 목록) 한도로 끊긴 옛 세션이 있지만 TEAM_O에 살아 있는 세션이 있으므로 그대로 orphan
  const late = orphansOf(base({ now: T("11:28") }));
  assert.equal(late.length, 1);
  assert.equal(orphanDue(late[0]!, T("11:28")), true);
  const v = orphanViewOf(late[0]!, FACTS, T("11:28"));
  assert.match(v.line, /^VOC-317 · TEAM_O · 3시간 42분 주인 없음 · STAND voc-317-landing: 마지막 푸시 65abab9, 변경 12\(삭제 3\)$/);
  // grace는 설정이다(최소 1분)
  assert.equal(orphanDue(o!, T("07:48"), 1), true);
  assert.equal(orphanDue(o!, T("07:46"), 0), false); // 0은 1로 올려 본다
});

// 2. DISPATCH: 같은 아침 07:52(grace 안, 알림 전)
const VOC = "/home/c10/projects/vocado_nextjs";
const dsess = (id: string, name: string, status: Session["status"] = "idle"): Session => ({ id, agent: "claude", name, status, pid: 1, cwd: VOC, startedAt: iso("07:47"), lastActiveAt: iso("07:50"), repo: VOC, workspacePath: VOC });
const dticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({ key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: iso("05:00"), project: "Beta Readiness", labels: [], createdAt: iso("04:00"), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], ...over });
const dsnap = (): Snapshot =>
  ({
    at: iso("07:52"), linear: { enabled: true, error: null, fetchedAt: iso("07:51") }, github: { enabled: true, error: null, fetchedAt: iso("07:51") }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [dsess("6bc31035", "TEAM_O", "dead"), dsess("eeafa5df", "TEAM_O")], workspaces: [], tickets: [dticket("VOC-317", { state: "In Progress", stateType: "started" }), dticket("VOC-352")], columns: [], claims: [], handoffs: [], alerts: [], clearances: [],
    airports: [{ id: "r1", code: "VCDO", name: "vocado_nextjs", repo: VOC }],
  }) as unknown as Snapshot;

test("2. DISPATCH 07:52: orphan을 세면 TEAM_O는 stopped이고 VOC-352를 받지 않는다. 스위치 off(빈 셈)면 전처럼 받는다", () => {
  const cfg = { ...DEFAULT_DISPATCH_CONFIG };
  const counted = orphanFlightsByReg(orphansOf(base({ now: T("07:52") }))); // grace 안: 알림은 없지만 셈에는 들어간다
  const on = planDispatch(dsnap(), new Map(), cfg, T("07:52"), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, counted);
  const o = on.aircraft.find((a) => a.registration === "TEAM_O")!;
  assert.equal(o.stopped, true);
  assert.equal(o.available, false);
  assert.match(o.reason, /VOC-317 ORPHAN FLIGHT/);
  assert.deepEqual(o.orphanOnly, ["VOC-317"]); // 이 멈춤은 오직 orphan 때문이다(MISFIRE 셈)
  assert.match(on.excluded.find((e) => e.flight === "TEAM_O")?.reason ?? "", /TEAM_O — VOC-317 ORPHAN FLIGHT/);
  assert.equal(on.assign.some((a) => a.flight === "VOC-352"), false);
  const off = planDispatch(dsnap(), new Map(), cfg, T("07:52"), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new Map());
  assert.deepEqual(off.assign.map((a) => `${a.flight}→${a.aircraftName}`), ["VOC-352→TEAM_O"]);
  assert.equal(off.aircraft.find((a) => a.registration === "TEAM_O")?.stopped, undefined);
});

test("3. orphan이 아니다: 쥔 세션, RESTARTING, RESUME 길, 머지된 PR, 취소된 FLIGHT. 찾을 STAND가 없어도 orphan이다", () => {
  const holder: Pick<Claim, "sessionId" | "workspacePath" | "state"> = { sessionId: "eeafa5df", workspacePath: STAND, state: "active" };
  assert.deepEqual(orphansOf(base({ claims: [holder] })), []); // 살아 있는 같은 REGISTRATION 세션이 그 STAND를 쥔다
  assert.deepEqual(orphansOf(base({ sessions: [sess("6bc31035", "dead", iso("07:46")), { ...sess("eeafa5df", "idle", iso("07:50")), keptFlights: ["VOC-317"] }] })), []);
  assert.deepEqual(orphansOf(base({ tickets: [tk("VOC-317", { labels: ["tail:TEAM_O"] })] })), []); // tail: 라벨은 DISPATCH가 이미 센다
  assert.deepEqual(orphansOf(base({ owned: new Set(["TEAM_O"]) })), []); // RESTARTING 또는 ABSENT의 RESUME 길
  // 1번 fixture에서 eeafa5df를 빼면 그 REGISTRATION에는 살아 있는 세션이 없고 한도로 끊긴 RESUME 카드가 주인이다(owned)
  assert.deepEqual(orphansOf(base({ sessions: [sess("6bc31035", "dead", iso("07:46"))], owned: new Set(["TEAM_O"]) })), []);
  assert.deepEqual(orphansOf(base({ landed: new Set(["VOC-317"]) })), []); // 머지된 PR
  assert.deepEqual(orphansOf(base({ tickets: [tk("VOC-317", { stateType: "canceled" })] })), []);
  assert.deepEqual(orphansOf(base({ tickets: [tk("VOC-317", { stateType: "unstarted" })] })), []); // 시작하지 않았다
  assert.deepEqual(orphansOf(base({ sessions: [sess("6bc31035", "idle", iso("07:46")), sess("eeafa5df", "idle", iso("07:50"))] })), []); // 출발 때 세션이 아직 산다
  // STAND를 못 찾아도 orphan이고 글은 모른다고 쓴다
  const none = orphansOf(base({ proposals: [{ ...D0652, departedStand: null }], departures: [], workspaces: [] }));
  assert.equal(none.length, 1);
  assert.equal(none[0]!.stand, null);
  assert.match(resumeTextOf(none[0]!, { commit: null, uncommitted: null, deletions: null }), /STAND for VOC-317 is unknown/);
  assert.match(orphanViewOf(none[0]!, { commit: null, uncommitted: null, deletions: null }, T("11:28")).line, /STAND 모름/);
});

test("4. RESUME 글: FLIGHT·STAND·커밋·변경 12개·새 STAND 금지, RELAY 입력 검사 통과. 변경이 없으면 그 문장이 빠진다", () => {
  const [o] = orphansOf(base());
  const text = resumeTextOf(o!, FACTS);
  for (const need of ["VOC-317", STAND, "65abab9", "12 uncommitted changes", "3 of them deletions", "Do not move to a new STAND"]) assert.ok(text.includes(need), need);
  const r = relayInputOf({ to: "TEAM_O", kind: "instruction", text, flight: "VOC-317", pr: null });
  assert.ok(!("error" in r), "error" in r ? r.error : "");
  const clean = resumeTextOf(o!, { commit: "65abab9", uncommitted: 0, deletions: 0 });
  assert.ok(!/uncommitted/.test(clean));
  assert.ok(!/Do not move to a new STAND/.test(clean));
  assert.ok(!("error" in relayInputOf({ to: "TEAM_O", kind: "instruction", text: clean, flight: "VOC-317", pr: null })));
});

// 5. 카운터
const ctx = (now: string, over: Partial<OrphanStepCtx> = {}): OrphanStepCtx => ({ now: T(now), graceMin: 15, sw: "on", endOf: () => "held", relaySince: () => false, ...over });
const run = (steps: { at: string; orphans: boolean; over?: Partial<OrphanStepCtx>; hold?: boolean }[]) => {
  const lines: ReturnType<typeof orphanStep> = [];
  const [o] = orphansOf(base());
  for (const st of steps) {
    const out = orphanStep(openEpisodesOf(lines), st.orphans ? [o!] : [], ctx(st.at, st.over));
    lines.push(...out);
    if (st.hold) lines.push({ at: iso(st.at), op: "hold", flight: "VOC-317", registration: "TEAM_O" });
  }
  return lines;
};

test("5a. 알림이 15분 안에 사라지고 RELAY도 머지도 없으면 소음 1, RELAY가 있었거나 더 늦으면 0", () => {
  // 07:52 열림, 08:02 알림(08:01 이후), 08:10에 새 세션이 쥠 → 알림 뒤 8분 = 소음
  const quick = run([{ at: "07:52", orphans: true }, { at: "08:02", orphans: true }, { at: "08:10", orphans: false }]);
  assert.deepEqual(quick.map((l) => l.op), ["open", "alert", "close"]);
  assert.deepEqual([quick[2]!.endedBy, quick[2]!.misfire], ["held", ["alert"]]);
  assert.equal(orphanCounterOf(quick, T("08:10")).misfires.alert, 1);
  const relayed = run([{ at: "07:52", orphans: true }, { at: "08:02", orphans: true }, { at: "08:10", orphans: false, over: { relaySince: () => true } }]);
  assert.deepEqual(relayed[2]!.misfire, []);
  const late = run([{ at: "07:52", orphans: true }, { at: "08:02", orphans: true }, { at: "08:30", orphans: false }]);
  assert.deepEqual(late[2]!.misfire, []);
  const merged = run([{ at: "07:52", orphans: true }, { at: "08:02", orphans: true }, { at: "08:10", orphans: false, over: { endOf: () => "merged" } }]);
  assert.deepEqual([merged[2]!.endedBy, merged[2]!.misfire], ["merged", []]);
});

test("5b. DISPATCH가 orphan 때문에만 막았고 그 orphan이 grace 안에 다시 쥐어지면 소음 1, grace 뒤면 0", () => {
  // since 07:46 → 07:52에 hold, 07:58(grace 안)에 쥠
  const inGrace = run([{ at: "07:52", orphans: true, hold: true }, { at: "07:58", orphans: false }]);
  assert.deepEqual(inGrace.at(-1)!.misfire, ["hold"]);
  assert.equal(orphanCounterOf(inGrace, T("07:58")).misfires.hold, 1);
  const after = run([{ at: "07:52", orphans: true, hold: true }, { at: "08:05", orphans: false }]);
  assert.deepEqual(after.at(-1)!.misfire, []);
  // 스위치를 끄면 에피소드는 switch로 닫히고 소음이 아니다
  const off = run([{ at: "07:52", orphans: true, hold: true }, { at: "07:58", orphans: false, over: { sw: "off" } }]);
  assert.deepEqual([off.at(-1)!.endedBy, off.at(-1)!.misfire], ["switch", []]);
  // 같은 FLIGHT는 한 번만 열고 한 번만 알린다
  const once = run([{ at: "07:52", orphans: true }, { at: "08:02", orphans: true }, { at: "08:03", orphans: true }]);
  assert.deepEqual(once.map((l) => l.op), ["open", "alert"]);
});

test("카운터: 에피소드·닫힌 수·소음·열린 FLIGHT", () => {
  const lines = run([{ at: "07:52", orphans: true, hold: true }, { at: "07:58", orphans: false }, { at: "08:20", orphans: true }]);
  const c = orphanCounterOf(lines, T("08:21"));
  assert.deepEqual([c.episodes, c.closed, c.misfires.total, c.open], [2, 1, 1, ["VOC-317"]]);
});

test("스위치 파일: 없으면 on, off를 쓰면 읽힌다. 에피소드는 추가만 하는 JSONL(임시 폴더)", () => {
  assert.deepEqual([parseOrphanSwitch(undefined), parseOrphanSwitch("x"), parseOrphanSwitch("off")], ["on", "on", "off"]);
  const dir = mkdtempSync(join(tmpdir(), "atc-orphan-"));
  const file = join(dir, "orphan-flight.json");
  assert.equal(loadOrphanSwitch(file), "on");
  saveOrphanSwitch("off", "SUPERVISOR", file);
  assert.equal(loadOrphanSwitch(file), "off");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { mode: "off" });
  const ev = join(dir, "events.jsonl");
  appendOrphanEvents([{ at: iso("08:00"), op: "open", flight: "VOC-317", registration: "TEAM_O", since: iso("07:46") }], ev);
  appendOrphanEvents([{ at: iso("08:10"), op: "close", flight: "VOC-317", registration: "TEAM_O", endedBy: "held" }], ev);
  assert.deepEqual(readOrphanEvents(ev).map((l) => l.op), ["open", "close"]);
});
