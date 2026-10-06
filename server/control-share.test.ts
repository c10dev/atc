import assert from "node:assert/strict";
import { test } from "node:test";
import { controlDataOf, type DayRow, controlValueOf, dayRows, isControlName, perWorking, sharePct, summarize, workingTurnStarts } from "./control-share.ts";
import { judge, measureOf } from "./effect-check.ts";

const T = (s: string) => Date.parse(`2026-10-0${s}Z`);

test("workingTurnStarts: 도구 호출 3번 이상인 turn만, 끝은 다음 turn 시작", () => {
  const turns = [100, 200, 300];
  const uses = [110, 120, 130, 210, 220, 310, 320, 330, 340];
  assert.deepEqual(workingTurnStarts(turns, uses), [100, 300]);
  assert.deepEqual(workingTurnStarts([], uses), []);
  assert.deepEqual(workingTurnStarts([100], [100, 100, 100]), []); // turn 시작과 같은 시각은 앞 turn의 것
  assert.deepEqual(workingTurnStarts([200, 100], [110, 120, 130]), [100]); // 순서가 섞여도
});

test("dayRows: 토큰은 세션의 역할로, turn은 시작한 날에", () => {
  const sessions = [
    { session: "s1", role: "tower", turns: [T("5T10:00:00"), T("5T11:00:00")], uses: [T("5T10:01:00"), T("5T10:02:00"), T("5T10:03:00"), T("5T11:01:00")] },
    { session: "s2", role: "occ", turns: [T("6T01:00:00")], uses: [] },
  ];
  const tokens = [
    { session: "s1", t: "2026-10-05T10:05:00.000Z", tokens: 600 },
    { session: "s2", t: "2026-10-06T01:05:00.000Z", tokens: 100 },
    { session: "other", t: "2026-10-05T12:00:00.000Z", tokens: 300 },
    { session: "other", t: "2026-10-04T12:00:00.000Z", tokens: 999 }, // 창 밖
  ];
  const rows = dayRows(tokens, sessions, T("5T00:00:00"), T("7T00:00:00"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { day: "2026-10-05", all: 900, roles: { tower: { tokens: 600, turns: 2, working: 1 } } });
  assert.deepEqual(rows[1], { day: "2026-10-06", all: 100, roles: { occ: { tokens: 100, turns: 1, working: 0 } } });
});

test("몫과 turn당 토큰: 나눌 수 없으면 null", () => {
  assert.equal(sharePct(1, 3), 33.3);
  assert.equal(sharePct(0, 0), null);
  assert.equal(perWorking(1000, 3), 333);
  assert.equal(perWorking(1000, 0), null);
});

const rows: DayRow[] = [
  { day: "2026-10-01", all: 1000, roles: { tower: { tokens: 400, turns: 10, working: 2 }, occ: { tokens: 100, turns: 5, working: 0 } } },
  { day: "2026-10-02", all: 1000, roles: { tower: { tokens: 200, turns: 10, working: 1 } } },
];
test("summarize: 전체와 역할별", () => {
  assert.deepEqual(summarize(rows), { all: 2000, tokens: 700, turns: 25, working: 3, share: 35, perWorking: 233 });
  assert.equal(summarize(rows, "tower").share, 30);
  assert.equal(summarize(rows, "tower").perWorking, 200);
  assert.equal(summarize(rows, "occ").perWorking, null);
});

test("Measure 이름과 값: share는 %, tokens-per-turn은 천 토큰", () => {
  assert.ok(isControlName("share") && isControlName("Tokens-Per-Turn-MCC") && !isControlName("share-duty") && !isControlName(""));
  const d = { control: controlDataOf(rows) };
  const from = Date.parse("2026-10-01T00:00:00Z");
  const to = Date.parse("2026-10-03T00:00:00Z");
  assert.deepEqual(controlValueOf("share", d, from, to), { value: 35, n: 2 });
  assert.deepEqual(controlValueOf("share-tower", d, from, to), { value: 30, n: 2 });
  assert.deepEqual(controlValueOf("tokens-per-turn", d, from, to), { value: 0.2, n: 3 });
  assert.deepEqual(controlValueOf("share", d, from, from + 86_400_000), { value: 50, n: 1 });
  assert.deepEqual(controlValueOf("share", {}, from, to), { value: null, n: 0 });
  assert.deepEqual(controlValueOf("nope", d, from, to), { value: null, n: 0 });
});

test("## Measure에 control:<이름>을 쓸 수 있고, 모르는 이름은 거절한다", () => {
  const ok = measureOf("## Measure\n\n* metric: control:share-tower\n* direction: down\n* window: 7d\n");
  assert.equal(ok.kind, "measure");
  assert.equal(ok.kind === "measure" && ok.measure.name, "share-tower");
  const bad = measureOf("## Measure\n\n* metric: control:share-duty\n* direction: down\n* window: 7d\n");
  assert.equal(bad.kind, "invalid");
});

test("EFFECT CHECK: 몫이 내려가면 improved, 표본이 모자라면 too little data", () => {
  const day = (d: number, share: number) => ({ day: new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10), all: 1000, roles: { tower: { tokens: share * 10, turns: 1, working: 1 } } });
  const rs = [1, 2, 3, 4, 5, 6].map((d) => day(d, d <= 3 ? 50 : 20));
  const m = { source: "control", name: "share", direction: "down", windowDays: 3 } as const;
  const base = { leaks: [], misfires: [], alerts: [], clearances: [], coverageFrom: { leak: null, "leak-minutes": null, misfire: null, alert: null, clearance: null } };
  const at = Date.parse("2026-10-04T00:00:00Z");
  const j = judge(m, at, { ...base, control: controlDataOf(rs) });
  assert.equal(j.verdict, "improved");
  assert.deepEqual([j.before, j.after], [50, 20]);
  const few = judge(m, at, { ...base, control: controlDataOf(rs.slice(0, 5)) });
  assert.equal(few.verdict, "too little data"); // 뒤 창에 이틀뿐
  assert.equal(judge(m, at, base).verdict, "too little data"); // 기록 없음
});
