import assert from "node:assert/strict";
import { test } from "node:test";
import { type FollowRow, FOLLOW_STAGES, type FollowStage, type FollowStuck } from "./follow.ts";
import { ageText, BLOCK_HOLDER, type FlowInput, type FlowPullIn, flowViewOf, holderOfBlock, holderOfPull, STAGE_OF, TODO_LINES } from "./home-flow.ts";
import { LANDING_BLOCK_CODES, type LandingBlockCode } from "./model.ts";
import type { QueueItem } from "./supervisor-queue.ts";

// HOME 흐름판의 판정(ATC-499, docs/home-flow.md 3.2–3.6·4.2)
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const row = (key: string, current: FollowStage, ageMin: number, over: Partial<FollowRow> & { stuckCode?: FollowStuck["code"] } = {}): FollowRow => {
  const { stuckCode, ...rest } = over;
  const stages = Object.fromEntries(FOLLOW_STAGES.map((s) => [s, { done: FOLLOW_STAGES.indexOf(s) <= FOLLOW_STAGES.indexOf(current), at: s === current ? ago(ageMin) : null, na: false }])) as FollowRow["stages"];
  return {
    key, title: `${key} title`, url: null, state: "In Progress", stateType: "started", unreadable: false, stages, current, finished: false, now: "", progress: null, issues: [], history: [],
    proposal: null, proposalInfo: null, standFree: false, tail: false, stuck: stuckCode ? { stage: current, code: stuckCode, text: `${stuckCode} text`, since: ago(ageMin) } : null,
    next: null, ready: false, goAround: null, reverted: null, arrivedAt: null, ...rest,
  } as FollowRow;
};
const flight = (r: FollowRow, airport = "ATCC", blockedBy: string[] = []) => ({ row: r, airport, blockedBy });
const pr = (number: number, ticketKey: string, over: Partial<FlowPullIn> = {}): FlowPullIn =>
  ({ repo: "/p/atc", number, head: `h${number}`, ticketKey, createdAt: ago(100), readyAt: null, draft: false, landing: "APPROACH", blocks: [], humanCheck: null, ...over }) as FlowPullIn;
const block = (code: LandingBlockCode) => ({ code, text: `${code} text`, en: code });
const item = (kind: QueueItem["kind"], key: string, over: Partial<QueueItem> = {}): QueueItem =>
  ({ kind, key, since: ago(30), title: `t ${key}`, hash: "#home", primary: { action: "open", label: "열기" }, ...over }) as QueueItem;

const AIRPORTS = [{ code: "ATCC", name: "atc" }, { code: "VCDO", name: "vocado" }];
const input = (over: Partial<FlowInput> = {}): FlowInput => ({ now: NOW, airports: AIRPORTS, rows: [], pulls: [], landings: [], stops: [], mainRed: [], queue: [], ...over });
const landings = (airport: string, ...agos: number[]) => agos.map((m) => ({ airport, at: ago(m) }));
const airport = (v: ReturnType<typeof flowViewOf>, code: string) => v.airports.find((a) => a.code === code)!;
const cell = (v: ReturnType<typeof flowViewOf>, code: string, stage: string) => airport(v, code).cells.find((c) => c.stage === stage)!;

test("판정: 정상 — 막힌 FLIGHT가 없으면 한 줄 숫자만, 칸은 단계별 수와 가장 오랜 나이", () => {
  const v = flowViewOf(input({ rows: [flight(row("ATC-1", "todo", 5)), flight(row("ATC-2", "pr", 20), "ATCC")], pulls: [pr(1, "ATC-2", { blocks: [block("checks-pending")] })], landings: landings("ATCC", 10, 90) }));
  assert.equal(v.verdict, "normal");
  assert.equal(v.line, "흐름 정상 · 지난 6h 착륙 2 · 비행 중 1");
  assert.equal(v.holder, undefined);
  assert.equal(v.worst, undefined);
  assert.deepEqual([cell(v, "ATCC", "queue").count, cell(v, "ATCC", "off").count, cell(v, "ATCC", "off").oldestMin, cell(v, "ATCC", "out").count], [1, 1, 20, 0]);
  assert.equal(airport(v, "ATCC").sinceOnMin, 10);
  assert.equal(airport(v, "ATCC").landings12h.reduce((a, b) => a + b, 0), 2);
  assert.equal(flowViewOf(input()).line, "흐름 정상 · 지난 6h 착륙 0 · 비행 중 없음");
});

test("판정: 정체 — 한도를 넘은 FLIGHT가 하나라도 있으면(follow.md 3.3), 단계·수·최장·주체", () => {
  const v = flowViewOf(input({ rows: [flight(row("ATC-1", "sent", 25, { stuckCode: "sent-no-readback" })), flight(row("ATC-2", "sent", 5))], landings: landings("ATCC", 3) }));
  assert.equal(airport(v, "ATCC").verdict, "congested");
  assert.equal(v.verdict, "congested");
  assert.equal(v.holder, "AIRCRAFT");
  assert.equal(v.worst, "ATCC");
  assert.equal(v.line, "정체 · ATCC 출발 2건 · 최장 25m · 팀이 멈춤");
  assert.equal(cell(v, "ATCC", "out").tone, "caution");
});

test("판정: 막힘 — ground stop, main CI 빨강, 기준을 넘은 착륙 없음(시스템이 움직일 일이 있을 때만)", () => {
  const work = [flight(row("ATC-1", "pr", 90), "VCDO")];
  const gs = flowViewOf(input({ stops: [{ airport: "ATCC", text: "main 깨짐" }] }));
  assert.equal(airport(gs, "ATCC").verdict, "stopped");
  assert.match(airport(gs, "ATCC").reason!, /ground stop · main 깨짐/);
  const red = flowViewOf(input({ mainRed: ["VCDO"] }));
  assert.equal(airport(red, "VCDO").verdict, "stopped");
  assert.equal(airport(red, "VCDO").holder, "EXTERNAL");
  // 착륙 없음: 기준 158분(입력), 마지막 착륙 300분 전, 움직일 일(PR의 CI 대기 = EXTERNAL)이 있다
  const gap = flowViewOf(input({ rows: work, pulls: [pr(1, "ATC-1", { blocks: [block("checks-pending")] })], landings: landings("VCDO", 300), thresholds: { VCDO: 158 } }));
  assert.equal(airport(gap, "VCDO").verdict, "stopped");
  assert.equal(airport(gap, "VCDO").reason, "착륙 없음 5h (기준 158m) · 외부 요인");
  assert.equal(gap.line, "막힘 · VCDO 착륙 없음 5h (기준 158m) · 외부 요인");
  // 일이 없으면 막힘이 아니다(조용한 AIRPORT)
  assert.equal(airport(flowViewOf(input({ landings: landings("VCDO", 300), thresholds: { VCDO: 158 } })), "VCDO").verdict, "normal");
  // 기준 안이면 정상, 기준은 floor 30분 밑으로 내려가지 않는다, 기록이 없으면 규칙이 없다
  assert.equal(airport(flowViewOf(input({ rows: work, pulls: [pr(1, "ATC-1", { blocks: [block("checks-pending")] })], landings: landings("VCDO", 100), thresholds: { VCDO: 158 } })), "VCDO").verdict, "normal");
  const low = flowViewOf(input({ rows: work, pulls: [pr(1, "ATC-1", { blocks: [block("checks-pending")] })], landings: landings("VCDO", 40), thresholds: { VCDO: 5 } }));
  assert.equal(airport(low, "VCDO").thresholdMin, 30);
  assert.equal(airport(low, "VCDO").verdict, "stopped");
  assert.equal(airport(flowViewOf(input({ rows: work, pulls: [pr(1, "ATC-1", { blocks: [block("checks-pending")] })] })), "VCDO").verdict, "normal");
});

test("판정: 가장 나쁜 AIRPORT가 이긴다(막힘 > 정체 > 정상, 같으면 더 오래 기다린 쪽)", () => {
  const rows = [flight(row("ATC-1", "sent", 25, { stuckCode: "sent-no-readback" }), "ATCC"), flight(row("VOC-1", "sent", 80, { stuckCode: "sent-no-readback" }), "VCDO")];
  const two = flowViewOf(input({ rows, landings: [...landings("ATCC", 2), ...landings("VCDO", 2)] }));
  assert.equal(two.worst, "VCDO"); // 둘 다 정체, VCDO가 더 오래
  const stopped = flowViewOf(input({ rows, landings: [...landings("ATCC", 2), ...landings("VCDO", 2)], stops: [{ airport: "ATCC", text: "수동" }] }));
  assert.equal(stopped.verdict, "stopped");
  assert.equal(stopped.worst, "ATCC");
  assert.match(stopped.line, /^막힘 · ATCC ground stop/);
});

test("SUPERVISOR 제외: SUPERVISOR가 쥔 PR은 막힘을 만들지 않고 SUPERVISOR 주체의 정체가 된다", () => {
  // user 등급 PR 8건이 CLEARED로 머지를 기다린다. 마지막 착륙은 기준보다 오래지만 시스템이 움직일 일은 없다
  const rows = Array.from({ length: 8 }, (_, i) => flight(row(`ATC-${i + 1}`, "ci", 100 + i * 40, { stuckCode: "landing-wait" })));
  const pulls = rows.map((r, i) => pr(i + 1, r.row.key, { landing: "CLEARED", landBy: "supervisor" }));
  const v = flowViewOf(input({ rows, pulls, landings: landings("ATCC", 200) }));
  assert.equal(airport(v, "ATCC").verdict, "congested");
  assert.equal(v.verdict, "congested");
  assert.equal(v.holder, "SUPERVISOR");
  assert.equal(cell(v, "ATCC", "cleared").holder, "SUPERVISOR");
  assert.match(v.line, /^정체 · ATCC 착륙 대기 8건 · 최장 /);
  assert.match(v.line, /SUPERVISOR 머지 대기$/);
  // SUPERVISOR 몫이 아닌 일이 하나라도 같이 있으면(AIRCRAFT 몫) 같은 조건에서 막힘이다
  const mixed = flowViewOf(input({ rows: [...rows, flight(row("ATC-20", "readback", 50), "ATCC")], pulls, landings: landings("ATCC", 200) }));
  assert.equal(airport(mixed, "ATCC").verdict, "stopped");
  assert.equal(airport(mixed, "ATCC").holder, "AIRCRAFT");
});

test("주체: SUPERVISOR·AIRCRAFT·ATC·EXTERNAL — 단계와 막힘 코드와 PR에서 정한다", () => {
  const v = flowViewOf(input({
    rows: [
      flight(row("ATC-1", "todo", 40, { stuckCode: "todo-no-proposal" })), // ATC: DISPATCH가 제안하지 않음
      flight(row("ATC-2", "readback", 30, { stuckCode: "no-pr" })), // AIRCRAFT
      flight(row("ATC-3", "pr", 30)), // PR의 checks-pending: EXTERNAL
      flight(row("ATC-4", "ci", 90, { stuckCode: "landing-wait" })), // CLEARED + supervisor 머지
      flight(row("ATC-5", "landed", 40, { stuckCode: "landed-not-deployed" })), // ATC: RTS
    ],
    pulls: [pr(3, "ATC-3", { blocks: [block("checks-pending")] }), pr(4, "ATC-4", { landing: "CLEARED", landBy: "supervisor" })],
  }));
  const holder = (stage: string) => cell(v, "ATCC", stage).holder;
  assert.deepEqual(["queue", "out", "off", "cleared", "in"].map(holder), ["ATC", "AIRCRAFT", undefined, "SUPERVISOR", "ATC"]); // off 칸은 막힌 FLIGHT가 없어 칸 주체가 없다
  const flights = Object.fromEntries(v.airports[0]!.cells.flatMap((c) => c.flights.map((f) => [f.key, f])));
  assert.equal(flights["ATC-3"]!.stuck, false);
  assert.equal(flights["ATC-1"]!.holder, "ATC");
  // HUMAN CHECK 대기 PR과 FOLLOW의 merge 다음 할 일도 SUPERVISOR
  assert.equal(holderOfPull(pr(9, "ATC-9", { humanCheck: { required: true, state: "pending" } as never })).holder, "SUPERVISOR");
  assert.equal(holderOfPull(pr(9, "ATC-9", { landBy: "holder" })).holder, "AIRCRAFT");
  assert.equal(holderOfPull(pr(9, "ATC-9", { landBy: "mcc" })).holder, "ATC");
});

test("주체: 한 칸에 주체가 여럿이면 가장 오래 막힌 FLIGHT의 주체", () => {
  const v = flowViewOf(input({
    rows: [flight(row("ATC-1", "pr", 50, { stuckCode: "pr-not-cleared" })), flight(row("ATC-2", "pr", 200, { stuckCode: "pr-not-cleared" })), flight(row("ATC-3", "pr", 500))],
    pulls: [pr(1, "ATC-1", { blocks: [block("checks-failed")] }), pr(2, "ATC-2", { blocks: [block("no-review")] }), pr(3, "ATC-3", { blocks: [block("checks-failed")] })],
  }));
  const c = cell(v, "ATCC", "off");
  assert.equal(c.holder, "EXTERNAL"); // ATC-2(200분, 막힘)가 가장 오래 막혔다. ATC-3은 더 오래됐어도 한도 안이다
  assert.equal(c.stuck, 2);
  assert.equal(c.oldestMin, 500);
});

test("주체: 막는 FLIGHT의 주체를 물려받고 칸이 막는 FLIGHT를 이름으로 말한다", () => {
  const rows = [flight(row("VOC-239", "pr", 1150, { stuckCode: "pr-not-cleared" }), "VCDO"), ...Array.from({ length: 15 }, (_, i) => flight(row(`VOC-${240 + i}`, "todo", 1000 - i, {}), "VCDO", ["VOC-239"])), flight(row("VOC-361", "todo", 25), "VCDO")];
  const v = flowViewOf(input({ rows, pulls: [pr(499, "VOC-239", { blocks: [block("no-review")] })], landings: landings("VCDO", 300), thresholds: { VCDO: 158 } }));
  const q = cell(v, "VCDO", "queue");
  assert.equal(q.note, "VOC-239에 막힘 15");
  assert.equal(q.holder, "EXTERNAL");
  assert.equal(q.stuck, 15);
  const inherited = q.flights.find((f) => f.key === "VOC-240")!;
  assert.equal(inherited.holder, "EXTERNAL");
  assert.equal(inherited.why, "VOC-239에 막힘");
  assert.equal(q.flights.find((f) => f.key === "VOC-361")!.stuck, false);
  assert.equal(airport(v, "VCDO").verdict, "stopped"); // 외부가 쥔 일이 있고 착륙이 없다
  // 막는 FLIGHT가 SUPERVISOR 몫이면 막힌 줄도 SUPERVISOR: 막힘의 근거가 되지 않는다
  const sup = flowViewOf(input({ rows: [flight(row("ATC-1", "ci", 90, { stuckCode: "landing-wait" })), flight(row("ATC-2", "todo", 80), "ATCC", ["ATC-1"])], pulls: [pr(1, "ATC-1", { landing: "CLEARED", landBy: "supervisor" })], landings: landings("ATCC", 200) }));
  assert.equal(cell(sup, "ATCC", "queue").holder, "SUPERVISOR");
  assert.equal(airport(sup, "ATCC").verdict, "congested");
});

test("PR 막힘 코드 표: 모든 코드가 있고, 없는 코드는 ATC(분류 놓침)로 센다", () => {
  const missing = LANDING_BLOCK_CODES.filter((c) => !(c in BLOCK_HOLDER));
  assert.deepEqual(missing, [], `주체 표에 없는 막힘 코드: ${missing.join(", ")}`);
  assert.equal(Object.keys(BLOCK_HOLDER).length, LANDING_BLOCK_CODES.length);
  for (const c of LANDING_BLOCK_CODES) assert.deepEqual(holderOfBlock(c), { holder: BLOCK_HOLDER[c], miss: false });
  assert.deepEqual(holderOfBlock("brand-new-code"), { holder: "ATC", miss: true });
  // 진짜 PR의 모든 막힘 코드가 표에 닿는다
  const v = flowViewOf(input({ rows: [flight(row("ATC-1", "pr", 90, { stuckCode: "pr-not-cleared" }))], pulls: [pr(1, "ATC-1", { blocks: [{ code: "brand-new-code" as never, text: "x", en: "x" }] })] }));
  assert.equal(cell(v, "ATCC", "off").holder, "ATC");
  assert.equal(Object.keys(STAGE_OF).length, FOLLOW_STAGES.length); // 모든 follow 단계가 칸에 든다
});

test("할 일: 같은 종류·같은 필요는 한 묶음, 순서는 WARNING → SUPERVISOR가 쥔 막힘 → CAUTION → 나머지(오래된 것이 먼저)", () => {
  const rows = [flight(row("ATC-1", "ci", 100, { stuckCode: "landing-wait" })), flight(row("ATC-2", "sent", 40, { stuckCode: "sent-no-readback" }))];
  const pulls = [pr(1, "ATC-1", { landing: "CLEARED", landBy: "supervisor" })];
  const queue = [
    item("BACKLOG", "ATC-493", { since: ago(30), primary: { action: "open", label: "RELEASE" } }),
    item("BACKLOG", "ATC-494", { since: ago(20), primary: { action: "open", label: "RELEASE" } }),
    item("STUCK", "ATC-2", { since: ago(40), flight: "ATC-2", need: "READBACK 없음" }), // 팀이 쥔 막힘: CAUTION 몫
    item("LANDING", "atc#1@h1", { since: null, primary: { action: "open", label: "PR 열기" } }), // PR h1: SUPERVISOR가 쥔 막힘, since는 PR에서
    item("ALERT", "limit", { level: "warning", since: ago(95), need: "ACCOUNT LIMIT" }),
    item("ALERT", "slow", { level: "caution", since: ago(10) }),
    item("UPDATE", "9f2c", { since: ago(5) }),
  ];
  const v = flowViewOf(input({ rows, pulls, queue }));
  assert.deepEqual(v.todo.map((t) => t.key), ["ALERT/limit", "LANDING/atc#1@h1", "STUCK/ATC-2", "ALERT/slow", "BACKLOG/ATC-493", "BACKLOG/ATC-494", "UPDATE/9f2c"]);
  assert.deepEqual(v.todo.map((t) => t.tone), ["warning", "caution", "caution", "caution", null, null, null]);
  assert.equal(v.todo[0]!.kind, "WARNING");
  assert.equal(v.todo[3]!.kind, "CAUTION");
  assert.equal(v.todo[1]!.ageMin, 100); // LANDING의 나이는 PR이 생긴 때부터
  const backlog = v.todo.filter((t) => t.kind === "BACKLOG");
  assert.deepEqual(backlog.map((t) => [t.group, t.groupNeed]), [["BACKLOG/RELEASE", "발권하거나 버리기"], ["BACKLOG/RELEASE", "발권하거나 버리기"]]);
  assert.equal(v.todo.find((t) => t.kind === "UPDATE")!.group, undefined);
  const group = v.todoLines.find((l) => l.type === "group");
  assert.equal(group?.type === "group" && group.count, 2);
  assert.equal(v.todoLines.length, TODO_LINES); // 7건이 묶음 뒤 6줄, 5줄만 보인다
  assert.deepEqual(v.todoRest, { count: 1, text: "나머지 1건 UPDATE 1" });
});

test("할 일: 묶은 뒤 5줄만 보이고 나머지는 `나머지 n건` 한 줄로 접는다", () => {
  const queue = [
    ...Array.from({ length: 8 }, (_, i) => item("LANDING", `atc#${i}@h${i}`, { since: ago(300 - i), primary: { action: "open", label: "PR 열기" } })),
    ...["a", "b", "c", "d"].map((k, i) => item("PROPOSAL", `R-${k}`, { since: ago(100 - i), primary: { action: "approve", label: `승인 ${k}` } })),
    item("BACKLOG", "ATC-9", { since: ago(5) }),
    item("BACKLOG", "ATC-8", { since: ago(4) }),
    item("UPDATE", "u1", { since: ago(3) }),
  ];
  const v = flowViewOf(input({ queue }));
  assert.equal(v.todo.length, 15);
  assert.equal(TODO_LINES, 5);
  // LANDING 8건이 한 줄, 승인 4줄(필요가 달라 각각), BACKLOG 한 묶음, UPDATE: 7줄 가운데 5줄만
  assert.equal(v.todoLines.length, TODO_LINES);
  assert.deepEqual(v.todoLines.map((l) => (l.type === "group" ? `${l.kind}×${l.count}` : l.item.kind)), ["LANDING×8", "PROPOSAL", "PROPOSAL", "PROPOSAL", "PROPOSAL"]);
  assert.deepEqual(v.todoRest, { count: 3, text: "나머지 3건 BACKLOG 2 · UPDATE 1" });
});

test("칸: FLIGHT가 모두 할 일 목록에 있으면 수와 열 묶음만, 일부만 있으면 줄은 남기고 가리키는 key를 단다", () => {
  const rows = [flight(row("ATC-1", "ci", 100, { stuckCode: "landing-wait" })), flight(row("ATC-2", "ci", 90, { stuckCode: "landing-wait" }))];
  const pulls = [pr(1, "ATC-1", { landing: "CLEARED", landBy: "supervisor" }), pr(2, "ATC-2", { landing: "CLEARED", landBy: "supervisor" })];
  const land = (n: number) => item("LANDING", `atc#${n}@h${n}`, { since: null, primary: { action: "open", label: "PR 열기" } });
  const all = flowViewOf(input({ rows, pulls, queue: [land(1), land(2)] }));
  const c = cell(all, "ATCC", "cleared");
  assert.equal(c.count, 2);
  assert.deepEqual(c.flights, []);
  assert.equal(c.todoGroup, "LANDING/PR 열기");
  const one = flowViewOf(input({ rows, pulls, queue: [land(1)] }));
  const c1 = cell(one, "ATCC", "cleared");
  assert.equal(c1.todoGroup, undefined);
  assert.deepEqual(c1.flights.map((f) => [f.key, f.todo]), [["ATC-1", "LANDING/atc#1@h1"], ["ATC-2", undefined]]);
});

test("나이 글: 한 단위, 3시간 안은 분", () => {
  assert.deepEqual([0, 35, 179, 180, 360, 2880].map(ageText), ["0m", "35m", "179m", "3h", "6h", "2d"]);
  assert.equal(ageText(null), "—");
});

test("입력이 비어도 모양은 같다: AIRPORT마다 다섯 칸, 마지막 착륙 없음", () => {
  const v = flowViewOf(input());
  assert.equal(v.airports.length, 2);
  assert.ok(v.airports.every((a) => a.cells.length === 5 && a.landings12h.length === 12 && a.sinceOnMin === null));
  assert.deepEqual(v.todo, []);
  assert.equal(v.todoRest, null);
  assert.equal(v.sinceLook, undefined);
  assert.deepEqual(flowViewOf(input({ sinceLook: { since: ago(140), released: 3, landed: 12, deployed: 4 } })).sinceLook, { sinceMin: 140, released: 3, landed: 12, deployed: 4 });
});
