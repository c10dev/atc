import { config } from "./config.ts";
import { type Alert, type Claim, type Session, type Snapshot, type Ticket } from "./model.ts";
import { hostedDbOfAirport, resolveAirports } from "./airports.ts";
import { migrationGateOf } from "./migration-gate.ts";
import { readAppliedCached } from "./sources/supabase-migrations.ts";
import { recentClearances } from "./clearances.ts";
import { type Occupancy, resolveOccupancy } from "./occupancy.ts";
import { healthOfSession, inferTranscriptClaim, readClaudeSessions, readEndedSessions, readHookClaims } from "./sources/claude.ts";
import { restartingOf } from "./restarting.ts";
import { cutResetOf, DEFAULT_HEALTH, healthAlerts, settleCut } from "./health.ts";
import { blockedAlerts } from "./job-state.ts";
import { applyFlightHealth } from "./health-flights.ts";
import { loadReportViews } from "./judges/store.ts";
import { readCodex } from "./sources/codex.ts";
import { readWorkspaces, ticketKeyFromBranch, ticketKeyFromTitle } from "./sources/git.ts";
import { readGithub } from "./sources/github.ts";
import { readLinear } from "./sources/linear.ts";
import { buildPulls, strandedMessage, strandedOf } from "./landing.ts";
import { loadMcc, readMccRecords, reviewOfHead } from "./mcc.ts";
import { airportOfTicket, loadDispatchConfig } from "./dispatch.ts";
import { allProposals } from "./proposals.ts";
import { noWorkspaceKeysOf } from "./arrived-open.ts";
import { awaitSupervisorAlerts } from "./supervisor-confirm.ts";
import { accountOf, CONTROL_DIRS, type ControlName, controlAccountOf, controlNameOf } from "./crew.ts";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFleet } from "./fleet.ts";
import { fuelAccountsOf, fuelByAircraft, fuelConfigOf, type FuelMember, observeMembers } from "./fuel-remaining.ts";
import { readFuelHistory, readFuelRecords } from "./fuel-run.ts";
import { laneStates, recordSingleLanes } from "./codex-lane-run.ts";
import { readLandingReviews, readMergeReviews } from "./landing-review.ts";
import { type GroundStop, groundStopsOf, holdStops, loadAtfm, readRecordedStops, reviveStops, stopFigures } from "./atfm.ts";
import { fastTrackOf, isHeld, loadAutoland, loadAutolandState, mergeExclusionOf, planAutoland } from "./autoland.ts";
import { regKey } from "./registration.ts";
import { readRecords } from "./recorder.ts";
import { launchModeOf } from "./session-origin.ts";
import { readAbsent } from "./absent-run.ts";
import { readReleaseView } from "./release-store.ts";
import { holdAccountOf } from "./account-key.ts";
import { accountFolders } from "./accounts.ts";

// PR head별로 CLEARED TO LAND가 처음 된 시각 (메모리, 서버를 재시작하면 다시 센다)
const readySince = new Map<string, string>();
// 지난 스냅샷의 출발 중지(해제 규칙까지 붙든 것 포함, ATC-62). 처음에는 atfm-state.json에 적힌 것으로 되살린다
let heldStops: GroundStop[] | null = null;

const fresh = (c: Claim) => Date.now() - Date.parse(c.lastAt) < config.claimTtlMs;

// 열린 PR이 있는 STAND를 쥔 살아 있는 세션의 점유는 claimTtlMs가 지나도 이어 둔다(ATC-387): 그 AIRCRAFT가 다음 FLIGHT를 새 STAND에서 하는 동안에도
// 앞 PR의 FIX·GO AROUND가 STAND를 쥔 그 세션에게 가고, 그 FLIGHT가 슬롯 계산에 든다. 충돌·알림·건강 계산은 이미 끝났으므로 영향이 없다(그 뒤에 더한다)
export function keptStandClaims(hookClaims: readonly Claim[], claims: readonly Claim[], pulls: readonly { standPath?: string | null }[], statusOf: (id: string) => string | undefined): Claim[] {
  const standsWithPr = new Set(pulls.map((p) => p.standPath).filter((x): x is string => Boolean(x)));
  const held = new Set(claims.filter((c) => c.state === "active").map((c) => c.workspacePath)); // 다른 세션이 지금 쥐고 있는 STAND는 그 세션이 홀더다
  const kept = new Set<string>();
  return [...hookClaims].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).filter((c) => {
    if (fresh(c) || c.state !== "active" || held.has(c.workspacePath) || kept.has(c.workspacePath)) return false;
    const st = statusOf(c.sessionId);
    const keep = st !== undefined && st !== "dead" && standsWithPr.has(c.workspacePath);
    if (keep) kept.add(c.workspacePath); // STAND마다 하나(가장 최근에 건드린 세션)
    return keep;
  });
}

export async function buildSnapshot(): Promise<Snapshot> {
  const airports = await resolveAirports();
  const workspaces = await readWorkspaces(airports.open.map((a) => a.repo));
  const wsByPath = new Map(workspaces.map((w) => [w.path, w]));

  const claude = readClaudeSessions();
  const codex = readCodex(workspaces);
  const sessions: Session[] = [...claude.sessions, ...codex.sessions];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // AIRCRAFT health(ATC-45): 살아 있는 Claude 세션의 대화 기록 끝에서 멈춘 까닭을 읽는다. ACTIVITY(ATC-97)도 같은 끝에서
  const healthAt = Date.now();
  for (const f of claude.files) {
    const x = sessionById.get(f.sessionId);
    if (!x) continue;
    const { health, activity, languageAt } = healthOfSession(f, x.status, healthAt, config.health);
    x.health = health;
    if (languageAt !== undefined) x.languageAt = new Date(languageAt).toISOString();
    if (activity) x.activity = activity;
  }

  // 백그라운드 세션의 permission mode(ATC-76): 명령줄에 없으니 그 세션을 띄운 LAUNCH 기록에서. 관제 세션 LAUNCH는 늘 auto
  const bgNoMode = claude.sessions.filter((x) => x.origin === "background" && !x.permissionMode);
  if (bgNoMode.length) {
    const records = readRecords(Date.now() - 14 * 86_400_000);
    for (const x of bgNoMode) {
      const name = regKey(x.name);
      const mine = records.flatMap((r) =>
        r.kind === "fleet" && r.op === "launch" && regKey(r.aircraft) === name
          ? [{ t: r.t, ok: r.ok, permissionMode: r.permissionMode }]
          : r.kind === "control" && r.op === "launch" && r.session.toUpperCase() === x.name.toUpperCase()
            ? [{ t: r.t, ok: r.ok, permissionMode: r.permissionMode ?? "auto" }]
            : [],
      );
      x.permissionMode = launchModeOf(mine, x.startedAt);
    }
  }

  const hookClaims = readHookClaims().filter((c) => wsByPath.has(c.workspacePath));
  const claims = hookClaims.filter(fresh);
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
  const fleet = loadFleet();
  const dispatchCfg = loadDispatchConfig();
  // 화면 사이드바가 AIRPORT별로 묶는다(ATC-443). DISPATCH가 쓰는 같은 규칙이라 화면에 따로 규칙을 두지 않는다(원칙 4)
  for (const t of tickets) t.airport = airportOfTicket(t, dispatchCfg);
  const team = new RegExp(dispatchCfg.teamPattern, "i");
  // 관찰한 ACCOUNT가 있으면 그것(ATC-146), 등록부가 없으면 home 라벨. 라벨을 쓰지 않는 등록부(accountOf가 null)는 그대로 null
  const folders = accountFolders();
  const accountOfSession = (x: Session) => (x.status !== "dead" && team.test(x.name) ? holdAccountOf(fleet, x, folders, config.claudeDir) : null); // DISPATCH의 ACCOUNT HOLD와 같은 키(ATC-490)
  // RESTARTING(ATC-91): 데스크톱 /clear 뒤 다음 지시를 기다리는 AIRCRAFT. 세션 파일이 없는 최근 대화 기록에서 읽는다
  const graceMs = dispatchCfg.restartGraceMin * 60_000;
  const restarting = graceMs <= 0 ? [] : restartingOf(readEndedSessions(new Set(claude.sessions.map((x) => x.id)), healthAt, graceMs), sessions, healthAt, dispatchCfg.restartGraceMin, dispatchCfg.teamPattern);
  // FUEL REMAINING(ATC-55): statusline이 적은 rate_limits를 session → AIRCRAFT → ACCOUNT로(죽은 세션의 마지막 값도 reset까지 쓴다).
  // 관제 세션(TOWER·OCC·CROSSCHECK·MCC·ENGINEERING, ATC-60)도 같은 ACCOUNT의 구성원으로 센다 — 붙들지는 않는다
  const regOf = (name: string) => regKey(name, dispatchCfg.teamPattern); // `Team G`도 TEAM_G 구성원(ATC-67)
  const regs = [...new Set(sessions.filter((x) => team.test(x.name)).map((x) => regOf(x.name)))];
  const controlOf = new Map(sessions.map((x) => [x.id, team.test(x.name) ? null : controlNameOf({ name: x.name, cwd: realDir(x.cwd) }, CONTROL_ABS)]));
  const controls = [...new Set([...controlOf.values()].filter((n): n is ControlName => Boolean(n)))];
  const members: FuelMember[] = [
    ...regs.map((reg): FuelMember => ({ name: reg, kind: "aircraft", account: accountOf(fleet, reg), sessionIds: sessions.filter((x) => team.test(x.name) && regOf(x.name) === reg).map((x) => x.id) })),
    ...controls.map((n): FuelMember => ({ name: n, kind: "control", account: controlAccountOf(fleet, n), sessionIds: sessions.filter((x) => controlOf.get(x.id) === n).map((x) => x.id) })),
  ];
  const fuelCfg = fuelConfigOf(dispatchCfg.fuel);
  // 관찰한 ACCOUNT(ATC-146): 세션이 있는 폴더의 ACCOUNT로 statusline 기록을 묶는다. 등록부가 비어 있으면 관찰 값이 없어 그대로다
  const observedAcct = new Map(sessions.flatMap((x) => (x.account ? [[x.id, x.account] as const] : [])));
  const liveIds = new Set(sessions.filter((x) => x.status !== "dead").map((x) => x.id));
  const obsMembers = observeMembers(members, observedAcct, liveIds);
  const fuelAccounts = fuelAccountsOf(obsMembers, readFuelRecords(), fuelCfg, healthAt);
  const fuel = fuelByAircraft(fuelAccounts);
  // 오류 없이 한도로 잘린 턴(cut LIMIT, ATC-86): reset은 같은 ACCOUNT 구성원의 FUEL 기록에서 되짚는다. reset이 지났으면 RESUME
  for (const x of sessions) {
    if (x.health?.code !== "LIMIT" || !x.health.cut || !x.health.cutAt) continue;
    const m = obsMembers.find((y) => y.sessionIds.includes(x.id));
    const ids = m?.account ? obsMembers.filter((y) => y.account === m.account).flatMap((y) => y.sessionIds) : (m?.sessionIds ?? [x.id]);
    x.health = settleCut(x.health, cutResetOf(Date.parse(x.health.cutAt), readFuelHistory(ids), fuelCfg.holdPct), healthAt);
  }
  // ABSENT(ATC-129): 세션이 없는 백그라운드 AIRCRAFT. 마지막 턴이 한도로 잘렸으면 reset을 같은 ACCOUNT의 FUEL 기록에서 되짚는다
  const absent = readAbsent({
    sessions,
    restarting,
    fleet,
    teamPattern: dispatchCfg.teamPattern,
    now: healthAt,
    resetOf: (cutAt, sessionId, reg) => {
      const acct = obsMembers.find((y) => y.kind === "aircraft" && y.name === reg)?.account ?? accountOf(fleet, reg);
      const ids = [sessionId, ...(acct ? obsMembers.filter((y) => y.account === acct).flatMap((y) => y.sessionIds) : [])];
      return cutResetOf(cutAt, readFuelHistory(ids), fuelCfg.holdPct);
    },
  });
  // health ALERT: NETWORK는 기계에 한 번, LIMIT은 같은 ACCOUNT끼리(ATC-51), ACCOUNT를 모르면 같은 reset끼리 한 번(docs/fleet.md 8.8)
  // NEEDS YOU(ATC-99): 백그라운드 job이 blocked로 몇 분 넘게 사람을 기다리면 경보. state가 blocked를 벗어나면 저절로 사라진다
  for (const a of blockedAlerts(sessions, healthAt, config.health.blockedMin ?? DEFAULT_HEALTH.blockedMin!)) alerts.push({ kind: "health", key: a.key, message: a.message, sessionIds: a.sessionIds });
  // AWAITING SUPERVISOR(ATC-120): CAPTAIN이 READBACK도 거절도 아닌 채 사용자의 go를 기다린다. 같은 경보 경로, 제안마다 한 번(key)
  for (const a of awaitSupervisorAlerts(allProposals(), sessions)) alerts.push({ kind: "health", key: a.key, message: a.message, sessionIds: a.sessionIds });
  for (const a of healthAlerts(sessions.map((x) => ({ sessionId: x.id, name: x.name, health: x.health, account: accountOfSession(x) })), healthAt)) {
    alerts.push({ kind: "health", key: a.key, message: a.message, sessionIds: a.sessionIds });
  }
  const repos = airports.open.map((a) => a.repo);
  // main에서 늘 도는 체크(MCC AIRPORT의 ciCheck)가 새 커밋에 아직 없으면 CI는 pending이다(ATC-121)
  const mccCfg = loadMcc();
  const mccAirport = airports.open.find((a) => a.code === mccCfg.airport);
  const github = readGithub(repos, new Map(mccAirport ? [[mccAirport.repo, mccCfg.ciCheck]] : []));
  // AUTOLAND(ATC-34·38). 재리뷰로 Codex 대신 넘긴 head는 6시간을 기다리지 않고 REVIEW 대기열로 — update·merge이고 GROUND STOP이 아닌 AIRPORT만
  const alCfg = loadAutoland();
  const alSt = loadAutolandState();
  const alActive = (repo: string) => {
    const code = airports.open.find((a) => a.repo === repo)?.code;
    return alCfg.mode !== "off" && Boolean(code) && alCfg.airports.includes(code!) && !alSt.groundStops.some((g) => g.airport === code);
  };
  const fastTrack = fastTrackOf(alSt.reviewRequests);
  // 조용한 리뷰 레인(ATC-386): 저장소 수준 판단. GitHub을 읽은 저장소 가운데 Codex를 쓰는 저장소만(MCC AIRPORT는 INSPECTION이 리뷰), 전이는 codex-lane.jsonl에 한 줄씩. 스위치 codex-lane.json이 off면 쉰다(ATC-393)
  const laneSilent = laneStates(github.byRepo, Date.now(), undefined, (repo) => repo !== mccAirport?.repo);
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
      limitMs: config.codexLimitMs,
      reviews: readLandingReviews(),
      ticketLabelsOf: (key) => tickets.find((t) => t.key === key)?.labels ?? [],
      ticketTitleOf: (key) => tickets.find((t) => t.key === key)?.title ?? null,
      // 보안 규칙에만 걸린 PR도 REVIEW 세션에 보낼까(ATC-30, 설정 창). 기본 "exclude", 보내면 옛 이름 "deepseek"
      security: loadDispatchConfig().externalReview.security,
      fastTrack: (repo, number, head) => (alActive(repo) ? fastTrack(repo, number, head) : null),
      lane: (repo) => laneSilent.get(repo) ?? null,
      // MCC(docs/mcc.md): 맡은 AIRPORT(atc) PR은 이 head의 INSPECTION이 리뷰를 대신한다
      mcc: (() => {
        const repo = airports.open.find((a) => a.code === loadMcc().airport)?.repo;
        if (!repo) return undefined;
        const records = readMccRecords();
        return { repo, reviewOf: (number: number, head: string) => reviewOfHead(records, number, head) };
      })(),
      // AUTOLAND AIRPORT의 머지 리뷰(ATC-328): atc에 기록한 이 head의 리뷰가 착륙 리뷰
      autoland: { repos: airports.open.filter((a) => alCfg.airports.includes(a.code)).map((a) => a.repo), reviewedSecurity: alCfg.reviewedSecurity, reviews: readMergeReviews() },
    },
  );

  recordSingleLanes(pulls); // REVIEW 한 레인으로 CLEARED가 된 PR(ATC-386)

  // STALLED와 멈춘 AIRCRAFT의 FLIGHT 유지(ATC-86): 점유·Linear·PR이 모두 읽힌 뒤에
  // REPORT 판정(ATC-89): 세션마다 마지막 판정을 붙인다. 판정 뒤에 다시 움직이기 시작한 세션(busy)에는 붙이지 않는다
  const reports = loadReportViews().bySession;
  for (const x of sessions) {
    const r = reports.get(x.id);
    if (r && x.status === "idle") x.report = r;
  }
  claims.push(...keptStandClaims(hookClaims, claims, pulls, (id) => sessionById.get(id)?.status));
  applyFlightHealth({ sessions, teamPattern: dispatchCfg.teamPattern, freshClaims: claims, staleClaims: hookClaims.filter((c) => !fresh(c)), workspaces, tickets, pulls, now: healthAt, cfg: config.health });

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
    const cfg = loadAtfm();
    const figures = stopFigures();
    const found = groundStopsOf({ airports: airports.open, mains: github.mainByRepo, pulls: github.byRepo, losOpen, ciTrend: figures.ciTrend, losDay: figures.losDay, cfg, now });
    heldStops ??= reviveStops(readRecordedStops(), airports.open);
    groundStops = heldStops = holdStops(heldStops, found, { pulls: github.byRepo, cfg, now });
  }

  // AUTOLAND(ATC-34): AIRPORT마다 다음 할 일과 PR마다 표시. merge 모드면 CLEARED PR의 제외 사유(HOLD, FLIGHT, 라벨, 보안 게이트, HUMAN CHECK)
  // 마이그레이션 게이트(ATC-329): hostedDb가 있는 AIRPORT에서 CLEARED PR이 migrationsDir 아래를 바꿀 때만 적용 버전을 읽는다(90초 캐시, 표시용. 머지 직전에는 새로 읽는다)
  const applied = new Map<string, string[] | null>();
  if (alCfg.mode === "merge") {
    for (const a of airports.open.filter((x) => alCfg.airports.includes(x.code))) {
      const db = hostedDbOfAirport(a.repo);
      if (!db) continue;
      const touches = pulls.some((p) => p.repo === a.repo && p.landing === "CLEARED" && (github.byRepo.get(a.repo)?.find((g) => g.number === p.number)?.files ?? []).some((f) => f.startsWith(`${db.migrationsDir}/`)));
      if (touches) applied.set(a.repo, await readAppliedCached(db));
    }
  }
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
        head: p.head,
        carryFrom: raw?.humanCarryFrom ?? (raw?.carryFrom ?? []).map((c) => c.sha),
        reviewedSecurity: alCfg.reviewedSecurity,
        migrationGate: migrationGateOf({ hostedDb: hostedDbOfAirport(p.repo), files: raw?.files ?? null, added: raw?.added ?? null, applied: applied.get(p.repo) ?? null }),
        mergeReviewPass: p.mergeReview?.pass === true,
      });
    },
  });

  return {
    at: new Date().toISOString(),
    linear: { enabled: linear.enabled, error: linear.error, fetchedAt: linear.fetchedAt },
    github: { enabled: github.enabled, reason: github.reason, error: github.error, fetchedAt: github.fetchedAt },
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
    releases: readReleaseView(),
    fuel,
    fuelAccounts,
    restarting,
    absent,
  };
}

// 관제 폴더의 절대 경로(ATC-60). 세션 cwd와 realpath로 맞춘다
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
function realDir(p: string | null | undefined): string | null {
  if (!p) return null;
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
const CONTROL_ABS = Object.fromEntries(Object.entries(CONTROL_DIRS).map(([n, d]) => [n, realDir(join(REPO_ROOT, d))])) as Partial<Record<ControlName, string>>;

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
  // 상위 이슈는 하위 이슈를 묶는 컨테이너라, 그 자체에 워크트리가 없는 것은 방치가 아니다. STAND 없는 FLIGHT(SURVEY·CHECK)는 워크트리가 있을 수 없어
  // 이 알림이 아무것도 알리지 못한다: 뺀다(ARRIVED인데 아직 In Progress면 SUPERVISOR의 할 일 한 줄, ATC-473)
  for (const key of noWorkspaceKeysOf(tickets, ticketsWithWs)) alerts.push({ kind: "no-workspace", message: `진행 중인데 워크트리가 없음`, ticketKey: key });
  return alerts;
}
