import assert from "node:assert/strict";
import { test } from "node:test";
import { followingOf, type FollowInput, unablesOf } from "./following.ts";
import type { Ticket } from "./model.ts";
import type { Proposal } from "./proposals.ts";

// 알림은 원인이 끝나면 끝난다(ATC-385): FLIGHT 닫힘, UNABLE, BLOCKED의 끝 규칙
const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({
    key, title: `${key} title`, state: "In Progress", stateType: "started", stateColor: null, priority: 2, url: `https://linear/${key}`, updatedAt: ago(30),
    project: "Song Experience", labels: ["type:BUILD", "wake:M"], createdAt: ago(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null, ...over,
  }) as Ticket;
const proposal = (id: string, flight: string, status: Proposal["status"], timeline: Proposal["timeline"]): Proposal =>
  ({
    id, at: ago(2000), kind: "ASSIGN", flight, aircraft: "b", aircraftName: "TEAM_B", airport: "VCDO", score: 1, factors: [], status, decidedAt: null,
    statusAt: ago(10), timeline, reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: null, crosscheck: null,
  }) as Proposal;
const input = (over: Partial<FollowInput>): FollowInput => ({ proposals: [], tickets: [], workspaces: [], pulls: [], logbook: [], departures: [], now: NOW, ...over });
const codes = (items: ReturnType<typeof followingOf>) => items.flatMap((f) => f.issues.map((i) => `${f.flight}|${i.code}`));
type Ended = NonNullable<FollowInput["ended"]>;

test("끝 규칙: 티켓이 Done·Canceled인 FLIGHT는 따라가지 않고 문제도 함께 빠진다", () => {
  const dep = [proposal("D-1", "VOC-1", "accepted", { accepted: ago(400) })]; // READBACK 뒤 400분: 열려 있으면 no-departure
  assert.deepEqual(codes(followingOf(input({ proposals: dep, tickets: [ticket("VOC-1")] }))), ["VOC-1|no-departure"]);
  for (const stateType of ["completed", "canceled", "duplicate"] as const) {
    const ended: Ended = [];
    assert.deepEqual(followingOf(input({ proposals: dep, tickets: [ticket("VOC-1", { state: stateType, stateType })], ended })), [], stateType);
    assert.ok(ended.some((e) => e.key === "VOC-1|no-departure" && e.rule === "flight-closed"));
    assert.ok(ended.every((e) => e.rule === "flight-closed"));
  }
});

test("끝 규칙: 닫힌 FLIGHT의 UNABLE·BLOCKED·LAUNCH 실패·전달 실패도 함께 빠진다", () => {
  const closed = [ticket("VOC-1", { state: "Done", stateType: "completed" })];
  const unables = [{ flight: "VOC-1", id: "C-1", aircraft: "TEAM_B", reason: "x", at: ago(5) }];
  const undelivered = [{ flight: "VOC-1", id: "D-1", aircraft: "TEAM_B", reason: "x", at: ago(5) }];
  const arrivalReports = new Map([["VOC-1", { op: "report", flight: "VOC-1", proposal: null, at: ago(5), blocked: "CI red" }]]) as unknown as FollowInput["arrivalReports"];
  const open = [ticket("VOC-1")];
  assert.deepEqual(codes(followingOf(input({ tickets: open, unables, undelivered, arrivalReports }))).sort(), ["VOC-1|blocked-report", "VOC-1|unable", "VOC-1|undelivered"]);
  assert.deepEqual(followingOf(input({ tickets: closed, unables, undelivered, arrivalReports })), []);
});

test("끝 규칙: STRANDED는 FLIGHT가 닫혀도 남고 같은 FLIGHT의 다른 문제만 빠진다", () => {
  const closed = [ticket("VOC-1", { state: "Done", stateType: "completed" })];
  const dep = [proposal("D-1", "VOC-1", "accepted", { accepted: ago(400) })];
  const unables = [{ flight: "VOC-1", id: "C-1", aircraft: "TEAM_B", reason: "x", at: ago(5) }];
  const stranded = [{ flight: "VOC-1", number: 4, base: "feat/x", mergedAt: ago(60) }] as unknown as FollowInput["stranded"];
  const ended: Ended = [];
  assert.deepEqual(codes(followingOf(input({ proposals: dep, tickets: closed, stranded, unables, ended }))), ["VOC-1|stranded"]);
  assert.deepEqual(ended.map((e) => e.key).sort(), ["VOC-1|done-not-merged", "VOC-1|no-departure", "VOC-1|unable|C-1"]);
});

test("끝 규칙: UNABLE은 가리킨 PR이 열려 있지 않으면 끝난다", () => {
  const gaa = { id: "C-1", flight: "VOC-7", toName: "TEAM_B", unableAt: ago(60), unableReason: "r", type: "GO AROUND" as const, text: "GO AROUND PR #12: conflicts", readbackAt: null };
  assert.deepEqual(unablesOf([gaa], [], NOW, { openPrs: new Set([12]) }).map((u) => [u.id, u.pr]), [["C-1", 12]]);
  const ended: Ended = [];
  assert.deepEqual(unablesOf([gaa], [], NOW, { openPrs: new Set([99]), ended }), []); // 머지·닫힘: 열린 PR 목록에 없다
  assert.deepEqual(ended, [{ key: "VOC-7|unable|C-1", rule: "unable-pr-gone" }]);
  // GitHub를 아직 못 읽었으면(openPrs 없음) PR로는 끝내지 않는다
  assert.deepEqual(unablesOf([gaa], [], NOW).map((u) => u.id), ["C-1"]);
  // PR을 가리키지 않은 UNABLE은 PR로 끝나지 않는다
  const noPr = { ...gaa, id: "C-2", type: "HOLD" as const, text: "HOLD" };
  assert.deepEqual(unablesOf([noPr], [], NOW, { openPrs: new Set() }).map((u) => u.id), ["C-2"]);
});

test("끝 규칙: UNABLE은 같은 주제에 나중에 READBACK이 오면 끝난다", () => {
  const unable = { id: "C-2", flight: "VOC-7", toName: "TEAM_B", unableAt: ago(60), unableReason: "r", type: "HOLD" as const, text: "HOLD", readbackAt: null };
  const readback = { id: "C-3", flight: "VOC-7", toName: "TEAM_B", unableAt: null, unableReason: null, type: "HOLD" as const, text: "HOLD", readbackAt: ago(10) };
  const before = { ...readback, id: "C-4", readbackAt: ago(120) }; // UNABLE보다 먼저 한 READBACK은 답이 아니다
  const otherType = { ...readback, id: "C-5", type: "FIX" as const };
  const otherFlight = { ...readback, id: "C-6", flight: "VOC-8" };
  assert.deepEqual(unablesOf([unable, before, otherType, otherFlight], [], NOW).map((u) => u.id), ["C-2"]);
  const ended: Ended = [];
  assert.deepEqual(unablesOf([unable, readback], [], NOW, { ended }), []);
  assert.deepEqual(ended, [{ key: "VOC-7|unable|C-2", rule: "unable-readback" }]);
  // declined FLIGHT PLAN은 같은 FLIGHT의 ASSIGN이 나중에 READBACK(accepted)되면 끝
  const declined = { ...proposal("D-1", "VOC-5", "declined", { declined: ago(60) }), statusAt: ago(60), reason: "x" };
  const retry = proposal("D-2", "VOC-5", "accepted", { accepted: ago(5) });
  const elsewhere = proposal("D-3", "VOC-6", "accepted", { accepted: ago(5) });
  assert.deepEqual(unablesOf([], [declined, elsewhere], NOW).map((u) => u.id), ["D-1"]);
  assert.deepEqual(unablesOf([], [declined, retry], NOW), []);
});

test("끝 규칙: BLOCKED는 그 FLIGHT의 뒤 보고에 BLOCKED가 없으면 끝난다(보고는 FLIGHT마다 마지막 것만 센다)", () => {
  const open = [ticket("VOC-1")];
  const report = (at: string, blocked: string) => ({ op: "report", flight: "VOC-1", proposal: null, at, blocked });
  const latest = (...rs: ReturnType<typeof report>[]) => new Map([["VOC-1", [...rs].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!]]) as unknown as FollowInput["arrivalReports"];
  assert.deepEqual(codes(followingOf(input({ tickets: open, arrivalReports: latest(report(ago(60), "CI red")) }))), ["VOC-1|blocked-report"]);
  assert.deepEqual(followingOf(input({ tickets: open, arrivalReports: latest(report(ago(60), "CI red"), report(ago(10), "none")) })), []);
});

test("끝 규칙: PR을 가리킨 UNABLE은 같은 FLIGHT의 다른 PR에 대한 READBACK으로 끝나지 않는다", () => {
  const unable = { id: "C-1", flight: "VOC-7", toName: "TEAM_B", unableAt: ago(60), unableReason: "r", type: "GO AROUND" as const, text: "GO AROUND PR #12", readbackAt: null };
  const other = { id: "C-2", flight: "VOC-7", toName: "TEAM_B", unableAt: null, unableReason: null, type: "GO AROUND" as const, text: "GO AROUND PR #13", readbackAt: ago(10) };
  const same = { ...other, id: "C-3", text: "GO AROUND PR #12 again" };
  assert.deepEqual(unablesOf([unable, other], [], NOW, { openPrs: new Set([12, 13]) }).map((u) => u.id), ["C-1"]);
  assert.deepEqual(unablesOf([unable, same], [], NOW, { openPrs: new Set([12, 13]) }), []);
});
