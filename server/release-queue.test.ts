import assert from "node:assert/strict";
import test from "node:test";
import type { K3Status } from "./k3-allow.ts";
import { kLevelOf, type QueueInput, releaseQueueOf, type RowExtra } from "./release-queue.ts";
import type { StateWord, TreeGroup, TreeRow } from "./release-tree.ts";

// RELEASE 발권 대기열과 순서 지도: K 효과 읽기, 줄의 출처·단추·문제, 순서, 지도, 수, 7일 막대

test("K 효과: 운영에서 본 꼴 그대로 읽는다 — None은 K 태그가 아니다", () => {
  assert.equal(kLevelOf("* None.", null), "none");
  assert.equal(kLevelOf("None", null), "none");
  assert.equal(kLevelOf("None.", null), "none");
  assert.equal(kLevelOf("K1: none K2: none", null), "none");
  assert.equal(kLevelOf("None for this FLIGHT's own build. It adds a way to record screen releases several", null), "none");
  assert.equal(kLevelOf("None. The row only draws fields the server already computes; no control, switch", null), "none");
  assert.equal(kLevelOf("\\* None\\.", null), "none", "Linear가 이스케이프해 저장한 꼴");
  assert.equal(kLevelOf("", null), "none");
  assert.equal(kLevelOf(null, null), "undeclared");
  assert.equal(kLevelOf(undefined, null), "undeclared");
});

test("K 효과: 실제로 선언한 가장 높은 효과, K3 줄이 있으면 K3, 이름 없는 글은 declared", () => {
  assert.equal(kLevelOf("K1: none K2: the server sends FLIGHT PLANs without OCC (switch flightPlanResend)", null), "K2");
  assert.equal(kLevelOf("* K1: writes a JSONL record\n* K2: none", null), "K1");
  assert.equal(kLevelOf("K3[Security Test Removal]: drops the cloud push check | files: server/cloud.ts", null), "K3");
  assert.equal(kLevelOf("**K2**: restarts the service", null), "K2");
  assert.equal(kLevelOf("Writes to the production database", null), "declared");
  const k3 = { lines: 1 } as K3Status;
  assert.equal(kLevelOf("None", k3), "K3", "K3 줄이 있으면 본문 글보다 앞선다");
  assert.equal(kLevelOf(null, { lines: 0 } as K3Status), "undeclared");
});

const extra = (o: Partial<RowExtra> = {}): RowExtra => ({ hash: "h", kEffects: "None", k3: null, filed: null, why: null, stale: false, ...o });
const row = (key: string, state: StateWord, fire: TreeRow<RowExtra>["fire"], o: Partial<TreeRow<RowExtra>> = {}): TreeRow<RowExtra> => ({
  ...extra(),
  key,
  title: `${key} title`,
  priority: 3,
  state,
  fire,
  released: false,
  after: null,
  sequenceProblem: null,
  sameFiles: [],
  missing: [],
  children: [],
  ...o,
});
const READY: StateWord = { kind: "ready" };
const TODO: StateWord = { kind: "todo" };
const wait = (...on: string[]): StateWord => ({ kind: "waiting", on });
const stage = (word: string): StateWord => ({ kind: "stage", word });

// 운영 10-07의 모양을 줄인 것: 상위 이슈 하나(끝남 36/38), 기타 안의 사슬 둘과 홀로 있는 이슈들
const groups: TreeGroup<RowExtra>[] = [
  { key: "ATC-404", title: "UI refactor", done: 36, total: 38, next: "ATC-431", rows: [row("ATC-431", READY, "fire", { kEffects: "K2: switches a screen" })] },
  {
    key: null,
    title: "기타",
    done: 0,
    total: 0,
    next: "ATC-493",
    rows: [
      row("ATC-493", READY, "fire", { priority: 2 }),
      row("ATC-480", READY, "fire", {
        children: [row("ATC-481", wait("ATC-480"), null, { children: [row("ATC-482", wait("ATC-481"), null)] })],
      }),
      row("ATC-527", READY, "fire", { priority: 0 }),
      row("ATC-530", READY, "fire", { filed: { by: "DUTY REVIEW R-0022", at: "2026-10-03T17:48:18Z" } }),
      row("VOC-455", TODO, "release", { stale: true, kEffects: null }),
      row("ATC-562", stage("In Progress"), null, { children: [row("ATC-557", wait("ATC-562"), null)] }),
      row("ATC-600", TODO, null, { released: true }),
    ],
  },
];
const base = (o: Partial<QueueInput> = {}): QueueInput => ({
  groups,
  order: ["ATC-493", "ATC-431", "ATC-480", "ATC-530", "ATC-527", "VOC-455"],
  kPending: [],
  proposals: [],
  airportOf: (k) => (k.startsWith("ATC") ? "ATCC" : null),
  records: [],
  now: Date.parse("2026-10-07T03:00:00Z"),
  ...o,
});

test("대기열: 쏠 수 있는 줄만, 출처·단추·문제를 줄마다 정하고 문제 있는 줄이 먼저", () => {
  const q = releaseQueueOf(base());
  assert.deepEqual(
    q.rows.map((r) => [r.key, r.source, r.action, r.problem]),
    [
      ["ATC-527", "ready", "priority", "우선순위 없음"],
      ["VOC-455", "todo", "release", "발권 뒤 내용이 바뀜"],
      ["ATC-493", "ready", "fire", null],
      ["ATC-431", "ready", "fire", null],
      ["ATC-480", "ready", "fire", null],
      ["ATC-530", "filed", "fire", null],
    ],
  );
  const r480 = q.rows.find((r) => r.key === "ATC-480")!;
  assert.deepEqual(r480.unlocks, ["ATC-481", "ATC-482"], "풀리는 이슈는 나무에서 그 밑의 이슈, 깊이 순");
  assert.equal(q.rows.find((r) => r.key === "ATC-431")!.parent?.key, "ATC-404");
  assert.equal(r480.parent, null);
  assert.equal(q.rows.find((r) => r.key === "ATC-431")!.kLevel, "K2");
  assert.equal(r480.kLevel, "none");
  assert.equal(q.rows.find((r) => r.key === "VOC-455")!.kLevel, "undeclared");
  assert.equal(q.rows.find((r) => r.key === "VOC-455")!.airport, "VOC", "AIRPORT를 모르면 팀 key");
  assert.equal(r480.airport, "ATCC");
});

test("대기열: K 확인이 맨 앞, SCHEDULE NEW 제안은 맨 뒤이고 쏠 수 없다(HOME에서 승인)", () => {
  const q = releaseQueueOf(
    base({
      kPending: [{ key: "ATC-700", title: "K2 work", hash: "x", at: "2026-10-07T01:00:00Z", session: "ENGINEERING", words: "700 진행", kEffects: "K2: x" }],
      proposals: [{ id: "N-1", title: "draft", reason: "why", status: "draft", kEffects: null, priority: 3 }],
      priorityOf: (k) => (k === "ATC-700" ? 2 : 0),
    }),
  );
  assert.equal(q.rows[0]!.key, "ATC-700");
  assert.equal(q.rows[0]!.action, "k-confirm");
  assert.equal(q.rows[0]!.priority, 2);
  assert.deepEqual(q.rows[0]!.kConfirm, { at: "2026-10-07T01:00:00Z", session: "ENGINEERING", words: "700 진행" });
  const last = q.rows.at(-1)!;
  assert.deepEqual([last.key, last.source, last.action, last.proposal?.reason], ["N-1", "proposal", "home", "why"]);
  assert.equal(q.counts.fire, 7, "제안은 발권 가능 수에 들지 않는다");
});

test("대기열: 막는 이슈가 남은 제안도 쏠 수 있는 줄이고 무엇을 기다리는지 적는다", () => {
  const g: TreeGroup<RowExtra>[] = [{ key: null, title: "기타", done: 0, total: 0, next: null, rows: [row("ATC-9", wait("ATC-8"), "fire", { filed: { by: "DUTY REVIEW R-1", at: "2026-10-06T00:00:00Z" } })] }];
  const q = releaseQueueOf(base({ groups: g, order: [] }));
  assert.deepEqual([q.rows[0]!.source, q.rows[0]!.action, q.rows[0]!.waitingOn], ["filed", "fire", ["ATC-8"]]);
  assert.equal(q.counts.waiting, 0, "쏠 수 있는 줄은 기다림에 세지 않는다");
});

test("순서 지도: 상위 이슈마다 한 줄, 기타에서는 밑에 이슈가 있는 사슬만, 쏠 것이 있는 줄이 먼저", () => {
  const q = releaseQueueOf(base());
  assert.deepEqual(
    q.map.map((l) => [l.id, l.parent?.key ?? null, l.chains.map((c) => c.map((n) => `${n.key}:${n.kind}`))]),
    [
      ["ATC-404", "ATC-404", [["ATC-431:fire"]]],
      ["chain-ATC-480", null, [["ATC-480:fire", "ATC-481:waiting", "ATC-482:waiting"]]],
      ["chain-ATC-562", null, [["ATC-562:stage", "ATC-557:waiting"]]],
    ],
  );
  const lane404 = q.map[0]!;
  assert.deepEqual([lane404.done, lane404.total, lane404.fire, lane404.airport], [36, 38, 1, "ATCC"]);
  assert.deepEqual(q.map[1]!.chains[0]!.map((n) => n.word), ["READY", "대기 ATC-480", "대기 ATC-481"]);
  assert.equal(q.map[2]!.chains[0]![0]!.word, "In Progress");
  assert.equal(q.map[1]!.total, 3);
});

test("수: 발권 가능, AIRPORT마다, 쏘면 풀리는 이슈, 기다림, 비행 중(발권한 Todo 포함)", () => {
  const q = releaseQueueOf(base());
  assert.equal(q.counts.fire, 6);
  assert.deepEqual(q.counts.byAirport, [
    { airport: "ATCC", fire: 5 },
    { airport: "VOC", fire: 1 },
  ]);
  assert.equal(q.counts.unlocks, 2);
  assert.equal(q.counts.waiting, 3);
  assert.equal(q.counts.flying, 2);
});

test("7일 막대: 오늘을 포함한 UTC 날짜 7개에 채널별로 센다, 8일 전과 미래는 세지 않는다", () => {
  const q = releaseQueueOf(
    base({
      records: [
        { flight: "A-1", channel: "screen", at: "2026-10-07T00:10:00Z" },
        { flight: "A-2", channel: "screen", at: "2026-10-06T23:59:00Z" },
        { flight: "A-3", channel: "attested", at: "2026-10-01T00:00:00Z" },
        { flight: "A-4", channel: "duty-chat", at: "2026-10-04T12:00:00Z" },
        { flight: "A-5", channel: "screen", at: "2026-09-30T23:59:00Z" },
        { flight: "A-6", channel: "screen", at: "2026-10-07T05:00:00Z" },
      ],
    }),
  );
  assert.deepEqual(q.days.map((d) => d.day), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(q.days.map((d) => d.screen + d["duty-chat"] + d.attested), [1, 0, 0, 1, 0, 1, 1]);
  assert.equal(q.days[3]!["duty-chat"], 1);
  assert.equal(q.days[0]!.attested, 1);
});

test("빈 입력: 줄·지도 없음, 수는 0, 막대 7개", () => {
  const q = releaseQueueOf(base({ groups: [], order: [] }));
  assert.deepEqual([q.rows.length, q.map.length, q.counts.fire, q.counts.unlocks, q.days.length], [0, 0, 0, 0, 7]);
});
