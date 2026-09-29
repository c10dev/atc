import { type PriceTable, rateOf } from "./fuel-cost.ts";
import { TTL_1H_MS, ttlAfter } from "./fuel-leaks.ts";
import type { Compaction, FuelRecord, ModelCommand } from "./fuel.ts";

// CONTEXT SIZE(ATC-69, docs/fuel.md 5·fleet.md 8.6): 세션마다 지금 대화가 얼마나 큰가. FUEL F1이 이미 읽은 기록(fuel.ts)으로만 센다.
// 마지막 CAPTAIN(non-sidechain) 요청의 input + cacheRead + cacheWrite가 그 크기다. 그 뒤에 compaction이 있으면 postTokens로 줄인다.
// 창 크기는 세션이 스스로 말하면 그것(ATC-85): statusline의 context_window_size(CLI) → 대화 기록의 `/model` 출력(데스크톱) → 아래 windowOf의 짐작.
// 순수 함수만. 읽기는 fuel-run.ts(contextSizes)

export const WINDOW_200K = 200_000;
export const WINDOW_1M = 1_000_000;

// statusline·model-command는 세션이 말한 것, model·observed·default는 짐작, config는 SUPERVISOR가 덮어쓴 것
export type WindowSource = "statusline" | "model-command" | "config" | "model" | "observed" | "default";

// statusline hook이 fuel/<sessionId>.jsonl에 남긴 창 크기와 그 모델 id(있으면), 그 기록의 시각
export interface StatusWindow {
  t: string;
  window: number;
  model: string | null;
}

export interface DeclaredWindow {
  window: number;
  source: "statusline" | "model-command";
}

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
  declared?: DeclaredWindow | null; // 세션이 스스로 말한 창(ATC-85). 없으면 windowOf가 짐작한다
}

export interface ContextSize extends SessionContext {
  window: number;
  windowSource: WindowSource;
  pct: number | null; // contextTokens / window, 0–1
}

const promptOf = (r: FuelRecord) => r.input + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead;

// `/model`이 말하는 창: [1m]이면 1M, claude-* id인데 [1m]이 없으면 200k. 다른 공급자 id(프록시로 도는 DeepSeek·Muse)나 표시 이름은 모른다(null)
export function commandWindowOf(model: string | null): number | null {
  if (!model) return null;
  if (/\[1m\]$/i.test(model)) return WINDOW_1M;
  return /^claude-/i.test(model) ? WINDOW_200K : null;
}

// 모델 id 비교용: [1m]과 날짜 접미어를 뗀 소문자
const baseModel = (m: string) => m.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "").toLowerCase();

export interface WindowSignals {
  commands?: readonly ModelCommand[];
  statusline?: ReadonlyMap<string, StatusWindow>;
}

// 세션이 스스로 말한 창. statusline 기록은 뒤의 `/model`이나 다른 모델의 요청이 있으면 낡은 것으로 보고, `/model`이 말하는 창은 그 뒤 요청이 넘으면 틀린 것으로 본다
function declaredWindowOf(last: FuelRecord, lastCmd: ModelCommand | undefined, sl: StatusWindow | undefined, maxSeenAfter: number): DeclaredWindow | null {
  const cmdMs = lastCmd ? Date.parse(lastCmd.t) : -Infinity;
  if (sl && Date.parse(sl.t) >= cmdMs) {
    const otherModel = sl.model && Date.parse(last.t) > Date.parse(sl.t) && baseModel(last.model) !== baseModel(sl.model);
    if (!otherModel) return { window: sl.window, source: "statusline" };
  }
  const w = lastCmd ? commandWindowOf(lastCmd.model) : null;
  return w !== null && maxSeenAfter <= w ? { window: w, source: "model-command" } : null;
}

// 세션마다 마지막 CAPTAIN 요청의 크기. CREW(sidechain) 요청은 보지 않는다
export function sessionContexts(records: Iterable<FuelRecord>, compactions: readonly Compaction[] = [], signals: WindowSignals = {}): Map<string, SessionContext> {
  const bySession = new Map<string, FuelRecord[]>();
  for (const r of records) {
    if (r.sidechain) continue;
    let list = bySession.get(r.session);
    if (!list) bySession.set(r.session, (list = []));
    list.push(r);
  }
  const cutsOf = new Map<string, Compaction[]>();
  for (const c of compactions) cutsOf.set(c.session, [...(cutsOf.get(c.session) ?? []), c]);
  const cmdsOf = new Map<string, ModelCommand[]>();
  for (const c of signals.commands ?? []) cmdsOf.set(c.session, [...(cmdsOf.get(c.session) ?? []), c]);
  const out = new Map<string, SessionContext>();
  for (const [session, list] of bySession) {
    list.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    let ttl: number | null = null;
    for (const r of list) ttl = ttlAfter(r, ttl);
    const last = list.at(-1)!;
    const lastCut = (cutsOf.get(session) ?? []).filter((c) => Date.parse(c.t) > Date.parse(last.t)).sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).at(-1);
    // 마지막 `/model` 뒤에 본 요청만 창을 짐작하는 데 쓴다(다른 모델로 바꿨으면 앞 크기는 그 모델의 것)
    const lastCmd = (cmdsOf.get(session) ?? []).sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).at(-1);
    const seen = list.filter((r) => r.model === last.model && (!lastCmd || Date.parse(r.t) > Date.parse(lastCmd.t)));
    const maxSeen = Math.max(0, ...seen.map(promptOf));
    out.set(session, {
      session,
      contextTokens: lastCut ? lastCut.postTokens : promptOf(last),
      at: lastCut ? lastCut.t : last.t,
      model: last.model,
      compacted: Boolean(lastCut),
      base: promptOf(list[0]),
      maxSeen,
      tier: ttl === TTL_1H_MS ? "1h" : "5m",
      speed: last.speed,
      geo: last.geo,
      declared: declaredWindowOf(last, lastCmd, signals.statusline?.get(session), maxSeen),
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
  const w = c.declared ? { window: c.declared.window, source: c.declared.source } : windowOf(c.model, c.maxSeen, windows);
  return { ...c, window: w.window, windowSource: w.source, pct: c.contextTokens === null ? null : Math.round((c.contextTokens / w.window) * 1000) / 1000 };
}

// API에 싣는 모양(/api/fuel·/api/fleet): {contextTokens, window, at}과 짐작의 근거
export interface ContextView {
  contextTokens: number | null;
  window: number;
  at: string;
  pct: number | null;
  fobPct: number | null; // FOB(ATC-81): 창에 남은 몫 0–100 정수. 크기를 모르면 null
  model: string;
  windowSource: WindowSource;
  compacted: boolean;
}
export const fobPctOf = (pct: number | null): number | null => (pct === null ? null : Math.max(0, Math.min(100, Math.round((1 - pct) * 100))));
export const contextView = (c: ContextSize | null): ContextView | null =>
  c && { contextTokens: c.contextTokens, window: c.window, at: c.at, pct: c.pct, fobPct: fobPctOf(c.pct), model: c.model, windowSource: c.windowSource, compacted: c.compacted };

// FLEET 목록·카드의 FOB(FUEL ON BOARD, ATC-81): AIRCRAFT 자기 연료 = 창에 남은 몫. ATC-69의 쓴 몫 40 %/70 %가
// 남은 몫 60 %/30 %다. 색은 화면에 적힌 정수 %로 가른다(글자와 색이 어긋나지 않게). 창을 짐작만 했으면 토큰 300k·500k로
export const FOB_INFO_LEFT = 60; // 이하면 info(amber)
export const FOB_ALERT_LEFT = 30; // 이하면 alert
export interface ContextBadge {
  short: string; // FOB 50% · 504k/1M (FLEET 목록 칸)
  label: string; // FOB 50% · 504k / 1M (카드 줄)
  fobPct: number | null;
  level: "ok" | "info" | "alert";
  title: string;
}
const WINDOW_WHY: Record<WindowSource, string> = {
  statusline: "세션이 알림(statusline context_window_size)",
  "model-command": "세션의 마지막 /model 출력",
  config: "fleet-plan.json contextWindows",
  model: "모델 이름의 [1m]",
  observed: "200k를 넘는 요청을 봄 — 1M으로 짐작",
  default: "기본 200k(짐작)",
};
export function fobLevelOf(c: Pick<ContextView, "contextTokens" | "fobPct" | "windowSource">): ContextBadge["level"] {
  const n = c.contextTokens;
  if (n === null) return "ok";
  if (c.windowSource === "default") return n >= 500_000 ? "alert" : n >= 300_000 ? "info" : "ok";
  const left = c.fobPct ?? 100;
  return left <= FOB_ALERT_LEFT ? "alert" : left <= FOB_INFO_LEFT ? "info" : "ok";
}
export function contextBadgeOf(c: ContextView | null | undefined): ContextBadge | null {
  if (!c) return null;
  const fobPct = c.fobPct ?? fobPctOf(c.pct);
  const view = { ...c, fobPct };
  return {
    short: fobText(view, false),
    label: fobText(view, true),
    fobPct,
    level: fobLevelOf(view),
    title: `FOB(FUEL ON BOARD) ${fobPct === null ? "—" : `${fobPct}%`} = 창 ${tokensShort(c.window)}에 남은 몫. ${contextLabel(c)} · ${c.model} · ${c.at.slice(0, 16).replace("T", " ")}Z${c.compacted ? " · compaction 뒤" : ""} · 창: ${WINDOW_WHY[c.windowSource]}. 마지막 CAPTAIN 요청의 input + cache read + cache write`,
  };
}

// FOB 50% · 504k/1M. spaced면 카드 줄: FOB 50% · 504k / 1M
export function fobText(c: Pick<ContextView, "contextTokens" | "window" | "fobPct">, spaced: boolean): string {
  const size = `${c.contextTokens === null ? "—" : tokensShort(c.contextTokens)}${spaced ? " / " : "/"}${tokensShort(c.window)}`;
  return `FOB ${c.fobPct === null ? "—" : `${c.fobPct}%`} · ${size}${c.contextTokens === null ? " (compacted)" : ""}`;
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
