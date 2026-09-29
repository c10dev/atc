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
    project: "Song Experience", labels: ["type:BUILD", "wake:M"], createdAt: ago(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null, ...over,
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

test("STAND 없는 FLIGHT(SURVEY·CHECK): READBACK → DEPARTED → ARRIVED, PR·CLEARED는 건너뛰고 no-pr 대신 no-arrival", () => {
  const survey = ticket("VOC-1", { labels: ["type:SURVEY", "wake:M"] });
  const departed = (min: number) => ({ ...proposal("D-1", "VOC-1", "departed", { accepted: ago(min), departed: ago(min) }), departedVia: "readback" as const });
  // 5시간: 아직 괜찮음 · 7시간: no-arrival (M 240분 × 1.5 = 360분). no-pr는 나오지 않는다
  let [f] = followingOf(input({ proposals: [departed(300)], tickets: [survey] }));
  assert.equal(f.standFree, true);
  assert.deepEqual(f.stages, { readback: ago(300), departed: ago(300), prOpened: null, cleared: null, arrived: null });
  assert.equal(f.stage, "departed");
  assert.deepEqual(f.issues, []);
  [f] = followingOf(input({ proposals: [departed(420)], tickets: [survey], workspaces: [{ path: "/wt/x", ticketKey: "VOC-1" }] }));
  assert.deepEqual(f.issues.map((i) => `${i.code}:${i.severity}`), ["no-arrival:warn"]);
  assert.match(f.issues[0].text, /ARRIVED 보고 없음\(STAND 없는 SURVEY\)/);
  // CAPTAIN 보고로 ARRIVED: 보고 내용이 붙고, Linear가 In Review·Done이어도 PR 불일치를 보지 않는다
  const arrived = { ...proposal("D-1", "VOC-1", "arrived", { accepted: ago(500), departed: ago(500), arrived: ago(30) }), departedVia: "readback" as const, arrivedNote: "조사 결과 https://x/doc", arrivedUrl: "https://x/doc" };
  [f] = followingOf(input({ proposals: [arrived], tickets: [ticket("VOC-1", { labels: ["type:SURVEY"], state: "Done", stateType: "completed" })] }));
  assert.equal(f.stage, "arrived");
  assert.equal(f.stages.arrived, ago(30));
  assert.deepEqual(f.arrival, { note: "조사 결과 https://x/doc", url: "https://x/doc" });
  assert.deepEqual(f.issues, []);
  assert.deepEqual(followingOf(input({ proposals: [departed(420)], tickets: [ticket("VOC-1", { labels: ["type:CHECK"], state: "In Review" })] }))[0].issues.map((i) => i.code), ["no-arrival"]);
  // ARRIVED 보고 뒤 하루가 지나면 Linear 상태와 상관없이 빠진다
  const old = { ...arrived, timeline: { ...arrived.timeline, arrived: ago(25 * 60) } };
  assert.equal(followingOf(input({ proposals: [old], tickets: [survey] })).length, 0);
  // recalling은 지연을 보지 않는다
  assert.deepEqual(followingOf(input({ proposals: [{ ...departed(900), status: "recalling" as const }], tickets: [survey] }))[0].issues, []);
});

test("STAND 없는 tail: FLIGHT: DEPARTED는 착수 기록(없으면 Linear 시작 시각), ARRIVED는 Linear 완료", () => {
  const t = ticket("VOC-2", { labels: ["type:CHECK", "wake:L", "tail:TEAM_E"], startedAt: ago(200) });
  let [f] = followingOf(input({ tickets: [t] }));
  assert.equal(f.standFree, true);
  assert.equal(f.stages.departed, ago(200));
  assert.deepEqual(f.issues.map((i) => i.code), ["no-arrival"]); // L 60분 × 1.5 = 90분
  [f] = followingOf(input({ tickets: [{ ...t, state: "Done", stateType: "completed", updatedAt: ago(10) }] }));
  assert.equal(f, undefined); // Done이면 In Progress가 아니라 대상에서 빠진다
});

test("AIRCRAFT health(ATC-45): 그 FLIGHT를 쥔 AIRCRAFT의 코드가 health 문제로, ALERT면 warn", () => {
  const health = new Map([["TEAM_B", { code: "LIMIT" as const, level: "alert" as const, since: ago(3), resetsAt: new Date(NOW + 30 * 60_000).toISOString(), detail: "You've hit your session limit", next: "reset까지 기다린다", holds: true }]]);
  const [f] = followingOf(input({ proposals: [proposal("D-1", "VOC-1", "accepted", { accepted: ago(5) })], tickets: [ticket("VOC-1")], health }));
  const issue = f!.issues.find((i) => i.code === "health")!;
  assert.deepEqual([issue.severity, issue.since, issue.key], ["warn", ago(3), "VOC-1|health|LIMIT"]);
  assert.match(issue.text, /^TEAM_B HOLD · LIMIT until 12:30Z — You've hit your session limit\. reset까지 기다린다$/);
  // INFO면 info, 코드 없는 AIRCRAFT는 문제 없음
  const info = new Map([["TEAM_B", { ...health.get("TEAM_B")!, code: "PENDING" as const, level: "info" as const }]]);
  assert.equal(followingOf(input({ proposals: [proposal("D-1", "VOC-1", "accepted", { accepted: ago(5) })], tickets: [ticket("VOC-1")], health: info }))[0]!.issues[0]!.severity, "info");
  assert.deepEqual(followingOf(input({ proposals: [proposal("D-1", "VOC-1", "accepted", { accepted: ago(5) })], tickets: [ticket("VOC-1")] }))[0]!.issues, []);
});

test("FUEL REMAINING(ATC-55): 그 FLIGHT를 쥔 AIRCRAFT의 ACCOUNT가 INFO 임계값을 넘으면 info 문제, 창마다 한 번", () => {
  const f82 = { group: "pro-2", account: "pro-2", at: ago(3), from: "TEAM_K", fromKind: "aircraft" as const, windows: [], top: { name: "five_hour" as const, pct: 82, resetsAt: "2026-09-27T13:00:00.000Z" }, level: "info" as const, aircraft: ["TEAM_B", "TEAM_K"], control: [] };
  const run = (fuel: Record<string, typeof f82>) => followingOf(input({ proposals: [proposal("D-1", "VOC-1", "accepted", { accepted: ago(5) })], tickets: [ticket("VOC-1")], fuel }))[0]!.issues;
  const [issue] = run({ TEAM_B: f82 });
  assert.deepEqual([issue!.code, issue!.severity, issue!.since, issue!.key], ["fuel", "info", ago(3), "VOC-1|fuel|pro-2|five_hour|2026-09-27T13:00:00.000Z"]);
  assert.equal(issue!.text, "TEAM_B FUEL 사용 82% · resets 13:00Z (account pro-2) — 한도에 가까움. 같은 ACCOUNT: TEAM_B, TEAM_K");
  // 임계값 아래면 문제 없음
  assert.deepEqual(run({ TEAM_B: { ...f82, level: "ok" as never } }), []);
});

test("AIRCRAFT health(ATC-86): cut LIMIT·RESUME·STALLED가 그 FLIGHT의 health 문제로. RESUME은 warn, STALLED는 info, 다음 한 걸음은 SUPERVISOR의 \"계속\"", () => {
  const mk = (code: "LIMIT" | "RESUME" | "STALLED", level: "alert" | "info", extra = {}) => new Map([["TEAM_B", { code, level, since: ago(3), detail: `${code} 원문`, next: `${code} — SUPERVISOR가 "계속"을 보낸다`, holds: code === "LIMIT", ...extra }]]);
  const one = (health: ReturnType<typeof mk>) => followingOf(input({ proposals: [proposal("D-1", "VOC-1", "accepted", { accepted: ago(5) })], tickets: [ticket("VOC-1")], health }))[0]!.issues.find((i) => i.code === "health")!;
  const cut = one(mk("LIMIT", "alert", { cut: true, cutAt: ago(3) }));
  assert.deepEqual([cut.severity, cut.key], ["warn", "VOC-1|health|LIMIT"]);
  assert.match(cut.text, /^TEAM_B HOLD · LIMIT \(cut \d\d:\d\dZ\) — LIMIT 원문/);
  const resume = one(mk("RESUME", "alert"));
  assert.deepEqual([resume.severity, resume.key], ["warn", "VOC-1|health|RESUME"]); // 코드가 바뀌면 새로 보고한다
  assert.equal(resume.text, 'TEAM_B RESUME 필요 — RESUME 원문. RESUME — SUPERVISOR가 "계속"을 보낸다');
  const stalled = one(mk("STALLED", "info"));
  assert.deepEqual([stalled.severity, stalled.key], ["info", "VOC-1|health|STALLED"]);
  assert.match(stalled.text, /^TEAM_B STALLED 3m — STALLED 원문/);
});
