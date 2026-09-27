import assert from "node:assert/strict";
import { test } from "node:test";
import type { Departure } from "./departures.ts";
import { ackReported, followingOf, freshKeys, targetsOf, type FollowInput } from "./following.ts";
import type { LogEntry } from "./logbook.ts";
import type { PullRequest, Ticket } from "./model.ts";
import type { Proposal } from "./proposals.ts";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({
    key, title: `${key} title`, state: "In Progress", stateType: "started", stateColor: null, priority: 2, url: `https://linear/${key}`, updatedAt: ago(30),
    project: "Song Experience", labels: ["type:BUILD", "wake:M"], createdAt: ago(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, ...over,
  }) as Ticket;
const proposal = (id: string, flight: string, status: Proposal["status"], timeline: Proposal["timeline"]): Proposal =>
  ({
    id, at: ago(2000), kind: "ASSIGN", flight, aircraft: "b", aircraftName: "TEAM_B", airport: "VCDO", score: 1, factors: [], status, decidedAt: null,
    statusAt: ago(10), timeline, reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: null, crosscheck: null,
  }) as Proposal;
const pr = (number: number, flight: string, over: Partial<PullRequest> = {}): PullRequest => ({
  repo: "/p/vocado", number, title: "t", url: `https://gh/${number}`, branch: `b${number}`, head: "h", base: "main", ticketKey: flight, standPath: null,
  draft: false, landing: "APPROACH", blocks: [{ code: "no-review", text: "head 리뷰 없음" }], readyAt: null, createdAt: ago(60), ...over,
});
const logEntry = (flight: string, arrivedMin: number, over: Partial<LogEntry> = {}): LogEntry =>
  ({
    key: `o/r#9`, aircraft: "TEAM_B", flight, class: null, airport: "VCDO", pr: { repo: "o/r", number: 9, url: "https://gh/9", title: "t" }, stands: [],
    departedAt: ago(arrivedMin + 100), departedFrom: "claim", arrivedAt: ago(arrivedMin), blockMin: 50, landingWaitMin: 20, codexFindings: 0, changesRequested: false,
    reverted: false, los: 0, ...over,
  }) as LogEntry;
const input = (over: Partial<FollowInput>): FollowInput => ({ proposals: [], tickets: [], workspaces: [], pulls: [], logbook: [], departures: [], now: NOW, ...over });

test("대상: accepted·departed·recalling인 ASSIGN과 tail:이 붙은 In Progress, 그 밖은 아님", () => {
  const ps = [
    proposal("D-1", "VOC-1", "accepted", { accepted: ago(10) }),
    proposal("D-2", "VOC-2", "departed", { accepted: ago(100), departed: ago(90) }),
    proposal("D-3", "VOC-3", "recalling", { accepted: ago(100) }),
    proposal("D-4", "VOC-4", "sent", {}),
    proposal("D-5", "VOC-5", "recalled", {}),
  ];
  const tickets = [ticket("VOC-6", { labels: ["tail:TEAM_E"] }), ticket("VOC-7"), ticket("VOC-8", { labels: ["tail:TEAM_E"], stateType: "unstarted", state: "Todo" })];
  assert.deepEqual(targetsOf({ proposals: ps, tickets }).map((t) => `${t.flight}:${t.aircraft}:${t.proposal?.id ?? "tail"}`), ["VOC-1:TEAM_B:D-1", "VOC-2:TEAM_B:D-2", "VOC-3:TEAM_B:D-3", "VOC-6:TEAM_E:tail"]);
});

test("단계: READBACK → DEPARTED(착수 기록) → PR → CLEARED → ARRIVED, 문제 없음", () => {
  const dep: Departure = { t: ago(200), flight: "VOC-1", aircraft: "TEAM_B", stand: "/wt/voc-1", branch: "b", repo: "/p/vocado", via: "claim" };
  const [f] = followingOf(input({
    proposals: [proposal("D-1", "VOC-1", "accepted", { accepted: ago(210) })],
    tickets: [ticket("VOC-1")],
    departures: [dep],
    workspaces: [{ path: "/wt/voc-1", ticketKey: "VOC-1" }],
    pulls: [pr(21, "VOC-1", { landing: "CLEARED", blocks: [], readyAt: ago(20), createdAt: ago(100) })],
  }));
  assert.deepEqual(f.stages, { readback: ago(210), departed: ago(200), prOpened: ago(100), cleared: ago(20), arrived: null });
  assert.equal(f.stage, "cleared");
  assert.equal(f.stand, "/wt/voc-1");
  assert.deepEqual(f.pr, { repo: "/p/vocado", number: 21, url: "https://gh/21", merged: false });
  assert.deepEqual(f.issues, []);
});

test("지연: WAKE 기대치 1.5배(M 240분 → 360분)를 넘으면 단계마다, CLEARED 뒤 1시간은 정보", () => {
  const codes = (over: Partial<FollowInput>) => followingOf(input(over))[0].issues.map((i) => `${i.code}:${i.severity}`);
  const acc = (min: number) => [proposal("D-1", "VOC-1", "accepted", { accepted: ago(min) })];
  assert.deepEqual(codes({ proposals: acc(300), tickets: [ticket("VOC-1")] }), []); // 5시간: 아직
  assert.deepEqual(codes({ proposals: acc(400), tickets: [ticket("VOC-1")] }), ["no-departure:warn"]);
  assert.deepEqual(codes({ proposals: acc(400), tickets: [ticket("VOC-1", { labels: ["wake:H"] })] }), []); // H는 2일 × 1.5
  assert.deepEqual(codes({ proposals: acc(90), tickets: [ticket("VOC-1", { labels: ["wake:L"] })] }), []); // L은 60분 × 1.5 = 90분까지는 괜찮음
  assert.deepEqual(codes({ proposals: acc(100), tickets: [ticket("VOC-1", { labels: ["wake:L"] })] }), ["no-departure:warn"]);
  // STAND는 있는데 PR이 없음(착수 기록 없이 워크트리만 있으면 READBACK 시각부터 센다)
  assert.deepEqual(codes({ proposals: acc(400), tickets: [ticket("VOC-1")], workspaces: [{ path: "/wt/x", ticketKey: "VOC-1" }] }), ["no-pr:warn"]);
  const departed = [proposal("D-1", "VOC-1", "departed", { accepted: ago(900), departed: ago(800) })];
  assert.deepEqual(codes({ proposals: departed, tickets: [ticket("VOC-1")] }), ["no-pr:warn"]);
  const f = followingOf(input({ proposals: departed, tickets: [ticket("VOC-1")], pulls: [pr(21, "VOC-1", { createdAt: ago(400) })] }))[0];
  assert.deepEqual(f.issues.map((i) => i.code), ["pr-not-cleared"]);
  assert.match(f.issues[0].text, /PR #21.*head 리뷰 없음/);
  assert.deepEqual(codes({ proposals: departed, tickets: [ticket("VOC-1")], pulls: [pr(21, "VOC-1", { landing: "CLEARED", blocks: [], readyAt: ago(90), createdAt: ago(100) })] }), ["landing-wait:info"]);
  // recalling은 지연을 보지 않는다(멈추라고 했다)
  assert.deepEqual(codes({ proposals: [proposal("D-1", "VOC-1", "recalling", { accepted: ago(900) })], tickets: [ticket("VOC-1")] }), []);
});

test("불일치: In Review·Done인데 PR 없음·안 머지됨, 머지됐는데 Done 아님(정보)", () => {
  const codes = (over: Partial<FollowInput>) => followingOf(input(over))[0].issues.map((i) => `${i.code}:${i.severity}`);
  const dep = [proposal("D-1", "VOC-1", "departed", { accepted: ago(30), departed: ago(20) })];
  assert.deepEqual(codes({ proposals: dep, tickets: [ticket("VOC-1", { state: "In Review" })] }), ["review-no-pr:warn"]);
  assert.deepEqual(codes({ proposals: dep, tickets: [ticket("VOC-1", { state: "In Review" })], pulls: [pr(21, "VOC-1")] }), []);
  assert.deepEqual(codes({ proposals: dep, tickets: [ticket("VOC-1", { state: "Done", stateType: "completed" })] }), ["done-not-merged:warn"]);
  const open = followingOf(input({ proposals: dep, tickets: [ticket("VOC-1", { state: "Done", stateType: "completed" })], pulls: [pr(21, "VOC-1")] }))[0];
  assert.match(open.issues[0].text, /PR #21이 머지되지 않음/);
  const merged = followingOf(input({ proposals: dep, tickets: [ticket("VOC-1")], logbook: [logEntry("VOC-1", 30)] }))[0];
  assert.equal(merged.stage, "arrived");
  assert.equal(merged.stages.prOpened, ago(50)); // 머지 − 착륙 대기
  assert.deepEqual(merged.issues.map((i) => `${i.code}:${i.severity}`), ["merged-not-done:info"]);
  assert.deepEqual(merged.pr, { repo: "o/r", number: 9, url: "https://gh/9", merged: true });
  // 되돌린 PR은 ARRIVED로 치지 않는다
  assert.equal(followingOf(input({ proposals: dep, tickets: [ticket("VOC-1")], logbook: [logEntry("VOC-1", 30, { reverted: true })] }))[0].stages.arrived, null);
});

test("ARRIVED하고 Linear도 끝난 FLIGHT는 하루 보이고 빠진다", () => {
  const done = [ticket("VOC-1", { state: "Done", stateType: "completed" })];
  const dep = [proposal("D-1", "VOC-1", "departed", { accepted: ago(3000), departed: ago(2900) })];
  assert.equal(followingOf(input({ proposals: dep, tickets: done, logbook: [logEntry("VOC-1", 60)] })).length, 1);
  assert.equal(followingOf(input({ proposals: dep, tickets: done, logbook: [logEntry("VOC-1", 25 * 60)] })).length, 0);
});

test("반복 보고 막기: 보고한 key는 fresh가 아니고, 풀리면 지워져 다시 생기면 fresh", () => {
  const items = followingOf(input({ proposals: [proposal("D-1", "VOC-1", "accepted", { accepted: ago(400) })], tickets: [ticket("VOC-1")] }));
  assert.deepEqual(freshKeys(items, { reported: {} }), ["VOC-1|no-departure"]);
  const r = ackReported(items, { reported: { "VOC-9|no-pr": ago(100) } }, ["VOC-1|no-departure", "VOC-1|made-up"], ago(0));
  assert.deepEqual(r, { reported: { "VOC-1|no-departure": ago(0) } }); // 풀린 VOC-9·없는 key는 남기지 않음
  assert.deepEqual(freshKeys(items, r), []);
  assert.deepEqual(ackReported([], r, [], ago(0)), { reported: {} }); // 풀리면 지워진다
});
