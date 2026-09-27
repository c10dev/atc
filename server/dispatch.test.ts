import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type DispatchConfig, landedOf, planDispatch, readFlightHistory, workedWhy } from "./dispatch.ts";
import type { Claim, PullRequest, Session, Snapshot, Ticket, Workspace } from "./model.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const VCDO = "/home/c10/projects/vocado_nextjs";
const WT = "/home/c10/projects/worktrees";

const session = (id: string, name: string, status: Session["status"] = "idle", repo: string | null = VCDO): Session => ({
  id, agent: "claude", name, status, pid: 1, cwd: repo ?? "/home/c10", startedAt: daysAgo(1), lastActiveAt: daysAgo(0),
  repo, workspacePath: repo,
});
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, priority: 3,
  url: null, updatedAt: daysAgo(1), project: "Beta Readiness", labels: [], createdAt: daysAgo(2), startedAt: null,
  blocks: [], blockedBy: [], related: [], parent: null, children: [], ...over,
});
const ws = (name: string, ticketKey: string | null): Workspace => ({
  path: `${WT}/${name}`, name, repo: VCDO, isMain: false, branch: null, head: "", dirty: 0, lastCommitAt: null, ticketKey,
});
const claim = (sessionId: string, wsName: string): Claim => ({
  sessionId, workspacePath: `${WT}/${wsName}`, since: daysAgo(0.1), lastAt: daysAgo(0.01), source: "hook", tool: null,
  state: "active", handedOffTo: null,
});

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    at: new Date(NOW).toISOString(), linear: { enabled: true, error: null, fetchedAt: daysAgo(0) },
    github: { enabled: true, error: null, fetchedAt: daysAgo(0) }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [], workspaces: [], tickets: [], columns: [], claims: [], handoffs: [], alerts: [], clearances: [],
    airports: [{ id: "r1", code: "VCDO", name: "vocado_nextjs", repo: VCDO }],
    ...over,
  };
}
const cfg = (over: Partial<DispatchConfig> = {}): DispatchConfig => ({ ...DEFAULT_DISPATCH_CONFIG, ...over });

test("후보 FLIGHT: 다른 운항사 라벨, 제외·매핑 없는 프로젝트, STAND 있음은 제외, 막힌 것은 HOLD_DEPARTURE", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A")],
    workspaces: [ws("vocado-voc-5", "VOC-5")],
    tickets: [
      ticket("VOC-1", { labels: ["symphony-pilot"] }),
      ticket("VOC-2", { project: "Vocado Visual System (SEED)" }),
      ticket("VOC-3", { project: "Somewhere Else" }),
      ticket("VOC-4", { project: null }),
      ticket("VOC-5"),
      ticket("VOC-6", { blockedBy: ["VOC-7"] }),
      ticket("VOC-7", { state: "In Progress", stateType: "started" }),
      ticket("VOC-8", { blockedBy: ["VOC-9", "VOC-999"] }),
      ticket("VOC-9", { state: "Done", stateType: "completed" }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(Object.fromEntries(p.excluded.map((e) => [e.flight, e.reason])), {
    "VOC-1": "라벨 symphony-pilot (다른 운항사)",
    "VOC-2": "배정 제외 프로젝트: Vocado Visual System (SEED)",
    "VOC-3": "배정 제외 프로젝트: Somewhere Else",
    "VOC-4": "프로젝트 없음",
    "VOC-5": "이미 STAND가 있음",
  });
  assert.deepEqual(p.hold, [{ flight: "VOC-6", blockedBy: ["VOC-7"] }]);
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-8"]);
});

test("AIRCRAFT: AIRBORNE·진행 중 STAND·소속 없음은 불가, PARKED와 끝난 STAND만 쥔 HOLDING은 가능, TEAM 아닌 세션은 무시", () => {
  const s = snap({
    sessions: [
      session("a", "TEAM_A", "busy"),
      session("b", "TEAM_B"),
      session("c", "TEAM_C"),
      session("d", "TEAM_D"),
      session("e", "TEAM_E", "idle", null),
      session("x", "President"),
    ],
    workspaces: [ws("vocado-voc-10", "VOC-10"), ws("vocado-voc-11", "VOC-11")],
    claims: [claim("c", "vocado-voc-10"), claim("d", "vocado-voc-11")],
    tickets: [ticket("VOC-10", { state: "In Progress", stateType: "started" }), ticket("VOC-11", { state: "Done", stateType: "completed" })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(
    p.aircraft.map((a) => `${a.callsign}:${a.available ? "Y" : "N"}:${a.reason}`),
    ["ALPHA:N:AIRBORNE", "BRAVO:Y:PARKED", "CHARLIE:N:HOLDING — VOC-10 진행 중", "DELTA:Y:HOLDING, 남은 FLIGHT 없음", "ECHO:N:소속 AIRPORT 없음"],
  );
});

test("점수 순으로 짝짓고, 팀 적합도가 있는 팀에 먼저 간다", () => {
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("d", "TEAM_D")],
    tickets: [
      ticket("VOC-20", { priority: 1, project: "Song Experience" }),
      ticket("VOC-21", { priority: 4 }),
      ticket("VOC-30", { state: "Done", stateType: "completed", project: "Song Experience" }),
    ],
  });
  const history = new Map([["d", ["VOC-30"]]]);
  const p = planDispatch(s, history, cfg(), NOW);
  assert.deepEqual(p.assign.map((a) => `${a.flight}→${a.aircraftName}`), ["VOC-20→TEAM_D", "VOC-21→TEAM_B"]);
  const top = p.assign[0].factors.find((f) => f.id === "affinity")!;
  assert.equal(top.value, 1);
  assert.equal(top.detail, "VOC-30");
  assert.ok(p.assign[0].score > p.assign[1].score);
});

test("충돌 위험: AIRBORNE FLIGHT와 연결된 FLIGHT는 점수가 깎인다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("b", "TEAM_B")],
    workspaces: [ws("vocado-voc-40", "VOC-40")],
    claims: [claim("a", "vocado-voc-40")],
    tickets: [
      ticket("VOC-40", { state: "In Progress", stateType: "started" }),
      ticket("VOC-41", { related: ["VOC-40"] }),
      ticket("VOC-42"),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.equal(p.assign[0].flight, "VOC-42");
  assert.equal(p.assign.length, 1);
});

test("AIRPORT 슬롯: 한도가 차면 더 배정하지 않는다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("b", "TEAM_B"), session("c", "TEAM_C")],
    tickets: [ticket("VOC-50"), ticket("VOC-51")],
  });
  const p = planDispatch(s, new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 2 } } }), NOW);
  assert.equal(p.assign.length, 1);
  assert.deepEqual(p.slots, [{ airport: "VCDO", airborne: 1, planned: 1, limit: 2 }]);
});

test("RELEASE: STAND 없이 기준 일수를 넘긴 In Progress, 코드 작업 프로젝트만", () => {
  const s = snap({
    workspaces: [ws("vocado-voc-63", "VOC-63")],
    tickets: [
      ticket("VOC-60", { state: "In Progress", stateType: "started", startedAt: daysAgo(5) }),
      ticket("VOC-61", { state: "In Progress", stateType: "started", startedAt: daysAgo(1) }),
      ticket("VOC-62", { state: "In Review", stateType: "started", startedAt: daysAgo(9) }),
      ticket("VOC-63", { state: "In Progress", stateType: "started", startedAt: daysAgo(9) }),
      ticket("VOC-64", { state: "In Progress", stateType: "started", startedAt: daysAgo(4), project: null }),
      ticket("VOC-65", { state: "In Progress", stateType: "started", startedAt: daysAgo(6), project: "Vocado Pre-seed IR & Pitch Deck" }),
      ticket("VOC-66", { state: "In Progress", stateType: "started", startedAt: daysAgo(4), project: "Song Experience" }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(p.release.map((r) => `${r.flight}:${r.days}:${r.airport}`), ["VOC-60:5:VCDO", "VOC-66:4:VCDO"]);
});

test("상위 이슈: children이나 남의 parent로 지목된 FLIGHT는 ASSIGN·RELEASE 양쪽에서 뺀다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A")],
    tickets: [
      ticket("VOC-80", { children: ["VOC-81", "VOC-82"] }), // children 보유 → 상위
      ticket("VOC-81", { parent: "VOC-80" }), // 하위 → 후보
      ticket("VOC-82", { parent: "VOC-80" }),
      ticket("VOC-83", { parent: "VOC-80", state: "In Progress", stateType: "started", startedAt: daysAgo(9) }),
      ticket("VOC-80", { state: "In Progress", stateType: "started", startedAt: daysAgo(40) }), // 상위라 RELEASE 아님
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.equal(p.excluded.find((e) => e.flight === "VOC-80")?.reason, "상위 이슈 — 하위 3건을 묶음");
  assert.deepEqual(p.release.map((r) => r.flight), ["VOC-83"]);
  assert.equal(p.assign[0].flight, "VOC-81");
  // RELEASE에서 빠진 상위 이슈는 조용히 사라지지 않고 제외 목록에 이유가 남는다
  assert.ok(p.excluded.some((e) => e.flight === "VOC-80"));
});

test("운항 이력: 청구 기록 파일 이름에서 FLIGHT key를 뽑는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-hist-"));
  mkdirSync(join(dir, "s1"));
  for (const p of [`${WT}/vocado-voc-191-anon`, `${WT}/vocado-voc185-song`, `${WT}/tennis-character`]) {
    writeFileSync(join(dir, "s1", encodeURIComponent(p) + ".json"), "{}");
  }
  assert.deepEqual([...readFlightHistory("VOC", dir)], [["s1", ["VOC-185", "VOC-191"]]]);
});

test("예약: 진행 중인 제안이 잡은 AIRCRAFT·FLIGHT는 새 짝에서 빠진다", () => {
  const s = snap({ sessions: [session("b", "TEAM_B"), session("d", "TEAM_D")], tickets: [ticket("VOC-70", { priority: 1 }), ticket("VOC-71")] });
  const reserved = { aircraft: new Map([["b", "D-0009"]]), flights: new Map([["VOC-70", "D-0009"]]) };
  const p = planDispatch(s, new Map(), cfg(), NOW, reserved);
  assert.deepEqual(p.assign.map((a) => `${a.flight}→${a.aircraftName}`), ["VOC-71→TEAM_D"]);
  assert.equal(p.aircraft.find((a) => a.id === "b")?.reserved, "D-0009");
  assert.deepEqual(p.excluded.find((e) => e.flight === "VOC-70"), { flight: "VOC-70", reason: "진행 중인 제안 D-0009" });
});

test("HELD 제안이 잡은 FLIGHT는 다시 제안하지 않되 AIRCRAFT는 다른 FLIGHT에 쓸 수 있다", () => {
  const s = snap({ sessions: [session("a", "TEAM_A"), session("b", "TEAM_B")], tickets: [ticket("VOC-72", { priority: 1 }), ticket("VOC-73")] });
  // D-0002가 VOC-72를 HOLD로 잡아 둠 — AIRCRAFT는 잡지 않았다
  const reserved = { aircraft: new Map(), flights: new Map([["VOC-72", "D-0002"]]), held: new Map([["VOC-72", "D-0002 — 선행 FLIGHT 대기"]]) };
  const p = planDispatch(s, new Map(), cfg(), NOW, reserved);
  assert.equal(p.assign.find((a) => a.flight === "VOC-72"), undefined);
  assert.deepEqual(p.excluded.find((e) => e.flight === "VOC-72"), { flight: "VOC-72", reason: "HOLD D-0002 — 선행 FLIGHT 대기" });
  // 잡혀 있지 않은 AIRCRAFT 두 대가 남은 FLIGHT 하나를 두고 경쟁한다
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-73"]);
  assert.equal(p.aircraft.filter((a) => a.available).length, 2);
});

test("우선순위 없는 FLIGHT는 사람이 정할 때까지 ASSIGN 후보가 아니다", () => {
  const s = snap({ sessions: [session("b", "TEAM_B")], tickets: [ticket("VOC-177", { priority: 0 }), ticket("VOC-178")] });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-178"]);
  assert.deepEqual(p.excluded.find((e) => e.flight === "VOC-177"), { flight: "VOC-177", reason: "우선순위 없음 — 사람이 정할 때까지 배정하지 않음" });
});

test("TAIL ASSIGNMENT(tail:TEAM_X): 지정 팀에만 제안하고, 그 팀이 못 받으면 다른 팀에 주지 않는다", () => {
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("d", "TEAM_D"), session("e", "TEAM_E", "busy")],
    tickets: [
      ticket("VOC-80", { priority: 1, labels: ["tail:TEAM_D"] }),
      ticket("VOC-81", { priority: 1, labels: ["tail:TEAM_E"] }),
      ticket("VOC-82", { labels: ["Tail: team_z"] }),
      ticket("VOC-83"),
    ],
  });
  const p = planDispatch(s, new Map([["b", ["VOC-80"]]]), cfg(), NOW);
  // TEAM_B가 VOC-80 이력(적합도)이 있어도 tail이 TEAM_D라 TEAM_D에게 간다
  assert.deepEqual(p.assign.map((a) => `${a.flight}→${a.aircraftName}`).sort(), ["VOC-80→TEAM_D", "VOC-83→TEAM_B"]);
  const why = Object.fromEntries(p.excluded.map((e) => [e.flight, e.reason]));
  assert.equal(why["VOC-81"], "tail:TEAM_E — 지정 팀 배정 불가(TEAM_E AIRBORNE)");
  assert.equal(why["VOC-82"], "tail:TEAM_Z — 그 TEAM 세션이 없음");
});

test("tailsOf: tail:과 옛 lane:을 함께 읽고, 대소문자·공백을 가리지 않으며, 다른 라벨은 무시한다", async () => {
  const { tailsOf } = await import("./dispatch.ts");
  assert.deepEqual([...tailsOf({ labels: ["tail:TEAM_E", "Lane: team_b", "symphony-pilot", "tail:"] })], ["TEAM_E", "TEAM_B"]);
});

test("옛 lane: 라벨은 계속 지키되, 제외 사유에 tail:로 바꾸라고 적는다", () => {
  const s = snap({ sessions: [session("b", "TEAM_B"), session("e", "TEAM_E", "busy")], tickets: [ticket("VOC-90", { labels: ["lane:TEAM_E"] })] });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(p.assign, []);
  assert.equal(p.excluded.find((e) => e.flight === "VOC-90")?.reason, "tail:TEAM_E (옛 lane: 라벨 — tail:로 바꿀 것) — 지정 팀 배정 불가(TEAM_E AIRBORNE)");
});

test("FLIGHT 분류: rating:SEC·Risk 라벨은 SEC 자격이 있는 팀에만, 없으면 사유와 함께 제외", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_E: { ratings: ["SEC", "DATA"] as ("SEC" | "DATA")[] } } };
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("e", "TEAM_E")],
    tickets: [ticket("VOC-100", { priority: 1, labels: ["rating:SEC"] }), ticket("VOC-101", { labels: ["Risk:Migration"] }), ticket("VOC-102")],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, fleet);
  assert.deepEqual(p.assign.map((a) => `${a.flight}→${a.aircraftName}`).sort(), ["VOC-100→TEAM_E", "VOC-102→TEAM_B"]);
  // 기본 FLEET에는 SEC 팀이 없다
  const none = planDispatch(s, new Map(), cfg(), NOW);
  assert.equal(none.excluded.find((e) => e.flight === "VOC-100")?.reason, "rating:SEC — 그 TYPE RATING을 가진 AIRCRAFT 없음 (FLEET 탭에서 지정)");
  assert.equal(none.excluded.find((e) => e.flight === "VOC-101")?.reason, "rating:SEC — 그 TYPE RATING을 가진 AIRCRAFT 없음 (FLEET 탭에서 지정)");
});

test("FLIGHT 분류: BUILD는 구현할 CREW가 있어야 하고, tail 팀에 자격이 없으면 그 이유로 제외", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const flashOnly = [{ position: "helper", agent: "flash-helper", limits: ["no BUILD", "no SEC"] }];
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_B: { complement: flashOnly }, TEAM_D: { ratings: ["DOCS"] as "DOCS"[] } } };
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("d", "TEAM_D")],
    tickets: [
      ticket("VOC-110", { priority: 1 }),
      ticket("VOC-111", { labels: ["type:SURVEY"] }),
      ticket("VOC-112", { labels: ["tail:TEAM_D", "rating:SEC"] }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, fleet);
  // flash-helper만 태운 TEAM_B는 BUILD를 못 해서 VOC-110은 TEAM_D, SURVEY는 TEAM_B가 받는다
  assert.deepEqual(p.assign.map((a) => `${a.flight}→${a.aircraftName}`).sort(), ["VOC-110→TEAM_D", "VOC-111→TEAM_B"]);
  assert.equal(
    p.excluded.find((e) => e.flight === "VOC-112")?.reason,
    "tail:TEAM_D — rating:SEC — 그 TYPE RATING을 가진 AIRCRAFT 없음 (FLEET 탭에서 지정)",
  );
});

test("WAKE CATEGORY: J는 배정하지 않고, 슬롯은 WAKE로 센다(H는 2)", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A"), session("b", "TEAM_B"), session("c", "TEAM_C")],
    tickets: [ticket("VOC-120", { priority: 1, labels: ["wake:H"] }), ticket("VOC-121", { labels: ["wake:J"] }), ticket("VOC-122", { priority: 2 }), ticket("VOC-123", { priority: 3, labels: ["wake:L"] })],
  });
  const p = planDispatch(s, new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 3 } } }), NOW);
  assert.equal(p.excluded.find((e) => e.flight === "VOC-121")?.reason, "wake:J — 너무 커서 배정하지 않음, 나눠야 함(SPLIT)");
  // 한도 3: H(2) + M(1) = 3 → L(0.5)은 자리가 없다
  assert.deepEqual(p.assign.map((a) => a.flight).sort(), ["VOC-120", "VOC-122"]);
  assert.deepEqual(p.slots, [{ airport: "VCDO", airborne: 0, planned: 3, limit: 3 }]);
});

test("ROUTE: 담당 프로젝트면 점수가 오른다", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_D: { routes: ["Song Experience"] } } };
  const s = snap({ sessions: [session("b", "TEAM_B"), session("d", "TEAM_D")], tickets: [ticket("VOC-130", { project: "Song Experience" })] });
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, fleet);
  assert.equal(p.assign[0].aircraftName, "TEAM_D");
  assert.deepEqual(p.assign[0].factors.find((f) => f.id === "route"), { id: "route", label: "ROUTE", value: 1, weight: 1, points: 1, detail: "Song Experience 담당" });
});

test("AOG·RETIRED AIRCRAFT는 배정하지 않는다", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_B: { aog: { reason: "컨텍스트 정리", until: "2026-09-27", at: "t" } }, TEAM_C: { retired: { at: "t" } } } };
  const s = snap({ sessions: [session("b", "TEAM_B"), session("c", "TEAM_C"), session("d", "TEAM_D")], tickets: [ticket("VOC-140")] });
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, fleet);
  assert.deepEqual(p.assign.map((a) => a.aircraftName), ["TEAM_D"]);
  assert.deepEqual(
    p.aircraft.map((a) => `${a.name}:${a.reason}`),
    ["TEAM_B:AOG — 컨텍스트 정리 (~2026-09-27)", "TEAM_C:RETIRED", "TEAM_D:PARKED"],
  );
});

const logged = (flight: string | null, number: number, reverted = false) => ({ flight, reverted, pr: { repo: "chaehy5665/vocado_nextjs", number, url: "", title: "" } });
const pull = (number: number, ticketKey: string | null, draft = false) =>
  ({ repo: VCDO, number, title: "", url: "", branch: "", head: "", base: "main", ticketKey, standPath: null, draft, landing: "APPROACH", blocks: [], readyAt: null, createdAt: daysAgo(0) }) as PullRequest;

test("LOGBOOK에 ARRIVED한 FLIGHT는 Linear가 Todo여도 제외하고, 되돌린 것은 다시 후보가 된다", () => {
  const landed = landedOf([logged("VOC-1", 400), logged("VOC-2", 401, true), logged(null, 402), logged("VOC-1", 399)]);
  assert.deepEqual([...landed], [["VOC-1", "vocado_nextjs#400"]]);
  const s = snap({ sessions: [session("a", "TEAM_A")], tickets: [ticket("VOC-1"), ticket("VOC-2")] });
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, undefined, landed);
  assert.deepEqual(p.excluded, [{ flight: "VOC-1", reason: "이미 완료됨 — PR vocado_nextjs#400 머지됨(LOGBOOK)" }]);
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-2"]);
});

test("열린 PR(Draft 포함)이 있는 FLIGHT는 제외한다. 진행 중인 제안보다 먼저 봐서 이 사유가 보인다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A")],
    tickets: [ticket("VOC-1"), ticket("VOC-2"), ticket("VOC-3")],
    pulls: [pull(410, "VOC-1"), pull(411, "VOC-2", true), pull(412, null)],
  });
  const reserved = { aircraft: new Map(), flights: new Map([["VOC-2", "D-0009"]]), held: new Map() };
  const p = planDispatch(s, new Map(), cfg(), NOW, reserved);
  assert.deepEqual(Object.fromEntries(p.excluded.map((e) => [e.flight, e.reason])), { "VOC-1": "열린 PR #410 있음", "VOC-2": "열린 PR #411 있음" });
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-3"]);
  // LOGBOOK이 열린 PR보다 먼저다
  assert.equal(workedWhy("VOC-1", landedOf([logged("VOC-1", 400)]), [pull(410, "VOC-1")]), "이미 완료됨 — PR vocado_nextjs#400 머지됨(LOGBOOK)");
  assert.equal(workedWhy("VOC-9", new Map(), []), null);
});
