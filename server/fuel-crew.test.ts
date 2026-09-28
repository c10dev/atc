import assert from "node:assert/strict";
import { test } from "node:test";
import type { CrewMember } from "./crew.ts";
import { type FuelRecord, summarizeFuel } from "./fuel.ts";
import {
  agentModels,
  agentWarnings,
  crewShareOf,
  crewWarnings,
  declaresModel,
  driftOf,
  emptyWarnings,
  normModel,
  sameModel,
} from "./fuel-crew.ts";

const T0 = Date.parse("2026-09-28T08:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
let n = 0;
// CREW 요청: 5m 층으로 쓰고 나머지는 읽는다
const crew = (min: number, o: Partial<FuelRecord> = {}): FuelRecord => ({
  key: `c${++n}`,
  session: "s1",
  sidechain: true,
  agent: "a1",
  t: at(min),
  model: "claude-opus-5-5",
  input: 5,
  cacheWrite5m: 2_000,
  cacheWrite1h: 0,
  cacheRead: 20_000,
  output: 300,
  stopReason: "tool_use",
  version: null,
  effort: null,
  ...o,
});
const kinds = (ws: { kind: string }[]) => ws.map((w) => w.kind);
const COMPLEMENT: CrewMember[] = [
  { position: "backend", agent: "claude-opus-5-5" },
  { position: "ui-builder", agent: "ui-builder" },
  { position: "flash-helper", agent: "deepseek-v4-1-flash" },
];
const work = (from: number, turns: number) => Array.from({ length: turns }, (_, i) => crew(from + i, { cacheRead: 20_000 + i * 3_000 }));

test("평범한 서브에이전트는 경고가 없다", () => {
  assert.deepEqual(agentWarnings({ records: work(0, 8), meta: { agentType: "general-purpose", spawnDepth: 1 }, complement: COMPLEMENT }), []);
});

test("HEAVY PREFIX: 첫 CREW 요청이 캐시에 30K 넘게 쓰면(값은 쓴 토큰)", () => {
  const rs = [crew(0, { cacheWrite5m: 34_000, cacheRead: 0 }), ...work(1, 6)];
  const [w] = agentWarnings({ records: rs, meta: null, complement: null });
  assert.deepEqual([w.kind, w.value, w.t], ["heavyPrefix", 34_000, at(0)]);
  assert.deepEqual(agentWarnings({ records: [crew(0, { cacheWrite5m: 30_000, cacheRead: 0 }), ...work(1, 6)], meta: null, complement: null }), []);
});

test("TRIVIAL DELEGATION: 3턴 이하이고 첫 프롬프트가 입력 전체의 50 %를 넘으면", () => {
  const one = agentWarnings({ records: [crew(0)], meta: null, complement: null });
  assert.deepEqual(kinds(one), ["trivialDelegation"]);
  assert.equal(one[0].value, 1);
  assert.deepEqual(kinds(agentWarnings({ records: work(0, 4), meta: null, complement: null })), []); // 4턴
  // 3턴이어도 뒤 턴이 크면(첫 프롬프트 몫 ≤ 50 %) 아니다
  const grown = [crew(0), crew(1, { cacheRead: 30_000 }), crew(2, { cacheRead: 40_000 })];
  assert.deepEqual(kinds(agentWarnings({ records: grown, meta: null, complement: null })), []);
});

test("DEEP NESTING: spawnDepth ≥ 2", () => {
  const [w] = agentWarnings({ records: work(0, 5), meta: { agentType: "general-purpose", spawnDepth: 2 }, complement: null });
  assert.deepEqual([w.kind, w.value], ["deepNesting", 2]);
  assert.deepEqual(agentWarnings({ records: work(0, 5), meta: { agentType: "general-purpose", spawnDepth: 1 }, complement: null }), []);
});

test("EXPENSIVE READ-ONLY: Explore·Plan이 Opus로 답하면(값은 Opus 요청 수)", () => {
  const [w] = agentWarnings({ records: work(0, 5), meta: { agentType: "Explore", spawnDepth: 1 }, complement: null });
  assert.deepEqual([w.kind, w.value, w.agentType], ["expensiveReadOnly", 5, "Explore"]);
  const haiku = work(0, 5).map((r) => ({ ...r, model: "claude-haiku-4-5-20251001" }));
  assert.deepEqual(agentWarnings({ records: haiku, meta: { agentType: "Plan", spawnDepth: 1 }, complement: null }), []);
});

test("COLD CREW: 5분 넘게 쉰 서브에이전트를 다시 쓰면 쉰 때마다(값은 쉰 ms)", () => {
  const rs = [...work(0, 4), ...work(10, 2), ...work(14, 2)];
  const ws = agentWarnings({ records: rs, meta: null, complement: null });
  assert.deepEqual(ws.map((w) => [w.kind, w.t, w.value]), [["coldCrew", at(10), 7 * 60_000]]);
});

test("COMPLEMENT DRIFT: 선언한 모델과 실제 message.model이 다르면. 선언이 모델이 아니거나 없으면 판단하지 않는다", () => {
  assert.equal(driftOf("general-purpose", "claude-opus-5-5", COMPLEMENT), null); // backend가 Opus를 선언
  assert.equal(driftOf("general-purpose", "claude-sonnet-5", COMPLEMENT), "general-purpose: no POSITION declares claude-sonnet-5");
  assert.equal(driftOf("flash-helper", "deepseek-v4.1-flash", COMPLEMENT), null);
  assert.equal(driftOf("flash-helper", "claude-opus-5-5", COMPLEMENT), "flash-helper: declared deepseek-v4-1-flash, actual claude-opus-5-5");
  assert.equal(driftOf("ui-builder", "claude-sonnet-5", COMPLEMENT), null); // agent 타입 이름은 모델을 말하지 않는다
  assert.equal(driftOf("Explore", "claude-sonnet-5", COMPLEMENT), null); // 선언에 없는 타입은 crew-observed의 undeclared가 맡는다
  assert.equal(driftOf("general-purpose", "claude-sonnet-5", null), null);
  const sonnet = work(0, 5).map((r) => ({ ...r, model: "claude-sonnet-5" }));
  const [w] = agentWarnings({ records: sonnet, meta: { agentType: "general-purpose", spawnDepth: 1 }, complement: COMPLEMENT });
  assert.deepEqual([w.kind, w.detail], ["complementDrift", "general-purpose: no POSITION declares claude-sonnet-5"]);
});

test("모델 이름 비교: 프록시 접두어와 구두점을 떼고 견준다", () => {
  assert.equal(normModel("claude-ocx-opencode-go--deepseek-v4.1-flash"), "deepseekv41flash");
  assert.equal(normModel("opencode-go/deepseek-v4.1-flash"), "deepseekv41flash");
  assert.ok(sameModel("deepseek-v4-1-flash", "claude-ocx-opencode-go--deepseek-v4.1-flash"));
  assert.ok(!sameModel("claude-opus-5-5", "claude-sonnet-5"));
  assert.ok(declaresModel("claude-opus-5-5"));
  assert.ok(!declaresModel("ui-builder"));
});

test("agentModels: 서브에이전트마다 가장 많이 답한 모델", () => {
  const rs = [crew(0), crew(1, { model: "claude-sonnet-5" }), crew(2, { model: "claude-sonnet-5" }), crew(3, { agent: "a2" })];
  assert.deepEqual([...agentModels(rs)], [["a1", "claude-sonnet-5"], ["a2", "claude-opus-5-5"]]);
});

test("crewWarnings: CAPTAIN은 건너뛰고 서브에이전트마다 meta·COMPLEMENT로 판단, 시각 순서", () => {
  const captain = { ...crew(0), sidechain: false, agent: null };
  const rs = [captain, crew(3, { agent: "b" }), crew(0, { agent: "a", cacheWrite5m: 40_000, cacheRead: 0 }), ...work(1, 5).map((r) => ({ ...r, agent: "a" }))];
  const ws = crewWarnings({
    records: rs,
    agents: new Map([
      ["a", { agentType: "general-purpose", spawnDepth: 1 }],
      ["b", { agentType: "Explore", spawnDepth: 3 }],
    ]),
    complementOf: () => COMPLEMENT,
  });
  assert.deepEqual(
    ws.map((w) => [w.agent, w.kind]),
    [
      ["a", "heavyPrefix"],
      ["b", "trivialDelegation"],
      ["b", "deepNesting"],
      ["b", "expensiveReadOnly"],
    ],
  );
});

test("HIGH CREW SHARE: FLIGHT 토큰 중 CREW가 50 %를 넘으면 그 몫", () => {
  const k = (n: number) => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: n, output: 0 });
  assert.equal(crewShareOf(k(40), k(60)), 0.6);
  assert.equal(crewShareOf(k(50), k(50)), null);
  assert.equal(crewShareOf(k(0), k(0)), null);
  assert.deepEqual(Object.values(emptyWarnings()), [0, 0, 0, 0, 0, 0, 0]);
});

test("summarizeFuel: CREW 경고를 세션·AIRCRAFT·전체로 세고 최근 순서로 준다(기간 밖은 뺀다)", () => {
  const rs = [crew(0), crew(1, { session: "s2", key: "x2" })];
  const w = (session: string, min: number, kind: "heavyPrefix" | "coldCrew") => ({ kind, session, agent: "a1", agentType: null, t: at(min), value: 1, detail: null });
  const s = summarizeFuel({
    records: rs,
    warnings: [w("s1", 0, "heavyPrefix"), w("s2", 1, "coldCrew"), w("s1", -60 * 30, "coldCrew")],
    names: new Map([["s1", "TEAM_I"], ["s2", "team_i"]]),
    now: T0 + 3_600_000,
    days: 1,
  });
  assert.equal(s.sessions.find((x) => x.session === "s1")!.crewWarnings.heavyPrefix, 1);
  assert.deepEqual([s.aircraft[0].crewWarnings.heavyPrefix, s.aircraft[0].crewWarnings.coldCrew], [1, 1]);
  assert.equal(s.totals.crewWarnings.coldCrew, 1);
  assert.deepEqual(s.crewWarningEvents.map((e) => [e.kind, e.name]), [["coldCrew", "team_i"], ["heavyPrefix", "TEAM_I"]]);
});
