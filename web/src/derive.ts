import { awayOperations } from "../../server/away.ts";
import type { Airport, Alert, Claim, Session, Snapshot, Ticket, Workspace } from "../../server/model.ts";

export interface Index {
  sessionById: Map<string, Session>;
  wsByPath: Map<string, Workspace>;
  ticketByKey: Map<string, Ticket>;
  claimsBySession: Map<string, Claim[]>;
  claimsByWorkspace: Map<string, Claim[]>;
  workspacesByTicket: Map<string, Workspace[]>;
  alertsByWorkspace: Map<string, Alert[]>;
  alertsByTicket: Map<string, Alert[]>;
  airportByRepo: Map<string, Airport>;
  awayBySession: Map<string, Airport[]>; // 원정 운항 중인 공항들
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildIndex(s: Snapshot): Index {
  const idx: Index = {
    sessionById: new Map(s.sessions.map((x) => [x.id, x])),
    wsByPath: new Map(s.workspaces.map((x) => [x.path, x])),
    ticketByKey: new Map(s.tickets.map((x) => [x.key, x])),
    claimsBySession: new Map(),
    claimsByWorkspace: new Map(),
    workspacesByTicket: new Map(),
    alertsByWorkspace: new Map(),
    alertsByTicket: new Map(),
    airportByRepo: new Map(s.airports.map((a) => [a.repo, a])),
    awayBySession: new Map(),
  };
  for (const [id, repos] of awayOperations(s)) {
    idx.awayBySession.set(id, repos.map((r) => idx.airportByRepo.get(r)).filter((a): a is Airport => Boolean(a)));
  }
  const byRecent = [...s.claims].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  for (const c of byRecent) {
    push(idx.claimsBySession, c.sessionId, c);
    push(idx.claimsByWorkspace, c.workspacePath, c);
  }
  for (const w of s.workspaces) if (w.ticketKey) push(idx.workspacesByTicket, w.ticketKey, w);
  for (const a of s.alerts) {
    if (a.workspacePath) push(idx.alertsByWorkspace, a.workspacePath, a);
    if (a.ticketKey) push(idx.alertsByTicket, a.ticketKey, a);
  }
  return idx;
}

// 티켓을 점유 중인 세션들: 티켓 → 워크트리(브랜치) → 점유
export function occupantsOf(key: string, idx: Index): Session[] {
  const ids = new Set<string>();
  for (const w of idx.workspacesByTicket.get(key) ?? [])
    for (const c of idx.claimsByWorkspace.get(w.path) ?? []) if (c.state === "active") ids.add(c.sessionId);
  return [...ids].map((id) => idx.sessionById.get(id)).filter((x): x is Session => Boolean(x));
}

// 세션 위치: 본 체크아웃이면 관제탑(TWR), 워크트리 안이면 그 주기장, 저장소 밖이면 폴더 이름.
export function sessionLocation(s: Session, idx: Index): { airport: Airport | null; place: string } {
  const airport = s.repo ? (idx.airportByRepo.get(s.repo) ?? null) : null;
  if (!s.workspacePath) return { airport: null, place: projectOf(s.cwd) };
  if (s.workspacePath === s.repo) return { airport, place: "TWR" };
  return { airport, place: idx.wsByPath.get(s.workspacePath)?.name ?? projectOf(s.cwd) };
}

export function hasActiveClaim(claims: Claim[] | undefined): boolean {
  return Boolean(claims?.some((c) => c.state === "active"));
}

// 이양된 점유는 뒤로 보낸다.
export function activeFirst(claims: Claim[]): Claim[] {
  return [...claims].sort((a, b) => Number(a.state !== "active") - Number(b.state !== "active"));
}

export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const sec = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (sec < 45) return "방금";
  if (sec < 3600) return `${Math.round(sec / 60)}분 전`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}시간 전`;
  return `${Math.round(sec / 86_400)}일 전`;
}

export function projectOf(cwd: string): string {
  const m = cwd.match(/\/(?:projects\/worktrees|\.codex\/worktrees\/[^/]+|projects)\/([^/]+)/);
  return m ? m[1] : cwd.split("/").pop() || cwd;
}

const statusRank = { busy: 0, idle: 1, dead: 2 } as const;

export function sortSessions(list: Session[], idx: Index): Session[] {
  return [...list].sort(
    (a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      Number(idx.claimsBySession.has(b.id)) - Number(idx.claimsBySession.has(a.id)) ||
      (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""),
  );
}
