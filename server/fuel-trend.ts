import { costOf, type PriceTable, rateOf } from "./fuel-cost.ts";
import type { FuelRecord } from "./fuel.ts";
import { registrationOf } from "./registration.ts";

// USAGE TREND(ATC-389, docs/fuel.md "USAGE TREND as built"): 에이전트를 얼마나 쓰는지 지난 기간·최근 주와 견준다. 순수 함수.
// 기간은 FUEL처럼 지금에서 거꾸로 잰다: 이번 = [now − days, now), 지난 = 그 앞 같은 길이, 주 = 7일씩 TREND_WEEKS개.
// 비용은 FUEL byDay와 같은 가격표·같은 규칙(rateOf·costOf)이고, 값이 없는 모델의 요청은 비용에서 빠져 unpriced로 센다.

export const TREND_WEEKS = 8;
export const WORK_SLOT_MIN = 5; // 가동 시간: 요청이 하나라도 있던 5분 칸 = 5분
const DAY_MS = 86_400_000;
const SLOT_MS = WORK_SLOT_MIN * 60_000;

export interface UsagePeriod {
  from: string; // ISO, 포함
  to: string; // ISO, 제외
  coverage: number; // 0–1. 기간 중 기록이 있는 때(가장 이른 기록 뒤)의 몫. 1이 아니면 견주지 않는다
  cost: number; // USD(정가)
  captainCost: number;
  crewCost: number;
  requests: number;
  unpricedRequests: number; // 가격표에 없어 비용에 넣지 않은 요청
  captainHours: number; // 가동 시간(CAPTAIN): 세션마다 요청이 있던 5분 칸
  crewHours: number; // 가동 시간(CREW): 서브에이전트마다 따로
  aircraft: number; // 요청이 있던 팀 AIRCRAFT(REGISTRATION) 수. 관제 세션·기타는 넣지 않는다
  flights: number; // LOGBOOK ARRIVED 줄
  prs: number; // 그중 PR로 ARRIVED한 줄
  costPerFlight: number | null; // cost / flights. FLIGHT가 없으면 null
}

export interface UsageTrend {
  days: number;
  historyStart: string | null; // 가장 이른 대화 기록. 없으면 null
  current: UsagePeriod;
  previous: UsagePeriod;
  weeks: UsagePeriod[]; // 오래된 주 먼저, 마지막이 이번 주
  change: Record<TrendMetric, number | null>; // 지난 기간 대비 비율(changeOf). 견줄 수 없으면 null
}

// 화면이 견주는 값. 계산은 여기서만 한다(화면은 보이기만)
export const TREND_METRICS = ["cost", "requests", "hours", "aircraft", "flights", "prs", "costPerFlight"] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];
export const metricOf = (p: UsagePeriod, m: TrendMetric): number | null => (m === "hours" ? round2(p.captainHours + p.crewHours) : p[m]);

export interface ArrivalLike {
  arrivedAt: string;
  pr?: unknown;
}

export interface TrendInput {
  records: Iterable<FuelRecord>; // 중복을 없앤 기록
  names: Map<string, string>; // session → 세션 이름
  teamPattern: string;
  prices: PriceTable | null;
  arrivals: readonly ArrivalLike[];
  now: number;
  days: number;
  weeks?: number;
}

// 이 기간들을 다 덮으려면 대화 기록을 며칠 읽어야 하나
export const trendScanDays = (days: number, weeks = TREND_WEEKS) => Math.max(2 * days, 7 * weeks);

interface Acc {
  from: number;
  to: number;
  cost: number;
  captainCost: number;
  crewCost: number;
  requests: number;
  unpricedRequests: number;
  captainSlots: Set<string>;
  crewSlots: Set<string>;
  aircraft: Set<string>;
  flights: number;
  prs: number;
}
const accOf = (from: number, to: number): Acc => ({
  from, to, cost: 0, captainCost: 0, crewCost: 0, requests: 0, unpricedRequests: 0,
  captainSlots: new Set(), crewSlots: new Set(), aircraft: new Set(), flights: 0, prs: 0,
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function coverageOf(from: number, to: number, historyStart: number | null): number {
  if (historyStart === null || historyStart >= to) return 0;
  if (historyStart <= from) return 1;
  return round4((to - historyStart) / (to - from));
}

function periodOf(a: Acc, historyStart: number | null): UsagePeriod {
  const hours = (n: number) => round2((n * WORK_SLOT_MIN) / 60);
  return {
    from: new Date(a.from).toISOString(),
    to: new Date(a.to).toISOString(),
    coverage: coverageOf(a.from, a.to, historyStart),
    cost: round4(a.cost),
    captainCost: round4(a.captainCost),
    crewCost: round4(a.crewCost),
    requests: a.requests,
    unpricedRequests: a.unpricedRequests,
    captainHours: hours(a.captainSlots.size),
    crewHours: hours(a.crewSlots.size),
    aircraft: a.aircraft.size,
    flights: a.flights,
    prs: a.prs,
    costPerFlight: a.flights ? round4(a.cost / a.flights) : null,
  };
}

export function usageTrend(input: TrendInput): UsageTrend {
  const { now, days } = input;
  const nWeeks = input.weeks ?? TREND_WEEKS;
  const current = accOf(now - days * DAY_MS, now);
  const previous = accOf(now - 2 * days * DAY_MS, now - days * DAY_MS);
  const weeks = Array.from({ length: nWeeks }, (_, i) => accOf(now - (nWeeks - i) * 7 * DAY_MS, now - (nWeeks - i - 1) * 7 * DAY_MS));
  const all = [current, previous, ...weeks];
  const into = (t: number) => all.filter((a) => t >= a.from && t < a.to);
  const aircraftOf = new Map<string, string | null>(); // session → REGISTRATION(세션마다 한 번만 맞춘다)

  let first: number | null = null;
  for (const r of input.records) {
    const t = Date.parse(r.t);
    if (!Number.isFinite(t)) continue;
    if (first === null || t < first) first = t;
    const hit = into(t);
    if (!hit.length) continue;
    const rate = input.prices ? rateOf(input.prices, r) : null;
    const cost = rate && "rate" in rate ? costOf(r, rate.rate).total : null;
    if (!aircraftOf.has(r.session)) aircraftOf.set(r.session, registrationOf(input.names.get(r.session), input.teamPattern));
    const reg = aircraftOf.get(r.session) ?? null;
    // CREW는 서브에이전트마다 따로 센다(한 CAPTAIN 아래 둘이 같은 5분에 일하면 10분)
    const slot = `${r.sidechain ? (r.agent ?? r.session) : r.session}\n${Math.floor(t / SLOT_MS)}`;
    for (const a of hit) {
      a.requests++;
      if (cost === null) a.unpricedRequests++;
      else {
        a.cost += cost;
        if (r.sidechain) a.crewCost += cost;
        else a.captainCost += cost;
      }
      (r.sidechain ? a.crewSlots : a.captainSlots).add(slot);
      if (reg) a.aircraft.add(reg);
    }
  }
  for (const e of input.arrivals) {
    const t = Date.parse(e.arrivedAt);
    if (!Number.isFinite(t)) continue;
    for (const a of into(t)) {
      a.flights++;
      if (e.pr) a.prs++;
    }
  }
  const cur = periodOf(current, first);
  const prev = periodOf(previous, first);
  return {
    days,
    historyStart: first === null ? null : new Date(first).toISOString(),
    current: cur,
    previous: prev,
    weeks: weeks.map((w) => periodOf(w, first)),
    change: Object.fromEntries(TREND_METRICS.map((m) => [m, changeOf(metricOf(cur, m), metricOf(prev, m), prev.coverage)])) as Record<TrendMetric, number | null>,
  };
}

// 지난 기간 대비 변화(비율). 지난 기간이 다 덮이지 않았거나 0이면 null(견줄 수 없다)
export function changeOf(cur: number | null, prev: number | null, prevCoverage: number): number | null {
  if (prevCoverage < 1 || cur === null || prev === null || prev === 0) return null;
  return round4((cur - prev) / prev);
}

// 변화 글자: +12% · −8% · 0%. null이면 null(화면이 까닭을 적는다)
export function changeText(r: number | null): string | null {
  if (r === null) return null;
  const pct = Math.round(r * 100);
  return pct === 0 ? "0%" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

// 지난 기간 이름. 일부만 기록이 있으면 그 날 수를 붙인다(그 값은 그 기간 전체의 값이 아니다)
export const recordedDays = (coverage: number, days: number) => Math.round(coverage * days * 10) / 10;
export function previousLabel(prev: Pick<UsagePeriod, "coverage">, days: number): string {
  return prev.coverage > 0 && prev.coverage < 1 ? `지난 ${days}일(기록 ${recordedDays(prev.coverage, days)}일)` : `지난 ${days}일`;
}

// 견줄 수 없는 까닭. 지난 기간 일부만 기록이 있으면 그 날 수
export function noCompareText(prev: Pick<UsagePeriod, "coverage">, days: number): string {
  if (prev.coverage <= 0) return "지난 기간 기록 없음";
  if (prev.coverage < 1) return `지난 기간 기록 ${recordedDays(prev.coverage, days)}/${days}일뿐`;
  return "지난 기간 0";
}
