import { config } from "./config.ts";
import { type Alert, type Claim, parentKeysOf, type Session, type Snapshot, type Ticket } from "./model.ts";
import { resolveAirports } from "./airports.ts";
import { recentClearances } from "./clearances.ts";
import { type Occupancy, resolveOccupancy } from "./occupancy.ts";
import { healthOfSession, inferTranscriptClaim, readClaudeSessions, readHookClaims } from "./sources/claude.ts";
import { healthAlerts } from "./health.ts";
import { readCodex } from "./sources/codex.ts";
import { readWorkspaces, ticketKeyFromBranch, ticketKeyFromTitle } from "./sources/git.ts";
import { readGithub } from "./sources/github.ts";
import { readLinear } from "./sources/linear.ts";
import { buildPulls, strandedMessage, strandedOf } from "./landing.ts";
import { inspectionOf, loadMcc, readMccRecords } from "./mcc.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { accountOf } from "./crew.ts";
import { loadFleet } from "./fleet.ts";
import { readLandingReviews } from "./landing-review.ts";
import { type GroundStop, groundStopsOf, loadAtfm, stopKey } from "./atfm.ts";
import { fastTrackOf, isHeld, loadAutoland, loadAutolandState, mergeExclusionOf, planAutoland } from "./autoland.ts";

// PR head별로 CLEARED TO LAND가 처음 된 시각 (메모리, 서버를 재시작하면 다시 센다)
const readySince = new Map<string, string>();
// 출발 중지를 처음 본 시각 (메모리, 재시작하면 다시 센다)
const stopSince = new Map<string, string>();

const fresh = (c: Claim) => Date.now() - Date.parse(c.lastAt) < config.claimTtlMs;

export async function buildSnapshot(): Promise<Snapshot> {
  const airports = await resolveAirports();
  const workspaces = await readWorkspaces(airports.open.map((a) => a.repo));
  const wsByPath = new Map(workspaces.map((w) => [w.path, w]));

  const claude = readClaudeSessions();
  const codex = readCodex(workspaces);
  const sessions: Session[] = [...claude.sessions, ...codex.sessions];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // AIRCRAFT health(ATC-45): 살아 있는 Claude 세션의 대화 기록 끝에서 멈춘 까닭을 읽는다
  const healthAt = Date.now();
  for (const f of claude.files) {
    const x = sessionById.get(f.sessionId);
    if (x) x.health = healthOfSession(f, x.status, healthAt, config.health);
  }

  const claims = readHookClaims().filter((c) => wsByPath.has(c.workspacePath) && fresh(c));
  const hooked = new Set(claims.map((c) => c.sessionId));
  for (const f of claude.files) {
    if (hooked.has(f.sessionId) || sessionById.get(f.sessionId)?.status === "dead") continue;
    const inferred = inferTranscriptClaim(f, workspaces);
    if (inferred && fresh(inferred)) claims.push(inferred);
  }
  claims.push(...codex.claims);

  // 세션 파일이 사라진 세션(종료됨)의 점유는 자리표시 세션으로 남겨 고아 점유로 보여준다.
  for (const c of claims) {
    if (sessionById.has(c.sessionId)) continue;
    const ghost: Session = {
      id: c.sessionId,
      agent: "claude",
      name: c.sessionId.slice(0, 8),
      status: "dead",
      pid: null,
      cwd: c.workspacePath,
      startedAt: c.since,
      lastActiveAt: c.lastAt,
      repo: null,
      workspacePath: null,
    };
    sessions.push(ghost);
    sessionById.set(ghost.id, ghost);
  }

  // 세션 cwd를 가장 깊이 포함하는 워크스페이스 (본 체크아웃 안의 .claude/worktrees도 구분된다)
  const deepestFirst = [...workspaces].sort((a, b) => b.path.length - a.path.length);
  for (const s of sessions) {
    const ws = deepestFirst.find((w) => s.cwd === w.path || s.cwd.startsWith(w.path + "/"));
    if (ws) Object.assign(s, { repo: ws.repo, workspacePath: ws.path });
  }

  const occupancy = resolveOccupancy(claims, (id) => sessionById.get(id)?.status, config.handoffGraceMs);

  const branchKeys = new Set(workspaces.map((w) => w.ticketKey).filter((k): k is string => Boolean(k)));
  const linear = readLinear(branchKeys);
  const tickets: Ticket[] = [...linear.tickets];
  const known = new Set(tickets.map((t) => t.key));
  for (const w of workspaces) {
    if (!w.ticketKey || known.has(w.ticketKey)) continue;
    known.add(w.ticketKey);
    tickets.push({
      key: w.ticketKey,
      title: w.branch ?? w.name,
      state: linear.enabled ? "Linear에 없음" : "Linear 미연결",
      stateType: "unknown",
      stateColor: null,
      project: null,
      labels: [],
      createdAt: null,
      startedAt: null,
      blocks: [],
      blockedBy: [],
      related: [],
      parent: null,
      children: [],
      assignee: null,
      takenBy: null,
      priority: 0,
      url: null,
      updatedAt: null,
    });
  }
  const columns = [...linear.columns];
  if (tickets.some((t) => t.stateType === "unknown")) {
    columns.unshift({ name: linear.enabled ? "Linear에 없음" : "Linear 미연결", type: "unknown", color: null });
  }

  const alerts = buildAlerts(sessions, workspaces, tickets, claims, occupancy);
  // health ALERT: NETWORK는 기계에 한 번, LIMIT은 같은 ACCOUNT끼리(ATC-51), ACCOUNT를 모르면 같은 reset끼리 한 번(docs/fleet.md 8.8)
  const fleet = loadFleet();
  const team = new RegExp(loadDispatchConfig().teamPattern, "i");
  const accountOfSession = (x: Session) => (x.status !== "dead" && team.test(x.name) ? accountOf(fleet, x.name) : null);
  for (const a of healthAlerts(sessions.map((x) => ({ sessionId: x.id, name: x.name, health: x.health, account: accountOfSession(x) })), healthAt)) {
    alerts.push({ kind: "health", key: a.key, message: a.message, sessionIds: a.sessionIds });
  }
  const repos = airports.open.map((a) => a.repo);
  const github = readGithub(repos);
  // AUTOLAND(ATC-34·38). 재리뷰로 Codex 대신 넘긴 head는 6시간을 기다리지 않고 REVIEW 대기열로 — update·merge이고 GROUND STOP이 아닌 AIRPORT만
  const alCfg = loadAutoland();
  const alSt = loadAutolandState();
  const alActive = (repo: string) => {
    const code = airports.open.find((a) => a.repo === repo)?.code;
    return alCfg.mode !== "off" && Boolean(code) && alCfg.airports.includes(code!) && !alSt.groundStops.some((g) => g.airport === code);
  };
  const fastTrack = fastTrackOf(alSt.reviewRequests);
  const pulls = buildPulls(
    repos.filter((r) => github.byRepo.has(r)).map((repo) => ({ repo, pulls: github.byRepo.get(repo)!, defaultBranch: github.defaultByRepo.get(repo) ?? null })),
    workspaces,
    alerts,
    readySince,
    (pr) => ticketKeyFromBranch(pr.headRefName) ?? ticketKeyFromTitle(pr.title),
    undefined,
    // Codex 한도 때 착륙 리뷰(ATC-7·27): FLIGHT 라벨·제목, PR 경로·제목·본문으로 외부 리뷰 제외를 보고, 이 head의 착륙 리뷰를 찾는다
    {
      silentMs: config.codexSilentMs,
      reviews: readLandingReviews(),
      ticketLabelsOf: (key) => tickets.find((t) => t.key === key)?.labels ?? [],
      ticketTitleOf: (key) => tickets.find((t) => t.key === key)?.title ?? null,
      // 보안 규칙에만 걸린 PR도 DeepSeek에 보낼까(ATC-30, 설정 창). 기본 "exclude"
      security: loadDispatchConfig().externalReview.security,
      fastTrack: (repo, number, head) => (alActive(repo) ? fastTrack(repo, number, head) : null),
      // MCC(docs/mcc.md): 맡은 AIRPORT(atc) PR은 이 head의 INSPECTION이 리뷰를 대신한다
      mcc: (() => {
        const repo = airports.open.find((a) => a.code === loadMcc().airport)?.repo;
        if (!repo) return undefined;
        const records = readMccRecords();
        return { repo, reviewOf: (number: number, head: string) => inspectionOf(records, number, head) };
      })(),
    },
  );

  // STRANDED(ATC-29): FLIGHT가 있는 PR이 기본 브랜치가 아닌 곳에 머지됐고, 그 커밋이 기본 브랜치에도 그리로 가는 열린 PR에도 없음.
  // Linear가 Done이어도 경보를 둔다(Done이 틀렸다는 뜻이다)
  const stranded = strandedOf(repos.flatMap((r) => github.mergedElsewhereByRepo.get(r) ?? []));
  for (const x of stranded) {
    const state = tickets.find((t) => t.key === x.flight)?.state ?? null;
    alerts.push({ kind: "stranded", ticketKey: x.flight, message: strandedMessage(x, github.defaultByRepo.get(x.repo) ?? "main", state) });
  }

  // ATFM 출발 중지(docs/atfm.md 6장). GitHub을 아직 못 읽었으면 계산하지 않는다(빈 상태를 "풀림"으로 보지 않게).
  const now = Date.now();
  let groundStops: GroundStop[] = [];
  if (github.fetchedAt) {
    const repoOf = new Map(workspaces.map((w) => [w.path, w.repo]));
    const losOpen = new Map<string, number>();
    for (const a of alerts) {
      const repo = a.kind === "conflict" && a.workspacePath ? repoOf.get(a.workspacePath) : undefined;
      if (repo) losOpen.set(repo, (losOpen.get(repo) ?? 0) + 1);
    }
    const found = groundStopsOf({ airports: airports.open, mains: github.mainByRepo, pulls: github.byRepo, losOpen, cfg: loadAtfm(), now });
    const at = new Date(now).toISOString();
    const keys = new Set(found.map(stopKey));
    for (const k of stopSince.keys()) if (!keys.has(k)) stopSince.delete(k);
    groundStops = found.map((s) => {
      const k = stopKey(s);
      if (!stopSince.has(k)) stopSince.set(k, at);
      return { ...s, since: stopSince.get(k)! };
    });
  }

  // AUTOLAND(ATC-34): AIRPORT마다 다음 할 일과 PR마다 표시. merge 모드면 CLEARED PR의 제외 사유(HOLD, FLIGHT, 라벨, 보안 게이트, Human Preview)
  const autoland = planAutoland({
    cfg: alCfg,
    airports: airports.open.map((a) => ({ code: a.code, repo: a.repo })),
    pulls,
    st: alSt,
    exclusionOf: (p) => {
      const raw = github.byRepo.get(p.repo)?.find((g) => g.number === p.number);
      const ticket = p.ticketKey ? tickets.find((t) => t.key === p.ticketKey) : undefined;
      return mergeExclusionOf({
        held: isHeld(alCfg, p),
        flight: p.ticketKey,
        ticketLabels: ticket?.labels ?? [],
        prLabels: (raw?.labels ?? []).map((l) => l.name),
        files: raw?.files ?? null,
        title: p.title,
        body: raw?.body,
        flightTitle: ticket?.title ?? null,
      });
    },
  });

  return {
    at: new Date().toISOString(),
    linear: { enabled: linear.enabled, error: linear.error, fetchedAt: linear.fetchedAt },
    github: { enabled: github.enabled, error: github.error, fetchedAt: github.fetchedAt },
    sessions,
    workspaces,
    tickets,
    columns,
    airports: airports.open,
    claims,
    handoffs: occupancy.handoffs,
    alerts,
    clearances: recentClearances(),
    pulls,
    stranded,
    atfm: { mains: [...github.mainByRepo.values()].filter((m) => repos.includes(m.repo)), groundStops },
    autoland,
  };
}

function buildAlerts(
  sessions: Session[],
  workspaces: Snapshot["workspaces"],
  tickets: Ticket[],
  claims: Claim[],
  occupancy: Occupancy,
): Alert[] {
  const alerts: Alert[] = [];
  const name = new Map(sessions.map((s) => [s.id, s.name]));

  for (const { workspacePath, sessionIds } of occupancy.conflicts) {
    alerts.push({
      kind: "conflict",
      message: `${sessionIds.map((id) => name.get(id)).join(", ")} 가 같은 워크트리에서 동시에 작업`,
      workspacePath,
      sessionIds,
    });
  }

  for (const c of occupancy.orphans) {
    alerts.push({
      kind: "orphan",
      message: `종료된 세션 ${name.get(c.sessionId)} 의 점유가 남아 있음`,
      workspacePath: c.workspacePath,
      sessionIds: [c.sessionId],
    });
  }

  const claimed = new Set(claims.map((c) => c.workspacePath));
  for (const w of workspaces) {
    if (w.isMain || !w.dirty || claimed.has(w.path)) continue;
    alerts.push({ kind: "unattended", message: `주인 없는 변경 ${w.dirty}개`, workspacePath: w.path });
  }

  const ticketsWithWs = new Set(workspaces.map((w) => w.ticketKey));
  // 상위 이슈는 하위 이슈를 묶는 컨테이너라, 그 자체에 워크트리가 없는 것은 방치가 아니다.
  const parents = parentKeysOf(tickets);
  for (const t of tickets) {
    if (t.stateType !== "started" || ticketsWithWs.has(t.key) || parents.has(t.key)) continue;
    alerts.push({ kind: "no-workspace", message: `진행 중인데 워크트리가 없음`, ticketKey: t.key });
  }
  return alerts;
}
