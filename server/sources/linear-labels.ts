import { config } from "../config.ts";

// SCHEDULE TAIL(ATC-68)용: Linear에 있는 `tail:` 라벨 이름. 읽기 전용, 10분 캐시.
// 워크스페이스 라벨과 팀 라벨을 함께 읽는다(분류·tail 라벨은 워크스페이스 라벨). 키가 없거나 실패하면 null.

const TTL_MS = 10 * 60_000;
const ENDPOINT = "https://api.linear.app/graphql";
const MAX_PAGES = 5;

const LABELS_QUERY = `query TailLabels($after: String) {
  issueLabels(first: 250, after: $after, filter: { name: { startsWithIgnoreCase: "tail:" } }) {
    pageInfo { hasNextPage endCursor }
    nodes { name }
  }
}`;

let cache: { names: Set<string>; at: number; key: string } | null = null;
let inflight: Promise<Set<string> | null> | null = null;

// 라벨 이름 목록 → 비교용 집합(소문자, 앞뒤 공백 없음)(순수)
export const labelSetOf = (names: unknown[]) => new Set(names.filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim().toLowerCase()));

async function fetchTailLabels(key: string): Promise<Set<string>> {
  const names: unknown[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: Response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query: LABELS_QUERY, variables: { after } }),
      signal: AbortSignal.timeout(15_000),
    });
    const body: { data?: { issueLabels?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: { name?: unknown }[] } }; errors?: { message?: string }[] } = await res.json();
    if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
    const q = body.data?.issueLabels;
    names.push(...(q?.nodes ?? []).map((n) => n?.name));
    if (!q?.pageInfo?.hasNextPage || !q.pageInfo.endCursor) break;
    after = q.pageInfo.endCursor;
  }
  return labelSetOf(names);
}

// tail: 라벨 집합. fresh면 캐시를 건너뛴다(방금 만든 라벨을 찾을 때). 못 읽으면 null
export async function loadTailLabels(fresh = false): Promise<Set<string> | null> {
  const key = config.linearApiKey;
  if (!key) return null;
  if (!fresh && cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.names;
  inflight ??= fetchTailLabels(key)
    .then((names) => {
      cache = { names, at: Date.now(), key };
      return names;
    })
    .catch(() => (cache?.key === key ? cache.names : null))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
