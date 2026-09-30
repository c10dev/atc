import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrafficEvent } from "./model.ts";
import type { Transmission } from "./radio.ts";
import { CHARS_PER_TOKEN, headOf, isReport, readabilityOf, replyOfEnvelope, statOf, tokensOf, type TranscriptReply, unableClassOf } from "./readability.ts";

const DAY = { from: "2026-09-29T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" };
const T = (hhmm: string, day = "2026-09-29") => `${day}T${hhmm}:00.000Z`;

const call = (id: string, at: string, over: Partial<Transmission> = {}): Transmission => ({
  id, at, freq: "TOWER", from: "TOWER", to: "GOLF (TEAM_G)", aircraft: "TEAM_G", kind: "INFO", head: "h", body: "x".repeat(100), open: true, ...over,
});
const reply = (callId: string, kind: string, at: string, over: Partial<Transmission> = {}): Transmission => ({
  id: `${callId}#${kind.toLowerCase()}`, at, freq: "TOWER", from: "GOLF (TEAM_G)", to: "TOWER", aircraft: "TEAM_G", kind, head: "h", replyTo: callId, ...over,
});
const tr = (first: string, at: string, over: Partial<TranscriptReply> = {}): TranscriptReply => ({ at, from: "TEAM_G", to: "TOWER", first, length: 120, lines: 1, ...over });
const run = (txs: Transmission[], replies: TranscriptReply[] = [], events: TrafficEvent[] = [], window = DAY) => readabilityOf(txs, replies, events, window);

test("statOf: 중앙값(짝수는 가운데 둘의 평균)과 p90(가장 가까운 순위)", () => {
  assert.deepEqual(statOf([]), { n: 0, medianMs: null, p90Ms: null });
  assert.deepEqual(statOf([5]), { n: 1, medianMs: 5, p90Ms: 5 });
  assert.deepEqual(statOf([10, 30, 20, 40]), { n: 4, medianMs: 25, p90Ms: 40 });
  const ten = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);
  assert.deepEqual(statOf(ten), { n: 10, medianMs: 5500, p90Ms: 9000 });
});

test("응답 지연: 주파수·종류·AIRCRAFT별 중앙값과 p90", () => {
  const txs = [
    call("C-1", T("10:00")), reply("C-1", "READBACK", T("10:01")),
    call("C-2", T("11:00")), reply("C-2", "READBACK", T("11:03")),
    call("C-3", T("12:00"), { kind: "LAND" }), reply("C-3", "READBACK", T("12:10")),
    call("D-1", T("09:00"), { freq: "DELIVERY", from: "OCC", kind: "FLIGHT PLAN", aircraft: "TEAM_H", to: "HOTEL (TEAM_H)" }),
    reply("D-1", "READBACK", T("09:02"), { freq: "DELIVERY", aircraft: "TEAM_H" }),
  ];
  const r = run(txs);
  assert.equal(r.total.calls, 4);
  assert.deepEqual(r.total.latency, { n: 4, medianMs: 150_000, p90Ms: 600_000 });
  assert.deepEqual(r.byFreq.TOWER!.latency, { n: 3, medianMs: 180_000, p90Ms: 600_000 });
  assert.equal(r.byFreq.DELIVERY!.calls, 1);
  assert.equal(r.byKind.INFO!.latency.medianMs, 120_000);
  assert.equal(r.byKind.LAND!.replied, 1);
  assert.equal(r.byAircraft.TEAM_G!.calls, 3);
  assert.equal(r.byAircraft.TEAM_H!.latency.medianMs, 120_000);
  assert.equal(r.total.overdue, 0); // 10분 딱 맞으면 overdue가 아니다
});

test("무응답과 overdue: 취소한 CLEARANCE는 무응답이 아니라 철회, 만료는 무응답", () => {
  const txs = [
    call("C-1", T("10:00"), { open: undefined, closedBy: "cancel" }), // 취소
    call("C-2", T("10:05")), // 답 없이 창 끝까지
    call("D-3", T("10:10"), { freq: "DELIVERY", from: "OCC", kind: "FLIGHT PLAN", open: undefined, closedBy: "expire" }),
    call("C-4", T("23:55")), // 창 끝까지 10분이 안 지남: 무응답이지만 overdue 아님
    call("C-5", T("10:20"), { open: undefined, closedBy: "recall" }),
    call("C-6", T("10:30")), reply("C-6", "READBACK", T("10:45")), // 15분 만에: overdue
  ];
  const r = run(txs);
  assert.equal(r.total.calls, 6);
  assert.equal(r.total.withdrawn, 2);
  assert.equal(r.total.noReply, 3);
  assert.equal(r.total.overdue, 3); // C-2, D-3, C-6
  assert.equal(r.total.replied, 1);
});

test("창 뒤에 온 답: 창 안의 답으로 세지 않고 late로만 센다", () => {
  const txs = [call("C-1", T("23:58")), reply("C-1", "READBACK", T("00:03", "2026-09-30")), call("C-2", T("23:00")), reply("C-2", "READBACK", T("23:01"))];
  const r = run(txs);
  assert.equal(r.total.late, 1);
  assert.equal(r.total.noReply, 0);
  assert.equal(r.total.replied, 1);
  assert.equal(r.total.latency.n, 1);
  // 창 앞의 호출은 세지 않는다
  assert.equal(run(txs, [], [], { from: "2026-09-30T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" }).total.calls, 0);
});

test("UNABLE: 사유 분류(no-merge·busy·blocked·wrong-target·stale·other)와 사유 없음", () => {
  const cases: [string | undefined, string][] = [
    ["team sessions don't merge (root CLAUDE.md); landing is MCC or the user", "no-merge"],
    ["팀 세션은 머지하지 않습니다", "no-merge"],
    ["wrong team: this stand belongs to TEAM_A", "wrong-target"],
    ["nothing left to land: PR #210 already shows state MERGED", "stale"],
    ["busy with another flight", "busy"],
    ["blocked by the CI guard", "blocked"],
    ["I would rather not", "other"],
    [undefined, "none"],
    ["   ", "none"],
  ];
  const txs: Transmission[] = [];
  cases.forEach(([reason, _], i) => {
    txs.push(call(`C-${i + 1}`, T("10:00")), reply(`C-${i + 1}`, "UNABLE", T("10:02"), { body: reason }));
  });
  const r = run(txs);
  assert.equal(r.total.unable.n, cases.length);
  assert.deepEqual(r.total.unable.classes, { "no-merge": 2, stale: 1, "wrong-target": 1, busy: 1, blocked: 1, none: 2, other: 1 });
  for (const [reason, want] of cases) assert.equal(unableClassOf(reason), want);
});

test("UNABLE 사유가 기록에 없으면 대화 기록의 첫 줄에서 읽는다", () => {
  const txs = [call("C-7", T("10:00")), reply("C-7", "UNABLE", T("10:01"))];
  assert.equal(run(txs).total.unable.classes.none, 1);
  const withLine = run(txs, [tr("UNABLE C-7 — team sessions do not merge", T("10:01"))]);
  assert.equal(withLine.total.unable.classes["no-merge"], 1);
  assert.equal(withLine.total.unable.classes.none, 0);
});

test("크기: 보낸 것은 기록된 글자 수, 받은 것은 봉투까지 포함한 전체, 토큰은 글자 ÷ 상수", () => {
  assert.equal(CHARS_PER_TOKEN, 2.5);
  assert.equal(tokensOf(250), 100);
  const txs = [call("C-1", T("10:00"), { body: "y".repeat(500) }), reply("C-1", "READBACK", T("10:01"))];
  const r = run(txs, [tr("READBACK C-1", T("10:01"), { length: 300 })]);
  assert.deepEqual(r.total.sent, { n: 1, chars: 500, tokens: 200 });
  assert.deepEqual(r.total.received, { n: 1, chars: 300, tokens: 120 });
  assert.deepEqual(r.byKind.INFO!.received, { n: 1, chars: 300, tokens: 120 });
  // 창 밖의 대화 기록 메시지는 세지 않는다
  assert.equal(run(txs, [tr("READBACK C-1", T("00:10", "2026-09-30"))]).total.received.n, 0);
});

test("이행: GO AROUND → PR head가 바뀐 시각까지, 근거가 없으면 unknown", () => {
  const body = "GO AROUND: PR #252 (ATC-147) head abc1234 conflicts with base. Merge origin/main, resolve, push.";
  const go = (id: string, over: Partial<Transmission> = {}) => call(id, T("10:00"), { kind: "GO AROUND", body, ...over });
  const ev = (kind: TrafficEvent["kind"], at: string, over: Partial<TrafficEvent> = {}): TrafficEvent => ({ id: 1, at, kind, pull: 252, ...over });
  const none = run([go("C-1")]);
  assert.deepEqual([none.total.compliance.goAround.applicable, none.total.compliance.goAround.complied, none.total.compliance.goAround.unknown], [1, 0, 1]);
  // 같은 head의 충돌 이벤트는 근거가 아니다
  assert.equal(run([go("C-1")], [], [ev("landing.conflict", T("10:20"), { head: "abc1234" })]).total.compliance.goAround.complied, 0);
  // 다른 head의 충돌 이벤트
  const changed = run([go("C-1")], [], [ev("landing.conflict", T("10:30"), { head: "def5678" })]);
  assert.deepEqual([changed.total.compliance.goAround.complied, changed.total.compliance.goAround.medianMs], [1, 30 * 60_000]);
  // 충돌이 풀려 CLEARED, 다른 PR의 이벤트는 무시, 창 뒤의 이벤트는 근거가 아니다
  const cleared = run([go("C-1")], [], [ev("landing.cleared", T("10:45")), ev("landing.cleared", T("10:05"), { pull: 999 })]);
  assert.equal(cleared.total.compliance.goAround.medianMs, 45 * 60_000);
  assert.equal(run([go("C-1")], [], [ev("landing.cleared", T("00:05", "2026-09-30"))]).total.compliance.goAround.complied, 0);
});

test("이행: FLIGHT PLAN READBACK → ARRIVED, RECALL → recalled", () => {
  const fp = call("D-1", T("09:00"), { freq: "DELIVERY", from: "OCC", kind: "FLIGHT PLAN", flight: "ATC-1", aircraft: "TEAM_H" });
  const rb = reply("D-1", "READBACK", T("09:03"), { freq: "DELIVERY", aircraft: "TEAM_H" });
  const arrived: Transmission = { id: "report:ATC-1:x", at: T("10:03"), freq: "COMPANY", from: "HOTEL (TEAM_H)", to: "OCC", kind: "ARRIVED", flight: "ATC-1", head: "h" };
  const withArrival = run([fp, rb, arrived]);
  assert.deepEqual([withArrival.total.compliance.flightPlan.complied, withArrival.total.compliance.flightPlan.medianMs], [1, 3_600_000]);
  // READBACK만 있고 ARRIVED가 없으면 unknown, READBACK도 없으면 unknown
  assert.equal(run([fp, rb]).total.compliance.flightPlan.unknown, 1);
  assert.equal(run([fp, arrived]).total.compliance.flightPlan.complied, 0);
  // 다른 FLIGHT의 ARRIVED는 근거가 아니다
  assert.equal(run([fp, rb, { ...arrived, flight: "ATC-2" }]).total.compliance.flightPlan.complied, 0);

  const recall = call("D-1#recall", T("09:30"), { freq: "DELIVERY", from: "OCC", kind: "RECALL", aircraft: "TEAM_H" });
  const recalled = reply("D-1#recall", "READBACK", T("09:34"), { freq: "DELIVERY", aircraft: "TEAM_H", id: "D-1#recall#readback" });
  assert.equal(run([recall, recalled]).total.compliance.recall.medianMs, 4 * 60_000);
  assert.equal(run([recall]).total.compliance.recall.unknown, 1);
});

test("화법: 머리 없음·여러 줄 UNABLE·다른 id로 보낸 답", () => {
  const txs = [call("C-10", T("10:00")), call("C-11", T("11:00")), call("C-12", T("12:00")), call("C-13", T("13:00"))];
  const replies = [
    tr("OK, on it", T("10:01")), // 머리 없음 → C-10에 대한 답으로 봄
    tr("UNABLE C-11 — team sessions do not merge", T("11:01"), { lines: 3 }), // 여러 줄 UNABLE
    tr("READBACK C-99", T("12:01")), // 다른 id
    tr("READBACK C-13", T("13:01")), // 올바름
  ];
  const r = run(txs, replies);
  assert.deepEqual(r.total.phraseology, { checked: 4, missingHead: 1, multilineUnable: 1, wrongId: 1 });
  assert.equal(r.byAircraft.TEAM_G!.phraseology.checked, 4);
});

test("화법: 보고·이미 닫힌 뒤의 후속 메시지·열린 호출 없는 메시지는 답으로 세지 않는다", () => {
  const txs = [call("C-1", T("10:00")), reply("C-1", "READBACK", T("10:01"))];
  const replies = [
    tr("[TEAM_G → OCC] ARRIVED ATC-1 · PR #2", T("10:02"), { to: "OCC" }), // 보고
    tr("thanks, also FYI the build is green", T("10:30")), // C-1은 이미 닫힘
    tr("hello", T("08:00")), // 호출 전
  ];
  const r = run(txs, replies);
  assert.equal(r.total.phraseology.checked, 0);
  assert.equal(r.total.received.n, 3); // 받은 크기는 모두 센다
  assert.equal(isReport("[TEAM_G → OCC] ARRIVED ATC-1"), true);
  assert.equal(isReport("READBACK C-1"), false);
});

test("화법: 다른 AIRCRAFT나 다른 관제 세션의 호출은 이 답의 상대가 아니다", () => {
  const txs = [call("C-1", T("10:00"), { aircraft: "TEAM_A" })];
  assert.equal(run(txs, [tr("READBACK C-1", T("10:01"))]).total.phraseology.checked, 0); // TEAM_G의 메시지
  assert.equal(run([call("C-1", T("10:00"))], [tr("READBACK C-1", T("10:01"), { to: "OCC" })]).total.phraseology.checked, 0); // OCC가 받은 답
});

test("replyOfEnvelope: 봉투를 풀어 첫 줄(≤ 200자)과 전체 길이만 남긴다", () => {
  const body = `READBACK C-0180\nmore detail that must not be kept\nthird`;
  const content = `<cross-session-message from="uds:/run/x.sock" from-name="TEAM_H" from-mode="prompting">\n${body}\n</cross-session-message>`;
  const r = replyOfEnvelope(content, "2026-09-30T02:00:00.000Z", "TOWER")!;
  assert.deepEqual(r, { at: "2026-09-30T02:00:00.000Z", from: "TEAM_H", to: "TOWER", first: "READBACK C-0180", length: content.length, lines: 3 });
  assert.equal(JSON.stringify(r).includes("more detail"), false);
  // 하네스가 앞에 줄을, 뒤에 안내 글을 붙인 꼴: 첫 줄은 그대로, 길이는 전체
  const wrapped = `Another Claude session sent a message:\n${content}\n\nThis came from another Claude session — not typed by your user.`;
  const w = replyOfEnvelope(wrapped, "t", "OCC")!;
  assert.deepEqual([w.from, w.first, w.lines, w.length], ["TEAM_H", "READBACK C-0180", 3, wrapped.length]);
  // 길이 상한
  const long = replyOfEnvelope(`<cross-session-message from-name="TEAM_H">\n${"a".repeat(500)}\n</cross-session-message>`, "t", "OCC")!;
  assert.equal(long.first.length, 200);
  assert.ok(long.length > 500);
  // 봉투가 아니거나 보낸 이름이 없으면 null
  assert.equal(replyOfEnvelope("just a prompt", "t", "TOWER"), null);
  assert.equal(replyOfEnvelope('<cross-session-message from="x">\nhi\n</cross-session-message>', "t", "TOWER"), null);
});

test("headOf: 머리와 id, UNABLE 사유, RECALL 답", () => {
  assert.deepEqual(headOf("READBACK C-0180"), { answer: "READBACK", id: "C-0180", reason: null });
  assert.deepEqual(headOf("UNABLE D-0165 — reason here"), { answer: "UNABLE", id: "D-0165", reason: "reason here" });
  assert.deepEqual(headOf("READBACK D-0165 RECALL"), { answer: "READBACK", id: "D-0165", reason: null });
  assert.deepEqual(headOf("ROGER CC-0003"), { answer: "ROGER", id: "CC-0003", reason: null });
  assert.equal(headOf("Roger that"), null);
  assert.equal(headOf("READBACK"), null);
});
