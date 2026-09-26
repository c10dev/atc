import { config } from "./config.ts";
import type { Alert, Claim, Session, Snapshot, Ticket } from "./model.ts";
import { resolveAirports } from "./airports.ts";
import { recentClearances } from "./clearances.ts";
import { type Occupancy, resolveOccupancy } from "./occupancy.ts";
import { inferTranscriptClaim, readClaudeSessions, readHookClaims } from "./sources/claude.ts";
import { readCodex } from "./sources/codex.ts";
import { readWorkspaces } from "./sources/git.ts";
import { readLinear } from "./sources/linear.ts";

const fresh = (c: Claim) => Date.now() - Date.parse(c.lastAt) < config.claimTtlMs;

export async function buildSnapshot(): Promise<Snapshot> {
  const airports = await resolveAirports();
  const workspaces = await readWorkspaces(airports.open.map((a) => a.repo));
  const wsByPath = new Map(workspaces.map((w) => [w.path, w]));

  const claude = readClaudeSessions();
  const codex = readCodex(workspaces);
  const sessions: Session[] = [...claude.sessions, ...codex.sessions];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

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
      assignee: null,
      priority: 0,
      url: null,
      updatedAt: null,
    });
  }
  const columns = [...linear.columns];
  if (tickets.some((t) => t.stateType === "unknown")) {
    columns.unshift({ name: linear.enabled ? "Linear에 없음" : "Linear 미연결", type: "unknown", color: null });
  }

  return {
    at: new Date().toISOString(),
    linear: { enabled: linear.enabled, error: linear.error, fetchedAt: linear.fetchedAt },
    sessions,
    workspaces,
    tickets,
    columns,
    airports: airports.open,
    claims,
    handoffs: occupancy.handoffs,
    alerts: buildAlerts(sessions, workspaces, tickets, claims, occupancy),
    clearances: recentClearances(),
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
  for (const t of tickets) {
    if (t.stateType !== "started" || ticketsWithWs.has(t.key)) continue;
    alerts.push({ kind: "no-workspace", message: `진행 중인데 워크트리가 없음`, ticketKey: t.key });
  }
  return alerts;
}
