// DUTY 서랍의 대화 상태(ATC-220). 순수 reducer: 기록 줄과 SSE `duty` 이벤트를 접어 화면이 그릴 목록을 만든다. 화면(web/src/DutyDrawer.tsx)과 시험이 같이 쓴다.
import type { DutyLogLine } from "./duty-log.ts";
import type { DutyRate } from "./duty-stream.ts";

// n: 기록(duty.jsonl)의 줄 번호. 기록에서 읽은 줄에만 있고 SSE로 막 들어온 줄에는 없다(ATC-479)
export type ChatItem = (
  | { id: string; kind: "user"; text: string; image?: string; t: string }
  | { id: string; kind: "text"; text: string; t: string }
  | { id: string; kind: "tool"; name: string; summary: string; error: boolean; t: string }
  | { id: string; kind: "notice"; text: string; t: string }
  | { id: string; kind: "shift"; t: string }
  | { id: string; kind: "card"; queueKind: string; key: string; draft: string; t: string }
  | { id: string; kind: "draft"; draftKind: "note" | "charter" | "retire"; draft: string; text: string; until: string | null; t: string }
) & { n?: number };

export interface DutyStatusView {
  enabled: boolean;
  state: "idle" | "thinking" | "down";
  error: string | null;
  account: string;
  sessionId: string | null;
  model: string | null;
  context: number | null;
  cap: number;
  capSource?: "duty.json" | "model" | "default"; // ATC-496
  capNote?: string | null;
  costUsd: number | null;
  rates: DutyRate[];
  queued: number;
  blocked: boolean;
}

export interface Chat {
  items: ChatItem[];
  streaming: string; // 아직 완성되지 않은 DUTY 글(조각을 이은 것)
  status: DutyStatusView | null;
  seq: number;
  older: number | null; // 기록에서 이 목록보다 앞을 읽을 때 넣을 before(GET /api/duty/history의 next). 더 없으면 null
}

export const accountNotice = (from: string, to: string) => `DUTY ACCOUNT ${from} → ${to} · 다음 메시지부터 새 대화`;

export const emptyChat =(): Chat => ({ items: [], streaming: "", status: null, seq: 0, older: null });

// 서버 SSE `duty` 이벤트(DutyEvent + t, 그리고 연결 때의 status)
export type DutyWire =
  | ({ type: "status"; t?: string } & DutyStatusView)
  | { type: "state"; state: "idle" | "thinking" | "down"; error?: string; queued?: number; blocked?: boolean; t: string }
  | { type: "text"; text: string; final: boolean; t: string }
  | { type: "user"; text: string; image?: string; t: string }
  | { type: "tool"; name: string; summary: string; error: boolean; t: string }
  | { type: "notice"; text: string; t: string }
  | { type: "shift"; t: string }
  | { type: "card"; queueKind: string; key: string; draft: string; t: string }
  | { type: "draft"; draftKind: "note" | "charter" | "retire"; draft: string; text: string; until?: string | null; t: string }
  | { type: "usage"; turn: { context: number; costUsd: number | null } | null; rates: DutyRate[]; t: string }
  | { type: "init" | "other"; t?: string };

const MAX_ITEMS = 1000;
type NewItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> : never) : never;
export type { NewItem };
const push = (c: Chat, item: NewItem): Chat => {
  const seq = c.seq + 1;
  const items = [...c.items, { ...item, id: `e${seq}` } as ChatItem];
  return { ...c, seq, items: items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items };
};

// 기록 줄 하나가 그리는 항목(그리지 않는 줄은 null). 줄 번호가 있으면 n에 남긴다
export function itemOfLine(l: DutyLogLine & { n?: number }): NewItem | null {
  const n = l.n === undefined ? {} : { n: l.n };
  switch (l.kind) {
    case "user":
      return { kind: "user", text: l.text, ...(l.image ? { image: l.image } : {}), t: l.t, ...n };
    case "text":
      return { kind: "text", text: l.text, t: l.t, ...n };
    case "tool":
      return { kind: "tool", name: l.name, summary: l.summary, error: l.error, t: l.t, ...n };
    case "notice":
      return { kind: "notice", text: l.text, t: l.t, ...n };
    case "shift":
      return { kind: "shift", t: l.t, ...n };
    case "account":
      return { kind: "notice", text: accountNotice(l.from, l.to), t: l.t, ...n };
    case "card":
      return { kind: "card", queueKind: l.queueKind, key: l.key, draft: l.draft, t: l.t, ...n };
    case "draft":
      return { kind: "draft", draftKind: l.draftKind, draft: l.draft, text: l.text, until: l.until ?? null, t: l.t, ...n };
    default:
      return null; // 사용량 줄은 그리지 않는다
  }
}

// 앞쪽 쪽(더 불러오기)의 항목들. id는 줄 번호에서 따서 쪽을 앞에 붙여도 안 바뀐다
export function olderItems(lines: readonly (DutyLogLine & { n: number })[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const l of lines) {
    const it = itemOfLine(l);
    if (it) out.push({ ...it, id: `h${l.n}` } as ChatItem);
  }
  return out;
}

// 기록 쪽(GET /api/duty/history의 lines)으로 목록을 새로 만든다. older는 그 응답의 next
export function chatFromHistory(lines: readonly (DutyLogLine & { n?: number })[], status: DutyStatusView | null = null, older: number | null = null): Chat {
  let c: Chat = { ...emptyChat(), status, older };
  for (const l of lines) {
    const it = itemOfLine(l);
    if (it) c = push(c, it);
  }
  return c;
}

export function foldDuty(c: Chat, e: DutyWire): Chat {
  switch (e.type) {
    case "status": {
      const { type: _t, t: _at, ...status } = e;
      return { ...c, status };
    }
    case "state": {
      if (!c.status) return c;
      const status = { ...c.status, state: e.state, error: e.error ?? null, queued: e.queued ?? c.status.queued, blocked: e.blocked ?? c.status.blocked };
      return { ...c, status, streaming: e.state === "thinking" ? c.streaming : "" };
    }
    case "text":
      return e.final ? push({ ...c, streaming: "" }, { kind: "text", text: e.text, t: e.t }) : { ...c, streaming: c.streaming + e.text };
    case "user":
      return push({ ...c, streaming: "" }, { kind: "user", text: e.text, ...(e.image ? { image: e.image } : {}), t: e.t });
    case "tool":
      return push({ ...c, streaming: "" }, { kind: "tool", name: e.name, summary: e.summary, error: e.error, t: e.t });
    case "notice":
      return push(c, { kind: "notice", text: e.text, t: e.t });
    case "shift":
      return push({ ...c, streaming: "" }, { kind: "shift", t: e.t });
    case "card":
      return push({ ...c, streaming: "" }, { kind: "card", queueKind: e.queueKind, key: e.key, draft: e.draft, t: e.t });
    case "draft":
      return push(c, { kind: "draft", draftKind: e.draftKind, draft: e.draft, text: e.text, until: e.until ?? null, t: e.t });
    case "usage": {
      if (!c.status) return c;
      const status = { ...c.status };
      if (e.turn) {
        status.context = e.turn.context || status.context;
        status.costUsd = e.turn.costUsd ?? status.costUsd;
      }
      if (e.rates.length) status.rates = e.rates;
      return { ...c, status };
    }
    default:
      return c;
  }
}

// 머리줄: `DUTY · acct-2 · context 12/250k`
export const contextK = (n: number | null): string => (n === null ? "—" : String(Math.round(n / 1000)));
export const headLine = (s: Pick<DutyStatusView, "account" | "context" | "cap">): string => `DUTY · ${s.account} · context ${contextK(s.context)}/${contextK(s.cap)}k`;

// 헤더 readout의 말: 상태 점 색은 화면이 정한다
export const readoutState = (s: Pick<DutyStatusView, "state" | "blocked">): "idle" | "thinking" | "down" => (s.blocked ? "down" : s.state);
