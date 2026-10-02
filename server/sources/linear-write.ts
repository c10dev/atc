import { config } from "../config.ts";
import type { MoveIssue } from "../flight-state.ts";

// Linear에 쓰는 유일한 파일(외부 부작용). G3: 이슈 하나의 상태를 옮긴다(부르는 곳은 flight-state-run.ts의 SUPERVISOR 클릭 하나). D7a: DUTY의 이슈 만들기·고치기·댓글(duty-l1-run.ts).
// 다른 source 파일(linear.ts, linear-labels.ts, linear-projects.ts)은 query만 한다. 토큰은 서버 안에만 있고 화면으로 나가지 않는다.
const ENDPOINT = "https://api.linear.app/graphql";

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

const MOVE_QUERY = `query MoveIssue($id: String!) {
  issue(id: $id) {
    id identifier
    state { name type }
    team { key states(first: 30) { nodes { id name type } } }
  }
}`;

// 읽기: 옮기기 직전의 현재 상태와 그 팀의 상태 목록. 없으면 null
export async function fetchMoveIssue(key: string): Promise<MoveIssue | null> {
  if (!config.linearApiKey) throw new Error("Linear 미연결");
  const d = await gql<{ issue: null | { id: string; identifier: string; state: { name: string; type: string }; team: { key: string; states: { nodes: { id: string; name: string; type: string }[] } } | null } }>(MOVE_QUERY, { id: key });
  const i = d.issue;
  if (!i) return null;
  return { id: i.id, key: i.identifier, team: i.team?.key ?? null, state: i.state, states: i.team?.states.nodes ?? [] };
}

const MOVE_MUTATION = `mutation MoveIssue($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { identifier state { name type } }
  }
}`;

// 쓰기: 상태 하나. 돌려주는 것은 Linear가 말한 새 상태
export async function applyIssueState(id: string, stateId: string): Promise<{ name: string; type: string }> {
  if (!config.linearApiKey) throw new Error("Linear 미연결");
  const d = await gql<{ issueUpdate: { success: boolean; issue: { state: { name: string; type: string } } | null } }>(MOVE_MUTATION, { id, stateId });
  if (!d.issueUpdate.success || !d.issueUpdate.issue) throw new Error("Linear가 상태 변경을 받아들이지 않음");
  return d.issueUpdate.issue.state;
}

// ── DUTY L1(D7a): 이슈 만들기·고치기·댓글. 부르는 곳은 duty-l1-run.ts 하나(판정은 duty-linear.ts) ──
// 시험용으로 ATC_LINEAR_WRITE_URL이 이 컴퓨터(127.0.0.1·localhost)를 가리키면 그리로 보낸다(가짜 Linear). 다른 주소는 무시한다
const writeEndpoint = () => {
  const u = process.env.ATC_LINEAR_WRITE_URL;
  try {
    return u && ["127.0.0.1", "localhost"].includes(new URL(u).hostname) ? u : ENDPOINT;
  } catch {
    return ENDPOINT;
  }
};
async function gqlDuty<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(writeEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: config.linearApiKey || "stub" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return body.data;
}
const ready = () => {
  if (!config.linearApiKey && writeEndpoint() === ENDPOINT) throw new Error("Linear 미연결");
};

export interface DutyTeam {
  id: string;
  states: { id: string; name: string; type: string }[];
  labels: { id: string; name: string }[];
}
const TEAM_QUERY = `query DutyTeam($key: String!) {
  teams(filter: { key: { eq: $key } }) { nodes { id key states(first: 30) { nodes { id name type } } labels(first: 250) { nodes { id name } } } }
  issueLabels(first: 250, filter: { team: { null: true } }) { nodes { id name } }
}`;
// ATC 팀의 id·상태·라벨(팀 라벨과 워크스페이스 라벨). 없으면 null
export async function fetchDutyTeam(key: string): Promise<DutyTeam | null> {
  ready();
  const d = await gqlDuty<{ teams: { nodes: { id: string; states: { nodes: { id: string; name: string; type: string }[] }; labels: { nodes: { id: string; name: string }[] } }[] }; issueLabels: { nodes: { id: string; name: string }[] } }>(TEAM_QUERY, { key });
  const t = d.teams.nodes[0];
  if (!t) return null;
  return { id: t.id, states: t.states.nodes, labels: [...t.labels.nodes, ...d.issueLabels.nodes] };
}

const DUTY_ISSUE_QUERY = `query DutyIssue($id: String!) {
  issue(id: $id) { id identifier state { name type } team { key states(first: 30) { nodes { id name type } } } labels(first: 50) { nodes { id name } } }
}`;
export interface DutyIssueRead {
  id: string;
  key: string;
  team: string | null;
  state: { name: string; type: string };
  labels: { id: string; name: string }[];
  states: { id: string; name: string; type: string }[];
}
export async function fetchDutyIssue(key: string): Promise<DutyIssueRead | null> {
  ready();
  const d = await gqlDuty<{ issue: null | { id: string; identifier: string; state: { name: string; type: string }; team: { key: string; states: { nodes: { id: string; name: string; type: string }[] } } | null; labels: { nodes: { id: string; name: string }[] } } }>(DUTY_ISSUE_QUERY, { id: key });
  const i = d.issue;
  return i ? { id: i.id, key: i.identifier, team: i.team?.key ?? null, state: i.state, labels: i.labels.nodes, states: i.team?.states.nodes ?? [] } : null;
}

// 프로젝트 이름 → id. 없으면 null
export async function fetchProjectId(name: string): Promise<string | null> {
  ready();
  const d = await gqlDuty<{ projects: { nodes: { id: string; name: string }[] } }>(`query DutyProject($name: String!) { projects(first: 5, filter: { name: { eq: $name } }) { nodes { id name } } }`, { name });
  return d.projects.nodes[0]?.id ?? null;
}

export interface CreateInput {
  teamId: string;
  title: string;
  description: string;
  priority: number;
  stateId: string;
  labelIds: string[];
  parentId?: string;
  projectId?: string;
}
export async function createDutyIssue(input: CreateInput): Promise<{ key: string; url: string }> {
  ready();
  const d = await gqlDuty<{ issueCreate: { success: boolean; issue: { identifier: string; url: string } | null } }>(
    `mutation DutyCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`,
    { input },
  );
  if (!d.issueCreate.success || !d.issueCreate.issue) throw new Error("Linear가 이슈 만들기를 받아들이지 않음");
  return { key: d.issueCreate.issue.identifier, url: d.issueCreate.issue.url };
}

// blocker가 blocked를 막는다(Linear 관계 `blocks`, ATC-396). 이슈를 만든 직후 부른다
export async function createDutyBlocks(blockerId: string, blockedId: string): Promise<void> {
  ready();
  const d = await gqlDuty<{ issueRelationCreate: { success: boolean } }>(
    `mutation DutyBlocks($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`,
    { input: { issueId: blockerId, relatedIssueId: blockedId, type: "blocks" } },
  );
  if (!d.issueRelationCreate.success) throw new Error("Linear가 막는 관계를 받아들이지 않음");
}

export interface UpdateInput {
  title?: string;
  description?: string;
  priority?: number;
  stateId?: string;
  labelIds?: string[];
}
export async function updateDutyIssue(id: string, input: UpdateInput): Promise<{ key: string; state: string }> {
  ready();
  const d = await gqlDuty<{ issueUpdate: { success: boolean; issue: { identifier: string; state: { name: string } } | null } }>(
    `mutation DutyUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { identifier state { name } } } }`,
    { id, input },
  );
  if (!d.issueUpdate.success || !d.issueUpdate.issue) throw new Error("Linear가 이슈 고치기를 받아들이지 않음");
  return { key: d.issueUpdate.issue.identifier, state: d.issueUpdate.issue.state.name };
}

export async function createDutyComment(issueId: string, body: string): Promise<{ id: string }> {
  ready();
  const d = await gqlDuty<{ commentCreate: { success: boolean; comment: { id: string } | null } }>(
    `mutation DutyComment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }`,
    { input: { issueId, body } },
  );
  if (!d.commentCreate.success || !d.commentCreate.comment) throw new Error("Linear가 댓글을 받아들이지 않음");
  return d.commentCreate.comment;
}
