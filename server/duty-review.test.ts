import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDutyConfig } from "./duty-config.ts";
import { decideReview, emptyMisfiresOf, heartbeatBoundary, heartbeatDue, lastRunOf, pendingSkipOf, reviewFactsOf, reviewMemosOf, skipCountsOf, skipVerdictOf, namedReadyOf, nextReviewId, openSimilarKey, PROPOSALS_MAX, REVIEW_DAILY_MAX, REVIEW_LEAK_SKIP_KINDS, reviewDaysOf, reviewKeyOf, reviewLeaksOf, reviewPromptOf, type ReviewConfig, type ReviewLine, type ReviewMemo, type ReviewSignals, signalsOf } from "./duty-review.ts";
import type { Ticket } from "./model.ts";
import { NOT_RELEASED_WHY } from "./release.ts";

const MIN = 60_000;
const NOW = Date.parse("2026-10-02T12:00:00Z");
const cfg: ReviewConfig = { review: true, reviewEveryMin: 240, reviewIdleMin: 20, reviewLeakMin: 60, reviewGapMin: 30, reviewEmpty: true, reviewEmptyMin: 20, reviewEmptyGapMin: 60 };
const calm: ReviewSignals = { idleAircraft: [], waitingFlights: [], leakMin: null, leakTitle: null };
const base = { now: NOW, lastAt: NOW - 60 * MIN, busy: false, cfg, signals: calm, idleSince: null as number | null };

test("signalsOf: 놀고 있는(available) AIRCRAFT와 배정 못 받은 Todo FLIGHT(후보·받을 곳 없음·발권 대기·우선순위 없음), 가장 오래된 leak", () => {
  const dispatch = {
    plan: {
      aircraft: [{ registration: "TEAM_A", available: true }, { registration: "TEAM_B", available: false }],
      assign: [{ flight: "ATC-1" }],
      unserved: [{ flight: "ATC-2" }],
      excluded: [
        { flight: "ATC-3", reason: NOT_RELEASED_WHY },
        { flight: "ATC-4", reason: "wake:J — 너무 커서" },
        { flight: "TEAM_B", reason: "TEAM_B — ATC-9 아직 진행 중" },
        { flight: "ATC-5", reason: "우선순위가 없음" },
      ],
    },
  };
  const s = signalsOf(dispatch, [{ title: "LANDING #9", sinceMs: NOW - 90 * MIN }, { title: "UPDATE", sinceMs: NOW - 10 * MIN }], NOW);
  assert.deepEqual(s.idleAircraft, ["TEAM_A"]);
  assert.deepEqual(s.waitingFlights, ["ATC-1", "ATC-2", "ATC-3", "ATC-5"]);
  assert.deepEqual([s.leakMin, s.leakTitle], [90, "LANDING #9"]);
  assert.deepEqual(signalsOf(null, [], NOW), calm); // 모르는 모양이면 빈 신호
});

test("decideReview: 스위치가 꺼졌거나 돌고 있거나 간격 안이면 시작하지 않는다", () => {
  const due = { ...base, lastAt: NOW - 300 * MIN };
  assert.equal(decideReview(due).run, true);
  assert.equal(decideReview({ ...due, cfg: { ...cfg, review: false } }).why, "off");
  assert.equal(decideReview({ ...due, busy: true }).why, "busy");
  const quick = decideReview({ ...due, lastAt: NOW - 10 * MIN, signals: { ...calm, leakMin: 500, leakTitle: "x" } });
  assert.deepEqual([quick.run, quick.why], [false, "gap"]); // 트리거가 서도 간격(30분) 안이면 기다린다
});

test("decideReview: 정기(schedule)는 간격이 지나면, leak은 기준 분을 넘으면", () => {
  assert.equal(decideReview({ ...base, lastAt: NOW - 239 * MIN }).run, false);
  const sch = decideReview({ ...base, lastAt: NOW - 241 * MIN });
  assert.deepEqual([sch.run, sch.trigger], [true, "schedule"]);
  assert.equal(decideReview({ ...base, signals: { ...calm, leakMin: 59, leakTitle: "x" } }).run, false);
  const leak = decideReview({ ...base, signals: { ...calm, leakMin: 61, leakTitle: "LANDING #9" } });
  assert.deepEqual([leak.run, leak.trigger], [true, "leak"]);
  assert.match(leak.detail!, /LANDING #9 held 61 min/);
});

test("decideReview: 놀고-일감이 이어진 시간을 센다. 풀리면 시작 시각을 버린다", () => {
  const stuck: ReviewSignals = { ...calm, idleAircraft: ["TEAM_A"], waitingFlights: ["ATC-1"] };
  const first = decideReview({ ...base, signals: stuck });
  assert.deepEqual([first.run, first.idleSince], [false, NOW]); // 처음 본 때부터 센다
  const mid = decideReview({ ...base, signals: stuck, idleSince: NOW - 19 * MIN });
  assert.equal(mid.run, false);
  const hit = decideReview({ ...base, signals: stuck, idleSince: NOW - 20 * MIN });
  assert.deepEqual([hit.run, hit.trigger, hit.idleSince], [true, "idle", null]);
  assert.match(hit.detail!, /TEAM_A idle for 20 min while ATC-1 wait/);
  // 일감이 없으면(또는 놀고 있는 AIRCRAFT가 없으면) 센 시간은 사라진다
  assert.equal(decideReview({ ...base, signals: { ...stuck, waitingFlights: [] }, idleSince: NOW - 99 * MIN }).idleSince, null);
  // 간격 안이라 못 돌아도 센 시간은 이어진다
  assert.equal(decideReview({ ...base, lastAt: NOW - 5 * MIN, signals: stuck, idleSince: NOW - 50 * MIN }).idleSince, NOW - 50 * MIN);
});

const prompt = (over: Partial<Parameters<typeof reviewPromptOf>[0]> = {}) =>
  reviewPromptOf({ id: "R-0003", trigger: "idle", detail: "TEAM_A idle for 20 min while ATC-1 wait", signals: { ...calm, idleAircraft: ["TEAM_A"], waitingFlights: ["ATC-1"] }, linear: true, landing: ["PR #9 CLEARED"], alerts: ["warning: x"], openIssues: [{ key: "ATC-5", title: "Open thing" }], ...over });

test("지시문: 머리·읽을 것·사실·할 일, 제안은 Backlog만이고 Todo를 쓰지 않는다. 열린 이슈를 준다", () => {
  const t = prompt();
  assert.match(t, /^\[ATC DUTY REVIEW R-0003\] trigger: idle — TEAM_A idle for 20 min/);
  assert.match(t, /landing queue/);
  assert.match(t, /dispatch brief/);
  assert.match(t, /Korean/);
  assert.match(t, /--state Backlog/);
  assert.match(t, new RegExp(`At most ${PROPOSALS_MAX}`));
  assert.match(t, /Never set Todo/);
  assert.match(t, /RELEASE screen/);
  assert.match(t, /--blocked-by/);
  assert.match(t, /ATC-5 Open thing/);
  assert.doesNotMatch(t, /--state Todo/);
  assert.doesNotMatch(t, /[ㄱ-힝]/, "세션이 읽는 글은 영어다(ATC-126)");
});

test("지시문: Linear 쓰기가 꺼져 있으면 이슈를 만들지 말고 요약에 적게 한다", () => {
  const t = prompt({ linear: false });
  assert.match(t, /Linear writes are off/);
  assert.doesNotMatch(t, /duty linear create/);
});

const tk = (key: string, title: string, stateType = "backlog"): Ticket =>
  ({ key, title, state: "x", stateType, stateColor: null, assignee: null, takenBy: null, priority: 2, url: null, updatedAt: null, project: null, labels: [], createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [] }) as Ticket;

test("openSimilarKey: 열린 이슈와 제목이 비슷하면 그 key, 닫힌 이슈와는 비교하지 않는다", () => {
  const ts = [tk("ATC-5", "Speed up the landing queue refresh"), tk("ATC-6", "Retire the old scheduler", "completed")];
  assert.equal(openSimilarKey("Speed up the landing queue refresh loop", ts, NOW), "ATC-5");
  assert.equal(openSimilarKey("Retire the old scheduler", ts, NOW), null);
  assert.equal(openSimilarKey("Something unrelated entirely", ts, NOW), null);
});

test("하루 세기: 점검·제안은 그날, 발권은 제안 뒤의 발권 기록, 버림은 취소된 제안", () => {
  const lines: ReviewLine[] = [
    { v: 1, ev: "review", id: "R-0001", at: "2026-10-01T03:00:00Z", trigger: "schedule", detail: "" },
    { v: 1, ev: "proposal", at: "2026-10-01T03:10:00Z", review: "R-0001", key: "ATC-1", title: "a" },
    { v: 1, ev: "proposal", at: "2026-10-01T03:11:00Z", review: "R-0001", key: "ATC-2", title: "b" },
    { v: 1, ev: "proposal", at: "2026-10-01T03:12:00Z", review: "R-0001", key: "ATC-3", title: "c" },
    { v: 1, ev: "review", id: "R-0002", at: "2026-10-02T09:00:00Z", trigger: "leak", detail: "" },
    { v: 1, ev: "review", id: "R-0003", at: "2026-09-01T09:00:00Z", trigger: "leak", detail: "" }, // 창 밖
  ];
  const releases = [
    { op: "release" as const, flight: "ATC-1", channel: "screen" as const, at: "2026-10-01T05:00:00Z", hash: "h" },
    { op: "release" as const, flight: "ATC-3", channel: "screen" as const, at: "2026-10-01T02:00:00Z", hash: "h" }, // 제안보다 앞선 발권은 세지 않는다
  ];
  const days = reviewDaysOf(lines, releases, [{ key: "ATC-2", stateType: "canceled" }], NOW, 14);
  assert.deepEqual(days, [
    { day: "2026-10-01", reviews: 1, proposals: 3, fired: 1, discarded: 1 },
    { day: "2026-10-02", reviews: 1, proposals: 0, fired: 0, discarded: 0 },
  ]);
  assert.equal(nextReviewId(lines), "R-0004");
  assert.equal(nextReviewId([]), "R-0001");
});

test("설정: 스위치는 기본 켜짐(live first)이고 false로만 끈다", () => {
  assert.equal(parseDutyConfig(null).review, true);
  assert.equal(parseDutyConfig({ review: false }).review, false);
});

// ── 되풀이 점검 막기(MCC P1): 바뀌지 않는 상황은 간격마다 점검을 부르지 않는다 ──
test("decideReview: 열린 채인 leak은 같은 leak으로 reviewEveryMin 안에 다시 점검하지 않고, 새 leak이나 그 뒤에는 한다", () => {
  const leak: ReviewSignals = { ...calm, leakMin: 200, leakTitle: "LANDING #9" };
  const memo = (agoMin: number, key: string): ReviewMemo => ({ at: NOW - agoMin * MIN, trigger: "leak", key });
  // 31분 전에 이 leak으로 점검했다: 간격(30분)은 지났지만 같은 leak이라 기다린다
  const same = decideReview({ ...base, lastAt: NOW - 31 * MIN, signals: leak, history: [memo(31, "LANDING #9")] });
  assert.deepEqual([same.run, same.why], [false, "quiet"]);
  // 다른 leak이 열려 있으면 바로 한다
  assert.deepEqual([decideReview({ ...base, lastAt: NOW - 31 * MIN, signals: { ...leak, leakTitle: "UPDATE" }, history: [memo(31, "LANDING #9")] }).run], [true]);
  // 같은 leak이 reviewEveryMin(240분)을 넘겨 열려 있으면 다시 한다
  assert.equal(decideReview({ ...base, lastAt: NOW - 241 * MIN, signals: leak, history: [memo(241, "LANDING #9")] }).trigger, "leak");
  // 하루로 세어 보면: 열린 leak 하나가 하루 종일 열려 있어도 6번을 넘지 않는다
  let t = NOW;
  const hist: ReviewMemo[] = [];
  for (let m = 0; m < 24 * 60; m += 5) {
    t = NOW + m * MIN;
    const d = decideReview({ ...base, now: t, lastAt: Math.max(0, ...hist.map((h) => h.at)), signals: leak, history: hist });
    if (d.run) hist.push({ at: t, trigger: d.trigger!, key: d.key ?? "" });
  }
  assert.ok(hist.length <= 7, `하루 ${hist.length}번`);
  assert.deepEqual([...new Set(hist.map((h) => h.trigger))], ["leak"], "같은 leak은 reviewEveryMin마다 한 번");
});

test("decideReview: 놀고-일감이 같으면 다시 점검하지 않고, AIRCRAFT나 FLIGHT 집합이 바뀌면 한다", () => {
  const stuck: ReviewSignals = { ...calm, idleAircraft: ["TEAM_A"], waitingFlights: ["ATC-1", "ATC-3"] };
  const key = reviewKeyOf("idle", stuck);
  const memo: ReviewMemo = { at: NOW - 40 * MIN, trigger: "idle", key };
  const args = { ...base, lastAt: NOW - 40 * MIN, idleSince: NOW - 40 * MIN, history: [memo] };
  assert.equal(decideReview({ ...args, signals: stuck }).run, false, "같은 집합");
  assert.equal(decideReview({ ...args, signals: { ...stuck, waitingFlights: ["ATC-1", "ATC-4"] } }).trigger, "idle", "다른 FLIGHT 집합");
  assert.equal(decideReview({ ...args, signals: { ...stuck, idleAircraft: ["TEAM_A", "TEAM_B"] } }).trigger, "idle", "다른 AIRCRAFT 집합");
  assert.equal(decideReview({ ...args, now: NOW + 210 * MIN, lastAt: NOW - 40 * MIN, idleSince: NOW - 40 * MIN, signals: stuck }).trigger, "idle", "reviewEveryMin(240분)이 지나면 다시");
});

test("decideReview: DUTY ACCOUNT의 FUEL이 HOLD면 서버가 시작하는 턴을 하지 않고, 하루 상한을 넘기지 않는다", () => {
  const due = { ...base, lastAt: NOW - 300 * MIN };
  assert.equal(decideReview({ ...due, fuelHold: true }).why, "fuel");
  const many: ReviewMemo[] = Array.from({ length: REVIEW_DAILY_MAX }, (_, i) => ({ at: NOW - (31 + i) * MIN, trigger: "schedule", key: "" }));
  assert.equal(decideReview({ ...due, lastAt: NOW - 31 * MIN, history: many, signals: { ...calm, leakMin: 500, leakTitle: "x" } }).why, "cap");
  assert.equal(decideReview({ ...due, history: many.slice(1) }).run, true);
});

test("reviewLeaksOf(ATC-401): 제안이 기다리는 BACKLOG leak은 점검 트리거의 leak 신호가 아니다 — 고리를 막는다", () => {
  const since = (agoMin: number) => new Date(NOW - agoMin * MIN).toISOString();
  const open = [
    { kind: "BACKLOG", title: "ATC-9 ← DUTY REVIEW R-0007", since: since(600) }, // 가장 오래된 기다림
    { kind: "LANDING", title: "PR #9 ATC-9", since: since(90) },
    { kind: "UPDATE", title: "abc → def", since: since(10) },
  ];
  const leaks = reviewLeaksOf(open);
  assert.deepEqual(leaks.map((l) => l.title), ["PR #9 ATC-9", "abc → def"]);
  // 신호로는 BACKLOG가 가장 오래 기다려도 LANDING이 가장 오래된 leak이다
  assert.deepEqual([signalsOf(null, leaks, NOW).leakMin, signalsOf(null, leaks, NOW).leakTitle], [90, "PR #9 ATC-9"]);
  // BACKLOG만 기다리면 leak 신호가 없고, 한 주기 결정은 leak 점검을 하지 않는다(정기 간격이 안 지났으면 조용하다)
  const only = signalsOf(null, reviewLeaksOf([open[0]!]), NOW);
  assert.deepEqual([only.leakMin, only.leakTitle], [null, null]);
  const d = decideReview({ now: NOW, lastAt: NOW - 60 * MIN, busy: false, cfg, signals: only, idleSince: null });
  assert.deepEqual([d.run, d.why], [false, "quiet"]);
  assert.ok(REVIEW_LEAK_SKIP_KINDS.has("BACKLOG") && REVIEW_LEAK_SKIP_KINDS.size === 1);
});

// ── empty 트리거(ATC-470) ──
const avail: ReviewSignals = { ...calm, idleAircraft: ["TEAM_A"], waitingFlights: [] };
const emptyArgs = { ...base, lastAt: NOW - 60 * MIN, signals: avail };

test("decideReview empty: 19분은 안 하고 20분은 한다. 시작 시각을 처음 본 때부터 센다", () => {
  const first = decideReview(emptyArgs);
  assert.deepEqual([first.run, first.emptySince], [false, NOW]);
  assert.equal(decideReview({ ...emptyArgs, emptySince: NOW - 19 * MIN }).run, false);
  const hit = decideReview({ ...emptyArgs, emptySince: NOW - 20 * MIN });
  assert.deepEqual([hit.run, hit.trigger, hit.emptySince], [true, "empty", null]);
  assert.match(hit.detail!, /TEAM_A available for 20 min with no Todo FLIGHT waiting/);
});

test("decideReview empty: 기다리는 FLIGHT가 생기면 시계가 멈추고, AIRCRAFT가 없어도 센 시간은 사라진다", () => {
  const waiting = decideReview({ ...emptyArgs, signals: { ...avail, waitingFlights: ["ATC-1"] }, emptySince: NOW - 30 * MIN });
  assert.equal(waiting.emptySince, null);
  assert.notEqual(waiting.trigger, "empty");
  assert.equal(decideReview({ ...emptyArgs, signals: calm, emptySince: NOW - 99 * MIN }).emptySince, null);
  // 간격(gap) 안이라 못 돌아도 센 시간은 이어진다
  assert.equal(decideReview({ ...emptyArgs, lastAt: NOW - 5 * MIN, emptySince: NOW - 50 * MIN }).emptySince, NOW - 50 * MIN);
});

test("decideReview empty: 60분 쿨다운(서명과 관계없이), 지나면 다시 한다", () => {
  const memo = (agoMin: number): ReviewMemo => ({ at: NOW - agoMin * MIN, trigger: "empty", key: "" });
  const args = { ...emptyArgs, emptySince: NOW - 90 * MIN };
  assert.equal(decideReview({ ...args, lastAt: NOW - 59 * MIN, history: [memo(59)] }).trigger === "empty", false);
  assert.equal(decideReview({ ...args, lastAt: NOW - 61 * MIN, history: [memo(61)] }).trigger, "empty");
  // 다른 트리거의 점검은 empty 쿨다운에 걸리지 않는다
  assert.equal(decideReview({ ...args, lastAt: NOW - 40 * MIN, history: [{ at: NOW - 40 * MIN, trigger: "schedule", key: "" }] }).trigger, "empty");
  // 설정 분
  assert.equal(decideReview({ ...args, lastAt: NOW - 61 * MIN, history: [memo(61)], cfg: { ...cfg, reviewEmptyGapMin: 120 } }).trigger === "empty", false);
  assert.equal(decideReview({ ...args, emptySince: NOW - 10 * MIN, cfg: { ...cfg, reviewEmptyMin: 10 } }).trigger, "empty");
});

test("decideReview empty: fuelHold·busy·상한·review:false·gap이 막고, reviewEmpty:false는 이 트리거만 막는다", () => {
  const args = { ...emptyArgs, emptySince: NOW - 30 * MIN };
  assert.equal(decideReview(args).trigger, "empty");
  assert.equal(decideReview({ ...args, fuelHold: true }).why, "fuel");
  assert.equal(decideReview({ ...args, busy: true }).why, "busy");
  assert.equal(decideReview({ ...args, cfg: { ...cfg, review: false } }).why, "off");
  assert.equal(decideReview({ ...args, lastAt: NOW - 10 * MIN }).why, "gap");
  const many: ReviewMemo[] = Array.from({ length: REVIEW_DAILY_MAX }, (_, i) => ({ at: NOW - (61 + i) * MIN, trigger: "schedule", key: "" }));
  assert.equal(decideReview({ ...args, history: many }).why, "cap");
  // 스위치: empty만 멈추고 다른 트리거는 그대로(정기 점검은 돈다, leak도 돈다)
  const off = { ...cfg, reviewEmpty: false };
  assert.notEqual(decideReview({ ...args, cfg: off }).trigger, "empty");
  assert.equal(decideReview({ ...args, cfg: off }).run, false);
  assert.equal(decideReview({ ...args, cfg: off, lastAt: NOW - 300 * MIN }).trigger, "schedule");
  assert.equal(decideReview({ ...args, cfg: off, signals: { ...avail, leakMin: 99, leakTitle: "x" } }).trigger, "leak");
});

test("decideReview: idle과 empty는 같은 상태에서 함께 서지 않는다(기다리는 FLIGHT 유무로 갈린다)", () => {
  for (const waiting of [[], ["ATC-1"]]) {
    const d = decideReview({ ...base, signals: { ...calm, idleAircraft: ["TEAM_A"], waitingFlights: waiting }, idleSince: NOW - 60 * MIN, emptySince: NOW - 60 * MIN });
    assert.equal(d.trigger, waiting.length ? "idle" : "empty");
  }
  // idle은 그대로: 기다리는 FLIGHT가 있어도 emptySince는 쌓이지 않는다
  assert.equal(decideReview({ ...base, signals: { ...calm, idleAircraft: ["TEAM_A"], waitingFlights: ["ATC-1"] } }).emptySince, null);
});

const readyRows = [{ key: "ATC-7", title: "Fire me", priority: 2 }, { key: "ATC-8", title: "Later", priority: null }];
const ideaRows = [{ number: 41, title: "Tiny idea" }];
const emptyPrompt = (over: Partial<Parameters<typeof reviewPromptOf>[0]> = {}) => prompt({ trigger: "empty", detail: "TEAM_A available for 20 min with no Todo FLIGHT waiting", signals: avail, readyBacklog: readyRows, ideas: ideaRows, ...over });

test("지시문 empty: READY → 설계 문서 → idea 순서, READY 목록과 idea 목록, 2·3단계의 합산 상한, 영어", () => {
  const t = emptyPrompt();
  const at = (re: RegExp) => t.search(re);
  assert.ok(at(/STEP 1 — READY Backlog/) > 0 && at(/STEP 1/) < at(/STEP 2 — Design documents/) && at(/STEP 2/) < at(/STEP 3 — Small ideas/));
  assert.match(t, /- ATC-7 P2 Fire me/);
  assert.match(t, /- ATC-8 P- Later/);
  assert.match(t, /You cannot fire them/);
  assert.match(t, /Implementation order tables in \.\.\/docs\/\*\.md/);
  assert.match(t, /- #41 Tiny idea/);
  assert.match(t, new RegExp(`together create at most ${PROPOSALS_MAX} issues`));
  assert.match(t, /Stop at the first step that fills the cap/);
  assert.match(t, /Never set Todo/);
  assert.doesNotMatch(t, /[ㄱ-힝]/);
  // 다른 트리거에는 empty 절이 없다
  assert.doesNotMatch(prompt(), /EMPTY FLEET/);
  // 목록이 비었거나 idea를 읽지 못했을 때
  assert.match(emptyPrompt({ readyBacklog: [] }), /server list below, 0 rows\)[^]*- none/);
  assert.match(emptyPrompt({ ideas: null }), /unavailable[^]*skip step 3/);
  assert.match(emptyPrompt({ linear: false }), /do not create issues in steps 2 and 3/);
});

test("empty 오발 세기: 이름도 안 붙이고 이슈도 안 올린 점검(헛턴), 올린 이슈가 버려진 점검. 결과 줄이 없으면 헛턴으로 세지 않는다", () => {
  const rv = (id: string, trigger: "empty" | "idle" = "empty"): ReviewLine => ({ v: 1, ev: "review", id, at: "2026-10-03T01:00:00Z", trigger, detail: "" });
  const out = (review: string, named: number): ReviewLine => ({ v: 1, ev: "outcome", at: "2026-10-03T01:05:00Z", review, named });
  const pr = (review: string, key: string): ReviewLine => ({ v: 1, ev: "proposal", at: "2026-10-03T01:02:00Z", review, key, title: "t" });
  const lines: ReviewLine[] = [
    rv("R-0001"), out("R-0001", 0), // 헛턴
    rv("R-0002"), out("R-0002", 2), // READY를 짚었다
    rv("R-0003"), pr("R-0003", "ATC-1"), out("R-0003", 0), // 이슈를 올렸다, 버려졌다
    rv("R-0004"), // 결과 줄 없음
    rv("R-0005", "idle"), out("R-0005", 0), // empty가 아니다
  ];
  assert.deepEqual(emptyMisfiresOf(lines, [{ key: "ATC-1", stateType: "canceled" }]), { reviews: 4, wasted: 1, discarded: 1 });
  assert.equal(namedReadyOf("ATC-7 먼저, atc-9도", [{ key: "ATC-7" }, { key: "ATC-9" }, { key: "ATC-70" }]), 2);
  assert.equal(namedReadyOf("ATC-77", [{ key: "ATC-7" }]), 0);
});

test("설정: reviewEmpty는 기본 켜짐, 분은 범위 밖이면 기본(20·60)", () => {
  const c = parseDutyConfig({});
  assert.deepEqual([c.reviewEmpty, c.reviewEmptyMin, c.reviewEmptyGapMin], [true, 20, 60]);
  assert.equal(parseDutyConfig({ reviewEmpty: false }).reviewEmpty, false);
  assert.equal(parseDutyConfig({ reviewEmptyMin: 4, reviewEmptyGapMin: 9999 }).reviewEmptyMin, 20);
  assert.equal(parseDutyConfig({ reviewEmptyMin: 4, reviewEmptyGapMin: 9999 }).reviewEmptyGapMin, 60);
  assert.equal(parseDutyConfig({ reviewEmptyMin: 45, reviewEmptyGapMin: 90 }).reviewEmptyMin, 45);
});

// ── 같은 사실이면 건너뛰기(ATC-566) ──
const factsIn = (over: Partial<Parameters<typeof reviewFactsOf>[0]> = {}) => ({
  signals: { idleAircraft: ["TEAM_P"], waitingFlights: [] as string[] },
  leakIds: ["LANDING|/repo#603"],
  landing: ["PR #603 (VOC-427) CLEARED · landBy supervisor/escalate · holders 1"],
  alerts: [
    { level: "warning", key: "alert|health|CONTROL-BLOCKED|occ-1" },
    { level: "advisory", key: "recycle|TOWER|2026-10-06T10:00:00Z" },
  ],
  effects: ["ATC-1 not improved: leak:PROPOSAL down 7d, 10 → 9"],
  ...over,
});

test("reviewFactsOf: 시간만 바뀐 것(leak 분·알림 글의 분·컨텍스트·EFFECT 전후 수)은 지문을 바꾸지 않는다", () => {
  const a = reviewFactsOf(factsIn());
  // 알림 글과 분은 지문에 들어가지 않는다: key만 본다. EFFECT 줄은 콜론 앞(FLIGHT·평결)만
  const b = reviewFactsOf(factsIn({ effects: ["ATC-1 not improved: leak:PROPOSAL down 7d, 12 → 11"] }));
  assert.equal(a.fp, b.fp);
  assert.deepEqual(a.facts, ["alert:alert|health|CONTROL-BLOCKED|occ-1", "effect:ATC-1 not improved", "idle:TEAM_P", "land:PR #603 (VOC-427) CLEARED · landBy supervisor/escalate · holders 1", "leak:LANDING|/repo#603"]);
  // 순서가 달라도 같다
  assert.equal(reviewFactsOf(factsIn({ alerts: [...factsIn().alerts].reverse() })).fp, a.fp);
  // ADVISORY 알림은 점검이 싣지 않으니 지문에도 없다
  assert.equal(reviewFactsOf(factsIn({ alerts: [factsIn().alerts[0]!, { level: "advisory", key: "following|x" }] })).fp, a.fp);
  assert.match(a.fp, /^[0-9a-f]{16}$/);
});

test("reviewFactsOf: 새 leak·새 알림·막힘·기다리는 FLIGHT·평결이 바뀌면 지문이 바뀐다", () => {
  const a = reviewFactsOf(factsIn()).fp;
  for (const over of [
    { leakIds: ["LANDING|/repo#603", "NEEDS_YOU|TEAM_A"] },
    { alerts: [...factsIn().alerts, { level: "caution", key: "alert|orphan-flight|VOC-297" }] },
    { landing: ["PR #603 (VOC-427) CLEARED · landBy supervisor/escalate · holders 1 · blocks no-checks"] },
    { signals: { idleAircraft: ["TEAM_P"], waitingFlights: ["ATC-9"] } },
    { signals: { idleAircraft: [], waitingFlights: [] } },
    { effects: ["ATC-1 worse: leak:PROPOSAL down 7d, 10 → 12"] },
  ]) assert.notEqual(reviewFactsOf(factsIn(over)).fp, a, JSON.stringify(over));
});

test("heartbeatDue: 마지막으로 돈 점검이 오늘 00:00Z 전이면 하루 한 번이 왔다", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.equal(heartbeatBoundary(at("2026-10-07T13:00:00Z")), at("2026-10-07T00:00:00Z"));
  assert.equal(heartbeatDue(at("2026-10-06T23:59:00Z"), at("2026-10-07T00:01:00Z")), true);
  assert.equal(heartbeatDue(at("2026-10-07T00:00:30Z"), at("2026-10-07T23:59:00Z")), false);
  assert.equal(heartbeatBoundary(at("2026-10-07T05:00:00Z"), 10), at("2026-10-06T10:00:00Z"));
});

const runLine = (id: string, minAgo: number, fp?: string, facts?: string[]): ReviewLine => ({ v: 1, ev: "review", id, at: new Date(NOW - minAgo * MIN).toISOString(), trigger: "leak", detail: "", ...(fp ? { fp } : {}), ...(facts ? { facts } : {}) });

test("skipVerdictOf: 같은 지문이고 지난 점검이 아무것도 내지 않았을 때만 건너뛴다", () => {
  const lines = [runLine("R-0001", 60, "abc")];
  const last = lastRunOf(lines)!;
  assert.deepEqual([last.id, last.fp, last.filed], ["R-0001", "abc", 0]);
  assert.equal(skipVerdictOf({ on: true, fp: "abc", last, now: NOW }).skip, true);
  assert.equal(skipVerdictOf({ on: false, fp: "abc", last, now: NOW }).why, "off");
  assert.equal(skipVerdictOf({ on: true, fp: "xyz", last, now: NOW }).why, "changed");
  assert.equal(skipVerdictOf({ on: true, fp: "abc", last: null, now: NOW }).why, "first");
  assert.equal(skipVerdictOf({ on: true, fp: "abc", last: lastRunOf([runLine("R-0001", 60)]), now: NOW }).why, "no-fp", "ATC-566 전의 점검 줄에는 지문이 없다: 건너뛰지 않는다");
  // 제안·댓글·고침 하나라도 냈으면 돈다
  for (const out of [
    { v: 1, ev: "proposal", at: new Date(NOW - 50 * MIN).toISOString(), review: "R-0001", key: "ATC-9", title: "x" },
    { v: 1, ev: "write", at: new Date(NOW - 50 * MIN).toISOString(), review: "R-0001", key: "ATC-9", action: "comment" },
    { v: 1, ev: "write", at: new Date(NOW - 50 * MIN).toISOString(), review: "R-0001", key: "ATC-9", action: "update" },
  ] as ReviewLine[]) assert.equal(skipVerdictOf({ on: true, fp: "abc", last: lastRunOf([...lines, out]), now: NOW }).why, "filed");
  // 하루 한 번: 마지막으로 돈 점검이 00:00Z 전이면 사실이 같아도 돈다
  const yesterday = lastRunOf([{ ...runLine("R-0001", 0, "abc"), at: "2026-10-01T22:00:00Z" }]);
  assert.equal(skipVerdictOf({ on: true, fp: "abc", last: yesterday, now: NOW }).why, "heartbeat");
});

test("pendingSkipOf·reviewMemosOf: 돈 점검 뒤의 skip이 밀린 점검이고, 건너뛴 점검은 하루 상한에 들지 않는다", () => {
  const skip: ReviewLine = { v: 1, ev: "skip", at: new Date(NOW - 10 * MIN).toISOString(), trigger: "schedule", detail: "d", same: "R-0001", fp: "abc", facts: [], why: "w" };
  assert.equal(pendingSkipOf([runLine("R-0001", 60, "abc"), skip])?.at, skip.at);
  assert.equal(pendingSkipOf([skip, runLine("R-0002", 5, "abc")]), null);
  const memos = reviewMemosOf([runLine("R-0001", 60, "abc"), skip]);
  assert.deepEqual(memos.map((m) => m.skipped ?? false), [false, true]);
  // 건너뛴 점검 12개가 있어도 상한(cap)이 막지 않는다
  const many: ReviewMemo[] = Array.from({ length: REVIEW_DAILY_MAX }, (_, i) => ({ at: NOW - (40 + i) * MIN, trigger: "schedule" as const, key: "", skipped: true }));
  assert.notEqual(decideReview({ ...base, lastAt: NOW - 300 * MIN, history: many }).why, "cap");
});

test("skipCountsOf: 건너뛴 점검 수와 오발 — 2시간 안 다음 점검이 새 사실 없이, 또는 건너뛴 사실의 키로 이슈를 냈다", () => {
  const facts = ["idle:TEAM_P", "land:PR #603 (VOC-427) CLEARED · landBy supervisor/escalate · holders 1"];
  const skip = (minAgo: number): ReviewLine => ({ v: 1, ev: "skip", at: new Date(NOW - minAgo * MIN).toISOString(), trigger: "empty", detail: "", same: "R-0001", fp: "aaa", facts, why: "same" });
  const prop = (review: string, title: string): ReviewLine => ({ v: 1, ev: "proposal", at: new Date(NOW).toISOString(), review, key: "ATC-99", title });
  // 1) 같은 지문(하루 한 번 점검)이 제안했다 → 오발
  let c = skipCountsOf([runLine("R-0001", 300, "aaa", facts), skip(100), runLine("R-0002", 0, "aaa", facts), prop("R-0002", "Restart TOWER")]);
  assert.deepEqual([c.skipped, c.misfires, c.misfireOf], [1, 1, ["R-0002"]]);
  // 2) 사실이 바뀌었고(새 알림) 제안 제목이 새 사실만 부른다 → 오발 아님
  const newer = [...facts, "alert:alert|orphan-flight|VOC-297"];
  c = skipCountsOf([skip(100), runLine("R-0002", 0, "bbb", newer), prop("R-0002", "Reclaim VOC-297 STAND")]);
  assert.equal(c.misfires, 0);
  // 3) 사실이 바뀌었어도 제안 제목이 건너뛴 사실의 키(VOC-427)를 부른다 → 오발
  c = skipCountsOf([skip(100), runLine("R-0002", 0, "bbb", newer), prop("R-0002", "Land VOC-427 without the holder")]);
  assert.equal(c.misfires, 1);
  // 4) 사실이 줄기만 했다(새 것 없음) → 오발
  c = skipCountsOf([skip(100), runLine("R-0002", 0, "ccc", ["idle:TEAM_P"]), prop("R-0002", "Something")]);
  assert.equal(c.misfires, 1);
  // 5) 2시간 넘어서 나온 제안, 제안 없는 다음 점검 → 오발 아님
  assert.equal(skipCountsOf([skip(121), runLine("R-0002", 0, "aaa", facts), prop("R-0002", "x")]).misfires, 0);
  assert.equal(skipCountsOf([skip(100), runLine("R-0002", 0, "aaa", facts)]).misfires, 0);
  assert.equal(skipCountsOf([skip(100)]).skipped, 1);
});

test("설정: reviewSkip은 기본 켜짐, false면 꺼짐", () => {
  assert.equal(parseDutyConfig({}).reviewSkip, true);
  assert.equal(parseDutyConfig({ reviewSkip: false }).reviewSkip, false);
});
