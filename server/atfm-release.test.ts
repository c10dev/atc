import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AtfmConfig,
  ciTrendOf,
  DEFAULT_ATFM,
  delayedAirports,
  enforcedStops,
  type GroundStop,
  groundStopsOf,
  holdStops,
  losDayOf,
  passedSince,
  reviveStops,
  stopKey,
} from "./atfm.ts";
import type { GhPull } from "./landing.ts";

// ATC-62: 실패 몰림·혼잡·LOS 출발 중지의 두 번째 트리거, 해제 규칙, on 스위치(docs/atfm.md 6장)

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const MIN = 60_000;
const at = (min: number) => new Date(NOW + min * MIN).toISOString();
const VCDO = "/p/vocado_nextjs";
const airports = [{ code: "VCDO", repo: VCDO }];
const cfgOf = (g: Partial<AtfmConfig["groundStop"]>): AtfmConfig => ({ ...DEFAULT_ATFM, groundStop: { ...DEFAULT_ATFM.groundStop, ...g } });
const ON = cfgOf({ failureWave: "on", congestion: "on", los: "on" });
const check = (name: string, conclusion: string, completedMin: number) => ({ name, status: "COMPLETED", conclusion, startedAt: at(completedMin - 5), completedAt: at(completedMin) });
const gh = (number: number, rollup: GhPull["statusCheckRollup"]): GhPull => ({
  number, title: `PR ${number}`, url: "u", headRefName: "b", headRefOid: `h${number}`, baseRefName: "main", isDraft: false, mergeStateStatus: "CLEAN",
  reviewDecision: null, createdAt: at(-100), author: null, statusCheckRollup: rollup, reviews: [],
});
const input = (over: Partial<Parameters<typeof groundStopsOf>[0]> = {}) => ({
  airports, mains: new Map(), pulls: new Map<string, GhPull[]>(), losOpen: new Map<string, number>(), cfg: ON, now: NOW, ...over,
});
// 스냅샷 한 번: 트리거를 찾고 지난 것과 이어 붙인다
const tick = (prev: GroundStop[], over: Partial<Parameters<typeof groundStopsOf>[0]>, now: number) => {
  const inp = input({ ...over, now });
  return holdStops(prev, groundStopsOf(inp), { pulls: inp.pulls, cfg: inp.cfg, now });
};
const wavePulls = (n: number) => new Map([[VCDO, Array.from({ length: n }, (_, i) => gh(10 + i, [check("build", "FAILURE", -10)]))]]);

test("실패 몰림(on): 새 ASSIGN과 LAND를 막고, 체크 이름으로 잇는다(PR이 늘어도 같은 출발 중지)", () => {
  const [s] = groundStopsOf(input({ pulls: wavePulls(3) }));
  assert.deepEqual([s.trigger, s.kind, s.land, s.enforced, s.check], ["failure-wave", "stop", true, true, "build"]);
  const [more] = groundStopsOf(input({ pulls: wavePulls(4) }));
  assert.equal(stopKey(more), stopKey(s));
  assert.equal(enforcedStops([{ ...s, since: at(0) }], "land").get("VCDO")?.trigger, "failure-wave");
  assert.equal(groundStopsOf(input({ pulls: wavePulls(3), cfg: cfgOf({ failureWave: "shadow" }) }))[0].enforced, false);
});

test("실패 몰림 해제: 출발 중지 뒤 그 체크가 PR 2개에서 통과해야 풀리고, PR 1개로는 붙든다", () => {
  let held = tick([], { pulls: wavePulls(3) }, NOW);
  const since = held[0].since;
  // 1시간이 지나 트리거(1시간 안 실패 3개)는 풀렸지만 통과한 PR은 1개
  const onePass = new Map([[VCDO, [gh(10, [check("build", "SUCCESS", 70)]), gh(11, [check("build", "FAILURE", -10)]), gh(12, [check("lint", "SUCCESS", 70)])]]]);
  held = tick(held, { pulls: onePass }, NOW + 80 * MIN);
  assert.equal(held.length, 1);
  assert.deepEqual([held[0].since, held[0].enforced, held[0].releasing], [since, true, "build 통과 PR 1/2 (#10)"]);
  // 출발 중지 전에 통과한 것은 세지 않는다
  assert.deepEqual(passedSince([gh(20, [check("build", "SUCCESS", -30)])], "build", Date.parse(since)), []);
  const twoPass = new Map([[VCDO, [gh(10, [check("build", "SUCCESS", 70)]), gh(11, [check("build", "SUCCESS", 85)])]]]);
  assert.deepEqual(tick(held, { pulls: twoPass }, NOW + 90 * MIN), []);
});

test("혼잡 두 번째 트리거: 최근 2시간 체크 중앙값이 그 앞 7일 중앙값의 2배를 넘으면 GROUND DELAY", () => {
  const base = Array.from({ length: 10 }, (_, i) => ({ t: at(-600 - i * 60), minutes: 10 }));
  const slowNow = [25, 30, 21].map((m, i) => ({ t: at(-10 - i * 10), minutes: m }));
  const trend = ciTrendOf([...base, ...slowNow], NOW)!;
  assert.deepEqual(trend, { recentMin: 25, baselineMin: 10, recentN: 3, baselineN: 10 });
  const [s] = groundStopsOf(input({ ciTrend: new Map([[VCDO, trend]]) }));
  assert.deepEqual([s.trigger, s.kind, s.land, s.enforced], ["congestion", "delay", false, true]);
  assert.equal(s.text, "CI 혼잡: 최근 2시간 체크 중앙값 25분, 7일 기준 10분의 2배 넘음");
  assert.deepEqual(groundStopsOf(input({ ciTrend: new Map([[VCDO, { ...trend, recentMin: 20 }]]) })), []); // 정확히 2배는 아니다
  assert.equal(ciTrendOf([...base, ...slowNow.slice(0, 2)], NOW), null); // 최근 표본 3개 미만
  assert.equal(ciTrendOf([...base.slice(0, 9), ...slowNow], NOW), null); // 기준 표본 10개 미만
  assert.deepEqual([...delayedAirports([{ ...s, since: at(0) }])], ["VCDO"]);
  assert.equal(enforcedStops([{ ...s, since: at(0) }]).size, 0); // GROUND DELAY는 ASSIGN·LAND를 막지 않는다
});

test("혼잡 해제: 30분 이어서 기준 아래여야 풀리고, 그 사이 다시 걸리면(깜빡임) 같은 출발 중지로 30분을 다시 센다", () => {
  const stuck = new Map([[VCDO, Array.from({ length: 5 }, (_, i) => gh(30 + i, [{ name: "e2e", status: "IN_PROGRESS", startedAt: at(-40) }]))]]);
  const calm = new Map<string, GhPull[]>();
  let held = tick([], { pulls: stuck }, NOW);
  const since = held[0].since;
  held = tick(held, { pulls: calm }, NOW + 10 * MIN);
  assert.deepEqual([held[0].clearSince, held[0].releasing], [at(10), "기준 아래 0분 / 30분"]);
  held = tick(held, { pulls: new Map([[VCDO, stuck.get(VCDO)!.map((p) => ({ ...p, statusCheckRollup: [{ name: "e2e", status: "IN_PROGRESS", startedAt: at(-15) }] }))]]) }, NOW + 25 * MIN);
  assert.deepEqual([held.length, held[0].since, held[0].clearSince], [1, since, null]); // 다시 걸림: 이어 간다
  held = tick(held, { pulls: calm }, NOW + 30 * MIN);
  held = tick(held, { pulls: calm }, NOW + 59 * MIN);
  assert.deepEqual([held.length, held[0].since, held[0].releasing], [1, since, "기준 아래 29분 / 30분"]);
  assert.deepEqual(tick(held, { pulls: calm }, NOW + 60 * MIN), []);
});

test("LOS 두 번째 트리거: 24시간 안 LOS 3건이면 걸리고, 켜지면 새 ASSIGN만 막는다(LAND는 막지 않는다)", () => {
  const stands = new Map([["/w/voc-1", VCDO], ["/w/voc-2", VCDO]]);
  const events = [
    { at: at(-60), workspacePath: "/w/voc-1" },
    { at: at(-600), workspacePath: "/w/voc-2" },
    { at: at(-1000), workspacePath: "/w/voc-1" },
    { at: at(-1500), workspacePath: "/w/voc-1" }, // 24시간 밖
    { at: at(-30), workspacePath: "/w/unknown" }, // 저장소를 모름
  ];
  const day = losDayOf(events, (s) => stands.get(s) ?? null, NOW);
  assert.deepEqual([...day], [[VCDO, 3]]);
  const [s] = groundStopsOf(input({ losDay: day }));
  assert.deepEqual([s.trigger, s.kind, s.land, s.enforced, s.text], ["los", "stop", false, true, "LOS 증가: 24시간 안 LOS 3건"]);
  const stop = [{ ...s, since: at(0) }];
  assert.equal(enforcedStops(stop).get("VCDO")?.trigger, "los");
  assert.equal(enforcedStops(stop, "land").size, 0);
  assert.deepEqual(groundStopsOf(input({ losDay: new Map([[VCDO, 2]]) })), []);
  assert.equal(groundStopsOf(input({ losOpen: new Map([[VCDO, 2]]) }))[0].text, "LOS 증가: 열린 LOS 2건");
});

test("LOS 해제: 30분 기준 아래여야 풀린다", () => {
  let held = tick([], { losOpen: new Map([[VCDO, 2]]) }, NOW);
  held = tick(held, {}, NOW + 1 * MIN);
  held = tick(held, {}, NOW + 30 * MIN);
  assert.deepEqual([held.length, held[0].releasing], [1, "기준 아래 29분 / 30분"]);
  assert.deepEqual(tick(held, {}, NOW + 31 * MIN), []);
});

test("main 깨짐·수동은 트리거가 풀리면 바로 풀리고, 스위치를 끄면 붙들던 것도 풀린다, 켜짐은 지금 스위치로 다시 정한다", () => {
  const broken = new Map([[VCDO, { repo: VCDO, slug: "o/v", branch: "main", sha: "abc1234", state: "failure" as const, failing: ["build"], checks: 1, at: at(0) }]]);
  let held = tick([], { mains: broken, losOpen: new Map([[VCDO, 2]]) }, NOW);
  assert.deepEqual(held.map((s) => s.trigger).sort(), ["los", "main-broken"]);
  held = tick(held, {}, NOW + MIN);
  assert.deepEqual(held.map((s) => s.trigger), ["los"]); // main 깨짐은 바로, LOS는 30분을 기다린다
  assert.equal(tick(held, { cfg: cfgOf({ los: "shadow" }) }, NOW + 2 * MIN)[0].enforced, false); // 그림자로 내리면 막지 않는다
  assert.deepEqual(tick(held, { cfg: cfgOf({ los: "off" }) }, NOW + 2 * MIN), []);
});

test("재시작: atfm-state.json stops로 붙들던 출발 중지를 되살린다(예전 문구 key 포함). main 깨짐은 되살리지 않는다", () => {
  const revived = reviveStops(
    {
      "VCDO|failure-wave|build": at(-50),
      "VCDO|failure-wave|CI 실패가 몰림: e2e — 1시간 안에 PR 3개": at(-40), // ATC-62 전의 key
      "VCDO|congestion|": at(-20),
      "VCDO|main-broken|": at(-10),
    },
    airports,
  );
  assert.deepEqual(
    revived.map((s) => [s.trigger, s.check ?? null, s.kind, s.land, s.since]),
    [
      ["failure-wave", "build", "stop", true, at(-50)],
      ["failure-wave", "e2e", "stop", true, at(-40)],
      ["congestion", null, "delay", false, at(-20)],
    ],
  );
  // 트리거가 풀려 있으면 해제 규칙을 지금부터 센다(혼잡은 30분 더 붙든다)
  const held = tick(revived, {}, NOW);
  assert.deepEqual(held.map((s) => [s.trigger, s.clearSince]), [["failure-wave", at(0)], ["failure-wave", at(0)], ["congestion", at(0)]]);
});
