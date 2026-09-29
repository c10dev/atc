import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { followingOf, type FollowInput, freshKeys, targetsOf } from "./following.ts";
import type { Ticket } from "./model.ts";
import { fold, type Op, overdueOf, readbackOps, syncOps } from "./proposals.ts";
import { DEFAULT_DISPATCH_CONFIG, type Plan } from "./dispatch.ts";
import { awaitSupervisorAlerts, confirmLineOf, confirmOpenOf, confirmViewOf, supervisorConfirmOf } from "./supervisor-confirm.ts";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

// ── 예측(순수) ──
test("예측: 사용자 등급 경로만 표시하고, 이유가 된 경로를 그대로 돌려준다", () => {
  const paths = ["server/dispatch.ts", "CLAUDE.md", ".claude/settings.json", "occ/CLAUDE.md", "controller/guard.mjs", "package.json", "web/src/views/Dispatch.tsx"];
  assert.deepEqual(supervisorConfirmOf(paths), ["CLAUDE.md", ".claude/settings.json", "controller/guard.mjs", "package.json"]);
});

test("예측: 빈 예측·모르는 경로는 표시를 세우지 않는다(오탐 없음)", () => {
  assert.deepEqual(supervisorConfirmOf([]), []);
  assert.deepEqual(supervisorConfirmOf(["server/a.ts", "docs/x.md", "web/src/styles.css", "occ/CLAUDE.md", "controller/atcctl.mjs"]), []);
});

test("예측: glob·디렉터리도 landing-tier 규칙으로 읽고, 같은 경로는 한 번만", () => {
  assert.deepEqual(supervisorConfirmOf([".github/workflows/*.yml", "hooks/*.mjs", "deploy/landing-tier.mjs", "hooks/*.mjs"]), [".github/workflows/*.yml", "hooks/*.mjs", "deploy/landing-tier.mjs"]);
  // deploy/README는 auto다
  assert.deepEqual(supervisorConfirmOf(["deploy/README.md"]), []);
  // 루트 CLAUDE.md만 사용자 등급이다(폴더의 CLAUDE.md는 관제 매뉴얼이라 flagged)
  assert.deepEqual(supervisorConfirmOf(["controller/CLAUDE.md", "CLAUDE.en.md"]), ["CLAUDE.en.md"]);
});

test("붙여 넣을 한 줄: 제안 ID·FLIGHT·경로, 승인 뜻은 담지 않는다", () => {
  const p = { id: "D-0094", flight: "ATC-115", supervisorConfirm: ["CLAUDE.md", ".claude/settings.json"] };
  assert.equal(confirmLineOf(p), "D-0094 (ATC-115): SUPERVISOR go for CLAUDE.md, .claude/settings.json edits in this FLIGHT.");
  assert.equal(confirmLineOf({ id: "D-1", flight: "ATC-1" }), null);
  assert.equal(confirmLineOf({ id: "D-1", flight: "ATC-1", supervisorConfirm: [] }), null);
  const many = confirmLineOf({ id: "D-2", flight: "ATC-2", supervisorConfirm: ["a/1.json", "a/2.json", "a/3.json", "a/4.json", "a/5.json", "a/6.json"] })!;
  assert.match(many, /a\/1\.json, a\/2\.json, a\/3\.json, a\/4\.json and 2 more edits/);
  assert.doesNotMatch(many, /approved|승인/);
});

test("표시 한 벌: 경로·한 줄·세션 여는 법(REGISTRATION과 claude agents)", () => {
  const v = confirmViewOf({ id: "D-0094", flight: "ATC-115", supervisorConfirm: [".github/x.yml"], registration: "TEAM_H", aircraftName: "TEAM_H" })!;
  assert.deepEqual(v.paths, [".github/x.yml"]);
  assert.match(v.line, /^D-0094 \(ATC-115\): SUPERVISOR go for/);
  assert.match(v.open, /claude agents/);
  assert.match(v.open, /TEAM_H/);
  assert.equal(confirmViewOf({ id: "D-1", flight: "ATC-1", aircraftName: "TEAM_A" }), null);
  assert.match(confirmOpenOf(null), /claude agents/);
});

// ── syncOps: 계획의 표시가 제안(create)에 실린다 ──
test("syncOps: 계획의 supervisorConfirm이 create에 실리고, 없으면 필드도 없다", () => {
  const plan = {
    at: iso(0), assign: [
      { kind: "ASSIGN", flight: "X-1", aircraft: "b", aircraftName: "TEAM_B", registration: "TEAM_B", airport: "VCDO", score: 9, factors: [], supervisorConfirm: ["CLAUDE.md"] },
      { kind: "ASSIGN", flight: "X-2", aircraft: "c", aircraftName: "TEAM_C", registration: "TEAM_C", airport: "VCDO", score: 8, factors: [] },
    ], release: [], hold: [], excluded: [], slots: [],
    aircraft: [
      { id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: true, reason: "PARKED", reserved: null },
      { id: "c", name: "TEAM_C", callsign: "CHARLIE", airport: "VCDO", available: true, reason: "PARKED", reserved: null },
    ],
  } as unknown as Plan;
  const tickets = [{ key: "X-1", state: "Todo", stateType: "unstarted" }, { key: "X-2", state: "Todo", stateType: "unstarted" }] as Ticket[];
  const ops = syncOps([], plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 0);
  const creates = ops.filter((o): o is Extract<Op, { op: "create" }> => o.op === "create");
  assert.deepEqual(creates.map((o) => o.supervisorConfirm), [["CLAUDE.md"], undefined]);
  assert.ok(!("supervisorConfirm" in creates[1]));
  const ps = fold(ops);
  assert.deepEqual(ps[0].supervisorConfirm, ["CLAUDE.md"]);
  // 표시는 승인을 막지 않는다
  const approved = fold([...ops, { op: "approve", id: ps[0].id, at: iso(0) }]);
  assert.equal(approved[0].status, "approved");
});

// ── await-supervisor 상태와 전이 ──
const create = (id: string, flight: string): Op => ({ op: "create", id, at: iso(60), kind: "ASSIGN", flight, aircraft: "b", aircraftName: "TEAM_B", airport: "VCDO", score: 1, factors: [] });
const sentOps = (id = "D-0001"): Op[] => [create(id, "ATC-9"), { op: "approve", id, at: iso(40) }, { op: "send", id, at: iso(30), message: "m" }];

test("await-supervisor: sent에서 사유와 함께 붙고 상태는 sent 그대로, READBACK overdue가 아니다", () => {
  assert.deepEqual(overdueOf(fold(sentOps()), NOW), ["D-0001"]); // 30분째 READBACK 없음
  const ps = fold([...sentOps(), { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "사용자 go 대기: 루트 CLAUDE.md" }]);
  assert.equal(ps[0].status, "sent");
  assert.deepEqual(ps[0].awaitSupervisor, { at: iso(20), reason: "사용자 go 대기: 루트 CLAUDE.md" });
  assert.deepEqual(overdueOf(ps, NOW), []);
});

test("await-supervisor: 다시 부르면 사유만 새로, 처음 시각은 그대로", () => {
  const ps = fold([...sentOps(), { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "첫째" }, { op: "await-supervisor", id: "D-0001", at: iso(5), reason: "둘째" }]);
  assert.deepEqual(ps[0].awaitSupervisor, { at: iso(20), reason: "둘째" });
});

test("await-supervisor: sent가 아니면 무시한다(approved·accepted·declined)", () => {
  const approved = fold([create("D-0002", "ATC-2"), { op: "approve", id: "D-0002", at: iso(40) }, { op: "await-supervisor", id: "D-0002", at: iso(4), reason: "r" }]);
  assert.equal(approved[0].awaitSupervisor, undefined);
  const accepted = fold([...sentOps(), { op: "accept", id: "D-0001", at: iso(10) }, { op: "await-supervisor", id: "D-0001", at: iso(4), reason: "r" }]);
  assert.equal(accepted[0].awaitSupervisor, undefined);
  const declined = fold([...sentOps(), { op: "decline", id: "D-0001", at: iso(10), reason: "x" }, { op: "await-supervisor", id: "D-0001", at: iso(4), reason: "r" }]);
  assert.equal(declined[0].awaitSupervisor, undefined);
});

test("전이: READBACK·UNABLE·RECALL·만료 어느 쪽이든 대기가 풀리고, 기록은 늘어나기만 한다", () => {
  const wait: Op = { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "r" };
  const after = (o: Op) => fold([...sentOps(), wait, o])[0];
  const rb = after({ op: "accept", id: "D-0001", at: iso(5) });
  assert.equal(rb.status, "accepted");
  assert.equal(rb.awaitSupervisor, undefined);
  // STAND 없는 FLIGHT의 READBACK(accept+depart)도 같다
  const light = fold([...sentOps(), wait, ...readbackOps({ id: "D-0001" }, { labels: ["type:SURVEY"] }, iso(5))])[0];
  assert.equal(light.status, "departed");
  assert.equal(light.awaitSupervisor, undefined);
  assert.equal(after({ op: "decline", id: "D-0001", at: iso(5), reason: "못 함" }).awaitSupervisor, undefined);
  assert.equal(after({ op: "recall", id: "D-0001", at: iso(5), reason: "r", message: "R" }).awaitSupervisor, undefined);
  assert.equal(after({ op: "expire", id: "D-0001", at: iso(5) }).awaitSupervisor, undefined);
});

test("await-supervisor: SUPERVISOR 대기 중에도 사유 기록(timeline)은 sent 시각을 지킨다", () => {
  const ps = fold([...sentOps(), { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "r" }]);
  assert.equal(ps[0].timeline.sent, iso(30));
  assert.equal(ps[0].statusAt, iso(30));
});

// ── FOLLOWING ──
const ticket = (key: string): Ticket =>
  ({ key, title: `${key} title`, state: "Todo", stateType: "unstarted", priority: 2, url: null, updatedAt: iso(30), labels: ["type:BUILD", "wake:M"], createdAt: iso(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null }) as unknown as Ticket;
const input = (over: Partial<FollowInput>): FollowInput => ({ proposals: [], tickets: [], workspaces: [], pulls: [], logbook: [], departures: [], now: NOW, ...over });

test("FOLLOWING: 대기 중인 sent는 따라가고 warn 문제 하나(제안 key)를 낸다. 풀리면 사라진다", () => {
  const waiting = fold([...sentOps(), { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "사용자 go 대기" }]);
  assert.deepEqual(targetsOf(input({ proposals: waiting })).map((t) => t.flight), ["ATC-9"]);
  const items = followingOf(input({ proposals: waiting, tickets: [ticket("ATC-9")] }));
  assert.equal(items.length, 1);
  const issue = items[0].issues.find((i) => i.code === "await-supervisor")!;
  assert.equal(issue.severity, "warn");
  assert.equal(issue.since, iso(20));
  assert.match(issue.text, /TEAM_B.*D-0001.*사용자 go 대기/);
  assert.match(issue.text, /atc는 보내지 않는다/);
  assert.deepEqual(freshKeys(items, { reported: {} }), ["ATC-9|await-supervisor"]);
  // 보고한 키는 다시 fresh가 아니다(제안마다 한 번)
  assert.deepEqual(freshKeys(items, { reported: { "ATC-9|await-supervisor": iso(1) } }), []);
  // sent만 있고 대기 표시가 없으면 따라가지 않는다(전과 같다)
  assert.deepEqual(followingOf(input({ proposals: fold(sentOps()), tickets: [ticket("ATC-9")] })), []);
  // READBACK이 오면 대기 문제는 없다
  const readback = fold([...sentOps(), { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "r" }, { op: "accept", id: "D-0001", at: iso(5) }]);
  const after = followingOf(input({ proposals: readback, tickets: [ticket("ATC-9")] }));
  assert.equal(after[0].issues.some((i) => i.code === "await-supervisor"), false);
});

// ── 경보(ATC-99·ATC-87과 같은 길: 제안마다 한 key) ──
test("경보: 대기 중인 sent 하나에 health 경보 하나, key는 제안, 세션 id는 그 AIRCRAFT", () => {
  const ps = fold([...sentOps("D-0001"), { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "사용자 go 대기" }, ...sentOps("D-0002").map((o) => ({ ...o, id: "D-0002" }) as Op)]);
  const sessions = [{ id: "s1", name: "TEAM_B", status: "idle" as const }, { id: "s2", name: "TEAM_B", status: "dead" as const }];
  const a = awaitSupervisorAlerts(ps, sessions);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, "health|AWAIT-SUPERVISOR|D-0001");
  assert.deepEqual(a[0].sessionIds, ["s1"]);
  assert.match(a[0].message, /AWAITING SUPERVISOR.*TEAM_B.*ATC-9.*사용자 go 대기/);
  assert.match(a[0].message, /대신 보내지 않는다/);
  // 풀리면 경보도 없다
  const done = fold([...sentOps(), { op: "await-supervisor", id: "D-0001", at: iso(20), reason: "r" }, { op: "accept", id: "D-0001", at: iso(5) }]);
  assert.deepEqual(awaitSupervisorAlerts(done, sessions), []);
});

// ── atc는 SUPERVISOR의 go를 대신 보내지 않는다 ──
test("서버·atcctl 어디에도 SUPERVISOR 승인을 팀에 전하는 문구를 만들지 않는다", () => {
  const src = readFileSync(new URL("./supervisor-confirm.ts", import.meta.url), "utf8");
  // 붙여 넣기 문구는 SUPERVISOR가 쓰는 것이라 SendMessage·send 호출이 없다
  assert.doesNotMatch(src, /SendMessage|fetch\(|spawn|exec/);
  const ctl = readFileSync(new URL("../controller/atcctl.mjs", import.meta.url), "utf8");
  assert.match(ctl, /dispatch await-supervisor/);
  assert.match(ctl, /승인을 전하지 않는다/);
});
