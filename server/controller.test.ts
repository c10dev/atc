import assert from "node:assert/strict";
import { test } from "node:test";
import { fold } from "./clearances.ts";
import { buildBrief, formatClearance, landTextOf, resolveSession } from "./controller.ts";
import { DEFAULT_ATFM } from "./atfm.ts";
import { diffSnapshots, EventLog } from "./events.ts";
import type { Alert, Claim, Clearance, LandingBlockCode, PullRequest, Session, Snapshot, Ticket, Workspace } from "./model.ts";

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
  parent: null, children: [], assignee: null, takenBy: null, priority: 0, url: null, updatedAt: iso(updatedAt),
});

const VCDO = "/home/c10/projects/vocado_nextjs";
const pr = (number: number, ticketKey: string | null, over: Partial<PullRequest> = {}, codes: LandingBlockCode[] = []): PullRequest => ({
  repo: VCDO, number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`,
  branch: `claude/${ticketKey?.toLowerCase() ?? number}`, head: `head${number}abcdef`, base: "main", ticketKey,
  standPath: ticketKey ? `${WT}/vocado-${ticketKey.toLowerCase()}` : null, draft: false,
  landing: codes.length ? "APPROACH" : "CLEARED", blocks: codes.map((code) => ({ code, text: code })),
  readyAt: codes.length ? null : iso(-10), createdAt: iso(-100 + number),
  ...over,
});

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    at: iso(0), linear: { enabled: true, error: null, fetchedAt: iso(0) },
    github: { enabled: true, error: null, fetchedAt: iso(0) },
    atfm: { mains: [], groundStops: [] },
    pulls: [pr(10, "VOC-191", {}, ["behind"])],
    sessions: [session("s-b", "TEAM_B"), session("s-d", "TEAM_D"), session("s-p", "President")],
    workspaces: [ws("vocado-voc-175", "VOC-175"), ws("vocado-voc-191", "VOC-191")],
    tickets: [ticket("VOC-175", "In Progress", -30), ticket("VOC-191", "In Review", -20)],
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
    pulls: [pr(11, "VOC-175", {}, ["checks-pending"]), pr(12, "VOC-180", { draft: true }, ["draft"])],
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
  const warm = snapshot({ alerts: [conflict] });
  const cold = snapshot({ linear: { enabled: true, error: null, fetchedAt: null }, tickets: [] });
  const noGithubYet = snapshot({ github: { enabled: true, error: null, fetchedAt: null }, pulls: [] });
  assert.deepEqual(diffSnapshots(noGithubYet, warm), []);
  // gh가 실패만 해도 충돌 이벤트는 나간다. LANDING 비교는 양쪽 다 PR을 읽었을 때만
  const ghFailed = snapshot({ github: { enabled: true, error: "gh: auth", fetchedAt: null }, pulls: [] });
  assert.deepEqual(diffSnapshots(ghFailed, warm).map((e) => e.kind), ["alert.raised"]);
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
  assert.equal(brief.landingQueue[0].stand, "vocado-voc-191");
  assert.deepEqual(brief.landingQueue[0].holders.map((h) => h.name), ["President"]);
  assert.deepEqual(brief.clearances.overdue, ["C-0003"]);
  assert.equal(brief.clearances.pending[0].stand, "vocado-voc-175");
  assert.deepEqual(brief.traffic.map((t) => t.callsign).sort(), ["BRAVO", "DELTA", "President"]);
});

test("LAND 문구: 같은 저장소·base의 첫 PR은 지금 LANDING, 그 뒤는 앞 PR 머지 뒤 rebase, AIRPORT·FLIGHT 없으면 괄호 없음", () => {
  assert.equal(landTextOf(1, "VCDO", 389, "VOC52", null), "LANDING sequence 1 (VCDO): PR #389 (VOC52). Clear to LAND now — check that base is current before merging.");
  assert.equal(landTextOf(2, "VCDO", 393, "VOC191", 389), "LANDING sequence 2 (VCDO): PR #393 (VOC191). Rebase and LAND after the PR ahead (#389) merges.");
  assert.equal(landTextOf(3, null, 40, null, 393), "LANDING sequence 3: PR #40. Rebase and LAND after the PR ahead (#393) merges.");
});

test("브리핑: CLEARED PR에만 landText, 순서와 앞 PR은 같은 저장소·base 안에서만(두 저장소가 섞여도)", () => {
  const TNNS = "/home/c10/projects/tennis";
  const s = snapshot({
    airports: [{ id: "1", repo: VCDO, name: "vocado_nextjs", code: "VCDO" }, { id: "2", repo: TNNS, name: "tennis", code: "TNNS" }] as Snapshot["airports"],
    pulls: [
      pr(21, "VOC-52", { readyAt: iso(-9) }),
      pr(5, null, { repo: TNNS, readyAt: iso(-8) }),
      pr(22, null, {}, ["behind"]),
      pr(23, "VOC-191", { readyAt: iso(-5) }),
      pr(6, null, { repo: TNNS, readyAt: iso(-3) }),
      pr(24, null, { base: "release", readyAt: iso(-1) }),
    ],
  });
  const q = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0).landingQueue;
  const byPr = new Map(q.map((x) => [x.pr.number, x]));
  assert.deepEqual([21, 5, 23, 6, 24].map((n) => [byPr.get(n)!.seq, byPr.get(n)!.repoSeq]), [[1, 1], [2, 1], [3, 2], [4, 2], [5, 1]]);
  assert.equal(byPr.get(21)!.landText, "LANDING sequence 1 (VCDO): PR #21 (VOC52). Clear to LAND now — check that base is current before merging.");
  assert.equal(byPr.get(5)!.landText, "LANDING sequence 1 (TNNS): PR #5. Clear to LAND now — check that base is current before merging.");
  assert.equal(byPr.get(22)!.landText, null); // APPROACH
  assert.equal(byPr.get(22)!.repoSeq, null);
  assert.equal(byPr.get(23)!.landText, "LANDING sequence 2 (VCDO): PR #23 (VOC191). Rebase and LAND after the PR ahead (#21) merges.");
  assert.equal(byPr.get(6)!.landText, "LANDING sequence 2 (TNNS): PR #6. Rebase and LAND after the PR ahead (#5) merges.");
  assert.equal(byPr.get(24)!.landText, "LANDING sequence 1 (VCDO): PR #24. Clear to LAND now — check that base is current before merging."); // 다른 base
});

test("세션 찾기: 이름·콜사인·ID, 겹치는 이름은 거절", () => {
  const s = snapshot({ sessions: [session("s-b", "TEAM_B"), session("x1", "Design"), session("x2", "Design")] });
  assert.equal((resolveSession(s, "TEAM_B") as Session).id, "s-b");
  assert.equal((resolveSession(s, "bravo") as Session).id, "s-b");
  assert.equal((resolveSession(s, "x2") as Session).id, "x2");
  assert.match(resolveSession(s, "Design") as string, /2개/);
  assert.match(resolveSession(s, "nobody") as string, /찾을 수 없음/);
});

test("CLEARANCE 문구: 콜사인·STAND·FLIGHT·W/U 끝줄(HOLD는 READBACK·UNABLE·STANDBY)", () => {
  const c: Clearance = {
    id: "C-0007", at: iso(0), to: "s-b", toName: "TEAM_B", type: "HOLD", stand: `${WT}/vocado-voc-175`,
    flight: "VOC-175", text: "DELTA 작업이 끝날 때까지 대기", readbackAt: null, cancelledAt: null,
  };
  assert.equal(
    formatClearance(c, snapshot()),
    '[ATC C-0007] BRAVO (TEAM_B) · HOLD\nSTAND vocado-voc-175 · FLIGHT VOC175\nDELTA 작업이 끝날 때까지 대기\n— Send your reply to the session name "TOWER" (SendMessage to: "TOWER"), not to the from address: the address changes when TOWER restarts.\n— Reply to this message with "READBACK C-0007" if you take it, "UNABLE C-0007 — reason" if you cannot, or "STANDBY C-0007" if you need time.',
  );
  // INFO·TRAFFIC·REPORT는 R: ROGER만 청한다(ATC-122)
  assert.ok(formatClearance({ ...c, type: "INFO" }, snapshot()).endsWith('— When received, reply to this message with "ROGER C-0007".'));
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

test("LANDING 이벤트: CLEARED가 됨, 손써야 할 막힘이 새로 생길 때만 landing.blocked", () => {
  const at = (pulls: PullRequest[]) => snapshot({ pulls });
  const kinds = (a: PullRequest[], b: PullRequest[]) =>
    diffSnapshots(at(a), at(b)).map((e) => `${e.kind}:${e.pull}${e.blocks ? `:${e.blocks.join("+")}` : ""}`);

  assert.deepEqual(kinds([pr(10, "VOC-191", {}, ["behind"])], [pr(10, "VOC-191")]), ["landing.cleared:10"]);
  // 처음부터 CLEARED로 들어오면 진입과 CLEARED 둘 다
  assert.deepEqual(kinds([], [pr(10, "VOC-191")]), ["landing.requested:10:", "landing.cleared:10"]);
  // 새 push: CI 진행 중은 기다리면 되지만 리뷰가 이전 커밋에만 있는 것은 새 막힘
  assert.deepEqual(kinds([pr(10, "VOC-191")], [pr(10, "VOC-191", {}, ["checks-pending", "review-stale"])]), [
    "landing.blocked:10:checks-pending+review-stale",
  ]);
  assert.deepEqual(kinds([pr(10, "VOC-191")], [pr(10, "VOC-191", {}, ["checks-pending", "merge-unknown"])]), []);
  // 막힘이 줄기만 하면 조용히
  assert.deepEqual(kinds([pr(10, "VOC-191", {}, ["behind", "no-review"])], [pr(10, "VOC-191", {}, ["no-review"])]), []);
  assert.deepEqual(kinds([pr(10, "VOC-191", {}, ["no-review"])], [pr(10, "VOC-191", {}, ["no-review", "checks-failed"])]), [
    "landing.blocked:10:no-review+checks-failed",
  ]);
  // Draft로 돌아가면 LANDING SEQUENCE를 떠난다
  assert.deepEqual(kinds([pr(10, "VOC-191")], [pr(10, "VOC-191", { draft: true }, ["draft"])]), ["landing.left:10"]);
});

test("브리핑 LANDING SEQUENCE: CLEARED 순번, Draft 제외, LAND CLEARANCE는 이 PR을 연 뒤 같은 STAND로 나간 것", () => {
  const s = snapshot({
    pulls: [
      pr(21, "VOC-175", { readyAt: iso(-30) }),
      pr(20, "VOC-191", { readyAt: iso(-20) }),
      pr(22, null, {}, ["no-review"]),
      pr(23, "VOC-180", { draft: true }, ["draft"]),
    ],
    claims: [claim("s-b", "vocado-voc-175", -40, -2)],
  });
  const land = (id: string, at: number, stand: string | null, flight: string | null): Clearance => ({
    id, at: iso(at), to: "s-b", toName: "TEAM_B", type: "LAND", stand: stand && `${WT}/${stand}`, flight,
    text: "LANDING 1번", readbackAt: iso(at + 1), cancelledAt: null,
  });
  const clearances = [
    land("C-0001", -200, "vocado-voc-175", "VOC-175"), // PR을 열기 전 것
    land("C-0002", -5, "vocado-voc-175", "VOC-175"),
    land("C-0003", -5, null, "VOC-191"), // STAND 없이 FLIGHT만
  ];
  const q = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, clearances, T0).landingQueue;
  assert.deepEqual(q.map((x) => [x.pr.number, x.seq, x.landing]), [[21, 1, "CLEARED"], [20, 2, "CLEARED"], [22, null, "APPROACH"]]);
  assert.deepEqual(q.map((x) => x.landClearance?.id ?? null), ["C-0002", "C-0003", null]);
  assert.deepEqual(q[0].holders.map((h) => h.name), ["TEAM_B"]);
  assert.equal(q[2].stand, null);
  assert.deepEqual(q[2].blocks.map((b) => b.code), ["no-review"]);
});

test("ATFM: 켜진 GROUND STOP은 그 AIRPORT의 landingQueue에 groundStop을 붙이고 이벤트를 낸다(그림자는 이벤트 없음), 머지 슬롯은 그림자로 붙는다", () => {
  const gs = (enforced: boolean) => ({ airport: "VCDO", repo: VCDO, trigger: "main-broken" as const, kind: "stop" as const, land: true, enforced, text: "main 깨짐: main abc 실패 체크 build", evidence: [], since: iso(-1) });
  const mains = [{ repo: VCDO, slug: "o/v", branch: "main", sha: "abc", state: "failure" as const, failing: ["build"], checks: 1, at: iso(0) }];
  const airports = [{ id: "1", repo: VCDO, name: "vocado_nextjs", code: "VCDO" }] as Snapshot["airports"];
  const s = snapshot({ airports, pulls: [pr(21, "VOC-52", { readyAt: iso(-9) }), pr(23, "VOC-191", { readyAt: iso(-5) })], atfm: { mains, groundStops: [gs(true)] } });
  const q = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0).landingQueue;
  assert.deepEqual(q.map((x) => x.groundStop?.trigger ?? null), ["main-broken", "main-broken"]);
  assert.deepEqual(q.map((x) => x.slot?.slot), ["in-slot", "waiting-slot"]); // CI 있는 저장소는 1개
  assert.deepEqual(q.map((x) => x.slotHold), [null, null]); // 그림자(기본): TOWER는 따르지 않는다
  const slotsOn = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0, { ...DEFAULT_ATFM, slots: "on" }).landingQueue;
  assert.deepEqual(slotsOn.map((x) => x.slotHold?.text ?? null), [null, "머지 슬롯 대기 — 저장소 안 2번째, 동시 LAND 1"]); // 7단계
  const shadow = snapshot({ airports, pulls: s.pulls, atfm: { mains, groundStops: [gs(false)] } });
  assert.deepEqual(buildBrief(shadow, { events: [], reset: false, cursor: "e:0" }, [], T0).landingQueue.map((x) => x.groundStop), [null, null]);
  const off = snapshot({ airports, pulls: s.pulls, atfm: { mains: [], groundStops: [] } });
  const kinds = (a: Snapshot, b: Snapshot) => diffSnapshots(a, b).filter((e) => e.kind.startsWith("groundstop")).map((e) => `${e.kind}:${e.message}`);
  assert.deepEqual(kinds(off, s), ["groundstop.started:main 깨짐: main abc 실패 체크 build"]);
  assert.deepEqual(kinds(s, off), ["groundstop.ended:main 깨짐: main abc 실패 체크 build"]);
  assert.deepEqual(kinds(off, shadow), []);
});

test("ATFM(ATC-62): 켜진 LOS 출발 중지는 새 ASSIGN만 막는다 — landingQueue에 groundStop을 붙이지 않고 HOLD·CONTINUE 이벤트도 없다", () => {
  const los = { airport: "VCDO", repo: VCDO, trigger: "los" as const, kind: "stop" as const, land: false, enforced: true, text: "LOS 증가: 열린 LOS 2건", evidence: [], since: iso(-1) };
  const airports = [{ id: "1", repo: VCDO, name: "vocado_nextjs", code: "VCDO" }] as Snapshot["airports"];
  const s = snapshot({ airports, pulls: [pr(21, "VOC-52", { readyAt: iso(-9) })], atfm: { mains: [], groundStops: [los] } });
  assert.deepEqual(buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0).landingQueue.map((x) => x.groundStop), [null]);
  const off = snapshot({ airports, pulls: s.pulls, atfm: { mains: [], groundStops: [] } });
  assert.deepEqual(diffSnapshots(off, s).filter((e) => e.kind.startsWith("groundstop")), []);
  assert.equal(buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0).groundStops[0].trigger, "los"); // 목록에는 보인다
});

test("브리핑: FUEL 경고(FUEL F8)는 open.fuelLeaks·open.coldCache로 그대로, 없으면 빈 목록", () => {
  const s = snapshot();
  const bare = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0);
  assert.deepEqual([bare.open.fuelLeaks, bare.open.coldCache, bare.open.fuelError], [[], [], null]);
  const cold = { key: "cold|s-b|t", aircraft: "TEAM_B", session: "s-b", lastAt: null, idleMin: 70, ttlMin: 60, prefix: null, cost: null, text: "COLD CACHE — TEAM_B" };
  const leak = { key: "leak|TEAM_D|2026-09-28", aircraft: "TEAM_D", count: 3, tokens: 2e6, cost: 14, top: "coldCache" as const, text: "FUEL LEAK" };
  const brief = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0, undefined, { at: "", largeLeaks: [leak], coldCache: [cold], error: null });
  assert.deepEqual(brief.open.coldCache.map((c) => c.key), ["cold|s-b|t"]);
  assert.deepEqual(brief.open.fuelLeaks.map((l) => l.key), ["leak|TEAM_D|2026-09-28"]);
});

test("브리핑(ATC-86): TOWER의 health에 cut LIMIT·RESUME·STALLED가 코드·표시 글·다음 한 걸음으로 들어간다", () => {
  const h = (code: "LIMIT" | "RESUME" | "STALLED", over: Partial<NonNullable<Session["health"]>> = {}): NonNullable<Session["health"]> => ({ code, level: code === "STALLED" ? "info" : "alert", since: iso(-30), detail: `${code} 원문`, next: `${code} 다음`, holds: code === "LIMIT", ...over });
  const s = snapshot({
    sessions: [
      { ...session("s-b", "TEAM_B"), health: h("LIMIT", { cut: true, cutAt: iso(-30), resetsAt: iso(60) }) },
      { ...session("s-d", "TEAM_D"), health: h("RESUME", { cutAt: iso(-400), resetsAt: iso(-10) }) },
      { ...session("s-p", "TEAM_P"), health: h("STALLED") },
    ],
  });
  const brief = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0);
  assert.deepEqual(
    brief.open.health.map((x) => [x.callsign, x.code, x.level, x.text]),
    [
      ["BRAVO", "LIMIT", "alert", "HOLD · LIMIT (cut 06:30Z) until 08:00Z"],
      ["DELTA", "RESUME", "alert", "RESUME 필요"],
      ["PAPA", "STALLED", "info", "STALLED 30m"],
    ],
  );
  assert.equal(brief.open.health[1]!.next, "RESUME 다음");
});
