import assert from "node:assert/strict";
import { test } from "node:test";
import { type PriceTable, parsePriceTable } from "./fuel-cost.ts";
import type { FuelRecord } from "./fuel.ts";
import { changeOf, changeText, coverageOf, leverageOf, leverageText, localDayStart, noCompareText, previousLabel, trendScanDays, tzName, tzOffsetOf, usageTrend } from "./fuel-trend.ts";

// ATC-389: USAGE TREND. 합성 기록만 쓴다(~/.claude를 읽지 않는다)
const TABLE = parsePriceTable({
  writeMult: { "5m": 1.25, "1h": 2 },
  multipliers: {},
  models: { "m-opus": { in: 4, out: 20, readMult: 0.05 } },
}) as PriceTable;
const M = 1_000_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (d: number, min = 0) => new Date(NOW - d * DAY + min * 60_000).toISOString();
let n = 0;
const rec = (o: Partial<FuelRecord>): FuelRecord => ({
  key: `k${n++}`, session: "s1", sidechain: false, agent: null, t: ago(1), model: "m-opus",
  input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, stopReason: "end_turn", version: null, effort: null, speed: "standard", geo: null, ...o,
});
const NAMES = new Map([["s1", "TEAM_A"], ["s2", "Team B"], ["s3", "TOWER"], ["s4", "team_a"]]);
const run = (records: FuelRecord[], arrivals: { arrivedAt: string; pr?: unknown }[] = [], days = 7, weeks = 2) =>
  usageTrend({ records, names: NAMES, teamPattern: "^TEAM[\\s_-]?[A-Z]{1,2}$", prices: TABLE, arrivals, now: NOW, days, weeks });

test("trendScanDays: 지난 기간과 주 추세를 다 덮는 길이", () => {
  assert.equal(trendScanDays(7), 56);
  assert.equal(trendScanDays(30), 60);
  assert.equal(trendScanDays(1, 2), 14);
});

test("usageTrend: 이번·지난 기간을 나눠 비용(같은 가격표)·요청을 센다", () => {
  const t = run([
    rec({ t: ago(1), input: M }), // 이번 $4
    rec({ t: ago(1), sidechain: true, agent: "a1", output: M }), // 이번 CREW $20
    rec({ t: ago(8), input: 2 * M }), // 지난 $8
    rec({ t: ago(20), input: M }), // 둘 다 아님(첫 기록)
  ]);
  assert.deepEqual([t.current.cost, t.current.captainCost, t.current.crewCost, t.current.requests], [24, 4, 20, 2]);
  assert.deepEqual([t.previous.cost, t.previous.requests], [8, 1]);
  assert.equal(t.historyStart, ago(20));
});

test("usageTrend: 기간 경계는 [from, to). now − days 그 시각은 이번 기간", () => {
  const t = run([rec({ t: ago(7), input: M }), rec({ t: ago(30), input: M })]);
  assert.equal(t.current.requests, 1);
  assert.equal(t.previous.requests, 0);
});

test("usageTrend: 가격이 없는 모델은 비용에서 빼고 unpriced로 센다", () => {
  const t = run([rec({ model: "deepseek-x", input: M }), rec({ input: M }), rec({ t: ago(30) })]);
  assert.deepEqual([t.current.cost, t.current.requests, t.current.unpricedRequests], [4, 2, 1]);
});

test("usageTrend: 가동 시간은 5분 칸. 한 칸 안 요청 여럿은 5분, CREW는 서브에이전트마다", () => {
  const t = run([
    rec({ t: ago(1, 0) }),
    rec({ t: ago(1, 1) }), // 같은 칸
    rec({ t: ago(1, 7) }), // 다음 칸
    rec({ t: ago(1, 0), sidechain: true, agent: "a1" }),
    rec({ t: ago(1, 0), sidechain: true, agent: "a2" }), // 다른 서브에이전트, 같은 시각
    rec({ t: ago(30) }),
  ]);
  assert.equal(t.current.captainHours, Math.round((10 / 60) * 100) / 100);
  assert.equal(t.current.crewHours, Math.round((10 / 60) * 100) / 100);
});

test("usageTrend: AIRCRAFT는 팀 REGISTRATION만, 이름 꼴이 달라도 한 대", () => {
  const t = run([rec({ session: "s1" }), rec({ session: "s4" }), rec({ session: "s2" }), rec({ session: "s3" }), rec({ session: "s9" }), rec({ t: ago(30) })]);
  assert.equal(t.current.aircraft, 2); // TEAM_A(s1·s4), TEAM_B. TOWER·이름 모름은 빼고
});

test("usageTrend: LOGBOOK ARRIVED는 FLIGHT, PR이 있으면 PR. FLIGHT당 비용", () => {
  const t = run([rec({ input: M }), rec({ t: ago(30) })], [{ arrivedAt: ago(1), pr: { number: 1 } }, { arrivedAt: ago(2) }, { arrivedAt: ago(9), pr: {} }]);
  assert.deepEqual([t.current.flights, t.current.prs, t.current.costPerFlight], [2, 1, 2]);
  assert.deepEqual([t.previous.flights, t.previous.prs, t.previous.costPerFlight], [1, 1, 0]);
  assert.equal(run([rec({ t: ago(30) })]).current.costPerFlight, null);
});

test("usageTrend: 주는 오래된 것부터, 마지막이 이번 주. 기록 앞의 주는 coverage 0", () => {
  const t = run([rec({ t: ago(10), input: M }), rec({ t: ago(2), input: M }), rec({ t: ago(3) })], [], 7, 3);
  assert.equal(t.weeks.length, 3);
  assert.deepEqual(t.weeks.map((w) => w.requests), [0, 1, 2]);
  assert.equal(t.weeks[2].to, new Date(NOW).toISOString());
  assert.deepEqual(t.weeks.map((w) => w.coverage), [0, 0.4286, 1]); // 둘째 주: 14일 전~7일 전 중 10일 전부터 3/7
  assert.equal(t.previous.coverage, 0.4286);
  assert.equal(t.current.coverage, 1);
});

test("coverageOf: 기록이 없으면 0, 기간 앞이면 1, 중간이면 그 몫", () => {
  assert.equal(coverageOf(0, 100, null), 0);
  assert.equal(coverageOf(0, 100, 0), 1);
  assert.equal(coverageOf(0, 100, 25), 0.75);
  assert.equal(coverageOf(0, 100, 100), 0);
});

test("changeOf: 지난 기간이 다 덮였고 0이 아닐 때만 비율", () => {
  assert.equal(changeOf(150, 100, 1), 0.5);
  assert.equal(changeOf(50, 100, 1), -0.5);
  assert.equal(changeOf(150, 100, 0.9), null);
  assert.equal(changeOf(150, 0, 1), null);
  assert.equal(changeOf(null, 100, 1), null);
});

test("usageTrend: change는 지난 기간이 다 덮일 때만, 가동 시간은 CAPTAIN+CREW", () => {
  const t = run([
    rec({ t: ago(1), input: 2 * M }),
    rec({ t: ago(1), sidechain: true, agent: "a1" }),
    rec({ t: ago(8), input: M }),
    rec({ t: ago(30) }),
  ], [{ arrivedAt: ago(1) }]);
  assert.equal(t.change.cost, 1); // $8 대 $4
  assert.equal(t.change.requests, 1);
  assert.equal(t.change.hours, 1); // 10분 대 5분
  assert.equal(t.change.flights, null); // 지난 기간 0
  const short = run([rec({ t: ago(1), input: M }), rec({ t: ago(10), input: M })]);
  assert.equal(short.change.cost, null);
});

test("changeText·noCompareText", () => {
  assert.equal(changeText(0.123), "+12%");
  assert.equal(changeText(-0.08), "−8%");
  assert.equal(changeText(0.001), "0%");
  assert.equal(changeText(null), null);
  assert.equal(noCompareText({ coverage: 0 }, 7), "지난 기간 기록 없음");
  assert.equal(noCompareText({ coverage: 0.4286 }, 7), "지난 기간 기록 3/7일뿐");
  assert.equal(noCompareText({ coverage: 1 }, 7), "지난 기간 0");
  assert.equal(previousLabel({ coverage: 1 }, 7), "지난 7일");
  assert.equal(previousLabel({ coverage: 0.1583 }, 7), "지난 7일 중 1.1일");
  assert.equal(previousLabel({ coverage: 0 }, 14), "지난 14일");
});

// NOW는 2026-10-02T12:00Z = KST 21:00. KST 오늘 0시는 2026-10-01T15:00Z
test("localDayStart: 시간대의 오늘 0시. UTC면 그날 00:00Z, KST(−540)면 전날 15:00Z", () => {
  assert.equal(new Date(localDayStart(NOW, 0)).toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal(new Date(localDayStart(NOW, -540)).toISOString(), "2026-10-01T15:00:00.000Z");
  assert.equal(new Date(localDayStart(Date.parse("2026-10-02T15:30:00Z"), -540)).toISOString(), "2026-10-02T15:00:00.000Z"); // KST 00:30
  assert.equal(new Date(localDayStart(NOW, 300)).toISOString(), "2026-10-02T05:00:00.000Z"); // UTC−5
});

test("tzOffsetOf·tzName: 정수 분 −840…840만, 아니면 0", () => {
  assert.deepEqual(["-540", "330", "abc", "900", "1.5", undefined].map(tzOffsetOf), [-540, 330, 0, 0, 0, 0]);
  assert.deepEqual([-540, 0, 330, -345].map(tzName), ["UTC+9", "UTC", "UTC−5:30", "UTC+5:45"]);
});

test("usageTrend.today: 오늘 0시부터 지금까지 대 어제 0시부터 어제 이 시각까지", () => {
  const kst = (iso: string) => new Date(Date.parse(`${iso}Z`) - 9 * 3_600_000).toISOString(); // KST 벽시계 → Z
  const t = usageTrend({
    records: [
      rec({ t: kst("2026-10-02T08:00:00"), input: 2 * M }), // 오늘 $8
      rec({ t: kst("2026-10-01T08:00:00"), input: M }), // 어제 같은 시각 전 $4
      rec({ t: kst("2026-10-01T22:00:00"), input: 10 * M }), // 어제 이 시각(21:00) 뒤: 견주지 않는다
      rec({ t: kst("2026-10-01T23:59:00") }), // 어제 이 시각 뒤
      rec({ t: ago(20) }),
    ],
    names: NAMES, teamPattern: "^TEAM[\\s_-]?[A-Z]{1,2}$", prices: TABLE, arrivals: [{ arrivedAt: kst("2026-10-02T10:00:00") }], now: NOW, days: 7, weeks: 2, tzOffsetMin: -540,
  });
  assert.equal(t.today.tzOffsetMin, -540);
  assert.equal(t.today.current.from, "2026-10-01T15:00:00.000Z");
  assert.equal(t.today.previous.to, "2026-10-01T12:00:00.000Z");
  assert.deepEqual([t.today.current.cost, t.today.previous.cost, t.today.change.cost], [8, 4, 1]);
  assert.equal(t.today.current.flights, 1);
  assert.equal(t.today.change.flights, null); // 어제 0건
});

test("usageTrend.today: 기본은 UTC 하루", () => {
  const t = run([rec({ t: ago(20) })]);
  assert.equal(t.today.tzOffsetMin, 0);
  assert.equal(t.today.current.from, "2026-10-02T00:00:00.000Z");
});

test("leverageOf: 가동 시간 ÷ 흐른 시간. 기록 전 시간은 분모에서 뺀다", () => {
  const H = 3_600_000;
  assert.equal(leverageOf(12 * 24, 0, 24 * H, 0), 1); // 5분 칸 288개 = 24시간 ÷ 24시간
  assert.equal(leverageOf(12 * 48, 0, 24 * H, 12 * H), 4); // 48시간 ÷ 기록이 있는 12시간
  assert.equal(leverageOf(10, 0, 24 * H, null), null);
  assert.equal(leverageOf(10, 0, 24 * H, 24 * H), null);
  assert.equal(leverageOf(0, 0, 24 * H, 0), 0);
});

test("usageTrend: leverage는 기간마다, 변화도 change.leverage로", () => {
  // 서브에이전트마다 따로 센다: 같은 5분에 240개 = 20시간, 120개 = 10시간
  const crew = (n: number, d: number) => Array.from({ length: n }, (_, i) => rec({ t: ago(d), sidechain: true, agent: `a${d}-${i}` }));
  const t = run([...crew(240, 1), ...crew(120, 8), rec({ t: ago(30) })]);
  assert.equal(t.current.leverage, 0.12); // 20h ÷ 168h
  assert.equal(t.previous.leverage, 0.06);
  assert.equal(t.change.leverage, 1);
  assert.equal(t.weeks.length, 2);
  assert.equal(t.weeks[1].leverage, 0.12);
  assert.equal(t.current.elapsedHours, 168);
  assert.equal(t.weeks[0].elapsedHours, 168); // 30일 전 기록이 있어 앞 주도 다 덮인다

});

test("leverageText: 한 자리 소수, 10 넘으면 정수", () => {
  assert.deepEqual([4.69, 0, 12.4, 1234.5, null].map(leverageText), ["×4.7", "×0.0", "×12", "×1,235", "—"]);
});
