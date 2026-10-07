import { hermeticRoot } from "./test-hermetic.ts";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "./config.ts";
import { contentHashOf, sealWorkOrder } from "./input-binding.ts";
import type { Snapshot } from "./model.ts";
import { allProposals, append, type Op } from "./proposals.ts";
import { readRecords } from "./recorder.ts";
import { checkSend, type FlightPlanSend } from "./send-checks.ts";
import { type PassDeps, saveServerSendSwitch, serverOwnsWhy, serverSendData, serverSendPass } from "./server-send-run.ts";
import { type DeliverResult, transcriptOf } from "./session-socket.ts";

// ATC-562 SERVER SEND 한 바퀴(입출력). 임시 상태 폴더(test-hermetic)와 임시 ~/.claude/sessions의 가짜 세션 파일. 소켓 쓰기는 바꿔 끼운다(실제 세션에 쓰지 않는다)
const T0 = Date.now();
let clock = T0;
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const claude = join(hermeticRoot, "home", ".claude");
mkdirSync(join(claude, "sessions"), { recursive: true });
// 받는 세션의 cwd는 OS 임시 폴더 아래(시험 opt-in은 그 아래 세션에만 쓴다, ATC_SERVER_SEND_TEST)
const W = join(tmpdir(), "atc562-run-w");
process.env.ATC_SERVER_SEND_TEST = "1";
mkdirSync(join(claude, "projects", W.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });
mkdirSync(config.stateDir, { recursive: true });
writeFileSync(join(config.stateDir, "dispatch.json"), JSON.stringify({ mode: "approval" }));

let n = 0;
// 카드 하나: 새 id, 그 REGISTRATION의 세션(background) 하나
function card(reg: string, opts: { session?: "bg" | "interactive" | "none" } = {}) {
  n++;
  const id = `D-${String(9000 + n)}`;
  const sessionId = `sess-${n}`;
  const pid = 50_000 + n;
  if (opts.session !== "none") writeFileSync(join(claude, "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId, name: reg, kind: opts.session === "interactive" ? "interactive" : "bg", cwd: W, messagingSocketPath: `/run/user/1000/cc-socks/${pid}.sock`, peerProtocol: 1 }));
  append([{ op: "create", id, at: at(-30), kind: "ASSIGN", flight: `ATC-${9000 + n}`, aircraft: null, aircraftName: reg, registration: reg, airport: "ATCC", score: 1, factors: [] } as unknown as Op, { op: "approve", id, at: at(-20) }]);
  const session = { id: sessionId, name: reg, status: "idle", kind: opts.session === "interactive" ? "interactive" : "background", lastActiveAt: at(-1), cwd: W };
  return { id, reg, sessionId, session: opts.session === "none" ? null : session };
}
const snap = (...cards: { session: unknown }[]) => ({ sessions: cards.flatMap((c) => (c.session ? [c.session] : [])), restarting: [], tickets: [], workspaces: [], pulls: [], claims: [], clearances: [], fuel: {}, stranded: [], github: { enabled: false, fetchedAt: null }, linear: { fetchedAt: null } }) as unknown as Snapshot;
const textOf = (id: string) => sealWorkOrder(`[DISPATCH ${id}] FLIGHT PLAN @WOHASH · X\nwork\n— Send your reply to the session name "OCC" (SendMessage to: "OCC").\n— Reply to this message with "READBACK ${id} @WOHASH" if you take it, exactly like that.`).text;
function deps(results: DeliverResult[] = [], over: Partial<PassDeps> = {}) {
  const calls: FlightPlanSend[] = [];
  const d: PassDeps = {
    now: () => clock,
    message: async (p) => textOf(p.id),
    // 받는 세션처럼 대화 기록에 msg_id를 남긴다(확인이 "보임"이 되게). 실패 결과를 주면 그것을 돌려준다
    deliver: async (send) => {
      calls.push(send as FlightPlanSend);
      const r = results.shift() ?? { ok: true as const, msgId: `m-${calls.length}-${send.id}`, pid: 1, configDir: claude, cwd: W };
      if (r.ok && r.cwd === W) appendFileSync(transcriptOf(claude, W, send.sessionId), JSON.stringify({ origin: { kind: "peer", msg_id: r.msgId } }) + "\n");
      return r;
    },
    ...over,
  };
  return { d, calls };
}
const prop = (id: string) => allProposals().find((p) => p.id === id)!;
const lines = (id: string) => readRecords(T0 - 86_400_000).filter((l) => l.kind === "server-send" && (l as { id?: string }).id === id) as unknown as Record<string, unknown>[];

test("첫 발송: 승인된 카드를 검사해 세션에 쓰고 sentVia server로 둔다. 기록 줄에 입력(id·글 해시·세션 id·검사 결과)", async () => {
  clock = T0;
  const c = card("TEAM_A");
  const { d, calls } = deps();
  const r = await serverSendPass(snap(c), d);
  assert.deepEqual(r.delivered, [c.id]);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0]!.id, calls[0]!.sessionId, calls[0]!.to, calls[0]!.purpose, calls[0]!.text], [c.id, c.sessionId, "TEAM_A", "first", textOf(c.id)]);
  const p = prop(c.id);
  assert.deepEqual([p.status, p.sentVia, p.message], ["sent", "server", textOf(c.id)]);
  const [line] = lines(c.id);
  assert.deepEqual([line!.op, line!.textHash, line!.sessionId, line!.check, line!.wrong], ["deliver", contentHashOf(textOf(c.id)), c.sessionId, "pass", []]);
  // 다음 바퀴: 두 번 보내지 않는다
  assert.deepEqual((await serverSendPass(snap(c), d)).delivered, []);
  assert.equal(calls.length, 1);
  // OCC의 release는 409(sentVia server)
  assert.match(serverOwnsWhy(prop(c.id), snap(c), clock) ?? "", /atc 서버가 보냄\(sentVia server\)/);
});

test("살아 있는 세션이 없으면 아무것도 보내지 않고 카드는 approved 그대로. background가 아닌 세션도 OCC 몫", async () => {
  clock = T0;
  const none = card("TEAM_N", { session: "none" });
  const desk = card("TEAM_D", { session: "interactive" });
  const { d, calls } = deps();
  await serverSendPass(snap(none, desk), d);
  assert.equal(calls.filter((x) => x.id === none.id || x.id === desk.id).length, 0);
  assert.equal(prop(none.id).status, "approved");
  assert.equal(prop(desk.id).status, "approved");
  assert.equal(serverOwnsWhy(prop(desk.id), snap(desk), clock), null); // OCC가 release한다
});

test("자동 FRESH START 게이트가 세션을 다시 띄우면 서버는 보내지 않는다(FLIGHT PLAN은 새 세션의 첫 프롬프트로)", async () => {
  clock = T0;
  const c = card("TEAM_F");
  const { d, calls } = deps([], { beforeRelease: async (p) => (p.id === c.id ? "TEAM_F: FRESH START 도는 중" : null) });
  await serverSendPass(snap(c), d);
  assert.equal(calls.filter((x) => x.id === c.id).length, 0);
  assert.equal(prop(c.id).status, "approved");
  // 게이트가 FRESH START로 보낸 카드(sentVia fresh-start)는 approved가 아니라 첫 발송 대상도 재송신 대상도 아니다
  append([{ op: "send", id: c.id, at: at(0), message: textOf(c.id), via: "fresh-start" }]);
  clock = T0 + 30 * 60_000;
  await serverSendPass(snap(c), deps([], { now: () => clock }).d);
  assert.equal(prop(c.id).sentVia, "fresh-start");
  assert.equal(lines(c.id).length, 0);
});

test("재송신(b): READBACK 없이 overdue가 지나면 한 번, 그 뒤로는 없음. 그 사이 READBACK하면 보내지 않는다", async () => {
  clock = T0;
  const a = card("TEAM_R");
  const b = card("TEAM_S");
  const { d, calls } = deps();
  await serverSendPass(snap(a, b), d);
  append([{ op: "accept", id: b.id, at: at(5) }]); // TEAM_S는 답했다
  clock = T0 + 5 * 60_000;
  await serverSendPass(snap(a, b), d);
  assert.equal(calls.filter((x) => x.purpose === "resend").length, 0); // overdue 전
  clock = T0 + 11 * 60_000;
  await serverSendPass(snap(a, b), d);
  assert.deepEqual(calls.filter((x) => x.purpose === "resend").map((x) => x.id), [a.id]);
  clock = T0 + 25 * 60_000;
  await serverSendPass(snap(a, b), d);
  assert.deepEqual(calls.filter((x) => x.purpose === "resend").map((x) => x.id), [a.id]); // 한 번만
  assert.match(serverOwnsWhy(prop(a.id), snap(a), clock) ?? "", /한 번 다시 보냄/);
});

test("닿지 않음(c): 쓰기 실패면 undelivered로 approved, 1분 뒤 세션이 있으면 한 번 더. 두 번째 실패는 OCC에게(release 409 없음)", async () => {
  clock = T0;
  const c = card("TEAM_U");
  const fail: DeliverResult = { ok: false, stage: "write", why: "socket write failed: ENOENT", cause: "stale-address" };
  const { d, calls } = deps([fail, fail]);
  await serverSendPass(snap(c), d);
  assert.deepEqual([prop(c.id).status, prop(c.id).undelivered?.n], ["approved", 1]);
  await serverSendPass(snap(c), d);
  assert.equal(calls.length, 1); // 1분 안에는 다시 쓰지 않는다
  clock = T0 + 2 * 60_000;
  await serverSendPass(snap(c), d);
  assert.deepEqual(calls.map((x) => x.purpose), ["first", "retry"]);
  assert.deepEqual([prop(c.id).status, prop(c.id).undelivered?.n], ["approved", 2]);
  assert.deepEqual(lines(c.id).map((l) => l.op), ["failed", "failed", "handback"]);
  clock = T0 + 10 * 60_000;
  await serverSendPass(snap(c), d);
  assert.equal(calls.length, 2); // 더 하지 않는다
  assert.equal(serverOwnsWhy(prop(c.id), snap(c), clock), null);
  // OCC가 넘겨받아 보낸다: send에 via가 없으면 앞 발송의 server 길을 물려받지 않고, OCC의 send-guard 검사가 통과한다
  assert.equal(prop(c.id).sentVia, undefined);
  append([{ op: "send", id: c.id, at: new Date(clock).toISOString(), message: textOf(c.id) }]);
  assert.deepEqual([prop(c.id).status, prop(c.id).sentVia], ["sent", undefined]);
  assert.equal(await checkSend({ to: "TEAM_U", message: `[DISPATCH ${c.id}]` }, async () => ({ proposal: prop(c.id), mode: "approval" }), "occ"), null);
});

test("release 409: 서버 job이 살아 있고 서버가 보낼 카드면 OCC는 보내지 않는다. 스위치 off면 OCC", async () => {
  clock = T0;
  const c = card("TEAM_W");
  const { d } = deps();
  await serverSendPass(snap(), d); // 서버 job이 돌았다(이 카드의 세션은 아직 스냅샷에 없음)
  assert.match(serverOwnsWhy(prop(c.id), snap(c), clock) ?? "", /atc 서버가 이 FLIGHT PLAN을 보낸다/);
  assert.equal(serverOwnsWhy(prop(c.id), snap(c), clock + 4 * 60_000), null); // job이 3분 넘게 돌지 않음
  const file = join(config.stateDir, "server-send.json");
  saveServerSendSwitch("first", "off", "SUPERVISOR", file);
  assert.equal(serverOwnsWhy(prop(c.id), snap(c), clock), null);
  saveServerSendSwitch("first", "on", "SUPERVISOR", file);
});

test("BREAKER: 쓴 발송이 보이지 않으면 멈추고 OCC에게 넘긴다. 30분 뒤 카드 하나로 시험하고, 보이면 스스로 다시 켜진다", async () => {
  clock = T0 + 60 * 60_000;
  const c = card("TEAM_V");
  const { d, calls } = deps([{ ok: true, msgId: "m-unseen", pid: 1, configDir: claude, cwd: "/nowhere" }]);
  await serverSendPass(snap(c), d);
  assert.equal(calls.length, 1);
  clock += 11 * 60_000;
  await serverSendPass(snap(c), d);
  assert.deepEqual(lines(c.id).map((l) => [l.op, l.seen ?? l.event]), [["deliver", undefined], ["confirm", false], ["breaker", "trip"]]);
  // 멈춘 동안: 서버는 보내지 않고 release는 409를 주지 않는다(OCC가 보낸다)
  const next = card("TEAM_X");
  const after = card("TEAM_Y");
  await serverSendPass(snap(next, after), d);
  assert.equal(calls.length, 1);
  assert.equal(serverOwnsWhy(prop(next.id), snap(next), clock), null);
  // 30분 뒤: 카드 하나만 시험으로 보낸다
  clock += 31 * 60_000;
  await serverSendPass(snap(next, after), d);
  assert.deepEqual(calls.map((x) => x.id), [c.id, next.id]);
  assert.equal(prop(after.id).status, "approved");
  // 시험 발송이 보이면 다시 켜지고 같은 바퀴에 다음 카드를 보낸다
  await serverSendPass(snap(next, after), d);
  assert.deepEqual(lines(next.id).map((l) => [l.op, l.seen ?? l.event]), [["deliver", undefined], ["confirm", true], ["breaker", "rearm"]]);
  assert.deepEqual(calls.map((x) => x.id), [c.id, next.id, after.id]);
  // 수: 멈춤 1, 다시 켜짐 1
  const data = serverSendData(clock);
  assert.deepEqual([data.total.trips, data.total.rearms, data.breaker], [1, 1, "armed"]);
});

test("BREAKER: 시험 발송도 보이지 않으면 다시 멈춘다", async () => {
  clock = T0 + 500 * 60_000;
  saveServerSendSwitch("first", "off");
  saveServerSendSwitch("first", "on");
  const a = card("TEAM_K");
  const b = card("TEAM_L");
  const { d, calls } = deps([
    { ok: true, msgId: "m-k", pid: 1, configDir: claude, cwd: "/nowhere" },
    { ok: true, msgId: "m-l", pid: 1, configDir: claude, cwd: "/nowhere" },
  ]);
  await serverSendPass(snap(a), d);
  clock += 11 * 60_000;
  await serverSendPass(snap(a), d); // trip
  clock += 31 * 60_000;
  await serverSendPass(snap(a, b), d); // 시험 발송 b
  assert.deepEqual(calls.map((x) => x.id), [a.id, b.id]);
  await serverSendPass(snap(a, b), d);
  assert.deepEqual(lines(b.id).map((l) => l.op), ["deliver"]); // 확인을 기다리는 동안 더 보내지 않는다
  clock += 11 * 60_000;
  await serverSendPass(snap(a, b), d);
  assert.deepEqual(lines(b.id).map((l) => [l.op, l.seen ?? l.event]), [["deliver", undefined], ["confirm", false], ["breaker", "trip"]]);
  assert.equal(serverSendData(clock).breaker, "tripped");
});

test("send를 적고 쓰기 전에 서버가 멈춘 카드는 1분 뒤 undelivered로 돌린다(10분 기다리지 않는다)", async () => {
  clock = T0 + 200 * 60_000;
  const c = card("TEAM_C");
  append([{ op: "send", id: c.id, at: new Date(clock).toISOString(), message: textOf(c.id), via: "server" }]);
  clock += 2 * 60_000;
  await serverSendPass(snap(), deps().d);
  assert.deepEqual([prop(c.id).status, prop(c.id).undelivered?.n], ["approved", 1]);
  assert.deepEqual(lines(c.id).map((l) => [l.op, l.stage]), [["failed", "crash"]]);
});

test("확인: 바쁜 세션은 60분까지 기다리고, 끝난 세션(gone)은 멈춤에 세지 않는다", async () => {
  clock = T0 + 400 * 60_000;
  // 앞 시험이 남긴 멈춤을 SUPERVISOR처럼 스위치를 껐다 켜서 푼다
  saveServerSendSwitch("first", "off");
  saveServerSendSwitch("first", "on");
  const busy = card("TEAM_Q");
  const file = join(claude, "sessions", `${50_000 + n}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), status: "busy" }));
  const { d } = deps([{ ok: true, msgId: "m-busy", pid: 1, configDir: claude, cwd: "/nowhere" }]);
  await serverSendPass(snap(busy), d);
  append([{ op: "accept", id: busy.id, at: new Date(clock + 60_000).toISOString() }]); // 답이 와서 재송신은 없다
  clock += 20 * 60_000;
  await serverSendPass(snap(busy), d);
  assert.deepEqual(lines(busy.id).map((l) => l.op), ["deliver"]); // 아직 기다린다
  rmSync(file); // 세션이 끝났다
  await serverSendPass(snap(), d);
  assert.deepEqual(lines(busy.id).map((l) => [l.op, l.seen, l.why]), [["deliver", undefined, undefined], ["confirm", false, "gone"]]);
  const next = card("TEAM_P");
  await serverSendPass(snap(next), deps().d);
  assert.equal(prop(next.id).sentVia, "server"); // 멈추지 않았다
});
