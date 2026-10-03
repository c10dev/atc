import assert from "node:assert/strict";
import { test } from "node:test";
import { type RecycleInput, DEFAULT_CAPS, DEFAULT_WAIT_ALERT_MIN, TOWER_EVENTS_MAX, contextTokensOf, controlRecycleOf, goneOf, jobIdle, parseRecycle, recycleAlertTextOf, safeBlocksOf, waitAlertTextOf, NO_FACTS, autoChangeLines, capChangeLines, waitMinutesOf, wouldWaitDue } from "./control-recycle.ts";
import { restartSafetyOf } from "./occ-safe.ts";
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
  assert.equal(controlRecycleOf(input({ name: "OCC", auto: true, safe: { rtsBusy: null, tower: null, mcc: null, occ: { blockers: [], crewChangeOpen: 0 } } })).action, "recycle"); // 나중에 켜는 것은 설정 하나
});

test("parseRecycle: OCC는 기본으로 자동 재시작 제외, 설정으로 켠다", () => {
  assert.deepEqual(parseRecycle(null).auto, { TOWER: true, OCC: false, MCC: true, REVIEW: true });
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

test("jobIdle(ATC-175): tempo idle이고 blocked가 아니면 턴 사이 — done/idle과 working/idle은 맞고, working/active·blocked/*·job 없음은 아니다", () => {
  assert.equal(jobIdle({ state: "done", tempo: "idle" }), true);
  assert.equal(jobIdle({ state: "working", tempo: "idle" }), true); // /loop이 다음 바퀴를 기다리는 중
  assert.equal(jobIdle({ state: "working", tempo: "active" }), false);
  assert.equal(jobIdle({ state: "blocked", tempo: "blocked" }), false);
  assert.equal(jobIdle({ state: "blocked", tempo: "idle" }), false); // state가 blocked면 tempo가 idle이어도 아니다
  assert.equal(jobIdle({ state: "stopped", tempo: "idle" }), true);
  assert.equal(jobIdle({ state: "done", tempo: null }), false);
  assert.equal(jobIdle(null), false);
  assert.equal(jobIdle(undefined), false);
  // 결정에도 그대로 이어진다
  assert.equal(controlRecycleOf(input({ job: { state: "working", tempo: "idle" } })).action, "recycle");
  assert.equal(controlRecycleOf(input({ job: { state: "working", tempo: "active" } })).action, "wait");
});

test("parseRecycle: waitAlertMin 기본 60, 범위 5–1440 밖은 기본", () => {
  assert.equal(parseRecycle(null).waitAlertMin, DEFAULT_WAIT_ALERT_MIN);
  assert.equal(DEFAULT_WAIT_ALERT_MIN, 60);
  assert.equal(parseRecycle({ waitAlertMin: 30 }).waitAlertMin, 30);
  for (const v of [1, 4, 1441, "x", null, NaN]) assert.equal(parseRecycle({ waitAlertMin: v }).waitAlertMin, 60, String(v));
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

const clean = { rtsBusy: null, tower: { events: 0, overdue: 0 }, occ: { blockers: [] as never[], crewChangeOpen: 0 }, mcc: { blocked: null } };

test("safeBlocksOf: RTS는 모든 세션을 막는다", () => {
  for (const n of ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW"]) {
    assert.deepEqual(safeBlocksOf(n, { ...clean, rtsBusy: "RTS 진행 중" }), ["RTS: RTS 진행 중"]);
  }
});

test("safeBlocksOf: 세션마다 다른 조건", () => {
  for (const n of ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW"]) assert.deepEqual(safeBlocksOf(n, clean), []);
  // TOWER(ATC-175): acked하지 않은 이벤트는 새 TOWER가 brief에서 다시 받는다(ATC-165 1.2). 문턱까지는 막지 않는다
  assert.deepEqual(safeBlocksOf("TOWER", { ...clean, tower: { events: TOWER_EVENTS_MAX, overdue: 0 } }), []);
  assert.equal(safeBlocksOf("TOWER", { ...clean, tower: { events: TOWER_EVENTS_MAX + 1, overdue: 0 } }).length, 1);
  assert.equal(safeBlocksOf("TOWER", { ...clean, tower: { events: 0, overdue: 1 } }).length, 1);
  // 다른 세션의 조건은 TOWER를 막지 않는다
  const now = Date.parse("2026-09-30T12:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const occOf = (over: Partial<Parameters<typeof restartSafetyOf>[0]>, crew = 0) => ({ ...clean, occ: { blockers: restartSafetyOf({ inFlight: [], arrivalMissing: [], wip: [], now, ...over }).blockers, crewChangeOpen: crew } });
  const busy = occOf({ inFlight: [{ id: "D-1", status: "approved", statusAt: iso(now) }, { id: "D-2", status: "recalling", statusAt: iso(now) }, { id: "D-3", status: "sent", statusAt: iso(now - 60_000) }] }, 1);
  assert.deepEqual(safeBlocksOf("TOWER", busy), []);
  assert.equal(safeBlocksOf("OCC", busy).length, 4);
  // ATC-175: OCC의 안전 조건은 ATC-169의 restartSafetyOf 결과를 그대로 쓴다(dispatch brief의 restartSafety와 같은 blockers)
  // OCC 깨끗함 / 머지 직후 도착 보고가 오는 중 / 다듬는 중인 CHARTER REQUEST
  assert.deepEqual(safeBlocksOf("OCC", occOf({})), []);
  const fresh = occOf({ arrivalMissing: [{ flight: "ATC-1", arrivedAt: iso(now - 5 * 60_000), ageMin: 5 }] });
  assert.match(safeBlocksOf("OCC", fresh).join(" "), /ATC-1 PR이 머지된 지 5분/);
  assert.deepEqual(safeBlocksOf("OCC", occOf({ arrivalMissing: [{ flight: "ATC-1", arrivedAt: iso(now - 40 * 60_000), ageMin: 40 }] })), []); // 30분이 지나면 막지 않는다
  const wip = occOf({ wip: [{ id: "W-0001", touchedAt: iso(now - 60_000) }] });
  assert.match(safeBlocksOf("OCC", wip).join(" "), /W-0001 CHARTER REQUEST/);
  assert.deepEqual(safeBlocksOf("TOWER", wip), []);
  assert.deepEqual(safeBlocksOf("TOWER", fresh), []);
  // 결정까지: 안전하지 않으면 wait, 깨끗하면 recycle
  assert.equal(controlRecycleOf(input({ name: "OCC", auto: true, safe: wip })).action, "wait");
  assert.equal(controlRecycleOf(input({ name: "OCC", auto: true, safe: occOf({}) })).action, "recycle");
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
function fakes(o: Partial<{ stopOk: boolean; stopUnverified: boolean; launchOk: boolean; alive: number; rows: (n: number) => object[] }> = {}) {
  const calls: string[] = [];
  let polls = 0;
  const d: ActDeps = {
    stop: async (n) => (calls.push(`stop ${n}`), o.stopUnverified ? { ok: false, unverified: true, error: "claude stop은 종료 코드 0이었지만 job state.json이 done" } : o.stopOk === false ? { ok: false, error: "claude stop 실패" } : { ok: true }),
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

test("performRecycle(ATC-521): claude stop은 성공했지만 job이 stopped가 아니면 LAUNCH하지 않고 stop-unverified(stop-failed와 다른 사유)", async () => {
  const { d, calls } = fakes({ stopUnverified: true });
  const r = await performRecycle(d, row, "MCC", 200_000, "x");
  assert.equal(r.result, "stop-unverified");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /종료 코드 0/);
  assert.deepEqual(calls, ["stop MCC"]);
  assert.match(recycleAlertTextOf(r).text, /확인하지 못해 새 세션을 띄우지 않음/);
});

test("performRecycle(ATC-175): 확인하지 못해도 LAUNCH를 시도한다 — 성공하면 새 세션이 돈다고 말한다", async () => {
  const { d, calls } = fakes({ alive: 1e9 });
  const r = await performRecycle(d, row, "TOWER", 300_000, "x");
  assert.equal(r.result, "stop-unconfirmed");
  assert.deepEqual(calls, ["stop TOWER", "launch TOWER acct-2"]);
  assert.deepEqual(r.launch, { ok: true, jobId: "def456" });
  assert.equal(r.ok, true);
  assert.match(recycleAlertTextOf(r).text, /LAUNCH가 성공해 새 세션이 돌고 있음/);
});

test("performRecycle(ATC-175): 확인하지 못했고 LAUNCH도 옛 줄이 살아 있어 거절되면 CAUTION — 세션이 내려갔을 수 있다고 말한다", async () => {
  const calls: string[] = [];
  const d: ActDeps = {
    stop: async () => ({ ok: true }),
    rowsOf: async () => [{ id: "abc123", pid: 4242, status: "idle" }] as never,
    pidAlive: () => true,
    launch: async (n) => (calls.push(`launch ${n}`), { ok: false, error: "TOWER 세션이 이미 떠 있음(bg abc123)" }),
    sleep: async () => {},
    confirmMs: 20,
  };
  const r = await performRecycle(d, row, "TOWER", 300_000, "x");
  assert.equal(r.result, "stop-unconfirmed");
  assert.equal(r.ok, false);
  assert.deepEqual(r.launch, { ok: false, error: "TOWER 세션이 이미 떠 있음(bg abc123)" });
  assert.deepEqual(calls, ["launch TOWER"]);
  const a = recycleAlertTextOf(r);
  assert.match(a.text, /LAUNCH도 거절됨/);
  assert.match(a.text, /세션이 내려갔을 수 있음/);
  const out = supervisorAlertsOf({ ...base, recycles: [{ t: "2026-09-30T10:00:00.000Z", session: "TOWER", contextBefore: 300_000, result: r.result, ok: r.ok, error: r.error, launch: r.launch }] }).filter((x) => x.group === "recycle");
  assert.equal(out[0]!.level, "caution");
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

test("SUPERVISOR ALERT(ATC-175): wait가 오래되면 CAUTION 하나 — 막는 것과 손으로 할 일을 말한다. 같은 key, would-wait는 알리지 않는다", () => {
  const waiting = [{ session: "TOWER", context: 300_000, cap: 250_000, blocks: ["overdue CLEARANCE 1건", "RTS: RTS 진행 중"], since: "2026-09-30T10:00:00.000Z", minutes: 75 }];
  const out = supervisorAlertsOf({ ...base, waiting, recycles: [{ t: "2026-09-30T11:00:00.000Z", session: "TOWER", contextBefore: 300_000, result: "would-wait", ok: true }] }).filter((a) => a.group === "recycle");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.key, "recycle|wait|TOWER");
  assert.equal(out[0]!.level, "caution");
  assert.match(out[0]!.text, /75분째 재시작하지 못함: overdue CLEARANCE 1건; RTS: RTS 진행 중/);
  assert.match(out[0]!.next, /손으로 STOP하고 LAUNCH/);
  assert.match(waitAlertTextOf(waiting[0]!).text, /컨텍스트 300k > CAP 250k/);
});

test("waitMinutesOf: 처음 wait가 된 뒤 waitAlertMin이 지나야 분을 돌려준다", () => {
  const since = NOW - 59 * 60_000;
  assert.equal(waitMinutesOf(since, NOW, 60), null); // 59분
  assert.equal(waitMinutesOf(since, NOW + 60_000, 60), 60);
  assert.equal(waitMinutesOf(NOW - 90 * 60_000, NOW, 60), 90);
  assert.equal(waitMinutesOf(undefined, NOW, 60), null); // wait가 아니면 null
  assert.equal(waitMinutesOf(NOW - 10 * 60_000, NOW, 5), 10); // 설정으로 바꾼다
});

test("wouldWaitDue: shadow에서만, 세션마다 cooldown에 한 줄", () => {
  const cd = 3 * 3_600_000;
  assert.equal(wouldWaitDue("shadow", undefined, NOW, cd), true);
  assert.equal(wouldWaitDue("shadow", NOW - cd + 1000, NOW, cd), false);
  assert.equal(wouldWaitDue("shadow", NOW - cd, NOW, cd), true);
  assert.equal(wouldWaitDue("on", undefined, NOW, cd), false); // on은 알림만
  assert.equal(wouldWaitDue("off", undefined, NOW, cd), false);
});

test("캡·auto 바꿈 기록: 바뀐 세션마다 한 줄(from → to), 그대로면 없다", () => {
  const t = "2026-09-30T12:00:00.000Z";
  const caps = { TOWER: 250_000, OCC: 250_000, MCC: 150_000, CROSSCHECK: 250_000, REVIEW: null };
  assert.deepEqual(capChangeLines(caps, { TOWER: 200_000, REVIEW: null, MCC: 150_000 }, t, "SUPERVISOR"), [{ t, kind: "control", op: "recycle-caps", by: "SUPERVISOR", session: "TOWER", from: 250_000, to: 200_000 }]);
  assert.deepEqual(capChangeLines(caps, { REVIEW: 180_000, MCC: null }, t, "SUPERVISOR").map((l) => [l.session, l.from, l.to]), [["REVIEW", null, 180_000], ["MCC", 150_000, null]]);
  const auto = { TOWER: true, OCC: false, MCC: true, CROSSCHECK: true, REVIEW: true };
  assert.deepEqual(autoChangeLines(auto, { OCC: true, TOWER: true }, t, "SUPERVISOR"), [{ t, kind: "control", op: "recycle-auto", by: "SUPERVISOR", session: "OCC", from: false, to: true }]);
  assert.deepEqual(autoChangeLines(auto, {}, t, "SUPERVISOR"), []);
});
