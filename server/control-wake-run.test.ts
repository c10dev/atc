import { hermeticRoot } from "./test-hermetic.ts";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { controlWakeData, controlWakePass, pendingWakeOf, transitionPassForTest, wakeFallbackStuckNow, wakeModeLive, wakeScope, type WakeDeps } from "./control-wake-run.ts";
import { effectiveWakeOf } from "./control-wake-switch.ts";
import { loadWakeSwitch, saveWakeDaily, saveWakeMode } from "./control-wake-switch.ts";
import type { ActDeps, FactDeps } from "./control-recycle-run.ts";
import type { Snapshot } from "./model.ts";
import { readRecords, record } from "./recorder.ts";
import type { CheckedSend } from "./send-checks.ts";
import { breakerOf } from "./server-send.ts";
import { CONTROL_SESSIONS, controlPromptOf } from "./session-control.ts";
import { type DeliverResult, transcriptOf } from "./session-socket.ts";
import { mountTick } from "./tick-run.ts";

// CONTROL WAKE(ATC-557 a)의 입출력. 임시 상태 폴더(test-hermetic), 임시 ~/.claude/sessions의 가짜 세션 파일, 소켓 쓰기는 바꿔 끼운다(실제 세션에 쓰지 않는다).
// 시험 opt-in(ATC_SERVER_SEND_TEST=1)과 버리는 세션 이름 머리(ATC_CONTROL_WAKE_TEST_PREFIX)로 진짜 TOWER 대신 WAKETEST_TOWER를 깨운다
const claude = join(hermeticRoot, "home", ".claude");
mkdirSync(join(claude, "sessions"), { recursive: true });
const W = join(tmpdir(), "atc557-run-w");
process.env.ATC_SERVER_SEND_TEST = "1";
process.env.ATC_CONTROL_WAKE_TEST_PREFIX = "WAKETEST_";
mkdirSync(join(claude, "projects", W.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });
mkdirSync(config.stateDir, { recursive: true });

const T0 = Date.now();
let clock = T0;
const snap = {} as Snapshot;
// 가짜 세션 하나(background, 확인한 프로토콜, cwd는 임시 폴더 아래)
const sid = "sess-wake-tower";
writeFileSync(join(claude, "sessions", "5151.json"), JSON.stringify({ pid: 5151, sessionId: sid, name: "WAKETEST_TOWER", kind: "bg", cwd: W, messagingSocketPath: "/run/user/1000/cc-socks/5151.sock", peerProtocol: 1, status: "idle" }));
const row = { id: "job5151", sessionId: sid, name: "WAKETEST_TOWER", kind: "background", cwd: W, pid: 5151 };

let brief: Record<string, unknown> = {};
let reviews: Record<string, unknown> = { pending: [] };
let msgSeq = 0;
const tower = (over: Record<string, unknown> = {}) => ({ cursor: "ep:1", reset: false, events: [], open: {}, landingQueue: [], relays: [], clearances: { pending: [], overdue: [] }, ...over });
function deps(over: Partial<WakeDeps> = {}) {
  const calls: CheckedSend[] = [];
  const acks: string[] = [];
  const d: WakeDeps = {
    now: () => clock,
    force: true,
    noDaily: true, // 하루 한 번 점검 턴은 아래 시험이 정한 시각으로만 본다
    rows: async () => [row],
    get: async (path) => {
      if (path.startsWith("/api/controller/brief")) return brief;
      if (path === "/api/mcc/queue") return { pulls: [] };
      if (path === "/api/landing/reviews") return reviews;
      return {};
    },
    ack: async (c) => void acks.push(c),
    deliver: async (send): Promise<DeliverResult> => {
      calls.push(send);
      const msgId = `m-${++msgSeq}`; // 시험마다 새 deps라도 msg_id는 겹치지 않게(확인 줄이 msg_id로 짝짓는다)
      appendFileSync(transcriptOf(claude, W, send.sessionId), JSON.stringify({ type: "user", origin: { kind: "peer", msg_id: msgId }, message: { role: "user", content: send.text } }) + "\n");
      return { ok: true, msgId, pid: 5151, configDir: claude, cwd: W };
    },
    ...over,
  };
  return { d, calls, acks };
}
const wakeLines = () => readRecords(T0 - 86_400_000).filter((l) => l.kind === "control-wake") as unknown as Record<string, unknown>[];

test("TOWER: 판단할 일이 생기면 다음 패스에 깨움 하나(입력과 글을 FLIGHT RECORDER에), 같은 일로 다시 깨우지 않는다, 결과 줄을 센다", async () => {
  brief = tower({ clearances: { pending: [{ id: "C-7", to: { name: "TEAM_A" }, type: "HOLD", flight: "ATC-9" }], overdue: ["C-7"] } });
  const { d, calls } = deps();
  let r = await controlWakePass(snap, d);
  assert.equal(r.writer, "test-opt-in");
  assert.equal(calls.length, 0); // 처음 본 패스는 기다린다
  clock += 30_000;
  r = await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  const send = calls[0]!;
  assert.equal(send.kind, "control-wake");
  assert.equal(send.to, "WAKETEST_TOWER");
  assert.match(send.text, /^\[ATC WAKE W-0001\] TOWER\n/);
  assert.match(send.text, /overdue: no READBACK for C-7 → TEAM_A/);
  const del = wakeLines().find((l) => l.op === "deliver")!;
  assert.deepEqual([del.id, del.role, del.menu, del.fresh, del.flights], ["W-0001", "tower", true, ["overdue:C-7"], ["ATC-9"]]);
  assert.equal(del.text, send.text); // 깨움의 입력 전체가 기록에 있다(원칙 7)
  assert.equal(pendingWakeOf(readRecords(T0 - 86_400_000) as never, "tower", clock), true);
  // 같은 일: 다시 깨우지 않는다
  clock += 120_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  // 세션이 답했다: 보임(confirm)과 결과 줄(nothing)
  appendFileSync(transcriptOf(claude, W, sid), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "checked\nWAKE RESULT: nothing" }] } }) + "\n");
  clock += 30_000;
  await controlWakePass(snap, d);
  const lines = wakeLines();
  assert.equal(lines.some((l) => l.op === "confirm" && l.seen === true), true);
  assert.equal(lines.find((l) => l.op === "result")?.result, "nothing");
  const data = controlWakeData(clock);
  assert.deepEqual([data.roles.tower!.wakes, data.roles.tower!.menu, data.roles.tower!.nothing, data.total.wakes], [1, 1, 1, 1]);
  assert.equal(pendingWakeOf(readRecords(T0 - 86_400_000) as never, "tower", clock), false);
});

test("TOWER: ATC LOG에만 적는 사건뿐이면 깨우지 않고 서버가 cursor를 ack한다", async () => {
  brief = tower({ cursor: "ep:9", events: [{ id: 9, kind: "handoff" }] });
  const { d, calls, acks } = deps();
  clock += 30 * 60_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 0);
  assert.deepEqual(acks, ["ep:9"]);
});

test("BREAKER 범위: 관제 깨움이 안 보여 멈춰도 팀 FLIGHT PLAN BREAKER와 다른 역할은 그대로다", () => {
  const now = Date.now();
  const t = (m: number) => new Date(now - m * 60_000).toISOString();
  record({ t: t(30), kind: "control-wake", op: "deliver", id: "W-0901", role: "occ", sessionId: "s", session: "OCC", pid: 1, msgId: "mx", transcript: null, textHash: "h", text: "x", check: "pass", menu: false, events: [], fresh: [], still: [], resolved: [], flights: [] });
  record({ t: t(5), kind: "control-wake", op: "confirm", id: "W-0901", role: "occ", msgId: "mx", sessionId: "s", seen: false, why: "idle" });
  const all = readRecords(now - 86_400_000) as never;
  assert.equal(breakerOf(all, now, wakeScope("occ")).state, "tripped");
  assert.equal(breakerOf(all, now).state, "armed"); // 팀(server-send)
  assert.equal(breakerOf(all, now, wakeScope("tower")).state, "armed");
  assert.equal(breakerOf(all, now, wakeScope("mcc")).state, "armed");
  // 그 역할의 스위치를 바꾸면 처음부터
  saveWakeMode("occ", "loop");
  saveWakeMode("occ", "wake");
  assert.equal(breakerOf(readRecords(now - 86_400_000) as never, Date.now(), wakeScope("occ")).state, "armed");
});

test("스위치 loop이고 세션도 /loop로 떴으면 깨우지 않는다(오늘과 같다)", async () => {
  saveWakeMode("tower", "loop");
  assert.equal(loadWakeSwitch().tower, "loop");
  brief = tower({ events: [{ id: 11, kind: "alert.raised" }] });
  const { d, calls } = deps();
  clock += 30 * 60_000;
  await controlWakePass(snap, d);
  clock += 30_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 0);
  saveWakeMode("tower", "wake");
});

test("LAUNCH의 첫 프롬프트: wake면 /loop 없는 글, loop면 오늘의 /loop. REVIEW도 같다(ATC-557 d), CROSSCHECK는 은퇴라 그대로", () => {
  const spec = (n: string) => CONTROL_SESSIONS.find((s) => s.name === n)!;
  assert.deepEqual(controlPromptOf(spec("TOWER"), { tower: "loop", occ: "wake", mcc: "wake", review: "wake" }), { prompt: "/loop 3m /tick", wake: false });
  const w = controlPromptOf(spec("OCC"), { tower: "loop", occ: "wake", mcc: "wake", review: "wake" });
  assert.equal(w.wake, true);
  assert.match(w.prompt!, /^\[ATC WAKE BOOT\] OCC/);
  const r = controlPromptOf(spec("REVIEW"), { tower: "wake", occ: "wake", mcc: "wake", review: "wake" });
  assert.equal(r.wake, true);
  assert.match(r.prompt!, /^\[ATC WAKE BOOT\] REVIEW\n[\s\S]*node \.\.\/controller\/atcctl\.mjs tick review --wake boot/);
  assert.deepEqual(controlPromptOf(spec("REVIEW"), { tower: "wake", occ: "wake", mcc: "wake", review: "loop" }), { prompt: "/loop 10m /tick", wake: false });
  const cc = spec("CROSSCHECK");
  if (cc) assert.equal(controlPromptOf(cc, { tower: "wake", occ: "wake", mcc: "wake", review: "wake" }).wake, null);
});

test("GET /api/tick: 깨움이 살아 있으면 /loop의 tick은 wakeMode만(브리핑·seen 없음), --wake는 평소대로이고 집어 든 줄을 남긴다", async () => {
  const app = new Hono();
  let live = true;
  mountTick(app, { get: async () => tower(), seenFile: () => join(config.stateDir, "tick-seen-test.json"), wakeLive: () => ({ live }) });
  const loopTick = (await (await app.request("/api/tick/tower")).json()) as Record<string, unknown>;
  assert.deepEqual([loopTick.wakeMode, loopTick.act, loopTick.brief], [true, false, null]);
  const woke = (await (await app.request("/api/tick/tower?wake=W-0001")).json()) as Record<string, unknown>;
  assert.equal(woke.wakeMode, undefined);
  assert.notEqual(woke.brief, null);
  assert.equal(wakeLines().some((l) => l.op === "pickup" && l.id === "W-0001"), true);
  live = false; // 깨움이 죽으면 /loop tick이 다시 일한다
  assert.equal(((await (await app.request("/api/tick/tower")).json()) as Record<string, unknown>).wakeMode, undefined);
  // REVIEW는 깨움이 없다
  assert.equal(((await (await app.request("/api/tick/review")).json()) as Record<string, unknown>).wakeMode, undefined);
  // 이 시험 프로세스의 job은 운영 job이 아니다: 패스가 돈 뒤라 살아 있지만 BREAKER·스위치를 본다
  assert.equal(typeof wakeModeLive("mcc").live, "boolean");
});

// fail safe(ATC-557 리뷰): 깨움 BREAKER가 멈추면 그 역할은 loop로 — LAUNCH는 /loop, /loop 없이 뜬 세션은 한 번 다시 띄움(안 되면 CAUTION 카드),
// /loop의 tick은 TICK WAKE-MODE가 아니라 평소대로. 시험 깨움이 보여 다시 켜지면 wake로 돌아오고, 옮기기는 평소 규칙(cooldown)을 따른다
test("깨움 BREAKER가 멈추면 loop로 돌리고(기록·수·카드), 다시 켜지면 wake로 돌아온다", async () => {
  const sidM = "sess-wake-mcc";
  writeFileSync(join(claude, "sessions", "5252.json"), JSON.stringify({ pid: 5252, sessionId: sidM, name: "WAKETEST_MCC", kind: "bg", cwd: W, messagingSocketPath: "/run/user/1000/cc-socks/5252.sock", peerProtocol: 1, status: "idle" }));
  const tr = transcriptOf(claude, W, sidM);
  writeFileSync(tr, "");
  const base = clock + 6 * 3_600_000;
  const at = (min: number) => new Date(base + min * 60_000).toISOString();
  const deliver = (min: number, id: string, msgId: string) => record({ t: at(min), kind: "control-wake", op: "deliver", id, role: "mcc", sessionId: sidM, session: "WAKETEST_MCC", pid: 5252, msgId, transcript: tr, textHash: "h", text: "x", check: "pass", menu: false, events: [], fresh: [], still: [], resolved: [], flights: [] });
  // 깨움 하나가 30분째 대화 기록에 보이지 않는다(받는 세션은 idle)
  deliver(0, "W-0801", "mm-1");
  clock = base + 30 * 60_000;
  await controlWakePass(snap, deps({ rows: async () => [] }).d);
  const lines = () => readRecords(T0 - 86_400_000) as unknown as Record<string, unknown>[];
  assert.equal(lines().some((l) => l.op === "breaker" && l.role === "mcc" && l.event === "trip"), true);
  assert.equal(lines().filter((l) => l.op === "fallback" && l.role === "mcc" && l.to === "loop").length, 1);
  const eff = () => effectiveWakeOf(loadWakeSwitch(), lines() as never, clock).eff;
  assert.equal(eff().mcc, "loop"); // 스위치는 wake 그대로, 실제 모드는 loop
  assert.equal(eff().tower, "wake");
  const spec = CONTROL_SESSIONS.find((x) => x.name === "MCC")!;
  assert.equal(controlPromptOf(spec, eff()).prompt, "/loop 5m /tick"); // 지금 LAUNCH하면 /loop
  // /loop tick은 평소대로(WAKE-MODE 아님)
  const w = wakeModeLive("mcc", clock);
  assert.equal(w.live, false);
  assert.match(w.why, /BREAKER/);
  const app = new Hono();
  mountTick(app, { get: async () => ({ pulls: [] }), seenFile: () => join(config.stateDir, "tick-seen-mcc.json") });
  assert.equal(((await (await app.request("/api/tick/mcc")).json()) as Record<string, unknown>).wakeMode, undefined);

  // /loop 없이 뜬 MCC(jobM, wake: true)를 /loop로 다시 띄운다: CONTROL RECYCLE mode가 off면 못 하고 CAUTION 카드
  record({ t: at(-60), kind: "control", op: "launch", session: "MCC", by: "WAKE", ok: true, jobId: "aaaa01", wake: true });
  mkdirSync(join(claude, "jobs", "aaaa01"), { recursive: true });
  writeFileSync(join(claude, "jobs", "aaaa01", "state.json"), JSON.stringify({ state: "done", tempo: "idle", updatedAt: at(29) }));
  const row = { id: "aaaa01", sessionId: sidM, name: "MCC", kind: "background", cwd: "/w/mcc", pid: 999_999 };
  const launched: string[] = [];
  const act: ActDeps = { stop: async () => ({ ok: true }), rowsOf: async () => [], pidAlive: () => false, launch: async (name) => (launched.push(name), { ok: true, jobId: "bbbb02" }), sleep: async () => {} };
  const facts: FactDeps = { rtsBusy: async () => null, towerEvents: () => 0, now: () => clock };
  let r = await transitionPassForTest(snap, loadWakeSwitch(), [row], lines() as never, { facts, act }, clock);
  assert.equal(r, null);
  const stuck = wakeFallbackStuckNow();
  assert.deepEqual(stuck.map((x) => x.role), ["MCC"]);
  assert.match(stuck[0]!.why, /mode off/);
  // 카드(control|wake|MCC, CAUTION)를 그리는 것은 queue-contract.test.ts의 고정 자료가 본다
  // mode on이면 곧장(업타임·3시간 cooldown 없이) 한 번 다시 띄운다
  writeFileSync(join(config.stateDir, "control-recycle.json"), JSON.stringify({ mode: "on" }));
  r = await transitionPassForTest(snap, loadWakeSwitch(), [row], lines() as never, { facts, act }, clock);
  assert.deepEqual([r?.role, r?.result, launched], ["mcc", "recycled", ["MCC"]]);
  const tl = lines().filter((l) => l.op === "transition" && l.role === "mcc").at(-1)!;
  assert.deepEqual([tl.from, tl.to, tl.cause, tl.ok], ["wake", "loop", "breaker", true]);
  assert.deepEqual(wakeFallbackStuckNow(), []);

  // 30분 뒤 시험 깨움이 보인다 → 다시 켜짐 → return 줄, 실제 모드 wake
  record({ t: at(1), kind: "control", op: "launch", session: "MCC", by: "WAKE", ok: true, jobId: "bbbb02", wake: false });
  deliver(61, "W-0802", "mm-2");
  appendFileSync(tr, JSON.stringify({ type: "user", origin: { kind: "peer", msg_id: "mm-2" } }) + "\n");
  clock = base + 62 * 60_000;
  await controlWakePass(snap, deps({ rows: async () => [] }).d);
  assert.equal(lines().some((l) => l.op === "breaker" && l.role === "mcc" && l.event === "rearm"), true);
  assert.equal(lines().filter((l) => l.op === "fallback" && l.role === "mcc" && l.to === "wake").length, 1);
  assert.equal(eff().mcc, "wake");
  const d = controlWakeData(clock);
  assert.deepEqual([d.roles.mcc!.fallbacks, d.roles.mcc!.returns, d.roles.mcc!.effective], [1, 1, "wake"]);
  // 평소의 옮기기(loop → wake)는 평소 규칙: 방금 시도해서 3시간 cooldown
  const row2 = { ...row, id: "bbbb02" };
  writeFileSync(join(claude, "jobs", "aaaa01", "state.json"), JSON.stringify({ state: "done", tempo: "idle", updatedAt: at(60) }));
  mkdirSync(join(claude, "jobs", "bbbb02"), { recursive: true });
  writeFileSync(join(claude, "jobs", "bbbb02", "state.json"), JSON.stringify({ state: "done", tempo: "idle", updatedAt: at(60) }));
  r = await transitionPassForTest(snap, loadWakeSwitch(), [row2], lines() as never, { facts, act }, clock);
  assert.equal(r, null);
  assert.match(String(controlWakeData(clock).roles.mcc!.waiting), /3시간/);
  r = await transitionPassForTest(snap, loadWakeSwitch(), [row2], lines() as never, { facts, act }, clock + 3 * 3_600_000 + 1000);
  assert.deepEqual([r?.role, launched.length], ["mcc", 2]);
  assert.equal(lines().filter((l) => l.op === "transition" && l.role === "mcc").at(-1)!.to, "wake");
  writeFileSync(join(config.stateDir, "control-recycle.json"), JSON.stringify({ mode: "off" }));
});

test("운영 서버도 opt-in도 아니면 아무것도 하지 않는다(시험 서버)", async () => {
  delete process.env.ATC_SERVER_SEND_TEST;
  const { d, calls } = deps();
  brief = tower({ events: [{ id: 12, kind: "alert.raised" }] });
  const before = wakeLines().length;
  clock += 30 * 60_000;
  const r = await controlWakePass(snap, d);
  assert.equal(r.writer, null);
  assert.equal(calls.length, 0);
  assert.equal(wakeLines().length, before);
  process.env.ATC_SERVER_SEND_TEST = "1";
});

test("REVIEW(ATC-557 d): 착륙 리뷰를 기다리는 PR head가 사건, 깨움 하나에 2건까지 — 나머지는 앞 깨움이 끝난 뒤 다음 깨움에", async () => {
  const sidR = "sess-wake-review";
  writeFileSync(join(claude, "sessions", "5353.json"), JSON.stringify({ pid: 5353, sessionId: sidR, name: "WAKETEST_REVIEW", kind: "bg", cwd: W, messagingSocketPath: "/run/user/1000/cc-socks/5353.sock", peerProtocol: 1, status: "idle" }));
  const rowR = { id: "job5353", sessionId: sidR, name: "WAKETEST_REVIEW", kind: "background", cwd: W, pid: 5353 };
  const pr = (n: number) => ({ pr: `c10dev/vocado#${n}`, head: `abc${n}def`, title: `PR ${n}`, flight: `VOC-${n}` });
  reviews = { pending: [pr(1), pr(2), pr(3)] };
  clock = Date.parse("2030-01-02T00:10:00Z"); // 점검 시각(01:45Z) 전
  const { d, calls } = deps({ rows: async () => [rowR], noDaily: false });
  await controlWakePass(snap, d);
  assert.equal(calls.length, 0); // 처음 본 패스는 기다린다
  clock += 60_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  const t1 = calls[0]!.text;
  assert.match(t1, /^\[ATC WAKE W-\d{4}\] REVIEW\n/);
  assert.match(t1, /review-pending: PR c10dev\/vocado#1@abc1def/);
  assert.match(t1, /review-pending: PR c10dev\/vocado#2@abc2def/);
  assert.doesNotMatch(t1, /vocado#3/); // 2건까지
  assert.match(t1, /node \.\.\/controller\/atcctl\.mjs tick review --wake W-\d{4}/);
  assert.match(t1, /at most 2 per pass/);
  assert.equal(calls[0]!.to, "WAKETEST_REVIEW");
  // 앞 깨움이 끝나지 않았다(세션이 리뷰 중): 다음 깨움 없음. 15분 넘게 기다린 #3은 "깨우지 못함"이 아니다
  const sess = (status: string) => writeFileSync(join(claude, "sessions", "5353.json"), JSON.stringify({ pid: 5353, sessionId: sidR, name: "WAKETEST_REVIEW", kind: "bg", cwd: W, messagingSocketPath: "/run/user/1000/cc-socks/5353.sock", peerProtocol: 1, status }));
  sess("busy");
  clock += 16 * 60_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  sess("idle");
  // 세션이 2건을 리뷰하고 턴을 끝냈다 → 다음 패스에 #3
  appendFileSync(transcriptOf(claude, W, sidR), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "reviewed 2\nWAKE RESULT: acted" }] } }) + "\n");
  reviews = { pending: [pr(3)] };
  clock += 60_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 2);
  assert.match(calls[1]!.text, /vocado#3@abc3def/);
  assert.match(calls[1]!.text, /Resolved since then: review:c10dev\/vocado#1@abc1def/);
  const mine = () => (readRecords(clock - 86_400_000) as unknown as Record<string, unknown>[]).filter((l) => l.kind === "control-wake" && l.role === "review");
  assert.equal(mine().filter((l) => l.op === "missed").length, 0);
  assert.deepEqual(mine().find((l) => l.op === "deliver")!.fresh, ["review:c10dev/vocado#1@abc1def", "review:c10dev/vocado#2@abc2def"]);
});

test("하루 한 번 점검 턴(ATC-557 d): 그 역할의 시각 뒤 한 번, 따로 센다, 다시 시작해도 두 번 보내지 않고, /loop인 역할은 받지 않는다", async () => {
  const sidR = "sess-wake-review";
  const rowR = { id: "job5353", sessionId: sidR, name: "WAKETEST_REVIEW", kind: "background", cwd: W, pid: 5353 };
  const { d, calls } = deps({ rows: async () => [rowR], noDaily: false });
  // 앞 시험의 #3 깨움이 끝났다. 01:44Z: 아직 REVIEW의 시각(01:45Z) 전
  appendFileSync(transcriptOf(claude, W, sidR), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "WAKE RESULT: acted" }] } }) + "\n");
  reviews = { pending: [] };
  clock = Date.parse("2030-01-02T01:44:00Z");
  await controlWakePass(snap, d);
  assert.equal(calls.length, 0);
  clock = Date.parse("2030-01-02T01:46:00Z");
  await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  const t = calls[0]!.text;
  assert.match(t, /^\[ATC WAKE W-\d{4}\] REVIEW\nDaily review turn \(ATC-557\): once a UTC day \(01:45Z, 2030-01-02\)/);
  assert.match(t, /Your wakes in the last 24 h \(FLIGHT RECORDER\): 2 event wakes · acted 2/);
  assert.match(t, /REVIEW LOG line only/);
  assert.doesNotMatch(t, /DECISION card/); // REVIEW의 guard는 atcctl decision을 막는다
  assert.match(t, /tick review --wake W-\d{4}/);
  const del = (readRecords(clock - 86_400_000) as unknown as Record<string, unknown>[]).filter((l) => l.kind === "control-wake" && l.op === "deliver" && l.daily === true);
  assert.equal(del.length, 1);
  assert.deepEqual(del[0]!.events, [{ key: "daily:2030-01-02", kind: "daily-review", menu: false }]);
  // 결과 nothing: 점검 턴의 수로(오작동 "할 일 없이 깨움"이 아니다)
  appendFileSync(transcriptOf(claude, W, sidR), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "nothing to file\nWAKE RESULT: nothing" }] } }) + "\n");
  clock += 10 * 60_000;
  await controlWakePass(snap, d);
  // 서버를 다시 띄운 것처럼 상태 파일을 지워도 기록으로 오늘 보낸 것을 안다
  writeFileSync(join(config.stateDir, "control-wake-state.json"), JSON.stringify({ seq: 900, roles: {} }));
  clock += 3 * 3_600_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  const data = controlWakeData(clock);
  assert.deepEqual([data.roles.review!.daily, data.roles.review!.dailyNothing, data.roles.review!.nothing, data.roles.review!.wakes], [1, 1, 0, 2]);
  assert.equal(data.daily.mode, "on");
  assert.deepEqual(data.daily.roles.review, { at: "01:45Z", today: true });
  // 다음 날: 스위치 loop인 역할은 점검 턴을 받지 않는다
  saveWakeMode("review", "loop");
  clock = Date.parse("2030-01-03T02:00:00Z");
  await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  saveWakeMode("review", "wake");
  // 점검 턴 스위치 off
  saveWakeDaily("off");
  clock += 60_000;
  await controlWakePass(snap, d);
  assert.equal(calls.length, 1);
  saveWakeDaily("on");
});
