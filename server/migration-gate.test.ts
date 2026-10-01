import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeExclusionOf, type MergeExclusionInput } from "./autoland.ts";
import { hostedDbOf, migrationGateOf, type HostedDb } from "./migration-gate.ts";
import { hostedDbReadOn, readAppliedVersions, versionsOf } from "./sources/supabase-migrations.ts";

// ATC-329: 새 마이그레이션은 호스티드 DB에 이미 적혀 있을 때만 위임된다. 시험은 가짜 ref·가짜 응답만 쓴다.

const DB: HostedDb = { provider: "supabase", projectRef: "testproject01", migrationsDir: "supabase/migrations" };
const M1 = "supabase/migrations/20261001000001_add_notes.sql";
const M2 = "supabase/migrations/20261001000002_add_tags.sql";
const gate = (over: Partial<Parameters<typeof migrationGateOf>[0]> = {}) =>
  migrationGateOf({ hostedDb: DB, files: [M1, M2, "src/app.ts"], added: [M1, M2], applied: ["20261001000001", "20261001000002", "20200101000000"], ...over });

test("all applied: gate ok", () => {
  const g = gate();
  assert.deepEqual([g.involved, g.ok, g.reason], [true, true, null]);
  assert.deepEqual(g.versions, ["20261001000001", "20261001000002"]);
});

test("one missing: excluded", () => {
  const g = gate({ applied: ["20261001000001"] });
  assert.equal(g.ok, false);
  assert.deepEqual(g.missing, ["20261001000002"]);
});

test("read failure (null) is unknown, so excluded", () => {
  const g = gate({ applied: null });
  assert.equal(g.involved, true);
  assert.equal(g.ok, false);
});

test("edited existing migration is excluded even when its version is applied", () => {
  const g = gate({ added: [M1] });
  assert.equal(g.ok, false);
  assert.match(g.reason ?? "", /수정/);
  assert.equal(gate({ added: null }).ok, false); // 새 파일인지 모르면 제외
  assert.equal(gate({ files: [M1, "supabase/migrations/notes.sql"], added: [M1, "supabase/migrations/notes.sql"] }).ok, false); // 형식 밖 이름
});

test("no migration files: gate not involved", () => {
  const g = gate({ files: ["src/app.ts"], added: [], applied: null });
  assert.deepEqual([g.involved, g.ok], [false, true]);
});

test("hostedDb unset: gate not involved, whatever the files", () => {
  assert.equal(gate({ hostedDb: null }).involved, false);
});

test("hostedDbOf: defaults and bad shapes", () => {
  assert.deepEqual(hostedDbOf({ provider: "supabase", projectRef: "testproject01" }), DB);
  assert.equal(hostedDbOf({ provider: "supabase", projectRef: "testproject01", migrationsDir: "db/m/" })?.migrationsDir, "db/m");
  for (const bad of [null, {}, { provider: "other", projectRef: "testproject01" }, { provider: "supabase", projectRef: "A B" }, { provider: "supabase", projectRef: "testproject01", migrationsDir: "../x" }]) assert.equal(hostedDbOf(bad), null);
});

const base: MergeExclusionInput = {
  held: false,
  flight: "APP-7",
  ticketLabels: [],
  prLabels: [],
  files: [M1, "src/app.ts"],
  title: "Add notes",
  body: "## UI change\n\n- UI impact: `none`\n- Human check class (any that apply): `none`\n- Human check: `not needed`",
  flightTitle: "Add notes",
  head: "a".repeat(40),
  reviewedSecurity: "delegate",
  mergeReviewPass: true,
};
const g1 = (applied: string[] | null, files = [M1, "src/app.ts"]) => gate({ files, added: [M1], applied });

test("mergeExclusionOf: migration PR delegated only with an ok gate; unset hostedDb is as before", () => {
  assert.match(mergeExclusionOf(base) ?? "", /마이그레이션·SQL 경로/); // hostedDb 없음 = 오늘과 같다
  assert.equal(mergeExclusionOf({ ...base, migrationGate: g1(["20261001000001"]) }), null);
  assert.match(mergeExclusionOf({ ...base, migrationGate: g1([]) }) ?? "", /마이그레이션 게이트/);
  assert.match(mergeExclusionOf({ ...base, migrationGate: g1(null) }) ?? "", /못 읽음/);
  // 게이트가 맡지 않은 SQL 경로가 같이 있으면 그대로 막는다
  const files = [M1, "db/seed.sql"];
  assert.match(mergeExclusionOf({ ...base, files, migrationGate: g1(["20261001000001"], files) }) ?? "", /db\/seed\.sql/);
  // 위임이 꺼져 있으면 게이트가 ok여도 풀지 않는다
  assert.notEqual(mergeExclusionOf({ ...base, reviewedSecurity: "off", migrationGate: g1(["20261001000001"]) }), null);
});

test("supabase read: GET only, versions parsed, every failure is null, disabled without a call", async () => {
  const calls: { url: string; method?: string }[] = [];
  const ok = (async (url: string, init?: RequestInit) => (calls.push({ url, method: init?.method }), new Response(JSON.stringify([{ version: "20261001000001", name: "a" }]), { status: 200 }))) as unknown as typeof fetch;
  assert.deepEqual(await readAppliedVersions(DB, { token: "t", enabled: true, fetchFn: ok }), ["20261001000001"]);
  assert.deepEqual(calls.map((c) => c.method), ["GET"]);
  assert.match(calls[0].url, /\/v1\/projects\/testproject01\/database\/migrations$/);
  const boom = (async () => {
    throw new Error("net");
  }) as unknown as typeof fetch;
  assert.equal(await readAppliedVersions(DB, { token: "t", enabled: true, fetchFn: boom }), null);
  const bad = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  assert.equal(await readAppliedVersions(DB, { token: "t", enabled: true, fetchFn: bad }), null);
  assert.equal(await readAppliedVersions(DB, { token: "", enabled: true, fetchFn: ok }), null);
  assert.equal(await readAppliedVersions(DB, { token: "t", enabled: false, fetchFn: ok }), null);
  assert.equal(calls.length, 1);
  assert.equal(versionsOf([{ version: 5 }]), null);
});

test("hostedDbReadOn: off wins; test state dir needs ATC_HOSTED_DB=on", () => {
  const prod = "/h/.local/state/atc";
  assert.equal(hostedDbReadOn({}, prod, prod), true);
  assert.equal(hostedDbReadOn({ ATC_HOSTED_DB: "off" }, prod, prod), false);
  assert.equal(hostedDbReadOn({}, "/tmp/x", prod), false);
  assert.equal(hostedDbReadOn({ ATC_HOSTED_DB: "on" }, "/tmp/x", prod), true);
});
