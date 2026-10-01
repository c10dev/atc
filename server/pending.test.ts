import assert from "node:assert/strict";
import { test } from "node:test";
import { annotatePending, DEFAULT_PENDING_MIN, pendingLevelOf, pendingNeedsOf, pendingReasonOf, pendingSinceByAircraft, pendingTextOf, waitingCallsByAircraft, waitingCallsOf } from "./pending.ts";
import { type AlertsInput, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { parseJob } from "./job-state.ts";
import { txKey, type Transmission } from "./radio.ts";

const MIN = 60_000;
const NOW = Date.parse("2026-10-01T10:00:00.000Z");
const ago = (m: number) => new Date(NOW - m * MIN).toISOString();
const tx = (over: Partial<Transmission>): Transmission => ({ id: "C-0291", at: ago(300), freq: "TOWER", from: "TOWER", to: "OSCAR (TEAM_O)", aircraft: "TEAM_O", kind: "GO AROUND", head: "h", open: true, overdueAt: ago(290), ...over });

test("수준: 10분 전이면 ADVISORY, 10분이 지나면 CAUTION, 기다리는 호출이 있으면 바로 CAUTION", () => {
  assert.equal(DEFAULT_PENDING_MIN, 10);
  const lv = (m: number, calls = 0, pendingMin = 10) => pendingLevelOf({ since: ago(m), now: NOW, pendingMin, calls });
  assert.equal(lv(5), "advisory");
  assert.equal(lv(9), "advisory");
  assert.equal(lv(10), "caution");
  assert.equal(lv(11), "caution");
  assert.equal(lv(1, 1), "caution"); // 막 시작했어도 호출이 기다리면
  assert.equal(lv(20, 0, 30), "advisory"); // 설정한 분을 따른다
  assert.equal(pendingLevelOf({ since: null, now: NOW, pendingMin: 10, calls: 0 }), "advisory"); // 시각을 모르면 시끄럽게 하지 않는다
});

test("기다리는 호출: 그 AIRCRAFT에게 가는 열린 호출만, 오래된 것부터. 답이 붙었거나 다른 AIRCRAFT나 관제끼리의 줄은 아니다", () => {
  const txs = [
    tx({ id: "D-0340", at: ago(60), kind: "FLIGHT PLAN", from: "OCC" }),
    tx({ id: "C-0291", at: ago(300) }),
    tx({ id: "D-0336", at: ago(120), kind: "FLIGHT PLAN", from: "OCC" }),
    tx({ id: "C-0100", open: undefined, kind: "GO AROUND" }), // 닫힘
    tx({ id: "C-0200", aircraft: "TEAM_C" }), // 다른 AIRCRAFT
    tx({ id: "CC-0003", from: "OCC", kind: "CREW CHANGE", aircraft: "TEAM_O" }),
    tx({ id: "R-1", from: "GOLF (TEAM_G)", kind: "READBACK", aircraft: "TEAM_O" }), // 답은 호출이 아니다
  ];
  assert.deepEqual(waitingCallsOf(txs, "TEAM_O").map((c) => c.id), ["C-0291", "D-0336", "CC-0003", "D-0340"].sort((a, b) => txs.find((t) => t.id === a)!.at.localeCompare(txs.find((t) => t.id === b)!.at)));
  assert.deepEqual([...waitingCallsByAircraft(txs).keys()].sort(), ["TEAM_C", "TEAM_O"]);
  assert.deepEqual(waitingCallsOf(txs, "TEAM_Z"), []);
});

test("글: 나이, 기다리는 호출 수와 종류별 묶음, 청하는 것", () => {
  const calls = [{ id: "C-0291", kind: "GO AROUND" }, { id: "D-0336", kind: "FLIGHT PLAN" }, { id: "D-0340", kind: "FLIGHT PLAN" }];
  assert.equal(
    pendingTextOf({ name: "TEAM_O", since: ago(345), now: NOW, calls, needs: "approve Write: /x/memory/a.md" }),
    "TEAM_O — PENDING approval 5h45m · 3 calls waiting (GO AROUND C-0291, FLIGHT PLAN D-0336, D-0340) · approve Write: /x/memory/a.md",
  );
  assert.equal(pendingTextOf({ name: "TEAM_C", since: ago(5), now: NOW, calls: [], needs: null }), "TEAM_C — PENDING approval 5m");
  assert.equal(pendingTextOf({ name: "TEAM_C", since: ago(60), now: NOW, calls: [calls[0]], needs: null }), "TEAM_C — PENDING approval 1h · 1 call waiting (GO AROUND C-0291)");
});

test("parseJob: working인 job의 needs는 pendingNeeds로 남고, blocked의 needs 규칙은 그대로", () => {
  const base = { updatedAt: "2026-10-01T04:07:00Z", tempo: "active" };
  const w = parseJob({ ...base, state: "working", detail: "memory 쓰는 중", needs: "approve Write: /home/x/memory/n.md" }, null);
  assert.equal(w?.pendingNeeds, "approve Write: /home/x/memory/n.md");
  assert.equal(w?.needs, null); // NEEDS YOU(blocked)는 여전히 아니다
  const b = parseJob({ ...base, state: "blocked", detail: "d", needs: "message when PR merges" }, null);
  assert.equal(b?.needs, "message when PR merges");
  assert.equal(b?.pendingNeeds, null);
  assert.equal(parseJob({ ...base, state: "working", detail: "d" }, null)?.pendingNeeds, null);
});

test("pendingNeedsOf: working이고 health가 PENDING일 때만 보이고, 죽은 세션이나 다른 health는 아니다", () => {
  const job = { pendingNeeds: "approve Write: /m/a.md" };
  assert.equal(pendingNeedsOf({ status: "idle", health: { code: "PENDING" }, job }), "approve Write: /m/a.md");
  assert.equal(pendingNeedsOf({ status: "idle", health: { code: "STALLED" }, job }), null);
  assert.equal(pendingNeedsOf({ status: "idle", health: null, job }), null);
  assert.equal(pendingNeedsOf({ status: "dead", health: { code: "PENDING" }, job }), null);
  assert.equal(pendingNeedsOf({ status: "idle", health: { code: "PENDING" }, job: null }), null);
});

test("RADIO 사유: 받는 AIRCRAFT가 PENDING이면 열린 호출 줄에 붙고, 닫힌 줄·다른 AIRCRAFT·관제끼리의 줄에는 붙지 않는다. txKey가 달라진다", () => {
  const since = new Map([["TEAM_O", "2026-10-01T04:07:12.000Z"]]);
  const out = annotatePending([tx({ id: "C-1" }), tx({ id: "C-2", open: undefined }), tx({ id: "C-3", aircraft: "TEAM_C" }), tx({ id: "G-1", from: "GOLF (TEAM_G)", kind: "READBACK" })], (r) => since.get(r) ?? null, NOW);
  assert.equal(out[0].reason, "receiver waiting for approval since 04:07Z");
  assert.equal(out[1].reason, undefined);
  assert.equal(out[2].reason, undefined);
  assert.equal(out[3].reason, undefined);
  assert.equal(pendingReasonOf("2026-10-01T04:07:12.000Z", NOW), "receiver waiting for approval since 04:07Z");
  assert.notEqual(txKey(out[0]), txKey(tx({ id: "C-1" })));
});

test("pendingSinceByAircraft: 살아 있는 PENDING 세션만, REGISTRATION으로", () => {
  const m = pendingSinceByAircraft([
    { name: "TEAM_O", status: "idle", health: { code: "PENDING", since: "2026-10-01T04:07:00Z" } },
    { name: "TEAM_C", status: "dead", health: { code: "PENDING", since: "2026-10-01T07:30:00Z" } },
    { name: "TEAM_K", status: "idle", health: { code: "STALLED", since: "2026-10-01T07:00:00Z" } },
    { name: "TOWER", status: "idle", health: { code: "PENDING", since: "2026-10-01T07:00:00Z" } },
  ]);
  assert.deepEqual([...m], [["TEAM_O", "2026-10-01T04:07:00Z"]]);
});

// ── 알림 항목: 같은 키로 수준만 오른다 ──
const base = (over: Partial<AlertsInput> = {}): AlertsInput => ({ sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null, ...over });
const sess = (since: string, over: Record<string, unknown> = {}) =>
  ({ id: "s1", name: "TEAM_O", status: "idle", jobId: "58cdf247", attachDir: "/home/c10/.claude-acct-1", job: { state: "working", detail: "", needs: null, suggestedReply: null, pendingNeeds: "approve Write: /m/n.md", since, tempo: "active" }, health: { code: "PENDING", level: "info", since, detail: "도구 호출이 승인을 기다림", next: "SUPERVISOR가 그 세션에서 승인하거나 거절한다", holds: false }, ...over }) as AlertsInput["sessions"][number];
const pend = (calls: Record<string, { id: string; kind: string }[]> = {}, pendingMin = 10) => ({ now: NOW, pendingMin, calls: new Map(Object.entries(calls)) });

test("알림: 5분이면 ADVISORY, 11분이면 CAUTION(키는 같다), 열린 호출이 있으면 5분이어도 CAUTION이고 호출이 글에 든다", () => {
  const at5 = supervisorAlertsOf(base({ sessions: [sess(ago(5))], pending: pend() })).filter((a) => a.group === "pending");
  const at11 = supervisorAlertsOf(base({ sessions: [sess(ago(11))], pending: pend() })).filter((a) => a.group === "pending");
  assert.equal(at5.length, 1);
  assert.equal(at5[0].level, "advisory");
  assert.equal(at11[0].level, "caution");
  assert.equal(at11[0].key, `pending|tool|s1|${ago(11)}`);
  const withCalls = supervisorAlertsOf(base({ sessions: [sess(ago(5))], pending: pend({ TEAM_O: [{ id: "D-0336", kind: "FLIGHT PLAN" }] }) })).filter((a) => a.group === "pending");
  assert.equal(withCalls[0].level, "caution");
  assert.match(withCalls[0].text, /1 call waiting \(FLIGHT PLAN D-0336\)/);
  assert.match(withCalls[0].text, /approve Write: \/m\/n\.md$/); // 청하는 것
  assert.equal(withCalls[0].next, "SUPERVISOR가 그 세션에서 승인하거나 거절한다 — CLAUDE_CONFIG_DIR=/home/c10/.claude-acct-1 claude attach 58cdf247");
});

test("알림: pending 입력이 없으면 전과 같다(ADVISORY), 죽은 세션은 알리지 않고, 다른 AIRCRAFT의 호출은 세지 않는다", () => {
  assert.equal(supervisorAlertsOf(base({ sessions: [sess(ago(400))] })).filter((a) => a.group === "pending")[0].level, "advisory");
  assert.equal(supervisorAlertsOf(base({ sessions: [sess(ago(400), { status: "dead" })], pending: pend() })).filter((a) => a.group === "pending").length, 0);
  const other = supervisorAlertsOf(base({ sessions: [sess(ago(2))], pending: pend({ TEAM_C: [{ id: "C-1", kind: "GO AROUND" }] }) })).filter((a) => a.group === "pending");
  assert.equal(other[0].level, "advisory");
});
