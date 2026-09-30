import { config } from "../config.ts";
import type { MoveIssue } from "../flight-state.ts";

// Linear에 쓰는 유일한 파일(DUTY G3, 외부 부작용): 이슈 하나의 상태를 옮긴다. 부르는 곳은 flight-state-run.ts의 SUPERVISOR 클릭 하나뿐이다.
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
