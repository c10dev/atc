// DUTY의 초안(ATC-219, docs/duty.md 3.2·3.3·3.4): 카드 요청, 정해 둘 결정 제안(note), CHARTER REQUEST 초안.
// `duty-drafts.jsonl`(상태 폴더, 추가만)에 한 줄씩 쌓는다. 여기는 모양 검사와 줄 만들기(순수)뿐이다.
// 초안은 아무 밖의 동작도 일으키지 않는다: 카드는 D3, decisions.jsonl은 D4(SUPERVISOR의 확인 클릭), OCC가 읽는 것은 D5다.
import { QUEUE_KINDS, type QueueItem, type QueueKind } from "./supervisor-queue.ts";

export const DRAFT_KINDS = ["card", "note", "charter"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const NOTE_MAX = 1000;
export const CHARTER_MAX = 4000;

export type DraftLine =
  | { id: string; at: string; kind: "card"; card: { queueKind: QueueKind; key: string; title: string; since: string | null; hash: string } }
  | { id: string; at: string; kind: "note"; text: string; until: string | null }
  | { id: string; at: string; kind: "charter"; text: string }
  // D4: 정해 둔 결정의 목록 카드(해제 버튼)를 청한다. 큐 줄이 아니라 고정된 자리 `DECISIONS retire`
  | { id: string; at: string; kind: "retire-card" };

// 초안을 버린다(D4, SUPERVISOR의 클릭): id 없는 줄이라 초안 번호를 세는 데 끼지 않는다
export interface DismissLine {
  kind: "dismiss";
  draft: string;
  at: string;
}
export const RETIRE_CARD = { kind: "DECISIONS", key: "retire" } as const;

export type DraftResult = { ok: true; line: DraftLine } | { ok: false; error: string };

// 다음 초안 번호: 있는 DD-n 가운데 가장 큰 것 + 1
export function nextDraftId(ids: readonly string[]): string {
  let max = 0;
  for (const id of ids) {
    const n = /^DD-(\d+)$/.exec(id)?.[1];
    if (n) max = Math.max(max, Number(n));
  }
  return `DD-${String(max + 1).padStart(4, "0")}`;
}

// 줄바꿈과 탭 말고 제어 문자는 받지 않는다
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// 세션끼리 주고받는 글은 영어다(ATC-126): 한글·가나·한자가 있으면 거절한다
const NOT_ENGLISH = /[぀-ヿ㐀-鿿가-힯]/;

const textOf = (v: unknown, max: number, what: string): { ok: true; text: string } | { ok: false; error: string } => {
  if (typeof v !== "string") return { ok: false, error: `${what}: text is required` };
  const text = v.trim();
  if (!text) return { ok: false, error: `${what}: text is empty` };
  if (text.length > max) return { ok: false, error: `${what}: text is ${text.length} chars, the limit is ${max}` };
  if (CONTROL.test(text)) return { ok: false, error: `${what}: control characters are not allowed` };
  return { ok: true, text };
};

// 카드 요청: `<kind>/<key>`가 지금 SUPERVISOR QUEUE의 줄일 때만
export function cardDraftOf(items: readonly Pick<QueueItem, "kind" | "key" | "since" | "title" | "hash">[], kind: unknown, key: unknown, id: string, now: number): DraftResult {
  if (typeof kind !== "string" || typeof key !== "string") return { ok: false, error: "card: kind and key are required" };
  const k = kind.trim().toUpperCase();
  if (k === RETIRE_CARD.kind.toUpperCase()) {
    if (key.trim() !== RETIRE_CARD.key) return { ok: false, error: `card: DECISIONS has one card, "DECISIONS retire" (the list of standing decisions with a release button)` };
    return { ok: true, line: { id, at: new Date(now).toISOString(), kind: "retire-card" } };
  }
  if (!(QUEUE_KINDS as readonly string[]).includes(k)) return { ok: false, error: `card: unknown kind ${JSON.stringify(kind)}; kinds are ${QUEUE_KINDS.join(", ")}` };
  const row = items.find((i) => i.kind === k && i.key === key.trim());
  if (!row) {
    const same = items.filter((i) => i.kind === k).map((i) => i.key);
    return { ok: false, error: `card: ${k}/${key.trim()} is not in the SUPERVISOR QUEUE now${same.length ? ` (${k} rows: ${same.slice(0, 10).join(", ")})` : ` (no ${k} rows)`}. Only what waits on the SUPERVISOR can be a card` };
  }
  return { ok: true, line: { id, at: new Date(now).toISOString(), kind: "card", card: { queueKind: row.kind as QueueKind, key: row.key, title: row.title, since: row.since, hash: row.hash } } };
}

// 정해 둘 결정의 제안. decisions.jsonl에는 쓰지 않는다(D4, SUPERVISOR의 확인 클릭)
export function noteDraftOf(text: unknown, until: unknown, id: string, now: number): DraftResult {
  const t = textOf(text, NOTE_MAX, "note");
  if (!t.ok) return t;
  let untilIso: string | null = null;
  if (until !== undefined && until !== null && until !== "") {
    const ms = typeof until === "string" ? Date.parse(until) : NaN;
    if (!Number.isFinite(ms)) return { ok: false, error: "note: --until must be an ISO time such as 2026-10-03T03:00:00Z" };
    if (ms <= now) return { ok: false, error: "note: --until is already past" };
    untilIso = new Date(ms).toISOString();
  }
  return { ok: true, line: { id, at: new Date(now).toISOString(), kind: "note", text: t.text, until: untilIso } };
}

// CHARTER REQUEST 초안(영어). 아직 아무도 읽지 않는다(D5)
export function charterDraftOf(text: unknown, id: string, now: number): DraftResult {
  const t = textOf(text, CHARTER_MAX, "charter");
  if (!t.ok) return t;
  if (NOT_ENGLISH.test(t.text)) return { ok: false, error: "charter: write it in English (messages to other sessions are English, ATC-126)" };
  return { ok: true, line: { id, at: new Date(now).toISOString(), kind: "charter", text: t.text } };
}
