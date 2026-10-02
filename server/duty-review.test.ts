import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDutyConfig } from "./duty-config.ts";
import { decideReview, nextReviewId, openSimilarKey, PROPOSALS_MAX, REVIEW_DAILY_MAX, reviewDaysOf, reviewKeyOf, reviewPromptOf, type ReviewConfig, type ReviewLine, type ReviewMemo, type ReviewSignals, signalsOf } from "./duty-review.ts";
import type { Ticket } from "./model.ts";
import { NOT_RELEASED_WHY } from "./release.ts";

const MIN = 60_000;
const NOW = Date.parse("2026-10-02T12:00:00Z");
const cfg: ReviewConfig = { review: true, reviewEveryMin: 240, reviewIdleMin: 20, reviewLeakMin: 60, reviewGapMin: 30 };
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
