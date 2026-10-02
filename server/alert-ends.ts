import type { EndedKey, EndRule } from "./following.ts";

// 알림의 끝 규칙(ATC-385)을 감시한다. 순수 함수만. 파일은 alert-ends-run.ts.
// 끝 규칙이 알림을 뺀 뒤 24시간 안에 같은 알림이 돌아오면 세어서, 규칙이 틀렸다면 드러나게 한다(shadow 대신 live + 카운터, atc-live-first).

export const REAPPEAR_WINDOW_MS = 24 * 3_600_000;

export interface ClearedEntry {
  at: number; // 끝 규칙이 처음 뺀 시각(ms)
  rule: EndRule;
}
export interface EndsState {
  firstSeen: Record<string, number>; // 주인 없는 조건 key → 처음 본 시각(ms). 지금 있는 것만 남는다
  cleared: Record<string, ClearedEntry>; // 끝 규칙이 뺀 알림 key → 언제·어느 규칙이. 24시간 뒤 지운다
}
export interface Reappeared {
  t: string;
  key: string;
  rule: EndRule;
  clearedAt: string;
}
export const emptyEnds = (): EndsState => ({ firstSeen: {}, cleared: {} });

// 지금 있는 주인 없는 조건 key들의 처음 본 시각. 사라진 key는 잊고(다시 생기면 새로 센다), 새 key는 지금부터
export function firstSeenOf(prev: Readonly<Record<string, number>>, currentKeys: readonly string[], now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of currentKeys) out[k] = prev[k] ?? now;
  return out;
}

// 한 주기: 끝 규칙이 뺀 key(ended)를 기록하고, 이미 기록돼 있던 key가 지금 알림(currentKeys)에 다시 있으면 돌아온 것으로 센다.
// 돌아온 key는 기록에서 지운다(한 번만 센다). 24시간 지난 기록은 버린다. 입력 state는 바꾸지 않는다
export function trackEnds(state: EndsState, ended: readonly EndedKey[], currentKeys: ReadonlySet<string>, now: number): { state: EndsState; reappeared: Reappeared[] } {
  const cleared: Record<string, ClearedEntry> = {};
  const reappeared: Reappeared[] = [];
  for (const [k, e] of Object.entries(state.cleared)) {
    if (now - e.at >= REAPPEAR_WINDOW_MS) continue;
    if (currentKeys.has(k)) reappeared.push({ t: new Date(now).toISOString(), key: k, rule: e.rule, clearedAt: new Date(e.at).toISOString() });
    else cleared[k] = e;
  }
  for (const e of ended) if (!currentKeys.has(e.key)) cleared[e.key] ??= { at: now, rule: e.rule };
  return { state: { firstSeen: state.firstSeen, cleared }, reappeared };
}

export interface EndsView {
  v: 1;
  at: string;
  windowHours: number;
  rules: { rule: EndRule; ended: number; reappeared: number }[]; // 24시간 안에 끝 규칙이 뺀 알림 수와 그중 돌아온 수
  caution?: { before: number; after: number }; // 같은 상태에서 끝 규칙 없이/있이 센 CAUTION 수(요청할 때 센다)
}

export function endsView(state: EndsState, reappeared: readonly Reappeared[], now: number): EndsView {
  const by = new Map<EndRule, { ended: number; reappeared: number }>();
  const row = (r: EndRule) => by.get(r) ?? by.set(r, { ended: 0, reappeared: 0 }).get(r)!;
  for (const e of Object.values(state.cleared)) if (now - e.at < REAPPEAR_WINDOW_MS) row(e.rule).ended++;
  for (const r of reappeared) if (now - Date.parse(r.t) < REAPPEAR_WINDOW_MS) {
    row(r.rule).reappeared++;
    row(r.rule).ended++; // 돌아온 key는 기록에서 지웠으니, 뺀 적이 있다는 사실을 여기서 더한다
  }
  return { v: 1, at: new Date(now).toISOString(), windowHours: REAPPEAR_WINDOW_MS / 3_600_000, rules: [...by].map(([rule, v]) => ({ rule, ...v })).sort((a, b) => a.rule.localeCompare(b.rule)) };
}
