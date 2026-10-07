import { hermeticRoot } from "./test-hermetic.ts";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "./config.ts";
import { contentHashOf, sealWorkOrder } from "./input-binding.ts";
import type { Snapshot } from "./model.ts";
import { allProposals, append, type Op } from "./proposals.ts";
import { readRecords } from "./recorder.ts";
import type { CheckedSend } from "./send-checks.ts";
import { type PassDeps, saveServerSendSwitch, serverOwnsWhy, serverSendPass } from "./server-send-run.ts";
import { type DeliverResult, transcriptOf } from "./session-socket.ts";

// ATC-562 SERVER SEND 한 바퀴(입출력). 임시 상태 폴더(test-hermetic)와 임시 ~/.claude/sessions의 가짜 세션 파일. 소켓 쓰기는 바꿔 끼운다(실제 세션에 쓰지 않는다)
const T0 = Date.now();
let clock = T0;
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const claude = join(hermeticRoot, "home", ".claude");
mkdirSync(join(claude, "sessions"), { recursive: true });
mkdirSync(join(claude, "projects", "-w"), { recursive: true });
mkdirSync(config.stateDir, { recursive: true });
writeFileSync(join(config.stateDir, "dispatch.json"), JSON.stringify({ mode: "approval" }));

let n = 0;
// 카드 하나: 새 id, 그 REGISTRATION의 세션(background) 하나
function card(reg: string, opts: { session?: "bg" | "interactive" | "none" } = {}) {
  n++;
  const id = `D-${String(9000 + n)}`;
  const sessionId = `sess-${n}`;
  const pid = 50_000 + n;
  if (opts.session !== "none") writeFileSync(join(claude, "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId, name: reg, kind: opts.session === "interactive" ? "interactive" : "bg", cwd: "/w", messagingSocketPath: `/run/user/1000/cc-socks/${pid}.sock`, peerProtocol: 1 }));
  append([{ op: "create", id, at: at(-30), kind: "ASSIGN", flight: `ATC-${9000 + n}`, aircraft: null, aircraftName: reg, registration: reg, airport: "ATCC", score: 1, factors: [] } as unknown as Op, { op: "approve", id, at: at(-20) }]);
  const session = { id: sessionId, name: reg, status: "idle", kind: opts.session === "interactive" ? "interactive" : "background", lastActiveAt: at(-1), cwd: "/w" };
  return { id, reg, sessionId, session: opts.session === "none" ? null : session };
}
const snap = (...cards: { session: unknown }[]) => ({ sessions: cards.flatMap((c) => (c.session ? [c.session] : [])), restarting: [], tickets: [], workspaces: [], pulls: [], claims: [], clearances: [], fuel: {}, stranded: [], github: { enabled: false, fetchedAt: null }, linear: { fetchedAt: null } }) as unknown as Snapshot;
const textOf = (id: string) => sealWorkOrder(`[DISPATCH ${id}] FLIGHT PLAN @WOHASH · X\nwork\n— Send your reply to the session name "OCC" (SendMessage to: "OCC").\n— Reply to this message with "READBACK ${id} @WOHASH" if you take it, exactly like that.`).text;
function deps(results: DeliverResult[] = [], over: Partial<PassDeps> = {}) {
  const calls: CheckedSend[] = [];
  const d: PassDeps = {
    now: () => clock,
    message: async (p) => textOf(p.id),
    // 받는 세션처럼 대화 기록에 msg_id를 남긴다(확인이 "보임"이 되게). 실패 결과를 주면 그것을 돌려준다
    deliver: async (send) => {
      calls.push(send);
      const r = results.shift() ?? { ok: true as const, msgId: `m-${calls.length}-${send.id}`, pid: 1, configDir: claude, cwd: "/w" };
      if (r.ok && r.cwd === "/w") appendFileSync(transcriptOf(claude, "/w", send.sessionId), JSON.stringify({ origin: { kind: "peer", msg_id: r.msgId } }) + "\n");
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

test("확인: 쓴 발송이 10분 안에 받는 세션의 대화 기록에 보이지 않으면 서버 발송을 멈추고 OCC에게 넘긴다", async () => {
  clock = T0 + 60 * 60_000;
  const c = card("TEAM_V");
  const { d, calls } = deps([{ ok: true, msgId: "m-unseen", pid: 1, configDir: claude, cwd: "/nowhere" }]);
  await serverSendPass(snap(c), d);
  assert.equal(calls.length, 1);
  clock += 11 * 60_000;
  await serverSendPass(snap(c), d);
  assert.deepEqual(lines(c.id).map((l) => [l.op, l.seen]), [["deliver", undefined], ["confirm", false]]);
  const next = card("TEAM_X");
  await serverSendPass(snap(next), d);
  assert.equal(calls.length, 1); // 멈춤
  assert.equal(serverOwnsWhy(prop(next.id), snap(next), clock), null);
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
