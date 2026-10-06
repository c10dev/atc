import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { type GqlCall, linearGql, type LinearOp } from "../linear-call.ts";
import type { MoveIssue } from "../flight-state.ts";

// Linear에 쓰는 유일한 파일(외부 부작용). G3: 이슈 하나의 상태를 옮긴다(부르는 곳은 flight-state-run.ts의 SUPERVISOR 클릭 하나). D7a: DUTY의 이슈 만들기·고치기·댓글(duty-l1-run.ts. ATC-401: 제안 버리기의 사유 댓글과 이슈 읽기도 SUPERVISOR 클릭 하나로 release-run.ts가 부른다).
// 다른 source 파일(linear.ts, linear-labels.ts, linear-projects.ts)은 query만 한다. 토큰은 서버 안에만 있고 화면으로 나가지 않는다.
const ENDPOINT = "https://api.linear.app/graphql";

// 다시 시도·기록·구간 이름은 linear-call.ts(ATC-561). 쓰기의 중복 방지는 아래 create 함수들이 beforeRetry로 건다
type Extra = Pick<GqlCall, "key" | "beforeRetry" | "idempotent" | "retries" | "fetchFn" | "sink" | "sleep" | "rand" | "timeoutMs">;
async function gql<T>(query: string, variables: Record<string, unknown>, op: LinearOp = "read", extra: Extra = {}): Promise<T> {
  return linearGql<T>({ endpoint: ENDPOINT, apiKey: config.linearApiKey, query, variables, op, ...extra });
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
  const d = await gql<{ issue: null | { id: string; identifier: string; description?: string | null; state: { name: string; type: string }; team: { key: string; states: { nodes: { id: string; name: string; type: string }[] } } | null } }>(MOVE_QUERY, { id: key }, "read", { key });
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
  const d = await gql<{ issueUpdate: { success: boolean; issue: { state: { name: string; type: string } } | null } }>(MOVE_MUTATION, { id, stateId }, "update", { key: id, idempotent: true });
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
async function gqlDuty<T>(query: string, variables: Record<string, unknown>, op: LinearOp = "read", extra: Extra = {}): Promise<T> {
  return linearGql<T>({ endpoint: writeEndpoint(), apiKey: config.linearApiKey || "stub", query, variables, op, ...extra });
}
const ready = () => {
  if (!config.linearApiKey && writeEndpoint() === ENDPOINT) throw new Error("Linear 미연결");
};

export interface DutyTeam {
  id: string;
  states: { id: string; name: string; type: string }[];
  labels: { id: string; name: string }[];
}
// teams에는 first를 준다(ATC-400): 생략하면 Linear가 기본 50개로 곱해 states·labels(250)와 곱한 값이 복잡도 한도(10000)를 넘어 "Query too complex"로 거절된다. 팀 하나만 읽는다
export const TEAM_QUERY = `query DutyTeam($key: String!) {
  teams(first: 1, filter: { key: { eq: $key } }) { nodes { id key states(first: 30) { nodes { id name type } } labels(first: 250) { nodes { id name } } } }
  issueLabels(first: 250, filter: { team: { null: true } }) { nodes { id name } }
}`;
// ATC 팀의 id·상태·라벨(팀 라벨과 워크스페이스 라벨). 없으면 null
export async function fetchDutyTeam(key: string, extra: Extra = {}): Promise<DutyTeam | null> {
  ready();
  const d = await gqlDuty<{ teams: { nodes: { id: string; states: { nodes: { id: string; name: string; type: string }[] }; labels: { nodes: { id: string; name: string }[] } }[] }; issueLabels: { nodes: { id: string; name: string }[] } }>(TEAM_QUERY, { key }, "read", { key, ...extra });
  const t = d.teams.nodes[0];
  if (!t) return null;
  return { id: t.id, states: t.states.nodes, labels: [...t.labels.nodes, ...d.issueLabels.nodes] };
}

const DUTY_ISSUE_QUERY = `query DutyIssue($id: String!) {
  issue(id: $id) { id identifier description state { name type } team { key states(first: 30) { nodes { id name type } } } labels(first: 50) { nodes { id name } } }
}`;
export interface DutyIssueRead {
  id: string;
  key: string;
  team: string | null;
  state: { name: string; type: string };
  labels: { id: string; name: string }[];
  states: { id: string; name: string; type: string }[];
  description?: string | null; // Linear가 저장한 본문(Markdown 이스케이프가 들어간 그대로). 발권 해시가 스냅숏과 같아지게 만든 뒤 다시 읽는다(ATC-471)
}
export async function fetchDutyIssue(key: string, extra: Extra = {}): Promise<DutyIssueRead | null> {
  ready();
  const d = await gqlDuty<{ issue: null | { id: string; identifier: string; description?: string | null; state: { name: string; type: string }; team: { key: string; states: { nodes: { id: string; name: string; type: string }[] } } | null; labels: { nodes: { id: string; name: string }[] } } }>(DUTY_ISSUE_QUERY, { id: key }, "read", { key, ...extra });
  const i = d.issue;
  return i ? { id: i.id, key: i.identifier, description: i.description ?? null, team: i.team?.key ?? null, state: i.state, labels: i.labels.nodes, states: i.team?.states.nodes ?? [] } : null;
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
// 만들기는 Linear가 받은 뒤 답이 오기 전에 끊길 수 있다. 클라이언트가 고른 id(IssueCreateInput.id)로 만들어, 다시 보내기 전에 그 id의 이슈가 있는지 먼저 본다(ATC-561).
// 이 입력 필드를 Linear가 모른다고 답하면(아무것도 만들어지지 않은 검증 오류) id 없이 다시 보내고, 대신 같은 팀의 같은 제목을 최근 5분 안에서 찾아 중복을 막는다
const CREATE_MUTATION = `mutation DutyCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`;
const UNKNOWN_ID_FIELD = /\bid\b.*(not defined|unknown|is not a valid)|unknown (field|argument).*\bid\b/i;
export async function createDutyIssue(input: CreateInput, extra: Extra = {}): Promise<{ key: string; url: string }> {
  ready();
  const id = randomUUID();
  const since = new Date(Date.now() - 5_000).toISOString();
  const found = (i: { identifier: string; url: string } | null | undefined) => (i ? { key: i.identifier, url: i.url } : undefined);
  const byId = async () => {
    const d = await gqlDuty<{ issue: { identifier: string; url: string } | null }>(`query DutyCreated($id: String!) { issue(id: $id) { identifier url } }`, { id }, "read", { ...extra, retries: 0 }).catch(() => null);
    return found(d?.issue);
  };
  const byTitle = async () => {
    const d = await gqlDuty<{ issues: { nodes: { identifier: string; url: string }[] } }>(
      `query DutyCreatedByTitle($team: ID!, $title: String!, $since: DateTimeOrDuration!) { issues(first: 1, filter: { team: { id: { eq: $team } }, title: { eq: $title }, createdAt: { gt: $since } }) { nodes { identifier url } } }`,
      { team: input.teamId, title: input.title, since },
      "read",
      { ...extra, retries: 0 },
    ).catch(() => null);
    return found(d?.issues.nodes[0]);
  };
  const send = (withId: boolean) => gqlDuty<{ issueCreate: { success: boolean; issue: { identifier: string; url: string } | null } }>(CREATE_MUTATION, { input: withId ? { ...input, id } : input }, "create", { idempotent: false, beforeRetry: withId ? byId : byTitle, ...extra });
  let d;
  try {
    d = await send(true);
  } catch (e) {
    if (!UNKNOWN_ID_FIELD.test(String((e as Error).message))) throw e;
    d = await send(false);
  }
  if ("key" in d) return d as unknown as { key: string; url: string }; // beforeRetry가 이미 만들어진 이슈를 찾았다
  if (!d.issueCreate.success || !d.issueCreate.issue) throw new Error("Linear가 이슈 만들기를 받아들이지 않음");
  return { key: d.issueCreate.issue.identifier, url: d.issueCreate.issue.url };
}

// blocker가 blocked를 막는다(Linear 관계 `blocks`, ATC-396). 이슈를 만든 직후 부른다
export async function createDutyBlocks(blockerId: string, blockedId: string, extra: Extra = {}): Promise<void> {
  ready();
  // 다시 보내기 전에 그 관계가 이미 있는지 본다(같은 관계를 두 번 만들지 않는다)
  const exists = async () => {
    const d = await gqlDuty<{ issue: { relations: { nodes: { type: string; relatedIssue: { id: string } | null }[] } } | null }>(
      `query DutyBlocksExist($id: String!) { issue(id: $id) { relations(first: 100) { nodes { type relatedIssue { id } } } } }`,
      { id: blockerId },
      "read",
      { ...extra, retries: 0 },
    ).catch(() => null);
    return d?.issue?.relations.nodes.some((r) => r.type === "blocks" && r.relatedIssue?.id === blockedId) ? true : undefined;
  };
  const d = await gqlDuty<{ issueRelationCreate: { success: boolean } } | true>(
    `mutation DutyBlocks($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`,
    { input: { issueId: blockerId, relatedIssueId: blockedId, type: "blocks" } },
    "update",
    { idempotent: false, beforeRetry: exists, ...extra },
  );
  if (d === true) return;
  if (!d.issueRelationCreate.success) throw new Error("Linear가 막는 관계를 받아들이지 않음");
}

export interface UpdateInput {
  title?: string;
  description?: string;
  priority?: number;
  stateId?: string;
  labelIds?: string[];
}
export async function updateDutyIssue(id: string, input: UpdateInput, extra: Extra = {}): Promise<{ key: string; state: string }> {
  ready();
  const d = await gqlDuty<{ issueUpdate: { success: boolean; issue: { identifier: string; state: { name: string } } | null } }>(
    `mutation DutyUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { identifier state { name } } } }`,
    { id, input },
    "update",
    { key: id, idempotent: true, ...extra },
  );
  if (!d.issueUpdate.success || !d.issueUpdate.issue) throw new Error("Linear가 이슈 고치기를 받아들이지 않음");
  return { key: d.issueUpdate.issue.identifier, state: d.issueUpdate.issue.state.name };
}

// 댓글도 클라이언트가 고른 id(CommentCreateInput.id)로 보내고, 다시 보내기 전에 그 id의 댓글이 있는지 본다. Linear가 id를 모른다고 하면 id 없이 보내고 같은 글의 최근 댓글을 찾는다(ATC-561)
export async function createDutyComment(issueId: string, body: string, extra: Extra = {}): Promise<{ id: string }> {
  ready();
  const id = randomUUID();
  const byId = async () => {
    const d = await gqlDuty<{ comment: { id: string } | null }>(`query DutyCommented($id: String!) { comment(id: $id) { id } }`, { id }, "read", { ...extra, retries: 0 }).catch(() => null);
    return d?.comment ? { id: d.comment.id } : undefined;
  };
  const byBody = async () => {
    const d = await gqlDuty<{ issue: { comments: { nodes: { id: string; body: string; createdAt: string }[] } } | null }>(
      `query DutyCommentedByBody($id: String!) { issue(id: $id) { comments(last: 5) { nodes { id body createdAt } } } }`,
      { id: issueId },
      "read",
      { ...extra, retries: 0 },
    ).catch(() => null);
    const cutoff = Date.now() - 2 * 60_000;
    const hit = d?.issue?.comments.nodes.find((c) => c.body === body && Date.parse(c.createdAt) >= cutoff);
    return hit ? { id: hit.id } : undefined;
  };
  const send = (withId: boolean) =>
    gqlDuty<{ commentCreate: { success: boolean; comment: { id: string } | null } } | { id: string }>(
      `mutation DutyComment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }`,
      { input: withId ? { issueId, body, id } : { issueId, body } },
      "comment",
      { key: issueId, idempotent: false, beforeRetry: withId ? byId : byBody, ...extra },
    );
  let d;
  try {
    d = await send(true);
  } catch (e) {
    if (!UNKNOWN_ID_FIELD.test(String((e as Error).message))) throw e;
    d = await send(false);
  }
  if (!("commentCreate" in d)) return d; // beforeRetry가 이미 만들어진 댓글을 찾았다
  if (!d.commentCreate.success || !d.commentCreate.comment) throw new Error("Linear가 댓글을 받아들이지 않음");
  return d.commentCreate.comment;
}
