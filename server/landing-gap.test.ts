import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type FollowRow, FOLLOW_STAGES } from "./follow.ts";
import { type FlowInput, type FlowPullIn, flowViewOf } from "./home-flow.ts";
import { episodeStep, type EpisodeLine, gapCounterOf, gapThresholdOf, openEpisodesOf, parseGapSwitch } from "./landing-gap.ts";
import { appendEpisodes, loadGapSwitch, readEpisodes, saveGapSwitch, trackEpisodes } from "./landing-gap-run.ts";

// 착륙 간격 규칙(ATC-501, docs/home-flow.md 4.3)
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
// 마지막 착륙이 lastAgo분 전이고 그 앞으로 gaps(분) 간격으로 이어지는 착륙 시각
const chain = (lastAgo: number, gaps: number[]) => {
  const out = [ago(lastAgo)];
  let t = lastAgo;
  for (const g of gaps) out.push(ago((t += g)));
  return out;
};

test("기준: 7일 p90, 바닥 30분", () => {
  // 간격 10개: 10, 20, … 100분 → p90 = 91
  const t = gapThresholdOf(chain(5, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]), NOW);
  assert.deepEqual([t.thresholdMin, t.samples, t.rule], [91, 10, true]);
  // 간격이 모두 짧으면 바닥 30분
  const floor = gapThresholdOf(chain(5, Array(9).fill(8)), NOW);
  assert.deepEqual([floor.thresholdMin, floor.samples, floor.rule], [30, 9, true]);
});

test("기준: 7일 밖 착륙은 세지 않는다", () => {
  const old = chain(8 * 24 * 60, Array(12).fill(60)); // 8일 전부터 이어진 착륙
  const t = gapThresholdOf([...old, ago(5), ago(65)], NOW);
  assert.equal(t.samples, 1);
});

test("간격이 8개 미만이면 규칙이 없고(바닥만 보인다), 8개면 있다", () => {
  assert.equal(gapThresholdOf(chain(5, Array(7).fill(100)), NOW).rule, false);
  assert.equal(gapThresholdOf(chain(5, Array(7).fill(100)), NOW).thresholdMin, 100);
  assert.equal(gapThresholdOf(chain(5, Array(8).fill(100)), NOW).rule, true);
  assert.deepEqual(gapThresholdOf([], NOW), { thresholdMin: 30, samples: 0, rule: false });
});

test("스위치 값: 모르는 값·없음은 on, off만 off", () => {
  assert.deepEqual([parseGapSwitch(undefined), parseGapSwitch("x"), parseGapSwitch("off"), parseGapSwitch("on")], ["on", "on", "off", "on"]);
});

// ── 흐름판 판정에 꽂기: 스위치 off·간격 모자람은 간격 규칙만 뺀다 ──
const row = (key: string): FollowRow => {
  const stages = Object.fromEntries(FOLLOW_STAGES.map((s) => [s, { done: s === "todo", at: s === "todo" ? ago(90) : null, na: false }])) as FollowRow["stages"];
  return { key, title: key, url: null, state: "Todo", stateType: "unstarted", unreadable: false, stages, current: "todo", finished: false, now: "", progress: null, issues: [], history: [], proposal: null, proposalInfo: null, standFree: false, tail: false, stuck: null, next: null, ready: false, goAround: null, reverted: null, arrivedAt: null } as FollowRow;
};
const pulls: FlowPullIn[] = [];
const base = (over: Partial<FlowInput> = {}): FlowInput => ({
  now: NOW,
  airports: [{ code: "VCDO", name: "vocado" }],
  rows: [{ row: row("VOC-1"), airport: "VCDO", blockedBy: [] }],
  pulls,
  landings: chain(300, [100]).map((at) => ({ airport: "VCDO", at })),
  stops: [],
  mainRed: [],
  queue: [],
  thresholds: { VCDO: 158 },
  ...over,
});
const vc = (v: ReturnType<typeof flowViewOf>) => v.airports[0]!;

test("판정: 규칙이 있으면 기준(기준 158m)을 넘긴 착륙 없음이 막힘", () => {
  const v = vc(flowViewOf(base()));
  assert.equal(v.verdict, "stopped");
  assert.equal(v.gapStopped, true);
  assert.match(v.reason!, /\(기준 158m\)/);
});

test("판정: 스위치 off(noGapRule)면 간격 규칙만 빠지고 ground stop·main CI 빨강은 막힘 그대로", () => {
  const off = { noGapRule: ["VCDO"] };
  const none = vc(flowViewOf(base(off)));
  assert.equal(none.verdict, "normal");
  assert.equal(none.gapStopped, false);
  assert.equal(vc(flowViewOf(base({ ...off, stops: [{ airport: "VCDO", text: "main 깨짐" }] }))).verdict, "stopped");
  const ci = vc(flowViewOf(base({ ...off, mainRed: ["VCDO"] })));
  assert.equal(ci.verdict, "stopped");
  assert.equal(ci.reason, "main CI 빨강");
  assert.equal(ci.gapStopped, false);
});

// ── MISFIRE 에피소드 ──
const facts = (over: Partial<Parameters<typeof episodeStep>[1][number]> = {}) => ({ airport: "VCDO", gapStopped: false, groundStop: false, mainRed: false, lastOn: ago(300), ...over });
const openLine: EpisodeLine = { at: ago(100), op: "open", airport: "VCDO", thresholdMin: 158, lastOn: ago(300) };

test("에피소드: 막힘이 시작되면 open 한 줄, 이어지는 동안은 더하지 않는다", () => {
  const first = episodeStep(new Map(), [facts({ gapStopped: true })], { VCDO: 158 }, "on", NOW);
  assert.deepEqual(first.map((l) => [l.op, l.airport, l.thresholdMin]), [["open", "VCDO", 158]]);
  assert.deepEqual(episodeStep(openEpisodesOf(first), [facts({ gapStopped: true })], { VCDO: 158 }, "on", NOW + 60_000), []);
});

test("MISFIRE: 착륙으로 스스로 풀렸고 한 기준 안이면 센다", () => {
  // 마지막 착륙 300분 전, 기준 158: 막힘 시작 142분 전. 이제 착륙(30분 전)이 와서 풀렸다 — 착륙 간격 270분 ≤ 316
  const [l] = episodeStep(openEpisodesOf([openLine]), [facts({ lastOn: ago(30) })], { VCDO: 158 }, "on", NOW);
  assert.deepEqual([l!.op, l!.endedBy, l!.misfire], ["close", "landing", true]);
});

test("MISFIRE 아님: 기준의 두 배보다 늦게 풀렸거나, ground stop·CI·스위치·일 없어짐으로 끝났다", () => {
  const late = episodeStep(openEpisodesOf([{ ...openLine, lastOn: ago(900) }]), [facts({ lastOn: ago(30) })], { VCDO: 158 }, "on", NOW); // 간격 870 > 316
  assert.deepEqual([late[0]!.endedBy, late[0]!.misfire], ["landing", false]);
  const closed = (f: Partial<ReturnType<typeof facts>>, sw: "on" | "off" = "on") => episodeStep(openEpisodesOf([openLine]), [facts(f)], { VCDO: 158 }, sw, NOW)[0]!;
  assert.deepEqual([closed({ groundStop: true, lastOn: ago(30) }).endedBy, closed({ groundStop: true, lastOn: ago(30) }).misfire], ["stop", false]);
  assert.equal(closed({ mainRed: true, lastOn: ago(30) }).endedBy, "ci");
  assert.deepEqual([closed({ lastOn: ago(30) }, "off").endedBy, closed({ lastOn: ago(30) }, "off").misfire], ["switch", false]);
  assert.deepEqual([closed({}).endedBy, closed({}).misfire], ["work-gone", false]); // 착륙 없이 일이 사라짐(SUPERVISOR로 넘어감 등)
});

test("카운터: 에피소드 수·닫힌 수·MISFIRE·몫·열린 AIRPORT, 창 밖은 뺀다", () => {
  const lines: EpisodeLine[] = [
    { at: ago(60 * 24 * 9), op: "open", airport: "ATCC", thresholdMin: 60 },
    { at: ago(60 * 24 * 9 - 10), op: "close", airport: "ATCC", thresholdMin: 60, endedBy: "landing", misfire: true },
    { at: ago(400), op: "open", airport: "VCDO", thresholdMin: 158 },
    { at: ago(300), op: "close", airport: "VCDO", thresholdMin: 158, endedBy: "landing", misfire: true },
    { at: ago(200), op: "open", airport: "VCDO", thresholdMin: 158 },
    { at: ago(100), op: "close", airport: "VCDO", thresholdMin: 158, endedBy: "stop", misfire: false },
    { at: ago(50), op: "open", airport: "ATCC", thresholdMin: 60 },
  ];
  assert.deepEqual(gapCounterOf(lines, NOW), { episodes: 3, closed: 2, misfires: 1, share: 0.5, open: ["ATCC"] });
  assert.deepEqual(gapCounterOf([], NOW), { episodes: 0, closed: 0, misfires: 0, share: null, open: [] });
});

// ── 파일: 스위치는 원자적 JSON, 에피소드는 추가만 하는 JSONL ──
test("스위치 파일: 없으면 on, off를 쓰면 읽힌다(임시 폴더)", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-gap-"));
  const file = join(dir, "landing-gap.json");
  assert.equal(loadGapSwitch(file), "on");
  saveGapSwitch("off", "SUPERVISOR", file);
  assert.equal(loadGapSwitch(file), "off");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { mode: "off" });
  saveGapSwitch("on", "SUPERVISOR", file);
  assert.equal(loadGapSwitch(file), "on");
});

test("trackEpisodes: 열고, 착륙으로 풀리면 MISFIRE로 닫고, 줄은 덧붙이기만 한다(임시 폴더)", () => {
  const file = join(mkdtempSync(join(tmpdir(), "atc-gap-")), "episodes.jsonl");
  const view = (over: { gapStopped: boolean; lastOnAt: string; verdict?: "stopped" | "normal" }) => ({ airports: [{ code: "VCDO", name: "v", verdict: over.verdict ?? "normal", thresholdMin: 158, sinceOnMin: 0, landings12h: [], cells: [], ...over }] }) as never;
  assert.equal(trackEpisodes(view({ gapStopped: true, verdict: "stopped", lastOnAt: ago(300) }), "on", NOW - 3_600_000, file).length, 1);
  assert.equal(trackEpisodes(view({ gapStopped: true, verdict: "stopped", lastOnAt: ago(300) }), "on", NOW - 3_000_000, file).length, 0);
  const closed = trackEpisodes(view({ gapStopped: false, lastOnAt: ago(30) }), "on", NOW, file);
  assert.deepEqual(closed.map((l) => [l.op, l.misfire]), [["close", true]]);
  assert.equal(readEpisodes(file).length, 2);
  appendEpisodes([], file);
  assert.equal(readEpisodes(file).length, 2);
});
