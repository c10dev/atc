import assert from "node:assert/strict";
import { test } from "node:test";
import { type RecycleInput, DEFAULT_CAPS, contextTokensOf, controlRecycleOf, goneOf, jobIdle, parseRecycle, recycleAlertTextOf, safeBlocksOf, NO_FACTS } from "./control-recycle.ts";
import { type ActDeps, performRecycle, projectDirName } from "./control-recycle-run.ts";
import { supervisorAlertsOf } from "./supervisor-alerts.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const idle = { state: "done", tempo: "idle" } as const;
const input = (o: Partial<RecycleInput> = {}): RecycleInput => ({
  name: "CROSSCHECK",
  mode: "on",
  cap: 250_000,
  auto: true,
  context: 300_000,
  background: true,
  job: idle,
  safe: { ...NO_FACTS },
  lastRecycleAt: null,
  otherRecycling: null,
  cooldownMs: 3 * 3_600_000,
  now: NOW,
  ...o,
});

test("parseRecycle: 깨진 파일은 off와 권고 CAP", () => {
  for (const raw of [null, "x", [], { mode: "yes" }]) {
    const c = parseRecycle(raw);
    assert.equal(c.mode, "off");
    assert.deepEqual(c.caps, DEFAULT_CAPS);
    assert.equal(c.cooldownHours, 3);
  }
  const c = parseRecycle({ mode: "shadow", caps: { TOWER: 120000, MCC: null, OCC: 10, REVIEW: 180000, NOPE: 1 }, cooldownHours: 5 });
  assert.equal(c.mode, "shadow");
  assert.equal(c.caps.TOWER, 120000);
  assert.equal(c.caps.MCC, null);
  assert.equal(c.caps.OCC, 250000); // 범위 밖은 기본값
  assert.equal(c.caps.REVIEW, 180000);
  assert.ok(!("NOPE" in c.caps));
  assert.equal(c.cooldownHours, 5);
});

test("controlRecycleOf: 다섯 조건이 모두 맞을 때만 recycle", () => {
  assert.equal(controlRecycleOf(input()).action, "recycle");
  assert.equal(controlRecycleOf(input({ mode: "shadow" })).action, "recycle"); // shadow도 같은 결정, 실행만 다르다
});

test("controlRecycleOf: 끔·CAP 없음·미만·모름·bg 아님은 skip", () => {
  assert.equal(controlRecycleOf(input({ mode: "off" })).action, "skip");
  assert.equal(controlRecycleOf(input({ cap: null })).action, "skip");
  assert.equal(controlRecycleOf(input({ context: 250_000 })).action, "skip"); // 같으면 넘은 것이 아니다
  assert.equal(controlRecycleOf(input({ context: null })).action, "skip");
  assert.equal(controlRecycleOf(input({ background: false })).action, "skip");
});

test("controlRecycleOf: auto가 false인 세션(OCC 기본)은 어떤 모드에서도 재시작하지 않는다", () => {
  for (const mode of ["shadow", "on"] as const) {
    const d = controlRecycleOf(input({ name: "OCC", mode, auto: false }));
    assert.equal(d.action, "skip");
    assert.match(d.reason, /측정·알림만/);
  }
  assert.equal(controlRecycleOf(input({ name: "OCC", auto: true, safe: { rtsBusy: null, tower: null, mcc: null, occ: { approved: 0, recalling: 0, youngSent: 0, crewChangeOpen: 0 } } })).action, "recycle"); // 나중에 켜는 것은 설정 하나
});

test("parseRecycle: OCC는 기본으로 자동 재시작 제외, 설정으로 켠다", () => {
  assert.deepEqual(parseRecycle(null).auto, { TOWER: true, OCC: false, MCC: true, CROSSCHECK: true, REVIEW: true });
  assert.equal(parseRecycle({ auto: { OCC: true, TOWER: "no", NOPE: true } }).auto.OCC, true);
  assert.equal(parseRecycle({ auto: { TOWER: "no" } }).auto.TOWER, true);
});

test("controlRecycleOf: CAP을 넘어도 턴 사이가 아니면 기다린다", () => {
  for (const job of [{ state: "working", tempo: "active" }, { state: "blocked", tempo: "blocked" }, { state: "done", tempo: null }, null] as const) {
    const d = controlRecycleOf(input({ job }));
    assert.equal(d.action, "wait");
    assert.match(d.reason, /턴 사이가 아님/);
  }
  assert.ok(jobIdle(idle));
});

test("controlRecycleOf: 3시간 안에 재시작했으면 기다린다, 지나면 한다", () => {
  assert.equal(controlRecycleOf(input({ lastRecycleAt: NOW - 3 * 3_600_000 + 1000 })).action, "wait");
  assert.equal(controlRecycleOf(input({ lastRecycleAt: NOW - 3 * 3_600_000 })).action, "recycle");
});

test("controlRecycleOf: 다른 세션이 재시작 중이면 기다린다", () => {
  const d = controlRecycleOf(input({ otherRecycling: "TOWER" }));
  assert.equal(d.action, "wait");
  assert.match(d.reason, /TOWER가 재시작 중/);
});

test("controlRecycleOf: 안전 자료를 못 읽으면 막는다(fail-closed)", () => {
  assert.equal(controlRecycleOf(input({ safe: null })).action, "wait");
});

const clean = { rtsBusy: null, tower: { events: 0, overdue: 0 }, occ: { approved: 0, recalling: 0, youngSent: 0, crewChangeOpen: 0 }, mcc: { blocked: null } };

test("safeBlocksOf: RTS는 모든 세션을 막는다", () => {
  for (const n of ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW"]) {
    assert.deepEqual(safeBlocksOf(n, { ...clean, rtsBusy: "RTS 진행 중" }), ["RTS: RTS 진행 중"]);
  }
});

test("safeBlocksOf: 세션마다 다른 조건", () => {
  for (const n of ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW"]) assert.deepEqual(safeBlocksOf(n, clean), []);
  assert.equal(safeBlocksOf("TOWER", { ...clean, tower: { events: 2, overdue: 0 } }).length, 1);
  assert.equal(safeBlocksOf("TOWER", { ...clean, tower: { events: 0, overdue: 1 } }).length, 1);
  // 다른 세션의 조건은 TOWER를 막지 않는다
  assert.deepEqual(safeBlocksOf("TOWER", { ...clean, occ: { approved: 1, recalling: 1, youngSent: 1, crewChangeOpen: 1 } }), []);
  assert.equal(safeBlocksOf("OCC", { ...clean, occ: { approved: 1, recalling: 1, youngSent: 1, crewChangeOpen: 1 } }).length, 4);
  assert.equal(safeBlocksOf("MCC", { ...clean, mcc: { blocked: "INSPECTION 중" } }).length, 1);
  assert.equal(safeBlocksOf("OCC", { ...clean, occ: null }).length, 1);
  assert.equal(safeBlocksOf("CROSSCHECK", null).length, 1);
});

test("goneOf: pid가 사라지고 줄에 pid·status가 없을 때만 안 것", () => {
  assert.deepEqual(goneOf({ pid: 10, pidAlive: false, row: null }), { gone: true, ghost: false });
  assert.deepEqual(goneOf({ pid: 10, pidAlive: false, row: {} }), { gone: true, ghost: true }); // 유령 줄(STALE)
  assert.equal(goneOf({ pid: 10, pidAlive: true, row: null }).gone, false);
  assert.equal(goneOf({ pid: 10, pidAlive: false, row: { pid: 10, status: "idle" } }).gone, false);
  assert.equal(goneOf({ pid: null, pidAlive: null, row: { status: "idle" } }).gone, false);
  assert.equal(goneOf({ pid: null, pidAlive: null, row: {} }).gone, true);
});

test("contextTokensOf는 mcc/context-cap.mjs와 같은 값", async () => {
  const mjs = (await import(new URL("../mcc/context-cap.mjs", import.meta.url).href)) as { contextTokensOf: (l: string[]) => number | null };
  const a = (u: object, x: object = {}) => JSON.stringify({ type: "assistant", message: { usage: u }, ...x });
  const cases: string[][] = [
    [],
    ["not json"],
    [a({ input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 })],
    [a({ input_tokens: 5 }), a({ input_tokens: 9 }, { isSidechain: true })], // 사이드체인은 뺀다
    [a({ input_tokens: 5 }), JSON.stringify({ type: "user" }), "{broken"],
    [a({ input_tokens: 0 })],
  ];
  for (const c of cases) assert.equal(contextTokensOf(c), mjs.contextTokensOf(c), JSON.stringify(c));
  assert.equal(contextTokensOf(cases[3]!), 5);
});

test("projectDirName: Claude Code 폴더 이름 규칙", () => {
  assert.equal(projectDirName("/home/c10/projects/atc/controller"), "-home-c10-projects-atc-controller");
});

// ── 행동 ──
const row = { id: "abc123", pid: 4242, account: "acct-2" };
function fakes(o: Partial<{ stopOk: boolean; launchOk: boolean; alive: number; rows: (n: number) => object[] }> = {}) {
  const calls: string[] = [];
  let polls = 0;
  const d: ActDeps = {
    stop: async (n) => (calls.push(`stop ${n}`), o.stopOk === false ? { ok: false, error: "claude stop 실패" } : { ok: true }),
    rowsOf: async () => (polls++, (o.rows ? o.rows(polls) : []) as never),
    pidAlive: () => polls <= (o.alive ?? 0),
    launch: async (n, acc) => (calls.push(`launch ${n} ${acc}`), o.launchOk === false ? { ok: false, error: "not trusted" } : { ok: true, jobId: "def456" }),
    sleep: async () => {},
    confirmMs: 50,
  };
  return { d, calls };
}

test("performRecycle: STOP → 확인 → 같은 ACCOUNT로 LAUNCH, 순서대로", async () => {
  const { d, calls } = fakes();
  const r = await performRecycle(d, row, "TOWER", 300_000, "컨텍스트 300k > CAP 250k");
  assert.equal(r.result, "recycled");
  assert.ok(r.ok);
  assert.equal(r.jobId, "def456");
  assert.equal(r.account, "acct-2");
  assert.deepEqual(calls, ["stop TOWER", "launch TOWER acct-2"]);
});

test("performRecycle: 유령 줄이 남아도 pid가 없으면 LAUNCH한다", async () => {
  const { d, calls } = fakes({ rows: () => [{ id: "abc123", sessionId: "s", kind: "background", cwd: "/x", startedAt: 1 }] });
  const r = await performRecycle(d, row, "MCC", 200_000, "x");
  assert.equal(r.result, "recycled");
  assert.equal(calls.length, 2);
});

test("performRecycle: pid가 아직 살아 있으면 기다렸다가 확인한다", async () => {
  const { d } = fakes({ alive: 2 });
  const r = await performRecycle(d, row, "OCC", 300_000, "x");
  assert.equal(r.result, "recycled");
});

test("performRecycle: STOP 실패면 LAUNCH하지 않고 세션은 그대로", async () => {
  const { d, calls } = fakes({ stopOk: false });
  const r = await performRecycle(d, row, "TOWER", 300_000, "x");
  assert.equal(r.result, "stop-failed");
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ["stop TOWER"]);
});

test("performRecycle: 확인하지 못하면 LAUNCH하지 않는다", async () => {
  const { d, calls } = fakes({ alive: 1e9 });
  const r = await performRecycle(d, row, "TOWER", 300_000, "x");
  assert.equal(r.result, "stop-unconfirmed");
  assert.deepEqual(calls, ["stop TOWER"]);
});

test("performRecycle: LAUNCH 실패는 멈춘 채라고 기록한다", async () => {
  const { d } = fakes({ launchOk: false });
  const r = await performRecycle(d, row, "TOWER", 300_000, "x");
  assert.equal(r.result, "launch-failed");
  assert.match(r.error ?? "", /not trusted/);
  assert.match(recycleAlertTextOf(r).text, /멈춘 채로/);
});

// ── 알림 ──
const base = { sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null };
test("SUPERVISOR ALERT: CAP을 넘은 OCC는 재시작 없이 알린다(넘어 있는 동안 같은 key)", () => {
  const out = supervisorAlertsOf({ ...base, overCap: [{ session: "OCC", context: 300_000, cap: 250_000, since: "2026-09-30T10:00:00.000Z" }] }).filter((a) => a.group === "recycle");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.key, "recycle|over|OCC");
  assert.match(out[0]!.text, /OCC 컨텍스트 300k > CAP 250k, 자동 재시작 대상이 아님/);
});

test("SUPERVISOR ALERT: 성공은 ADVISORY, 실패는 CAUTION, would는 알리지 않는다", () => {
  const recycles = [
    { t: "2026-09-30T10:00:00.000Z", session: "TOWER", contextBefore: 300_000, result: "recycled", ok: true },
    { t: "2026-09-30T11:00:00.000Z", session: "OCC", contextBefore: 280_000, result: "launch-failed", ok: false, error: "x" },
    { t: "2026-09-30T11:30:00.000Z", session: "MCC", contextBefore: 200_000, result: "would", ok: true },
  ] as const;
  const out = supervisorAlertsOf({ ...base, recycles: [...recycles] }).filter((a) => a.group === "recycle");
  assert.equal(out.length, 2);
  assert.equal(out[0]!.level, "advisory");
  assert.equal(out[1]!.level, "caution");
  assert.match(out[1]!.text, /멈춘 채로/);
  assert.equal(out[0]!.key, "recycle|TOWER|2026-09-30T10:00:00.000Z");
});
