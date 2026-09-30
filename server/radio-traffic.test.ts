import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClearanceOp } from "./clearances.ts";
import type { Op } from "./proposals.ts";
import type { CrewChangeOp } from "./crew-change.ts";
import { changedRadio, isOverdue, parseRadioQuery, radioOf, selectRadio, txKey, type RadioInput, type Transmission } from "./radio.ts";
import { RadioFeed } from "./radio-run.ts";

const empty: RadioInput = { clearances: [], proposals: [], crewChanges: [], reports: [], mcc: [], rts: [] };
const T0 = "2026-09-30T10:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const issue = (id: string, min: number, extra: Partial<Extract<ClearanceOp, { op: "issue" }>> = {}): ClearanceOp => ({
  op: "issue", id, at: at(min), to: "s1", toName: "TEAM_G", type: "GO AROUND", stand: null, flight: "ATC-147", text: "Merge origin/main and push.", ...extra,
});
const of = (i: Partial<RadioInput>) => radioOf({ ...empty, ...i });
const byId = (txs: Transmission[], id: string) => txs.find((t) => t.id === id)!;

test("CLEARANCE: 호출은 TOWER, READBACK은 답으로 짝지어지고 open이 풀린다", () => {
  const txs = of({ clearances: [issue("C-0001", 0), { op: "readback", id: "C-0001", at: at(2) }] });
  assert.equal(txs.length, 2);
  const call = byId(txs, "C-0001");
  assert.equal(call.freq, "TOWER");
  assert.equal(call.from, "TOWER");
  assert.equal(call.to, "GOLF (TEAM_G)");
  assert.equal(call.aircraft, "TEAM_G");
  assert.equal(call.head, "TOWER → GOLF · GO AROUND · ATC-147");
  assert.equal(call.body, "Merge origin/main and push.");
  assert.equal(call.open, undefined);
  assert.equal(call.overdueAt, undefined);
  const rb = byId(txs, "C-0001#readback");
  assert.equal(rb.replyTo, "C-0001");
  assert.equal(rb.kind, "READBACK");
  assert.equal(rb.from, "GOLF (TEAM_G)");
  assert.equal(rb.to, "TOWER");
  assert.equal(rb.flight, "ATC-147");
});

test("CLEARANCE: 답이 없으면 open이고 overdueAt은 10분 뒤", () => {
  const [call] = of({ clearances: [issue("C-0001", 0)] });
  assert.equal(call.open, true);
  assert.equal(call.overdueAt, at(10));
  assert.equal(isOverdue(call, Date.parse(at(9))), false);
  assert.equal(isOverdue(call, Date.parse(at(11))), true);
});

test("CLEARANCE: 첫 STANDBY가 overdue를 한 번 다시 세고 열어 둔다", () => {
  const txs = of({ clearances: [issue("C-0001", 0), { op: "standby", id: "C-0001", at: at(4) }, { op: "standby", id: "C-0001", at: at(8) }] });
  const call = byId(txs, "C-0001");
  assert.equal(call.open, true);
  assert.equal(call.overdueAt, at(14));
  assert.equal(byId(txs, "C-0001#standby").replyTo, "C-0001");
});

test("CLEARANCE: UNABLE은 사유를 body로, ROGER는 INFO를 닫고, 취소는 교신이 아니다", () => {
  const txs = of({
    clearances: [
      issue("C-0001", 0),
      { op: "unable", id: "C-0001", at: at(1), reason: "conflict is between two PRs" },
      issue("C-0002", 2, { type: "INFO" }),
      { op: "roger", id: "C-0002", at: at(3) },
      issue("C-0003", 4),
      { op: "cancel", id: "C-0003", at: at(5) },
    ],
  });
  assert.equal(byId(txs, "C-0001#unable").body, "conflict is between two PRs");
  assert.equal(byId(txs, "C-0001").open, undefined);
  assert.equal(byId(txs, "C-0002#roger").kind, "ROGER");
  assert.equal(byId(txs, "C-0002").open, undefined);
  assert.equal(byId(txs, "C-0003").open, undefined);
  assert.equal(txs.filter((t) => t.replyTo).length, 2);
});

test("호출 없는 답은 남기고 orphan으로 표시한다", () => {
  const txs = of({ clearances: [{ op: "readback", id: "C-0099", at: at(0) }] });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].orphan, true);
  assert.equal(txs[0].replyTo, "C-0099");
  assert.equal(txs[0].kind, "READBACK");
});

const create = (id: string, extra: Partial<Extract<Op, { op: "create" }>> = {}) =>
  ({ op: "create", id, at: T0, kind: "ASSIGN", flight: "ATC-170", aircraft: "s1", aircraftName: "TEAM_G", registration: "TEAM_G", airport: "ATCC", score: 1, factors: [], ...extra }) as unknown as Op;

test("FLIGHT PLAN: send는 DELIVERY 호출(문구 그대로), accept는 READBACK, overdue는 10분", () => {
  const msg = "[DISPATCH D-0001] FLIGHT PLAN · GOLF (TEAM_G)\nATC-170";
  const sent = of({ proposals: [create("D-0001"), { op: "send", id: "D-0001", at: at(1), message: msg }] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].freq, "DELIVERY");
  assert.equal(sent[0].from, "OCC");
  assert.equal(sent[0].body, msg);
  assert.equal(sent[0].airport, "ATCC");
  assert.equal(sent[0].head, "OCC → GOLF · FLIGHT PLAN · ATC-170");
  assert.equal(sent[0].open, true);
  assert.equal(sent[0].overdueAt, at(11));
  const done = of({ proposals: [create("D-0001"), { op: "send", id: "D-0001", at: at(1), message: msg }, { op: "accept", id: "D-0001", at: at(2) }] });
  assert.equal(byId(done, "D-0001").open, undefined);
  assert.equal(byId(done, "D-0001#readback").replyTo, "D-0001");
  assert.equal(byId(done, "D-0001#readback").airport, "ATCC");
});

test("FLIGHT PLAN: UNABLE(decline)는 사유가 body, 만료는 답 없이 닫힌다", () => {
  const txs = of({
    proposals: [
      create("D-0001"), { op: "send", id: "D-0001", at: at(1), message: "m" }, { op: "decline", id: "D-0001", at: at(2), reason: "busy" },
      create("D-0002", { flight: "ATC-171" }), { op: "send", id: "D-0002", at: at(3), message: "m" }, { op: "expire", id: "D-0002", at: at(30) },
    ],
  });
  assert.equal(byId(txs, "D-0001#unable").body, "busy");
  assert.equal(byId(txs, "D-0001").open, undefined);
  assert.equal(byId(txs, "D-0002").open, undefined);
  assert.equal(txs.filter((t) => t.replyTo).length, 1);
});

test("RECALL: 호출은 open, READBACK RECALL이 닫고 원래 FLIGHT PLAN도 거둔다", () => {
  const base: Op[] = [create("D-0001"), { op: "send", id: "D-0001", at: at(1), message: "m" }, { op: "accept", id: "D-0001", at: at(2) }, { op: "recall", id: "D-0001", at: at(5), reason: "r", message: "RECALL text" }];
  const open = of({ proposals: base });
  const recall = byId(open, "D-0001#recall");
  assert.equal(recall.kind, "RECALL");
  assert.equal(recall.body, "RECALL text");
  assert.equal(recall.open, true);
  assert.equal(recall.overdueAt, at(15));
  const done = of({ proposals: [...base, { op: "recalled", id: "D-0001", at: at(6) }] });
  assert.equal(byId(done, "D-0001#recall").open, undefined);
  const rb = done.find((t) => t.replyTo === "D-0001#recall")!;
  assert.equal(rb.kind, "READBACK");
  assert.equal(rb.head, "GOLF → OCC · READBACK RECALL · ATC-170");
});

test("FLIGHT PLAN STANDBY는 overdue를 한 번 다시 센다", () => {
  const txs = of({ proposals: [create("D-0001"), { op: "send", id: "D-0001", at: at(0), message: "m" }, { op: "standby", id: "D-0001", at: at(5) }] });
  assert.equal(byId(txs, "D-0001").overdueAt, at(15));
  assert.equal(byId(txs, "D-0001").open, true);
});

test("CREW CHANGE: send는 COMPANY 호출, READBACK이 닫는다", () => {
  const created = { op: "created", id: "CC-0001", registration: "TEAM_G", at: T0 } as unknown as CrewChangeOp;
  const sent: CrewChangeOp = { op: "sent", id: "CC-0001", at: at(1), message: "[OCC CC-0001] CREW CHANGE" };
  const open = of({ crewChanges: [created, sent] });
  assert.equal(open[0].freq, "COMPANY");
  assert.equal(open[0].open, true);
  assert.equal(open[0].overdueAt, at(11));
  const done = of({ crewChanges: [created, sent, { op: "acknowledged", id: "CC-0001", at: at(2) }] });
  assert.equal(byId(done, "CC-0001").open, undefined);
  assert.equal(byId(done, "CC-0001#readback").to, "OCC");
});

test("ARRIVED 보고는 COMPANY, 고정 칸만으로 head를 만든다", () => {
  const txs = of({
    proposals: [create("D-0001")],
    reports: [{ op: "report", flight: "ATC-170", at: at(9), proposal: "D-0001", pr: 252, result: null, tier: "auto", tests: { pass: 5, total: 5 }, discretion: 1, blocked: "none" }],
  });
  assert.equal(txs[0].freq, "COMPANY");
  assert.equal(txs[0].head, "GOLF → OCC · ARRIVED · ATC-170 · PR #252 · TIER auto");
  assert.equal(txs[0].body, undefined);
  assert.equal(txs[0].airport, "ATCC");
});

test("GROUND: MCC INSPECTION·LAND·ESCALATE와 RTS", () => {
  const txs = of({
    mcc: [
      { op: "inspect", at: at(0), pr: 5, head: "abc", verdict: "pass", text: "clean", model: "claude-opus-5-5", p0: 0, p1: 0, p2: 0 },
      { op: "land", at: at(1), pr: 5, head: "abc", tier: "auto", result: "ok" },
      { op: "escalate", at: at(2), pr: 6, head: "def", reason: "guard file" },
      { op: "would-land", at: at(3), pr: 7, head: "x", tier: "auto", result: "ok" },
      { op: "hold", at: at(3), pr: 7 },
      { op: "rts", at: at(4), from: "a", to: "1234567890", result: "started" },
    ],
    rts: [{ at: at(5), from: "a", to: "1234567890", result: "ok" }],
  });
  assert.deepEqual(txs.map((t) => t.kind), ["INSPECTION", "LAND", "ESCALATE", "RTS", "RTS"]);
  assert.ok(txs.every((t) => t.freq === "GROUND" && t.from === "MCC"));
  assert.equal(txs[0].head, "MCC → ALL · INSPECTION · PR #5 · PASS");
  assert.equal(txs[0].body, "clean");
  assert.equal(txs[2].body, "guard file");
  assert.equal(txs[4].head, "MCC → ALL · RTS OK · 1234567");
});

test("같은 시각의 교신: 호출이 답보다 앞, 그다음은 기록 순서", () => {
  const txs = of({
    clearances: [issue("C-0002", 0), { op: "readback", id: "C-0001", at: at(0) }, issue("C-0001", 0), issue("C-0003", 0)],
  });
  // C-0001 issue는 배열에서 readback 뒤에 있지만 호출이므로 답보다 앞
  assert.deepEqual(txs.map((t) => t.id), ["C-0002", "C-0001", "C-0003", "C-0001#readback"]);
});

test("팀 이름이 아닌 수신자는 이름 그대로", () => {
  const [t] = of({ clearances: [issue("C-0001", 0, { toName: "OCC" })] });
  assert.equal(t.to, "OCC");
  assert.equal(t.aircraft, "OCC");
});

test("parseRadioQuery: 기본 6시간·상한, 잘못된 값은 오류", () => {
  const now = Date.parse(T0);
  const d = parseRadioQuery({}, now);
  assert.ok(d.ok && d.query.since === now - 6 * 3_600_000 && d.query.freqs === null && d.query.limit === 2000);
  const q = parseRadioQuery({ since: at(-30), freq: "tower, ground", limit: "5000" }, now);
  assert.ok(q.ok && q.query.since === Date.parse(at(-30)) && q.query.limit === 2000 && [...q.query.freqs!].join() === "TOWER,GROUND");
  for (const bad of [{ since: "x" }, { freq: "UNICOM" }, { limit: "0" }, { limit: "a" }]) assert.equal(parseRadioQuery(bad, now).ok, false);
});

test("selectRadio: since·freq로 거르고 가장 최근 limit개를 오래된 순으로", () => {
  const txs = of({ clearances: [issue("C-0001", 0), issue("C-0002", 10), issue("C-0003", 20)], mcc: [{ op: "escalate", at: at(15), pr: 1, head: "h", reason: "r" }] });
  const now = Date.parse(T0);
  const q = (o: Parameters<typeof parseRadioQuery>[0]) => {
    const p = parseRadioQuery(o, now);
    assert.ok(p.ok);
    return p.ok ? selectRadio(txs, p.query) : [];
  };
  assert.deepEqual(q({ since: at(5) }).map((t) => t.id), ["C-0002", txs.find((t) => t.kind === "ESCALATE")!.id, "C-0003"]);
  assert.deepEqual(q({ since: at(-1), freq: "TOWER", limit: "2" }).map((t) => t.id), ["C-0002", "C-0003"]);
});

test("changedRadio: 새 교신과 답이 붙어 바뀐 호출만", () => {
  const before = of({ clearances: [issue("C-0001", 0)] });
  const seen = new Map(before.map((t) => [t.id, txKey(t)]));
  assert.deepEqual(changedRadio(seen, before), []);
  const after = of({ clearances: [issue("C-0001", 0), { op: "readback", id: "C-0001", at: at(1) }, issue("C-0002", 2)] });
  assert.deepEqual(changedRadio(seen, after).map((t) => t.id), ["C-0001", "C-0001#readback", "C-0002"]);
});

test("RadioFeed: 처음 듣는 이는 과거를 다시 받지 않고, 새것만 받는다", () => {
  let ops: ClearanceOp[] = [issue("C-0001", 0)];
  const feed = new RadioFeed(() => of({ clearances: ops }));
  const got: string[][] = [];
  feed.poll(); // 듣는 이가 없으면 아무것도 하지 않는다
  const off = feed.subscribe((txs) => got.push(txs.map((t) => t.id)));
  feed.poll();
  assert.deepEqual(got, []);
  ops = [...ops, { op: "readback", id: "C-0001", at: at(1) }];
  feed.poll();
  feed.poll();
  assert.deepEqual(got, [["C-0001", "C-0001#readback"]]);
  off();
  ops = [...ops, issue("C-0002", 5)];
  feed.poll();
  assert.equal(got.length, 1);
});
