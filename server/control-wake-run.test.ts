import { hermeticRoot } from "./test-hermetic.ts";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { controlWakeData, controlWakePass, pendingWakeOf, wakeModeLive, wakeScope, type WakeDeps } from "./control-wake-run.ts";
import { loadWakeSwitch, saveWakeMode } from "./control-wake-switch.ts";
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
const tower = (over: Record<string, unknown> = {}) => ({ cursor: "ep:1", reset: false, events: [], open: {}, landingQueue: [], relays: [], clearances: { pending: [], overdue: [] }, ...over });
function deps(over: Partial<WakeDeps> = {}) {
  const calls: CheckedSend[] = [];
  const acks: string[] = [];
  const d: WakeDeps = {
    now: () => clock,
    force: true,
    rows: async () => [row],
    get: async (path) => {
      if (path.startsWith("/api/controller/brief")) return brief;
      if (path === "/api/mcc/queue") return { pulls: [] };
      return {};
    },
    ack: async (c) => void acks.push(c),
    deliver: async (send): Promise<DeliverResult> => {
      calls.push(send);
      const msgId = `m-${calls.length}`;
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

test("LAUNCH의 첫 프롬프트: wake면 /loop 없는 글, loop면 오늘의 /loop. REVIEW는 그대로", () => {
  const spec = (n: string) => CONTROL_SESSIONS.find((s) => s.name === n)!;
  assert.deepEqual(controlPromptOf(spec("TOWER"), { tower: "loop", occ: "wake", mcc: "wake" }), { prompt: "/loop 3m /tick", wake: false });
  const w = controlPromptOf(spec("OCC"), { tower: "loop", occ: "wake", mcc: "wake" });
  assert.equal(w.wake, true);
  assert.match(w.prompt!, /^\[ATC WAKE BOOT\] OCC/);
  assert.deepEqual(controlPromptOf(spec("REVIEW"), { tower: "wake", occ: "wake", mcc: "wake" }), { prompt: "/loop 10m /tick", wake: null });
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
