import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_EFFECT, accountViewOf, CONTROL_MODEL_NOTE, CONTROL_POLL_MS, controlFuelOf, controlGroupFacts, controlGroupOf, controlPollDue, controlRow2Of, controlRowOf, type ControlSession, commonOf, dominantModelOf, modelFamilyOf } from "./control-view.ts";
import type { Job } from "./job-state.ts";

const job = (state: Job["state"], over: Partial<Job> = {}): Job => ({ state, detail: "d", needs: null, suggestedReply: null, since: null, ...over });
const sess = (over: Partial<ControlSession> = {}): ControlSession => ({ name: "TOWER", dir: "controller", prompt: "start", launch: "bg", blocked: null, live: [], ...over });

test("controlRowOf: 세션이 없으면 not running과 LAUNCH", () => {
  const r = controlRowOf(sess());
  assert.equal(r.badge, "not running");
  assert.equal(r.tone, "dead");
  assert.deepEqual(r.action, { kind: "launch", disabled: false, title: null });
  assert.equal(r.dir, "controller/");
  assert.equal(r.how, "claude --bg");
});

test("controlRowOf: background 세션은 BG 배지와 STOP, job이 blocked면 NEEDS YOU, working이면 한 줄", () => {
  const blocked = controlRowOf(sess({ live: [{ kind: "background", id: "ab12", status: "busy", job: job("blocked", { needs: "승인" }) }] }));
  assert.equal(blocked.badge, "BG ab12");
  assert.equal(blocked.tone, "busy");
  assert.equal(blocked.detail, "busy");
  assert.deepEqual(blocked.action, { kind: "stop", tmux: null });
  assert.equal(blocked.needs?.needs, "승인");
  assert.equal(blocked.working, null);
  const working = controlRowOf(sess({ live: [{ kind: "background", id: "cd34", job: job("working", { detail: "diff 읽는 중" }) }] }));
  assert.equal(working.working?.detail, "diff 읽는 중");
  assert.equal(working.needs, null);
  assert.equal(controlRowOf(sess({ live: [{ kind: "background", id: "ef56", job: job("working", { detail: "" }) }] })).working, null);
});

test("controlRowOf: tmux pane 세션은 tmux 배지와 pane 이름이 든 STOP", () => {
  const r = controlRowOf(sess({ live: [{ kind: "interactive", name: "TOWER", status: "idle", tmux: "atc:1" }] }));
  assert.equal(r.badge, "tmux atc:1");
  assert.equal(r.detail, "TOWER · idle");
  assert.deepEqual(r.action, { kind: "stop", tmux: "atc:1" });
  assert.equal(r.how, "tmux에서 연 세션");
});

test("controlRowOf: 데스크톱 세션은 interactive, LAUNCH는 꺼지고 STOP은 없다", () => {
  const r = controlRowOf(sess({ live: [{ kind: "interactive", name: "OCC" }] }));
  assert.equal(r.badge, "interactive");
  assert.equal(r.tone, "other");
  assert.match(r.detail ?? "", /데스크톱 세션은 그 창에서 닫는다/);
  assert.deepEqual(r.action, { kind: "launch", disabled: true, title: null });
});

test("controlRowOf: launch가 없는 줄(ENGINEERING)은 버튼 없이 배지만, blocked 사유는 launch가 있는 줄에만", () => {
  const eng = controlRowOf(sess({ name: "ENGINEERING", dir: null, prompt: null, launch: null, blocked: "사유" }));
  assert.equal(eng.action, null);
  assert.equal(eng.launchOff, null);
  assert.equal(eng.dir, "저장소 뿌리");
  assert.equal(eng.how, null);
  const off = controlRowOf(sess({ blocked: "폴더 없음" }));
  assert.deepEqual(off.action, { kind: "launch", disabled: true, title: "폴더 없음" });
  assert.equal(off.launchOff, "폴더 없음");
});

test("controlRowOf: STALE job id는 live가 아니라 LAUNCH를 막지 않는다", () => {
  const r = controlRowOf(sess({ stale: [{ id: "s1" }, { id: "s2" }, {}] }));
  assert.deepEqual(r.stale, ["s1", "s2"]);
  assert.equal(r.badge, "not running");
  assert.deepEqual(r.action, { kind: "launch", disabled: false, title: null });
});

test("controlPollDue: 처음이거나 60초가 지났거나 동작 뒤(force)일 때만 읽는다", () => {
  const now = 1_000_000;
  assert.equal(controlPollDue(null, now), true);
  assert.equal(controlPollDue(now - 1, now), false);
  assert.equal(controlPollDue(now - CONTROL_POLL_MS + 1, now), false);
  assert.equal(controlPollDue(now - CONTROL_POLL_MS, now), true);
  assert.equal(controlPollDue(now, now, true), true);
});

// ── FLEET CONTROL 그룹(ATC-132) ──
const acct = (name: string, label: string | null, account: string | null = label) => ({ name, label, account });
const ctxView = { contextTokens: 200_000, window: 1_000_000, at: "2026-09-29T08:00:00.000Z", pct: 0.2, fobPct: 80, model: "claude-sonnet-5-5", windowSource: "statusline" as const, compacted: false };

test("controlRow2Of: 상태는 NOT RUNNING·NEEDS YOU·BUSY·IDLE, 색은 AIRCRAFT와 같은 st-* 클래스", () => {
  const dead = controlRow2Of(sess());
  assert.equal(dead.status, "NOT RUNNING");
  assert.equal(dead.statusClass, "st-NOT-IN-SERVICE");
  const needs = controlRow2Of(sess({ live: [{ kind: "background", id: "ab12", status: "idle", job: job("blocked", { needs: "승인", detail: "plan" }) }] }));
  assert.equal(needs.status, "NEEDS YOU");
  assert.equal(needs.statusClass, "st-NEEDS-YOU");
  assert.equal(needs.startsOpen, true);
  assert.deepEqual(needs.flying, { text: "승인 — plan", title: "승인 — plan" });
  const busy = controlRow2Of(sess({ live: [{ kind: "background", id: "cd34", status: "busy", job: job("working", { detail: "diff 읽는 중" }) }] }));
  assert.equal(busy.status, "BUSY");
  assert.equal(busy.statusClass, "st-AIRBORNE");
  assert.equal(busy.startsOpen, false);
  assert.equal(busy.flying?.text, "diff 읽는 중");
  const byJob = controlRow2Of(sess({ live: [{ kind: "background", id: "ef56", status: "idle", job: job("working", { detail: "d" }) }] }));
  assert.equal(byJob.status, "BUSY"); // job이 working이면 live status가 idle이어도 BUSY
  const idle = controlRow2Of(sess({ live: [{ kind: "background", id: "gh78", status: "idle", job: null }] }));
  assert.equal(idle.status, "IDLE");
  assert.equal(idle.statusClass, "st-HOLDING");
  assert.equal(idle.flying, null);
  assert.equal(controlRow2Of(sess({ live: [{ kind: "interactive", name: "OCC", status: "busy" }] })).status, "BUSY"); // 데스크톱 세션
});

test("controlRow2Of: 주기·마지막 활동·FOB·FUEL·origin 칩. 없으면 null(0이 아니다)", () => {
  const r = controlRow2Of(sess({ prompt: "/loop 3m /tick", live: [{ kind: "background", id: "ab12", status: "busy", job: null }] }), {
    session: { lastActiveAt: "2026-09-29T08:01:00.000Z", permissionMode: "auto" },
    fuel: { cost: 4.256, requests: 120, models: { "claude-sonnet-5-5": 100, "claude-opus-5-5": 20 }, context: ctxView },
    account: acct("TOWER", "acct-2"),
  });
  assert.equal(r.intervalMin, 3);
  assert.equal(r.lastActiveAt, "2026-09-29T08:01:00.000Z");
  assert.equal(r.fob?.fobPct, 80);
  assert.deepEqual(r.fuel, { label: "$4.26", title: "최근 14일 FUEL COST $4.26 · 요청 120건" });
  assert.equal(r.model, "Sonnet");
  assert.equal(r.account, "acct-2");
  assert.equal(r.origin?.badge, "BG");
  assert.equal(r.origin?.mode, "auto");
  const bare = controlRow2Of(sess({ prompt: null }));
  assert.equal(bare.intervalMin, null);
  assert.equal(bare.lastActiveAt, null);
  assert.equal(bare.fob, null);
  assert.equal(bare.fuel, null);
  assert.equal(bare.model, null);
  assert.equal(bare.account, null);
  assert.equal(bare.origin, null);
  assert.equal(controlRow2Of(sess({ live: [{ kind: "interactive", tmux: "atc:1", status: "idle" }] })).origin?.badge, "TERM");
  assert.equal(controlRow2Of(sess({ live: [{ kind: "interactive", name: "OCC" }] })).origin?.badge, "DESKTOP");
});

test("controlRow2Of: 접힌 줄의 폴더는 이름과 다를 때만(controller/), 같으면 뺀다", () => {
  assert.equal(controlRow2Of(sess({ name: "TOWER", dir: "controller" })).dirShort, "controller/");
  assert.equal(controlRow2Of(sess({ name: "OCC", dir: "occ" })).dirShort, null);
  assert.equal(controlRow2Of(sess({ name: "ENGINEERING", dir: null, launch: null })).dirShort, "저장소 뿌리");
});

test("controlFuelOf: 값 매긴 요청이 없으면 null(0이 아니다), 있으면 $ 두 자리", () => {
  assert.equal(controlFuelOf(null), null);
  assert.equal(controlFuelOf({ cost: null, requests: 10, models: {}, context: null }), null);
  assert.equal(controlFuelOf({ cost: 0, requests: 0, models: {}, context: null }), null);
  assert.equal(controlFuelOf({ cost: 0, requests: 3, models: {}, context: null })?.label, "$0.00");
});

test("modelFamilyOf·dominantModelOf: 계열 이름과 요청이 가장 많은 모델", () => {
  assert.equal(modelFamilyOf("claude-opus-5-5"), "Opus");
  assert.equal(modelFamilyOf("claude-sonnet-5-5"), "Sonnet");
  assert.equal(modelFamilyOf("gpt-x"), "gpt-x");
  assert.equal(dominantModelOf({ "claude-sonnet-5-5": 5, "claude-opus-5-5": 9 }), "Opus");
  assert.equal(dominantModelOf({}), null);
  assert.equal(dominantModelOf(undefined), null);
});

test("commonOf: 가장 흔한 값, 같은 수면 먼저 나온 값, 값이 없으면 null", () => {
  assert.equal(commonOf(["a", "b", "b", null]), "b");
  assert.equal(commonOf(["a", "b"]), "a");
  assert.equal(commonOf([null, undefined]), null);
});

test("controlGroupOf: ACCOUNT·띄운 방식·permission mode는 그룹 값과 다른 줄만 differs", () => {
  const live = (id: string) => [{ kind: "background", id, status: "idle" as const, job: null }];
  const rows = [
    controlRow2Of(sess({ name: "TOWER", live: live("a1") }), { account: acct("TOWER", "acct-2"), session: { lastActiveAt: null, permissionMode: "auto" } }),
    controlRow2Of(sess({ name: "OCC", live: live("a2") }), { account: acct("OCC", "acct-2"), session: { lastActiveAt: null, permissionMode: "auto" } }),
    controlRow2Of(sess({ name: "MCC", live: [{ kind: "interactive", tmux: "atc:2", status: "idle" }] }), { account: acct("MCC", "acct-3"), session: { lastActiveAt: null, permissionMode: "acceptEdits" } }),
    controlRow2Of(sess({ name: "REVIEW", live: live("a4") }), { account: acct("REVIEW", "acct-2"), session: { lastActiveAt: null, permissionMode: "auto" } }),
  ];
  const { group, rows: out } = controlGroupOf(rows);
  assert.equal(group.account, "acct-2");
  assert.equal(group.method, "claude --bg");
  assert.equal(group.permission, "auto");
  assert.deepEqual(out.map((r) => [r.name, r.accountDiffers, r.methodDiffers, r.permissionDiffers]), [
    ["TOWER", false, false, false],
    ["OCC", false, false, false],
    ["MCC", true, true, true],
    ["REVIEW", false, false, false],
  ]);
  assert.equal(group.count, 4);
});

test("controlGroupOf: 모두 같으면 differs가 없고, 값이 없는 줄(null)은 다르다고 하지 않는다", () => {
  const rows = [controlRow2Of(sess({ name: "TOWER" }), { account: acct("TOWER", "acct-2") }), controlRow2Of(sess({ name: "ENGINEERING", dir: null, prompt: null, launch: null }), { account: null })];
  const { group, rows: out } = controlGroupOf(rows);
  assert.equal(group.account, "acct-2");
  assert.deepEqual(out.map((r) => r.accountDiffers), [false, false]);
  assert.equal(controlGroupOf([]).group.account, null);
});

test("controlGroupOf: 상태 수(NOT RUNNING·NEEDS YOU)와 daemon 경고를 그룹에 싣는다", () => {
  const rows = [
    controlRow2Of(sess({ name: "TOWER" })),
    controlRow2Of(sess({ name: "OCC", live: [{ kind: "background", id: "x1", job: job("blocked", { needs: "n" }) }] })),
    controlRow2Of(sess({ name: "MCC", live: [{ kind: "background", id: "x2", status: "busy" }] })),
  ];
  const { group } = controlGroupOf(rows, true);
  assert.deepEqual([group.notRunning, group.needsYou, group.daemonInService], [1, 1, true]);
});

test("controlGroupFacts: 공통 사실 한 줄. 모델은 실제 기록에서 계열별로, 기록이 없으면 폴더 설정 안내", () => {
  const fuel = (m: string) => ({ cost: 1, requests: 5, models: { [m]: 5 }, context: null });
  const live = [{ kind: "background", id: "a", status: "idle" as const, job: null }];
  const mk = (name: string, m: string | null) =>
    controlRow2Of(sess({ name, live }), { account: acct(name, "acct-2"), session: { lastActiveAt: null, permissionMode: "auto" }, fuel: m ? fuel(m) : null });
  const mixed = controlGroupOf([mk("TOWER", "claude-sonnet-5-5"), mk("OCC", "claude-sonnet-5-5"), mk("MCC", "claude-opus-5-5")]).group;
  assert.deepEqual(controlGroupFacts(mixed), ["claude --bg", "auto", "acct-2", "model: TOWER·OCC Sonnet, MCC Opus"]);
  const one = controlGroupOf([mk("TOWER", "claude-sonnet-5-5"), mk("OCC", "claude-sonnet-5-5")]).group;
  assert.equal(controlGroupFacts(one).at(-1), "model: Sonnet");
  const none = controlGroupOf([mk("TOWER", null)]).group;
  assert.equal(controlGroupFacts(none).at(-1), CONTROL_MODEL_NOTE);
  const bare = controlGroupOf([controlRow2Of(sess({ name: "TOWER", launch: null }))]).group;
  assert.deepEqual(controlGroupFacts(bare), [CONTROL_MODEL_NOTE]); // 모르는 사실은 빠진다
});

test("accountViewOf: FUEL ACCOUNT 블록이 있으면 그것 하나, 옛 서버(fuelAccounts 없음)면 FLEET PLAN 줄, 둘 다 없으면 없음", () => {
  assert.equal(accountViewOf([{}], [{}]), "fuel");
  assert.equal(accountViewOf([{}], undefined), "fuel");
  assert.equal(accountViewOf(undefined, [{}]), "plan");
  assert.equal(accountViewOf(null, [{}]), "plan");
  assert.equal(accountViewOf(undefined, []), null);
  assert.equal(accountViewOf([], [{}]), null); // 응답이 있고 비었으면 보일 ACCOUNT가 없다
});

test("ACCOUNT_EFFECT: hold면 LAUNCH·ENTRY 제안 안 함, info면 사유 줄, ok는 없음", () => {
  assert.equal(ACCOUNT_EFFECT.ok, null);
  assert.equal(ACCOUNT_EFFECT.info, "제안에 FUEL 사유 줄");
  assert.equal(ACCOUNT_EFFECT.hold, "LAUNCH·ENTRY 제안 안 함");
});
