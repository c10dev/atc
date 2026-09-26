import { config } from "../config.ts";
import type { Ticket, TicketColumn, TicketStateType } from "../model.ts";

const POLL_MS = 60_000;
const ENDPOINT = "https://api.linear.app/graphql";

const ISSUE_FIELDS = `identifier title url priority updatedAt
  state { name type color }
  assignee { displayName }`;

const BOARD_QUERY = `query Board($team: String!) {
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

interface IssueNode {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  updatedAt: string;
  state: { name: string; type: string; color: string };
  assignee: { displayName: string } | null;
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
let wantedKeys = new Set<string>();

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

function toTicket(n: IssueNode): Ticket {
  return {
    key: n.identifier,
    title: n.title,
    state: n.state.name,
    stateType: n.state.type as TicketStateType,
    stateColor: n.state.color,
    assignee: n.assignee?.displayName ?? null,
    priority: n.priority,
    url: n.url,
    updatedAt: n.updatedAt,
  };
}

async function fetchAll() {
  const team = config.linearTeamKey;
  const board = await gql<{
    issues: { nodes: IssueNode[] };
    workflowStates: { nodes: { name: string; type: string; color: string; position: number }[] };
  }>(BOARD_QUERY, { team });
  const byKey = new Map(board.issues.nodes.map((n) => [n.identifier, toTicket(n)]));

  // 브랜치가 가리키는데 45일 창 밖에 있는 티켓은 번호로 따로 가져온다.
  const missing = [...wantedKeys].filter((k) => !byKey.has(k)).map((k) => Number(k.split("-")[1]));
  if (missing.length) {
    const extra = await gql<{ issues: { nodes: IssueNode[] } }>(BY_NUMBER_QUERY, { team, numbers: missing });
    for (const n of extra.issues.nodes) byKey.set(n.identifier, toTicket(n));
  }

  const typeOrder = ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"];
  state.columns = board.workflowStates.nodes
    .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.position - b.position)
    .map((s) => ({ name: s.name, type: s.type as TicketStateType, color: s.color }));
  state.tickets = [...byKey.values()];
  state.fetchedAt = new Date().toISOString();
  state.error = null;
}

// 1분마다 백그라운드로 갱신하고, 호출 시점에는 마지막 결과를 바로 돌려준다.
export function readLinear(branchKeys: Set<string>): LinearState {
  if (!state.enabled) return state;
  const grew = [...branchKeys].some((k) => !wantedKeys.has(k));
  wantedKeys = branchKeys;
  if (!inflight && (grew || Date.now() - lastFetch > POLL_MS)) {
    lastFetch = Date.now();
    inflight = fetchAll()
      .catch((e) => void (state.error = String(e.message ?? e)))
      .finally(() => (inflight = null));
  }
  return state;
}
