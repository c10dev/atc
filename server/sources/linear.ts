import { config } from "../config.ts";
import { teamOfKey } from "../linear-keys.ts";
import { k3CheckOf } from "../k3-allow.ts";
import { sequenceOf } from "../sequence-line.ts";
import { kEffectsOf, releaseHashOf } from "../release.ts";
import type { Ticket, TicketColumn, TicketStateType } from "../model.ts";
import { applyWrite, reconcileFetch, type StateOverlay } from "../linear-overlay.ts";

const POLL_MS = 60_000;
const ENDPOINT = "https://api.linear.app/graphql";

const ISSUE_FIELDS = `identifier title url description priority updatedAt createdAt startedAt
  state { name type color }
  assignee { id displayName }
  delegate { id displayName }
  project { name }
  labels(first: 20) { nodes { name parent { name } } }
  parent { identifier }
  children(first: 50) { nodes { identifier } }
  relations(first: 20) { nodes { type relatedIssue { identifier } } }
  inverseRelations(first: 20) { nodes { type issue { identifier } } }`;

const BOARD_QUERY = `query Board($team: String!) {
  viewer { id }
  issues(first: 200, orderBy: updatedAt,
         filter: { team: { key: { eq: $team } }, updatedAt: { gt: "-P45D" } }) {
    nodes { ${ISSUE_FIELDS} }
  }
  workflowStates(filter: { team: { key: { eq: $team } } }) {
    nodes { name type color position }
  }
}`;

const BY_NUMBER_QUERY = `query ByNumber($team: String!, $numbers: [Float!]) {
  issues(first: 100, filter: { team: { key: { eq: $team } }, number: { in: $numbers } }) {
    nodes { ${ISSUE_FIELDS} }
  }
}`;

export interface IssueNode {
  identifier: string;
  title: string;
  url: string;
  description?: string | null;
  priority: number;
  updatedAt: string;
  createdAt?: string;
  startedAt?: string | null;
  state: { name: string; type: string; color: string };
  assignee: { id?: string; displayName: string } | null;
  delegate?: { id: string; displayName: string } | null; // Linear agent 위임(Codex 등)
  project?: { name: string } | null;
  labels?: { nodes: { name: string; parent?: { name: string } | null }[] };
  parent?: { identifier: string } | null;
  children?: { nodes: { identifier: string }[] };
  relations?: { nodes: { type: string; relatedIssue: { identifier: string } | null }[] };
  inverseRelations?: { nodes: { type: string; issue: { identifier: string } | null }[] };
}

export interface LinearState {
  enabled: boolean;
  error: string | null;
  fetchedAt: string | null;
  tickets: Ticket[];
  columns: TicketColumn[];
}

const state: LinearState = {
  enabled: Boolean(config.linearApiKey),
  error: null,
  fetchedAt: null,
  tickets: [],
  columns: [],
};
let lastFetch = 0;
let inflight: Promise<void> | null = null;
let generation = 0; // resetLinear마다 올라간다. 이전 설정으로 가져온 결과는 버린다.
let wantedKeys = new Set<string>();
// atc가 Linear에 쓴 상태 변경(ATC-448): 쓴 직후 캐시에 보이고, 쓰기 뒤에 시작한 가져오기가 도착하면 Linear의 답이 이긴다(linear-overlay.ts)
let overlays = new Map<string, StateOverlay>();
let seq = 0;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: config.linearApiKey },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return body.data;
}

// atc 밖에서 이 이슈를 맡은 사람·agent: 위임 대상, 없으면 담당자가 API 키 주인(viewer)이 아닐 때 그 이름.
// viewer를 모르면(null) 아무도 밖으로 보지 않는다
export function takenByOf(n: Pick<IssueNode, "assignee" | "delegate">, viewer: string | null): string | null {
  if (!viewer) return null;
  if (n.delegate && n.delegate.id !== viewer) return n.delegate.displayName;
  if (n.assignee?.id && n.assignee.id !== viewer) return n.assignee.displayName;
  return null;
}

// relations: 이 이슈 → 상대(blocks면 "내가 상대를 막음"), inverseRelations: 상대 → 이 이슈(blocks면 "상대가 나를 막음")
export function toTicket(n: IssueNode, viewer: string | null = null): Ticket {
  const out = (n.relations?.nodes ?? []).filter((r) => r.relatedIssue);
  const inn = (n.inverseRelations?.nodes ?? []).filter((r) => r.issue);
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  return {
    key: n.identifier,
    title: n.title,
    state: n.state.name,
    stateType: n.state.type as TicketStateType,
    stateColor: n.state.color,
    assignee: n.assignee?.displayName ?? null,
    takenBy: takenByOf(n, viewer),
    priority: n.priority,
    url: n.url,
    updatedAt: n.updatedAt,
    project: n.project?.name ?? null,
    // 라벨 그룹의 하위 라벨은 "그룹:이름"(예: Risk:Security, type:BUILD). 단독 라벨은 이름 그대로.
    labels: (n.labels?.nodes ?? []).map((l) => (l.parent?.name ? `${l.parent.name}:${l.name}` : l.name)),
    createdAt: n.createdAt ?? null,
    startedAt: n.startedAt ?? null,
    blocks: uniq(out.filter((r) => r.type === "blocks").map((r) => r.relatedIssue!.identifier)),
    blockedBy: uniq(inn.filter((r) => r.type === "blocks").map((r) => r.issue!.identifier)),
    related: uniq([
      ...out.filter((r) => r.type === "related").map((r) => r.relatedIssue!.identifier),
      ...inn.filter((r) => r.type === "related").map((r) => r.issue!.identifier),
    ]),
    parent: n.parent?.identifier ?? null,
    children: uniq((n.children?.nodes ?? []).map((c) => c.identifier)),
    kEffects: kEffectsOf(n.description),
    ...(({ declared, check }) => ({ ...(declared.length ? { k3: declared } : {}), ...(check ? { k3Check: check } : {}) }))(k3CheckOf(n.description)),
    ...(({ seq }) => (seq ? { sequence: seq } : {}))({ seq: sequenceOf(n.description) }),
    releaseHash: releaseHashOf(n.description),
  };
}

type WorkflowState = { name: string; type: string; color: string; position: number };

// 팀 하나: 45일 안에 바뀐 이슈와 상태 목록, 브랜치가 가리키는데 창 밖에 있는 이슈(번호로 따로)
async function fetchTeam(team: string, wanted: string[]): Promise<{ tickets: Ticket[]; states: WorkflowState[] }> {
  const board = await gql<{ viewer: { id: string }; issues: { nodes: IssueNode[] }; workflowStates: { nodes: WorkflowState[] } }>(BOARD_QUERY, { team });
  const viewer = board.viewer?.id ?? null;
  const byKey = new Map(board.issues.nodes.map((n) => [n.identifier, toTicket(n, viewer)]));
  const missing = wanted.filter((k) => !byKey.has(k)).map((k) => Number(k.split("-")[1]));
  if (missing.length) {
    const extra = await gql<{ issues: { nodes: IssueNode[] } }>(BY_NUMBER_QUERY, { team, numbers: missing });
    for (const n of extra.issues.nodes) byKey.set(n.identifier, toTicket(n, viewer));
  }
  return { tickets: [...byKey.values()], states: board.workflowStates.nodes };
}

// 팀마다 다른 상태 목록을 이름으로 합친다(같은 이름이면 먼저 읽은 팀, 즉 주 팀의 것). 순서는 종류 → 팀 안의 위치
export function mergeColumns(perTeam: WorkflowState[][]): TicketColumn[] {
  const typeOrder = ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"];
  const seen = new Map<string, WorkflowState>();
  for (const states of perTeam) for (const s of states) if (!seen.has(s.name)) seen.set(s.name, s);
  return [...seen.values()]
    .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.position - b.position)
    .map((s) => ({ name: s.name, type: s.type as TicketStateType, color: s.color }));
}

// 팀마다 따로 읽는다(한 팀의 200건이 다른 팀을 밀어내지 않게). 한 팀이 실패하면 그 팀은 마지막으로 읽은 결과를 쓰고
// 오류에 팀을 적는다. 한 번도 읽지 못한 팀이 있으면 전체를 실패로 둔다 — 그 팀 티켓이 빈 채로 fetchedAt이 서면
// SCHEDULE이 그 팀의 열린 초안을 모두 SUPERSEDED로 닫는다.
let lastByTeam = new Map<string, { tickets: Ticket[]; states: WorkflowState[] }>();
async function fetchAll() {
  const gen = generation;
  const fetchSeq = ++seq;
  const teams = config.linearTeamKeys;
  const results = await Promise.allSettled(teams.map((team) => fetchTeam(team, [...wantedKeys].filter((k) => teamOfKey(k) === team))));
  if (gen !== generation) return;
  const errors: string[] = [];
  const merged = teams.map((team, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      lastByTeam.set(team, r.value);
      return r.value;
    }
    errors.push(`${team}: ${String(r.reason?.message ?? r.reason)}`);
    return lastByTeam.get(team) ?? null;
  });
  if (merged.some((m) => !m)) throw new Error(errors.join(" · "));
  const got = merged as { tickets: Ticket[]; states: WorkflowState[] }[];
  state.columns = mergeColumns(got.map((r) => r.states));
  const rec = reconcileFetch(got.flatMap((r) => r.tickets), overlays, fetchSeq);
  overlays = rec.overlays;
  state.tickets = rec.tickets;
  state.fetchedAt = new Date().toISOString();
  state.error = errors.length ? `일부 팀을 읽지 못해 마지막 결과를 씀 — ${errors.join(" · ")}` : null;
}

// 설정 창에서 API 키나 TEAM이 바뀌면 이전 결과를 버리고 다음 호출에서 바로 다시 가져온다.
export function resetLinear() {
  generation++;
  lastByTeam = new Map();
  state.enabled = Boolean(config.linearApiKey);
  state.error = null;
  state.fetchedAt = null;
  state.tickets = [];
  state.columns = [];
  lastFetch = 0;
  overlays = new Map();
}

// atc 자신의 Linear 쓰기가 성공한 뒤에만 부른다: 캐시의 티켓 상태를 바로 바꾼다(다음 스냅샷과 /api/releases가 Linear와 같아진다)
export function noteLocalState(key: string, next: { name: string; type: string }) {
  const color = state.columns.find((c) => c.name === next.name)?.color ?? null;
  const r = applyWrite(state.tickets, overlays, key, { ...next, color }, ++seq);
  overlays = r.overlays;
  state.tickets = r.tickets;
  for (const l of localStateListeners) l(key, { ...next, color });
}
// 이미 만들어 둔 스냅샷(2초 주기)에도 같은 변경을 싣는 곳(index.ts): 바로 다음 읽기가 옛 상태를 보지 않게
type LocalStateListener = (key: string, next: { name: string; type: string; color: string | null }) => void;
const localStateListeners: LocalStateListener[] = [];
export const onLocalState = (l: LocalStateListener) => void localStateListeners.push(l);

// 1분마다 백그라운드로 갱신하고, 호출 시점에는 마지막 결과를 바로 돌려준다.
export function readLinear(branchKeys: Set<string>): LinearState {
  if (!state.enabled) return state;
  const grew = [...branchKeys].some((k) => !wantedKeys.has(k));
  wantedKeys = branchKeys;
  if (!inflight && (grew || Date.now() - lastFetch > POLL_MS)) {
    lastFetch = Date.now();
    const gen = generation;
    inflight = fetchAll()
      .catch((e) => void (gen === generation && (state.error = String(e.message ?? e))))
      .finally(() => (inflight = null));
  }
  return state;
}

// DISPATCH 세션이 FLIGHT 본문·댓글을 읽을 때(읽기 전용)
const DETAIL_QUERY = `query Detail($id: String!) {
  issue(id: $id) {
    identifier title url description priority
    state { name }
    project { name }
    comments(first: 20) { nodes { body createdAt user { displayName } } }
  }
}`;

export async function fetchIssueDetail(key: string) {
  if (!config.linearApiKey) throw new Error("Linear 미연결");
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) throw new Error(`FLIGHT key 형식이 아님: ${key}`);
  const data = await gql<{ issue: null | Record<string, unknown> & { comments: { nodes: unknown[] } } }>(DETAIL_QUERY, { id: key });
  if (!data.issue) throw new Error(`${key}를 찾을 수 없음`);
  return { ...data.issue, comments: data.issue.comments.nodes };
}

// FLIGHT drawer(DUTY G1): 본문·댓글·관계·붙은 PR까지 읽는다(읽기 전용, 호출은 detail-run.ts가 60초 캐시)
const DRAWER_QUERY = `query Drawer($id: String!) {
  issue(id: $id) {
    identifier title url description priority
    state { name type }
    team { states(first: 30) { nodes { name type } } }
    assignee { displayName }
    project { name }
    labels(first: 20) { nodes { name parent { name } } }
    parent { identifier title state { name type } }
    children(first: 50) { nodes { identifier title state { name type } } }
    relations(first: 20) { nodes { type relatedIssue { identifier title state { name type } } } }
    inverseRelations(first: 20) { nodes { type issue { identifier title state { name type } } } }
    attachments(first: 20) { nodes { url title } }
    comments(first: 20) { nodes { body createdAt user { displayName } } }
  }
}`;

export async function fetchIssueDrawer(key: string): Promise<unknown> {
  if (!config.linearApiKey) throw new Error("Linear 미연결");
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) throw new Error(`FLIGHT key 형식이 아님: ${key}`);
  const data = await gql<{ issue: unknown }>(DRAWER_QUERY, { id: key });
  if (!data.issue) throw new Error(`${key}를 찾을 수 없음`);
  return data.issue;
}
