import assert from "node:assert/strict";
import { test } from "node:test";
import { pullKey } from "./landing.ts";
import { type MigrateRecord, otherReasonOf, type PassIo, rehearsalHeld, rehearsalPass } from "./migrate-run.ts";
import { classify, declarationCheck } from "./migration-declare.ts";
import { hostedDbOf, type MigrationGate } from "./migration-gate.ts";
import type { RunResult } from "./migration-rehearsal.ts";
import type { PullRequest, Snapshot } from "./model.ts";

test("SECURITY DEFINER가 긴 달러 본문 뒤에 와도 sensitive로 본다", () => {
  const sql = `create function f() returns int as $$ ${"select 1; ".repeat(60)} $$ language sql security definer`;
  assert.equal(classify(sql).kind, "sensitive");
  assert.equal(classify("create function g() returns text as $$ select 'security definer' $$ language sql").kind, "additive");
});

const GATE_WHY = "보안 게이트: … — 마이그레이션 게이트: 호스티드 DB에 아직 없는 마이그레이션 1개";
const DB = hostedDbOf({ provider: "supabase", projectRef: "abcd1234", testProjectRef: "wxyz5678" })!;
const PR = { repo: "/r", number: 7, head: "h1", url: "https://github.com/o/n/pull/7", landing: "CLEARED", draft: false, ticketKey: "ATC-9" } as unknown as PullRequest;
const GATE_MISSING: MigrationGate = { involved: true, ok: false, reason: "x", versions: ["1"], missing: ["1"], paths: ["m/1_a.sql"] };
const APPLIED = { status: "applied", steps: [], failedStep: null, restorePoint: null } as RunResult;

interface Over {
  exclusion?: string | null;
  gate?: MigrationGate;
  switches?: Record<string, boolean>;
  tried?: boolean;
  other?: string | null;
  result?: RunResult | null;
  mode?: string;
  stopped?: boolean;
  state?: string; // FLIGHT의 상태 종류(기본 unstarted)
}
function pass(over: Over = {}) {
  const calls = { rehearse: 0, held: 0, noted: [] as { result?: string }[], revoked: [] as string[] };
  const s = { airports: [{ id: "a", code: "ATCC", name: "n", repo: "/r" }], pulls: [PR], tickets: [{ key: "ATC-9", stateType: over.state ?? "unstarted" }], autoland: { exclusions: { [pullKey(PR)]: over.exclusion === undefined ? GATE_WHY : over.exclusion } } } as unknown as Snapshot;
  const io: PassIo = {
    switches: () => over.switches ?? { ATCC: true },
    hostedDb: () => DB,
    token: () => "tok",
    records: () => (over.tried ? [{ kind: "run", slug: "o/n", number: 7, head: "h1" } as MigrateRecord] : []),
    gate: async () => over.gate ?? GATE_MISSING,
    rehearse: async () => {
      calls.rehearse++;
      return over.result === undefined ? APPLIED : over.result;
    },
    note: (r) => void calls.noted.push(r),
    revoke: (flight) => void calls.revoked.push(flight),
  };
  const run = () =>
    rehearsalPass(s, { mode: over.mode ?? "merge", airports: ["ATCC"], stopped: () => over.stopped === true, otherExclusion: async () => over.other ?? null, hold: () => void calls.held++ }, io);
  return { calls, run };
}

test("rehearsalPass: 스위치·모드·GROUND STOP·시도한 head·다른 제외·게이트 재확인을 모두 통과해야 돈다", async () => {
  const ok = pass();
  await ok.run();
  assert.deepEqual([ok.calls.rehearse, ok.calls.held, ok.calls.noted[0]?.result], [1, 0, "ok"]);
  const blocked: Over[] = [{ switches: {} }, { mode: "update" }, { stopped: true }, { tried: true }, { exclusion: "HOLD" }, { exclusion: null }, { other: "HUMAN CHECK" }, { gate: { ...GATE_MISSING, missing: [] } }, { gate: { ...GATE_MISSING, involved: false } }];
  for (const over of blocked) {
    const x = pass(over);
    await x.run();
    assert.equal(x.calls.rehearse, 0, JSON.stringify(over));
  }
});

test("otherReasonOf: head가 움직였으면 사유가 된다(낡은 head의 SQL을 적용하지 않는다)", () => {
  assert.match(otherReasonOf({ moved: "abcdef0123", why: null })!, /head가 움직임\(abcdef0\)/);
  assert.equal(otherReasonOf({ moved: null, why: null }), null);
  assert.equal(otherReasonOf({ moved: null, why: "HUMAN CHECK" }), "HUMAN CHECK");
});

test("rehearsalHeld: 마지막 run이 applied가 아닌 head만(st.skip이 잘려도 남는 기록)", () => {
  const run = (head: string, status: string) => ({ kind: "run", slug: "o/n", number: 7, head, status }) as MigrateRecord;
  assert.equal(rehearsalHeld([run("h1", "live-changed")], "o/n", 7, "h1"), true);
  assert.equal(rehearsalHeld([run("h1", "stopped")], "o/n", 7, "h1"), true);
  assert.equal(rehearsalHeld([run("h1", "applied")], "o/n", 7, "h1"), false);
  assert.equal(rehearsalHeld([run("h1", "stopped"), run("h1", "applied")], "o/n", 7, "h1"), false);
  assert.equal(rehearsalHeld([run("h1", "stopped")], "o/n", 7, "h2"), false);
  assert.equal(rehearsalHeld([], "o/n", 7, "h1"), false);
});

test("선언 검사: 파일 중간의 COMMIT·BEGIN은 멈추고, 맨 앞 BEGIN·맨 뒤 COMMIT은 통과한다", () => {
  const K1 = "K1: adds public.t";
  const f = (sql: string) => [{ path: "m/1_a.sql", sql }];
  assert.equal(declarationCheck(f("begin; create table public.t (a int); commit;"), K1).ok, true);
  const mid = declarationCheck(f("begin; create table public.t (a int); commit; begin; create table public.u (a int); commit;"), K1);
  assert.equal(mid.ok, false);
  assert.match(mid.stopped[0]!.why, /트랜잭션 문장/);
  assert.equal(declarationCheck(f("create table public.t (a int); commit; create table public.u (a int);"), K1).ok, false);
});

test("선언 검사: CREATE EXTENSION은 선언이 extension을 적어야 통과한다", () => {
  const f = [{ path: "m/1_a.sql", sql: 'create extension if not exists "pgcrypto";' }];
  assert.equal(declarationCheck(f, "K1: adds public.t").ok, false);
  assert.equal(declarationCheck(f, "K1: adds extension pgcrypto").ok, true);
});

test("rehearsalPass: 멈추면(live-changed 포함) 이 head는 머지 후보에서 뺀다", async () => {
  for (const status of ["stopped", "live-changed"] as const) {
    const x = pass({ result: { status, steps: [], failedStep: "post-check", restorePoint: "PITR t" } });
    await x.run();
    assert.equal(x.calls.held, 1, status);
    assert.equal(x.calls.noted[0]?.result, status === "live-changed" ? "failed" : "excluded");
  }
  const none = pass({ result: null });
  await none.run();
  assert.equal(none.calls.held, 1);
});

test("rehearsalPass: 멈춘 FLIGHT의 발권은 Todo(unstarted)일 때만 거둔다", async () => {
  const stopped = { status: "stopped", steps: [{ step: "rehearsal", ok: false, detail: "boom", at: "t" }], failedStep: "rehearsal", restorePoint: null } as RunResult;
  const todo = pass({ result: stopped });
  await todo.run();
  assert.deepEqual(todo.calls.revoked, ["ATC-9"]);
  const flying = pass({ result: stopped, state: "started" });
  await flying.run();
  assert.deepEqual(flying.calls.revoked, []);
  assert.equal(flying.calls.held, 1, "머지 후보에서는 어느 경우에도 뺀다");
  const ok = pass();
  await ok.run();
  assert.deepEqual(ok.calls.revoked, []);
});
