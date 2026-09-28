import { type FlightCost, leakPriceOf, type PriceTable } from "./fuel-cost.ts";
import type { FuelRecord } from "./fuel.ts";
import type { FlightFuel } from "./fuel-flights.ts";
import { type LeakEvent, type LeakRule, TTL_1H_MS, TTL_5M_MS, ttlAfter } from "./fuel-leaks.ts";
import type { LogEntry } from "./logbook.ts";

// FUEL F8(ATC-56, docs/fuel.md 7): 화면과 브리핑에 보일 FUEL 값. 순수 함수만 두고, 화면(web)도 이 파일을 부른다(서버 입출력 import 없음).
// 보여 주기만 한다: DISPATCH 점수·배정에 쓰지 않고, COLD CACHE 경고는 막지 않는다.
// 없는 값(fuel 없는 옛 줄, 가격표에 없는 모델, F7이 아직 없는 CREW 경고)은 null이다. 0으로 채우지 않는다.

const DAY = 86_400_000;
export const TRIP_FUEL_DAYS = 60; // TRIP FUEL이 배우는 기간
export const TRIP_FUEL_MIN_SAMPLES = 3; // logbook.ts MEDIAN_MIN_SAMPLES와 같다(시험이 확인). 적으면 WAKE, 그다음 AIRPORT로 넓힌다
export const FLEET_FUEL_DAYS = 14; // FLEET 카드·줄(TARGETS 실적과 같은 기간)
export const TOP_LEAKS = 3;
export const LARGE_LEAK_USD = 10; // 브리핑의 큰 LEAK: AIRCRAFT 하나가 LARGE_LEAK_HOURS 안에 값이 매겨진 LEAK으로 이만큼
export const LARGE_LEAK_HOURS = 24;

// 읽을 때 가격표로 값을 매긴 LOGBOOK 줄(ATC-59). fuelCost는 기록에 없다
export type PricedEntry = LogEntry & { fuelCost?: FlightCost | null };

const netOf = (e: PricedEntry): number | null => (typeof e.fuelCost?.netCost === "number" ? e.fuelCost.netCost : null);

// 선형 보간 분위수(p50은 중앙값과 같다)
export function quantile(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

// 모델 세대: 그 FLIGHT에서 요청이 가장 많은 모델(날짜 꼬리 뗌). 같으면 이름순 앞
export function generationOf(fuel: Pick<FlightFuel, "models"> | null | undefined): string | null {
  const top = Object.entries(fuel?.models ?? {})
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0];
  return top ? top[0].replace(/-\d{8}$/, "") : null;
}

// ---- TRIP FUEL ----

export type TripLevel = "TYPE×WAKE" | "WAKE" | "AIRPORT";
export interface TripRange {
  samples: number;
  p50: number | null; // 표본이 TRIP_FUEL_MIN_SAMPLES보다 적은 세대는 null
  p90: number | null;
}
export interface TripFuel extends TripRange {
  level: TripLevel | null; // null: 어느 단계에도 표본이 모자람(값 없음)
  group: string | null; // "BUILD·M", "M", "ATCC"
  generations: (TripRange & { model: string })[]; // 같은 단계의 표본을 모델 세대로 나눈 것(표본 많은 순)
  pool: number; // 기간 안 값이 매겨진 FLIGHT 전체(넓혀도 모자랄 때 보인다)
}
export interface TripTarget {
  key?: string | null; // 자기 줄은 뺀다(LOGBOOK key)
  class: { type: string; wake: string } | null; // AD HOC(분류 없음)은 AIRPORT부터
  airport: string | null;
}

const range = (xs: number[], min: number): TripRange => ({
  samples: xs.length,
  p50: xs.length >= min ? round4(quantile(xs, 0.5)!) : null,
  p90: xs.length >= min ? round4(quantile(xs, 0.9)!) : null,
});
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

// 지난 NET FUEL COST의 p50–p90. TYPE × WAKE에 표본이 모자라면 WAKE, 그다음 AIRPORT로 넓힌다(어느 단계인지 level로 보인다)
export function tripFuelOf(target: TripTarget, entries: readonly PricedEntry[], now: number, days = TRIP_FUEL_DAYS, min = TRIP_FUEL_MIN_SAMPLES): TripFuel {
  const since = now - days * DAY;
  const pool = entries.filter((e) => e.key !== target.key && netOf(e) !== null && Date.parse(e.arrivedAt) >= since && Date.parse(e.arrivedAt) <= now);
  const c = target.class;
  const levels: { level: TripLevel; group: string; hit: (e: PricedEntry) => boolean }[] = [
    ...(c
      ? [
          { level: "TYPE×WAKE" as const, group: `${c.type}·${c.wake}`, hit: (e: PricedEntry) => e.class?.type === c.type && e.class?.wake === c.wake },
          { level: "WAKE" as const, group: c.wake, hit: (e: PricedEntry) => e.class?.wake === c.wake },
        ]
      : []),
    ...(target.airport ? [{ level: "AIRPORT" as const, group: target.airport, hit: (e: PricedEntry) => e.airport === target.airport }] : []),
  ];
  for (const l of levels) {
    const got = pool.filter(l.hit);
    if (got.length < min) continue;
    const byGen = new Map<string, number[]>();
    for (const e of got) {
      const g = generationOf(e.fuel) ?? "unknown";
      byGen.set(g, [...(byGen.get(g) ?? []), netOf(e)!]);
    }
    const generations = [...byGen]
      .map(([model, xs]) => ({ model, ...range(xs, min) }))
      .sort((a, b) => b.samples - a.samples || a.model.localeCompare(b.model));
    return { level: l.level, group: l.group, ...range(got.map((e) => netOf(e)!), min), generations, pool: pool.length };
  }
  return { level: null, group: null, samples: 0, p50: null, p90: null, generations: [], pool: pool.length };
}

export type TripVerdict = "inside" | "unexpected";
export interface TripCheck {
  net: number | null; // 이 FLIGHT의 NET FUEL COST. 값이 없으면 null
  trip: TripFuel;
  verdict: TripVerdict | null; // p90 이하 inside, 넘으면 unexpected. NET이나 TRIP FUEL이 없으면 null
}

// LOGBOOK 줄 하나가 TRIP FUEL 안이었나. 범위는 자기를 뺀 다른 FLIGHT로(정시율의 기대 block time과 같은 방식)
export function tripCheckOf(e: PricedEntry, entries: readonly PricedEntry[], now: number): TripCheck {
  const trip = tripFuelOf({ key: e.key, class: e.class ? { type: e.class.type, wake: e.class.wake } : null, airport: e.airport }, entries, now);
  const net = netOf(e);
  return { net, trip, verdict: net === null || trip.p90 === null ? null : net > trip.p90 ? "unexpected" : "inside" };
}

// ---- FLEET 카드·줄: 최근 14일 ----

export type LeakName = Exclude<LeakRule, "expectedRebuild">;
export interface FleetFuel {
  days: number;
  arrived: number; // 기간 안 ARRIVED
  withFuel: number; // 그중 fuel이 있는 줄(F4 뒤)
  priced: number; // 그중 값이 매겨진 줄(ATC-59 뒤, 가격표에 있는 모델)
  costPerFlight: number | null; // 값 매긴 FLIGHT의 FUEL COST 평균, USD
  netPerFlight: number | null; // NET FUEL 평균
  leakCost: number | null; // 값 매긴 FLIGHT의 LEAK 합
  cacheHit: { captain: number | null; crew: number | null; total: number | null } | null; // fuel 있는 줄의 토큰 합으로. 없으면 null
  crewShare: number | null; // 값 매긴 FLIGHT의 CREW FUEL COST ÷ FUEL COST
  leaks: { rule: LeakName; count: number; tokens: number }[]; // 다시 쓴 토큰이 많은 규칙 TOP_LEAKS개(0은 뺀다)
  crewWarnings: string[] | null; // F7(ATC-57)이 만들기 전에는 null — 경고 없음(0)과 다르다
  unpriced: string[]; // 가격표에 없어 뺀 모델
  unexpected: number; // TRIP FUEL p90을 넘은 FLIGHT
  checked: number; // TRIP FUEL과 비교한 FLIGHT
}

const hit = (read: number, all: number) => (all > 0 ? Math.round((read / all) * 1000) / 1000 : null);
const promptOf = (k: { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }) => k.input + k.cacheWrite5m + k.cacheWrite1h + k.cacheRead;

export function fleetFuelOf(registration: string, entries: readonly PricedEntry[], now: number, days = FLEET_FUEL_DAYS): FleetFuel {
  const reg = registration.toUpperCase();
  const since = now - days * DAY;
  const mine = entries.filter((e) => e.aircraft === reg && Date.parse(e.arrivedAt) >= since && Date.parse(e.arrivedAt) <= now);
  const fueled = mine.filter((e) => e.fuel);
  const priced = mine.filter((e) => e.fuelCost?.total);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const cost = sum(priced.map((e) => e.fuelCost!.total!.total));
  const crew = sum(priced.map((e) => e.fuelCost!.crew?.total ?? 0));
  const read = { captain: 0, crew: 0 };
  const all = { captain: 0, crew: 0 };
  const leaks = new Map<LeakName, { count: number; tokens: number }>();
  for (const e of fueled) {
    const f = e.fuel!;
    read.captain += f.captain.cacheRead;
    all.captain += promptOf(f.captain);
    read.crew += f.crew.cacheRead;
    all.crew += promptOf(f.crew);
    for (const rule of ["coldCache", "controlWake", "modelSwitch", "unexplained"] as const) {
      const b = f.leak?.[rule];
      if (!b?.count) continue;
      const got = leaks.get(rule) ?? { count: 0, tokens: 0 };
      leaks.set(rule, { count: got.count + b.count, tokens: got.tokens + b.tokens });
    }
  }
  const checks = mine.map((e) => tripCheckOf(e, entries, now)).filter((c) => c.verdict !== null);
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  return {
    days,
    arrived: mine.length,
    withFuel: fueled.length,
    priced: priced.length,
    costPerFlight: priced.length ? r4(cost / priced.length) : null,
    netPerFlight: priced.length ? r4(sum(priced.map((e) => e.fuelCost!.netCost ?? 0)) / priced.length) : null,
    leakCost: priced.length ? r4(sum(priced.map((e) => e.fuelCost!.leakCost ?? 0))) : null,
    cacheHit: fueled.length ? { captain: hit(read.captain, all.captain), crew: hit(read.crew, all.crew), total: hit(read.captain + read.crew, all.captain + all.crew) } : null,
    crewShare: priced.length && cost > 0 ? Math.round((crew / cost) * 1000) / 1000 : null,
    leaks: [...leaks]
      .filter(([, b]) => b.tokens > 0)
      .map(([rule, b]) => ({ rule, ...b }))
      .sort((a, b) => b.tokens - a.tokens || a.rule.localeCompare(b.rule))
      .slice(0, TOP_LEAKS),
    crewWarnings: null,
    unpriced: [...new Set(mine.flatMap((e) => e.fuelCost?.unpriced.map((u) => u.model) ?? []))].sort(),
    unexpected: checks.filter((c) => c.verdict === "unexpected").length,
    checked: checks.length,
  };
}

// ---- 브리핑(TOWER·OCC): 큰 LEAK, HOLDING CAPTAIN의 COLD CACHE ----

export interface LargeLeak {
  key: string; // 같은 AIRCRAFT·같은 날(UTC)이면 같은 키 — 한 번만 알린다
  aircraft: string;
  count: number;
  tokens: number;
  cost: number; // 값이 매겨진 LEAK만, USD
  top: LeakName; // 비용이 가장 큰 규칙
  text: string;
}

// 최근 LARGE_LEAK_HOURS 안 LEAK을 AIRCRAFT(팀 세션 이름)마다 더해 LARGE_LEAK_USD 이상인 것. 값 없는 모델의 LEAK은 짐작하지 않는다(원칙 4)
export function largeLeaksOf(events: readonly (LeakEvent & { name?: string | null })[], isTeam: (name: string) => boolean, now: number, minUsd = LARGE_LEAK_USD): LargeLeak[] {
  const since = now - LARGE_LEAK_HOURS * 3_600_000;
  const by = new Map<string, { count: number; tokens: number; cost: number; rules: Map<LeakName, number> }>();
  for (const e of events) {
    const name = e.name?.toUpperCase();
    if (!name || e.rule === "expectedRebuild" || e.cost === null || !isTeam(name)) continue;
    const t = Date.parse(e.t);
    if (t < since || t > now) continue;
    const b = by.get(name) ?? { count: 0, tokens: 0, cost: 0, rules: new Map() };
    b.count++;
    b.tokens += e.rewritten;
    b.cost += e.cost;
    b.rules.set(e.rule, (b.rules.get(e.rule) ?? 0) + e.cost);
    by.set(name, b);
  }
  const day = new Date(now).toISOString().slice(0, 10);
  return [...by]
    .filter(([, b]) => b.cost >= minUsd)
    .sort(([a, x], [b, y]) => y.cost - x.cost || a.localeCompare(b))
    .map(([aircraft, b]) => {
      const top = [...b.rules].sort(([a, x], [c, y]) => y - x || a.localeCompare(c))[0][0];
      return {
        key: `leak|${aircraft}|${day}`,
        aircraft,
        count: b.count,
        tokens: b.tokens,
        cost: Math.round(b.cost * 100) / 100,
        top,
        text: `FUEL LEAK ${usd(b.cost)} in ${LARGE_LEAK_HOURS}h — ${aircraft}, ${b.count} ${b.count === 1 ? "miss" : "misses"}, ${tokensText(b.tokens)} rewritten, mostly ${LEAK_LABEL[top]}`,
      };
    });
}

export interface HoldingCaptain {
  session: string;
  name: string; // REGISTRATION
  lastActiveAt: string | null;
}
export interface ColdCache {
  key: string; // 같은 세션·같은 마지막 요청이면 같은 키
  aircraft: string;
  session: string;
  lastAt: string | null; // 마지막 CAPTAIN 요청(없으면 세션의 마지막 활동)
  idleMin: number;
  ttlMin: number;
  prefix: number | null; // 다시 쓸 것으로 보이는 접두부(마지막 요청의 읽기 + 쓰기 + 입력). 기록이 없으면 null
  cost: number | null; // 그 LEAK 추정, USD. 값 없는 모델·기록 없음은 null
  text: string;
}

// HOLDING CAPTAIN에게 지금 메시지를 보내면 캐시가 식어 접두부를 다시 쓰는가. 경고만 하고 막지 않는다.
// TTL은 F3과 같다: 1h를 쓴 뒤 1시간, 5m만 쓴 뒤 5분, 읽기만 한 요청은 앞 층을 잇는다. 기록이 없으면 마지막 활동이 1시간(최대 TTL)을 넘었을 때만
export function coldCachesOf(holding: readonly HoldingCaptain[], records: Iterable<FuelRecord>, now: number, prices: PriceTable | null): ColdCache[] {
  const bySession = new Map<string, FuelRecord[]>();
  for (const r of records) {
    if (r.sidechain) continue;
    const list = bySession.get(r.session) ?? [];
    list.push(r);
    bySession.set(r.session, list);
  }
  const out: ColdCache[] = [];
  for (const h of holding) {
    const list = (bySession.get(h.session) ?? []).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const aircraft = h.name.toUpperCase();
    if (!list.length) {
      const at = h.lastActiveAt ? Date.parse(h.lastActiveAt) : NaN;
      if (!Number.isFinite(at) || now - at <= TTL_1H_MS) continue;
      const idleMin = Math.floor((now - at) / 60_000);
      out.push({ key: `cold|${h.session}|${h.lastActiveAt}`, aircraft, session: h.session, lastAt: h.lastActiveAt, idleMin, ttlMin: 60, prefix: null, cost: null, text: coldText(aircraft, idleMin, 60, null, null) });
      continue;
    }
    let ttl: number | null = null;
    for (const r of list) ttl = ttlAfter(r, ttl);
    const last = list.at(-1)!;
    const ttlMs = ttl ?? TTL_5M_MS;
    const idle = now - Date.parse(last.t);
    if (idle <= ttlMs) continue;
    const prefix = last.input + last.cacheWrite5m + last.cacheWrite1h + last.cacheRead;
    const priced = leakPriceOf(prefix, { ...last, cacheWrite1h: ttlMs === TTL_1H_MS ? 1 : 0 }, prices);
    const idleMin = Math.floor(idle / 60_000);
    const ttlMin = Math.round(ttlMs / 60_000);
    const cost = priced ? Math.round(priced.cost * 100) / 100 : null;
    out.push({ key: `cold|${h.session}|${last.t}`, aircraft, session: h.session, lastAt: last.t, idleMin, ttlMin, prefix, cost, text: coldText(aircraft, idleMin, ttlMin, prefix, cost) });
  }
  return out.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.aircraft.localeCompare(b.aircraft));
}

function coldText(aircraft: string, idleMin: number, ttlMin: number, prefix: number | null, cost: number | null) {
  const what = prefix === null ? "context size unknown" : `re-writes ~${tokensText(prefix)}${cost === null ? "" : ` (~${usd(cost)})`}`;
  return `COLD CACHE — ${aircraft} HOLDING ${idleMin}m (cache TTL ${ttlMin}m): a message now ${what}`;
}

// ---- 글 ----

export const LEAK_LABEL: Record<LeakName, string> = { coldCache: "COLD CACHE", controlWake: "CONTROL WAKE", modelSwitch: "MODEL SWITCH", unexplained: "UNEXPLAINED" };

export function usd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}
export function tokensText(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
export const pctText = (x: number) => `${Math.round(x * 100)}%`;

// TRIP FUEL 한 줄: "TRIP FUEL $4.10–$9.80 · TYPE×WAKE BUILD·M (6)". 값이 없으면 null
export function tripLabel(t: TripFuel): string | null {
  if (t.level === null || t.p50 === null || t.p90 === null) return null;
  return `TRIP FUEL ${usd(t.p50)}–${usd(t.p90)} · ${t.level} ${t.group} (${t.samples})`;
}

// FLEET 줄의 짧은 글: "FUEL $6.20/FLT · CACHE 97%". 값 매긴 FLIGHT가 없으면 CACHE만, fuel 있는 줄도 없으면 null
export function fleetFuelLabel(f: FleetFuel): string | null {
  const parts = [f.costPerFlight !== null ? `${usd(f.costPerFlight)}/FLT` : null, f.cacheHit?.total != null ? `CACHE ${pctText(f.cacheHit.total)}` : null].filter(Boolean);
  return parts.length ? `FUEL ${parts.join(" · ")}` : null;
}

// 툴팁: 기간, 몇 건에 값이 있나, NET·CREW 몫·LEAK
export function fleetFuelTitle(f: FleetFuel): string {
  const parts = [
    `최근 ${f.days}일 ARRIVED ${f.arrived}건 중 fuel ${f.withFuel}건, 값 ${f.priced}건`,
    f.netPerFlight !== null ? `NET ${usd(f.netPerFlight)}/FLT` : null,
    f.crewShare !== null ? `CREW ${pctText(f.crewShare)}` : null,
    f.leaks.length ? `LEAK ${f.leaks.map((l) => LEAK_LABEL[l.rule]).join(", ")}` : null,
    f.unpriced.length ? `값 없음: ${f.unpriced.join(", ")}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
