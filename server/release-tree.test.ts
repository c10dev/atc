import assert from "node:assert/strict";
import test from "node:test";
import type { Ticket } from "./model.ts";
import type { Holder } from "./overlap.ts";
import { baseOrderOf, fireOrderOf, type FireCand, releaseTreeOf } from "./release-tree.ts";
import { sequenceOf } from "./sequence-line.ts";

// RELEASE의 순서(ATC-456): Sequence 줄(Linear가 저장한 꼴), 발권 순서, 상위 이슈 나무, 다음 발권, 같은 파일
// ATC-424의 본문 `## Release` 절 그대로(Linear가 쓴 ATC-n을 이슈 멘션으로 바꿔 저장한다)
const STORED_424 = [
  "## Release",
  "",
  "Not released. Filed in Backlog on the SUPERVISOR's \"작업지시서 만들어\" (2026-10-02, with \"먼저 5개만 Todo\"). It shows as READY on the RELEASE screen once its blockers are done; the SUPERVISOR fires it there.",
  "",
  'Sequence: after <issue id="52137a71-ed3e-4d4c-97ed-c20f8a12a090" href="https://linear.app/vocado/issue/ATC-422/home-answers-is-there-anything-for-me-to-do-one-to-do-list-in-a">ATC-422</issue> — same files (S1b moves LATE WAYPOINTS to the top of the FLIGHTS LIST)',
].join("\n");

test("Sequence 줄: Linear가 저장한 꼴(이슈 멘션, 긴 줄표)을 읽는다 — ATC-424", () => {
  assert.deepEqual(sequenceOf(STORED_424), { after: "ATC-422", reason: "same files (S1b moves LATE WAYPOINTS to the top of the FLIGHTS LIST)", problem: null });
});

test("Sequence 줄: 쓴 그대로, 글머리, 이스케이프, 하이픈, 대소문자도 읽는다", () => {
  const body = (line: string) => `## Release\n\n${line}\n`;
  assert.equal(sequenceOf(body("Sequence: after ATC-7 — why"))?.after, "ATC-7");
  assert.equal(sequenceOf(body("* Sequence: after ATC-7 - why"))?.reason, "why");
  assert.equal(sequenceOf(body("sequence: AFTER atc-7 – why"))?.after, "ATC-7");
  assert.equal(sequenceOf(body("Sequence\\: after ATC\\-7 — same\\_files"))?.reason, "same_files");
});

test("Sequence 줄: 없으면 null, `## Release` 밖의 줄은 읽지 않는다, 틀린 줄은 이유를 달고 순서에 쓰지 않는다", () => {
  assert.equal(sequenceOf(null), null);
  assert.equal(sequenceOf("## Goal\n\nSequence: after ATC-1 — x"), null);
  const bad = sequenceOf("## Release\n\nSequence: after ATC-1");
  assert.equal(bad?.after, null);
  assert.match(bad?.problem ?? "", /꼴이 아님/);
  assert.match(sequenceOf("## Release\n\nSequence: soon — x")?.problem ?? "", /꼴이 아님/);
  const two = sequenceOf("## Release\n\nSequence: after ATC-1 — a\nSequence: after ATC-2 — b");
  assert.equal(two?.after, null);
  assert.match(two?.problem ?? "", /2개/);
});

const cand = (key: string, o: Partial<FireCand> = {}): FireCand => ({ key, priority: 3, unblocks: 0, createdAt: "2026-10-01T00:00:00Z", after: null, ...o });

test("발권 순서: 우선순위, 풀어 주는 이슈 수, 오래 기다린 것 순", () => {
  const c = [
    cand("A-1", { priority: 4, createdAt: "2026-09-01T00:00:00Z" }), // Low
    cand("A-2", { priority: 2 }), // High
    cand("A-3", { priority: 2, unblocks: 3 }), // High, 풀어 주는 것이 많다
    cand("A-4", { priority: 1, createdAt: "2026-10-02T00:00:00Z" }), // Urgent
    cand("A-5", { priority: 2, unblocks: 3, createdAt: "2026-09-20T00:00:00Z" }), // A-3보다 오래 기다림
    cand("A-6", { priority: 0 }), // 없음: Medium 아래, Low 위
    cand("A-7", { priority: 3 }),
  ];
  assert.deepEqual(baseOrderOf(c).map((x) => x.key), ["A-4", "A-5", "A-3", "A-2", "A-7", "A-6", "A-1"]);
  assert.deepEqual(fireOrderOf(c), ["A-4", "A-5", "A-3", "A-2", "A-7", "A-6", "A-1"]);
});

test("발권 순서: 같으면 key 순이고, 알 수 없는 시각은 맨 뒤", () => {
  assert.deepEqual(fireOrderOf([cand("A-2", { createdAt: null }), cand("A-3"), cand("A-1", { createdAt: null })]), ["A-3", "A-1", "A-2"]);
});

test("Sequence: 대상 바로 뒤로 간다. 막지 않는다(줄은 그대로 발권할 수 있다)", () => {
  const c = [cand("A-1", { priority: 1, after: "A-3" }), cand("A-2", { priority: 2 }), cand("A-3", { priority: 4 })];
  assert.deepEqual(fireOrderOf(c), ["A-2", "A-3", "A-1"]);
  // 사슬: A-1 after A-2, A-2 after A-3
  const chain = [cand("A-1", { priority: 1, after: "A-2" }), cand("A-2", { priority: 2, after: "A-3" }), cand("A-3", { priority: 4 })];
  assert.deepEqual(fireOrderOf(chain), ["A-3", "A-2", "A-1"]);
});

test("Sequence: 대상이 줄 밖이거나 고리면 기본 순서를 지킨다", () => {
  assert.deepEqual(fireOrderOf([cand("A-1", { priority: 1, after: "X-9" }), cand("A-2", { priority: 2 })]), ["A-1", "A-2"]);
  assert.deepEqual(fireOrderOf([cand("A-1", { priority: 1, after: "A-2" }), cand("A-2", { priority: 2, after: "A-1" })]), ["A-1", "A-2"]);
  assert.deepEqual(fireOrderOf([cand("A-1", { after: "A-1" })]), ["A-1"]);
});

let n = 0;
const tk = (key: string, o: Partial<Ticket> = {}): Ticket => ({
  key, title: `title ${key}`, state: "Backlog", stateType: "backlog", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: null, project: null, labels: [], createdAt: `2026-10-01T00:00:0${n++ % 10}Z`,
  startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], ...o,
});
const input = (tickets: Ticket[], o: Record<string, unknown> = {}) => ({
  tickets,
  candidate: (t: Ticket) => !tickets.some((x) => x.parent === t.key),
  filed: new Set<string>(),
  released: () => false,
  stageOf: () => null,
  extra: () => ({}),
  ...o,
});

// 부모 P 아래 사슬 A-1 ← A-2 ← A-3(셋 깊이), 끝난 이슈 둘, 따로 B-1(부모 없음)
const chain = () => [
  tk("P-1", { children: ["A-1", "A-2", "A-3", "A-4", "A-5"] }),
  tk("A-1", { parent: "P-1", stateType: "unstarted", state: "Todo", blocks: ["A-2"] }),
  tk("A-2", { parent: "P-1", blockedBy: ["A-1"], blocks: ["A-3"] }),
  tk("A-3", { parent: "P-1", blockedBy: ["A-2"] }),
  tk("A-4", { parent: "P-1", stateType: "completed", state: "Done" }),
  tk("A-5", { parent: "P-1", stateType: "completed", state: "Done" }),
  tk("B-1", { stateType: "unstarted", state: "Todo" }),
];

test("나무: 상위 이슈마다 그룹, 막는 이슈 밑에 막힌 이슈(세 깊이), 끝남 n/m, 끝난 이슈는 줄이 아니라 수", () => {
  const { groups } = releaseTreeOf(input(chain()));
  assert.deepEqual(groups.map((g) => g.key), ["P-1", null]);
  const p = groups[0]!;
  assert.equal(p.title, "title P-1");
  assert.deepEqual([p.done, p.total], [2, 5]);
  assert.equal(p.rows.length, 1);
  const a1 = p.rows[0]!;
  assert.equal(a1.key, "A-1");
  assert.deepEqual(a1.state, { kind: "todo" });
  assert.equal(a1.fire, "release");
  assert.equal(a1.children[0]!.key, "A-2");
  assert.deepEqual(a1.children[0]!.state, { kind: "waiting", on: ["A-1"] });
  assert.equal(a1.children[0]!.fire, null);
  assert.equal(a1.children[0]!.children[0]!.key, "A-3");
  assert.deepEqual(groups[1]!.title, "기타");
  assert.equal(groups[1]!.rows[0]!.key, "B-1");
});

test("나무: 막는 이슈가 끝나면 READY, 그 줄은 최상위로 올라온다. 막는 이슈가 없는 Backlog는 줄이 아니다", () => {
  const t = chain();
  t[1] = tk("A-1", { parent: "P-1", stateType: "completed", state: "Done", blocks: ["A-2"] });
  t.push(tk("A-9", { parent: "P-1" })); // 막는 이슈 없는 Backlog
  const p = releaseTreeOf(input(t)).groups[0]!;
  assert.deepEqual(p.rows.map((r) => r.key), ["A-2"]);
  assert.deepEqual(p.rows[0]!.state, { kind: "ready" });
  assert.equal(p.rows[0]!.fire, "fire");
  assert.equal(p.rows[0]!.children[0]!.key, "A-3");
  assert.equal(p.next, "A-2");
});

test("나무: 시작한 이슈는 단계 낱말만, 단추 없음. 이미 발권한 Todo도 단추 없음", () => {
  const t = [tk("P-1", { children: ["A-1", "A-2"] }), tk("A-1", { parent: "P-1", stateType: "started", state: "ENROUTE" }), tk("A-2", { parent: "P-1", stateType: "unstarted", state: "Todo" })];
  const g = releaseTreeOf(input(t, { stageOf: (x: Ticket) => (x.key === "A-1" ? "PR" : null), released: (k: string) => k === "A-2" })).groups[0]!;
  const by = Object.fromEntries(g.rows.map((r) => [r.key, r]));
  assert.deepEqual(by["A-1"]!.state, { kind: "stage", word: "PR" });
  assert.equal(by["A-1"]!.fire, null);
  assert.equal(by["A-2"]!.fire, null);
  assert.equal(by["A-2"]!.released, true);
  assert.equal(g.next, null);
});

test("다음 발권: 그룹마다 한 줄, 발권할 수 있는 첫 줄. 제안은 막는 이슈가 없어도 READY", () => {
  const t = [
    tk("P-1", { children: ["A-1", "A-2"] }),
    tk("A-1", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 3 }),
    tk("A-2", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 1 }),
    tk("Q-1", { parent: "P-2" }),
    tk("P-2"),
  ];
  const g = releaseTreeOf(input(t, { filed: new Set(["Q-1"]) })).groups;
  assert.equal(g.find((x) => x.key === "P-1")!.next, "A-2");
  assert.equal(g.find((x) => x.key === "P-2")!.next, "Q-1");
  // 다음 발권이 앞선 그룹이 먼저(Urgent의 A-2)
  assert.equal(g[0]!.key, "P-1");
});

test("Sequence 줄이 줄에 붙는다: 대상 뒤에 놓이고 발권은 막히지 않는다. 틀린 줄·모르는 이슈는 보이고 순서에는 쓰지 않는다", () => {
  const seq = (after: string | null, reason: string | null, problem: string | null = null) => ({ after, reason, problem });
  const t = [
    tk("P-1", { children: ["A-1", "A-2", "A-3", "A-4"] }),
    tk("A-1", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 1 }),
    tk("A-2", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 2, sequence: seq("A-1", "same files") }),
    tk("A-3", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 1, sequence: seq("X-99", "unknown") }),
    tk("A-4", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 1, sequence: seq(null, null, "Sequence 줄이 꼴이 아님") }),
  ];
  const { groups, order } = releaseTreeOf(input(t));
  assert.deepEqual(order, ["A-1", "A-3", "A-4", "A-2"]); // A-2(High)는 어차피 A-1(Urgent) 뒤라 그대로
  const by = Object.fromEntries(groups[0]!.rows.map((r) => [r.key, r]));
  assert.deepEqual(by["A-2"]!.after, { key: "A-1", reason: "same files", known: true });
  assert.equal(by["A-2"]!.fire, "release");
  assert.deepEqual(by["A-3"]!.after, { key: "X-99", reason: "unknown", known: false });
  assert.match(by["A-3"]!.sequenceProblem ?? "", /알 수 없는 이슈/);
  assert.equal(by["A-4"]!.after, null);
  assert.match(by["A-4"]!.sequenceProblem ?? "", /꼴이 아님/);
});

const holder = (flight: string, paths: string[]): Holder => ({ flight, team: "TEAM_B", airport: null, wake: "M", files: new Map(paths.map((p) => [p, "STAND"])) });

test("같은 파일: 날고 있는 이슈와, 순서에서 앞에 놓인 이슈. 자료가 없으면 아무것도 보이지 않는다", () => {
  const t = [
    tk("P-1", { children: ["A-1", "A-2", "A-3"] }),
    tk("A-1", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 1 }),
    tk("A-2", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 2 }),
    tk("A-3", { parent: "P-1", stateType: "unstarted", state: "Todo", priority: 3 }),
  ];
  const bodies = new Map<string, string | null>([
    ["A-1", "Edit `web/src/views/Release.tsx` and `server/release-run.ts`."],
    ["A-2", "Touches `web/src/views/Release.tsx`."],
    ["A-3", "Touches `docs/guide/screens.md` and `server/release-run.ts`."],
  ]);
  const files = { holders: [holder("Z-7", ["docs/guide/screens.md"])], bodies };
  const by = Object.fromEntries(releaseTreeOf(input(t, { files })).groups[0]!.rows.map((r) => [r.key, r]));
  assert.deepEqual(by["A-1"]!.sameFiles, []); // 맨 앞: 앞에 놓인 이슈도 없다
  assert.deepEqual(by["A-2"]!.sameFiles, ["A-1"]);
  assert.deepEqual(by["A-3"]!.sameFiles, ["A-1", "Z-7"]); // 날고 있는 Z-7과 앞의 A-1
  const none = releaseTreeOf(input(t, { files: { holders: [], bodies: new Map() } })).groups[0]!.rows;
  assert.ok(none.every((r) => r.sameFiles.length === 0));
  assert.ok(releaseTreeOf(input(t)).groups[0]!.rows.every((r) => r.sameFiles.length === 0));
});

test("나무: 고리(A가 B를, B가 A를 막음)도 줄을 잃지 않는다", () => {
  const t = [tk("P-1", { children: ["A-1", "A-2"] }), tk("A-1", { parent: "P-1", blockedBy: ["A-2"], blocks: ["A-2"] }), tk("A-2", { parent: "P-1", blockedBy: ["A-1"], blocks: ["A-1"] })];
  const flat = (rows: { key: string; children: unknown[] }[]): string[] => rows.flatMap((r) => [r.key, ...flat(r.children as never)]);
  assert.deepEqual(flat(releaseTreeOf(input(t)).groups[0]!.rows).sort(), ["A-1", "A-2"]);
});
