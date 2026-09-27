import { config } from "../config.ts";

// NETWORK 탭용: TEAM의 Linear 프로젝트(ROUTE) 목표. 읽기 전용 쿼리 하나, 10분 캐시.
// linear.ts(티켓 보드)와 따로 둔다. 키가 없거나 실패하면 빈 목록(목표는 null로 보인다).

const TTL_MS = 10 * 60_000;
const ENDPOINT = "https://api.linear.app/graphql";

const PROJECTS_QUERY = `query Projects($team: String!) {
  projects(first: 100, filter: { accessibleTeams: { some: { key: { eq: $team } } } }) {
    nodes { name targetDate progress status { name type } }
  }
}`;

export interface ProjectGoal {
  name: string;
  targetDate: string | null;
  progress: number | null; // 0~1
  state: string | null; // status.type(backlog·planned·started·paused·completed·canceled), 없으면 status.name
}

// 응답 한 줄(Linear Project). 옛 state 필드는 deprecated라 status를 읽는다
export interface ProjectNode {
  name?: unknown;
  targetDate?: unknown;
  progress?: unknown;
  status?: { name?: unknown; type?: unknown } | null;
}

export interface LinearProjectsState {
  ok: boolean; // 마지막 가져오기가 성공했나
  error: string | null;
  fetchedAt: string | null;
  projects: ProjectGoal[];
}

const state: LinearProjectsState = { ok: false, error: null, fetchedAt: null, projects: [] };
let lastFetch = 0;
let inflight: Promise<void> | null = null;
let cacheFor = ""; // 키·TEAM이 바뀌면 이전 결과를 버린다

async function fetchProjects(team: string, key: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query: PROJECTS_QUERY, variables: { team } }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return (body.data?.projects?.nodes ?? []) as ProjectNode[];
}

// 응답 한 줄 → ProjectGoal. state는 status.type, 없으면 status.name. 모르는 값은 null
export function toGoal(n: ProjectNode): ProjectGoal | null {
  if (typeof n?.name !== "string" || !n.name) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    name: n.name,
    targetDate: str(n.targetDate),
    progress: typeof n.progress === "number" && Number.isFinite(n.progress) ? n.progress : null,
    state: str(n.status?.type) ?? str(n.status?.name),
  };
}

// 호출 시점에는 마지막 결과를 바로 돌려주고, 10분이 지났으면 백그라운드로 다시 가져온다.
export function readLinearProjects(): LinearProjectsState {
  const key = config.linearApiKey;
  const team = config.linearTeamKey;
  const id = `${team}|${key}`;
  if (id !== cacheFor) {
    cacheFor = id;
    Object.assign(state, { ok: false, error: null, fetchedAt: null, projects: [] });
    lastFetch = 0;
  }
  if (!key) return state;
  if (!inflight && Date.now() - lastFetch > TTL_MS) {
    lastFetch = Date.now();
    inflight = fetchProjects(team, key)
      .then((nodes) => {
        if (cacheFor !== id) return;
        state.projects = nodes.map(toGoal).filter(Boolean) as ProjectGoal[];
        state.ok = true;
        state.error = null;
        state.fetchedAt = new Date().toISOString();
      })
      .catch((e) => void (cacheFor === id && (state.error = String((e as Error).message ?? e))))
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
