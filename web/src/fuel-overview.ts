import { CONTROL_NAMES } from "../../server/crew.ts";
import { CREW_WARNING_KINDS, type CrewWarningCounts } from "../../server/fuel-crew.ts";
import type { LeakTotals } from "../../server/fuel-leaks.ts";
import type { AircraftFuel, Burn, DayFuel, ModelFuel, SessionFuel } from "../../server/fuel.ts";
import type { TripVerdict } from "../../server/fuel-view.ts";

// FUEL 개요(ATC-137): METRICS 탭 안 #metrics/fuel. GET /api/fuel과 /api/logbook 값을 화면이 읽는 모양으로 바꾸는 순수 함수만 둔다.
// 측정·귀속·가격은 건드리지 않는다.

export const FUEL_WINDOWS = [1, 7, 14, 30] as const;
export const FUEL_DEFAULT_WINDOW = 7;
// 서버의 FUEL_MAX_DAYS와 같다(server/fuel-run.ts). 서버가 다시 한 번 자른다
export const FUEL_WINDOW_MAX = 30;
export const clampWindow = (n: unknown): number => (typeof n === "number" && FUEL_WINDOWS.includes(n as never) ? Math.min(n, FUEL_WINDOW_MAX) : FUEL_DEFAULT_WINDOW);

// ── 글 ──
const thousands = (n: number) => Math.round(n).toLocaleString("en-US");
// 토큰: B는 소수 둘(1.04B), M·K는 하나·없음
export function tokensLong(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
// 가격 없는 모델 몫(늘 요약 줄 옆에 둔다): `가격 없는 모델 4,710건 · 1.04B tokens 제외`. 없으면 0건이라고 적는다
export function unpricedText(u: { requests: number; tokens: number }): string {
  return u.requests ? `가격 없는 모델 ${thousands(u.requests)}건 · ${tokensLong(u.tokens)} tokens 제외` : "가격 없는 모델 0건";
}
export const PRICE_NOTE = "금액은 API 정가(list price)로 매긴 값이지 청구액이 아니다";

// ── 요약 ──
export interface SummaryView {
  total: number;
  captain: number;
  crew: number;
  crewShare: number | null; // CREW 비용 ÷ 전체
  cacheHit: number | null;
  requests: number;
  unpriced: string;
}
export function summaryOf(t: { captain: Burn; crew: Burn; total: Burn }, requests: number): SummaryView {
  const total = t.total.cost.total;
  return {
    total,
    captain: t.captain.cost.total,
    crew: t.crew.cost.total,
    crewShare: total > 0 ? t.crew.cost.total / total : null,
    cacheHit: t.total.cacheHit,
    requests,
    unpriced: unpricedText(t.total.unpriced),
  };
}

// ── AIRCRAFT·세션 표 ──
export type RowGroup = "team" | "control" | "other";
export interface FuelRow {
  key: string;
  label: string;
  group: RowGroup;
  fleet: boolean; // FLEET 카드가 있을 수 있는 행(team). 링크는 #fleet
  cost: number;
  requests: number;
  cacheHit: number | null;
  crewShare: number | null;
  leakCost: number;
  net: number;
  topModel: string | null;
}
export const SORT_KEYS = ["label", "cost", "requests", "cacheHit", "crewShare", "leakCost", "net", "topModel"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

// TOWER·OCC·MCC·CROSSCHECK·ENGINEERING(crew.ts CONTROL_NAMES)에 REVIEW를 더한 관제 세션 이름
export const CONTROL_GROUP: readonly string[] = [...CONTROL_NAMES, "REVIEW"];

export function topModelOf(models: Record<string, number>): string | null {
  return Object.entries(models).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export function groupOf(name: string, teamPattern: string): RowGroup {
  if (CONTROL_GROUP.includes(name.toUpperCase())) return "control";
  try {
    return new RegExp(teamPattern, "i").test(name) ? "team" : "other";
  } catch {
    return "other"; // 깨진 패턴이면 나누지 않는다
  }
}

const crewShareOf = (x: { total: Burn; crew: Burn }) => (x.total.cost.total > 0 ? x.crew.cost.total / x.total.cost.total : null);
// AIRCRAFT(같은 이름의 세션을 합친 것)마다 한 줄. 이름 없는 세션은 "other"에 세션 하나씩
export function rowsOf(aircraft: readonly AircraftFuel[], sessions: readonly SessionFuel[], teamPattern: string): FuelRow[] {
  const named: FuelRow[] = aircraft.map((a) => {
    const group = groupOf(a.aircraft, teamPattern);
    return {
      key: a.aircraft,
      label: a.aircraft,
      group,
      fleet: group === "team",
      cost: a.total.cost.total,
      requests: a.total.requests,
      cacheHit: a.total.cacheHit,
      crewShare: crewShareOf(a),
      leakCost: a.leak.total.cost,
      net: a.netCost,
      topModel: topModelOf(a.models),
    };
  });
  const unnamed: FuelRow[] = sessions
    .filter((s) => !s.name)
    .map((s) => ({
      key: `session:${s.session}`,
      label: `session ${s.session.slice(0, 8)}`,
      group: "other" as const,
      fleet: false,
      cost: s.total.cost.total,
      requests: s.total.requests,
      cacheHit: s.total.cacheHit,
      crewShare: crewShareOf(s),
      leakCost: s.leak.total.cost,
      net: s.netCost,
      topModel: topModelOf(s.models),
    }));
  return [...named, ...unnamed];
}

// 정렬(순수). null은 늘 뒤. 같으면 이름순
export function sortRows(rows: readonly FuelRow[], key: SortKey, dir: "asc" | "desc"): FuelRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null && y === null) return a.label.localeCompare(b.label);
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * sign || a.label.localeCompare(b.label);
  });
}

// 팀 AIRCRAFT가 먼저, 관제 세션, 기타. 각 묶음 안은 정렬 기준대로
export const GROUPS: { id: RowGroup; label: string }[] = [
  { id: "team", label: "AIRCRAFT" },
  { id: "control", label: "control sessions" },
  { id: "other", label: "other" },
];
export function groupedRows(rows: readonly FuelRow[], key: SortKey, dir: "asc" | "desc") {
  return GROUPS.map((g) => ({ ...g, rows: sortRows(rows.filter((r) => r.group === g.id), key, dir) })).filter((g) => g.rows.length > 0);
}

// ── 모델 ──
export interface ModelRows {
  priced: ModelFuel[];
  unpriced: ModelFuel[]; // 값이 매겨진 요청이 하나도 없는 모델: 토큰과 "no price"
}
export function modelRowsOf(byModel: readonly ModelFuel[]): ModelRows {
  const none = (m: ModelFuel) => m.unpricedRequests === m.requests;
  return { priced: byModel.filter((m) => !none(m)), unpriced: byModel.filter(none) };
}

// ── LEAK ──
// docs/fuel.md 5: 규칙과 뜻
export const LEAK_ROWS: { key: keyof LeakTotals; label: string; meaning: string }[] = [
  { key: "coldCache", label: "COLD CACHE", meaning: "HOLD 중 캐시가 식은 뒤 다시 지은 것(TTL 5분·1시간을 넘긴 틈)" },
  { key: "controlWake", label: "CONTROL WAKE", meaning: "atc가 보낸 메시지가 식은 캐시를 깨운 것" },
  { key: "modelSwitch", label: "MODEL SWITCH", meaning: "요청 사이에 모델이 바뀌어 캐시를 못 읽은 것" },
  { key: "compaction", label: "COMPACTION", meaning: "compaction 뒤 다시 짓기 중 캐시가 식어 있던 것" },
  { key: "sessionChange", label: "SESSION CHANGE", meaning: "같은 FLIGHT의 새 세션 첫 요청이 AIRPORT 기준선을 넘은 몫" },
  { key: "upgrade", label: "UPGRADE", meaning: "version·effort가 바뀐 바로 뒤의 miss" },
  { key: "unexplained", label: "UNEXPLAINED", meaning: "위 어느 규칙에도 안 맞는 miss" },
];
export const LEAK_OUTSIDE_ROWS: { key: keyof LeakTotals; label: string; meaning: string }[] = [
  { key: "proxied", label: "PROXIED", meaning: "requestId 없는 프록시 경로(DeepSeek·Muse 등)의 miss. 캐시가 다르고 LEAK에 넣지 않는다" },
  { key: "expectedRebuild", label: "EXPECTED REBUILD", meaning: "캐시가 따뜻할 때 compaction 뒤 다시 짓기. LEAK에 넣지 않는다" },
];
export const CREW_WARNING_MEANING: Record<keyof CrewWarningCounts, string> = {
  heavyPrefix: "첫 CREW 요청이 30K 넘게 캐시에 씀",
  trivialDelegation: "프롬프트가 입력 대부분이고 3턴 이하인 서브에이전트",
  highCrewShare: "FLIGHT 토큰의 절반 넘게가 CREW",
  deepNesting: "서브에이전트가 두 단계 넘게 중첩",
  expensiveReadOnly: "Explore·Plan을 Opus로 돌림",
  coldCrew: "한 서브에이전트의 요청 사이가 5분을 넘음",
  complementDrift: "COMPLEMENT가 선언한 모델과 다른 모델이 답함",
};
export interface LeakView {
  key: string;
  label: string;
  meaning: string;
  count: number;
  tokens: number;
  cost: number;
  unpricedTokens: number;
  outside: boolean;
}
export function leakViewsOf(leak: LeakTotals): LeakView[] {
  const one = (r: { key: keyof LeakTotals; label: string; meaning: string }, outside: boolean): LeakView => ({ ...r, ...pick(leak[r.key]), outside });
  return [...LEAK_ROWS.map((r) => one(r, false)), ...LEAK_OUTSIDE_ROWS.map((r) => one(r, true))];
}
const pick = (b: LeakTotals["total"]) => ({ count: b.count, tokens: b.tokens, cost: b.cost, unpricedTokens: b.unpricedTokens });
export const crewWarningRowsOf = (w: CrewWarningCounts) => CREW_WARNING_KINDS.map((kind) => ({ kind, count: w[kind], meaning: CREW_WARNING_MEANING[kind] }));

// ── 날짜별 ──
export interface DayBar extends DayFuel {
  total: number;
}
// 기간의 UTC 날짜를 빠짐없이(기록 없는 날은 0). since: 기간 시작 ISO, now: 지금(ms)
export function dayBarsOf(byDay: readonly DayFuel[], since: string, now: number): { bars: DayBar[]; max: number } {
  const known = new Map(byDay.map((d) => [d.day, d]));
  const bars: DayBar[] = [];
  const end = Date.parse(new Date(now).toISOString().slice(0, 10));
  for (let t = Date.parse(since.slice(0, 10)); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const d = known.get(day) ?? { day, captain: 0, crew: 0, requests: 0, unpricedTokens: 0 };
    bars.push({ ...d, total: d.captain + d.crew });
  }
  return { bars, max: Math.max(0, ...bars.map((b) => b.total)) };
}

// ── 비싼 FLIGHT ──
export interface LogbookFuelEntry {
  key: string;
  flight: string | null;
  aircraft: string | null;
  arrivedAt: string;
  trip?: { net: number | null; verdict: TripVerdict | null };
}
export interface TopFlight {
  flight: string;
  aircraft: string | null;
  net: number;
  verdict: TripVerdict | null;
  arrivedAt: string;
}
export const TOP_FLIGHTS = 10;
// 기간 안 ARRIVED FLIGHT 중 NET이 큰 순서(값이 없는 FLIGHT는 뺀다). 같은 FLIGHT의 여러 줄은 NET이 큰 것 하나만
export function topFlightsOf(entries: readonly LogbookFuelEntry[], since: string, n = TOP_FLIGHTS): TopFlight[] {
  const best = new Map<string, TopFlight>();
  for (const e of entries) {
    if (!e.flight || e.arrivedAt < since || typeof e.trip?.net !== "number") continue;
    const cur = best.get(e.flight);
    if (!cur || e.trip.net > cur.net) best.set(e.flight, { flight: e.flight, aircraft: e.aircraft, net: e.trip.net, verdict: e.trip.verdict, arrivedAt: e.arrivedAt });
  }
  return [...best.values()].sort((a, b) => b.net - a.net || a.flight.localeCompare(b.flight)).slice(0, n);
}
