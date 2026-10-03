// DUTY 카드의 "기다림 / 처리됨 / 결과" 판정(ATC-478, docs/duty-screen.md 3.3). 순수. 화면의 오른쪽 패널, 대화의 한 줄 chip, 결정 기록, 서랍의 "결정 n"이
// 모두 이 한 곳의 규칙을 쓰므로 같은 수를 센다. 결정 기록은 대화 로그(ChatItem)에서 다시 만들고 새 상태 파일은 없다.
import type { ChatItem } from "./duty-chat.ts";
import type { QueueItem } from "./supervisor-queue.ts";

export type Handled = { outcome: string; at: string }; // 이 화면에서 버튼으로 처리한 것(브라우저 메모리)
export type CardItem = Extract<ChatItem, { kind: "card" }>;
export type DraftItem = Extract<ChatItem, { kind: "draft" }>;
export type DecisionItem = CardItem | DraftItem;

export interface StatusCtx {
  items: readonly QueueItem[] | null; // 지금의 SUPERVISOR QUEUE(아직 못 읽었으면 null)
  handled: Readonly<Record<string, Handled>>;
  decisions: { active: { id: string; at: string }[]; confirmedDrafts: Record<string, string>; dismissed: string[] } | null;
  charters: { charters: { id: string; from: string }[] } | null;
  nowMs: number;
}

export type Status =
  | { state: "waiting" }
  | { state: "unknown" } // 큐나 결정 목록을 아직 못 읽었다: 기다림으로도 처리됨으로도 세지 않는다
  | { state: "handled"; outcome: string; at: string | null }
  | { state: "none" }; // 결정을 기다리는 카드가 아니다(정해 둔 결정 목록 카드)

export const isDecision = (it: ChatItem): it is DecisionItem => it.kind === "card" || it.kind === "draft";
export const keyOf = (it: DecisionItem): string => (it.kind === "card" ? `${it.queueKind}/${it.key}` : `${it.draftKind}/${it.draft}`);
export const kindOf = (it: DecisionItem): string => (it.kind === "card" ? it.queueKind : it.draftKind === "note" ? "NOTE" : it.draftKind === "charter" ? "CHARTER REQUEST" : "STANDING DECISIONS");
export const refOf = (it: DecisionItem): string => (it.kind === "card" ? it.key : it.draft);

export function statusOf(it: DecisionItem, c: StatusCtx): Status {
  const mine = c.handled[keyOf(it)];
  if (mine) return { state: "handled", outcome: mine.outcome, at: mine.at };
  if (it.kind === "card") {
    if (c.items === null) return { state: "unknown" };
    // 서버가 큐에서 더는 찾지 못한 카드는 회색이고 "gone"으로 처리된 것이다(누가 했는지는 모른다)
    return c.items.some((i) => i.kind === it.queueKind && i.key === it.key) ? { state: "waiting" } : { state: "handled", outcome: "gone", at: null };
  }
  if (it.draftKind === "retire") return { state: "none" };
  const isCharter = it.draftKind === "charter";
  if (c.decisions === null || (isCharter && c.charters === null)) return { state: "unknown" };
  const sd = isCharter ? c.charters?.charters.find((x) => x.from === it.draft)?.id : c.decisions.confirmedDrafts[it.draft];
  if (sd) return { state: "handled", outcome: "확정", at: isCharter ? null : (c.decisions.active.find((d) => d.id === sd)?.at ?? null) };
  if (c.decisions.dismissed.includes(it.draft)) return { state: "handled", outcome: "버림", at: null };
  if (it.until !== null && Date.parse(it.until) <= c.nowMs) return { state: "handled", outcome: "until 지남", at: it.until };
  return { state: "waiting" };
}

// 같은 카드(키가 같은 것)가 여러 번 나오면 가장 새 것 하나만 센다. 최신이 먼저
function latestPerKey(items: readonly ChatItem[]): DecisionItem[] {
  const seen = new Set<string>();
  const out: DecisionItem[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (!isDecision(it)) continue;
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

// 오른쪽 패널의 카드(= 서랍 "결정 n"의 n)
export const waitingOf = (items: readonly ChatItem[], c: StatusCtx): DecisionItem[] => latestPerKey(items).filter((it) => statusOf(it, c).state === "waiting");

export type LogEntry = { id: string; kind: string; ref: string; outcome: string; at: string | null; sortT: string };

// 결정 기록: 처리된 카드, 최신 처리가 먼저(처리 시각을 모르면 카드가 올라온 시각으로 줄 세운다)
export function decisionLog(items: readonly ChatItem[], c: StatusCtx): LogEntry[] {
  const out: LogEntry[] = [];
  for (const it of latestPerKey(items)) {
    const s = statusOf(it, c);
    if (s.state === "handled") out.push({ id: it.id, kind: kindOf(it), ref: refOf(it), outcome: s.outcome, at: s.at, sortT: s.at ?? it.t });
  }
  return out.sort((a, b) => (a.sortT < b.sortT ? 1 : a.sortT > b.sortT ? -1 : 0));
}

const hhmm = (t: string | null) => (t && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t) ? `${t.slice(11, 16)}Z` : "");

// 결과 글: `승인 · 14:05Z`(시각을 모르면 결과만)
export const outcomeText = (outcome: string, at: string | null): string => [outcome, hhmm(at)].filter(Boolean).join(" · ");

// 대화 속 한 줄 chip의 글. 기다리면 패널을 가리키고, 처리됐으면 결과와 시각
export function chipText(it: DecisionItem, s: Status): string {
  const head = `${kindOf(it)} ${refOf(it)}`;
  if (s.state === "waiting") return `${head} → 오른쪽 패널`;
  if (s.state === "handled") return `${head} · ${outcomeText(s.outcome, s.at)}`;
  if (s.state === "unknown") return `${head} · 읽는 중`;
  return head;
}
