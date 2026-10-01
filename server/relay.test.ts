import assert from "node:assert/strict";
import { test } from "node:test";
import { fold, type ClearanceOp } from "./clearances.ts";
import { attachCommandIn, clearanceTypeOf, foldRelays, handCardOf, liveSessionOf, nextRelayId, relayBriefOf, relayInputOf, RELAY_MAX_CHARS, unreachableWhy, type Relay, type RelayOp } from "./relay.ts";
import { supervisorQueueOf, type QueueInput } from "./supervisor-queue.ts";

const create = (id: string, to = "TEAM_E", extra: Partial<Relay> = {}): RelayOp => ({ op: "create", id, at: "2026-10-01T06:00:00.000Z", to, kind: "info", text: "Please look at PR 320.", flight: null, pr: null, ...extra });

test("relayInputOf: 영어 글만, 비거나 길면 거절", () => {
  assert.deepEqual(relayInputOf({ to: " TEAM_E ", kind: "info", text: " Hello. " }), { to: "TEAM_E", kind: "info", text: "Hello.", flight: null, pr: null });
  assert.deepEqual(relayInputOf({ to: "TEAM_E", kind: "instruction", text: "Fix it", flight: "atc-271", pr: 320 }), { to: "TEAM_E", kind: "instruction", text: "Fix it", flight: "ATC-271", pr: 320 });
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "" }) as { error: string }).error, /text가 필요/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "x".repeat(RELAY_MAX_CHARS + 1) }) as { error: string }).error, /이내/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "안녕하세요" }) as { error: string }).error, /영어/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "ありがとう" }) as { error: string }).error, /영어/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "你好" }) as { error: string }).error, /영어/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "a\u0000b" }) as { error: string }).error, /제어 문자/);
  assert.match((relayInputOf({ to: "team e", kind: "info", text: "hi" }) as { error: string }).error, /REGISTRATION/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "shout", text: "hi" }) as { error: string }).error, /kind/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "hi", flight: "nope" }) as { error: string }).error, /FLIGHT key/);
  assert.match((relayInputOf({ to: "TEAM_E", kind: "info", text: "hi", pr: -1 }) as { error: string }).error, /양의 정수/);
  assert.ok("error" in relayInputOf(null));
});

test("clearanceTypeOf: info는 INFO(ROGER), 지시는 PR이 있으면 FIX 아니면 CONTINUE(READBACK)", () => {
  assert.equal(clearanceTypeOf({ kind: "info", pr: null }), "INFO");
  assert.equal(clearanceTypeOf({ kind: "instruction", pr: 320 }), "FIX");
  assert.equal(clearanceTypeOf({ kind: "instruction", pr: null }), "CONTINUE");
});

test("foldRelays: queued → issued → delivered, 상태는 CLEARANCE의 답에서 읽는다", () => {
  const ops: RelayOp[] = [create("R-0001"), { op: "issued", id: "R-0001", at: "2026-10-01T06:01:00.000Z", clearance: "C-0301" }];
  assert.equal(foldRelays(ops)[0].status, "issued");
  const issue: ClearanceOp = { op: "issue", id: "C-0301", at: "2026-10-01T06:01:00.000Z", to: "s", toName: "TEAM_E", type: "INFO", stand: null, flight: null, text: "Please look at PR 320." };
  const done = foldRelays(ops, fold([issue, { op: "roger", id: "C-0301", at: "2026-10-01T06:02:00.000Z" }]));
  assert.deepEqual([done[0].status, done[0].answer], ["delivered", "ROGER"]);
  const unable = foldRelays(ops, fold([issue, { op: "unable", id: "C-0301", at: "2026-10-01T06:02:00.000Z", reason: "busy" }]));
  assert.deepEqual([unable[0].status, unable[0].answer], ["delivered", "UNABLE — busy"]);
  const cancelled = foldRelays(ops, fold([issue, { op: "cancel", id: "C-0301", at: "2026-10-01T06:02:00.000Z" }]));
  assert.equal(cancelled[0].status, "undeliverable");
  const un = foldRelays(ops, fold([issue, { op: "undeliverable", id: "C-0301", at: "2026-10-01T06:03:00.000Z", reason: "No session named TEAM_E" }]));
  assert.deepEqual([un[0].status, un[0].reason], ["undeliverable", "No session named TEAM_E"]);
});

test("foldRelays: undeliverable로 표시하면 기록이 바뀌고, hand는 undeliverable에만", () => {
  const ops: RelayOp[] = [create("R-0001"), { op: "hand", id: "R-0001", at: "2026-10-01T06:01:00.000Z" }];
  assert.equal(foldRelays(ops)[0].status, "queued"); // queued에는 hand가 듣지 않는다
  const more: RelayOp[] = [create("R-0001"), { op: "undeliverable", id: "R-0001", at: "2026-10-01T06:01:00.000Z", reason: "TOWER cannot reach it" }, { op: "hand", id: "R-0001", at: "2026-10-01T06:05:00.000Z" }];
  const r = foldRelays(more)[0];
  assert.deepEqual([r.status, r.reason], ["hand", "TOWER cannot reach it"]);
  assert.equal(nextRelayId(more), "R-0002");
  assert.equal(nextRelayId([]), "R-0001");
});

test("relayBriefOf: 아직 보내지 않은 relay만, 글은 그대로", () => {
  const rs = foldRelays([create("R-0001", "TEAM_E", { kind: "instruction", pr: 320, text: "FIX PR #320: x" }), create("R-0002"), { op: "issued", id: "R-0002", at: "2026-10-01T06:01:00.000Z", clearance: "C-0001" }]);
  const b = relayBriefOf(rs, Date.parse("2026-10-01T06:10:00.000Z"));
  assert.equal(b.length, 1);
  assert.deepEqual(b[0], { id: "R-0001", to: "TEAM_E", kind: "instruction", type: "FIX", flight: null, pr: 320, text: "FIX PR #320: x", ageMin: 10 });
});

test("unreachableWhy: 세션 없음·TOWER 없음·다른 ACCOUNT는 만들면서 알 수 있다", () => {
  assert.match(unreachableWhy(null, { account: "acct-1" })!, /no live session/);
  assert.match(unreachableWhy({ name: "TEAM_E", account: "acct-1" }, null)!, /TOWER is not running/);
  assert.match(unreachableWhy({ name: "TEAM_E", account: "acct-2" }, { account: "acct-1" })!, /cross-ACCOUNT .*acct-1 → acct-2/);
  assert.equal(unreachableWhy({ name: "TEAM_E", account: "acct-1" }, { account: "acct-1" }), null);
  assert.equal(unreachableWhy({ name: "TEAM_E" }, { account: "acct-1" }), null); // 폴더를 모르면 막지 않는다
});

test("attachCommandIn: 기본 폴더가 아니면 CLAUDE_CONFIG_DIR를 붙이고, 이상한 글자는 따옴표로 감싼다", () => {
  assert.equal(attachCommandIn("abc123", "/home/c10/.claude-acct-1", "/home/c10/.claude"), "CLAUDE_CONFIG_DIR=/home/c10/.claude-acct-1 claude attach abc123");
  assert.equal(attachCommandIn("abc123", "/home/c10/.claude", "/home/c10/.claude"), "claude attach abc123");
  assert.equal(attachCommandIn("abc123", null, "/home/c10/.claude"), "claude attach abc123");
  assert.equal(attachCommandIn("abc123", "/home/c10/my dir", "/home/c10/.claude"), "CLAUDE_CONFIG_DIR='/home/c10/my dir' claude attach abc123");
});

test("handCardOf: 살아 있는 BG는 attach(폴더·job id), 데스크톱은 붙여 넣기, 없으면 LAUNCH", () => {
  const bg = { name: "TEAM_E", status: "idle" as const, origin: "background" as const, jobId: "d3adb33f", account: "acct-1" };
  const a = handCardOf("TEAM_E", "cross-ACCOUNT", { session: bg, folderDir: "/home/c10/.claude-acct-1", defaultDir: "/home/c10/.claude" });
  assert.deepEqual([a.step, a.jobId, a.folder, a.command], ["attach", "d3adb33f", "/home/c10/.claude-acct-1", "CLAUDE_CONFIG_DIR=/home/c10/.claude-acct-1 claude attach d3adb33f"]);
  const d = handCardOf("TEAM_E", "x", { session: { ...bg, origin: "desktop", jobId: undefined }, folderDir: null, defaultDir: "/h/.claude" });
  assert.deepEqual([d.step, d.command], ["desktop", null]);
  const l = handCardOf("TEAM_E", "no live session", { session: null, folderDir: null, defaultDir: "/h/.claude" });
  assert.deepEqual([l.step, l.command], ["launch", null]);
  const dead = handCardOf("TEAM_E", "x", { session: { ...bg, status: "dead" }, folderDir: null, defaultDir: "/h/.claude" });
  assert.equal(dead.step, "launch");
});

test("liveSessionOf: 이름이 같은 살아 있는 세션 가운데 가장 최근 것", () => {
  const ss = [
    { name: "TEAM_E", status: "dead" as const, lastActiveAt: "2026-10-01T09:00:00Z" },
    { name: "TEAM_E", status: "idle" as const, lastActiveAt: "2026-10-01T05:00:00Z" },
    { name: "TEAM_E", status: "busy" as const, lastActiveAt: "2026-10-01T07:00:00Z" },
    { name: "TEAM_F", status: "busy" as const, lastActiveAt: "2026-10-01T08:00:00Z" },
  ];
  assert.equal(liveSessionOf(ss, "team_e")!.lastActiveAt, "2026-10-01T07:00:00Z");
  assert.equal(liveSessionOf(ss, "TEAM_Z"), null);
});

const baseQueue: QueueInput = {
  proposals: [],
  schedule: { mode: "shadow", ops: [] },
  fleetPlan: [],
  pulls: [],
  update: null,
  sessions: [],
  blockedMin: 30,
};

test("supervisorQueueOf: undeliverable relay·CLEARANCE·FLIGHT PLAN이 UNDELIVERED 카드(손으로 전하기)로 선다", () => {
  const now = Date.parse("2026-10-01T07:00:00.000Z");
  const relays = foldRelays([create("R-0001", "TEAM_E", { text: "Look at PR 320." }), { op: "undeliverable", id: "R-0001", at: "2026-10-01T06:10:00.000Z", reason: "cross-ACCOUNT (acct-1 → acct-2): TOWER cannot reach it (ATC-251)" }, create("R-0002")]);
  const q = supervisorQueueOf(
    {
      ...baseQueue,
      relays,
      clearances: [
        { id: "C-0001", toName: "TEAM_F", type: "INFO", text: "hello", undeliverableAt: "2026-10-01T06:20:00.000Z", undeliverableReason: "No session named TEAM_F", handAt: null },
        { id: "C-0002", toName: "TEAM_F", type: "INFO", text: "done by hand", undeliverableAt: "2026-10-01T06:20:00.000Z", undeliverableReason: "x", handAt: "2026-10-01T06:30:00.000Z" },
        { id: "C-0003", toName: "TEAM_F", type: "INFO", text: "old", undeliverableAt: "2026-09-20T06:20:00.000Z", undeliverableReason: "x", handAt: null },
      ],
      proposals: [{ id: "D-0100", kind: "ASSIGN", status: "approved", flight: "ATC-9", aircraftName: "TEAM_G", holdAt: null, statusAt: "2026-10-01T06:30:00.000Z", awaitSupervisor: undefined, undelivered: { at: "2026-10-01T06:30:00.000Z", reason: "No session named TEAM_G", n: 1 } }],
      sessions: [{ id: "s1", name: "TEAM_E", job: null, lastActiveAt: null, status: "idle", origin: "background", jobId: "abc12345", account: "acct-2" }],
      folders: [{ label: "acct-2", dir: "/home/c10/.claude-acct-2" }],
      defaultDir: "/home/c10/.claude",
    },
    now,
  );
  const items = q.filter((i) => i.kind === "UNDELIVERED");
  assert.deepEqual(items.map((i) => i.key), ["R-0001", "C-0001", "D-0100|2026-10-01T06:30:00.000Z"]);
  const r = items[0].hand!;
  assert.deepEqual([r.source, r.to, r.text, r.card.step, r.card.jobId, r.card.folder], ["RELAY", "TEAM_E", "Look at PR 320.", "attach", "abc12345", "/home/c10/.claude-acct-2"]);
  assert.equal(r.card.command, "CLAUDE_CONFIG_DIR=/home/c10/.claude-acct-2 claude attach abc12345");
  assert.equal(items[1].hand!.card.step, "launch"); // TEAM_F는 살아 있는 세션이 없다
  assert.equal(items[2].hand!.text, null);
  assert.equal(q.filter((i) => i.kind === "UNDELIVERED" && i.key === "R-0002").length, 0); // queued는 아직 닿지 못한 것이 아니다
});

test("supervisorQueueOf: 손 표시·답·다시 보냄으로 상태가 바뀌면 카드가 사라진다", () => {
  const now = Date.parse("2026-10-01T07:00:00.000Z");
  const ops: RelayOp[] = [create("R-0001"), { op: "undeliverable", id: "R-0001", at: "2026-10-01T06:10:00.000Z", reason: "x" }];
  assert.equal(supervisorQueueOf({ ...baseQueue, relays: foldRelays(ops) }, now).length, 1);
  assert.equal(supervisorQueueOf({ ...baseQueue, relays: foldRelays([...ops, { op: "hand", id: "R-0001", at: "2026-10-01T06:20:00.000Z" }]) }, now).length, 0);
  const sent = { id: "D-1", kind: "ASSIGN" as const, status: "sent" as const, flight: "ATC-9", aircraftName: "TEAM_G", holdAt: null, statusAt: "t", awaitSupervisor: undefined, undelivered: { at: "2026-10-01T06:30:00.000Z", reason: "x", n: 1 } };
  assert.equal(supervisorQueueOf({ ...baseQueue, proposals: [sent] }, now).length, 0);
});
