import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLOSE_AFTER_MISSES, classify, type LeakItem, leakView, leakItemsOf, openFromRecords, reconcile, type OpenLeak } from "./leaks.ts";
import { appendLeaks, readLeaks } from "./leaks-run.ts";
import type { QueueInput } from "./supervisor-queue.ts";

const T0 = Date.parse("2026-10-01T06:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ms = (min: number) => T0 + min * 60_000;
const item = (o: Partial<LeakItem>): LeakItem => ({ kind: "PROPOSAL", key: "P-1", since: at(0), title: "ASSIGN ATC-1 → TEAM_A", hash: "#dispatch", ...o });

test("classify: K3·brake·breaker는 exempt, 나머지는 gate 행과 통제를 단다", () => {
  assert.deepEqual(classify(item({ kind: "GO" })), { leak: false, reason: "K3", gate: "P8" });
  assert.deepEqual(classify(item({ kind: "NEEDS YOU", prompt: true })), { leak: false, reason: "K3", gate: "P7" });
  assert.deepEqual(classify(item({ kind: "LANDING", landWhy: "hold" })), { leak: false, reason: "brake", gate: "L20" });
  assert.deepEqual(classify(item({ kind: "LANDING", landWhy: "user" })), { leak: false, reason: "K3", gate: "L14" });
  assert.deepEqual(classify(item({ raisedBy: "breaker" })), { leak: false, reason: "breaker", gate: null });
  const p = classify(item({}));
  assert.ok(p.leak && p.gate === "P1" && p.control.id === "C14" && !p.control.built);
  const l = classify(item({ title: "LAUNCH ATC-1" }));
  assert.ok(l.leak && l.gate === "P2");
  const n = classify(item({ kind: "NEEDS YOU", prompt: false }));
  assert.ok(n.leak && n.gate === "P7");
  const u = classify(item({ kind: "UPDATE" }));
  assert.ok(u.leak && u.gate === "D1" && u.control.built, "RTS가 있어 통제가 있는 쪽");
  const m = classify(item({ kind: "LANDING", landWhy: "mode" }));
  assert.ok(m.leak && m.gate === "L14");
  const e = classify(item({ kind: "LANDING", landWhy: "escalate" }));
  assert.ok(e.leak && e.gate === "L11");
});

test("reconcile: 열릴 때 한 줄, 그대로면 줄 없음, 연달아 사라져야 닫힌다(깜빡임은 세지 않는다)", () => {
  const open = new Map<string, OpenLeak>();
  const r1 = reconcile(open, [item({ flight: "ATC-1" })], ms(1));
  assert.equal(r1.length, 1);
  assert.equal(r1[0].ev, "open");
  assert.equal(r1[0].release, null);
  assert.equal(reconcile(open, [item({})], ms(2)).length, 0); // 주기마다 쓰지 않는다
  assert.equal(reconcile(open, [], ms(3)).length, 0); // 한 번 안 보임: 아직 안 닫는다
  assert.equal(reconcile(open, [item({})], ms(4)).length, 0); // 돌아옴: 같은 leak
  assert.equal(CLOSE_AFTER_MISSES, 2);
  reconcile(open, [], ms(5));
  const r2 = reconcile(open, [], ms(6));
  assert.equal(r2.length, 1);
  assert.equal(r2[0].ev, "close");
  assert.equal((r2[0] as { heldMin: number }).heldMin, 4, "since(0)부터 마지막으로 본 4분까지");
  assert.equal(open.size, 0);
});

test("reconcile: exempt 항목은 기록하지 않는다", () => {
  const open = new Map<string, OpenLeak>();
  assert.equal(reconcile(open, [item({ kind: "GO", key: "g" })], ms(1)).length, 0);
});

test("reconcile: since를 모르면 처음 본 시각이 시작", () => {
  const open = new Map<string, OpenLeak>();
  const [r] = reconcile(open, [item({ since: null })], ms(7));
  assert.equal(r.ev === "open" && r.since, at(7));
});

test("openFromRecords: 재시작해도 안 닫힌 leak만 되살린다", () => {
  const open = new Map<string, OpenLeak>();
  const recs = [...reconcile(open, [item({ key: "a" }), item({ key: "b" })], ms(1))];
  reconcile(open, [item({ key: "a" })], ms(2));
  recs.push(...reconcile(open, [item({ key: "a" })], ms(3)));
  const x = reconcile(open, [item({ key: "a" })], ms(4));
  assert.equal(x.length, 0);
  const re = openFromRecords([...recs, { v: 1, t: at(9), ev: "close", id: "PROPOSAL|b", since: at(0), heldMin: 9 }], ms(10));
  assert.deepEqual([...re.keys()], ["PROPOSAL|a"]);
});

test("leakView: 7일 창, kind별 분, 통제 있음·없음으로 나눈다", () => {
  const open = new Map<string, OpenLeak>();
  const recs = [
    ...reconcile(open, [item({ key: "a", since: at(0), flight: "ATC-1" }), item({ kind: "UPDATE", key: "u", since: at(0), title: "x → y" })], ms(10)),
  ];
  reconcile(open, [item({ kind: "UPDATE", key: "u", since: at(0), title: "x → y" })], ms(20));
  recs.push(...reconcile(open, [item({ kind: "UPDATE", key: "u", since: at(0), title: "x → y" })], ms(30))); // a는 두 번 안 보여 닫힘
  const v = leakView(recs, ms(40));
  assert.equal(v.totals.count, 2);
  assert.equal(v.totals.openNow, 1);
  assert.equal(v.missing.length, 1);
  assert.equal(v.missing[0].kind, "PROPOSAL");
  assert.equal(v.missing[0].heldMin, 10, "닫힌 leak: since(0)~마지막으로 본 10분");
  assert.deepEqual(v.missing[0].work, ["ATC-1"]);
  assert.equal(v.exists.length, 1);
  assert.equal(v.exists[0].heldMin, 40, "열린 leak: since부터 지금까지");
  // 창 밖(8일 전에 열린 것)은 세지 않는다
  assert.equal(leakView(recs, ms(40) + 8 * 86_400_000).totals.count, 0);
});

test("leakItemsOf: FLIGHT와 착륙 이유, 승인 프롬프트를 붙인다", () => {
  const inp = {
    proposals: [{ id: "P-1", kind: "ASSIGN", status: "proposed", flight: "ATC-9", aircraftName: null, holdAt: null, statusAt: at(0), awaitSupervisor: null, undelivered: null }],
    schedule: { mode: "approval", ops: [] },
    pulls: [{ repo: "/x/atc", number: 5, head: "abc", draft: false, landing: "CLEARED", humanCheck: null, ticketKey: "ATC-5", landBy: "supervisor", landWhy: "mode" }],
    sessions: [{ id: "s1", name: "TEAM_A", job: { needs: "approve Write: x" } }],
  } as unknown as QueueInput;
  const out = leakItemsOf(
    [
      { kind: "PROPOSAL", key: "P-1", since: null, title: "t", hash: "" },
      { kind: "LANDING", key: "atc#5@abc", since: null, title: "t", hash: "" },
      { kind: "NEEDS YOU", key: "s1", since: null, title: "t", hash: "" },
    ],
    inp,
  );
  assert.equal(out[0].flight, "ATC-9");
  assert.equal(out[1].flight, "ATC-5");
  assert.equal(out[1].landWhy, "mode");
  assert.equal(out[2].prompt, true);
});

test("읽기·추가: 임시 파일에 줄만 더하고, 깨진 줄은 건너뛴다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-leaks-"));
  try {
    const f = join(dir, "sub", "leaks.jsonl");
    assert.deepEqual(readLeaks(f), []);
    const open = new Map<string, OpenLeak>();
    appendLeaks(reconcile(open, [item({})], ms(1)), f);
    appendLeaks([], f);
    assert.equal(readLeaks(f).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
