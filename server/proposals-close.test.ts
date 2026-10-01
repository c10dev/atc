import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type Plan } from "./dispatch.ts";
import type { Ticket, Workspace } from "./model.ts";
import { arrivedWhyNot, canApply, fold, inFlightDoneOp, isInFlight, type Op, reservedOf, syncOps } from "./proposals.ts";
import { recentPairsOf } from "./proposals.ts";

// ATC-266: 끝난 FLIGHT의 보낸 카드를 닫고, accepted에서 dispatch arrived를 받는다
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const tk = (key: string, stateType: Ticket["stateType"], state: string, type = "BUILD") => ({ key, state, stateType, labels: [`type:${type}`] }) as unknown as Ticket;
const planOf = (): Plan => ({
  at: iso(0), assign: [], release: [], hold: [], excluded: [], slots: [],
  aircraft: [{ id: "b", name: "TEAM_B", callsign: "BRAVO", airport: "VCDO", available: true, reason: "PARKED", reserved: null }],
});
const base = (id: string, flight: string): Op[] => [
  { op: "create", id, at: iso(300), kind: "ASSIGN", flight, aircraft: "b", aircraftName: "TEAM_B", airport: "VCDO", score: 1, factors: [] },
  { op: "approve", id, at: iso(290) },
  { op: "send", id, at: iso(280), message: "m" },
];
const accepted = (id: string, flight: string): Op[] => [...base(id, flight), { op: "accept", id, at: iso(270) }];
const standFreeDeparted = (id: string, flight: string): Op[] => [...accepted(id, flight), { op: "depart", id, at: iso(270), stand: null, via: "readback" }];
const standDeparted = (id: string, flight: string): Op[] => [...accepted(id, flight), { op: "depart", id, at: iso(260), stand: "/w/x" }];
const recalling = (id: string, flight: string): Op[] => [...accepted(id, flight), { op: "recall", id, at: iso(100), reason: "r", message: "m" }];

const sync = (ops: Op[], tickets: Ticket[], over: { reports?: Map<string, { pr: number | null; result: string | null }>; workspaces?: Workspace[]; landed?: Map<string, string> } = {}) =>
  syncOps(fold(ops), planOf(), { tickets, workspaces: over.workspaces ?? [] }, DEFAULT_DISPATCH_CONFIG, NOW, 1, over.landed ?? new Map(), (over.reports ?? new Map()) as never).filter((o) => o.op !== "create");

const DONE: [Ticket["stateType"], string][] = [["completed", "Done"], ["canceled", "Canceled"], ["duplicate", "Duplicate"]];

test("상태 전이: close는 sent·accepted·STAND 없는 departed에만, recalling·STAND 있는 departed에는 없다", () => {
  const status = (ops: Op[]) => fold(ops)[0];
  assert.equal(canApply(status(base("D-1", "A-1")), "close"), true);
  assert.equal(canApply(status(accepted("D-1", "A-1")), "close"), true);
  assert.equal(canApply(status(standFreeDeparted("D-1", "A-1")), "close"), true);
  assert.equal(canApply(status(standDeparted("D-1", "A-1")), "close"), false);
  assert.equal(canApply(status(recalling("D-1", "A-1")), "close"), false);
  assert.equal(canApply(status(base("D-1", "A-1").slice(0, 2)), "close"), false); // approved
  const closed = fold([...accepted("D-1", "A-1"), { op: "close", id: "D-1", at: iso(1), reason: "FLIGHT 상태가 바뀜(Duplicate)" }])[0];
  assert.equal(closed.status, "closed");
  assert.equal(closed.reason, "FLIGHT 상태가 바뀜(Duplicate)");
  assert.equal(isInFlight(closed), false);
});

test("상태 전이: accepted에서 arrived(departedVia report), STAND 없는 departed에서는 그대로", () => {
  const a = fold([...accepted("D-1", "A-1"), { op: "arrived", id: "D-1", at: iso(1), note: "https://x/y" }])[0];
  assert.equal(a.status, "arrived");
  assert.equal(a.departedVia, "report");
  assert.equal(a.departedStand, null);
  assert.equal(a.timeline.departed, undefined);
  assert.equal(a.arrivedUrl, "https://x/y");
  const d = fold([...standFreeDeparted("D-2", "A-2"), { op: "arrived", id: "D-2", at: iso(1), note: "n" }])[0];
  assert.equal(d.status, "arrived");
  assert.equal(d.departedVia, "readback");
  // sent에서는 arrived를 받지 않는다
  assert.equal(fold([...base("D-3", "A-3"), { op: "arrived", id: "D-3", at: iso(1), note: "n" }])[0].status, "sent");
});

test("동기화: sent·accepted·STAND 없는 departed 카드는 Canceled·Duplicate FLIGHT면 close, 사유를 남긴다", () => {
  for (const [stateType, state] of DONE.slice(1)) {
    for (const [name, ops] of [["sent", base("D-1", "A-1")], ["accepted", accepted("D-1", "A-1")], ["departed(STAND 없음)", standFreeDeparted("D-1", "A-1")]] as const) {
      const out = sync([...ops], [tk("A-1", stateType, state)]);
      assert.deepEqual(out, [{ op: "close", id: "D-1", at: iso(0), reason: `FLIGHT 상태가 바뀜(${state})` }], `${name} ${state}`);
    }
  }
});

test("동기화: Duplicate인 accepted 카드를 닫은 다음 접으면 closed이고 AIRCRAFT·FLIGHT 예약이 풀린다", () => {
  const ops = accepted("D-0249", "ATC-243");
  const [close] = sync(ops, [tk("ATC-243", "duplicate", "Duplicate")]);
  const after = fold([...ops, close]);
  assert.equal(after[0].status, "closed");
  assert.equal(reservedOf(after, NOW).flights.has("ATC-243"), false);
  assert.equal(reservedOf(after, NOW).aircraft.has("TEAM_B"), false);
  // 24시간 짝 규칙은 그대로: superseded처럼 센다(churned가 아니다)
  assert.equal(recentPairsOf(after, NOW).has("ATC-243|TEAM_B"), true);
});

test("동기화: recalling 카드는 FLIGHT가 끝나도 닫지 않는다(RECALL READBACK이 남음)", () => {
  for (const [stateType, state] of DONE) assert.deepEqual(sync(recalling("D-1", "A-1"), [tk("A-1", stateType, state)]), []);
});

test("동기화: STAND가 있는 departed 카드는 이 규칙이 닫지 않는다(LOGBOOK이 끝낸다)", () => {
  for (const [stateType, state] of DONE) assert.deepEqual(sync(standDeparted("D-1", "A-1"), [tk("A-1", stateType, state)], { workspaces: [{ path: "/w/x", ticketKey: "A-1" } as Workspace] }), []);
});

test("동기화: Done인데 ARRIVED 보고가 있으면 accepted·STAND 없는 departed는 arrived로 끝난다", () => {
  const reports = new Map([["A-1", { pr: null, result: "https://x/r" }]]);
  for (const ops of [accepted("D-1", "A-1"), standFreeDeparted("D-1", "A-1")]) {
    const out = sync(ops, [tk("A-1", "completed", "Done")], { reports });
    assert.equal(out.length, 1);
    assert.equal(out[0].op, "arrived");
    assert.match((out[0] as { note: string }).note, /ARRIVED 보고/);
  }
  // PR이 머지된 FLIGHT(LOGBOOK)도 같다
  const viaPr = sync(accepted("D-1", "A-1"), [tk("A-1", "completed", "Done")], { landed: new Map([["A-1", "#5"]]) });
  assert.equal(viaPr[0].op, "arrived");
});

test("동기화: Done이고 보고가 없으면 sent·STAND 필요한 accepted는 close, STAND 없는 FLIGHT는 보고를 기다린다", () => {
  const done = [tk("A-1", "completed", "Done")];
  assert.equal(sync(base("D-1", "A-1"), done)[0].op, "close");
  assert.equal(sync(accepted("D-1", "A-1"), done)[0].op, "close");
  assert.deepEqual(sync(standFreeDeparted("D-1", "A-1"), [tk("A-1", "completed", "Done", "SURVEY")]), []);
  // sent는 보고가 있어도 arrived가 아니라 close(상태 전이에 없다)
  assert.equal(sync(base("D-1", "A-1"), done, { reports: new Map([["A-1", { pr: 3, result: null }]]) })[0].op, "close");
});

test("동기화: STAND가 이미 있는 accepted의 Done은 depart가 먼저(이 규칙은 비킨다)", () => {
  const out = sync(accepted("D-1", "A-1"), [tk("A-1", "completed", "Done")], { workspaces: [{ path: "/w/x", ticketKey: "A-1" } as Workspace] });
  assert.deepEqual(out.map((o) => o.op), ["depart"]);
});

test("동기화: 끝나지 않은 FLIGHT나 목록에 없는 FLIGHT는 닫지 않는다", () => {
  assert.equal(inFlightDoneOp(fold(accepted("D-1", "A-1"))[0], undefined, { at: iso(0), standNow: false }), null);
  assert.deepEqual(sync(accepted("D-1", "A-1"), [tk("A-1", "started", "In Progress")]).filter((o) => o.op === "close"), []);
  assert.deepEqual(sync(accepted("D-1", "A-1"), []).filter((o) => o.op === "close"), []);
});

test("dispatch arrived: accepted는 STAND 없는 FLIGHT나 STAND를 본 적 없고 보고가 있는 FLIGHT만", () => {
  const acc = fold(accepted("D-1", "A-1"))[0];
  const ctx = { standNow: false, departureSeen: false, report: false };
  assert.equal(arrivedWhyNot(acc, tk("A-1", "started", "In Progress", "SURVEY"), ctx), null); // STAND 없는 FLIGHT
  assert.match(arrivedWhyNot(acc, tk("A-1", "started", "In Progress"), ctx)!, /dispatch report/); // 보고 없음
  assert.equal(arrivedWhyNot(acc, tk("A-1", "started", "In Progress"), { ...ctx, report: true }), null); // 보고 있음
  assert.match(arrivedWhyNot(acc, tk("A-1", "started", "In Progress"), { ...ctx, report: true, standNow: true })!, /LOGBOOK/); // STAND 있음
  assert.match(arrivedWhyNot(acc, tk("A-1", "started", "In Progress"), { ...ctx, report: true, departureSeen: true })!, /LOGBOOK/); // DEPARTURE LOG에 있었음
  // STAND 있는 departed는 거절, STAND 없는 departed는 받는다, sent는 판단하지 않는다(상태 전이가 막는다)
  assert.match(arrivedWhyNot(fold(standDeparted("D-2", "A-2"))[0], undefined, ctx)!, /LOGBOOK/);
  assert.equal(arrivedWhyNot(fold(standFreeDeparted("D-3", "A-3"))[0], undefined, ctx), null);
  assert.equal(canApply(fold(base("D-4", "A-4"))[0], "arrived"), false);
});

test("FOLLOWING: closed 카드는 하루 사유와 함께 따라가고(now를 줄 때만), 지난 것은 뺀다", async () => {
  const { targetsOf } = await import("./following.ts");
  const closed = fold([...accepted("D-1", "A-1"), { op: "close", id: "D-1", at: iso(60), reason: "FLIGHT 상태가 바뀜(Duplicate)" }]);
  const tickets = [tk("A-1", "duplicate", "Duplicate")];
  assert.deepEqual(targetsOf({ proposals: closed, tickets, now: NOW }).map((t) => t.flight), ["A-1"]);
  assert.deepEqual(targetsOf({ proposals: closed, tickets, now: NOW + 25 * 3_600_000 }).map((t) => t.flight), []);
  assert.deepEqual(targetsOf({ proposals: closed, tickets }).map((t) => t.flight), []); // now 없이(routes.ts)는 그대로
});
