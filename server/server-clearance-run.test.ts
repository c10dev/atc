import { hermeticRoot } from "./test-hermetic.ts";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { allClearances } from "./clearances.ts";
import { config } from "./config.ts";
import { formatClearance, mountController } from "./controller.ts";
import { EventLog } from "./events.ts";
import type { Clearance, PullRequest, Session, Snapshot } from "./model.ts";
import { readRecords } from "./recorder.ts";
import { allRelays, append as appendRelay, mountRelay } from "./relay-run.ts";
import type { ClearanceSend } from "./send-checks.ts";
import { type ClearancePassDeps, SERVER_HEADER, saveServerClearanceSwitch, serverClearanceData, serverClearancePass } from "./server-clearance-run.ts";
import { type DeliverResult, transcriptOf } from "./session-socket.ts";

// ATC-557 b SERVER CLEARANCE 한 바퀴(입출력): 실제 라우트(브리핑, POST /api/clearances, relay issued)를 Hono 앱으로 띄우고, 임시 ~/.claude/sessions의 가짜 세션 파일로.
// 소켓 쓰기는 바꿔 끼운다(실제 세션에 쓰지 않는다)
const T0 = Date.now();
let clock = T0;
const claude = join(hermeticRoot, "home", ".claude");
mkdirSync(join(claude, "sessions"), { recursive: true });
const W = join(tmpdir(), "atc557b-run-w"); // 받는 세션의 cwd(시험 opt-in은 OS 임시 폴더 아래 세션에만 쓴다)
process.env.ATC_SERVER_SEND_TEST = "1";
mkdirSync(join(claude, "projects", W.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });
mkdirSync(config.stateDir, { recursive: true });

const REPO = "/home/c10/projects/atc";
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
let pid = 60_000;
function session(name: string, kind: "bg" | "interactive" = "bg", over: Partial<Session> = {}): Session {
  const id = `sess-${name.toLowerCase()}`;
  pid++;
  writeFileSync(join(claude, "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId: id, name, kind, cwd: W, messagingSocketPath: `/run/user/1000/cc-socks/${pid}.sock`, peerProtocol: 1, status: "idle" }));
  return { id, agent: "claude", name, status: "idle", pid, cwd: W, startedAt: iso(-60), lastActiveAt: iso(0), repo: REPO, workspacePath: null, kind: kind === "bg" ? "background" : "interactive", ...over } as Session;
}
const A = session("TEAM_A");
const B = session("TEAM_B");
const C = session("TEAM_C", "interactive"); // 데스크톱·터미널: 서버가 쓰지 않는다(TOWER)
const D = session("TEAM_D", "bg", { health: { code: "LIMIT", level: "alert", since: iso(-5), detail: "x", next: "y", holds: true } as never });
const standOf = (n: number) => `${REPO}/.claude/worktrees/atc-${n}-x`;
const pr = (n: number, over: Partial<PullRequest> = {}): PullRequest =>
  ({ repo: REPO, number: n, title: `PR ${n}`, url: `https://github.com/o/r/pull/${n}`, branch: `b${n}`, head: `${n}${n}${n}abcdef0123`, base: "main", ticketKey: `ATC-${n}`, standPath: standOf(n), draft: false, landing: "APPROACH", blocks: [{ code: "blocked", text: "막힘", en: "GitHub branch protection blocks the merge" }], readyAt: null, createdAt: iso(-100), ...over }) as PullRequest;
const pulls = [
  pr(1), // APPROACH INFO → TEAM_A
  pr(2, { landing: "CLEARED", blocks: [], readyAt: iso(-10) }), // LAND → TEAM_B
  pr(3, { blocks: [{ code: "dirty", text: "충돌", en: "conflicts with base" }] as never }), // GO AROUND → TEAM_A
  pr(4), // INFO → TEAM_C(데스크톱): TOWER
  pr(5), // INFO → TEAM_D(코드 LIMIT): 서버가 잡아 둔다
];
const holder: Record<number, Session> = { 1: A, 2: B, 3: A, 4: C, 5: D };
const snap = (): Snapshot =>
  ({
    at: iso(0),
    linear: { enabled: true, error: null, fetchedAt: iso(0) },
    github: { enabled: true, error: null, fetchedAt: iso(0) },
    atfm: { mains: [], groundStops: [] },
    pulls,
    sessions: [A, B, C, D],
    workspaces: pulls.map((p) => ({ path: p.standPath, name: `atc-${p.number}-x`, repo: REPO, isMain: false, branch: p.branch, head: "", dirty: 0, lastCommitAt: null, ticketKey: p.ticketKey })),
    tickets: [],
    columns: [],
    airports: [{ id: "a", repo: REPO, name: "atc", code: "ATCC" }],
    claims: pulls.map((p) => ({ sessionId: holder[p.number]!.id, workspacePath: p.standPath, since: iso(-50), lastAt: iso(-1), source: "hook", tool: null, state: "active", handedOffTo: null })),
    handoffs: [],
    alerts: [],
    clearances: [],
  }) as unknown as Snapshot;

const app = new Hono();
mountController(app, async () => snap(), new EventLog());
mountRelay(app, async () => snap());
const get = async (path: string) => (await app.request(path)).json();
const post = async (path: string, body: unknown, server = true) => {
  const r = await app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(server ? { [SERVER_HEADER]: "server" } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};
const brief = async () => (await get("/api/controller/brief?consumer=controller")) as { landingQueue: Record<string, any>[]; relays: Record<string, unknown>[]; serverSends?: { relays: { id: string }[]; resend: string[] }; clearances: { overdue: string[] } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = (b: Awaited<ReturnType<typeof brief>>, n: number) => b.landingQueue.find((x) => x.pr.number === n)!;

const calls: ClearanceSend[] = [];
let failing: (send: ClearanceSend) => DeliverResult | null = () => null; // 이 발송을 실패로 돌려준다
const deps: ClearancePassDeps = {
  get,
  post: (p, b) => post(p, b),
  now: () => clock,
  // 받는 세션처럼 대화 기록에 msg_id를 남긴다. 실패를 넣어 두면 그것을 돌려준다
  deliver: async (send) => {
    calls.push(send as ClearanceSend);
    const r = failing(send as ClearanceSend) ?? { ok: true as const, msgId: `m-${calls.length}`, pid: 1, configDir: claude, cwd: W };
    if (r.ok) appendFileSync(transcriptOf(claude, W, send.sessionId), JSON.stringify({ origin: { kind: "peer", msg_id: r.msgId } }) + "\n");
    return r;
  },
};
const lines = (op?: string) => readRecords(T0 - 86_400_000).filter((l) => l.kind === "server-clearance" && (!op || l.op === op)) as unknown as Record<string, unknown>[];
const byId = (id: string) => allClearances().find((c) => c.id === id)!;

test("브리핑: 서버가 쓸 수 있는 holder의 항목만 서버 몫(action server·landVia server), 데스크톱 holder는 TOWER(send)", async () => {
  const b = await brief();
  assert.equal(q(b, 1).info.action, "server");
  assert.equal(q(b, 2).landVia, "server");
  assert.equal(q(b, 3).goAround.action, "server");
  assert.equal(q(b, 4).info.action, "send"); // TEAM_C는 interactive
  assert.equal(q(b, 5).info.action, "server"); // 코드가 있어도 서버 몫(서버가 코드가 풀릴 때까지 잡아 둔다)
});

test("한 바퀴: TOWER와 같은 기록·같은 글로 적고 보낸다. 다시 돌아도 두 번 보내지 않고, TOWER의 같은 CLEARANCE는 409", async () => {
  const r = await serverClearancePass(snap(), deps);
  assert.equal(r.writer, "test-opt-in");
  const sent = calls.map((c) => [byId(c.id).type, byId(c.id).toName]);
  assert.deepEqual(sent.sort(), [["GO AROUND", "TEAM_A"], ["INFO", "TEAM_A"], ["LAND", "TEAM_B"]].sort());
  for (const c of calls) {
    const cl = byId(c.id);
    // 글은 TOWER의 atcctl issue가 받는 것과 같다(formatClearance), 끝줄은 TOWER 이름으로 답하라는 줄
    assert.equal(c.text, formatClearance(cl, snap()));
    assert.match(c.text, /Send your reply to the session name "TOWER"/);
    assert.equal(cl.stand, standOf(Number(/#(\d)/.exec(cl.text)![1])));
    assert.ok(cl.head, "ATC-555 head 묶기가 기록에 있다");
  }
  const land = byId(calls.find((c) => c.purpose === "land")!.id);
  assert.equal(land.text, "LANDING sequence 1 (ATCC): PR #2 (ATC2). Clear to LAND now. Check that base is current before you merge.");
  assert.equal(land.flight, "ATC-2");
  // 기록 줄: issue·deliver(입력과 잘못 보냄 없음)
  assert.equal(lines("deliver").length, 3);
  assert.ok(lines("deliver").every((l) => Array.isArray(l.wrong) && (l.wrong as unknown[]).length === 0));
  // 브리핑: 이제 나간 것(sent, landClearance)
  const b = await brief();
  assert.equal(q(b, 1).info.action, "sent");
  assert.equal(q(b, 2).landVia, undefined);
  assert.ok(q(b, 2).landClearance);
  // 다음 바퀴: 두 번 보내지 않는다
  calls.length = 0;
  await serverClearancePass(snap(), deps);
  assert.equal(calls.length, 0);
  // TOWER가 같은 CLEARANCE를 또 적으려 하면 409
  const info = byId(lines("deliver").map((l) => String(l.id)).find((id) => byId(id).type === "INFO")!);
  const dup = await post("/api/clearances", { to: info.to, type: "INFO", stand: info.stand, text: info.text }, false);
  assert.equal(dup.status, 409);
  assert.match(String(dup.json.error), /이미 보냄/);
});

test("첫 RESEND와 RELAY: 답 없이 10분 지난 CLEARANCE는 \"RESEND \" + 원래 글로 한 번, relay는 그대로 적고 issued", async () => {
  // TOWER가 11분 전에 TEAM_B에 낸 HOLD(답 없음). id는 기록의 다음 번호(RESEND 고리는 번호 순서로 잇는다)
  const next = `C-${String(allClearances().length + 1).padStart(4, "0")}`;
  const op = { op: "issue", id: next, at: iso(-11), to: B.id, toName: "TEAM_B", type: "HOLD", stand: standOf(2), flight: "ATC-2", text: "Hold STAND atc-2-x until TEAM_A hands it off." };
  appendFileSync(join(config.stateDir, "clearances.jsonl"), JSON.stringify(op) + "\n");
  appendRelay({ op: "create", id: "R-0001", at: iso(-1), to: "TEAM_B", kind: "info", text: "Please post the test plan in the PR body.", flight: null, pr: null, toSessionId: B.id });
  const b = await brief();
  assert.deepEqual(b.serverSends?.resend, [next]);
  assert.deepEqual(b.serverSends?.relays.map((r) => r.id), ["R-0001"]);
  assert.ok(!b.clearances.overdue.includes(next));
  assert.equal(b.relays.length, 0);
  calls.length = 0;
  await serverClearancePass(snap(), deps);
  const resend = allClearances().find((c) => c.text === `RESEND ${op.text}`)!;
  assert.deepEqual([resend.type, resend.to, resend.stand, resend.flight], ["HOLD", B.id, standOf(2), "ATC-2"]);
  const relay = allRelays().find((r) => r.id === "R-0001")!;
  assert.equal(relay.status, "issued");
  assert.equal(byId(relay.clearance!).text, "Please post the test plan in the PR body.");
  assert.equal(calls.length, 2);
  // 이제 고리가 있다: 두 번째 RESEND는 TOWER의 판단(브리핑의 서버 몫에서 빠진다)
  const b2 = await brief();
  assert.equal(b2.serverSends, undefined);
});

test("닿지 않음: 1분 뒤 같은 CLEARANCE를 한 번 더, 두 번째 실패면 undeliverable(손으로 전하는 카드)과 TOWER에게 넘김", async () => {
  const p6 = pr(6);
  pulls.push(p6);
  holder[6] = A;
  failing = (send) => (send.text.includes("PR #6 ") ? { ok: false, stage: "write", why: "socket write failed: ECONNREFUSED", cause: "stale-address" } : null);
  calls.length = 0;
  await serverClearancePass(snap(), deps);
  const id = calls.find((c) => c.text.includes("PR #6 "))!.id;
  assert.equal(lines("failed").filter((l) => l.id === id).length, 1);
  assert.ok(!byId(id).cancelledAt, "아직 열려 있다(재시도)");
  clock += 61_000;
  await serverClearancePass(snap(), deps);
  assert.equal(calls.filter((c) => c.id === id).length, 2);
  assert.equal(calls.at(-1)!.attempt, "retry");
  clock += 61_000;
  await serverClearancePass(snap(), deps);
  const cl: Clearance = byId(id);
  assert.ok(cl.undeliverableAt);
  assert.match(cl.undeliverableReason ?? "", /ECONNREFUSED/);
  assert.ok(lines("handback").some((l) => l.id === id));
  // 넘긴 항목은 TOWER 몫(send)이 된다
  const b = await brief();
  assert.equal(q(b, 6).info.action, "send");
});

test("스위치 off인 종류는 서버가 맡지 않는다(TOWER가 오늘처럼). 설정 창 자료는 종류마다 수", async () => {
  const p7 = pr(7);
  pulls.push(p7);
  holder[7] = B;
  clock = Date.now(); // 서버 job이 "지금" 돌았다(살아 있음은 실제 시각과 견준다)
  saveServerClearanceSwitch("info", "off");
  await serverClearancePass(snap(), deps);
  assert.equal(q(await brief(), 7).info.action, "send");
  saveServerClearanceSwitch("info", "on");
  assert.equal(q(await brief(), 7).info.action, "server");
  const d = serverClearanceData(clock);
  assert.equal(d.total.delivered >= 5, true);
  assert.deepEqual(Object.keys(d.kinds).sort(), ["fix", "goAround", "info", "land", "relay", "resend"]);
  assert.equal(d.switches.info, "on");
  assert.equal(d.writer, "test-opt-in");
});
