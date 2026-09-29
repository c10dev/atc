import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type DispatchConfig, flightHeldWhy, landedOf, pairBlockedWhy, planDispatch, readFlightHistory, workedWhy } from "./dispatch.ts";
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
  key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3,
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

test("후보 FLIGHT: Linear에서 다른 사람·agent가 맡은 것(takenBy)은 제외, tail:이 있어도", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A")],
    tickets: [
      ticket("VOC-1", { assignee: "me", takenBy: "codex" }),
      ticket("VOC-2", { assignee: "kim", takenBy: "kim", labels: ["tail:TEAM_A"] }),
      ticket("VOC-3", { assignee: "me" }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(Object.fromEntries(p.excluded.map((e) => [e.flight, e.reason])), {
    "VOC-1": "Linear 담당 codex — atc 밖에서 맡음",
    "VOC-2": "Linear 담당 kim — atc 밖에서 맡음",
  });
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-3"]);
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
  const reserved = { aircraft: new Map([["TEAM_B", "D-0009"]]), flights: new Map([["VOC-70", "D-0009"]]) };
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
  assert.deepEqual([...tailsOf({ labels: ["tail:TEAM_E", "Lane: team_b", "symphony-pilot", "tail:"] }, NOW)], ["TEAM_E", "TEAM_B"]);
});

test("lane: 별칭은 2026-10-10(KST)에 끊긴다: 그 뒤 lane:만 붙은 FLIGHT는 아무 팀에도 주지 않고 제외 사유로 알림", async () => {
  const { tailsOf, oldLaneOnly, LANE_CUTOFF } = await import("./dispatch.ts");
  const after = LANE_CUTOFF;
  assert.deepEqual([...tailsOf({ labels: ["lane:TEAM_B"] }, after - 1)], ["TEAM_B"]);
  assert.deepEqual([...tailsOf({ labels: ["lane:TEAM_B", "tail:TEAM_E"] }, after)], ["TEAM_E"]);
  assert.equal(oldLaneOnly({ labels: ["lane:TEAM_B"] }, after - 1), null);
  assert.equal(oldLaneOnly({ labels: ["lane:TEAM_B", "tail:TEAM_E"] }, after), null); // tail:이 있으면 그것을 따른다
  const s = snap({ sessions: [session("b", "TEAM_B"), session("e", "TEAM_E")], tickets: [ticket("VOC-90", { labels: ["lane:TEAM_B"] })] });
  const p = planDispatch(s, new Map(), cfg(), after);
  assert.deepEqual(p.assign, []);
  assert.equal(p.excluded.find((e) => e.flight === "VOC-90")?.reason, "옛 lane:TEAM_B 라벨은 2026-10-10부터 읽지 않음 — tail:TEAM_B로 바꿀 것");
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

test("AIRCRAFT health(ATC-45): LIMIT·MODEL·CONTEXT·PROVIDER·HUNG이면 배정하지 않고, PENDING·UNANSWERED는 그대로", () => {
  const h = (code: string, holds: boolean, extra = {}) => ({ code, level: "alert", since: daysAgo(0), detail: `${code} 원문`, next: "", holds, ...extra }) as Session["health"];
  const s = snap({
    sessions: [
      { ...session("b", "TEAM_B"), health: h("LIMIT", true, { resetsAt: new Date(NOW + 30 * 60_000).toISOString() }) },
      { ...session("c", "TEAM_C"), health: h("CONTEXT", true) },
      { ...session("d", "TEAM_D"), health: h("UNANSWERED", false) },
      session("e", "TEAM_E"),
    ],
    tickets: [ticket("VOC-150"), ticket("VOC-151"), ticket("VOC-152", { labels: ["type:SURVEY"] })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(
    p.aircraft.map((a) => `${a.name}:${a.available}:${a.reason}`),
    ["TEAM_B:false:HOLD · LIMIT until 12:30Z — LIMIT 원문", "TEAM_C:false:CONTEXT — RESTART — CONTEXT 원문", "TEAM_D:true:PARKED", "TEAM_E:true:PARKED"],
  );
  // STAND 없는 FLIGHT도 HOLD된 AIRCRAFT에는 가지 않는다
  assert.ok(p.assign.every((a) => a.aircraftName === "TEAM_D" || a.aircraftName === "TEAM_E"), pairsOf(p).join(" "));
});

test("ACCOUNT HOLD(ATC-51): 한 AIRCRAFT의 LIMIT이 같은 ACCOUNT의 AIRCRAFT를 reset까지 붙들고, 라벨이 없으면 붙들지 않는다", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const resetsAt = new Date(NOW + 30 * 60_000).toISOString();
  const limit = { code: "LIMIT", level: "alert", since: daysAgo(0), resetsAt, detail: "LIMIT 원문", next: "", holds: true } as Session["health"];
  const sessions = [{ ...session("k", "TEAM_K"), health: limit }, session("l", "TEAM_L"), session("m", "TEAM_M"), session("a", "TEAM_A")];
  const s = snap({ sessions, tickets: [ticket("VOC-160"), ticket("VOC-161", { labels: ["type:SURVEY"] })] });
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_K: { account: "pro-2" }, TEAM_L: { account: "pro-2" }, TEAM_A: { account: "main" } } };
  const reasons = (p: ReturnType<typeof planDispatch>) => p.aircraft.map((a) => `${a.name}:${a.available}:${a.reason}`);
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, fleet);
  assert.deepEqual(reasons(p), [
    "TEAM_K:false:HOLD · LIMIT until 12:30Z — LIMIT 원문",
    "TEAM_L:false:HOLD · LIMIT (account pro-2) until 12:30Z — 같은 ACCOUNT의 TEAM_K가 사용 한도에 걸림",
    "TEAM_M:true:PARKED", // 라벨 없음 → default ACCOUNT
    "TEAM_A:true:PARKED",
  ]);
  // STAND 없는 FLIGHT도 붙들린 형제에게는 가지 않는다
  assert.ok(p.assign.every((a) => a.aircraftName === "TEAM_M" || a.aircraftName === "TEAM_A"), pairsOf(p).join(" "));
  // reset이 지나면 형제는 다시 배정된다
  assert.equal(planDispatch(s, new Map(), cfg(), NOW + 30 * 60_000, undefined, fleet).aircraft.find((a) => a.name === "TEAM_L")!.available, true);
  // 등록부에 ACCOUNT 라벨이 하나도 없으면 계정을 모른다 → 형제를 붙들지 않는다
  assert.deepEqual(reasons(planDispatch(s, new Map(), cfg(), NOW)).slice(1), ["TEAM_L:true:PARKED", "TEAM_M:true:PARKED", "TEAM_A:true:PARKED"]);
  // 라벨 없는 AIRCRAFT끼리는 default ACCOUNT를 같이 쓴다
  const fleet2 = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_A: { account: "main" } } };
  assert.deepEqual(reasons(planDispatch(s, new Map(), cfg(), NOW, undefined, fleet2)).slice(1, 3), [
    "TEAM_L:false:HOLD · LIMIT (account default) until 12:30Z — 같은 ACCOUNT의 TEAM_K가 사용 한도에 걸림",
    "TEAM_M:false:HOLD · LIMIT (account default) until 12:30Z — 같은 ACCOUNT의 TEAM_K가 사용 한도에 걸림",
  ]);
});

test("FUEL HOLD(ATC-55, D3): 스위치가 켜져 있고 holdPct 이상이면 배정하지 않고, 꺼져 있으면 FUEL은 보여 주기만", () => {
  const fuel = (pct: number) => ({ group: "pro-2", account: "pro-2", at: daysAgo(0), from: "TEAM_K", fromKind: "aircraft" as const, windows: [], top: { name: "five_hour" as const, pct, resetsAt: new Date(NOW + 60 * 60_000).toISOString() }, level: "hold" as const, aircraft: ["TEAM_K", "TEAM_L"], control: [] });
  const s = { ...snap({ sessions: [session("k", "TEAM_K"), session("l", "TEAM_L"), session("m", "TEAM_M")], tickets: [ticket("VOC-170"), ticket("VOC-171", { labels: ["type:SURVEY"] })] }), fuel: { TEAM_K: fuel(96), TEAM_L: fuel(96), TEAM_M: { ...fuel(90), group: "main", account: "main", aircraft: ["TEAM_M"] } } };
  const reasons = (p: ReturnType<typeof planDispatch>) => p.aircraft.map((a) => `${a.name}:${a.available}:${a.reason}`);
  assert.deepEqual(reasons(planDispatch(s, new Map(), cfg(), NOW)), ["TEAM_K:true:PARKED", "TEAM_L:true:PARKED", "TEAM_M:true:PARKED"]);
  const on = { ...cfg(), fuel: { infoPct: 80, holdPct: 95, hold: true } };
  const p = planDispatch(s, new Map(), on, NOW);
  assert.deepEqual(reasons(p), [
    "TEAM_K:false:HOLD · FUEL (account pro-2) until 13:00Z — 5h 한도 사용 96%",
    "TEAM_L:false:HOLD · FUEL (account pro-2) until 13:00Z — 5h 한도 사용 96%",
    "TEAM_M:true:PARKED",
  ]);
  assert.ok(p.assign.every((a) => a.aircraftName === "TEAM_M"), pairsOf(p).join(" "));
});

test("FUEL HOLD(ATC-60): 관제 세션이 holdPct를 넘긴 ACCOUNT의 AIRCRAFT를 붙든다. 관제 세션 자신은 DISPATCH 대상이 아니다", async () => {
  const { fuelAccountsOf, fuelByAircraft, DEFAULT_FUEL } = await import("./fuel-remaining.ts");
  const reset = Math.round((NOW + 60 * 60_000) / 1000);
  const records = [{ t: daysAgo(0), sessionId: "mcc-1", rate_limits: { seven_day: { used_percentage: 99, resets_at: reset } } }];
  const members = [
    { name: "TEAM_K", kind: "aircraft" as const, account: "main", sessionIds: ["k"] },
    { name: "TEAM_M", kind: "aircraft" as const, account: "pro-2", sessionIds: ["m"] },
    { name: "MCC", kind: "control" as const, account: "main", sessionIds: ["mcc-1"] },
  ];
  const fuel = fuelByAircraft(fuelAccountsOf(members, records, DEFAULT_FUEL, NOW));
  const s = { ...snap({ sessions: [session("k", "TEAM_K"), session("m", "TEAM_M"), session("mcc-1", "MCC")], tickets: [ticket("VOC-180")] }), fuel };
  const p = planDispatch(s, new Map(), { ...cfg(), fuel: { infoPct: 80, holdPct: 95, hold: true } }, NOW);
  assert.deepEqual(
    p.aircraft.map((a) => `${a.name}:${a.available}:${a.reason}`),
    ["TEAM_K:false:HOLD · FUEL (account main) until 13:00Z — 7d 한도 사용 99%", "TEAM_M:true:PARKED"],
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

// ── STAND 없는 FLIGHT(SURVEY·CHECK)와 CHECK 독립성(docs/fleet.md 4.1, 5장) ──

const holding = (id: string, ticketKey: string) => ({ ws: ws(`vocado-${ticketKey.toLowerCase()}`, ticketKey), claim: claim(id, `vocado-${ticketKey.toLowerCase()}`) });
const inProgress = (key: string) => ticket(key, { state: "In Progress", stateType: "started" });
const arrived = (flight: string, aircraft: string | null, number: number) => ({ flight, aircraft, airport: "VCDO", pr: { repo: "chaehy5665/vocado_nextjs", number, url: "", title: "" } });
const pairsOf = (p: ReturnType<typeof planDispatch>) => p.assign.map((a) => `${a.flight}→${a.aircraftName}`).sort();

test("STAND 없는 FLIGHT: HOLDING 팀이 SURVEY를 받고, PARKED 팀은 STAND 규칙대로 BUILD를 받는다", () => {
  const c = holding("c", "VOC-10");
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("c", "TEAM_C")],
    workspaces: [c.ws],
    claims: [c.claim],
    tickets: [inProgress("VOC-10"), ticket("VOC-200", { priority: 1 }), ticket("VOC-201", { labels: ["type:SURVEY", "wake:L"] })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(pairsOf(p), ["VOC-200→TEAM_B", "VOC-201→TEAM_C"]);
  const survey = p.assign.find((a) => a.flight === "VOC-201")!;
  assert.deepEqual(survey.factors.find((f) => f.id === "standFree"), {
    id: "standFree", label: "STAND 없이", value: 1, weight: 0, points: 0, detail: "HOLDING — VOC-10 진행 중 — SURVEY는 STAND가 필요 없어 STAND 규칙 밖(AIRCRAFT당 1건)",
  });
  // 표시는 점수를 바꾸지 않는다
  assert.equal(survey.score, Math.round(survey.factors.reduce((a, f) => a + f.points, 0) * 10) / 10);
  assert.equal(p.aircraft.find((a) => a.id === "c")?.resting, true);
  // STAND 규칙으로 받은 BUILD에는 STAND 없이 표시가 없다
  assert.equal(p.assign.find((a) => a.flight === "VOC-200")!.factors.some((f) => f.id === "standFree"), false);
});

test("STAND 없는 FLIGHT: STAND 있는 제안이 진행 중인 PARKED 팀이 CHECK를 받되, 검토 대상을 만든 팀은 받지 않는다", () => {
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("d", "TEAM_D")],
    tickets: [ticket("VOC-70"), ticket("VOC-210", { title: "VOC-205 결과 검토", labels: ["type:CHECK", "wake:L"] })],
  });
  // TEAM_B는 BUILD(VOC-70) 제안이 진행 중이라 STAND 규칙으로는 못 받는다. TEAM_D는 비어 있지만 VOC-205를 만들었다.
  const reserved = { aircraft: new Map([["TEAM_B", "D-0009"]]), flights: new Map([["VOC-70", "D-0009"]]), held: new Map(), aircraftFlights: new Map([["TEAM_B", ["VOC-70"]]]) };
  const p = planDispatch(s, new Map(), cfg(), NOW, reserved, undefined, undefined, [arrived("VOC-205", "TEAM_D", 400)]);
  assert.deepEqual(pairsOf(p), ["VOC-210→TEAM_B"]);
  const f = p.assign[0].factors;
  assert.equal(f.find((x) => x.id === "independence")?.detail, "대상 VOC-205 — 만든 TEAM_D(VOC-205 LOGBOOK) 제외");
  assert.equal(f.find((x) => x.id === "standFree")?.detail, "PARKED — CHECK는 STAND가 필요 없어 STAND 규칙 밖(AIRCRAFT당 1건)");
  assert.equal(p.aircraft.find((a) => a.id === "b")?.reserved, "D-0009");
});

test("CHECK 독립성: 만든 팀만 날 수 있으면 사유와 함께 제외, tail 팀이 만든 팀이어도 제외", () => {
  const s = snap({
    sessions: [session("d", "TEAM_D")],
    tickets: [
      ticket("VOC-211", { labels: ["type:CHECK"], related: ["VOC-205"] }),
      ticket("VOC-212", { labels: ["type:CHECK", "tail:TEAM_D"], title: "PR #400 exact-head review" }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, undefined, undefined, [arrived("VOC-205", "TEAM_D", 400)]);
  assert.deepEqual(p.assign, []);
  const why = Object.fromEntries(p.excluded.map((e) => [e.flight, e.reason]));
  assert.equal(why["VOC-211"], "CHECK 독립성 — 검토 대상을 만든 TEAM_D 말고 이 CHECK를 날 AIRCRAFT 없음 (대상 VOC-205 — 만든 TEAM_D(VOC-205 LOGBOOK) 제외)");
  assert.equal(why["VOC-212"], "tail:TEAM_D — CHECK 독립성 — 검토 대상을 만든 TEAM_D 말고 이 CHECK를 날 AIRCRAFT 없음 (대상 PR #400 — 만든 TEAM_D(PR #400 LOGBOOK) 제외)");
});

test("CHECK 독립성: 만든 팀을 모르면 막지 않고 '확인 못 함'을 표시한다", () => {
  const s = snap({
    sessions: [session("b", "TEAM_B")],
    tickets: [ticket("VOC-213", { labels: ["type:CHECK"] }), ticket("VOC-214", { labels: ["type:CHECK"], blockedBy: ["VOC-9"] }), ticket("VOC-9", { state: "Done", stateType: "completed" })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  // TEAM_B 한 대라 둘 중 하나만 받는다(한 계획에서 AIRCRAFT당 1건)
  assert.equal(p.assign.length, 1);
  const details = ["VOC-213", "VOC-214"].map((k) => {
    const only = planDispatch({ ...s, tickets: s.tickets.filter((t) => t.key !== (k === "VOC-213" ? "VOC-214" : "VOC-213")) }, new Map(), cfg(), NOW);
    return only.assign[0].factors.find((f) => f.id === "independence")!;
  });
  assert.equal(details[0].detail, "확인 못 함 — 검토 대상을 찾지 못함(관계·제목에 FLIGHT·PR 없음)");
  assert.equal(details[1].detail, "확인 못 함 — VOC-9을 만든 AIRCRAFT를 모름");
  assert.equal(details[1].value, 0);
});

test("checkTargetOf: 관계·제목의 FLIGHT key와 PR 번호, 자기 자신은 빼고", async () => {
  const { checkTargetOf } = await import("./dispatch.ts");
  const t = ticket("VOC-300", { title: "Review voc-12 and PR #401 (VOC-300), https://github.com/o/r/pull/402", related: ["VOC-5"], blockedBy: ["VOC-6"], parent: "VOC-1" });
  assert.deepEqual(checkTargetOf(t), { flights: ["VOC-1", "VOC-12", "VOC-5", "VOC-6"], prs: [401, 402] });
  assert.deepEqual(checkTargetOf(ticket("VOC-301")), { flights: [], prs: [] });
});

test("checkBuildersOf: LOGBOOK, 열린 PR의 STAND, FLIGHT의 STAND 점유, 청구 기록에서 만든 팀을 찾는다", async () => {
  const { checkBuildersOf } = await import("./dispatch.ts");
  const team = /^TEAM[\s_-]?[A-Z]$/i;
  const sessions = [{ id: "a", name: "TEAM_A" }, { id: "c", name: "Team_c" }, { id: "e", name: "TEAM_E" }, { id: "x", name: "President" }];
  const src = {
    logbook: [arrived("VOC-1", "TEAM_B", 400), { ...arrived("VOC-2", "TEAM_F", 401), airport: "OTHR" }],
    pulls: [{ ...pull(410, "VOC-3"), standPath: `${WT}/vocado-voc-3` }],
    claims: [claim("c", "vocado-voc-3"), claim("x", "vocado-voc-3"), claim("a", "vocado-voc-4")],
    workspaces: [ws("vocado-voc-4", "VOC-4")],
    sessions,
    history: new Map([["e", ["VOC-5"]]]),
    team,
  };
  const at = { code: "VCDO", repo: VCDO };
  const of = (flights: string[], prs: number[]) => Object.fromEntries(checkBuildersOf({ flights, prs }, at, src));
  assert.deepEqual(of(["VOC-1"], []), { TEAM_B: ["VOC-1 LOGBOOK"] });
  // PR 번호는 CHECK의 AIRPORT 저장소 안에서만 맞춘다(OTHR의 #401은 아님)
  assert.deepEqual(of([], [400, 401]), { TEAM_B: ["PR #400 LOGBOOK"] });
  // 열린 PR의 STAND를 쥔 TEAM 세션(President는 팀이 아님), PR 번호로 찾아도 그 FLIGHT로 이어진다
  assert.deepEqual(of([], [410]), { TEAM_C: ["PR #410 STAND", "VOC-3 PR #410 STAND"] });
  assert.deepEqual(of(["VOC-4", "VOC-5"], []), { TEAM_A: ["VOC-4 STAND"], TEAM_E: ["VOC-5 청구 기록"] });
  assert.deepEqual(of(["VOC-9"], [999]), {});
});

test("flash-helper만 태운 CREW는 CHECK를 받지 않는다(HOLDING이어도)", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const flashOnly = [{ position: "helper", agent: "flash-helper", limits: ["no BUILD", "no CHECK verdicts", "no SEC"] }];
  const fleet = { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_B: { complement: flashOnly } } };
  const b = holding("b", "VOC-10");
  const d = holding("d", "VOC-11");
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("d", "TEAM_D")],
    workspaces: [b.ws, d.ws],
    claims: [b.claim, d.claim],
    tickets: [inProgress("VOC-10"), inProgress("VOC-11"), ticket("VOC-220", { labels: ["type:CHECK"] }), ticket("VOC-221", { labels: ["type:SURVEY"] })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, fleet);
  // CHECK는 TEAM_D에만, SURVEY는 flash-helper 팀도 받을 수 있다
  assert.deepEqual(pairsOf(p), ["VOC-220→TEAM_D", "VOC-221→TEAM_B"]);
  const alone = planDispatch({ ...s, sessions: [session("b", "TEAM_B")] }, new Map(), cfg(), NOW, undefined, fleet);
  assert.equal(alone.excluded.find((e) => e.flight === "VOC-220")?.reason, "type:CHECK — 그 일을 날 수 있는 CREW 없음 (FLEET 탭의 CREW COMPLEMENT)");
});

test("STAND 규칙은 BUILD·FERRY에 그대로: HOLDING·AIRBORNE 팀은 받지 않고, AIRBORNE 팀은 SURVEY도 받지 않는다", () => {
  const c = holding("c", "VOC-10");
  const a = holding("a", "VOC-12");
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("c", "TEAM_C")],
    workspaces: [c.ws, a.ws],
    claims: [c.claim, a.claim],
    tickets: [inProgress("VOC-10"), inProgress("VOC-12"), ticket("VOC-230", { priority: 1 }), ticket("VOC-231", { labels: ["type:FERRY"] }), ticket("VOC-232", { labels: ["type:MAINT"] })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(p.assign, []);
  const withSurvey = planDispatch({ ...s, sessions: [session("a", "TEAM_A", "busy")] , tickets: [...s.tickets, ticket("VOC-233", { labels: ["type:SURVEY"] })] }, new Map(), cfg(), NOW);
  assert.deepEqual(withSurvey.assign, []);
});

test("중복 제안 없음: STAND 없는 제안이 진행 중인 AIRCRAFT, 이번 계획에서 이미 받은 AIRCRAFT는 더 받지 않는다", () => {
  const c = holding("c", "VOC-10");
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("c", "TEAM_C")],
    workspaces: [c.ws],
    claims: [c.claim],
    tickets: [
      inProgress("VOC-10"),
      ticket("VOC-240", { priority: 1 }),
      ticket("VOC-241", { labels: ["type:SURVEY", "wake:L"] }),
      ticket("VOC-242", { labels: ["type:SURVEY", "wake:L"] }),
      ticket("VOC-243", { labels: ["type:CHECK", "wake:L"] }),
      ticket("VOC-244", { labels: ["type:SURVEY", "wake:L"] }),
    ],
  });
  // 계획 하나: TEAM_B는 BUILD 하나, TEAM_C는 STAND 없는 FLIGHT 하나. 나머지는 기다린다
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.equal(p.assign.length, 2);
  assert.deepEqual(p.assign.map((a) => a.aircraftName).sort(), ["TEAM_B", "TEAM_C"]);
  // TEAM_C가 SURVEY(D-0011)를 진행 중이면 또 받지 않는다. TEAM_B는 BUILD 제안(D-0010)이 진행 중이어도 SURVEY 하나는 받는다
  const reserved = {
    aircraft: new Map([["TEAM_B", "D-0010"], ["TEAM_C", "D-0011"]]),
    flights: new Map([["VOC-240", "D-0010"], ["VOC-241", "D-0011"]]),
    held: new Map(),
    aircraftFlights: new Map([["TEAM_B", ["VOC-240"]], ["TEAM_C", ["VOC-241"]]]),
  };
  const q = planDispatch(s, new Map(), cfg(), NOW, reserved);
  assert.deepEqual(pairsOf(q), ["VOC-242→TEAM_B"]);
  assert.deepEqual(
    q.aircraft.map((a) => `${a.name}:${a.reserved}:${a.reservedLight}`),
    ["TEAM_B:D-0010:null", "TEAM_C:null:D-0011"],
  );
  // 옛 모양의 예약(aircraftFlights 없음)도 FLIGHT로 되짚어 가른다
  const legacy = planDispatch(s, new Map(), cfg(), NOW, { ...reserved, aircraftFlights: undefined });
  assert.deepEqual(pairsOf(legacy), ["VOC-242→TEAM_B"]);
});

test("STAND 없는 FLIGHT도 WAKE 슬롯을 센다", () => {
  const c = holding("c", "VOC-10");
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("c", "TEAM_C")],
    workspaces: [c.ws],
    claims: [c.claim],
    tickets: [inProgress("VOC-10"), ticket("VOC-250", { labels: ["type:SURVEY", "wake:H"] })],
  });
  // 한도 2, AIRBORNE 1 → H(2)는 자리가 없다
  const p = planDispatch(s, new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 2 } } }), NOW);
  assert.deepEqual(p.assign, []);
  const q = planDispatch(s, new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 3 } } }), NOW);
  assert.deepEqual(pairsOf(q), ["VOC-250→TEAM_C"]);
});

test("tail: 지정 팀이 HOLDING이면 STAND 없는 FLIGHT는 받고, BUILD는 이유와 함께 제외", () => {
  const e = holding("e", "VOC-10");
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("e", "TEAM_E")],
    workspaces: [e.ws],
    claims: [e.claim],
    tickets: [inProgress("VOC-10"), ticket("VOC-260", { labels: ["tail:TEAM_E", "type:SURVEY"] }), ticket("VOC-261", { labels: ["tail:TEAM_E"] })],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(pairsOf(p), ["VOC-260→TEAM_E"]);
  assert.equal(p.excluded.find((x) => x.flight === "VOC-261")?.reason, "tail:TEAM_E — 지정 팀 배정 불가(TEAM_E HOLDING — VOC-10 진행 중)");
});

test("canTakeNow: STAND 없는 FLIGHT는 HOLDING(resting) AIRCRAFT도 받을 수 있다 — 승인된 제안이 SUPERSEDED되지 않는다", async () => {
  const { canTakeNow } = await import("./dispatch.ts");
  const { fold, reservedOf, syncOps } = await import("./proposals.ts");
  const holdingAc = { available: false, resting: true };
  assert.equal(canTakeNow(holdingAc, ticket("VOC-1", { labels: ["type:SURVEY"] })), true);
  assert.equal(canTakeNow(holdingAc, ticket("VOC-1")), false);
  assert.equal(canTakeNow({ available: false, resting: false }, ticket("VOC-1", { labels: ["type:CHECK"] })), false);
  assert.equal(canTakeNow({ available: true }, ticket("VOC-1")), true);

  const at = new Date(NOW - 60_000).toISOString();
  const existing = fold([
    { op: "create", id: "D-0001", at, kind: "ASSIGN", flight: "VOC-270", aircraft: "c", aircraftName: "TEAM_C", airport: "VCDO", score: 1, factors: [] },
    { op: "approve", id: "D-0001", at },
    { op: "create", id: "D-0002", at, kind: "ASSIGN", flight: "VOC-271", aircraft: "c", aircraftName: "TEAM_C", airport: "VCDO", score: 1, factors: [] },
    { op: "approve", id: "D-0002", at },
  ]);
  assert.deepEqual([...reservedOf(existing).aircraftFlights!], [["TEAM_C", ["VOC-270", "VOC-271"]]]);
  const plan = {
    at, assign: [], release: [], hold: [], excluded: [], slots: [],
    aircraft: [{ id: "c", name: "TEAM_C", callsign: "CHARLIE", airport: "VCDO", available: false, resting: true, reason: "HOLDING — VOC-10 진행 중", reserved: null }],
  };
  const tickets = [ticket("VOC-270", { labels: ["type:SURVEY"] }), ticket("VOC-271")];
  const ops = syncOps(existing, plan, { tickets, workspaces: [] }, DEFAULT_DISPATCH_CONFIG, NOW, 2);
  // SURVEY는 HOLDING 팀에 유효, BUILD는 무효
  assert.deepEqual(ops.map((o) => `${o.op}:${o.id}`), ["supersede:D-0002"]);
});

test("현실적인 스냅샷: HOLDING 4대·PARKED 1대·AIRBORNE 1대에서 BUILD 1건 말고 SURVEY가 더 나오고, CHECK는 독립 AIRCRAFT를 기다린다", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const fleet = {
    defaults: DEFAULT_FLEET.defaults,
    aircraft: {
      TEAM_B: { ratings: ["SEC", "DATA", "DOCS"] as ("SEC" | "DATA" | "DOCS")[], routes: ["Beta Readiness"] },
      TEAM_E: { ratings: ["SEC", "DATA"] as ("SEC" | "DATA")[], routes: ["Beta Readiness"] },
      TEAM_F: { ratings: ["UI", "DOCS"] as ("UI" | "DOCS")[], routes: ["Song Experience"] },
      TEAM_C: { complement: [{ position: "flash-helper", agent: "flash-helper", limits: ["no BUILD", "no CHECK verdicts", "no SEC"] }] },
    },
  };
  const hs = ["b:VOC-101", "c:VOC-102", "d:VOC-103", "e:VOC-104"].map((x) => holding(x.split(":")[0], x.split(":")[1]));
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("b", "TEAM_B"), session("c", "TEAM_C"), session("d", "TEAM_D"), session("e", "TEAM_E"), session("f", "TEAM_F")],
    workspaces: hs.map((h) => h.ws),
    claims: hs.map((h) => h.claim),
    tickets: [
      ...["VOC-101", "VOC-102", "VOC-103", "VOC-104"].map(inProgress),
      ticket("VOC-125", { priority: 2, labels: ["type:SURVEY", "wake:H", "rating:DATA"] }),
      ticket("VOC-177", { priority: 2, labels: ["type:SURVEY", "wake:H", "rating:SEC"] }),
      ticket("VOC-180", { priority: 3, labels: ["type:CHECK", "wake:L"], title: "PR #400 exact-head review" }),
      ticket("VOC-181", { priority: 3, project: "Song Experience", labels: ["rating:UI"] }),
      ticket("VOC-182", { priority: 4, labels: ["type:SURVEY", "wake:L"] }),
    ],
  });
  const logbook = [arrived("VOC-150", "TEAM_D", 400)];
  const p = planDispatch(s, new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 8 } } }), NOW, undefined, fleet, undefined, logbook);
  // 예전 규칙이면 PARKED TEAM_F 한 대만 받는다(VOC-181). 이제 HOLDING 팀이 STAND 없는 FLIGHT를 하나씩 받는다:
  // SEC SURVEY는 SEC 팀(TEAM_B·E), flash-helper만 태운 TEAM_C는 SURVEY만, AIRBORNE TEAM_A는 없음.
  assert.deepEqual(pairsOf(p), ["VOC-125→TEAM_B", "VOC-177→TEAM_E", "VOC-181→TEAM_F", "VOC-182→TEAM_C"]);
  // CHECK(VOC-180)는 PR #400을 만든 TEAM_D와 flash-helper 팀을 뺀 TEAM_B·E가 더 급한 SURVEY를 받아 기다린다(제외가 아님)
  assert.equal(p.excluded.length, 0);
  assert.deepEqual(p.slots, [{ airport: "VCDO", airborne: 1, planned: 5.5, limit: 8 }]);
  // 기본 한도(VCDO 4)에서는 WAKE 슬롯이 먼저 찬다: BUILD M(1) + SURVEY H(2) + AIRBORNE 1
  const tight = planDispatch(s, new Map(), cfg(), NOW, undefined, fleet, undefined, logbook);
  assert.deepEqual(pairsOf(tight), ["VOC-125→TEAM_B", "VOC-181→TEAM_F"]);
});

// ── RECALL(recalling)과 예약, LOGBOOK attributed와 CHECK 독립성 ──

test("RECALL: recalling인 STAND 없는 제안은 두 번째 STAND 없는 FLIGHT를 막고 BUILD는 막지 않는다(accepted와 같다). recalling BUILD는 BUILD를 막는다", async () => {
  const { fold, reservedOf } = await import("./proposals.ts");
  const at = new Date(NOW - 60 * 60_000).toISOString();
  const flow = (id: string, flight: string, aircraft: string, until: "accepted" | "recalling") =>
    [
      { op: "create" as const, id, at, kind: "ASSIGN" as const, flight, aircraft, aircraftName: `TEAM_${aircraft.toUpperCase()}`, airport: "VCDO", score: 1, factors: [] },
      { op: "approve" as const, id, at },
      { op: "send" as const, id, at, message: "m" },
      { op: "accept" as const, id, at },
      ...(until === "recalling" ? [{ op: "recall" as const, id, at, reason: "우선순위 바뀜", message: "R" }] : []),
    ];
  const s = snap({
    sessions: [session("b", "TEAM_B")],
    tickets: [
      ticket("VOC-300", { labels: ["type:SURVEY", "wake:L"] }),
      ticket("VOC-301", { labels: ["type:SURVEY", "wake:L"] }),
      ticket("VOC-302", { priority: 1 }),
      ticket("VOC-303"),
    ],
  });
  // (a) SURVEY VOC-300이 accepted·recalling이면 SURVEY VOC-301은 못 받고 BUILD VOC-302는 받는다
  for (const until of ["accepted", "recalling"] as const) {
    const ps = fold(flow("D-0001", "VOC-300", "b", until));
    assert.equal(ps[0].status, until);
    const r = reservedOf(ps);
    assert.deepEqual([...r.aircraftFlights!], [["TEAM_B", ["VOC-300"]]]);
    const p = planDispatch(s, new Map(), cfg(), NOW, r);
    assert.deepEqual(pairsOf(p), ["VOC-302→TEAM_B"], until);
    assert.deepEqual(p.aircraft.map((a) => `${a.reserved}:${a.reservedLight}`), ["null:D-0001"], until);
    assert.equal(p.excluded.find((e) => e.flight === "VOC-300")?.reason, "진행 중인 제안 D-0001");
  }
  // (b) BUILD VOC-302가 recalling이면 다른 BUILD(VOC-303)는 못 받는다. SURVEY 하나는 받는다
  const q = planDispatch(s, new Map(), cfg(), NOW, reservedOf(fold(flow("D-0002", "VOC-302", "b", "recalling"))));
  assert.deepEqual(pairsOf(q), ["VOC-300→TEAM_B"]);
  assert.equal(q.aircraft[0].reserved, "D-0002");
  assert.ok(!q.assign.some((a) => a.flight === "VOC-303"));
});

test("RECALL: syncOps는 recalling 제안을 AIRCRAFT가 HOLDING·AIRBORNE이어도 건드리지 않고 RECALL READBACK을 기다린다(24시간 뒤 만료만)", async () => {
  const { fold, syncOps } = await import("./proposals.ts");
  const mk = (id: string, flight: string, minAgo: number) => {
    const at = new Date(NOW - minAgo * 60_000).toISOString();
    return [
      { op: "create" as const, id, at, kind: "ASSIGN" as const, flight, aircraft: "c", aircraftName: "TEAM_C", airport: "VCDO", score: 1, factors: [] },
      { op: "approve" as const, id, at },
      { op: "send" as const, id, at, message: "m" },
      { op: "accept" as const, id, at },
      { op: "recall" as const, id, at, reason: "우선순위 바뀜", message: "R" },
    ];
  };
  const existing = fold([...mk("D-0001", "VOC-310", 30), ...mk("D-0002", "VOC-311", 30), ...mk("D-0003", "VOC-312", 25 * 60)]);
  assert.deepEqual(existing.map((p) => p.status), ["recalling", "recalling", "recalling"]);
  const tickets = [ticket("VOC-310", { labels: ["type:SURVEY"] }), ticket("VOC-311"), ticket("VOC-312", { labels: ["type:CHECK"] })];
  for (const ac of [
    { available: false, resting: true, reason: "HOLDING — VOC-10 진행 중" },
    { available: false, resting: false, reason: "AIRBORNE" },
  ]) {
    const plan = {
      at: new Date(NOW).toISOString(), assign: [], release: [], hold: [], excluded: [], slots: [],
      aircraft: [{ id: "c", name: "TEAM_C", callsign: "CHARLIE", airport: "VCDO", reserved: null, ...ac }],
    };
    // STAND가 생겨도 DEPARTED로 바꾸지 않는다
    const ops = syncOps(existing, plan, { tickets, workspaces: [ws("vocado-voc-311", "VOC-311")] }, DEFAULT_DISPATCH_CONFIG, NOW, 3);
    assert.deepEqual(ops.map((o) => `${o.op}:${o.id}`), ["expire:D-0003"], ac.reason);
  }
});

test("LOGBOOK: attributed 줄로만 AIRCRAFT를 안 기록도 접은 목록에서 CHECK 독립성의 만든 팀이 된다", async () => {
  const { foldLogbook } = await import("./logbook.ts");
  const arrivedLine = {
    op: "arrived" as const, t: daysAgo(1), key: "chaehy5665/vocado_nextjs#420", aircraft: null, flight: "VOC-320", class: null, airport: "VCDO",
    pr: { repo: "chaehy5665/vocado_nextjs", number: 420, url: "", title: "" }, stands: [], departedAt: daysAgo(2), departedFrom: "pr" as const,
    arrivedAt: daysAgo(1), blockMin: null, landingWaitMin: 60, codexFindings: 0, changesRequested: false, reverted: false, los: 0,
  };
  const attributed = { op: "attributed" as const, t: daysAgo(0.5), key: "chaehy5665/vocado_nextjs#420", aircraft: "TEAM_D", via: "departures" as const };
  // 접기 전의 arrived 줄만으로는 모른다
  const raw = planDispatch(
    snap({ sessions: [session("d", "TEAM_D")], tickets: [ticket("VOC-321", { labels: ["type:CHECK"], related: ["VOC-320"] })] }),
    new Map(), cfg(), NOW, undefined, undefined, undefined, [arrivedLine],
  );
  assert.equal(raw.assign[0]?.factors.find((f) => f.id === "independence")?.detail, "확인 못 함 — VOC-320을 만든 AIRCRAFT를 모름");
  const folded = foldLogbook([arrivedLine, attributed]);
  assert.equal(folded[0].aircraft, "TEAM_D");
  const { checkBuildersOf } = await import("./dispatch.ts");
  const builders = checkBuildersOf({ flights: ["VOC-320"], prs: [420] }, { code: "VCDO", repo: VCDO }, {
    logbook: folded, pulls: [], claims: [], workspaces: [], sessions: [], history: new Map(), team: /^TEAM[\s_-]?[A-Z]$/i,
  });
  assert.deepEqual(Object.fromEntries(builders), { TEAM_D: ["PR #420 LOGBOOK", "VOC-320 LOGBOOK"] });
  // planner에 접은 목록을 주면 유일한 AIRCRAFT가 만든 팀이라 CHECK는 제외된다
  const p = planDispatch(
    snap({ sessions: [session("d", "TEAM_D")], tickets: [ticket("VOC-321", { labels: ["type:CHECK"], related: ["VOC-320"] })] }),
    new Map(), cfg(), NOW, undefined, undefined, undefined, folded,
  );
  assert.deepEqual(p.assign, []);
  assert.match(p.excluded.find((e) => e.flight === "VOC-321")!.reason, /^CHECK 독립성 — 검토 대상을 만든 TEAM_D/);
});

test("24시간 안에 제안됐다 닫힌 짝은 계획에서 빼고, AIRCRAFT는 다음으로 좋은 FLIGHT를 받는다(D-0017 사례)", () => {
  // 배정 가능한 AIRCRAFT는 TEAM_E뿐. TEAM_E에게는 VOC-177(High)이 VOC-196(Medium, tail:TEAM_E)보다 점수가 높지만,
  // VOC-177 → TEAM_E는 D-0010에서 거절됐다
  const tickets = [ticket("VOC-177", { priority: 2 }), ticket("VOC-196", { labels: ["tail:TEAM_E"] })];
  const s = snap({ sessions: [session("e", "TEAM_E")], tickets });
  const before = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(before.assign.map((a) => `${a.flight}>${a.aircraftName}`), ["VOC-177>TEAM_E"]); // 예전: syncOps가 못 만드는 짝, VOC-196은 갈 곳 없음
  const until = new Date(NOW + 3 * 3_600_000).toISOString();
  const reserved = { aircraft: new Map(), flights: new Map(), held: new Map(), recentPairs: new Map([["VOC-177|TEAM_E", { id: "D-0010", until }]]) };
  const p = planDispatch(s, new Map(), cfg(), NOW, reserved);
  assert.deepEqual(p.assign.map((a) => `${a.flight}>${a.aircraftName}`), ["VOC-196>TEAM_E"]);
  assert.deepEqual(p.blockedPairs, [{ flight: "VOC-177", aircraft: "TEAM_E", aircraftName: "TEAM_E", proposal: "D-0010", until }]);
  assert.deepEqual(p.excluded, [{ flight: "VOC-177", reason: pairBlockedWhy("D-0010", until) }]);

  // 다른 AIRCRAFT가 있으면 막힌 FLIGHT는 그쪽으로 가고, 제외가 아니다
  const both = planDispatch(snap({ sessions: [session("e", "TEAM_E"), session("z", "TEAM_Z")], tickets }), new Map(), cfg(), NOW, reserved);
  assert.deepEqual(both.assign.map((a) => `${a.flight}>${a.aircraftName}`).sort(), ["VOC-177>TEAM_Z", "VOC-196>TEAM_E"]);
  assert.deepEqual(both.excluded, []);
});

test("배정할 짝이 모두 24시간 규칙에 걸린 FLIGHT는 제외 사유로 남는다", () => {
  const s = snap({ sessions: [session("e", "TEAM_E")], tickets: [ticket("VOC-196", { labels: ["tail:TEAM_E"] })] });
  const until = new Date(NOW + 5 * 3_600_000).toISOString();
  const reserved = { aircraft: new Map(), flights: new Map(), held: new Map(), recentPairs: new Map([["VOC-196|TEAM_E", { id: "D-0017", until }]]) };
  const p = planDispatch(s, new Map(), cfg(), NOW, reserved);
  assert.deepEqual(p.assign, []);
  assert.deepEqual(p.excluded, [{ flight: "VOC-196", reason: pairBlockedWhy("D-0017", until) }]);
  assert.match(pairBlockedWhy("D-0017", until), /^24시간 안에 제안된 짝\(D-0017\) — \d{2}-\d{2} \d{2}:\d{2}부터 다시$/);
});

test("FLIGHT 보류: FLIGHT 자체의 문제로 거절되면 모든 AIRCRAFT에서 빠지고, 이슈가 판정 뒤 바뀌거나 24시간이면 풀린다", () => {
  const decidedAt = new Date(NOW - 2 * 3_600_000).toISOString();
  const until = new Date(Date.parse(decidedAt) + 86_400_000).toISOString();
  const reserved = {
    aircraft: new Map(), flights: new Map(), held: new Map(),
    recentFlights: new Map([["VOC-125", { id: "D-0023", decidedAt, until, codes: ["needs-human"] }]]),
  };
  const sessions = [session("a", "TEAM_A"), session("d", "TEAM_D"), session("b", "TEAM_B")];
  // 판정 전에 마지막으로 바뀐 이슈: 어느 팀에도 가지 않는다
  const s = snap({ sessions, tickets: [ticket("VOC-125", { updatedAt: daysAgo(1) }), ticket("VOC-9")] });
  const p = planDispatch(s, new Map(), cfg(), NOW, reserved);
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-9"]);
  assert.deepEqual(p.excluded, [{ flight: "VOC-125", reason: flightHeldWhy("D-0023", ["needs-human"], until) }]);
  assert.match(flightHeldWhy("D-0023", ["needs-human", "waiting-on-prior"], until), /^FLIGHT 보류 — 사람 결정 필요 · 선행 FLIGHT·PR 대기 \(D-0023 판정\) — 이슈가 바뀌거나 \d{2}-\d{2} \d{2}:\d{2}부터 다시$/);
  // 판정 뒤에 이슈가 바뀜(사람이 본문을 고침 등): 다시 후보
  const edited = snap({ sessions, tickets: [ticket("VOC-125", { updatedAt: new Date(NOW - 3_600_000).toISOString() })] });
  assert.deepEqual(planDispatch(edited, new Map(), cfg(), NOW, reserved).assign.map((a) => a.flight), ["VOC-125"]);
  // 24시간이 지남: 다시 후보
  const later = Date.parse(until) + 1;
  assert.deepEqual(planDispatch(s, new Map(), cfg(), later, reserved).assign.map((a) => a.flight).sort(), ["VOC-125", "VOC-9"]);
});

test("여러 Linear 팀: 기본은 주 팀만 후보, 다른 팀(ATC)은 보여 주기만. 켜면 팀의 기본 AIRPORT(ATCC) AIRCRAFT에만", async () => {
  const { airportOfTicket, candidateTeamsOf } = await import("./dispatch.ts");
  const ATC = "/home/c10/projects/atc";
  const airports = [{ id: "r1", code: "VCDO", name: "vocado_nextjs", repo: VCDO }, { id: "r2", code: "ATCC", name: "atc", repo: ATC }];
  // 프로젝트 매핑이 먼저(null이면 제외), 매핑에 없으면 팀의 기본 AIRPORT
  assert.equal(airportOfTicket({ key: "VOC-1", project: "Beta Readiness" }, cfg()), "VCDO");
  assert.equal(airportOfTicket({ key: "VOC-1", project: "Somewhere Else" }, cfg()), null);
  assert.equal(airportOfTicket({ key: "ATC-1", project: "atc" }, cfg()), "ATCC");
  assert.equal(airportOfTicket({ key: "ATC-1", project: "Vocado Visual System (SEED)" }, cfg()), null);
  assert.deepEqual([...candidateTeamsOf(cfg(), "VOC")], ["VOC"]);
  assert.deepEqual([...candidateTeamsOf(cfg({ candidateTeams: ["VOC", "ATC"] }), "VOC")], ["VOC", "ATC"]);

  const s = snap({
    airports,
    sessions: [session("b", "TEAM_B"), session("i", "TEAM_I", "idle", ATC)],
    tickets: [ticket("VOC-1"), ticket("ATC-1", { project: "atc" })],
  });
  const off = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(off.assign.map((a) => `${a.flight}→${a.aircraftName}`), ["VOC-1→TEAM_B"]);
  assert.equal(off.excluded.some((e) => e.flight === "ATC-1"), false); // 사유 없이 빠진다(후보가 아님)
  assert.deepEqual(off.slots.map((x) => x.airport), ["VCDO"]);
  const on = planDispatch(s, new Map(), cfg({ candidateTeams: ["VOC", "ATC"] }), NOW);
  assert.deepEqual(on.assign.map((a) => `${a.flight}→${a.aircraftName}@${a.airport}`).sort(), ["ATC-1→TEAM_I@ATCC", "VOC-1→TEAM_B@VCDO"]);
  assert.deepEqual(on.slots.map((x) => x.airport).sort(), ["ATCC", "VCDO"]);
});

test("청구 기록의 FLIGHT: 읽는 팀 key 모두", () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-"));
  mkdirSync(join(dir, "s1"));
  for (const f of ["vocado-voc-185", "atc-1-linear-teams", "atc-doc-fixes"]) writeFileSync(join(dir, "s1", `${encodeURIComponent(`/wt/${f}`)}.json`), "{}");
  assert.deepEqual([...readFlightHistory(["VOC", "ATC"], dir)], [["s1", ["ATC-1", "VOC-185"]]]);
  assert.deepEqual([...readFlightHistory("VOC", dir)], [["s1", ["VOC-185"]]]);
});

test("지금 WAYPOINT(routes 8단계): 지금 구간 WAYPOINT에 붙은 FLIGHT가 점수를 더 받아 먼저 배정되고, 가중치는 설정으로 바꾼다", () => {
  const s = snap({ sessions: [session("a", "TEAM_A")], tickets: [ticket("VOC-40"), ticket("VOC-41")] });
  const active = new Map([["VOC-41", "Beta Readiness · Beta Ready"]]);
  const base = planDispatch(s, new Map(), cfg(), NOW);
  assert.equal(base.assign[0].flight, "VOC-40"); // 같은 점수면 key 순
  assert.equal(base.assign[0].factors.find((f) => f.id === "waypoint")!.detail, "아님");
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, undefined, undefined, [], active);
  assert.equal(p.assign[0].flight, "VOC-41");
  const wp = p.assign[0].factors.find((f) => f.id === "waypoint")!;
  assert.deepEqual([wp.value, wp.weight, wp.points, wp.detail], [1, 1, 1, "Beta Readiness · Beta Ready"]);
  const off = planDispatch(s, new Map(), cfg({ weights: { ...DEFAULT_DISPATCH_CONFIG.weights, waypoint: 0 } }), NOW, undefined, undefined, undefined, [], active);
  assert.equal(off.assign[0].flight, "VOC-40"); // 가중치 0이면 순서가 그대로
});

test("unserved: 받을 AIRCRAFT가 없는 FLIGHT만 — 자격 없음, tail 세션 없음, 모두 바쁨. 슬롯이 찬 것은 넣지 않는다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A", "busy"), session("b", "TEAM_B")],
    tickets: [
      ticket("VOC-1", { labels: ["rating:SEC"] }), // TEAM_B는 SEC가 없다(기본 rating)
      ticket("VOC-2", { labels: ["tail:TEAM_Z"] }),
      ticket("VOC-3", { priority: 1 }),
      ticket("VOC-4", { priority: 4 }),
    ],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(p.assign.map((x) => x.flight), ["VOC-3"]);
  const by = Object.fromEntries((p.unserved ?? []).map((u) => [u.flight, u]));
  assert.equal(by["VOC-1"].why, "unqualified");
  assert.deepEqual(by["VOC-1"].ratings, ["SEC"]);
  assert.equal(by["VOC-1"].labeled, true);
  assert.equal(by["VOC-2"].why, "no-tail");
  assert.deepEqual(by["VOC-2"].tails, ["TEAM_Z"]);
  assert.equal(by["VOC-4"].why, "no-aircraft");
  assert.equal(by["VOC-4"].labeled, false);
  // AIRPORT 슬롯이 차 있으면 AIRCRAFT를 더 띄워도 못 날린다 — 수요로 세지 않는다
  const full = planDispatch(s, new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 2 } } }), NOW);
  assert.deepEqual((full.unserved ?? []).map((u) => u.flight).sort(), ["VOC-1", "VOC-2"]);
});

test("GROUND DELAY(ATC-62): 켜진 CI 혼잡은 그 AIRPORT의 AIRBORNE 한도를 하나 줄이고, 그림자면 그대로", () => {
  const delay = (enforced: boolean) => ({ airport: "VCDO", repo: VCDO, trigger: "congestion" as const, kind: "delay" as const, land: false, enforced, text: "CI 혼잡", evidence: [], since: new Date(NOW).toISOString() });
  const base = { sessions: [session("a", "TEAM_A"), session("b", "TEAM_B")], tickets: [ticket("VOC-130", { priority: 1 }), ticket("VOC-131", { priority: 2 })] };
  const plan = (enforced: boolean) => planDispatch(snap({ ...base, atfm: { mains: [], groundStops: [delay(enforced)] } }), new Map(), cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, airborne: { VCDO: 2 } } }), NOW);
  assert.deepEqual([plan(true).assign.length, plan(true).slots[0].limit], [1, 1]);
  assert.deepEqual([plan(false).assign.length, plan(false).slots[0].limit], [2, 2]);
});

test("REGISTRATION(ATC-67): `Team D` 세션도 tail:TEAM_D·tail:team-d를 받고, FLEET 항목(TEAM_D)의 RETIRED·rating을 따른다", async () => {
  const { DEFAULT_FLEET } = await import("./crew.ts");
  const s = snap({
    sessions: [session("b", "TEAM_B"), session("d", "Team D")],
    tickets: [ticket("VOC-90", { priority: 1, labels: ["tail:TEAM_D"] }), ticket("VOC-91", { priority: 1, labels: ["tail:team-d"] }), ticket("VOC-92")],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  // 제안의 aircraftName은 실제 세션 이름(FLIGHT PLAN 수신자, send-guard가 정확히 맞춰 본다)
  const tailed = p.assign.filter((a) => a.flight === "VOC-90" || a.flight === "VOC-91");
  assert.equal(tailed.length, 1);
  assert.equal(tailed[0].aircraftName, "Team D");
  assert.ok(!p.excluded.some((e) => /그 TEAM 세션이 없음/.test(e.reason)));
  // 등록부의 TEAM_D가 RETIRED면 `Team D` 세션도 RETIRED
  const retired = planDispatch(s, new Map(), cfg(), NOW, undefined, { defaults: DEFAULT_FLEET.defaults, aircraft: { TEAM_D: { retired: { reason: "x", at: daysAgo(1) } } } });
  assert.equal(retired.aircraft.find((a) => a.id === "d")?.reason, "RETIRED");
  // tail: 라벨의 표기도 REGISTRATION으로
  const { tailsOf } = await import("./dispatch.ts");
  assert.deepEqual([...tailsOf({ labels: ["tail:Team-D"] }, NOW)], ["TEAM_D"]);
});

test("CHECK 독립성(ATC-67): LOGBOOK의 옛 표기와 `Team D` 세션을 한 REGISTRATION(TEAM_D)으로 모은다", async () => {
  const { checkBuildersOf } = await import("./dispatch.ts");
  const b = checkBuildersOf({ flights: ["VOC-5"], prs: [] }, { code: "VCDO", repo: VCDO }, {
    logbook: [{ flight: "VOC-5", aircraft: "TEAM D", airport: "VCDO", pr: { repo: "chaehy5665/vocado_nextjs", number: 1, url: "", title: "" } }],
    pulls: [], claims: [], workspaces: [], sessions: [{ id: "d", name: "Team D" }], history: new Map([["d", ["VOC-5"]]]), team: new RegExp(DEFAULT_DISPATCH_CONFIG.teamPattern, "i"),
  });
  assert.deepEqual([...b.entries()], [["TEAM_D", ["VOC-5 LOGBOOK", "VOC-5 청구 기록"]]]);
});


test("AIRCRAFT health(ATC-86): cut LIMIT는 LIMIT처럼 배정하지 않고, RESUME·STALLED는 보여 주기만 한다(DISPATCH는 그대로)", () => {
  const h = (code: string, holds: boolean, extra = {}) => ({ code, level: "alert", since: daysAgo(0), detail: `${code} 원문`, next: "", holds, ...extra }) as Session["health"];
  const cutAt = new Date(NOW - 60 * 60_000).toISOString();
  const s = snap({
    sessions: [
      { ...session("b", "TEAM_B"), health: h("LIMIT", true, { cut: true, cutAt, resetsAt: new Date(NOW + 30 * 60_000).toISOString() }) },
      { ...session("c", "TEAM_C"), health: h("LIMIT", true, { cut: true, cutAt }) }, // reset을 모르는 cut
      { ...session("d", "TEAM_D"), health: h("RESUME", false, { cutAt }) },
      { ...session("e", "TEAM_E"), health: h("STALLED", false) },
    ],
    tickets: [ticket("VOC-170"), ticket("VOC-171")],
  });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  assert.deepEqual(
    p.aircraft.map((a) => `${a.name}:${a.available}:${a.reason}`),
    ["TEAM_B:false:HOLD · LIMIT (cut 11:00Z) until 12:30Z — LIMIT 원문", "TEAM_C:false:HOLD · LIMIT (cut 11:00Z) — LIMIT 원문", "TEAM_D:true:PARKED", "TEAM_E:true:PARKED"],
  );
});

// ── 파일 겹침(ATC-71) ──
const holderOf = (flight: string, paths: string[], team: string | null = "TEAM_A", wake: "L" | "M" | "H" = "M") => ({
  flight, team, airport: "VCDO", wake, files: new Map(paths.map((p) => [p, "STAND"])),
});
const bodies = (o: Record<string, string>) => new Map(Object.entries(o));
const factor = (p: ReturnType<typeof planDispatch>, flight: string, id: string) => p.assign.find((a) => a.flight === flight)?.factors.find((f) => f.id === id);

test("파일 겹침: 날고 있는 FLIGHT가 고치는 파일을 곧 고칠 FLIGHT는 점수가 깎이고, 상세에 파일·FLIGHT·팀이 보인다", () => {
  const s = snap({ sessions: [session("b", "TEAM_B")], tickets: [ticket("VOC-41"), ticket("VOC-42")] });
  const files = { holders: [holderOf("VOC-40", ["server/a.ts", "server/b.ts"])], bodies: bodies({ "VOC-41": "`server/a.ts` `server/b.ts`을 고친다" }) };
  const p = planDispatch(s, new Map(), cfg(), NOW, undefined, undefined, undefined, undefined, undefined, files);
  assert.deepEqual(p.assign.map((a) => a.flight), ["VOC-42"]); // 팀 하나에 FLIGHT 하나: 겹치지 않는 쪽이 먼저
  const off = planDispatch(snap({ sessions: [session("b", "TEAM_B")], tickets: [ticket("VOC-41")] }), new Map(), cfg(), NOW, undefined, undefined, undefined, undefined, undefined, files);
  const f = factor(off, "VOC-41", "overlap")!;
  assert.equal(f.value, 2);
  assert.equal(f.points, -2);
  assert.match(f.detail, /VOC-40\(TEAM_A\)가 고치는 server\/a\.ts, server\/b\.ts \(본문 → STAND\)/);
});

test("파일 겹침 WAKE 가중: 큰 FLIGHT일수록 더 깎인다", () => {
  const files = { holders: [holderOf("VOC-40", ["server/a.ts"])], bodies: bodies({ "VOC-41": "`server/a.ts`" }) };
  const at = (labels: string[]) => factor(planDispatch(snap({ sessions: [session("b", "TEAM_B")], tickets: [ticket("VOC-41", { labels })] }), new Map(), cfg(), NOW, undefined, undefined, undefined, undefined, undefined, files), "VOC-41", "overlap")!.points;
  assert.equal(at(["wake:M"]), -1);
  assert.equal(at(["wake:H"]), -2);
});

test("파일 겹침 HOLD 스위치: 꺼져 있으면 보여 주기만, 켜면 머지될 때까지 HOLD", () => {
  const s = snap({ sessions: [session("b", "TEAM_B")], tickets: [ticket("VOC-41")] });
  const files = { holders: [holderOf("VOC-40", ["server/a.ts", "server/b.ts"])], bodies: bodies({ "VOC-41": "`server/a.ts` `server/b.ts`" }) };
  const run = (c: DispatchConfig) => planDispatch(s, new Map(), c, NOW, undefined, undefined, undefined, undefined, undefined, files);
  const off = run(cfg());
  assert.deepEqual(off.assign.map((a) => a.flight), ["VOC-41"]);
  assert.deepEqual(off.overlapHolds, [{ flight: "VOC-41", blockedBy: ["VOC-40"], why: "파일 겹침 — VOC-40가 머지될 때까지", enforced: false }]);
  assert.match(factor(off, "VOC-41", "overlap")!.detail, /HOLD 스위치가 꺼져 있어/);
  assert.deepEqual(off.hold, []);
  const on = run(cfg({ overlap: { hold: true, holdFiles: 2 } }));
  assert.deepEqual(on.assign, []);
  assert.deepEqual(on.hold, [{ flight: "VOC-41", blockedBy: ["VOC-40"], why: "파일 겹침 — VOC-40가 머지될 때까지" }]);
  // 파일 하나만 겹치면 무겁지 않아 HOLD하지 않는다
  const one = planDispatch(s, new Map(), cfg({ overlap: { hold: true, holdFiles: 2 } }), NOW, undefined, undefined, undefined, undefined, undefined, { ...files, bodies: bodies({ "VOC-41": "`server/a.ts`" }) });
  assert.deepEqual(one.assign.map((a) => a.flight), ["VOC-41"]);
});

test("같은 팀 이어가기: 그 파일을 만지는 팀이 그 팀뿐이면 그 팀에 보너스, 다른 팀은 겹침으로 깎이고 HOLD는 걸지 않는다", () => {
  const s = snap({ sessions: [session("a", "TEAM_A"), session("b", "TEAM_B")], tickets: [ticket("VOC-41")] });
  const files = { holders: [holderOf("VOC-40", ["server/a.ts", "server/b.ts"])], bodies: bodies({ "VOC-41": "`server/a.ts` `server/b.ts`" }) };
  const p = planDispatch(s, new Map(), cfg({ overlap: { hold: true, holdFiles: 2 } }), NOW, undefined, undefined, undefined, undefined, undefined, files);
  assert.deepEqual(p.assign.map((a) => `${a.flight}→${a.aircraftName}`), ["VOC-41→TEAM_A"]);
  const same = factor(p, "VOC-41", "overlapSame")!;
  assert.equal(same.points, 1);
  assert.match(same.detail, /이어 함/);
  assert.equal(factor(p, "VOC-41", "overlap")!.value, 0);
  assert.deepEqual(p.hold, []);
  // 다른 팀도 그 파일을 만지면 보너스가 없다
  const both = { ...files, holders: [...files.holders, holderOf("VOC-43", ["server/a.ts"], "TEAM_C")] };
  const q = planDispatch(s, new Map(), cfg(), NOW, undefined, undefined, undefined, undefined, undefined, both);
  assert.equal(factor(q, "VOC-41", "overlapSame"), undefined);
});
