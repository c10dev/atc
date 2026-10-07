import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { answeredMisfire, cameBackMisfires, closedEvents, ENDED_GRACE_MS, type EndedEvent, type EndedSession, endedClosuresOf, endedCounterOf } from "./clearance-ended.ts";
import type { Clearance } from "./model.ts";

// ATC-567: 받는 세션이 끝난 CLEARANCE(FLIGHT 없음)를 서버가 닫는 순수 규칙, RESEND 고리, MISFIRE 셈, 1분 일의 기록
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const H = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DUTY = "951f27c2-a99c-4124-bb25-b4d3cba3d1f1";
const TOWER: EndedSession = { id: "tower-1", status: "idle", lastActiveAt: ago(0) };
const dead = (id = DUTY, lastActiveAt: string | null = ago(31 * H)): EndedSession => ({ id, status: "dead", lastActiveAt });

const clr = (id: string, over: Partial<Clearance> = {}): Clearance => ({ id, at: ago(30 * H), to: DUTY, toName: "951f27c2", type: "FIX", stand: "/w/duty-control-plane", flight: null, text: "FIX PR #587: findings", readbackAt: null, cancelledAt: null, ...over });
const ids = (xs: readonly Clearance[]) => xs.map((c) => c.id).sort();

test("the 2026-10-06 shape: 8 CLEARANCEs (three RESEND chains) to one ended DUTY session are all closed", () => {
  const list = [
    clr("C-1069", { type: "INFO", text: "PR #587 cannot land yet" }),
    clr("C-1070", { text: "FIX PR #587: head 1f78a1" }),
    clr("C-1072", { type: "INFO", text: "RESEND PR #587 cannot land yet", at: ago(29.8 * H) }),
    clr("C-1074", { text: "RESEND FIX PR #587: head 1f78a1", at: ago(29.7 * H) }),
    clr("C-1075", { text: "FIX PR #587: head c4fdf9" }),
    clr("C-1077", { text: "FIX PR #587: head 916ba3", at: ago(28 * H) }),
    clr("C-1078", { text: "RESEND FIX PR #587 head 916ba38", at: ago(27.8 * H) }),
    clr("C-1080", { text: "FIX PR #587: head d2b013", at: ago(27.7 * H) }),
  ];
  assert.deepEqual(ids(endedClosuresOf({ clearances: list, sessions: [TOWER, dead()], now: NOW }, "on")), ["C-1069", "C-1070", "C-1072", "C-1074", "C-1075", "C-1077", "C-1078", "C-1080"]);
});

test("not closed: a FLIGHT (CLEARANCE MOOT's rule), a live addressee, an already closed CLEARANCE, a RESTARTING addressee, the switch off", () => {
  const sessions = [TOWER, dead(), { id: "team-a", status: "busy" as const, lastActiveAt: ago(0) }];
  const list = [
    clr("C-1", { flight: "ATC-587" }),
    clr("C-2", { to: "team-a", toName: "TEAM_A" }),
    clr("C-3", { readbackAt: ago(H) }),
    clr("C-4", { unableAt: ago(H) }),
    clr("C-5", { cancelledAt: ago(H) }),
    clr("C-6", { to: "gone-b", toName: "TEAM_B" }),
    clr("C-7"), // closed
  ];
  const restarting = (name: string) => name === "TEAM_B";
  assert.deepEqual(ids(endedClosuresOf({ clearances: list, sessions, restarting, now: NOW }, "on")), ["C-7"]);
  assert.deepEqual(endedClosuresOf({ clearances: list, sessions, restarting, now: NOW }, "off"), []);
});

test("liveness is the FLEET's: a session marked dead by job gone (ATC-534) is ended; a session missing from the snapshot is ended", () => {
  const jobGone: EndedSession & { jobGone: string } = { id: "bg-1", status: "dead", lastActiveAt: ago(5 * H), jobGone: "job gone (last state 07:00Z)" };
  const list = [clr("C-1", { to: "bg-1", toName: "TEAM_C" }), clr("C-2", { to: "never-seen", toName: "TEAM_D" })];
  assert.deepEqual(ids(endedClosuresOf({ clearances: list, sessions: [TOWER, jobGone], now: NOW }, "on")), ["C-1", "C-2"]);
});

test("grace: counted from the latest of send, first STANDBY and the dead session's last write", () => {
  const just = NOW - ENDED_GRACE_MS + 60_000; // one minute short of the grace
  const sessions = [TOWER, dead(DUTY, ago(30 * H)), dead("late", new Date(just).toISOString())];
  const list = [
    clr("C-1", { at: new Date(just).toISOString() }), // sent too recently
    clr("C-2", { standbyAt: new Date(just).toISOString() }), // STANDBY too recently
    clr("C-3", { to: "late", toName: "TEAM_L" }), // session wrote too recently
    clr("C-4", { at: ago(ENDED_GRACE_MS + 60_000) }), // closed
    clr("C-5", { to: "absent", toName: "TEAM_X", at: new Date(just).toISOString() }), // absent from the snapshot: only the send time counts
  ];
  assert.deepEqual(ids(endedClosuresOf({ clearances: list, sessions, now: NOW }, "on")), ["C-4"]);
});

test("nothing is closed when the snapshot has no live session at all (session folders unreadable)", () => {
  assert.deepEqual(endedClosuresOf({ clearances: [clr("C-1")], sessions: [dead()], now: NOW }, "on"), []);
  assert.deepEqual(endedClosuresOf({ clearances: [clr("C-1")], sessions: [], now: NOW }, "on"), []);
});

test("RESEND chain: a qualifying original closes its fresh RESEND, and a qualifying RESEND closes its original", () => {
  const fresh = ago(10 * 60_000);
  // 원래 것이 유예를 넘겼고 RESEND는 막 나갔다
  const a = [clr("C-1", { text: "FIX PR #9" }), clr("C-2", { text: "RESEND FIX PR #9", at: fresh })];
  assert.deepEqual(ids(endedClosuresOf({ clearances: a, sessions: [TOWER, dead()], now: NOW }, "on")), ["C-1", "C-2"]);
  // 원래 것은 STANDBY가 막 와서 유예 안이고, RESEND가 유예를 넘겼다
  const b = [clr("C-1", { text: "FIX PR #9", at: ago(5 * H), standbyAt: fresh }), clr("C-2", { text: "RESEND FIX PR #9", at: ago(4 * H) })];
  assert.deepEqual(ids(endedClosuresOf({ clearances: b, sessions: [TOWER, dead(DUTY, ago(6 * H))], now: NOW }, "on")), ["C-1", "C-2"]);
  // 고리의 하나가 답을 받았으면 받는 이가 답한 것이다: 고리를 닫지 않는다
  const c = [clr("C-1", { text: "FIX PR #9" }), clr("C-2", { text: "RESEND FIX PR #9", at: ago(29 * H), readbackAt: ago(28 * H) })];
  assert.deepEqual(endedClosuresOf({ clearances: c, sessions: [TOWER, dead()], now: NOW }, "on"), []);
});

test("closed events carry the chain root; came-back misfire within 24 h counts once; answered misfire counts once", () => {
  const list = [clr("C-1", { text: "FIX PR #9" }), clr("C-2", { text: "RESEND FIX PR #9", at: ago(29 * H) })];
  const closed = closedEvents(list, list, NOW - 2 * H);
  assert.deepEqual(closed.map((e) => (e.op === "closed" ? [e.id, e.root] : null)), [["C-1", "C-1"], ["C-2", "C-1"]]);
  // 같은 세션 id가 다시 살아 있다
  const back = cameBackMisfires(closed, [TOWER, { id: DUTY, status: "idle" }], NOW);
  assert.deepEqual(back.map((e) => (e.op === "misfire" ? [e.id, e.why] : null)), [["C-1", "came-back"], ["C-2", "came-back"]]);
  assert.deepEqual(cameBackMisfires([...closed, ...back], [TOWER, { id: DUTY, status: "idle" }], NOW), []);
  // 아직 dead면, 또는 24시간이 지난 뒤 돌아왔으면 세지 않는다
  assert.deepEqual(cameBackMisfires(closed, [TOWER, dead()], NOW), []);
  assert.deepEqual(cameBackMisfires(closed, [TOWER, { id: DUTY, status: "idle" }], NOW + 23 * H), []);
  // 답이 왔다
  const ans = answeredMisfire(closed, "C-2", NOW);
  assert.deepEqual(ans && ans.op === "misfire" ? [ans.id, ans.why] : null, ["C-2", "answered"]);
  assert.equal(answeredMisfire([...closed, ans!], "C-2", NOW), null);
  assert.equal(answeredMisfire(closed, "C-9", NOW), null); // 이 규칙이 닫지 않은 것
});

test("weekly counter: closures and misfires in the last 7 days", () => {
  const events: EndedEvent[] = [
    { op: "closed", t: ago(8 * 24 * H), id: "C-1", to: DUTY, root: "C-1" },
    { op: "closed", t: ago(2 * H), id: "C-2", to: DUTY, root: "C-2" },
    { op: "closed", t: ago(2 * H), id: "C-3", to: DUTY, root: "C-2" },
    { op: "misfire", t: ago(H), id: "C-2", why: "answered" },
    { op: "misfire", t: ago(H), id: "C-3", why: "came-back" },
  ];
  assert.deepEqual(endedCounterOf(events, NOW), { days: 7, closed: 2, misfires: 2, answered: 1, cameBack: 1 });
});

test("the 1-minute job closes by appending an undeliverable line (never a rewrite) and the CLEARANCE leaves pending and overdue", async () => {
  const { config } = await import("./config.ts");
  const { allClearances, isPending, issueClearance, markClearance } = await import("./clearances.ts");
  const { readEndedEvents, trackEnded, noteEndedAnswer, saveEndedSwitch } = await import("./clearance-ended-run.ts");
  const { overdueRefsOf } = await import("./control-recycle-run.ts");
  const file = join(config.stateDir, "clearances.jsonl");
  const events = join(config.stateDir, "test-ended-events.jsonl");
  const switchFile = join(config.stateDir, "clearance-ended.json");
  const a = issueClearance({ to: DUTY, toName: "951f27c2", type: "FIX", stand: null, flight: null, text: "FIX PR #587" });
  const b = issueClearance({ to: DUTY, toName: "951f27c2", type: "FIX", stand: null, flight: null, text: "RESEND FIX PR #587" });
  const withFlight = issueClearance({ to: DUTY, toName: "951f27c2", type: "FIX", stand: null, flight: "ATC-587", text: "FIX PR #600" });
  const later = Date.now() + ENDED_GRACE_MS + 60_000;
  assert.deepEqual(overdueRefsOf(allClearances(), later).map((x) => x.id).sort(), [a.id, b.id, withFlight.id].sort());
  const before = readFileSync(file, "utf8");
  const snap = { sessions: [{ ...TOWER, agent: "claude" as const, name: "TOWER", pid: 1, cwd: "/", startedAt: ago(H), repo: null, workspacePath: null }], restarting: [] };

  // 스위치 off: 아무것도 닫지 않는다
  saveEndedSwitch("off", "test", switchFile);
  assert.deepEqual(trackEnded(snap, later, events), []);
  assert.equal(readFileSync(file, "utf8"), before);

  saveEndedSwitch("on", "test", switchFile);
  const lines = trackEnded(snap, later, events);
  assert.deepEqual(lines.map((e) => e.id).sort(), [a.id, b.id].sort());
  const after = readFileSync(file, "utf8");
  assert.ok(after.startsWith(before), "earlier lines are kept as they were");
  const added = after.slice(before.length).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(added.map((o) => [o.op, o.id, o.reason, o.cause]).sort(), [["undeliverable", a.id, "addressee ended", "absent"], ["undeliverable", b.id, "addressee ended", "absent"]].sort());
  const now = allClearances();
  assert.deepEqual(now.filter(isPending).map((c) => c.id), [withFlight.id]);
  assert.deepEqual(overdueRefsOf(now, later).map((x) => x.id), [withFlight.id]);
  assert.equal(now.find((c) => c.id === a.id)?.undeliverableReason, "addressee ended");

  // 다음 tick은 다시 닫지 않는다
  assert.deepEqual(trackEnded(snap, later + 60_000, events), []);
  // 닫힌 뒤 온 답은 전처럼 거절되고 MISFIRE로 한 번 센다
  assert.ok("error" in (markClearance(a.id, "readback") ?? { error: "missing" }));
  assert.equal(noteEndedAnswer(a.id, later, events)?.op, "misfire");
  assert.equal(noteEndedAnswer(a.id, later, events), null);
  assert.equal(readEndedEvents(events).filter((e) => e.op === "misfire").length, 1);
});
