import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { closingLine, responseOf } from "./response.ts";
import { checkServerClearance, type ClearanceSendInput, isChecked } from "./send-checks.ts";
import {
  capPerSession,
  clearanceTwiceOf,
  clearanceWrongOf,
  handedBackOf,
  itemKeyOf,
  type OwnerFacts,
  ownsWhy,
  parseServerClearanceSwitch,
  pendingWorkOf,
  prRefOf,
  serverClearanceCountsOf,
  serverItemsOf,
} from "./server-clearance.ts";

// ATC-557 b SERVER CLEARANCE(순수): 스위치, 누가 보내나, 브리핑에서 보낼 것, 검사, 재시도·넘김, 오작동 수
const T0 = Date.parse("2026-10-07T10:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

test("스위치: 기본 on, 정확히 off만 끈다(모르는 값은 on)", () => {
  assert.deepEqual(parseServerClearanceSwitch(null), { info: "on", goAround: "on", fix: "on", land: "on", resend: "on", relay: "on" });
  assert.deepEqual(parseServerClearanceSwitch({ fix: "off", land: "no", relay: false }), { info: "on", goAround: "on", fix: "off", land: "on", resend: "on", relay: "on" });
});

const facts = (over: Partial<OwnerFacts> = {}): OwnerFacts => ({ sw: parseServerClearanceSwitch(null), live: true, breaker: "armed", writable: (id) => id.startsWith("bg-"), handedBack: new Set(), ...over });

test("누가 보내나: 스위치 on·job 살아 있음·BREAKER 켜짐·넘기지 않음·받는 세션 모두 쓸 수 있음일 때만 서버", () => {
  const k = itemKeyOf("fix", prRefOf("ATCC", 5, "abcdef1234"));
  assert.equal(k, "fix:ATCC#5@abcdef1");
  assert.equal(ownsWhy(facts(), "fix", k, ["bg-1", "bg-2"]), null);
  assert.match(ownsWhy(facts({ sw: parseServerClearanceSwitch({ fix: "off" }) }), "fix", k, ["bg-1"])!, /FIX off/);
  assert.match(ownsWhy(facts({ live: false }), "fix", k, ["bg-1"])!, /3분/);
  assert.match(ownsWhy(facts({ breaker: "tripped" }), "fix", k, ["bg-1"])!, /BREAKER tripped/);
  assert.equal(ownsWhy(facts({ breaker: "probe" }), "fix", k, ["bg-1"]), null); // 시험 발송 하나
  assert.match(ownsWhy(facts({ handedBack: new Set([k]) }), "fix", k, ["bg-1"])!, /넘김/);
  assert.match(ownsWhy(facts(), "fix", k, [])!, /받는 세션 없음/); // holder 없음은 SUPERVISOR 보고(TOWER)
  assert.match(ownsWhy(facts(), "fix", k, ["bg-1", "desk-1"])!, /쓸 수 없는 세션/); // 데스크톱 holder가 하나라도 있으면 TOWER가 모두에게
});

const brief = {
  landingQueue: [
    { airport: "ATCC", pr: { number: 7, head: "1234567" }, stand: "atc-7-x", key: "ATC-7", holders: [{ id: "bg-a", name: "TEAM_A", status: "idle" }, { id: "dead-1", name: "TEAM_Z", status: "dead" }], landVia: "server", landText: "LANDING sequence 1 (ATCC): PR #7 (ATC7). Clear to LAND now. Check that base is current before you merge." },
    { airport: "ATCC", pr: { number: 8, head: "89abcde" }, stand: "atc-8-y", key: "ATC-8", holders: [{ id: "bg-b", name: "TEAM_B", status: "busy" }], info: { action: "server", text: "PR #8 cannot land yet: x [blocks: blocked]" }, fix: { action: "server", text: "FIX PR #8 (ATC-8): y. head 89abcde" }, goAround: { action: "send", text: "GO AROUND: not mine" } },
  ],
  serverSends: { relays: [{ id: "R-0003", to: "TEAM_C", sendTo: "TEAM_C", sendToId: "bg-c", type: "INFO", text: "Please rebase.", flight: null }], resend: ["C-0042"] },
};

test("브리핑에서 보낼 것: 서버 몫으로 표시된 것만, 살아 있는 holder마다. FIX·GO AROUND가 INFO보다 먼저. RESEND는 기록의 원래 글", () => {
  const items = serverItemsOf(brief, (id) => (id === "C-0042" ? { to: "bg-d", toName: "TEAM_D", type: "HOLD", stand: "/w/s", flight: "ATC-9", text: "Hold STAND s." } : null));
  assert.deepEqual(
    items.map((i) => [i.kind, i.key, i.type, i.to, i.toName, i.stand, i.flight, i.source]),
    [
      ["land", "land:ATCC#7@1234567", "LAND", "bg-a", "TEAM_A", "atc-7-x", "ATC-7", brief.landingQueue[0]!.landText],
      ["fix", "fix:ATCC#8@89abcde", "FIX", "bg-b", "TEAM_B", "atc-8-y", "ATC-8", "FIX PR #8 (ATC-8): y. head 89abcde"],
      ["info", "info:ATCC#8@89abcde", "INFO", "bg-b", "TEAM_B", "atc-8-y", "ATC-8", "PR #8 cannot land yet: x [blocks: blocked]"],
      ["relay", "relay:R-0003", "INFO", "bg-c", "TEAM_C", null, null, "Please rebase."],
      ["resend", "resend:C-0042", "HOLD", "bg-d", "TEAM_D", "/w/s", "ATC-9", "Hold STAND s."],
    ],
  );
  assert.deepEqual(items.find((i) => i.kind === "relay")!.relay, "R-0003");
  assert.deepEqual(items.find((i) => i.kind === "resend")!.resendOf, "C-0042");
  // 한 세션에 한 바퀴 둘까지
  assert.deepEqual(capPerSession([{ to: "a" }, { to: "a" }, { to: "b" }, { to: "a" }]).map((x) => x.to), ["a", "a", "b"]);
});

// formatClearance와 같은 꼴(controller.ts). 여기서는 검사만 본다: 실제 글과 같은지는 server-clearance-run.test.ts가 라우트로 본다
const msg = (id: string, type: string, body: string, who = "TEAM_A") => [`[ATC ${id}] ${who} · ${type}`, "STAND atc-7-x · FLIGHT ATC7", body, closingLine("clearance", responseOf("clearance", type as never), id)].join("\n");
const input = (over: Partial<ClearanceSendInput> = {}): ClearanceSendInput => {
  const body = "LANDING sequence 1 (ATCC): PR #7. Clear to LAND now.";
  return {
    purpose: "land",
    attempt: "first",
    clearance: { id: "C-0100", to: "bg-a", toName: "TEAM_A", type: "LAND", text: body, open: true },
    source: body,
    message: msg("C-0100", "LAND", body),
    session: { id: "bg-a", name: "TEAM_A" },
    prior: [],
    now: T0,
    ...over,
  };
};

test("검사: 통과하면 brand 붙은 발송, 막는 사유마다 하나씩", () => {
  const ok = checkServerClearance(input());
  assert.ok(ok.ok && isChecked(ok.send) && ok.send.kind === "clearance" && ok.send.to === "TEAM_A");
  const why = (over: Partial<ClearanceSendInput>) => {
    const r = checkServerClearance(input(over));
    return r.ok ? null : r.reason;
  };
  const base = input();
  assert.match(why({ purpose: "hold" })!, /서버가 짓는 CLEARANCE가 아님/);
  assert.match(why({ purpose: "info" })!, /맞지 않는 종류/);
  assert.match(why({ clearance: { ...base.clearance, open: false } })!, /이미 닫힘/);
  assert.match(why({ session: { id: "bg-x", name: "TEAM_A" } })!, /받는 이가 아님/);
  assert.match(why({ session: { id: "bg-a", name: "TEAM_B" } })!, /toName/); // 잘못된 받는 이
  assert.match(why({ source: "something else" })!, /브리핑·relay의 글과 다름/);
  assert.match(why({ message: base.message.replace("· LAND", "· INFO") })!, /머리/); // 잘못된 머리
  assert.match(why({ message: base.message.replace(/— Reply to this message.*$/s, "— Reply with ROGER C-0100") })!, /끝줄/);
  assert.match(why({ message: base.message.replace('session name "TOWER"', 'session name "OCC"') })!, /TOWER|끝줄/); // 답 주소 줄 없음
  assert.match(why({ message: `${base.message.split("\n")[0]}\n[DISPATCH D-0001] x\n${base.message.split("\n").slice(1).join("\n")}` })!, /다른 머리/);
  assert.match(why({ prior: [{ at: iso(-1), sessionId: "bg-a" }] })!, /이미 보냄/); // 두 번 보내지 않음
  // RESEND: 본문은 "RESEND " + 원래 글, 종류는 원래 것
  const orig = "Hold STAND s.";
  const rs = checkServerClearance(input({ purpose: "resend", source: orig, clearance: { ...base.clearance, type: "HOLD", text: `RESEND ${orig}` }, message: msg("C-0100", "HOLD", `RESEND ${orig}`) }));
  assert.ok(rs.ok);
  assert.ok(!checkServerClearance(input({ purpose: "resend", source: orig, clearance: { ...base.clearance, type: "HOLD", text: orig }, message: msg("C-0100", "HOLD", orig) })).ok);
  // R 종류(INFO)는 ROGER 끝줄
  const info = "PR #8 cannot land yet: x [blocks: blocked]";
  assert.ok(checkServerClearance(input({ purpose: "info", source: info, clearance: { ...base.clearance, type: "INFO", text: info }, message: msg("C-0100", "INFO", info) })).ok);
});

type L = Record<string, unknown> & { t: string; kind: string; op?: string };
const issue = (id: string, min: number, over: Record<string, unknown> = {}): L => ({ t: iso(min), kind: "server-clearance", op: "issue", id, type: "fix", clearanceType: "FIX", key: `fix:${id}`, sessionId: "bg-a", session: "TEAM_A", message: "m", source: "s", ...over });
const failed = (id: string, min: number, attempt: number): L => ({ t: iso(min), kind: "server-clearance", op: "failed", id, type: "fix", key: `fix:${id}`, sessionId: "bg-a", attempt, stage: "write", why: "socket write failed: ENOENT" });

test("재시도와 넘김: 실패 한 번은 1분 뒤 다시, 두 번이면 넘김, 적고 쓰기 전에 멈추면 1분 뒤 넘김, 닫힌 것은 건너뜀", () => {
  const lines = [issue("C-1", 0), failed("C-1", 0, 1), issue("C-2", 0), failed("C-2", 0, 1), failed("C-2", 1.5, 2), issue("C-3", 0), issue("C-4", 0), { t: iso(0), kind: "server-clearance", op: "deliver", id: "C-4" } as L, issue("C-5", 0), failed("C-5", 0, 1)];
  const open = (id: string) => id !== "C-5";
  const early = pendingWorkOf(lines, open, T0 + 30_000);
  assert.deepEqual([early.retry.map((x) => x.id), early.giveUp.map((x) => x.issue.id)], [[], ["C-2"]]);
  const later = pendingWorkOf(lines, open, T0 + 61_000);
  assert.deepEqual(later.retry.map((x) => x.id), ["C-1"]);
  assert.deepEqual(later.giveUp.map((x) => [x.issue.id, x.stage]), [["C-2", "write"], ["C-3", "crash"]]);
  assert.deepEqual([...handedBackOf([{ t: iso(0), kind: "server-clearance", op: "handback", key: "fix:x" } as L])], ["fix:x"]);
});

test("잘못 보냄(쓴 뒤 다시 읽기)과 두 번 보냄", () => {
  const stored = { to: "bg-a", toName: "TEAM_A", type: "LAND", text: "body", open: true };
  const sent = `[ATC C-9] TEAM_A · LAND\nbody\n— Send your reply to the session name "TOWER" (SendMessage to: "TOWER").`;
  assert.deepEqual(clearanceWrongOf({ id: "C-9", sessionName: "TEAM_A", stored, sentSessionId: "bg-a", sentText: sent }), []);
  assert.equal(clearanceWrongOf({ id: "C-9", sessionName: "TEAM_B", stored, sentSessionId: "bg-b", sentText: sent.replace("TOWER", "OCC") }).length, 3);
  const d = (t: number, id: string, bodyHash = "h") => ({ t: iso(t), id, sessionId: "bg-a", type: "info" as const, bodyHash });
  assert.deepEqual(clearanceTwiceOf([d(0, "C-1"), d(5, "C-2"), d(6, "C-3", "other"), d(60 * 25, "C-4")]).map((x) => x.id), ["C-2"]);
});

test("수: 종류마다 7일(보냄·잘못·두 번·막음·실패·안 보임·넘김), 7일 밖은 세지 않는다", () => {
  const dl = (min: number, id: string, type: string, wrong: string[] = [], bodyHash = id): L => ({ t: iso(min), kind: "server-clearance", op: "deliver", id, type, key: "k", attempt: "first", sessionId: "bg-a", session: "TEAM_A", pid: 1, msgId: `m-${id}`, transcript: null, textHash: "x", bodyHash, check: "pass", wrong });
  const lines: L[] = [
    dl(0, "C-1", "land"),
    dl(1, "C-2", "info", ["x"]),
    dl(2, "C-3", "info", [], "C-2"), // 같은 본문 두 번
    { t: iso(3), kind: "server-clearance", op: "refused", id: null, type: "fix", key: "k", sessionId: null, stage: "issue", check: "STAND 없음" },
    failed("C-4", 4, 1),
    { t: iso(5), kind: "server-clearance", op: "confirm", id: "C-1", type: "land", msgId: "m-C-1", sessionId: "bg-a", seen: false, why: "idle" },
    { t: iso(6), kind: "server-clearance", op: "handback", id: "C-4", type: "fix", key: "k", why: "x" },
    { t: iso(7), kind: "server-clearance", op: "breaker", event: "trip", id: "C-1", why: "x" },
    dl(-60 * 24 * 8, "C-0", "land"),
  ];
  const c = serverClearanceCountsOf(lines, T0 + 60_000 * 10);
  assert.deepEqual(c.total, { delivered: 3, wrong: 1, twice: 1, refused: 1, failed: 1, unseen: 1, handback: 1 });
  assert.deepEqual(c.kinds.info, { delivered: 2, wrong: 1, twice: 1, refused: 0, failed: 0, unseen: 0, handback: 0 });
  assert.deepEqual([c.kinds.land.delivered, c.kinds.land.unseen, c.kinds.fix.refused, c.kinds.fix.failed, c.kinds.fix.handback, c.trips], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(c.reasons, [{ reason: "STAND 없음", n: 1 }]);
});
