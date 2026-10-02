import type { TeamState } from "./flight-state.ts";

// DUTY L1의 Linear 쓰기(D7a, docs/duty.md 3.4·3.6)의 순수 판정. 쓰기는 sources/linear-write.ts, 길은 duty-l1-run.ts.
// DUTY 세션에는 MCP가 없다(--strict-mcp-config, 커넥터는 ACCOUNT마다 다르다): 서버가 자기 키로 쓴다.
// 팀은 ATC 하나, 상태는 Backlog·Todo까지만(Started·Done은 PR과 `Fixes`의 몫), 이슈를 지우거나 닫지 않는다.
export const DUTY_TEAM = "ATC";
export const DUTY_STATES = ["Backlog", "Todo"] as const;
const OPEN_TYPES: readonly string[] = ["backlog", "unstarted"]; // 지금 상태가 이 종류일 때만 상태를 옮긴다
export const TITLE_MAX = 200;
export const BODY_MAX = 60_000;
export const COMMENT_MAX = 20_000;
export const LABELS_MAX = 12;
export const BLOCKED_BY_MAX = 5;

export type LinearOp =
  | { action: "create"; title: string; body: string; priority: number; state: string; parent?: string; project?: string; labels: string[]; blockedBy?: string[] }
  | { action: "update"; key: string; title?: string; body?: string; priority?: number; state?: string; labels?: string[] }
  | { action: "comment"; key: string; body: string };
export type LinearParse = { ok: true; op: LinearOp } | { ok: false; error: string };

const KEY = /^ATC-\d{1,6}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9:._ -]{0,58}$/;
const bad = (error: string): LinearParse => ({ ok: false, error });
const noCtl = (s: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s); // 줄바꿈(\n \r)·탭은 본문에 쓴다

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max && noCtl(v) ? v : null);
const key = (v: unknown): string | null => (typeof v === "string" && KEY.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null);

function labelsOf(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > LABELS_MAX) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !LABEL.test(x.trim())) return null;
    out.push(x.trim());
  }
  return out;
}

// 요청 본문. 알 수 없는 칸은 거절한다(오타가 조용히 무시되지 않게)
export function parseLinearBody(raw: unknown): LinearParse {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!b) return bad("본문은 JSON 객체");
  const known = (names: string[]) => Object.keys(b).find((k) => !names.includes(k));
  if (b.action === "create") {
    const extra = known(["action", "title", "body", "priority", "state", "parent", "project", "labels", "blockedBy"]);
    if (extra) return bad(`알 수 없는 칸: ${extra}`);
    const title = text(b.title, TITLE_MAX);
    const body = text(b.body, BODY_MAX);
    if (!title) return bad(`title이 필요함(${TITLE_MAX}자까지)`);
    if (!body) return bad(`body(Markdown)가 필요함(${BODY_MAX}자까지)`);
    if (!Number.isInteger(b.priority) || (b.priority as number) < 1 || (b.priority as number) > 4) return bad("priority가 필요함(1 Urgent · 2 High · 3 Medium · 4 Low). 우선순위 없는 작업 지시서는 DISPATCH가 후보로 읽지 않는다");
    const state = b.state === undefined ? "Backlog" : b.state;
    if (typeof state !== "string" || !(DUTY_STATES as readonly string[]).includes(state)) return bad("state는 Backlog 또는 Todo만(Started·Done은 PR과 Fixes의 몫)");
    const op: LinearOp = { action: "create", title: title.trim(), body, priority: b.priority as number, state, labels: [] };
    if (b.parent !== undefined) {
      const p = key(b.parent);
      if (!p) return bad("parent는 ATC-<n>");
      op.parent = p;
    }
    if (b.project !== undefined) {
      const p = text(b.project, 120);
      if (!p) return bad("project는 프로젝트 이름(120자까지)");
      op.project = p.trim();
    }
    if (b.labels !== undefined) {
      const l = labelsOf(b.labels);
      if (!l) return bad(`labels는 라벨 이름 목록(${LABELS_MAX}개까지)`);
      op.labels = l;
    }
    // 이 이슈를 막는 FLIGHT(ATC-396): 이미 받아들여진 FLIGHT의 후속이 그 뒤에 기다리게 한다
    if (b.blockedBy !== undefined) {
      const raw = Array.isArray(b.blockedBy) ? b.blockedBy : null;
      const keys = raw?.map(key);
      if (!raw || !keys || raw.length === 0 || raw.length > BLOCKED_BY_MAX || keys.some((k) => k === null)) return bad(`blockedBy는 ATC-<n> 목록(1~${BLOCKED_BY_MAX}개)`);
      op.blockedBy = [...new Set(keys as string[])];
    }
    return { ok: true, op };
  }
  if (b.action === "update") {
    const extra = known(["action", "key", "title", "body", "priority", "state", "labels"]);
    if (extra) return bad(`알 수 없는 칸: ${extra}`);
    const k = key(b.key);
    if (!k) return bad("key는 ATC-<n>");
    const op: LinearOp = { action: "update", key: k };
    if (b.title !== undefined) {
      const t = text(b.title, TITLE_MAX);
      if (!t) return bad(`title은 글(${TITLE_MAX}자까지)`);
      op.title = t.trim();
    }
    if (b.body !== undefined) {
      const t = text(b.body, BODY_MAX);
      if (!t) return bad(`body는 글(${BODY_MAX}자까지)`);
      op.body = t;
    }
    if (b.priority !== undefined) {
      if (!Number.isInteger(b.priority) || (b.priority as number) < 1 || (b.priority as number) > 4) return bad("priority는 1~4");
      op.priority = b.priority as number;
    }
    if (b.state !== undefined) {
      if (typeof b.state !== "string" || !(DUTY_STATES as readonly string[]).includes(b.state)) return bad("state는 Backlog 또는 Todo만");
      op.state = b.state;
    }
    if (b.labels !== undefined) {
      const l = labelsOf(b.labels);
      if (!l) return bad(`labels는 라벨 이름 목록(${LABELS_MAX}개까지)`);
      op.labels = l;
    }
    if (Object.keys(op).length === 2) return bad("바꿀 칸이 없음(title·body·priority·state·labels)");
    return { ok: true, op };
  }
  if (b.action === "comment") {
    const extra = known(["action", "key", "body"]);
    if (extra) return bad(`알 수 없는 칸: ${extra}`);
    const k = key(b.key);
    const body = text(b.body, COMMENT_MAX);
    if (!k) return bad("key는 ATC-<n>");
    if (!body) return bad(`body가 필요함(${COMMENT_MAX}자까지)`);
    return { ok: true, op: { action: "comment", key: k, body } };
  }
  return bad("action은 create | update | comment");
}

export interface DutyIssue {
  id: string;
  key: string;
  team: string | null;
  state: { name: string; type: string };
  labels: { id: string; name: string }[];
}
export type IssueVerdict = { ok: true } | { ok: false; status: 403 | 409; error: string };

// 이슈가 ATC 팀인가(update·comment·parent). 다른 팀 이슈는 건드리지 않는다
export function issueVerdict(issue: DutyIssue): IssueVerdict {
  if ((issue.team ?? "").toUpperCase() !== DUTY_TEAM) return { ok: false, status: 403, error: `팀 ${issue.team ?? "?"}의 이슈는 DUTY가 고치지 않는다(ATC만)` };
  return { ok: true };
}

// update의 상태 이동: 지금 Backlog·Todo 계열이고 가는 곳이 Backlog·Todo일 때만
export function stateVerdict(current: { name: string; type: string }, to: string, states: readonly TeamState[]): { ok: true; stateId: string } | { ok: false; status: 409 | 400; error: string } {
  if (!OPEN_TYPES.includes(current.type)) return { ok: false, status: 409, error: `${current.name}(${current.type})에서는 옮기지 않는다 — Started 이후는 PR과 Fixes, SUPERVISOR의 몫` };
  const s = states.find((x) => x.name === to);
  if (!s || !OPEN_TYPES.includes(s.type)) return { ok: false, status: 400, error: `이 팀에 없는 상태: ${to}` };
  return { ok: true, stateId: s.id };
}

// 라벨 이름 → id(대소문자 무시). 못 찾은 이름이 있으면 목록으로 돌려준다(새 라벨을 만들지 않는다)
export function resolveLabels(names: readonly string[], available: readonly { id: string; name: string }[]): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const hit = available.find((l) => l.name.toLowerCase() === n.toLowerCase());
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else missing.push(n);
  }
  return { ids, missing };
}
