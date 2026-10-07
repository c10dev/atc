import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isResendText, resendLinksOf, resendViewOf } from "./clearance-resend.ts";
import { buildBrief } from "./controller.ts";
import { capBlockedOf, controlRecycleOf, NO_FACTS, notIdleTextOf, type OverdueRef, type RecycleInput, safeBlocksOf } from "./control-recycle.ts";
import { overdueRefsOf } from "./control-recycle-run.ts";
import type { Clearance, Snapshot } from "./model.ts";
import { restartSafetyOf } from "./occ-safe.ts";
import { ALERT_CONTRACT, alertRowOf } from "./queue-contract.ts";
import { carryCounterOf, LOST_AFTER_MS, parseCarrySwitch } from "./recycle-carry.ts";
import { loadCarrySwitch, saveCarrySwitch } from "./recycle-carry-run.ts";
import { destOf, supervisorAlertsOf } from "./supervisor-alerts.ts";

// ATC-565: CONTROL RECYCLE이 막는 것의 이름을 대고, TOWER의 overdue CLEARANCE를 새 세션에 넘긴다

const T0 = Date.parse("2026-10-06T10:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const STAND = "/home/c10/projects/atc/.claude/worktrees/duty-control-plane";
const mk = (id: string, min: number, type: Clearance["type"], text: string, over: Partial<Clearance> = {}): Clearance =>
  ({ id, at: iso(min), to: "951f27c2-a99c", toName: "951f27c2", type, stand: STAND, flight: null, text, readbackAt: null, cancelledAt: null, ...over }) as Clearance;

// 2026-10-06 운영에서 본 모양: 죽은 DUTY 세션 하나에 PR #587로 나간 8건과 그 RESEND 셋
const prod = [
  mk("C-1069", 0, "INFO", "PR #587 cannot land yet: no review [blocks: blocked,no-review]"),
  mk("C-1070", 4, "FIX", "FIX PR #587: MCC INSPECTION returned FINDINGS on head 1f78a17"),
  mk("C-1072", 13, "INFO", "RESEND PR #587 cannot land yet: no review [blocks: blocked,no-review]"),
  mk("C-1074", 16, "FIX", "RESEND FIX PR #587: MCC INSPECTION returned FINDINGS on head 1f78a17"),
  mk("C-1075", 19, "FIX", "FIX PR #587: MCC INSPECTION returned FINDINGS on head c4fdf90"),
  mk("C-1077", 115, "FIX", "FIX PR #587: MCC INSPECTION returned FINDINGS on head 916ba38"),
  mk("C-1078", 127, "FIX", "RESEND FIX PR #587 head 916ba38: MCC INSPECTION P0 0"),
  mk("C-1080", 133, "FIX", "FIX PR #587: MCC INSPECTION returned FINDINGS on head 2222222"),
];

test("resendLinksOf: RESEND는 같은 세션·종류·STAND·FLIGHT·PR 번호의 먼저 나간, 아직 RESEND가 없는 가장 늦은 CLEARANCE에 잇는다(운영 2026-10-06 모양)", () => {
  const l = resendLinksOf(prod);
  assert.equal(l.get("C-1072")?.resendOf, "C-1069");
  assert.equal(l.get("C-1074")?.resendOf, "C-1070");
  assert.equal(l.get("C-1078")?.resendOf, "C-1077"); // C-1070은 이미 RESEND가 있어 C-1077이 가장 늦은 후보
  assert.deepEqual(l.get("C-1069")?.resentBy, ["C-1072"]);
  assert.deepEqual(l.get("C-1077")?.resentBy, ["C-1078"]);
  assert.equal(l.get("C-1075"), undefined);
  assert.equal(l.get("C-1080"), undefined);
  assert.ok(isResendText("  RESEND FIX …") && !isResendText("RESENDING") && !isResendText("FIX RESEND"));
});

test("resendLinksOf: 두 번째 RESEND는 이미 RESEND된 원래 것에 붙는다. 다른 세션·다른 PR·RESEND 전 것은 잇지 않는다", () => {
  const two = resendLinksOf([mk("C-1", 0, "INFO", "PR #5 x"), mk("C-2", 11, "INFO", "RESEND PR #5 x"), mk("C-3", 22, "INFO", "RESEND PR #5 x")]);
  assert.deepEqual(two.get("C-1")?.resentBy, ["C-2", "C-3"]);
  const none = resendLinksOf([mk("C-1", 0, "INFO", "PR #5 x"), mk("C-2", 11, "INFO", "RESEND PR #6 x"), mk("C-3", 12, "INFO", "RESEND PR #5 x", { to: "other", toName: "TEAM_Z" }), mk("C-4", 13, "FIX", "RESEND PR #5 x")]);
  assert.equal(none.get("C-1"), undefined);
  // RESEND가 먼저 나가고 원래 것이 뒤면 잇지 않는다
  assert.equal(resendLinksOf([mk("C-1", 0, "INFO", "RESEND PR #5 x"), mk("C-2", 1, "INFO", "PR #5 x")]).size, 0);
});

test("resendLinksOf: 고리 안 하나가 답(READBACK·ROGER·UNABLE)을 받으면 나머지는 answeredVia — 취소는 답이 아니다", () => {
  const l = resendLinksOf([mk("C-1", 0, "FIX", "FIX PR #5"), mk("C-2", 11, "FIX", "RESEND FIX PR #5", { readbackAt: iso(12), ackWord: "READBACK" })]);
  assert.equal(l.get("C-1")?.answeredVia, "C-2");
  assert.equal(l.get("C-2")?.answeredVia, undefined);
  const c = resendLinksOf([mk("C-1", 0, "FIX", "FIX PR #5", { cancelledAt: iso(5) }), mk("C-2", 11, "FIX", "RESEND FIX PR #5")]);
  assert.equal(c.get("C-2")?.answeredVia, undefined);
  assert.deepEqual(resendViewOf(undefined), {});
  assert.deepEqual(resendViewOf(l.get("C-1")), { resentBy: ["C-2"], answeredVia: "C-2" });
});

const snapshot = { at: iso(0), linear: { enabled: true, error: null, fetchedAt: iso(0) }, github: { enabled: true, error: null, fetchedAt: iso(0) }, atfm: { mains: [], groundStops: [] }, pulls: [], sessions: [], workspaces: [], tickets: [], columns: [], airports: [], claims: [], handoffs: [], alerts: [], clearances: [] } as unknown as Snapshot;
const brief = (cs: Clearance[], now: number) => buildBrief(snapshot, { events: [], reset: false, cursor: "e:0" }, cs, now);

test("TOWER brief: pending에 resendOf·resentBy가 실리고, 고리의 다른 CLEARANCE가 답을 받은 것은 overdue에서 빠진다", () => {
  const b = brief(prod, T0 + 200 * 60_000);
  const p = new Map(b.clearances.pending.map((c) => [c.id, c]));
  assert.deepEqual(p.get("C-1069")!.resentBy, ["C-1072"]);
  assert.equal(p.get("C-1072")!.resendOf, "C-1069");
  assert.equal("resendOf" in p.get("C-1075")!, false); // 고리 밖은 오늘과 같은 모양
  assert.equal(b.clearances.overdue.length, 8);
  const answered = brief([mk("C-1", 0, "FIX", "FIX PR #5"), mk("C-2", 11, "FIX", "RESEND FIX PR #5", { readbackAt: iso(12), ackWord: "READBACK" })], T0 + 60 * 60_000);
  assert.deepEqual(answered.clearances.overdue, []); // C-1은 열려 있지만 RESEND가 답을 받았다
  assert.equal(answered.clearances.pending.find((c) => c.id === "C-1")!.answeredVia, "C-2");
});

test("overdueRefsOf: id·받는 세션 이름과 RESEND 고리. 답을 받은 고리는 뺀다", () => {
  const refs = overdueRefsOf(prod, T0 + 200 * 60_000);
  assert.equal(refs.length, 8);
  assert.deepEqual(refs[0], { id: "C-1069", to: "951f27c2", resent: true });
  assert.deepEqual(refs[2], { id: "C-1072", to: "951f27c2", resendOf: "C-1069" });
});

const clean = { rtsBusy: null, tower: { events: 0, overdue: [] as OverdueRef[] }, occ: { blockers: [] as never[], crewChangeOpen: 0 }, mcc: { blocked: null } };
const eight = overdueRefsOf(prod, T0 + 200 * 60_000);

test("safeBlocksOf(ATC-565): 넘겨 줌이 꺼지면 overdue CLEARANCE의 id와 받는 세션을 댄다(다섯까지, 나머지는 수)", () => {
  const [b] = safeBlocksOf("TOWER", { ...clean, tower: { events: 0, overdue: eight } });
  assert.match(b!, /^overdue CLEARANCE 8건: C-1069→951f27c2\(RESEND함\), C-1070→951f27c2\(RESEND함\), C-1072→951f27c2\(C-1069의 RESEND\), /);
  assert.match(b!, / 외 3건$/);
  assert.deepEqual(safeBlocksOf("TOWER", { ...clean, tower: { events: 0, overdue: eight, carry: true } }), []);
});

const input = (o: Partial<RecycleInput> = {}): RecycleInput => ({ name: "TOWER", mode: "on", cap: 500_000, auto: true, context: 706_000, background: true, job: { state: "done", tempo: "idle" }, safe: { ...NO_FACTS }, lastRecycleAt: null, otherRecycling: null, cooldownMs: 3 * 3_600_000, now: T0, ...o });

test("controlRecycleOf(ATC-565): 넘겨 줌이 켜지면 overdue CLEARANCE가 있어도 재시작하고 넘긴 id를 돌려준다. 꺼지면 오늘처럼 기다린다", () => {
  const on = controlRecycleOf(input({ safe: { ...clean, tower: { events: 0, overdue: eight, carry: true } } }));
  assert.equal(on.action, "recycle");
  assert.equal(on.carry?.length, 8);
  assert.match(on.reason, /overdue CLEARANCE 8건을 새 세션에 넘김/);
  const off = controlRecycleOf(input({ safe: { ...clean, tower: { events: 0, overdue: eight } } }));
  assert.equal(off.action, "wait");
  assert.match(off.reason, /C-1069→951f27c2/);
  // 넘길 것이 없으면 carry가 없다. 다른 세션은 넘기지 않는다
  assert.equal(controlRecycleOf(input({ safe: { ...clean, tower: { events: 0, overdue: [], carry: true } } })).carry, undefined);
  assert.equal(controlRecycleOf(input({ name: "MCC", safe: { ...clean, tower: { events: 0, overdue: eight, carry: true } } })).carry, undefined);
  // 넘겨 줌이 켜져도 다른 이유(이벤트가 문턱 넘게 쌓임)는 그대로 막는다
  assert.equal(controlRecycleOf(input({ safe: { ...clean, tower: { events: 99, overdue: eight, carry: true } } })).action, "wait");
});

test("notIdleTextOf·OCC 종류(ATC-565): blocked면 SUPERVISOR를 기다린다고 묻는 내용까지, OCC 막는 것에는 종류를 붙인다", () => {
  assert.equal(notIdleTextOf({ state: "blocked", tempo: "blocked", needs: "Approve DISPATCH D-0412?" }), "턴 사이가 아님 — SUPERVISOR를 기다림(job blocked/blocked): Approve DISPATCH D-0412?");
  assert.equal(notIdleTextOf({ state: "working", tempo: "active" }), "턴 사이가 아님(job working/active, 턴 도중)");
  assert.equal(notIdleTextOf(null), "턴 사이가 아님(job을 읽지 못함)");
  const d = controlRecycleOf(input({ name: "OCC", job: { state: "blocked", tempo: "blocked", needs: "pick A or B" }, safe: { ...clean } }));
  assert.match(d.blocks[0]!, /SUPERVISOR를 기다림.*pick A or B/);
  const occ = (over: Partial<Parameters<typeof restartSafetyOf>[0]>) => ({ ...clean, occ: { blockers: restartSafetyOf({ inFlight: [], arrivalMissing: [], wip: [], now: T0, ...over }).blockers, crewChangeOpen: 0 } });
  assert.match(safeBlocksOf("OCC", occ({ arrivalMissing: [{ flight: "ATC-9", arrivedAt: iso(-5), ageMin: 5 }] }))[0]!, /^기록하지 않은 CAPTAIN 보고: ATC-9/);
  assert.match(safeBlocksOf("OCC", occ({ wip: [{ id: "W-0003", touchedAt: iso(-1) }] }))[0]!, /^CHARTER REQUEST 진행 중: W-0003/);
  assert.match(safeBlocksOf("OCC", occ({ inFlight: [{ id: "D-7", status: "approved", statusAt: iso(0) }] }))[0]!, /^FLIGHT PLAN: D-7/);
});

const blockedJob = (min: number) => ({ state: "blocked" as const, tempo: "blocked", needs: "SUPERVISOR: approve CHARTER?", since: iso(-min) });

test("capBlockedOf(ATC-565): CAP을 넘고 job이 blocked인 채 waitAlertMin 이상일 때만. 시각은 job 기록의 blocked 시작", () => {
  const at = (o: Partial<Parameters<typeof capBlockedOf>[0]>) => capBlockedOf({ session: "OCC", context: 694_000, cap: 500_000, job: blockedJob(104), waitAlertMin: 60, now: T0, ...o });
  const b = at({ others: ["턴 사이가 아님 — …", "RTS: x"] })!;
  assert.deepEqual([b.minutes, b.needs, b.since, b.others], [104, "SUPERVISOR: approve CHARTER?", iso(-104), ["RTS: x"]]);
  assert.equal(at({ job: blockedJob(59) }), null);
  assert.equal(at({ context: 400_000 }), null);
  assert.equal(at({ cap: null }), null);
  assert.equal(at({ job: { state: "done", tempo: "idle", since: iso(-200) } }), null);
  assert.equal(at({ job: { state: "blocked", tempo: "blocked" } }), null); // 시작 시각을 모르면 세지 않는다
});

test("SUPERVISOR ALERT recycle|blocked(ATC-565): CAUTION 카드 하나가 CAP과 막는 것을 말하고, 같은 세션의 wait·over 카드는 내지 않는다. HOME에 닿는다", () => {
  const base = { sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null };
  const capBlocked = [capBlockedOf({ session: "OCC", context: 694_000, cap: 500_000, job: blockedJob(104), waitAlertMin: 60, now: T0 })!];
  const out = supervisorAlertsOf({
    ...base,
    capBlocked,
    waiting: [{ session: "OCC", context: 694_000, cap: 500_000, blocks: ["턴 사이가 아님"], since: iso(-70), minutes: 70 }, { session: "TOWER", context: 706_000, cap: 500_000, blocks: ["overdue CLEARANCE 8건: …"], since: iso(-114), minutes: 114 }],
    overCap: [{ session: "OCC", context: 694_000, cap: 500_000, since: iso(-200) }],
  }).filter((a) => a.group === "recycle");
  assert.deepEqual(out.map((a) => a.key).sort(), ["recycle|blocked|OCC", "recycle|wait|TOWER"]);
  const card = out.find((a) => a.key === "recycle|blocked|OCC")!;
  assert.equal(card.level, "caution");
  assert.match(card.text, /OCC 컨텍스트 694k > CAP 500k, 104분째 SUPERVISOR를 기다리며 blocked라 재시작할 수 없음: SUPERVISOR: approve CHARTER\?/);
  assert.match(card.next, /OCC이 묻는 것에 답한다/);
  assert.equal(card.since, iso(-104));
  assert.equal(destOf(card), "alerts");
  assert.equal(alertRowOf(card.key)?.family, "recycle|blocked");
  assert.ok(ALERT_CONTRACT.some((r) => r.family === "recycle|blocked" && r.endsBy === "capBlockedOf"));
});

// 오작동 수: FLIGHT RECORDER의 recycle 줄(carried)과 clearances 기록에서
const rec = (min: number, carried?: string[]) => ({ t: iso(min), session: "TOWER", result: "recycled", ...(carried ? { carried } : {}) });

test("carryCounterOf(ATC-565): 이미 RESEND한 고리에 새 세션이 또 보내면 중복, RESEND가 필요했는데 30분 안에 RESEND·답·취소가 없으면 놓침", () => {
  const cs = [
    mk("C-1", 0, "FIX", "FIX PR #1"), // 재시작 전 RESEND 있음 → 새 세션이 또 보냄 = 중복
    mk("C-2", 11, "FIX", "RESEND FIX PR #1"),
    mk("C-3", 100, "FIX", "RESEND FIX PR #1"),
    mk("C-4", 0, "FIX", "FIX PR #4"), // RESEND 없이 넘김 → 새 세션이 RESEND = 정상
    mk("C-5", 95, "FIX", "RESEND FIX PR #4"),
    mk("C-6", 0, "FIX", "FIX PR #6"), // RESEND 없이 넘김 → 아무것도 없음 = 놓침
    mk("C-7", 0, "FIX", "FIX PR #7", { readbackAt: iso(91), ackWord: "READBACK" }), // 새 세션 뒤 답이 옴 = 정상
  ];
  const now = T0 + 200 * 60_000;
  const c = carryCounterOf([rec(90, ["C-1", "C-2", "C-4", "C-6", "C-7"])], cs, now);
  assert.deepEqual([c.restarts, c.chains, c.repeated, c.lost, c.misfires], [1, 4, 1, 1, 1]); // C-2는 C-1과 한 고리
  assert.deepEqual(c.recent[0], { t: iso(90), carried: 4, repeated: ["C-1"], lost: ["C-6"] });
  // 30분이 안 지났으면 아직 놓친 것이 아니다
  assert.equal(carryCounterOf([rec(90, ["C-6"])], cs, T0 + (90 * 60_000 + LOST_AFTER_MS - 1)).lost, 0);
  // 다음 TOWER 재시작 뒤의 RESEND는 그 재시작의 몫이다
  const two = carryCounterOf([rec(90, ["C-1"]), rec(95)], cs, now);
  assert.equal(two.repeated, 0);
  // carried가 없는 재시작, 다른 세션, 실패한 재시작은 세지 않는다
  assert.equal(carryCounterOf([rec(90), { ...rec(90, ["C-6"]), session: "OCC" }, { ...rec(90, ["C-6"]), result: "launch-failed" }], cs, now).restarts, 0);
  // 30일 밖은 세지 않는다
  assert.equal(carryCounterOf([rec(90, ["C-6"])], cs, now + 31 * 86_400_000).restarts, 0);
});

test("TOWER CARRY-OVER 스위치: 기본 on, 깨진 값은 on, off만 off. 임시 파일에 원자적으로 쓴다", () => {
  assert.equal(parseCarrySwitch(undefined), "on");
  assert.equal(parseCarrySwitch("nope"), "on");
  assert.equal(parseCarrySwitch("off"), "off");
  const f = join(mkdtempSync(join(tmpdir(), "atc-carry-")), "control-recycle-carry.json");
  assert.equal(loadCarrySwitch(f), "on");
  saveCarrySwitch("off", "test", f);
  assert.equal(loadCarrySwitch(f), "off");
  saveCarrySwitch("on", "test", f);
  assert.equal(loadCarrySwitch(f), "on");
});
