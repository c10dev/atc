import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyStatements, classify, declarationCheck, splitStatements } from "./migration-declare.ts";
import { applySql, catalogDiff, type MigrationFile, type RehearsalIo, rehearse, type Row, type SqlRunner } from "./migration-rehearsal.ts";
import { hostedDbOf } from "./migration-gate.ts";
import { redact, restorePointOf, supabaseRunner } from "./sources/supabase-sql.ts";
import { notReadyWhy } from "./migrate-config.ts";

const K1 = "* K1: adds table public.songs and a function; backfills public.settings";

test("문장 나누기: 따옴표·달러 본문·주석 안의 세미콜론은 나누지 않는다", () => {
  const sql = `-- a; b\ncreate table t (a text default 'x;y');\ncreate function f() returns void as $$ begin perform 1; end; $$ language plpgsql;\n/* c; */ select 1`;
  assert.equal(splitStatements(sql).length, 3);
});

test("분류: 추가형, DML, 파괴적, 분류 불가", () => {
  assert.equal(classify("create table public.songs (id int)").kind, "additive");
  assert.equal(classify("alter table public.songs add column x int").kind, "additive");
  assert.equal(classify("create or replace function f() returns int as $$ select 1 $$ language sql").kind, "additive");
  assert.equal(classify("grant select on public.songs to anon").kind, "additive");
  assert.equal(classify("insert into public.settings (k) values ('a')").kind, "dml");
  for (const s of ["drop table t", "truncate t", "revoke all on t from anon", "alter table t drop column c", "alter table t rename to u", "alter table t alter column c type bigint", "delete from t", "update t set a = 1"])
    assert.equal(classify(s).kind, "destructive", s);
  assert.equal(classify("update t set a = 1 where id = 2").kind, "dml");
  assert.equal(classify("vacuum t").kind, "unknown");
  assert.equal(classify("begin").kind, "txn");
});

const f = (sql: string) => [{ path: "m/1_a.sql", sql }];

test("선언 검사: K1이 없으면 멈춘다", () => {
  assert.equal(declarationCheck(f("create table t (a int);"), "K3 only").ok, false);
  assert.equal(declarationCheck(f("create table t (a int);"), "").stopped[0]!.why, "K1 효과가 선언되지 않음");
});

test("선언 검사: 선언한 추가형과 선언한 표의 DML은 통과, 선언에 없는 DML과 파괴적 문장은 멈춘다", () => {
  assert.equal(declarationCheck(f("begin; create table public.songs (id int); insert into public.settings (k) values ('a'); commit;"), K1).ok, true);
  const bad = declarationCheck(f("insert into public.other (k) values ('a');"), K1);
  assert.equal(bad.ok, false);
  assert.match(bad.stopped[0]!.why, /선언에 없는 DML/);
  assert.equal(declarationCheck(f("drop table public.songs;"), K1).ok, false);
  assert.equal(declarationCheck(f("update public.settings set k = 1;"), K1).ok, false);
  assert.equal(declarationCheck(f("vacuum;"), K1).ok, false);
  assert.equal(declarationCheck(f("-- only a comment"), K1).ok, false);
});

test("적용 SQL: 파일의 BEGIN·COMMIT을 떼고 한 트랜잭션에 버전 줄을 같이 넣는다", () => {
  assert.deepEqual(bodyStatements("begin;\ncreate table t (a int);\ncommit;"), ["create table t (a int)"]);
  const file: MigrationFile = { path: "m/20260101_add_t.sql", version: "20260101", name: "add_t", sql: "begin; create table t (a int); commit;" };
  assert.equal(applySql(file), "begin;\ncreate table t (a int);\ninsert into supabase_migrations.schema_migrations (version, name) values ('20260101', 'add_t');\ncommit;");
});

// ── 가짜 DB ──
const FILES: MigrationFile[] = [{ path: "m/20260101_add_t.sql", version: "20260101", name: "add_t", sql: "create table public.songs (id int);" }];
interface FakeOpts {
  declared?: string | null;
  testVersions?: string[];
  liveVersions?: string[];
  failTest?: boolean;
  failLive?: boolean;
  liveCatalog?: Row[];
  testCatalog?: Row[];
  restore?: () => Promise<string>;
  healthy?: boolean;
}
function fake(o: FakeOpts = {}) {
  const calls: { db: "test" | "live"; sql: string }[] = [];
  const testV = [...(o.testVersions ?? ["1"])];
  const liveV = [...(o.liveVersions ?? ["1"])];
  const runner = (db: "test" | "live"): SqlRunner => ({
    async query(sql) {
      calls.push({ db, sql });
      if (sql.includes("schema_migrations order by")) return (db === "test" ? testV : liveV).map((version) => ({ version }));
      if (sql.startsWith("begin;") && ((db === "test" && o.failTest) || (db === "live" && o.failLive))) throw new Error("boom");
      const v = /values \('(\d+)'/.exec(sql)?.[1];
      if (v) (db === "test" ? testV : liveV).push(v); // 적용하면 버전 줄이 생긴다
      if (sql.includes("pg_proc")) return db === "test" ? o.testCatalog ?? [{ k: "fn", n: "f()", h: "a" }] : o.liveCatalog ?? [{ k: "fn", n: "f()", h: "a" }];
      return [];
    },
  });
  const io: RehearsalIo = {
    now: () => "t",
    declared: async () => (o.declared === undefined ? K1 : o.declared),
    test: runner("test"),
    live: runner("live"),
    restorePoint: o.restore ?? (async () => "PITR t"),
    smoke: [{ name: "songs", sql: "select 1 as x", expectRows: false }],
    ...(o.healthy === undefined ? {} : { health: async () => o.healthy! }),
  };
  return { io, calls, liveWrites: () => calls.filter((c) => c.db === "live" && c.sql.startsWith("begin;")).length };
}

test("리허설: 모두 통과하면 순서대로 적용되고 실전에 한 번 쓴다", async () => {
  const x = fake();
  const r = await rehearse(FILES, x.io);
  assert.equal(r.status, "applied");
  assert.deepEqual(r.steps.map((s) => s.step), ["declaration", "rehearsal", "restore-point", "live-apply", "post-check"]);
  assert.equal(x.liveWrites(), 1);
  assert.equal(r.restorePoint, "PITR t");
});

test("리허설: 선언 검사가 실패하면 시험·실전 DB를 건드리지 않는다", async () => {
  for (const declared of [null, "K3 only"]) {
    const x = fake({ declared });
    const r = await rehearse(FILES, x.io);
    assert.equal(r.status, "stopped");
    assert.equal(r.failedStep, "declaration");
    assert.equal(x.calls.length, 0);
  }
});

test("리허설: 시험 DB가 실전과 다른 버전이거나 시험 적용이 실패하면 실전에 쓰지 않는다", async () => {
  const stale = fake({ testVersions: ["1", "0"] });
  assert.equal((await rehearse(FILES, stale.io)).failedStep, "rehearsal");
  assert.equal(stale.liveWrites(), 0);
  const failing = fake({ failTest: true });
  const r = await rehearse(FILES, failing.io);
  assert.deepEqual([r.status, r.failedStep], ["stopped", "rehearsal"]);
  assert.equal(failing.liveWrites(), 0);
  const dup = fake({ liveVersions: ["1", "20260101"], testVersions: ["1", "20260101"] });
  assert.match((await rehearse(FILES, dup.io)).steps.at(-1)!.detail, /이미 실전에 적용/);
});

test("리허설: 복원점을 못 만들면 실전에 쓰지 않는다", async () => {
  const x = fake({ restore: async () => { throw new Error("no backup"); } });
  const r = await rehearse(FILES, x.io);
  assert.deepEqual([r.status, r.failedStep], ["stopped", "restore-point"]);
  assert.equal(x.liveWrites(), 0);
});

test("리허설: 실전 적용이 첫 파일에서 실패하면 실전은 그대로(stopped), 뒤 파일에서 실패하면 live-changed", async () => {
  const first = fake({ failLive: true });
  assert.equal((await rehearse(FILES, first.io)).status, "stopped");
  const two: MigrationFile[] = [...FILES, { path: "m/20260102_b.sql", version: "20260102", name: "b", sql: "create table public.songs2 (id int);" }];
  let n = 0;
  const x = fake();
  const origQuery = x.io.live.query.bind(x.io.live);
  x.io.live.query = async (sql) => {
    if (sql.startsWith("begin;") && ++n === 2) throw new Error("boom");
    return origQuery(sql);
  };
  const r = await rehearse(two, x.io);
  assert.deepEqual([r.status, r.failedStep], ["live-changed", "live-apply"]);
  assert.equal(r.restorePoint, "PITR t");
});

test("리허설: 적용 뒤 함수 본문·grant가 시험 DB와 다르거나 앱이 건강하지 않으면 live-changed", async () => {
  const diff = await rehearse(FILES, fake({ liveCatalog: [{ k: "fn", n: "f()", h: "b" }] }).io);
  assert.deepEqual([diff.status, diff.failedStep], ["live-changed", "post-check"]);
  const sick = await rehearse(FILES, fake({ healthy: false }).io);
  assert.deepEqual([sick.status, sick.failedStep], ["live-changed", "post-check"]);
  assert.equal((await rehearse(FILES, fake({ healthy: true }).io)).status, "applied");
});

test("카탈로그 비교: 한쪽에만 있는 것을 센다", () => {
  const d = catalogDiff([{ k: "grant", n: "a", h: "" }], [{ k: "grant", n: "b", h: "" }]);
  assert.deepEqual([d.same, d.onlyTest.length, d.onlyLive.length], [false, 1, 1]);
});

// ── 비밀과 설정 ──
test("redact: 토큰과 Bearer 값을 지운다", () => {
  assert.equal(redact("fail sbp_secret123 here Bearer sbp_secret123", "sbp_secret123"), "fail [redacted] here Bearer [redacted]");
});

test("SqlRunner: 실패 메시지에 토큰이 없다(가짜 fetch)", async () => {
  const run = supabaseRunner("abcd1234", "sbp_tok", (async () => new Response("denied for sbp_tok", { status: 401 })) as typeof fetch);
  await assert.rejects(run.query("select 1"), (e: Error) => !e.message.includes("sbp_tok") && /HTTP 401/.test(e.message));
  const ok = supabaseRunner("abcd1234", "sbp_tok", (async (_u: unknown, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer sbp_tok");
    return new Response(JSON.stringify([{ a: 1 }]), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(await ok.query("select 1"), [{ a: 1 }]);
  await assert.rejects(supabaseRunner("abcd1234", "").query("select 1"), /토큰/);
});

test("복원점: PITR이면 지금, 아니면 최근 완료 백업, 없거나 오래되면 던진다", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  assert.match(restorePointOf({ pitr_enabled: true }, now, 24), /^PITR /);
  assert.match(restorePointOf({ backups: [{ status: "COMPLETED", inserted_at: "2026-10-02T06:00:00Z" }] }, now, 24), /^backup /);
  assert.throws(() => restorePointOf({ backups: [{ status: "COMPLETED", inserted_at: "2026-09-30T06:00:00Z" }] }, now, 24), /오래됨/);
  assert.throws(() => restorePointOf({ backups: [] }, now, 24), /백업도 없음/);
  assert.throws(() => restorePointOf(null, now, 24), /읽지 못함/);
});

test("hostedDb 리허설 칸: 모양이 맞는 것만 받고, 준비 여부를 가린다", () => {
  const db = hostedDbOf({ provider: "supabase", projectRef: "abcd1234", testProjectRef: "wxyz5678", smoke: [{ name: "a", sql: "select 1", expectRows: true }, { name: "", sql: 3 }], healthUrl: "http://x", maxBackupAgeHours: 12 })!;
  assert.equal(db.testProjectRef, "wxyz5678");
  assert.equal(db.smoke?.length, 1);
  assert.equal(db.healthUrl, undefined);
  assert.equal(db.maxBackupAgeHours, 12);
  assert.equal(hostedDbOf({ provider: "supabase", projectRef: "abcd1234", testProjectRef: "abcd1234" })!.testProjectRef, undefined);
  assert.equal(notReadyWhy(db, "tok"), null);
  assert.match(notReadyWhy(db, "")!, /토큰/);
  assert.match(notReadyWhy(hostedDbOf({ provider: "supabase", projectRef: "abcd1234" }), "tok")!, /시험 DB/);
  assert.match(notReadyWhy(null, "tok")!, /hostedDb/);
});
