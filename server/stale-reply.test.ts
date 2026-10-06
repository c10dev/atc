import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearanceCalls, crewChangeCalls, flightPlanCalls, latestOfReason, parseStaleReplySwitch, staleReplyCounterOf, staleReplyWhy } from "./stale-reply.ts";

// ATC-554: 옛 id에 온 답을 거절하는 순수 함수와 센 기록. 파일은 임시 폴더만 쓴다(운영 상태 폴더를 읽지 않으려고 run은 동적으로 가져온다)
const clr = (id: string, over: Partial<{ to: string; type: string; flight: string | null }> = {}) => ({ id, to: "s1", type: "FIX", flight: "ATC-1", ...over });

test("old id after a resend (same subject, later id): refused, names the latest id", () => {
  const calls = clearanceCalls([clr("C-0001"), clr("C-0002")]);
  assert.equal(staleReplyWhy("C-0001", calls), "C-0001 is closed or superseded by a later call for the same subject — answer the latest call C-0002");
});

test("the latest id passes, and the first of several names the newest", () => {
  const calls = clearanceCalls([clr("C-0001"), clr("C-0002"), clr("C-0003")]);
  assert.equal(staleReplyWhy("C-0003", calls), null);
  assert.equal(latestOfReason(staleReplyWhy("C-0001", calls)!), "C-0003");
});

test("a different subject (other team, type or FLIGHT) is not superseded", () => {
  const calls = clearanceCalls([clr("C-0001"), clr("C-0002", { to: "s2" }), clr("C-0003", { type: "HOLD" }), clr("C-0004", { flight: "ATC-2" })]);
  assert.equal(staleReplyWhy("C-0001", calls), null);
});

test("an id that never existed is not judged here (the route answers 404)", () => {
  assert.equal(staleReplyWhy("C-9999", clearanceCalls([clr("C-0001")])), null);
});

test("old FLIGHT PLAN id after a supersede: only plans that were sent count", () => {
  const plan = (id: string, flight: string, sent: boolean) => ({ id, kind: "ASSIGN", flight, timeline: sent ? { sent: "2026-10-06T00:00:00Z" } : {} });
  const calls = flightPlanCalls([plan("D-0001", "ATC-5", true), plan("D-0002", "ATC-5", true), plan("D-0003", "ATC-5", false), plan("D-0004", "ATC-6", true)]);
  assert.match(staleReplyWhy("D-0001", calls)!, /answer the latest call D-0002$/);
  assert.equal(staleReplyWhy("D-0002", calls), null); // D-0003 was never sent
  assert.equal(staleReplyWhy("D-0004", calls), null);
});

test("CREW CHANGE: a later sent change for the same REGISTRATION supersedes the old id", () => {
  const calls = crewChangeCalls([
    { id: "CC-0001", registration: "TEAM_F", sentAt: "x" },
    { id: "CC-0002", registration: "team_f", sentAt: "y" },
    { id: "CC-0003", registration: "TEAM_G", sentAt: "z" },
  ]);
  assert.match(staleReplyWhy("CC-0001", calls)!, /answer the latest call CC-0002$/);
  assert.equal(staleReplyWhy("CC-0003", calls), null);
});

test("weekly counter counts only the window, by kind; 0 is shown", () => {
  const now = Date.parse("2026-10-06T00:00:00Z");
  const e = (days: number, kind: "clearance" | "flight-plan" | "crew-change") => ({ t: new Date(now - days * 86_400_000).toISOString(), kind, id: "x", op: "readback", latest: "y" });
  assert.deepEqual(staleReplyCounterOf([e(1, "clearance"), e(2, "flight-plan"), e(8, "crew-change")], now, 7), { refused: 2, clearance: 1, flightPlan: 1, crewChange: 0, days: 7 });
  assert.equal(staleReplyCounterOf([], now, 7).refused, 0);
});

test("switch parse: anything but off is on", () => {
  assert.equal(parseStaleReplySwitch("off"), "off");
  for (const v of ["on", undefined, "x", 1]) assert.equal(parseStaleReplySwitch(v), "on");
});

test("refuseStaleReply: off switch lets it through and counts nothing; on refuses and appends one line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-stale-"));
  process.env.ATC_STATE_DIR = dir;
  try {
    const { refuseStaleReply, readStaleReplyEvents } = await import("./stale-reply-run.ts");
    const calls = clearanceCalls([clr("C-0001"), clr("C-0002")]);
    const file = join(dir, "events.jsonl");
    const now = Date.parse("2026-10-06T00:00:00Z");
    assert.equal(refuseStaleReply("clearance", "C-0001", "readback", calls, now, file, "off"), null);
    assert.deepEqual(readStaleReplyEvents(file), []);
    assert.equal(refuseStaleReply("clearance", "C-0002", "readback", calls, now, file, "on"), null);
    assert.match(refuseStaleReply("clearance", "C-0001", "readback", calls, now, file, "on")!, /answer the latest call C-0002$/);
    assert.deepEqual(readStaleReplyEvents(file), [{ t: new Date(now).toISOString(), kind: "clearance", id: "C-0001", op: "readback", latest: "C-0002" }]);
    assert.equal(readFileSync(file, "utf8").split("\n").filter(Boolean).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
