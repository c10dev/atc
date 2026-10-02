import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, type DispatchConfig, planDispatch, waitsToLandOf, WAITING_BLOCKS } from "./dispatch.ts";
import { elsewhereOf } from "./elsewhere.ts";
import { DEFAULT_FLEET } from "./fleet.ts";
import { computeMetrics } from "./metrics.ts";
import type { Claim, Clearance, PullRequest, Session, Snapshot, Ticket, Workspace } from "./model.ts";
import { formatFlightPlan, type Proposal } from "./proposals.ts";
import { keptStandClaims } from "./snapshot.ts";

// 착륙만 기다리는 FLIGHT는 AIRCRAFT의 슬롯을 쓰지 않는다(VOC-387)
const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const REPO = "/home/c10/projects/vocado_nextjs";
const WT = "/home/c10/projects/worktrees";

const session = (id: string, name: string, status: Session["status"] = "idle"): Session => ({ id, agent: "claude", name, status, pid: 1, cwd: REPO, startedAt: ago(600), lastActiveAt: ago(1), repo: REPO, workspacePath: REPO });
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({ key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: ago(60), project: "Beta Readiness", labels: [], createdAt: ago(900), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], ...over }) as Ticket;
const started = (key: string) => ticket(key, { state: "In Progress", stateType: "started" });
const ws = (key: string): Workspace => ({ path: `${WT}/${key.toLowerCase()}`, name: key.toLowerCase(), repo: REPO, isMain: false, branch: key.toLowerCase(), head: "", dirty: 0, lastCommitAt: null, ticketKey: key });
const claim = (sessionId: string, key: string, over: Partial<Claim> = {}): Claim => ({ sessionId, workspacePath: `${WT}/${key.toLowerCase()}`, since: ago(300), lastAt: ago(5), source: "hook", tool: null, state: "active", handedOffTo: null, ...over });
const pr = (n: number, key: string, blocks: string[] = [], over: Partial<PullRequest> = {}): PullRequest =>
  ({ repo: REPO, number: n, title: "", url: "", branch: key.toLowerCase(), head: "abc1234", base: "main", ticketKey: key, standPath: `${WT}/${key.toLowerCase()}`, draft: false, landing: blocks.length ? "APPROACH" : "CLEARED", blocks: blocks.map((code) => ({ code, text: code, en: code })), readyAt: null, createdAt: ago(60), ...over }) as PullRequest;
const clearance = (type: Clearance["type"], flight: string, over: Partial<Clearance> = {}): Clearance => ({ id: "C-1", at: ago(10), to: "a", toName: "TEAM_A", type, stand: `${WT}/${flight.toLowerCase()}`, flight, text: "t", readbackAt: null, cancelledAt: null, ...over });

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    at: new Date(NOW).toISOString(), linear: { enabled: true, error: null, fetchedAt: ago(0) }, github: { enabled: true, error: null, fetchedAt: ago(0) }, pulls: [], atfm: { mains: [], groundStops: [] },
    sessions: [], workspaces: [], tickets: [], columns: [], claims: [], handoffs: [], alerts: [], clearances: [], airports: [{ id: "r1", code: "VCDO", name: "vocado_nextjs", repo: REPO }], ...over,
  };
}
const cfg = (over: Partial<DispatchConfig> = {}): DispatchConfig => ({ ...DEFAULT_DISPATCH_CONFIG, ...over });
const acOf = (p: ReturnType<typeof planDispatch>, id: string) => p.aircraft.find((a) => a.id === id)!;

test("waitsToLandOf: CLEARED와 기다리는 막힘뿐인 PR만 참, 고칠 것이 있거나 초안·열린 FIX·GO AROUND면 거짓", () => {
  assert.equal(waitsToLandOf([pr(1, "VOC-1")], false), true); // CLEARED
  for (const code of WAITING_BLOCKS) assert.equal(waitsToLandOf([pr(1, "VOC-1", [code])], false), true, code);
  for (const code of ["checks-failed", "review-findings", "changes-requested", "dirty", "behind", "blocked", "draft", "no-checks", "los"]) assert.equal(waitsToLandOf([pr(1, "VOC-1", [code])], false), false, code);
  assert.equal(waitsToLandOf([pr(1, "VOC-1", ["checks-pending", "checks-failed"])], false), false); // 섞이면 할 일이 있다
  assert.equal(waitsToLandOf([pr(1, "VOC-1", [], { draft: true })], false), false);
  assert.equal(waitsToLandOf([pr(1, "VOC-1")], true), false); // 열린 FIX·GO AROUND
  assert.equal(waitsToLandOf([], false), false); // PR 없음
  assert.equal(waitsToLandOf([pr(1, "VOC-1"), pr(2, "VOC-1", ["dirty"])], false), false); // 한 PR이라도 할 일이 있으면
});

test("기본 상한은 2건", () => {
  assert.equal(DEFAULT_DISPATCH_CONFIG.slots.waitingPr, 2);
});

test("기다리는 PR만 쥔 AIRCRAFT는 다음 FLIGHT를 받는다(예전에는 PR 머지 전이라 멈춘 팀)", () => {
  const s = snap({ sessions: [session("a", "TEAM_A")], workspaces: [ws("VOC-1")], claims: [claim("a", "VOC-1")], tickets: [started("VOC-1"), ticket("VOC-2")], pulls: [pr(10, "VOC-1", ["no-review"])] });
  const p = planDispatch(s, new Map(), cfg(), NOW);
  const a = acOf(p, "a");
  assert.equal(a.available, true);
  assert.deepEqual(a.waiting, ["VOC-1"]);
  assert.match(a.reason, /착륙 대기 PR 1건/);
  const plan = p.assign.find((x) => x.flight === "VOC-2");
  assert.equal(plan?.aircraftName, "TEAM_A");
  assert.deepEqual(plan?.waiting, ["VOC-1"]); // FLIGHT PLAN이 새 STAND 줄을 싣는다
  assert.equal(p.excluded.some((e) => e.reason.includes("멈춤")), false);
});

test("고칠 것이 있으면 슬롯을 계속 쓴다: 체크 실패·리뷰 지적·충돌·초안·PR 없음·열린 FIX·GO AROUND", () => {
  const base = (prs: PullRequest[], clearances: Clearance[] = []) =>
    planDispatch(snap({ sessions: [session("a", "TEAM_A")], workspaces: [ws("VOC-1")], claims: [claim("a", "VOC-1")], tickets: [started("VOC-1"), ticket("VOC-2")], pulls: prs, clearances }), new Map(), cfg(), NOW);
  for (const code of ["checks-failed", "review-findings", "dirty", "changes-requested"]) assert.equal(acOf(base([pr(10, "VOC-1", [code])]), "a").available, false, code);
  assert.equal(acOf(base([pr(10, "VOC-1", [], { draft: true })]), "a").available, false);
  assert.equal(acOf(base([]), "a").available, false); // PR 없음
  assert.equal(acOf(base([pr(10, "VOC-1")], [clearance("FIX", "VOC-1")]), "a").available, false);
  assert.equal(acOf(base([pr(10, "VOC-1")], [clearance("GO AROUND", "VOC-1")]), "a").available, false);
  // 이미 READBACK한 FIX는 열린 것이 아니다
  assert.equal(acOf(base([pr(10, "VOC-1")], [clearance("FIX", "VOC-1", { readbackAt: ago(2) })]), "a").available, true);
});

test("상한: 기다리는 PR이 waitingPr건에 닿으면 새 FLIGHT를 받지 않고, 상한 안이면 받는다", () => {
  const mk = (n: number, cap: number) => {
    const keys = Array.from({ length: n }, (_, i) => `VOC-${i + 1}`);
    return planDispatch(
      snap({ sessions: [session("a", "TEAM_A")], workspaces: keys.map(ws), claims: keys.map((k) => claim("a", k)), tickets: [...keys.map(started), ticket("VOC-9")], pulls: keys.map((k, i) => pr(10 + i, k)) }),
      new Map(),
      cfg({ slots: { ...DEFAULT_DISPATCH_CONFIG.slots, waitingPr: cap } }),
      NOW,
    );
  };
  assert.equal(acOf(mk(1, 2), "a").available, true);
  const full = acOf(mk(2, 2), "a");
  assert.equal(full.available, false);
  assert.match(full.reason, /상한 2/);
  assert.equal(full.resting, true); // STAND 없는 FLIGHT는 여전히 받는다
  assert.equal(acOf(mk(2, 3), "a").available, true);
});

test("새 STAND에서 일하는 FLIGHT는 슬롯을 쓰고, 기다리는 FLIGHT와 함께여도 perTeam을 넘기지 않는다", () => {
  const s = snap({
    sessions: [session("a", "TEAM_A")],
    workspaces: [ws("VOC-1"), ws("VOC-2")],
    claims: [claim("a", "VOC-1"), claim("a", "VOC-2")],
    tickets: [started("VOC-1"), started("VOC-2"), ticket("VOC-3")],
    pulls: [pr(10, "VOC-1", ["no-review"])], // VOC-2는 PR 없음: 일하는 중
  });
  const a = acOf(planDispatch(s, new Map(), cfg(), NOW), "a");
  assert.equal(a.available, false); // 일하는 FLIGHT가 슬롯을 쓴다
  assert.deepEqual(a.waiting, ["VOC-1"]);
});

test("세션이 없는 AIRCRAFT(ABSENT)도 같다: 기다리는 tail FLIGHT는 슬롯을 쓰지 않고 상한이 있다", () => {
  const mk = (n: number) => {
    const keys = Array.from({ length: n }, (_, i) => `VOC-${i + 1}`);
    return planDispatch(
      snap({ absent: [{ registration: "TEAM_Z" }] as never, tickets: [...keys.map((k) => ({ ...started(k), labels: ["tail:TEAM_Z"] })), ticket("VOC-9")], pulls: keys.map((k, i) => pr(10 + i, k)) }),
      new Map(),
      cfg(),
      NOW,
      undefined,
      { ...DEFAULT_FLEET, aircraft: { TEAM_Z: { base: "VCDO" } } } as never,
    );
  };
  const one = acOf(mk(1), "absent:TEAM_Z");
  assert.equal(one.available, true);
  assert.deepEqual(one.waiting, ["VOC-1"]);
  assert.equal(acOf(mk(2), "absent:TEAM_Z").available, false); // 상한
});

test("FLIGHT PLAN은 기다리는 FLIGHT가 있을 때만 '새 STAND에서 시작' 줄을 싣는다", () => {
  const p = { id: "D-1", flight: "VOC-2", airport: "ATCC", hold: [], caution: false, note: null, status: "approved" } as unknown as Proposal;
  const plain = formatFlightPlan(p, { title: "T", url: "https://l/VOC-2", priority: 2 }, "TEAM_A");
  assert.doesNotMatch(plain, /NEW STAND/);
  const w = formatFlightPlan({ ...p, waitingFlights: ["VOC-1"] } as Proposal, { title: "T", url: "https://l/VOC-2", priority: 2 }, "TEAM_A");
  assert.match(w, /STAND: .*1.* only waits to land in its own STAND\. Start this FLIGHT in a NEW STAND/);
  assert.match(w, /FIX or GO AROUND for the earlier PR still reaches you: handle it in the earlier STAND/);
});

test("keptStandClaims: 열린 PR이 있는 STAND의 오래된 점유는 살아 있는 세션 것만, STAND마다 하나, 다른 세션이 쥔 STAND는 그 세션 것", () => {
  const old = (sid: string, key: string, lastAtMin: number) => claim(sid, key, { lastAt: ago(lastAtMin) });
  const prs = [{ standPath: `${WT}/voc-1` }, { standPath: `${WT}/voc-3` }];
  const live = (id: string) => (id === "dead" ? "dead" : id === "gone" ? undefined : "idle");
  const hook = [old("a", "VOC-1", 600), old("b", "VOC-1", 900), old("dead", "VOC-3", 600), old("a", "VOC-4", 600), old("gone", "VOC-1", 700), old("a", "VOC-5", 5)];
  const out = keptStandClaims(hook, [], prs, live);
  assert.deepEqual(out.map((c) => `${c.sessionId}|${c.workspacePath.split("/").pop()}`), ["a|voc-1"]); // 가장 최근에 건드린 a, 죽은·없는 세션과 PR 없는 STAND는 뺀다
  // 다른 세션이 지금 쥔 STAND는 건드리지 않는다
  assert.deepEqual(keptStandClaims(hook, [claim("c", "VOC-1")], prs, live), []);
});

test("elsewhereOf: 이 STAND가 아닌 다른 STAND에서 진행 중인 FLIGHT를 쥔 세션이면 그 FLIGHT, 아니면 null", () => {
  const s = { claims: [claim("a", "VOC-1"), claim("a", "VOC-2"), claim("b", "VOC-1")], workspaces: [ws("VOC-1"), ws("VOC-2")], tickets: [started("VOC-1"), started("VOC-2")] };
  assert.equal(elsewhereOf("a", `${WT}/voc-1`, "VOC-1", s), "VOC-2");
  assert.equal(elsewhereOf("b", `${WT}/voc-1`, "VOC-1", s), null);
  assert.equal(elsewhereOf("a", `${WT}/voc-1`, "VOC-1", { ...s, tickets: [started("VOC-1"), ticket("VOC-2", { state: "Done", stateType: "completed" })] }), null); // 다른 FLIGHT가 이미 끝남
  assert.equal(elsewhereOf("a", `${WT}/voc-1`, "VOC-1", { ...s, claims: [claim("a", "VOC-2", { state: "handed-off" })] }), null);
});

test("메트릭: FIX·GO AROUND READBACK 시간을 다른 FLIGHT 중과 바로로 나누고, 옛 기록은 어느 쪽에도 넣지 않는다", () => {
  const cl = (id: string, type: Clearance["type"], elsewhere: string | null | undefined, minToReadback: number | null): Clearance => ({
    ...clearance(type, "VOC-1", { id }),
    at: ago(120),
    readbackAt: minToReadback === null ? null : new Date(NOW - 120 * 60_000 + minToReadback * 60_000).toISOString(),
    ...(elsewhere === undefined ? {} : { elsewhere }),
  });
  const m = computeMetrics([], [cl("C-1", "FIX", "VOC-2", 10), cl("C-2", "GO AROUND", "VOC-3", 20), cl("C-3", "FIX", null, 2), cl("C-4", "FIX", null, 4), cl("C-5", "FIX", undefined, 99), cl("C-6", "LAND", "VOC-2", 50), cl("C-7", "FIX", "VOC-2", null)], NOW, 7);
  assert.deepEqual(m.clearances.fixReadback.elsewhere, { n: 3, readBack: 2, medianMin: 15 });
  assert.deepEqual(m.clearances.fixReadback.direct, { n: 2, readBack: 2, medianMin: 3 });
});
