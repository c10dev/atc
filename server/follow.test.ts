import assert from "node:assert/strict";
import { test } from "node:test";
import { arrowsBundleOf, ARROWS_KEY, bundleKeysOf, chainOrder, type FollowInput, followBoardOf, followRowOf, parseFollowBody, parseFollowFile, toggleParent } from "./follow.ts";
import { followingOf } from "./following.ts";
import type { Milestones } from "./milestones.ts";
import type { PullRequest, Ticket } from "./model.ts";
import type { Proposal } from "./proposals.ts";

const NOW = Date.parse("2026-10-01T04:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({
    key, title: `${key} title`, state: "Todo", stateType: "unstarted", stateColor: null, priority: 3, url: `https://linear/${key}`, updatedAt: ago(30),
    project: null, labels: ["type:BUILD", "wake:M"], createdAt: ago(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null, ...over,
  }) as Ticket;
const proposal = (id: string, flight: string, status: Proposal["status"], timeline: Proposal["timeline"], over: Partial<Proposal> = {}): Proposal =>
  ({
    id, at: ago(2000), kind: "ASSIGN", flight, aircraft: "f", aircraftName: "TEAM_F", airport: "ATCC", score: 1, factors: [], status, decidedAt: null,
    statusAt: ago(10), timeline, reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: null, crosscheck: null, ...over,
  }) as Proposal;
const pr = (number: number, flight: string, over: Partial<PullRequest> = {}): PullRequest => ({
  repo: "/p/atc", number, title: "t", url: `https://gh/${number}`, branch: `b${number}`, head: "h", base: "main", ticketKey: flight, standPath: null,
  draft: false, landing: "APPROACH", blocks: [{ code: "checks-pending", text: "CI 진행 중", en: "checks pending" }], readyAt: null, createdAt: ago(60), ...over,
});
const ms = (over: Partial<Milestones>): Milestones => ({ out: null, off: null, on: null, in: null, reverted: null, ...over });

const base = (over: Partial<Omit<FollowInput, "parents">>): Omit<FollowInput, "parents"> => ({
  tickets: [], proposals: [], pulls: [], clearances: [], milestones: new Map(), following: [], progress: {}, plan: null, noDeploy: new Set(), now: NOW, ...over,
});
// FLIGHT FOLLOWING 항목을 같은 입력으로 만든다(FOLLOW는 다시 세지 않고 읽는다)
const withFollowing = (inp: Omit<FollowInput, "parents">): Omit<FollowInput, "parents"> => ({
  ...inp,
  following: followingOf({ proposals: [...inp.proposals], tickets: [...inp.tickets], workspaces: [], pulls: [...inp.pulls], logbook: [], departures: [], now: NOW, endRules: false, milestones: new Map(inp.milestones) }),
});

test("번들: 하위 이슈 + related, 하위가 없으면 자기 하나", () => {
  const tickets = [ticket("ATC-1", { children: ["ATC-2", "ATC-3"], related: ["ATC-9"] }), ticket("ATC-2", { parent: "ATC-1" }), ticket("ATC-3", { parent: "ATC-1" }), ticket("ATC-9"), ticket("ATC-7")];
  assert.deepEqual(bundleKeysOf("ATC-1", tickets).sort(), ["ATC-2", "ATC-3", "ATC-9"]);
  assert.deepEqual(bundleKeysOf("ATC-7", tickets), ["ATC-7"]);
  assert.deepEqual(bundleKeysOf("ATC-404", tickets), []);
});

test("순서: blockedBy 사슬이 먼저, 같은 층은 key 순, 고리는 key 순으로 붙인다", () => {
  const tickets = [ticket("ATC-3", { blockedBy: ["ATC-2"] }), ticket("ATC-2", { blockedBy: ["ATC-4"] }), ticket("ATC-4"), ticket("ATC-1")];
  assert.deepEqual(chainOrder(["ATC-1", "ATC-2", "ATC-3", "ATC-4"], tickets), ["ATC-1", "ATC-4", "ATC-2", "ATC-3"]);
  const loop = [ticket("ATC-1", { blockedBy: ["ATC-2"] }), ticket("ATC-2", { blockedBy: ["ATC-1"] })];
  assert.deepEqual(chainOrder(["ATC-2", "ATC-1"], loop), ["ATC-1", "ATC-2"]);
});

test("Backlog: 막는 이슈가 있으면 key, 모두 끝났으면 풀 수 있음", () => {
  const tickets = [ticket("ATC-1", { state: "Backlog", stateType: "backlog", blockedBy: ["ATC-2", "ATC-3"] }), ticket("ATC-2"), ticket("ATC-3", { state: "Done", stateType: "completed" }),
    ticket("ATC-4", { state: "Backlog", stateType: "backlog", blockedBy: ["ATC-3"] })];
  const a = followRowOf("ATC-1", base({ tickets }));
  assert.equal(a.now, "ATC-2 대기");
  assert.equal(a.stages.todo.done, false);
  assert.equal(followRowOf("ATC-4", base({ tickets })).now, "풀 수 있음");
  assert.equal(followRowOf("ATC-5", base({ tickets: [...tickets, ticket("ATC-5", { state: "Backlog", stateType: "backlog" })] })).now, "Backlog"); // 막는 이슈 없음
});

test("Todo, 제안 없음: DISPATCH 사유(excluded, hold, unserved, 우선순위 없음)", () => {
  const tickets = [ticket("ATC-1"), ticket("ATC-2"), ticket("ATC-3"), ticket("ATC-4", { priority: 0 }), ticket("ATC-5")];
  const plan = {
    excluded: [{ flight: "ATC-1", reason: "진행 중인 제안 D-0272" }],
    hold: [{ flight: "ATC-2", blockedBy: ["ATC-9"] }],
    unserved: [{ flight: "ATC-3", airport: "ATCC", type: "BUILD", ratings: [], labeled: true, why: "no-tail", tails: ["TEAM_Z"] }],
  } as unknown as FollowInput["plan"];
  const now = (k: string) => followRowOf(k, base({ tickets, plan })).now;
  assert.equal(now("ATC-1"), "진행 중인 제안 D-0272");
  assert.equal(now("ATC-2"), "HOLD — ATC-9");
  assert.equal(now("ATC-3"), "AIRCRAFT 없음 (TEAM_Z)");
  assert.equal(now("ATC-4"), "우선순위 없음");
  assert.equal(now("ATC-5"), "배정 대기");
  assert.equal(followRowOf("ATC-1", base({ tickets, plan })).stages.todo.done, true);
});

test("proposed → approved(발송 없음) → sent → readback 단계와 글", () => {
  const tickets = [ticket("ATC-1"), ticket("ATC-2"), ticket("ATC-3"), ticket("ATC-4", { state: "In Progress", stateType: "started" })];
  const ps = [
    proposal("D-1", "ATC-1", "proposed", { proposed: ago(3) }),
    proposal("D-2", "ATC-2", "approved", { proposed: ago(20), approved: ago(7) }),
    proposal("D-3", "ATC-3", "sent", { proposed: ago(30), approved: ago(20), sent: ago(4) }),
    proposal("D-4", "ATC-4", "accepted", { proposed: ago(90), approved: ago(80), sent: ago(70), accepted: ago(68) }),
  ];
  const inp = withFollowing(base({ tickets, proposals: ps, progress: { "ATC-4": { segment: "work", elapsedMin: 42, typical: { p25: 30, p50: 50, p75: 90, n: 8, level: "WAKE", group: "M" }, late: false, marker: 0.1, standFree: false } } }));
  const r1 = followRowOf("ATC-1", inp);
  assert.equal(r1.now, "승인 대기");
  assert.equal(r1.current, "proposed");
  const r2 = followRowOf("ATC-2", inp);
  assert.equal(r2.now, "승인 7분 · 발송 없음");
  assert.deepEqual([r2.stages.approved.done, r2.stages.sent.done], [true, false]);
  const r3 = followRowOf("ATC-3", inp);
  assert.equal(r3.now, "발송 4분 · READBACK 대기");
  const r4 = followRowOf("ATC-4", inp);
  assert.equal(r4.current, "readback");
  assert.equal(r4.now, "작업 42분 · 보통 30분–1시간 30분 (M, n=8)");
  assert.equal(r4.stages.readback.at, ago(68));
  assert.equal(r4.proposal, "D-4");
});

test("PR: 막힘 코드와 GO AROUND(READBACK 시각), CLEARED는 착륙 대기, 줄 history에 시각이 쌓인다", () => {
  const tickets = [ticket("ATC-1", { state: "In Review", stateType: "started" }), ticket("ATC-2", { state: "In Review", stateType: "started" })];
  const ps = [
    proposal("D-1", "ATC-1", "departed", { proposed: ago(200), approved: ago(190), sent: ago(180), accepted: ago(178), departed: ago(170) }),
    proposal("D-2", "ATC-2", "departed", { proposed: ago(200), approved: ago(190), sent: ago(180), accepted: ago(178), departed: ago(170) }),
  ];
  const pulls = [pr(10, "ATC-1", { createdAt: ago(60) }), pr(11, "ATC-2", { landing: "CLEARED", blocks: [], readyAt: ago(5), createdAt: ago(50) })];
  const clearances = [{ id: "C-0255", type: "GO AROUND" as const, flight: "ATC-1", at: ago(40), readbackAt: "2026-10-01T03:15:00.000Z", cancelledAt: null }];
  const inp = withFollowing(base({ tickets, proposals: ps, pulls, clearances }));
  const a = followRowOf("ATC-1", inp);
  assert.equal(a.now, "PR #10 checks-pending · GO AROUND C-0255 READBACK 03:15Z");
  assert.equal(a.current, "pr");
  assert.equal(a.stages.ci.done, false);
  const b = followRowOf("ATC-2", inp);
  assert.equal(b.now, "착륙 대기");
  assert.equal(b.current, "ci");
  assert.deepEqual(b.history.map((h) => h.text), ["D-2 proposed", "approved", "FLIGHT PLAN 발송", "READBACK", "PR 열림", "CLEARED TO LAND"]);
});

test("landed인데 배포 전: RTS 대기, 배포 뒤 HH:MM 배포, MCC AIRPORT가 아니면 — 이고 착륙에서 끝", () => {
  const tickets = [ticket("ATC-1", { state: "Done", stateType: "completed" }), ticket("ATC-2", { state: "Done", stateType: "completed" }), ticket("ATC-3", { state: "Done", stateType: "completed" })];
  const milestones = new Map([
    ["ATC-1", ms({ out: ago(300), off: ago(100), on: ago(10) })],
    ["ATC-2", ms({ out: ago(300), off: ago(100), on: ago(30), in: "2026-10-01T03:22:00.000Z" })],
    ["ATC-3", ms({ out: ago(300), off: ago(100), on: "2026-10-01T03:20:21.000Z" })],
  ]);
  const inp = base({ tickets, milestones, noDeploy: new Set(["ATC-3"]) });
  const a = followRowOf("ATC-1", inp);
  assert.equal(a.now, `RTS 대기 · 03:50Z 착륙`);
  assert.equal(a.finished, false);
  assert.equal(a.current, "landed");
  const b = followRowOf("ATC-2", inp);
  assert.equal(b.now, "03:22Z 배포");
  assert.equal(b.finished, true);
  const c = followRowOf("ATC-3", inp);
  assert.equal(c.stages.deployed.na, true);
  assert.equal(c.finished, true);
  assert.equal(c.now, "03:20Z 착륙");
});

test("되돌려진 ON은 RTS 대기 글에 붙는다", () => {
  const tickets = [ticket("ATC-1", { state: "Done", stateType: "completed" })];
  const milestones = new Map([["ATC-1", ms({ out: ago(300), off: ago(100), on: ago(10), reverted: { number: 99, url: "u", at: ago(2) } })]]);
  assert.match(followRowOf("ATC-1", base({ tickets, milestones })).now, /PR #99로 되돌려짐/);
});

test("STAND 없는 FLIGHT: PR·CI·착륙·배포는 없고 ARRIVED에서 끝난다", () => {
  const tickets = [ticket("ATC-1", { state: "Done", stateType: "completed", labels: ["type:SURVEY", "wake:L"] })];
  const ps = [proposal("D-1", "ATC-1", "arrived", { proposed: ago(200), approved: ago(190), sent: ago(180), accepted: ago(178), departed: ago(178), arrived: ago(20) }, { departedVia: "readback" })];
  const r = followRowOf("ATC-1", withFollowing(base({ tickets, proposals: ps })));
  assert.equal(r.standFree, true);
  assert.deepEqual(["pr", "ci", "landed", "deployed"].map((s) => r.stages[s as "pr"].na), [true, true, true, true]);
  assert.equal(r.finished, true);
  assert.match(r.now, /^ARRIVED /);
});

test("tail: FLIGHT는 제안 칸이 없고 pr부터 시작한다", () => {
  const tickets = [ticket("ATC-1", { state: "In Progress", stateType: "started", labels: ["type:BUILD", "wake:M", "tail:TEAM_E"] })];
  const r = followRowOf("ATC-1", withFollowing(base({ tickets, pulls: [pr(5, "ATC-1")] })));
  assert.equal(r.tail, true);
  assert.deepEqual(["proposed", "approved", "sent", "readback"].map((s) => r.stages[s as "sent"].na), [true, true, true, true]);
  assert.equal(r.current, "pr");
});

test("UNABLE·RECALL·SUPERSEDED는 줄을 todo로 되돌리고 history에 남는다", () => {
  const tickets = [ticket("ATC-1"), ticket("ATC-2")];
  const ps = [
    proposal("D-1", "ATC-1", "declined", { proposed: ago(100), approved: ago(90), sent: ago(80) }, { reason: "충돌", statusAt: ago(70) }),
    proposal("D-2", "ATC-2", "recalled", { proposed: ago(100), approved: ago(90), sent: ago(80), accepted: ago(75) }, { statusAt: ago(30) }),
  ];
  const inp = base({ tickets, proposals: ps });
  const a = followRowOf("ATC-1", inp);
  assert.equal(a.proposal, null);
  assert.equal(a.current, "todo");
  assert.equal(a.stages.sent.done, false);
  assert.equal(a.now, "D-1 UNABLE — 충돌");
  assert.deepEqual(a.history.map((h) => h.text), ["D-1 UNABLE — 충돌"]);
  const b = followRowOf("ATC-2", inp);
  assert.equal(b.current, "todo");
  assert.match(b.history[0].text, /^D-2 RECALL/);
});

test("스냅샷에 없는 이슈는 짐작하지 않는다", () => {
  const r = followRowOf("ATC-9", base({}));
  assert.equal(r.unreadable, true);
  assert.equal(r.now, "Linear에서 못 읽음");
  assert.equal(r.current, null);
});

test("FLIGHT FOLLOWING의 문제는 같은 코드·글로 줄에 실린다(다시 세지 않는다)", () => {
  const tickets = [ticket("ATC-1", { state: "In Progress", stateType: "started" })];
  const ps = [proposal("D-1", "ATC-1", "accepted", { proposed: ago(900), approved: ago(890), sent: ago(880), accepted: ago(870) })];
  const inp = withFollowing(base({ tickets, proposals: ps }));
  const r = followRowOf("ATC-1", inp);
  const f = inp.following[0];
  assert.deepEqual(r.issues, f.issues.map((i) => ({ code: i.code, severity: i.severity, text: i.text })));
  assert.ok(r.issues.length > 0);
});

test("번들: 요약 수, 끝나면 done과 하루 뒤 folded", () => {
  const tickets = [
    ticket("ATC-1", { children: ["ATC-2", "ATC-3"], state: "Backlog", stateType: "backlog" }),
    ticket("ATC-2", { parent: "ATC-1", state: "Done", stateType: "completed" }),
    ticket("ATC-3", { parent: "ATC-1", blockedBy: ["ATC-2"], state: "Canceled", stateType: "canceled" }),
  ];
  const milestones = new Map([["ATC-2", ms({ on: ago(60), in: ago(50) })]]);
  const [b] = followBoardOf({ ...base({ tickets, milestones }), parents: ["ATC-1", "ATC-404"] });
  assert.deepEqual(b.rows.map((r) => r.key), ["ATC-2", "ATC-3"]);
  assert.deepEqual([b.total, b.finished, b.flying, b.done, b.folded], [2, 2, 0, true, false]);
  const old = new Map([["ATC-2", ms({ on: ago(3000), in: ago(2900) })]]);
  const [c, miss] = followBoardOf({ ...base({ tickets, milestones: old }), parents: ["ATC-1", "ATC-404"] });
  assert.equal(c.folded, true);
  assert.equal(miss.missing, true);
  assert.equal(miss.rows.length, 0);
});

test("follow.json: 형식 맞는 key만, 대문자·중복 정리", () => {
  assert.deepEqual(parseFollowFile({ parents: ["atc-1", "ATC-1", "x", 5, "ATC-253"] }), { parents: ["ATC-1", "ATC-253"] });
  assert.deepEqual(parseFollowFile(null), { parents: [] });
  assert.deepEqual(parseFollowFile({ parents: "ATC-1" }), { parents: [] });
});

test("POST 본문: 읽는 팀의 이슈 key만", () => {
  assert.deepEqual(parseFollowBody({ parent: "atc-253", on: true }, ["ATC"]), { ok: true, parent: "ATC-253", on: true });
  assert.equal(parseFollowBody({ parent: "VOC-1", on: true }, ["ATC"]).ok, false);
  assert.equal(parseFollowBody({ parent: "nonsense", on: true }, ["ATC"]).ok, false);
  assert.equal(parseFollowBody({ parent: "ATC-1" }, ["ATC"]).ok, false);
  assert.equal(parseFollowBody(null, ["ATC"]).ok, false);
});

test("toggleParent: 더하기·빼기는 멱등", () => {
  const f = { parents: ["ATC-1"] };
  assert.equal(toggleParent(f, "ATC-1", true), f);
  assert.deepEqual(toggleParent(f, "ATC-2", true).parents, ["ATC-1", "ATC-2"]);
  assert.deepEqual(toggleParent(f, "ATC-1", false).parents, []);
  assert.equal(toggleParent(f, "ATC-9", false), f);
});

// ── F2: 막힘(3.3)과 다음 할 일(3.4) ──

test("막힘: 우선순위 있는 Todo가 제안 없이 30분, HOLD·우선순위 없음·tail은 아니다", () => {
  const plan = { excluded: [], hold: [{ flight: "ATC-3", blockedBy: ["ATC-9"] }], unserved: [] } as unknown as FollowInput["plan"];
  const tickets = [ticket("ATC-1", { updatedAt: ago(31) }), ticket("ATC-2", { updatedAt: ago(29) }), ticket("ATC-3", { updatedAt: ago(90) }), ticket("ATC-4", { priority: 0, updatedAt: ago(90) })];
  const row = (k: string) => followRowOf(k, base({ tickets, plan }));
  assert.equal(row("ATC-1").stuck?.code, "todo-no-proposal");
  assert.equal(row("ATC-1").stuck?.stage, "proposed");
  assert.equal(row("ATC-2").stuck, null); // 29분
  assert.equal(row("ATC-3").stuck, null); // 선행 FLIGHT를 기다리는 HOLD
  assert.equal(row("ATC-4").stuck, null); // 우선순위 없음은 다음 할 일(priority)이지 막힘이 아니다
  // 되돌림(RECALL 등) 뒤에는 되돌린 때부터 센다
  const reset = proposal("D-0001", "ATC-1", "recalled", { proposed: ago(500) }, { statusAt: ago(5) });
  assert.equal(followRowOf("ATC-1", base({ tickets, plan, proposals: [reset] })).stuck, null);
});

test("막힘: 승인 뒤 발송 없음 10분, 발송 뒤 READBACK 없음 10분", () => {
  const tickets = [ticket("ATC-1"), ticket("ATC-2"), ticket("ATC-3")];
  const approved = (id: string, f: string, min: number) => proposal(id, f, "approved", { proposed: ago(60), approved: ago(min) }, { statusAt: ago(min) });
  const r1 = followRowOf("ATC-1", base({ tickets, proposals: [approved("D-1", "ATC-1", 11)] }));
  assert.equal(r1.stuck?.code, "approved-not-sent");
  assert.equal(r1.stuck?.stage, "approved");
  assert.equal(followRowOf("ATC-2", base({ tickets, proposals: [approved("D-2", "ATC-2", 9)] })).stuck, null);
  const sent = proposal("D-3", "ATC-3", "sent", { proposed: ago(60), approved: ago(40), sent: ago(12) }, { statusAt: ago(12) });
  const r3 = followRowOf("ATC-3", base({ tickets, proposals: [sent] }));
  assert.equal(r3.stuck?.code, "sent-no-readback");
  assert.equal(r3.next?.kind, "look");
  assert.equal(r3.next?.href, "#radio");
});

test("막힘: 착륙(ON) 뒤 배포(IN) 없음 15분. MCC AIRPORT가 아닌 곳은 아니다", () => {
  const tickets = [ticket("ATC-1", { state: "In Progress", stateType: "started" })];
  const m = (min: number) => new Map([["ATC-1", ms({ on: ago(min) })]]);
  assert.equal(followRowOf("ATC-1", base({ tickets, milestones: m(16) })).stuck?.code, "landed-not-deployed");
  assert.equal(followRowOf("ATC-1", base({ tickets, milestones: m(14) })).stuck, null);
  assert.equal(followRowOf("ATC-1", base({ tickets, milestones: m(60), noDeploy: new Set(["ATC-1"]) })).stuck, null);
  assert.equal(followRowOf("ATC-1", base({ tickets, milestones: m(60) })).next?.href, "#strips");
});

test("막힘: FLIGHT FOLLOWING의 pr-not-cleared·landing-wait를 그대로 쓴다", () => {
  const tickets = [ticket("ATC-1", { state: "In Progress", stateType: "started" })];
  const proposals = [proposal("D-1", "ATC-1", "departed", { proposed: ago(900), approved: ago(890), sent: ago(880), accepted: ago(870), departed: ago(860) })];
  const inp = withFollowing(base({ tickets, proposals, pulls: [pr(10, "ATC-1", { createdAt: ago(600) })], milestones: new Map([["ATC-1", ms({ off: ago(600) })]]) }));
  const row = followRowOf("ATC-1", inp);
  assert.equal(row.stuck?.code, "pr-not-cleared");
  assert.equal(row.stuck?.stage, "pr");
});

test("막힌 줄은 번들 맨 위로, 나머지는 사슬 순서 그대로", () => {
  const tickets = [
    ticket("ATC-1", { children: ["ATC-2", "ATC-3", "ATC-4"] }),
    ticket("ATC-2", { parent: "ATC-1", updatedAt: ago(5) }),
    ticket("ATC-3", { parent: "ATC-1", updatedAt: ago(5) }),
    ticket("ATC-4", { parent: "ATC-1", updatedAt: ago(90) }),
  ];
  const [b] = followBoardOf({ ...base({ tickets }), parents: ["ATC-1"] });
  assert.deepEqual(b.rows.map((r) => r.key), ["ATC-4", "ATC-2", "ATC-3"]);
  assert.equal(b.stuck, 1);
});

test("다음 할 일: release → priority → approve → human-check/merge → look 순으로 하나", () => {
  const backlog = ticket("ATC-1", { state: "Backlog", stateType: "backlog", blockedBy: ["ATC-9"] });
  const done = ticket("ATC-9", { state: "Done", stateType: "completed" });
  const next = (k: string, over: Partial<Omit<FollowInput, "parents">> = {}) => followRowOf(k, base({ tickets: [backlog, done, ticket("ATC-2", { priority: 0 }), ticket("ATC-3", { updatedAt: ago(1) }), ticket("ATC-4", { state: "In Progress", stateType: "started", updatedAt: ago(1) })], ...over })).next;
  assert.deepEqual(next("ATC-1"), { kind: "release", label: "Todo로", href: null });
  assert.equal(next("ATC-2")?.kind, "priority");
  assert.equal(next("ATC-2")?.href, "#flight/ATC-2");
  // 막는 이슈가 남은 Backlog는 release가 아니다
  assert.equal(followRowOf("ATC-1", base({ tickets: [backlog, ticket("ATC-9")] })).next, null);
  const waiting = proposal("D-5", "ATC-3", "proposed", { proposed: ago(3) });
  assert.deepEqual(next("ATC-3", { proposals: [waiting] }), { kind: "approve", label: "승인하러 D-5", href: "#home", proposal: "D-5" });
  assert.equal(next("ATC-3", { proposals: [{ ...waiting, holdAt: ago(1) }] }), null); // HELD는 승인 대기가 아니다
  const airports = [{ code: "ATCC", repo: "/p/atc" }];
  const cleared = pr(7, "ATC-4", { landing: "CLEARED", blocks: [], readyAt: ago(5) });
  assert.equal(next("ATC-4", { pulls: [cleared], airports }), null); // auto 등급은 MCC가 착륙시킨다
  assert.deepEqual(next("ATC-4", { pulls: [cleared], airports, userPulls: new Set([7]) }), { kind: "merge", label: "머지 #7", href: "#pr/ATCC/7" });
  const human = pr(8, "ATC-4", { humanCheck: { required: true, classes: ["CHOICE"], state: "pending", sha: null, carriedFrom: null } });
  assert.equal(next("ATC-4", { pulls: [human], airports })?.kind, "human-check");
});

test("끝난 줄에는 막힘도 다음 할 일도 없다. 머리 수는 번들의 합", () => {
  const tickets = [ticket("ATC-1", { state: "Done", stateType: "completed", updatedAt: ago(500) })];
  const row = followRowOf("ATC-1", base({ tickets }));
  assert.equal(row.finished, true);
  assert.equal(row.stuck, null);
  assert.equal(row.next, null);
  const board = followBoardOf({ ...base({ tickets: [ticket("ATC-2", { state: "Backlog", stateType: "backlog" }), ticket("ATC-3", { priority: 0 })] }), parents: ["ATC-2", "ATC-3"] });
  assert.equal(board.reduce((n, b) => n + b.next, 0), 1); // 막는 이슈 없는 Backlog(ATC-2)는 isReady가 아니라 없고, 우선순위 없는 Todo(ATC-3)만 priority
});

// ── ATC-382: SUPERVISOR의 화살표(발권한 FLIGHT를 FOLLOW 클릭 없이 따라간다) ──
test("화살표: 발권한 FLIGHT마다 FOLLOW와 같은 줄(단계 점·지금 글)을 만들고, 막힌 줄이 맨 위, 없으면 null", () => {
  const tickets = [ticket("ATC-1", { updatedAt: ago(60) }), ticket("ATC-2", { updatedAt: ago(5) }), ticket("ATC-3"), ticket("ATC-99")];
  const b = arrowsBundleOf([{ flight: "ATC-1", at: ago(90) }, { flight: "ATC-2", at: ago(30) }, { flight: "ATC-404", at: ago(10) }], base({ tickets }))!;
  assert.equal(b.parent, ARROWS_KEY);
  assert.equal(b.arrows, true);
  assert.deepEqual(b.rows.map((r) => r.key), ["ATC-1", "ATC-2"]); // 막힌 ATC-1(Todo 60분, 제안 없음)이 위, 스냅샷에 없는 FLIGHT는 빠진다
  assert.equal(b.rows[0].stuck?.code, "todo-no-proposal");
  assert.ok(b.rows.every((r) => r.arrow === true));
  assert.equal(b.rows[1].now, followRowOf("ATC-2", base({ tickets })).now); // FOLLOW와 같은 글
  assert.equal(b.total, 2);
  assert.equal(b.stuck, 1);
  assert.equal(arrowsBundleOf([], base({ tickets })), null);
  assert.equal(arrowsBundleOf([{ flight: "ATC-404", at: ago(1) }], base({ tickets })), null);
});

test("화살표: 발권을 다시 하면 가장 나중 것으로, 끝난 줄은 하루 뒤 빠진다(IN 시각 기준), 방금 끝난 줄은 남는다", () => {
  const done = ticket("ATC-5", { state: "Done", stateType: "completed" });
  const mk = (inMin: number) => base({ tickets: [done], milestones: new Map([["ATC-5", ms({ off: ago(inMin + 60), on: ago(inMin + 20), in: ago(inMin) })]]) });
  const recent = arrowsBundleOf([{ flight: "ATC-5", at: ago(1000) }], mk(60))!;
  assert.equal(recent.rows[0].finished, true);
  assert.equal(recent.done, true);
  assert.equal(arrowsBundleOf([{ flight: "ATC-5", at: ago(3000) }], mk(25 * 60)), null);
  const dup = arrowsBundleOf([{ flight: "ATC-2", at: ago(500) }, { flight: "ATC-2", at: ago(5) }], base({ tickets: [ticket("ATC-2")] }))!;
  assert.equal(dup.rows.length, 1);
});

test("화살표: PR 없는 FLIGHT의 ARRIVED 시각이 줄에 실린다(arrivedAt)", () => {
  const t = ticket("ATC-6", { state: "In Progress", stateType: "started" });
  const arrived = ago(5);
  const following = [{ flight: "ATC-6", source: "tail", standFree: true, stages: { arrived, readback: ago(60), departed: ago(60) }, issues: [] }] as never;
  const row = followRowOf("ATC-6", base({ tickets: [t], following }));
  assert.equal(row.arrivedAt, arrived);
  assert.equal(row.finished, true);
  assert.equal(followRowOf("ATC-1", base({ tickets: [ticket("ATC-1")] })).arrivedAt, null);
});
