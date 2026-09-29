import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheHit, dedupeFuel, type FuelRecord, kindsOf, modelCommandOf, parseFuelLines, summarizeFuel } from "./fuel.ts";

// 실제 줄 모양(2026-09-28 대화 기록의 키 구조)을 본떠 만든 줄. 본문 자리에는 표시 문자열만 둔다
const SECRET = "BODY-TEXT-must-not-survive";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

interface Opt {
  id?: string;
  req?: string | null;
  session?: string;
  t?: string;
  sidechain?: boolean;
  model?: string;
  stop?: string | null;
  usage?: Record<string, unknown>;
}
function assistant(o: Opt = {}): string {
  const line: Record<string, unknown> = {
    parentUuid: "p",
    isSidechain: o.sidechain ?? false,
    message: {
      model: o.model ?? "claude-opus-5-5",
      id: o.id ?? "msg_A",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: SECRET }, { type: "tool_use", input: { command: SECRET } }],
      stop_reason: o.stop === undefined ? "tool_use" : o.stop,
      usage: o.usage ?? {
        input_tokens: 2,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
        output_tokens: 50,
        cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 },
        service_tier: "standard",
        inference_geo: "not_available",
        speed: "standard",
      },
    },
    wireToolInputs: { toolu_1: { command: SECRET, description: SECRET } },
    apiBlockIndex: 0,
    type: "assistant",
    uuid: "u",
    timestamp: o.t ?? "2026-09-28T10:00:00.000Z",
    effort: "high",
    sessionId: o.session ?? S1,
    version: "2.1.281",
  };
  if (o.req !== null) line.requestId = o.req ?? "req_A";
  return JSON.stringify(line);
}
const lines = (...xs: string[]) => `${xs.join("\n")}\n`;

test("parseFuelLines: 다섯 가지와 모델·stop_reason·version·effort를 꺼낸다", () => {
  const p = parseFuelLines(lines(assistant()));
  assert.equal(p.records.length, 1);
  assert.deepEqual(p.records[0], {
    key: "msg_A|req_A",
    session: S1,
    sidechain: false,
    agent: null,
    t: "2026-09-28T10:00:00.000Z",
    model: "claude-opus-5-5",
    input: 2,
    cacheWrite5m: 0,
    cacheWrite1h: 100,
    cacheRead: 1000,
    output: 50,
    stopReason: "tool_use",
    version: "2.1.281",
    effort: "high",
    speed: "standard",
    geo: "not_available",
  });
  assert.equal(p.unknown, 0);
});

test("본문·도구 입력·도구 결과·요약 글은 기록에 남지 않는다", () => {
  const user = JSON.stringify({ type: "user", message: { role: "user", content: SECRET }, toolUseResult: { usage: { input_tokens: 1 }, stdout: SECRET }, sessionId: S1 });
  const compact = JSON.stringify({ type: "system", subtype: "compact_boundary", content: SECRET, compactMetadata: { trigger: "auto", preTokens: 900, postTokens: 20 }, timestamp: "2026-09-28T09:00:00Z", sessionId: S1 });
  const name = JSON.stringify({ type: "agent-name", agentName: "TEAM_J", sessionId: S1 });
  const p = parseFuelLines(lines(assistant(), user, compact, name, JSON.stringify({ type: "user", message: { content: `"usage" ${SECRET}` } })));
  assert.equal(p.records.length, 1);
  assert.equal(p.compactions.length, 1);
  assert.ok(!JSON.stringify(p).includes(SECRET));
  assert.ok(!JSON.stringify(summarizeFuel({ records: p.records, compactions: p.compactions, now: Date.parse("2026-09-28T12:00:00Z"), days: 7 })).includes(SECRET));
});

test("usage·compact_boundary·agent-name이 없는 줄은 파싱하지 않는다(깨진 줄도 모르는 줄로 세지 않는다)", () => {
  const p = parseFuelLines(lines(`{"type":"user","message":{"content":"${SECRET}"`, "not json at all", JSON.stringify({ type: "user", message: { content: SECRET } })));
  assert.deepEqual(p, { records: [], compactions: [], modelCommands: [], name: null, unknown: 0, synthetic: 0 });
});

test("모르는 모양은 건너뛰고 센다", () => {
  const p = parseFuelLines(
    lines(
      `{"type":"assistant","message":{"usage":{"input_tokens":1`, // 깨진 JSON
      JSON.stringify({ type: "assistant", message: { model: "m", usage: { input_tokens: 1, output_tokens: 1 } }, timestamp: "2026-09-28T10:00:00Z", sessionId: S1 }), // id 없음
      assistant({ usage: { input_tokens: "3", output_tokens: 1 } }), // 숫자가 아님
      assistant({ usage: { input_tokens: 1 } }), // output 없음
      JSON.stringify({ type: "progress", message: { usage: { input_tokens: 1, output_tokens: 1 } } }), // 새 줄 종류
      JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId: S1 }), // 시각 없음
      assistant({ model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } }),
      assistant({ id: "msg_ok" }),
    ),
  );
  assert.equal(p.records.length, 1);
  assert.equal(p.unknown, 6);
  assert.equal(p.synthetic, 1);
});

test("kindsOf: 5m/1h 나누기 — cache_creation을 따르고, 없으면 전부 5m, 합은 cache_creation_input_tokens", () => {
  const base = { input_tokens: 5, cache_read_input_tokens: 7, output_tokens: 9 };
  assert.deepEqual(kindsOf({ ...base, cache_creation_input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 200 } }), {
    input: 5,
    cacheWrite5m: 200,
    cacheWrite1h: 100,
    cacheRead: 7,
    output: 9,
  });
  assert.deepEqual(kindsOf({ ...base, cache_creation_input_tokens: 300 }), { input: 5, cacheWrite5m: 300, cacheWrite1h: 0, cacheRead: 7, output: 9 });
  // 나누기가 합보다 크면 합을 넘지 않게
  assert.deepEqual(kindsOf({ ...base, cache_creation_input_tokens: 50, cache_creation: { ephemeral_1h_input_tokens: 80 } }), { input: 5, cacheWrite5m: 0, cacheWrite1h: 50, cacheRead: 7, output: 9 });
  assert.deepEqual(kindsOf({ input_tokens: 1, output_tokens: 2 }), { input: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 2 });
  assert.equal(kindsOf({ input_tokens: -1, output_tokens: 2 }), null);
});

test("중복 제거: 한 응답의 내용 블록 줄들은 요청 하나, 스트리밍 첫 조각보다 끝난 응답(합이 큰 쪽)", () => {
  const snap = { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: 1 };
  const p = parseFuelLines(
    lines(
      assistant({ stop: null, usage: snap, t: "2026-09-28T10:00:00.000Z" }),
      assistant({ t: "2026-09-28T10:00:01.000Z" }),
      assistant({ t: "2026-09-28T10:00:02.000Z" }),
    ),
  );
  assert.equal(p.records.length, 3);
  const m = dedupeFuel(p.records);
  assert.equal(m.size, 1);
  assert.equal([...m.values()][0].output, 50);
  assert.equal([...m.values()][0].stopReason, "tool_use");
});

test("중복 제거: 이어 받은 세션의 사본은 전역으로 한 번, 같은 크기면 먼저 넣은 쪽(원래 세션)", () => {
  const a = parseFuelLines(lines(assistant({ session: S1 }))).records;
  const b = parseFuelLines(lines(assistant({ session: S2 }))).records;
  const m = dedupeFuel([...a, ...b]);
  assert.equal(m.size, 1);
  assert.equal([...m.values()][0].session, S1);
});

test("중복 제거: requestId가 없으면 (message.id, session) — timestamp가 달라도 한 요청", () => {
  const p = parseFuelLines(
    lines(
      assistant({ req: null, model: "deepseek-v4.1-flash", t: "2026-09-28T10:00:00.000Z" }),
      assistant({ req: null, model: "deepseek-v4.1-flash", t: "2026-09-28T10:00:03.000Z" }),
      assistant({ req: null, model: "deepseek-v4.1-flash", session: S2 }),
    ),
  );
  assert.equal(p.records[0].key, `msg_A|s:${S1}`);
  assert.equal(dedupeFuel(p.records).size, 2);
});

test("중복 제거: CAPTAIN(non-sidechain) 사본이 CREW 사본보다 앞선다(합이 작아도)", () => {
  const crew = parseFuelLines(lines(assistant({ sidechain: true, usage: { input_tokens: 999, output_tokens: 999 } })), { crew: true, agent: "a1" }).records;
  const main = parseFuelLines(lines(assistant())).records;
  const m = dedupeFuel([...crew, ...main]);
  assert.equal(m.size, 1);
  assert.equal([...m.values()][0].sidechain, false);
  assert.equal(crew[0].agent, "a1");
});

test("CREW 파일의 줄은 isSidechain이 없어도 CREW로 본다", () => {
  const r = parseFuelLines(lines(assistant()), { crew: true, agent: "x" }).records[0];
  assert.equal(r.sidechain, true);
});

test("compact_boundary와 agent-name(마지막 이름)", () => {
  const p = parseFuelLines(
    lines(
      JSON.stringify({ type: "agent-name", agentName: "TEAM_X", sessionId: S1 }),
      JSON.stringify({ type: "system", subtype: "compact_boundary", content: "x", compactMetadata: { trigger: "manual", preTokens: 500 }, timestamp: "2026-09-28T09:00:00Z", sessionId: S1 }),
      JSON.stringify({ type: "agent-name", agentName: "TEAM_J", sessionId: S1 }),
    ),
  );
  assert.equal(p.name, "TEAM_J");
  assert.deepEqual(p.compactions, [{ session: S1, t: "2026-09-28T09:00:00Z", trigger: "manual", preTokens: 500, postTokens: null }]);
});

const NOW = Date.parse("2026-09-28T12:00:00Z");
function rec(o: Partial<FuelRecord>): FuelRecord {
  return {
    key: Math.random().toString(36),
    session: S1,
    sidechain: false,
    agent: null,
    t: "2026-09-28T10:00:00Z",
    model: "claude-opus-5-5",
    input: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0,
    stopReason: "end_turn",
    version: "2.1.281",
    effort: "high",
    speed: "standard",
    geo: null,
    ...o,
  };
}

test("cacheHit: Σ read / Σ(input + write + read), 없으면 null", () => {
  assert.equal(cacheHit({ input: 10, cacheWrite5m: 20, cacheWrite1h: 70, cacheRead: 900, output: 5 }), 0.9);
  assert.equal(cacheHit({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 5 }), null);
});

test("summarizeFuel: CAPTAIN·CREW를 나누고, CREW 출력은 하한(stop_reason null 몫, agentType·spawnDepth)", () => {
  const s = summarizeFuel({
    records: [
      rec({ input: 10, cacheWrite1h: 90, cacheRead: 900, output: 100 }),
      rec({ sidechain: true, agent: "a1", input: 5, cacheWrite5m: 50, cacheRead: 45, output: 3, stopReason: null, model: "deepseek-v4.1-flash" }),
      rec({ sidechain: true, agent: "a1", input: 5, cacheRead: 95, output: 40 }),
      rec({ sidechain: true, agent: "a2", output: 7, stopReason: null }),
    ],
    agents: new Map([
      ["a1", { agentType: "ui-qa", spawnDepth: 1 }],
      ["a2", { agentType: "Explore", spawnDepth: 2 }],
    ]),
    names: new Map([[S1, "team_j"]]),
    live: new Set([S1]),
    unknownBySession: new Map([[S1, 2]]),
    now: NOW,
    days: 7,
  });
  const x = s.sessions[0];
  assert.equal(x.name, "team_j");
  assert.equal(x.live, true);
  const { cost: _cost, unpriced, ...tokens } = x.captain;
  assert.deepEqual(tokens, { input: 10, cacheWrite5m: 0, cacheWrite1h: 90, cacheRead: 900, output: 100, requests: 1, cacheHit: 0.9 });
  assert.deepEqual(unpriced, { requests: 1, tokens: 1100 }); // 가격표 없이 부르면 모두 값 없음
  assert.equal(x.crew.requests, 3);
  assert.equal(x.crew.output, 50);
  assert.equal(x.crew.outputLowerBound, true);
  assert.equal(x.crew.nullStopShare, 0.667);
  assert.equal(x.crew.agents, 2);
  assert.deepEqual(x.crew.byType, { "ui-qa": 2, Explore: 1 });
  assert.equal(x.crew.maxSpawnDepth, 2);
  assert.equal(x.total.requests, 4);
  assert.deepEqual(x.models, { "claude-opus-5-5": 3, "deepseek-v4.1-flash": 1 });
  assert.equal(x.unknownLines, 2);
  assert.equal(s.unknownLines, 2);
  assert.equal(s.aircraft[0].aircraft, "TEAM_J");
  assert.equal(s.aircraft[0].total.requests, 4);
});

test("summarizeFuel: 기간 밖 기록은 빼고, 이름 없는 세션은 AIRCRAFT에 넣지 않으며, 같은 이름 세션은 AIRCRAFT 하나로", () => {
  const s = summarizeFuel({
    records: [
      rec({ output: 1, t: "2026-09-20T00:00:00Z" }),
      rec({ output: 2 }),
      rec({ session: S2, output: 30 }),
      rec({ session: "33333333-3333-4333-8333-333333333333", output: 4 }),
    ],
    compactions: [
      { session: S1, t: "2026-09-28T09:00:00Z", trigger: "auto", preTokens: 1, postTokens: 1 },
      { session: S1, t: "2026-09-01T09:00:00Z", trigger: "auto", preTokens: 1, postTokens: 1 },
    ],
    names: new Map([
      [S1, "TEAM_K"],
      [S2, "team_k"],
    ]),
    now: NOW,
    days: 7,
  });
  assert.equal(s.requests, 3);
  assert.deepEqual(
    s.sessions.map((x) => [x.session.slice(0, 1), x.total.output]),
    [
      ["2", 30],
      ["3", 4],
      ["1", 2],
    ],
  );
  assert.equal(s.sessions.find((x) => x.session === S1)?.compactions, 1);
  assert.equal(s.aircraft.length, 1);
  assert.deepEqual(s.aircraft[0].sessions.sort(), [S1, S2].sort());
  assert.equal(s.aircraft[0].total.output, 32);
  assert.equal(s.since, "2026-09-21T12:00:00.000Z");
});

// 실제 줄 모양(2026-09-29 데스크톱 대화 기록): /model 출력은 문자열 content의 local-command-stdout
const modelLine = (content: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ parentUuid: "p", isSidechain: false, type: "user", message: { role: "user", content }, timestamp: "2026-09-29T01:05:48.421Z", sessionId: S1, entrypoint: "claude-desktop", ...over });

test("parseFuelLines: /model 출력(Set model to `id`)을 세션·시각·id로 꺼낸다. 표시 이름이면 id는 null", () => {
  const p = parseFuelLines(
    [
      modelLine("<local-command-stdout>Set model to `claude-sonnet-5-5`</local-command-stdout>"),
      modelLine("<local-command-stdout>Set model to `claude-sonnet-5-5[1m]`</local-command-stdout>", { timestamp: "2026-09-29T01:22:43.358Z" }),
      modelLine("<local-command-stdout>Set model to `Sonnet 5` and saved as your default for new sessions</local-command-stdout>", { timestamp: "2026-09-29T02:00:00.000Z" }),
    ].join("\n") + "\n",
  );
  assert.deepEqual(
    p.modelCommands.map((c) => [c.session === S1, c.t.slice(11, 19), c.model]),
    [
      [true, "01:05:48", "claude-sonnet-5-5"],
      [true, "01:22:43", "claude-sonnet-5-5[1m]"],
      [true, "02:00:00", null],
    ],
  );
  assert.equal(p.unknown, 0);
});

test("parseFuelLines: /model 출력 모양이 아닌 줄은 세지 않는다(도구 결과 안의 글, 본문 중간의 글, CREW 줄)", () => {
  const q = "Set model to `claude-sonnet-5-5`";
  const lines = [
    modelLine([{ type: "tool_result", content: `<local-command-stdout>${q}</local-command-stdout>` }] as unknown as string), // 도구 결과(배열 content)
    modelLine(`나중에 <local-command-stdout>${q}</local-command-stdout> 라고 씀`), // 첫머리가 아니다
    modelLine(`<local-command-stdout>${q}</local-command-stdout>`, { isSidechain: true }), // CREW
    modelLine(`<local-command-stdout>${q}</local-command-stdout>`, { type: "assistant" }),
  ];
  const p = parseFuelLines(lines.join("\n") + "\n");
  assert.deepEqual(p.modelCommands, []);
  assert.equal(p.records.length, 0);
  assert.deepEqual(modelCommandOf("<local-command-stdout>Set model to `x y`</local-command-stdout>"), { model: null });
  assert.equal(modelCommandOf("Set model to `claude-sonnet-5-5`"), null);
});
