// FLIGHT drawer·PR drawer(DUTY G1, docs/duty.md 3.6)의 자료를 화면용으로 다듬는 순수 함수. 읽기 전용, 입출력 없음.

const KEY_RE = /^[A-Z][A-Z0-9]*-\d{1,7}$/;
const CODE_RE = /^[A-Z0-9]{2,8}$/;
const BODY_MAX = 20_000;
const COMMENT_MAX = 4_000;
const FILES_MAX = 100;

export const flightKeyOf = (s: string): string | null => {
  const k = s.trim().toUpperCase();
  return KEY_RE.test(k) ? k : null;
};

// #pr/<airport 코드>/<번호>
export function prRefOf(airport: string, number: string): { airport: string; number: number } | null {
  const code = airport.trim().toUpperCase();
  if (!CODE_RE.test(code) || !/^\d{1,7}$/.test(number) || Number(number) < 1) return null;
  return { airport: code, number: Number(number) };
}

export const cut = (s: unknown, max: number) => {
  const t = typeof s === "string" ? s : "";
  return t.length > max ? { text: t.slice(0, max), truncated: true } : { text: t, truncated: false };
};
// 링크는 http(s)만(그 밖은 화면에 내지 않는다)
export const safeUrl = (u: unknown): string | null => (typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);
export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const nodes = (v: unknown): Record<string, unknown>[] => {
  const n = obj(v).nodes;
  return Array.isArray(n) ? n.map(obj) : [];
};

export interface IssueRef {
  key: string;
  title: string;
  state: string | null;
  stateType: string | null;
}
export interface IssueDetail {
  key: string;
  title: string;
  url: string | null;
  state: string | null;
  stateType: string | null;
  priority: number;
  assignee: string | null;
  project: string | null;
  labels: string[];
  description: string;
  descriptionTruncated: boolean;
  blockedBy: IssueRef[];
  blocks: IssueRef[];
  parent: IssueRef | null;
  children: IssueRef[];
  comments: { author: string | null; at: string | null; body: string; truncated: boolean }[];
  prs: { url: string; title: string | null }[];
  // DUTY G3: READY(Backlog이고 막는 FLIGHT가 모두 Done·Canceled)와, SUPERVISOR가 상태 버튼으로 옮길 수 있는 곳(이 팀의 Backlog·Todo·Canceled, 지금 상태는 뺀다)
  ready: boolean;
  moves: { name: string; type: string }[];
}

const refOf = (n: Record<string, unknown>): IssueRef | null => {
  const key = str(n.identifier);
  if (!key) return null;
  const st = obj(n.state);
  return { key, title: str(n.title) ?? "", state: str(st.name), stateType: str(st.type) };
};
const refs = (xs: (Record<string, unknown> | null)[]) => xs.map((x) => (x ? refOf(x) : null)).filter((r): r is IssueRef => r !== null);

// 상태 버튼이 다루는 곳은 Backlog·Todo·Canceled뿐이다(DUTY G3). Started·Done은 팀의 PR(`Fixes ATC-n`)과 Linear에서 SUPERVISOR가 한다
export const MOVABLE_TYPES: readonly string[] = ["backlog", "unstarted", "canceled"];
const FINISHED_TYPES: readonly string[] = ["completed", "canceled"];

// READY: Backlog이고 막는 FLIGHT가 하나 이상 있고 모두 Done·Canceled. 막는 FLIGHT가 없으면 "풀린 것"이 아니라 그냥 Backlog다.
// 이미 읽은 관계만 본다: 상태를 모르는 blocker가 있으면 READY가 아니다
export const isReady = (stateType: string | null, blockerTypes: readonly (string | null)[]): boolean =>
  stateType === "backlog" && blockerTypes.length > 0 && blockerTypes.every((t) => t !== null && FINISHED_TYPES.includes(t));

// 지금 상태에서 상태 버튼이 옮길 수 있는 곳. 지금 상태가 Started·Done이면 없다(그 이슈는 팀과 Linear의 몫)
export function movesOf(current: { name: string | null; type: string | null }, states: readonly { name: string; type: string }[]): { name: string; type: string }[] {
  if (!current.type || !MOVABLE_TYPES.includes(current.type)) return [];
  return states.filter((x) => MOVABLE_TYPES.includes(x.type) && x.name !== current.name).map((x) => ({ name: x.name, type: x.type }));
}

// Linear GraphQL issue 노드 → IssueDetail
export function shapeIssue(raw: unknown): IssueDetail {
  const n = obj(raw);
  const desc = cut(n.description, BODY_MAX);
  const rel = nodes(n.relations);
  const inv = nodes(n.inverseRelations);
  const blockedBy = refs(inv.filter((r) => r.type === "blocks").map((r) => obj(r.issue)).map((i) => (i.identifier ? i : null)));
  const stateName = str(obj(n.state).name);
  const stateType = str(obj(n.state).type);
  return {
    key: str(n.identifier) ?? "",
    title: str(n.title) ?? "",
    url: safeUrl(n.url),
    state: stateName,
    stateType,
    priority: typeof n.priority === "number" ? n.priority : 0,
    assignee: str(obj(n.assignee).displayName),
    project: str(obj(n.project).name),
    labels: nodes(n.labels).map((l) => {
      const g = str(obj(l.parent).name);
      return `${g ? `${g}:` : ""}${str(l.name) ?? ""}`;
    }).filter(Boolean),
    description: desc.text,
    descriptionTruncated: desc.truncated,
    blockedBy,
    blocks: refs(rel.filter((r) => r.type === "blocks").map((r) => obj(r.relatedIssue)).map((i) => (i.identifier ? i : null))),
    parent: n.parent ? refOf(obj(n.parent)) : null,
    children: refs(nodes(n.children)),
    comments: nodes(n.comments).map((c) => {
      const b = cut(c.body, COMMENT_MAX);
      return { author: str(obj(c.user).displayName), at: str(c.createdAt), body: b.text, truncated: b.truncated };
    }),
    // 붙은 GitHub PR(Linear attachment)
    prs: nodes(n.attachments)
      .map((a) => ({ url: safeUrl(a.url), title: str(a.title) }))
      .filter((a): a is { url: string; title: string | null } => a.url !== null && /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(a.url)),
    ready: isReady(stateType, blockedBy.map((r) => r.stateType)),
    moves: movesOf({ name: stateName, type: stateType }, nodes(obj(n.team).states).map((x) => ({ name: str(x.name) ?? "", type: str(x.type) ?? "" })).filter((x) => x.name && x.type)),
  };
}

export interface PrCheck {
  name: string;
  state: "pass" | "fail" | "pending" | "skipped";
}
export interface PrDetail {
  number: number;
  title: string;
  url: string | null;
  state: string;
  draft: boolean;
  author: string | null;
  createdAt: string | null;
  branch: string | null;
  base: string | null;
  head: string | null;
  ticketKey: string | null;
  labels: string[];
  body: string;
  bodyTruncated: boolean;
  reviewDecision: string | null;
  mergeState: string | null;
  checks: PrCheck[];
  files: { path: string; additions: number; deletions: number }[];
  filesTotal: number;
  // atc가 폴링해 아는 것(열린 PR만): 착륙 판단과 MCC INSPECTION, 등급
  fork: boolean; // 다른 저장소의 fork에서 온 PR
  landing: { state: "CLEARED" | "APPROACH"; blocks: string[]; tier: "auto" | "flagged" | "user" | null; inspection: { verdict: string; p0: number; p1: number; p2: number; at: string } | null } | null;
}

function checkOf(c: Record<string, unknown>): PrCheck | null {
  const name = str(c.name) ?? str(c.context);
  if (!name) return null;
  const status = str(c.status) ?? str(c.state);
  const concl = str(c.conclusion) ?? (c.__typename === "StatusContext" ? str(c.state) : null);
  const s = (concl ?? "").toUpperCase();
  const st = (status ?? "").toUpperCase();
  if (["SUCCESS", "NEUTRAL"].includes(s)) return { name, state: "pass" };
  if (s === "SKIPPED") return { name, state: "skipped" };
  if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s)) return { name, state: "fail" };
  if (st === "COMPLETED" && !s) return { name, state: "pass" };
  return { name, state: "pending" };
}

// gh pr view --json 결과 → PrDetail. 같은 이름의 체크는 마지막 것만
export function shapePr(raw: unknown, ticketKeyOf: (branch: string, title: string) => string | null = () => null): PrDetail {
  const v = obj(raw);
  const body = cut(v.body, BODY_MAX);
  const byName = new Map<string, PrCheck>();
  for (const c of Array.isArray(v.statusCheckRollup) ? v.statusCheckRollup : []) {
    const k = checkOf(obj(c));
    if (k) byName.set(k.name, k);
  }
  const files = Array.isArray(v.files) ? v.files.map(obj) : [];
  const branch = str(v.headRefName);
  const title = str(v.title) ?? "";
  return {
    number: typeof v.number === "number" ? v.number : 0,
    title,
    url: safeUrl(v.url),
    state: str(v.state) ?? "OPEN",
    draft: v.isDraft === true,
    author: str(obj(v.author).login),
    createdAt: str(v.createdAt),
    branch,
    base: str(v.baseRefName),
    head: str(v.headRefOid),
    ticketKey: ticketKeyOf(branch ?? "", title),
    labels: (Array.isArray(v.labels) ? v.labels : []).map((l) => str(obj(l).name)).filter((x): x is string => x !== null),
    body: body.text,
    bodyTruncated: body.truncated,
    reviewDecision: str(v.reviewDecision),
    mergeState: str(v.mergeStateStatus),
    checks: [...byName.values()],
    files: files.slice(0, FILES_MAX).map((f) => ({ path: str(f.path) ?? "", additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 })),
    filesTotal: files.length,
    fork: v.isCrossRepository === true,
    landing: null,
  };
}

// 주소 #flight/<KEY> · #pr/<AIRPORT>/<번호> → 서랍. 그 밖의 주소는 null(탭 주소)
export type DrawerRef = { kind: "flight"; key: string } | { kind: "pr"; airport: string; number: number } | { kind: "ideas" } | { kind: "idea"; number: number };
export function drawerOfHash(hash: string): DrawerRef | null {
  const [head, a, b] = hash.replace(/^#/, "").split("/");
  // IDEAS 서랍(DUTY G4): #ideas, #ideas/<번호>
  if (head === "ideas" && a === undefined) return { kind: "ideas" };
  if (head === "ideas" && b === undefined && /^\d{1,7}$/.test(a) && Number(a) >= 1) return { kind: "idea", number: Number(a) };
  if (head === "flight" && a) {
    const key = flightKeyOf(a);
    return key ? { kind: "flight", key } : null;
  }
  if (head === "pr" && a && b) {
    const r = prRefOf(a, b);
    return r ? { kind: "pr", ...r } : null;
  }
  return null;
}

// 60초 캐시(백그라운드 폴링 없음). 오류는 캐시하지 않는다
export function makeCache<T>(ttlMs: number, now: () => number = Date.now) {
  const m = new Map<string, { at: number; v: Promise<T> }>();
  const get = (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = m.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.v;
    const v = load();
    m.set(key, { at: now(), v });
    v.catch(() => {
      if (m.get(key)?.v === v) m.delete(key);
    });
    if (m.size > 200) for (const [k, e] of m) if (now() - e.at >= ttlMs) m.delete(k);
    return v;
  };
  // 쓰기 뒤에 그 항목을 버린다(DUTY G3: 옮긴 상태를 60초 동안 옛 값으로 보이지 않게)
  return Object.assign(get, { forget: (key: string) => void m.delete(key) });
}
