import assert from "node:assert/strict";
import { test } from "node:test";
import { pullKey } from "./landing.ts";
import { type MigrateRecord, type PassIo, rehearsalPass } from "./migrate-run.ts";
import { classify } from "./migration-declare.ts";
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
}
function pass(over: Over = {}) {
  const calls = { rehearse: 0, held: 0, noted: [] as { result?: string }[] };
  const s = { airports: [{ id: "a", code: "ATCC", name: "n", repo: "/r" }], pulls: [PR], autoland: { exclusions: { [pullKey(PR)]: over.exclusion === undefined ? GATE_WHY : over.exclusion } } } as unknown as Snapshot;
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
