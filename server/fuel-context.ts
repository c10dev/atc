import { type PriceTable, rateOf } from "./fuel-cost.ts";
import { TTL_1H_MS, ttlAfter } from "./fuel-leaks.ts";
import type { Compaction, FuelRecord } from "./fuel.ts";

// CONTEXT SIZE(ATC-69, docs/fuel.md 5·fleet.md 8.6): 세션마다 지금 대화가 얼마나 큰가. FUEL F1이 이미 읽은 기록(fuel.ts)으로만 센다.
// 마지막 CAPTAIN(non-sidechain) 요청의 input + cacheRead + cacheWrite가 그 크기다. 그 뒤에 compaction이 있으면 postTokens로 줄인다.
// 순수 함수만. 읽기는 fuel-run.ts(contextSizes)

export const WINDOW_200K = 200_000;
export const WINDOW_1M = 1_000_000;

export type WindowSource = "config" | "model" | "observed" | "default";

export interface SessionContext {
  session: string;
  contextTokens: number | null; // compaction 뒤 postTokens를 모르면 null
  at: string; // 그 크기를 본 시각(마지막 요청이나 compaction)
  model: string;
  compacted: boolean; // 마지막 요청 뒤에 compaction이 있었다
  base: number; // 이 세션 첫 CAPTAIN 요청의 크기(새로 시작하면 다시 쓰는 몫: 시스템 프롬프트·규칙·CREW BRIEFING)
  maxSeen: number; // 이 세션에서 본 가장 큰 요청(창을 짐작할 때)
  tier: "5m" | "1h"; // 마지막 요청 뒤 캐시 층(F3의 TTL 규칙)
  speed: string | null;
  geo: string | null;
}

export interface ContextSize extends SessionContext {
  window: number;
  windowSource: WindowSource;
  pct: number | null; // contextTokens / window, 0–1
}

const promptOf = (r: FuelRecord) => r.input + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead;

// 세션마다 마지막 CAPTAIN 요청의 크기. CREW(sidechain) 요청은 보지 않는다
export function sessionContexts(records: Iterable<FuelRecord>, compactions: readonly Compaction[] = []): Map<string, SessionContext> {
  const bySession = new Map<string, FuelRecord[]>();
  for (const r of records) {
    if (r.sidechain) continue;
    let list = bySession.get(r.session);
    if (!list) bySession.set(r.session, (list = []));
    list.push(r);
  }
  const cutsOf = new Map<string, Compaction[]>();
  for (const c of compactions) cutsOf.set(c.session, [...(cutsOf.get(c.session) ?? []), c]);
  const out = new Map<string, SessionContext>();
  for (const [session, list] of bySession) {
    list.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    let ttl: number | null = null;
    for (const r of list) ttl = ttlAfter(r, ttl);
    const last = list.at(-1)!;
    const lastCut = (cutsOf.get(session) ?? []).filter((c) => Date.parse(c.t) > Date.parse(last.t)).sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).at(-1);
    out.set(session, {
      session,
      contextTokens: lastCut ? lastCut.postTokens : promptOf(last),
      at: lastCut ? lastCut.t : last.t,
      model: last.model,
      compacted: Boolean(lastCut),
      base: promptOf(list[0]),
      maxSeen: Math.max(...list.filter((r) => r.model === last.model).map(promptOf)),
      tier: ttl === TTL_1H_MS ? "1h" : "5m",
      speed: last.speed,
      geo: last.geo,
    });
  }
  return out;
}

// 창 크기: 설정(모델 이름, 날짜 접미어 뗀 이름도) → 이름의 [1m] → 200k를 넘은 요청을 봤으면 1M → 200k.
// 대화 기록의 model에는 [1m]이 적히지 않는다(claude-opus-5-5) — 그래서 본 크기로도 짐작한다
export function windowOf(model: string, maxSeen: number, windows: Record<string, number> = {}): { window: number; source: WindowSource } {
  const dated = /^(.*)-\d{8}$/.exec(model)?.[1];
  const set = windows[model] ?? (dated ? windows[dated] : undefined);
  if (typeof set === "number" && Number.isFinite(set) && set > 0) return { window: set, source: "config" };
  if (/\[1m\]/i.test(model)) return { window: WINDOW_1M, source: "model" };
  if (maxSeen > WINDOW_200K) return { window: WINDOW_1M, source: "observed" };
  return { window: WINDOW_200K, source: "default" };
}

export function contextSizeOf(c: SessionContext, windows: Record<string, number> = {}): ContextSize {
  const w = windowOf(c.model, c.maxSeen, windows);
  return { ...c, window: w.window, windowSource: w.source, pct: c.contextTokens === null ? null : Math.round((c.contextTokens / w.window) * 1000) / 1000 };
}

// API에 싣는 모양(/api/fuel·/api/fleet): {contextTokens, window, at}과 짐작의 근거
export interface ContextView {
  contextTokens: number | null;
  window: number;
  at: string;
  pct: number | null;
  model: string;
  windowSource: WindowSource;
  compacted: boolean;
}
export const contextView = (c: ContextSize | null): ContextView | null =>
  c && { contextTokens: c.contextTokens, window: c.window, at: c.at, pct: c.pct, model: c.model, windowSource: c.windowSource, compacted: c.compacted };

// FLEET 목록·카드의 표시(ATC-69). 40 %부터 info, 70 %부터 alert(창을 짐작만 했으면 토큰 300k·500k로)
export interface ContextBadge {
  short: string; // 502k / 1M
  label: string; // context 502k / 1M (50%)
  level: "ok" | "info" | "alert";
  title: string;
}
const WINDOW_WHY: Record<WindowSource, string> = {
  config: "fleet-plan.json contextWindows",
  model: "모델 이름의 [1m]",
  observed: "200k를 넘는 요청을 봄 — 1M으로 짐작",
  default: "기본 200k(짐작)",
};
export function contextBadgeOf(c: ContextView | null | undefined): ContextBadge | null {
  if (!c) return null;
  const n = c.contextTokens;
  const known = c.windowSource !== "default";
  const level = n === null ? "ok" : known ? ((c.pct ?? 0) >= 0.7 ? "alert" : (c.pct ?? 0) >= 0.4 ? "info" : "ok") : n >= 500_000 ? "alert" : n >= 300_000 ? "info" : "ok";
  return {
    short: `${n === null ? "—" : tokensShort(n)} / ${tokensShort(c.window)}`,
    label: contextLabel(c),
    level,
    title: `${contextLabel(c)} · ${c.model} · ${c.at.slice(0, 16).replace("T", " ")}Z${c.compacted ? " · compaction 뒤" : ""} · 창: ${WINDOW_WHY[c.windowSource]}. 마지막 CAPTAIN 요청의 input + cache read + cache write`,
  };
}

// 502k, 1M, 18k
export function tokensShort(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`.replace(".0M", "M");
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// context 502k / 1M (50%)
export function contextLabel(c: Pick<ContextSize, "contextTokens" | "window" | "pct">): string {
  if (c.contextTokens === null) return `context — / ${tokensShort(c.window)} (compacted)`;
  return `context ${tokensShort(c.contextTokens)} / ${tokensShort(c.window)} (${Math.round((c.pct ?? 0) * 100)}%)`;
}

// 새로 시작하면 아끼는 것(F5 가격표). 식은 캐시로 다음에 깨어날 때 다시 쓸 접두부 중 새 세션이 쓰지 않는 몫(context − base)의
// 쓰기 값, 그리고 한 턴마다 캐시에서 다시 읽는 그 몫의 값. 모델·배수가 표에 없으면 USD는 null(토큰은 있다)
export interface RefreshSaving {
  tokens: number; // context − base
  coldWake: number | null; // USD: 다음 cold wake에 쓰지 않아도 되는 캐시 쓰기
  perTurn: number | null; // USD: 한 턴마다 읽지 않아도 되는 캐시 읽기
}
export function refreshSavingOf(c: Pick<SessionContext, "contextTokens" | "base" | "model" | "tier" | "speed" | "geo">, prices: PriceTable | null): RefreshSaving | null {
  if (c.contextTokens === null) return null;
  const tokens = Math.max(0, c.contextTokens - c.base);
  const got = prices ? rateOf(prices, c) : null;
  if (!got || !("rate" in got)) return { tokens, coldWake: null, perTurn: null };
  const r = got.rate;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { tokens, coldWake: round(tokens * (c.tier === "1h" ? r.write1h : r.write5m) * r.pIn), perTurn: round(tokens * r.readMult * r.pIn) };
}
