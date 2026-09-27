import { config } from "../config.ts";

// NETWORK 탭용: 읽는 팀 전부(LINEAR_TEAM_KEYS)의 Linear 프로젝트(ROUTE) 목표와 마일스톤(WAYPOINT). 읽기 전용, 10분 캐시.
// 여러 팀이 함께 쓰는 프로젝트·마일스톤은 이름·id로 합치고, 어느 팀에서 읽었는지 teams에 남긴다(docs/routes.md 7장 5단계).
// linear.ts(티켓 보드)와 따로 둔다. 키가 없거나 실패하면 빈 목록(목표는 null로 보인다).

const TTL_MS = 10 * 60_000;
const ENDPOINT = "https://api.linear.app/graphql";

const PROJECTS_QUERY = `query Projects($team: String!) {
  projects(first: 100, filter: { accessibleTeams: { some: { key: { eq: $team } } } }) {
    nodes { name targetDate progress status { name type } }
  }
}`;

// 마일스톤은 따로 읽는다(프로젝트 → 마일스톤 → 이슈를 한 번에 물으면 복잡도 한도를 넘는다). docs/routes.md 3장
const MILESTONES_QUERY = `query Milestones($team: String!, $after: String) {
  projectMilestones(first: 50, after: $after, filter: { project: { accessibleTeams: { some: { key: { eq: $team } } } } }) {
    pageInfo { hasNextPage endCursor }
    nodes { id name description targetDate progress sortOrder status project { name }
      issues(first: 50) { pageInfo { hasNextPage } nodes { identifier title state { name type } completedAt } } }
  }
}`;
const MAX_PAGES = 10;

export interface ProjectGoal {
  name: string;
  targetDate: string | null;
  progress: number | null; // 0~1
  state: string | null; // status.type(backlog·planned·started·paused·completed·canceled), 없으면 status.name
  teams: string[]; // 이 프로젝트를 읽은 팀 키(LINEAR_TEAM_KEYS 순서)
}

// 응답 한 줄(Linear Project). 옛 state 필드는 deprecated라 status를 읽는다
export interface ProjectNode {
  name?: unknown;
  targetDate?: unknown;
  progress?: unknown;
  status?: { name?: unknown; type?: unknown } | null;
}

export interface MilestoneIssue {
  key: string;
  title: string;
  state: string;
  stateType: string; // Linear state.type(completed·canceled·started·unstarted·backlog·triage…)
  completedAt: string | null;
}

export interface Milestone {
  id: string;
  project: string;
  name: string;
  description: string;
  targetDate: string | null;
  progress: number | null; // 0~1(Linear는 0~100을 준다)
  sortOrder: number;
  status: string | null; // done·next·overdue·unstarted
  issues: MilestoneIssue[];
  truncated: boolean; // 이슈가 50개를 넘어 다 못 읽었다
  teams: string[]; // 이 마일스톤을 읽은 팀 키(프로젝트의 팀)
}

export interface MilestoneNode {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  targetDate?: unknown;
  progress?: unknown;
  sortOrder?: unknown;
  status?: unknown;
  project?: { name?: unknown } | null;
  issues?: {
    pageInfo?: { hasNextPage?: unknown } | null;
    nodes?: { identifier?: unknown; title?: unknown; state?: { name?: unknown; type?: unknown } | null; completedAt?: unknown }[] | null;
  } | null;
}

export interface LinearProjectsState {
  ok: boolean; // 마지막 가져오기가 성공했나
  error: string | null;
  fetchedAt: string | null;
  projects: ProjectGoal[];
  milestones: Milestone[] | null; // null: 마일스톤을 못 읽음(프로젝트는 읽었을 수 있다)
  milestonesError: string | null;
}

const state: LinearProjectsState = { ok: false, error: null, fetchedAt: null, projects: [], milestones: null, milestonesError: null };
let lastFetch = 0;
let inflight: Promise<void> | null = null;
let cacheFor = ""; // 키·TEAM이 바뀌면 이전 결과를 버린다

async function gql(key: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return body.data;
}

async function fetchProjects(team: string, key: string) {
  const data = await gql(key, PROJECTS_QUERY, { team });
  return (data?.projects?.nodes ?? []) as ProjectNode[];
}

async function fetchMilestones(team: string, key: string) {
  const out: MilestoneNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql(key, MILESTONES_QUERY, { team, after });
    const q = data?.projectMilestones;
    out.push(...((q?.nodes ?? []) as MilestoneNode[]));
    if (!q?.pageInfo?.hasNextPage || !q.pageInfo.endCursor) break;
    after = q.pageInfo.endCursor;
  }
  return out;
}

// 응답 한 줄 → ProjectGoal. state는 status.type, 없으면 status.name. 모르는 값은 null
export function toGoal(n: ProjectNode, team?: string): ProjectGoal | null {
  if (typeof n?.name !== "string" || !n.name) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    name: n.name,
    targetDate: str(n.targetDate),
    progress: typeof n.progress === "number" && Number.isFinite(n.progress) ? n.progress : null,
    state: str(n.status?.type) ?? str(n.status?.name),
    teams: team ? [team] : [],
  };
}

// 응답 한 줄 → Milestone. 이름·id·프로젝트가 없으면 버린다. 진행률은 0~1로 바꾼다
export function toMilestone(n: MilestoneNode, team?: string): Milestone | null {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const id = str(n?.id);
  const name = str(n?.name);
  const project = str(n?.project?.name);
  if (!id || !name || !project) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const pct = num(n.progress);
  const issues: MilestoneIssue[] = [];
  for (const i of n.issues?.nodes ?? []) {
    const key = str(i?.identifier);
    if (!key) continue;
    issues.push({ key, title: str(i.title) ?? "", state: str(i.state?.name) ?? "", stateType: str(i.state?.type) ?? "", completedAt: str(i.completedAt) });
  }
  return {
    id,
    project,
    name,
    description: str(n.description) ?? "",
    targetDate: str(n.targetDate),
    progress: pct === null ? null : Math.min(1, Math.max(0, Math.round(pct * 100) / 10000)),
    sortOrder: num(n.sortOrder) ?? 0,
    status: str(n.status),
    issues,
    truncated: n.issues?.pageInfo?.hasNextPage === true,
    teams: team ? [team] : [],
  };
}

// 팀마다 읽은 목록을 합친다(순수). 같은 key(프로젝트 이름, 마일스톤 id)는 처음 것을 쓰고 teams만 더한다
export function mergeByTeam<T extends { teams: string[] }>(lists: T[][], keyOf: (x: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const list of lists) {
    for (const x of list) {
      const had = byKey.get(keyOf(x));
      if (had) had.teams = [...new Set([...had.teams, ...x.teams])];
      else byKey.set(keyOf(x), { ...x, teams: [...x.teams] });
    }
  }
  return [...byKey.values()];
}

// 호출 시점에는 마지막 결과를 바로 돌려주고, 10분이 지났으면 백그라운드로 다시 가져온다.
export function readLinearProjects(): LinearProjectsState {
  const key = config.linearApiKey;
  const teams = config.linearTeamKeys;
  const id = `${teams.join(",")}|${key}`;
  if (id !== cacheFor) {
    cacheFor = id;
    Object.assign(state, { ok: false, error: null, fetchedAt: null, projects: [], milestones: null, milestonesError: null });
    lastFetch = 0;
  }
  if (!key) return state;
  if (!inflight && Date.now() - lastFetch > TTL_MS) {
    lastFetch = Date.now();
    const msg = (e: unknown) => String((e as Error).message ?? e);
    // 마일스톤이 실패해도 프로젝트 목표는 쓴다(따로 기록)
    // 팀마다 차례로(동시에 여러 팀을 물어 Linear 한도를 쓰지 않게). 한 팀이라도 실패하면 그 종류 전체를 실패로 본다
    const eachTeam = async <T>(read: (team: string) => Promise<T[]>) => {
      const out: T[][] = [];
      for (const team of teams) out.push(await read(team));
      return out;
    };
    const milestones = eachTeam(async (team) => (await fetchMilestones(team, key)).map((n) => toMilestone(n, team)).filter(Boolean) as Milestone[]).then(
      (lists) => ({ ok: true as const, list: mergeByTeam(lists, (m) => m.id) }),
      (e) => ({ ok: false as const, error: msg(e) }),
    );
    const projects = eachTeam(async (team) => (await fetchProjects(team, key)).map((n) => toGoal(n, team)).filter(Boolean) as ProjectGoal[]);
    inflight = Promise.all([projects, milestones])
      .then(([lists, ms]) => {
        if (cacheFor !== id) return;
        state.projects = mergeByTeam(lists, (g) => g.name);
        state.ok = true;
        state.error = null;
        state.fetchedAt = new Date().toISOString();
        if (ms.ok) Object.assign(state, { milestones: ms.list, milestonesError: null });
        else state.milestonesError = ms.error;
      })
      .catch((e) => void (cacheFor === id && (state.error = msg(e))))
      .finally(() => (inflight = null));
  }
  return state;
}

// 서버가 뜬 뒤 첫 요청은 첫 가져오기를 기다린다(그 뒤로는 캐시를 바로 쓴다)
export async function loadLinearProjects(): Promise<LinearProjectsState> {
  const s = readLinearProjects();
  if (!s.fetchedAt && inflight) await inflight;
  return state;
}
