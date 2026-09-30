import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { LandBy } from "./land-by.ts";
import { type AlertsInput, controlDownOf, DEST_PREFIXES, destOf, repositionStuckOf, rtsHaltedOf, supervisorAlertsOf } from "./supervisor-alerts.ts";

// ATC-197 (docs/alerting.md 3.1): 모든 항목에 dest, key는 그대로, 새 조건 항목 셋은 상태에서 만들어지고 상태가 풀리면 사라진다
const base: AlertsInput = { sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null };
const T = "2026-09-30T10:00:00.000Z";
const pull = (n: number, over: object = {}) => ({ repo: "/r/atc", number: n, title: `PR ${n}`, head: `head${n}`, landing: "CLEARED" as const, draft: false, ticketKey: `ATC-${n}`, humanCheck: undefined, ...over });

// 모든 key 종류를 한 입력에 담는다
function fullInput(): AlertsInput {
  return {
    ...base,
    sessions: [{ id: "s1", name: "TEAM_G", status: "idle", health: { code: "PENDING", level: "info", since: T, detail: "승인 대기", next: "n", holds: false } }],
    alerts: [{ kind: "conflict", key: "conflict|x", message: "충돌", sessionIds: ["s1"] } as never],
    following: [
      { flight: "ATC-1", aircraft: "TEAM_G", issues: [{ code: "no-pr", kind: "delay", severity: "warn", text: "PR 없음", since: T, key: "ATC-1|no-pr" }] },
      { flight: "ATC-2", aircraft: "TEAM_H", issues: [{ code: "await-supervisor", kind: "delay", severity: "warn", text: "go 대기", since: T, key: "ATC-2|await-supervisor|D-1" }] },
    ],
    proposals: [{ id: "D-9", kind: "ASSIGN", status: "proposed", flight: "ATC-3", aircraftName: "TEAM_G", holdAt: null, statusAt: T }],
    schedule: { mode: "approval", ops: [{ id: "S-1", kind: "TAIL", flight: "ATC-4", status: "draft", statusAt: T }] },
    pulls: [pull(11), pull(12), pull(13, { humanCheck: { required: true, state: "waiting" } })],
    rts: { at: T, from: "aaaaaaa1", to: "bbbbbbb2", result: "ok", detail: "" },
    recycles: [{ t: T, session: "TOWER", contextBefore: 300_000, result: "recycled", ok: true }],
    waiting: [{ session: "OCC", context: 300_000, cap: 250_000, blocks: ["x"], since: T, minutes: 70 }],
    overCap: [{ session: "MCC", context: 200_000, cap: 150_000, since: T }],
    capIdle: [{ id: "j1", name: "TEAM_X", idleMin: 130, refused: "TEAM_G" } as never],
    repositions: [{ t: T, aircraft: "TEAM_G", from: "A", to: "B", ok: false, by: "auto", stage: "stop" }],
    repositionFlaps: [{ t: T, reason: "flapping" }],
    rtsHalted: { since: T, reason: "ROLLBACK 뒤 멈춤" },
    controlDown: [{ session: "TOWER", since: T, reason: "not trusted" }],
    repositionStuck: [{ aircraft: "TEAM_H", since: T, to: "B" }],
    landBy: new Map<string, LandBy>([["/r/atc#11", "supervisor"], ["/r/atc#12", "mcc"], ["/r/atc#13", "holder"]]),
  };
}

test("모든 항목에 dest가 붙고, key 종류마다 표(3.1)대로 간다", () => {
  const items = supervisorAlertsOf(fullInput());
  assert.ok(items.length > 12);
  for (const a of items) assert.ok(["alerts", "queue", "log"].includes(a.dest), a.key);
  const d = (re: RegExp) => items.filter((a) => re.test(a.key)).map((a) => a.dest);
  assert.deepEqual(d(/^alert\|/), ["alerts"]); // health가 아닌 ALERT
  assert.deepEqual(d(/^pending\|tool\|/), ["queue"]);
  assert.deepEqual(d(/^pending\|proposal\|/), ["queue"]);
  assert.deepEqual(d(/^pending\|schedule\|/), ["queue"]);
  assert.deepEqual(d(/^pending\|humancheck\|/), ["queue"]);
  assert.deepEqual(d(/^following\|ATC-1\|/), ["alerts"]);
  assert.deepEqual(d(/^following\|ATC-2\|await-supervisor/), ["queue"]);
  assert.deepEqual(d(/^rts\|halted$/), ["alerts"]);
  assert.deepEqual(d(/^rts\|\d{4}-/), ["log"]);
  assert.deepEqual(d(/^recycle\|TOWER\|/), ["log"]);
  assert.deepEqual(d(/^recycle\|wait\|/), ["alerts"]);
  assert.deepEqual(d(/^recycle\|over\|/), ["alerts"]);
  assert.deepEqual(d(/^cap\|other\|/), ["alerts"]);
  assert.deepEqual(d(/^control\|down\|/), ["alerts"]);
  assert.deepEqual(d(/^reposition\|stuck\|/), ["alerts"]);
  assert.deepEqual(d(/^reposition\|TEAM_G\|/), ["log"]);
  assert.deepEqual(d(/^reposition\|flap\|/), ["log"]);
});

test("land|…: landBy supervisor(user 등급 등)는 queue, mcc·holder는 log, 자료가 없으면 queue", () => {
  const items = supervisorAlertsOf(fullInput());
  const land = Object.fromEntries(items.filter((a) => a.key.startsWith("land|")).map((a) => [a.key.split("|")[1], a.dest]));
  assert.deepEqual(land, { "/r/atc#11": "queue", "/r/atc#12": "log", "/r/atc#13": "log" });
  const noInfo = supervisorAlertsOf({ ...fullInput(), landBy: undefined }).filter((a) => a.key.startsWith("land|")).map((a) => a.dest);
  assert.deepEqual(noInfo, ["queue", "queue", "queue"]);
});

test("key는 그대로다: dest를 붙여도 key 집합이 같다", () => {
  const withDest = supervisorAlertsOf(fullInput()).map((a) => a.key);
  const { landBy: _l, ...rest } = fullInput();
  assert.deepEqual(supervisorAlertsOf(rest).map((a) => a.key), withDest);
  // 옛 key 형식이 그대로 나온다
  for (const re of [/^pending\|proposal\|D-9$/, /^recycle\|wait\|OCC$/, /^recycle\|over\|MCC$/, /^cap\|other\|j1$/, /^reposition\|flap\|/]) assert.ok(withDest.some((k) => re.test(k)), String(re));
});

test("새 key 종류가 규칙 없이 늘면 시험이 실패한다: supervisor-alerts.ts가 만드는 key의 첫 마디는 DEST_PREFIXES에 있어야 한다", () => {
  const src = readFileSync(new URL("./supervisor-alerts.ts", import.meta.url), "utf8");
  const emitted = new Set<string>();
  for (const m of src.matchAll(/key: `([a-z]+)\|/g)) emitted.add(m[1]!);
  for (const m of src.matchAll(/key: "([a-z]+)\|/g)) emitted.add(m[1]!);
  assert.ok(emitted.size >= 8, [...emitted].join(","));
  for (const p of emitted) assert.ok((DEST_PREFIXES as readonly string[]).includes(p), `key 종류 ${p}에 destOf 규칙이 없음`);
  // 모든 DEST_PREFIXES가 destOf의 case로 있다(default로 흘러가지 않는다)
  for (const p of DEST_PREFIXES) assert.match(src, new RegExp(`case "${p}"`), p);
  // 실제 출력의 첫 마디도 모두 규칙 안에 있다
  for (const a of supervisorAlertsOf(fullInput())) assert.ok((DEST_PREFIXES as readonly string[]).includes(a.key.split("|")[0]!), a.key);
});

test("destOf: 모르는 종류는 alerts(놓치지 않게)", () => {
  assert.equal(destOf({ key: "zzz|x" }), "alerts");
  assert.equal(destOf({ key: "land|/r/x#1|h" }, new Map([["/r/x#1", "mcc"]])), "log");
});

test("rts|halted: ROLLBACK 뒤 멈춤 동안 WARNING 하나, 모드를 다시 고르면(stop이 null) 사라진다", () => {
  const halted = rtsHaltedOf("ROLLBACK 뒤 멈춤(2026-09-30T09:00:00Z) — SUPERVISOR가 설정 창에서 MCC 모드를 다시 고르면 풀림", { at: "2026-09-30T09:00:00.000Z" });
  assert.deepEqual(halted, { since: "2026-09-30T09:00:00.000Z", reason: "ROLLBACK 뒤 멈춤(2026-09-30T09:00:00Z) — SUPERVISOR가 설정 창에서 MCC 모드를 다시 고르면 풀림" });
  const on = supervisorAlertsOf({ ...base, rtsHalted: halted }).filter((a) => a.key === "rts|halted");
  assert.equal(on.length, 1);
  assert.equal(on[0]!.level, "warning");
  assert.equal(on[0]!.dest, "alerts");
  assert.equal(on[0]!.since, "2026-09-30T09:00:00.000Z");
  assert.match(on[0]!.next, /MCC 모드를 다시 고른다/);
  assert.equal(rtsHaltedOf(null, { at: T }), null); // 풀림
  assert.equal(supervisorAlertsOf({ ...base, rtsHalted: rtsHaltedOf(null, { at: T }) }).some((a) => a.key === "rts|halted"), false);
  assert.equal(rtsHaltedOf("x", null), null);
});

const rec = (over: object) => ({ t: T, session: "TOWER", result: "recycled", ok: true, ...over }) as Parameters<typeof controlDownOf>[0][number];

test("control|down|<session>: RECYCLE이 멈춘 세션이 다시 뜨지 않았으면 CAUTION, 뜨거나 뒤에 recycled가 나오면 사라진다", () => {
  const failed = rec({ result: "launch-failed", ok: false, error: "not trusted" });
  const down = controlDownOf([failed], new Set());
  assert.deepEqual(down, [{ session: "TOWER", since: T, reason: "not trusted" }]);
  const on = supervisorAlertsOf({ ...base, controlDown: down }).filter((a) => a.key === "control|down|TOWER");
  assert.equal(on.length, 1);
  assert.equal(on[0]!.level, "caution");
  assert.equal(on[0]!.dest, "alerts");
  assert.match(on[0]!.next, /LAUNCH/);
  // 다시 떴다(SUPERVISOR가 LAUNCH) → 사라진다
  assert.deepEqual(controlDownOf([failed], new Set(["TOWER"])), []);
  // 뒤에 recycled가 나왔다 → 사라진다
  assert.deepEqual(controlDownOf([failed, rec({ t: "2026-09-30T11:00:00.000Z", result: "recycled" })], new Set()), []);
  // 아직 안 뜬 상태가 풀리면 항목도 없다
  assert.equal(supervisorAlertsOf({ ...base, controlDown: [] }).some((a) => a.key.startsWith("control|")), false);
});

test("controlDownOf: stop-unconfirmed는 LAUNCH도 안 됐을 때만, would·stop-failed는 멈춘 것이 아니다", () => {
  assert.equal(controlDownOf([rec({ result: "stop-unconfirmed", ok: false, launch: { ok: false, error: "이미 떠 있음" } })], new Set()).length, 1);
  assert.equal(controlDownOf([rec({ result: "stop-unconfirmed", ok: true, launch: { ok: true } })], new Set()).length, 0);
  assert.equal(controlDownOf([rec({ result: "stop-unconfirmed", ok: false })], new Set()).length, 0); // 옛 기록(launch 없음)
  assert.equal(controlDownOf([rec({ result: "stop-failed", ok: false })], new Set()).length, 0);
  assert.equal(controlDownOf([rec({ result: "would" }), rec({ result: "would-wait" })], new Set()).length, 0);
  // would가 뒤에 와도 마지막 실행 기록(launch-failed)이 남는다
  assert.equal(controlDownOf([rec({ result: "launch-failed", ok: false }), rec({ t: "2026-09-30T12:00:00.000Z", result: "would" })], new Set()).length, 1);
});

const rp = (over: object) => ({ t: T, aircraft: "TEAM_H", from: "A", to: "B", ok: false, by: "auto", stage: "launch", error: "LAUNCH 실패", ...over }) as Parameters<typeof repositionStuckOf>[0][number];

test("reposition|stuck|<aircraft>: base는 옮겼는데 LAUNCH가 실패해 세션이 없으면 CAUTION, 세션이 뜨거나 뒤에 성공하면 사라진다", () => {
  const stuck = repositionStuckOf([rp({})], new Set());
  assert.deepEqual(stuck, [{ aircraft: "TEAM_H", since: T, to: "B", error: "LAUNCH 실패" }]);
  const on = supervisorAlertsOf({ ...base, repositionStuck: stuck }).filter((a) => a.key === "reposition|stuck|TEAM_H");
  assert.equal(on.length, 1);
  assert.equal(on[0]!.level, "caution");
  assert.equal(on[0]!.dest, "alerts");
  assert.equal(on[0]!.aircraft, "TEAM_H");
  // 세션이 다시 떴다 → 사라진다
  assert.deepEqual(repositionStuckOf([rp({})], new Set(["TEAM_H"])), []);
  // 뒤에 성공한 REPOSITION → 사라진다
  assert.deepEqual(repositionStuckOf([rp({}), rp({ t: "2026-09-30T11:00:00.000Z", ok: true, error: undefined })], new Set()), []);
  // 다른 단계의 실패(stop·base·precheck)는 base가 옮겨지지 않았거나 옛 세션이 그대로라 stuck이 아니다
  for (const stage of ["stop", "base", "precheck"]) assert.deepEqual(repositionStuckOf([rp({ stage })], new Set()), [], stage);
  assert.equal(supervisorAlertsOf({ ...base, repositionStuck: [] }).some((a) => a.key.startsWith("reposition|stuck")), false);
});
