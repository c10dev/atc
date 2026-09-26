import assert from "node:assert/strict";
import { test } from "node:test";
import { fold } from "./clearances.ts";
import { buildBrief, formatClearance, resolveSession } from "./controller.ts";
import { diffSnapshots, EventLog } from "./events.ts";
import type { Alert, Claim, Clearance, Session, Snapshot, Ticket, Workspace } from "./model.ts";

const WT = "/home/c10/projects/worktrees";
const T0 = Date.parse("2026-09-26T07:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const session = (id: string, name: string, status: Session["status"] = "idle"): Session => ({
  id, agent: "claude", name, status, pid: 1, cwd: "/home/c10/projects/vocado_nextjs",
  startedAt: iso(-600), lastActiveAt: iso(0), repo: null, workspacePath: null,
});
const ws = (name: string, ticketKey: string | null): Workspace => ({
  path: `${WT}/${name}`, name, repo: "/home/c10/projects/vocado_nextjs", isMain: false,
  branch: null, head: "", dirty: 0, lastCommitAt: null, ticketKey,
});
const claim = (sessionId: string, wsName: string, since: number, lastAt: number): Claim => ({
  sessionId, workspacePath: `${WT}/${wsName}`, since: iso(since), lastAt: iso(lastAt),
  source: "hook", tool: null, state: "active", handedOffTo: null,
});
const ticket = (key: string, state: string, updatedAt: number): Ticket => ({
  key, title: `${key} title`, state, stateType: "started", stateColor: null,
  project: null, labels: [], createdAt: null, startedAt: null, blocks: [], blockedBy: [], related: [],
  parent: null, children: [], assignee: null, priority: 0, url: null, updatedAt: iso(updatedAt),
});

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    at: iso(0), linear: { enabled: true, error: null, fetchedAt: iso(0) },
    sessions: [session("s-b", "TEAM_B"), session("s-d", "TEAM_D"), session("s-p", "President")],
    workspaces: [ws("vocado-voc-175", "VOC-175"), ws("vocado-voc-191", "VOC-191")],
    tickets: [ticket("VOC-175", "In Progress", -30), ticket("VOC-191", "Ready to Merge", -20)],
    columns: [], airports: [], claims: [], handoffs: [], alerts: [], clearances: [],
    ...over,
  };
}

const conflict: Alert = { kind: "conflict", message: "x", workspacePath: `${WT}/vocado-voc-175`, sessionIds: ["s-b", "s-d"] };

test("스냅샷 차이 → 경보 발생·해제, HANDOFF, LANDING SEQUENCE 진입, NORDO", () => {
  const prev = snapshot({ claims: [claim("s-p", "vocado-voc-191", -50, -40)] });
  const next = snapshot({
    alerts: [conflict],
    handoffs: [{ workspacePath: `${WT}/vocado-voc-191`, from: "s-p", to: "s-b", at: iso(-5) }],
    tickets: [ticket("VOC-175", "Ready to Merge", 0), ticket("VOC-191", "Done", 0)],
    sessions: [session("s-b", "TEAM_B"), session("s-d", "TEAM_D"), session("s-p", "President", "dead")],
  });
  const kinds = diffSnapshots(prev, next).map((e) => `${e.kind}:${e.alertKind ?? e.ticketKey ?? e.sessionIds?.join(">") ?? ""}`);
  assert.deepEqual(kinds.sort(), [
    "alert.raised:conflict",
    "handoff:s-p>s-b",
    "landing.left:VOC-191",
    "landing.requested:VOC-175",
    "session.lost:s-p",
  ]);
  assert.deepEqual(diffSnapshots(next, snapshot()).map((e) => e.kind).filter((k) => k === "alert.cleared"), ["alert.cleared"]);
  assert.deepEqual(diffSnapshots(null, next), []);
});

test("서버가 막 떠서 덜 읽힌 스냅샷과는 비교하지 않는다", () => {
  const cold = snapshot({ linear: { enabled: true, error: null, fetchedAt: null }, tickets: [] });
  const warm = snapshot({ alerts: [conflict] });
  assert.deepEqual(diffSnapshots(cold, warm), []);
  const dirtyUnknown = snapshot({ workspaces: [{ ...ws("vocado-voc-175", "VOC-175"), dirty: null }] });
  assert.deepEqual(diffSnapshots(dirtyUnknown, warm), []);
  assert.equal(diffSnapshots(snapshot(), warm).length, 1);
});

test("이벤트 커서: 이어 읽기와 재시작 감지", () => {
  const log = new EventLog();
  log.push([{ kind: "handoff" }, { kind: "landing.requested", ticketKey: "VOC-1" }]);
  const first = log.since(null);
  assert.equal(first.events.length, 2);
  assert.equal(first.reset, false);
  log.push([{ kind: "landing.left", ticketKey: "VOC-1" }]);
  assert.deepEqual(log.since(first.cursor).events.map((e) => e.kind), ["landing.left"]);
  const restarted = log.since("oldepoch:5");
  assert.equal(restarted.reset, true);
  assert.equal(restarted.events.length, 3);
});

test("CLEARANCE 기록 접기: READBACK·취소는 한 번만", () => {
  const issue = { op: "issue" as const, id: "C-0001", at: iso(0), to: "s-b", toName: "TEAM_B", type: "HOLD" as const, stand: null, flight: null, text: "대기" };
  const [c] = fold([issue, { op: "readback", id: "C-0001", at: iso(2) }, { op: "readback", id: "C-0001", at: iso(5) }, { op: "cancel", id: "C-9999", at: iso(1) }]);
  assert.equal(c.readbackAt, iso(2));
  assert.equal(c.cancelledAt, null);
});

test("브리핑: 충돌은 먼저 들어온 순, LANDING SEQUENCE, NO READBACK CLEARANCE", () => {
  const s = snapshot({
    alerts: [conflict],
    claims: [claim("s-d", "vocado-voc-175", -20, -1), claim("s-b", "vocado-voc-175", -40, -2), claim("s-p", "vocado-voc-191", -30, -3)],
  });
  const pending: Clearance = {
    id: "C-0003", at: iso(-15), to: "s-d", toName: "TEAM_D", type: "HOLD", stand: `${WT}/vocado-voc-175`,
    flight: "VOC-175", text: "대기", readbackAt: null, cancelledAt: null,
  };
  const brief = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [pending], T0);
  assert.deepEqual(brief.open.conflicts[0].sessions.map((x) => x.callsign), ["BRAVO", "DELTA"]);
  assert.equal(brief.landingQueue.length, 1);
  assert.equal(brief.landingQueue[0].flight, "VOC191");
  assert.deepEqual(brief.landingQueue[0].stands[0].holders.map((h) => h.name), ["President"]);
  assert.deepEqual(brief.clearances.overdue, ["C-0003"]);
  assert.equal(brief.clearances.pending[0].stand, "vocado-voc-175");
  assert.deepEqual(brief.traffic.map((t) => t.callsign).sort(), ["BRAVO", "DELTA", "President"]);
});

test("세션 찾기: 이름·콜사인·ID, 겹치는 이름은 거절", () => {
  const s = snapshot({ sessions: [session("s-b", "TEAM_B"), session("x1", "Design"), session("x2", "Design")] });
  assert.equal((resolveSession(s, "TEAM_B") as Session).id, "s-b");
  assert.equal((resolveSession(s, "bravo") as Session).id, "s-b");
  assert.equal((resolveSession(s, "x2") as Session).id, "x2");
  assert.match(resolveSession(s, "Design") as string, /2개/);
  assert.match(resolveSession(s, "nobody") as string, /찾을 수 없음/);
});

test("CLEARANCE 문구: 콜사인·STAND·FLIGHT·READBACK 요청", () => {
  const c: Clearance = {
    id: "C-0007", at: iso(0), to: "s-b", toName: "TEAM_B", type: "HOLD", stand: `${WT}/vocado-voc-175`,
    flight: "VOC-175", text: "DELTA 작업이 끝날 때까지 대기", readbackAt: null, cancelledAt: null,
  };
  assert.equal(
    formatClearance(c, snapshot()),
    '[ATC C-0007] BRAVO (TEAM_B) · HOLD\nSTAND vocado-voc-175 · FLIGHT VOC175\nDELTA 작업이 끝날 때까지 대기\n— 받았으면 이 메시지에 "READBACK C-0007"로 답장해 주세요.',
  );
});

test("OUTSTATION: 소속 AIRPORT 밖 STAND 점유, HANDOFF된 것과 소속 모르는 세션은 제외", async () => {
  const { awayOperations } = await import("./away.ts");
  const VCDO = "/home/c10/projects/vocado_nextjs";
  const TNNS = "/home/c10/projects/tennis";
  const tennisWs: Workspace = { ...ws("tennis-character", null), repo: TNNS };
  const s = snapshot({
    sessions: [
      { ...session("s-b", "TEAM_B"), repo: VCDO },
      { ...session("s-d", "TEAM_D"), repo: VCDO },
      session("s-x", "structure"),
    ],
    workspaces: [ws("vocado-voc-175", "VOC-175"), tennisWs],
    claims: [
      claim("s-b", "vocado-voc-175", -30, -1),
      claim("s-b", "tennis-character", -20, -2),
      { ...claim("s-d", "tennis-character", -60, -50), state: "handed-off", handedOffTo: "s-b" },
      claim("s-x", "tennis-character", -10, -5),
    ],
  });
  assert.deepEqual([...awayOperations(s)], [["s-b", [TNNS]]]);

  const before = snapshot({ ...s, claims: s.claims.filter((c) => c.workspacePath !== tennisWs.path || c.sessionId !== "s-b") });
  assert.deepEqual(
    diffSnapshots(before, s).filter((e) => e.kind.startsWith("away")).map((e) => `${e.kind}:${e.sessionIds}:${e.repo}`),
    [`away.started:s-b:${TNNS}`],
  );
  assert.deepEqual(diffSnapshots(s, before).filter((e) => e.kind.startsWith("away")).map((e) => e.kind), ["away.ended"]);

  const withCodes = { ...s, airports: [{ id: "1", repo: VCDO, name: "vocado_nextjs", code: "VCDO" }, { id: "2", repo: TNNS, name: "tennis", code: "TNNS" }] };
  const bravo = buildBrief(withCodes, { events: [], reset: false, cursor: "e:0" }, [], T0).traffic.find((t) => t.name === "TEAM_B")!;
  assert.equal(bravo.home, "VCDO");
  assert.deepEqual(bravo.away, ["TNNS"]);
  assert.deepEqual(bravo.stands.map((x) => x.airport).sort(), ["TNNS", "VCDO"]);
});
