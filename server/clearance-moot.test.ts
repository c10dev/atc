import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { type FlightPr, listedEvents, type MootEvent, mootClearancesOf, mootCounterOf, newMisfires } from "./clearance-moot.ts";
import type { Clearance } from "./model.ts";

// ATC-515: 이유를 잃은 CLEARANCE를 서버가 고르는 순수 함수, MISFIRE 셈, 관제 매뉴얼의 문구
const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const H = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const clr = (id: string, flight: string | null, over: Partial<Clearance> = {}): Clearance => ({ id, at: ago(2 * H), to: "s1", toName: "TEAM_P", type: "HOLD", stand: null, flight, text: "x", readbackAt: null, cancelledAt: null, ...over });
const pr = (flight: string, number: number, state: FlightPr["state"], at: string | undefined = ago(H)): FlightPr => ({ flight, number, state, at });

test("two open CLEARANCEs on FLIGHTs whose PRs are all merged are both picked (the C-0416 / C-0716 shape)", () => {
  const picked = mootClearancesOf([clr("C-0416", "VOC-300"), clr("C-0716", "VOC-228")], [pr("VOC-300", 10, "merged"), pr("VOC-228", 11, "merged"), pr("VOC-228", 12, "closed")], "on");
  assert.deepEqual(picked.map((c) => c.id), ["C-0416", "C-0716"]);
});

test("not picked: no FLIGHT, FLIGHT without a PR, an open PR beside a merged one, an already closed CLEARANCE", () => {
  const prs = [pr("A-1", 1, "merged"), pr("A-1", 2, "open"), pr("A-3", 3, "merged")];
  const list = [
    clr("C-1", null),
    clr("C-2", "A-2"), // no PR yet
    clr("C-3", "A-1"), // one PR still open
    clr("C-4", "A-3", { readbackAt: ago(H) }),
    clr("C-5", "A-3", { unableAt: ago(H) }),
    clr("C-6", "A-3", { cancelledAt: ago(H) }),
    clr("C-7", "A-3"), // picked
  ];
  assert.deepEqual(mootClearancesOf(list, prs, "on").map((c) => c.id), ["C-7"]);
});

test("not picked: a CLEARANCE sent after the last merge (follow-up work), or when no merge time is known", () => {
  const after = clr("C-1", "A-1", { at: ago(H / 2) }); // merge was 1 h ago
  const noTime = clr("C-2", "A-2");
  const before = clr("C-3", "A-1", { at: ago(2 * H) });
  assert.deepEqual(mootClearancesOf([after, noTime, before], [pr("A-1", 1, "merged"), { flight: "A-2", number: 2, state: "merged" }], "on").map((c) => c.id), ["C-3"]);
});

test("with the switch off nothing is picked and the counter does not move", () => {
  const c = clr("C-1", "A-1", { cancelledAt: ago(H) });
  const again = clr("C-2", "A-1", { at: ago(H / 2) });
  assert.deepEqual(mootClearancesOf([clr("C-9", "A-1")], [pr("A-1", 1, "merged")], "off"), []);
  const events: MootEvent[] = [{ op: "listed", t: ago(2 * H), id: "C-1", flight: "A-1", prs: [1] }];
  assert.deepEqual(newMisfires(events, [c, again], [], NOW, "off"), []);
  assert.equal(mootCounterOf(events, [c, again]).misfires, 0);
});

test("listed events are written once per id", () => {
  const picked = [clr("C-1", "A-1")];
  const first = listedEvents(picked, [pr("A-1", 7, "merged")], [], NOW);
  assert.deepEqual(first.map((e) => [e.op, e.id]), [["listed", "C-1"]]);
  assert.deepEqual(listedEvents(picked, [pr("A-1", 7, "merged")], first, NOW), []);
});

test("misfire: a new CLEARANCE on the same FLIGHT within 24 h of the cancel counts one; a later one does not", () => {
  const listed: MootEvent[] = [{ op: "listed", t: ago(30 * H), id: "C-1", flight: "A-1", prs: [1] }];
  const cancelled = clr("C-1", "A-1", { cancelledAt: ago(26 * H) });
  const within = clr("C-2", "A-1", { at: ago(10 * H) }); // 16 h after the cancel
  const later = clr("C-3", "A-1", { at: ago(1 * H) }); // 25 h after the cancel
  const other = clr("C-4", "B-1", { at: ago(10 * H) });
  assert.deepEqual(newMisfires(listed, [cancelled, within], [], NOW, "on").map((e) => [e.id, e.op === "misfire" && e.why]), [["C-1", "new-clearance"]]);
  assert.deepEqual(newMisfires(listed, [cancelled, later, other], [], NOW, "on"), []);
});

test("misfire: a listed PR reopened after the cancel counts one; not-cancelled and already-counted ones do not", () => {
  const listed: MootEvent[] = [{ op: "listed", t: ago(5 * H), id: "C-1", flight: "A-1", prs: [1] }];
  const cancelled = clr("C-1", "A-1", { cancelledAt: ago(4 * H) });
  const reopened = [pr("A-1", 1, "open")];
  const hit = newMisfires(listed, [cancelled], reopened, NOW, "on");
  assert.deepEqual(hit.map((e) => e.op === "misfire" && e.why), ["reopened"]);
  assert.deepEqual(newMisfires(listed, [clr("C-1", "A-1")], reopened, NOW, "on"), []); // not cancelled
  assert.deepEqual(newMisfires([...listed, ...hit], [cancelled], reopened, NOW, "on"), []); // already counted
  assert.deepEqual(newMisfires(listed, [cancelled], [pr("A-1", 99, "open")], NOW, "on"), []); // a different PR
  assert.deepEqual(mootCounterOf([...listed, ...hit], [cancelled]), { listed: 1, cancelled: 1, misfires: 1 });
});

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("TOWER manual: a team's READBACK wait is no reason to stop; 'report to the SUPERVISOR' rows are ATC LOG reports", () => {
  for (const f of ["controller/CLAUDE.md", "controller/CLAUDE.en.md"]) {
    const t = read(f);
    assert.match(t, /ATC-515/);
    assert.match(t, /clearances\.moot/);
    assert.match(t, /atcctl\.mjs cancel <id>/);
  }
  const ko = read("controller/CLAUDE.md");
  assert.match(ko, /팀의 답을 기다리는 것도 멈출 이유가 아니다/);
  assert.match(ko, /"SUPERVISOR에게 보고"는 \*\*ATC LOG에 적는 보고\*\*/);
  assert.match(ko, /ATC LOG로 SUPERVISOR에게 보고하고 턴을 평소처럼 끝낸다/);
  const en = read("controller/CLAUDE.en.md");
  assert.match(en, /Waiting for a team's reply is not a reason to stop either/);
  assert.match(en, /"Report to the SUPERVISOR" in the table above is a \*\*report in the ATC LOG\*\*/);
});

test("MCC manual: waiting for the SUPERVISOR to merge is no reason to stop; 'report to the SUPERVISOR' lines are MCC LOG reports", () => {
  const ko = read("mcc/CLAUDE.md");
  assert.match(ko, /SUPERVISOR의 머지를 기다리는 것도 이 규칙의 예외가 아니다/);
  assert.match(ko, /`user` 등급 PR이나 ESCALATE한 PR은 이미 SUPERVISOR QUEUE에 있다/);
  assert.match(ko, /"SUPERVISOR에게 보고"는 \*\*MCC LOG에 적는 보고\*\*/);
  assert.match(ko, /MCC LOG로 SUPERVISOR에게 보고한다\(멈출 이유가 아니다/);
  const en = read("mcc/CLAUDE.en.md");
  assert.match(en, /Waiting for the SUPERVISOR to merge a PR is no exception to this rule either/);
  assert.match(en, /"Report to the SUPERVISOR" anywhere in this manual is a \*\*report in the MCC LOG\*\*/);
});
