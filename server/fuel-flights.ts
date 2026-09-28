import { type Departure, departureHits } from "./departures.ts";
import { addKinds, burn, type FuelRecord, type Kinds, type TokenBurn, zero } from "./fuel.ts";
import { countWarnings, type CrewWarning, type CrewWarningCounts, crewShareOf, emptyWarnings } from "./fuel-crew.ts";
import { addLeak, emptyLeaks, type LeakCounts, leakCountsOf, type LeakEvent, type LeakTotals } from "./fuel-leaks.ts";
import type { LogEntry } from "./logbook.ts";
import type { Claim } from "./model.ts";

// FUEL F4(ATC-53, docs/fuel.md 4·8.2): F1의 요청 기록을 FLIGHT 구간으로 자른다. 순수 함수만 둔다(읽기는 fuel-run.ts·logbook.ts).
// FLIGHT 구간은 LOGBOOK departedAt–arrivedAt, 그 안에서 누가 몰았는지는 착수 기록(departures.jsonl)의 AIRCRAFT 줄,
// 세션이 그 STAND를 점유한 때(claim since–lastAt)는 AIRCRAFT 이름보다 먼저 믿는다. 어느 FLIGHT에도 안 맞으면 UNATTRIBUTED.

// 구간 안에서 한 AIRCRAFT가 몬 때(HANDOFF마다 나뉜다)
export interface Segment {
  aircraft: string;
  from: number;
  to: number;
}

export interface FlightSpan {
  key: string; // LOGBOOK key, 아직 도착하지 않았으면 "enroute:<repo>|<브랜치 또는 STAND>"
  flight: string | null; // AD HOC이면 null
  arrived: boolean;
  from: number;
  to: number;
  stands: string[];
  segments: Segment[];
  airport?: string | null; // AIRPORT code(SESSION CHANGE 기준선, F7). 모르면 null
}

export type ClaimSpan = Pick<Claim, "sessionId" | "workspacePath" | "since" | "lastAt">;

export interface CrewPart extends TokenBurn {
  outputLowerBound: true; // fuel.ts CrewBurn과 같은 까닭
}
export interface Part {
  captain: TokenBurn;
  crew: CrewPart;
  total: TokenBurn;
}

// LOGBOOK arrived 줄의 fuel. 아직 만들지 않은 칸(cost·netCost는 F5)은 0이 아니라 넣지 않는다
export interface FlightFuel {
  captain: TokenBurn;
  crew: CrewPart;
  cacheHit: number | null; // CAPTAIN + CREW
  leak?: LeakCounts; // FUEL LEAK(F3, fuel-leaks.ts). LEAK을 재고 넘긴 때만(miss가 없으면 0). 비용(F5)은 넣지 않는다. F7 규칙 포함
  crewWarnings?: CrewWarningCounts; // CREW 경고 수(F7, fuel-crew.ts). 경고를 재고 넘긴 때만. highCrewShare는 이 FLIGHT가 넘었으면 1
  models: Record<string, number>; // 모델 → 요청 수
}

// 착수 기록 AIRCRAFT 줄 → 구간 안 Segment. 첫 줄은 출발 시각까지 당긴다(STAND를 먼저 만들고 곧 점유하므로).
// AIRCRAFT 줄이 없으면 fallback(LOGBOOK의 AIRCRAFT)이 구간 전체를 몬 것으로 본다
export function segmentsOf(lines: Departure[], from: number, to: number, fallback: string | null): Segment[] {
  const flown = lines.filter((d) => d.aircraft).sort((a, b) => a.t.localeCompare(b.t));
  if (!flown.length) return fallback ? [{ aircraft: fallback, from, to }] : [];
  const out: Segment[] = [];
  flown.forEach((d, i) => {
    const start = i === 0 ? from : Math.max(from, Date.parse(d.t));
    const end = i + 1 < flown.length ? Math.min(to, Date.parse(flown[i + 1].t)) : to;
    if (start > end) return;
    const last = out.at(-1);
    if (last && last.aircraft === d.aircraft && last.to >= start) last.to = end;
    else out.push({ aircraft: d.aircraft!, from: start, to: end });
  });
  return out;
}

// ARRIVED FLIGHT 하나의 구간. repo는 AIRPORT 본 체크아웃 경로(모르면 FLIGHT·STAND로만 착수 기록을 찾는다)
export function arrivedSpan(e: LogEntry, departures: Departure[], repo: string | null): FlightSpan {
  const from = Date.parse(e.departedAt);
  const to = Date.parse(e.arrivedAt);
  const hits = departureHits(departures, { repo, branch: e.branch ?? null, flight: e.flight, stands: e.stands, before: e.arrivedAt });
  return {
    key: e.key,
    flight: e.flight,
    arrived: true,
    from,
    to,
    stands: [...new Set([...e.stands, ...hits.map((d) => d.stand)])].sort(),
    segments: segmentsOf(hits, from, to, e.aircraft),
    airport: e.airport,
  };
}

// 아직 도착하지 않은 FLIGHT(EN ROUTE): 지금 있는 STAND의 착수 기록 중 어느 ARRIVED FLIGHT에도 속하지 않는 줄을
// 저장소·브랜치(없으면 STAND)로 묶는다. 구간은 첫 줄부터 지금까지. 지워진 STAND는 끝난 때를 모르므로 넣지 않는다
export function enRouteSpans(
  departures: Departure[],
  entries: LogEntry[],
  openStands: Set<string>,
  now: number,
  airportOf: (repo: string) => string | null = () => null,
): FlightSpan[] {
  const groups = new Map<string, Departure[]>();
  for (const d of departures) {
    if (!openStands.has(d.stand) || Date.parse(d.t) > now) continue;
    const arrived = entries.some((e) => d.t <= e.arrivedAt && (e.stands.includes(d.stand) || (e.branch != null && e.branch === d.branch)));
    if (arrived) continue;
    const k = `enroute:${d.repo}|${d.branch ?? d.stand}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return [...groups].map(([key, lines]) => {
    const from = Math.min(...lines.map((d) => Date.parse(d.t)));
    return {
      key,
      flight: lines.findLast((d) => d.flight)?.flight ?? null,
      arrived: false,
      from,
      to: now,
      stands: [...new Set(lines.map((d) => d.stand))].sort(),
      segments: segmentsOf(lines, from, now, null),
      airport: airportOf(lines[0].repo),
    };
  });
}

// 요청 하나가 속한 FLIGHT. 그 세션이 그때 그 STAND를 점유했으면(claim) 그 FLIGHT를, 아니면 그때 그 FLIGHT를 몬 AIRCRAFT의 세션이면
// 그 FLIGHT를. 여럿이면 가장 늦게 출발한 FLIGHT(앞 FLIGHT의 착륙 대기 중에 다음 FLIGHT를 몰기 시작한 경우), 같으면 key 순서
export function flightOf(
  r: Pick<FuelRecord, "session" | "t">,
  spans: FlightSpan[],
  aircraftOf: (session: string) => string | null,
  claimsOf: (session: string) => ClaimSpan[],
): FlightSpan | null {
  const t = Date.parse(r.t);
  const covering = spans.filter((s) => s.from <= t && t <= s.to);
  if (!covering.length) return null;
  const held = claimsOf(r.session).filter((c) => Date.parse(c.since) <= t && t <= Date.parse(c.lastAt));
  let hits = covering.filter((s) => held.some((c) => s.stands.includes(c.workspacePath)));
  if (!hits.length) {
    const ac = aircraftOf(r.session);
    if (ac) hits = covering.filter((s) => s.segments.some((g) => g.aircraft === ac && g.from <= t && t <= g.to));
  }
  if (!hits.length) return null;
  return hits.sort((a, b) => b.from - a.from || a.key.localeCompare(b.key))[0];
}

class Tank {
  captain: Kinds = zero();
  captainN = 0;
  crew: Kinds = zero();
  crewN = 0;
  models: Record<string, number> = {};
  sessions = new Set<string>();
  leak: LeakTotals | null = null;
  warn: CrewWarningCounts | null = null;
  add(r: FuelRecord) {
    if (r.sidechain) {
      addKinds(this.crew, r);
      this.crewN++;
    } else {
      addKinds(this.captain, r);
      this.captainN++;
    }
    this.models[r.model] = (this.models[r.model] ?? 0) + 1;
    this.sessions.add(r.session);
  }
  part(): Part {
    const total = zero();
    addKinds(total, this.captain);
    addKinds(total, this.crew);
    return {
      captain: burn(this.captain, this.captainN),
      crew: { ...burn(this.crew, this.crewN), outputLowerBound: true },
      total: burn(total, this.captainN + this.crewN),
    };
  }
  fuel(): FlightFuel {
    const p = this.part();
    const warn = this.warn && { ...this.warn, highCrewShare: crewShareOf(this.captain, this.crew) === null ? 0 : 1 };
    return {
      captain: p.captain,
      crew: p.crew,
      cacheHit: p.total.cacheHit,
      ...(this.leak ? { leak: leakCountsOf(this.leak) } : {}),
      ...(warn ? { crewWarnings: warn } : {}),
      models: this.models,
    };
  }
}

export interface AircraftAttribution {
  flights: Part; // ARRIVED FLIGHT에 들어간 몫
  enRoute: Part; // 아직 도착하지 않은 FLIGHT에 들어간 몫
  unattributed: Part; // UNATTRIBUTED: 어느 FLIGHT에도 안 맞는 몫
}
export interface FlightRow {
  key: string;
  flight: string | null;
  arrived: boolean;
  aircraft: string[]; // 구간 안에서 몬 AIRCRAFT(HANDOFF 순서)
  sessions: string[];
  fuel: FlightFuel;
}
export interface Attribution {
  flights: FlightRow[]; // 요청이 하나라도 들어간 FLIGHT, 많이 쓴 순서
  aircraft: Map<string, AircraftAttribution>; // AIRCRAFT(세션 이름, 대문자)
  totals: AircraftAttribution; // 이름 없는 세션까지 모두
}

export interface AttributionInput {
  records: Iterable<FuelRecord>; // 이미 중복을 없앤 기록(기간은 부른 쪽이 거른다)
  spans: FlightSpan[];
  aircraftOf: (session: string) => string | null;
  claims: ClaimSpan[];
  leaks?: LeakEvent[]; // 주면 FLIGHT마다 같은 규칙(flightOf)으로 LEAK을 나눈다
  warnings?: CrewWarning[]; // 주면 FLIGHT마다 같은 규칙으로 CREW 경고를 센다(F7)
}

// 요청마다 FLIGHT 하나에만 넣는다(나눠 넣지 않는다). CAPTAIN·CREW는 따로 센다
export function attributeFuel(input: AttributionInput): Attribution {
  const claims = new Map<string, ClaimSpan[]>();
  for (const c of input.claims) claims.set(c.sessionId, [...(claims.get(c.sessionId) ?? []), c]);
  const claimsOf = (s: string) => claims.get(s) ?? [];
  const bySpan = new Map<string, Tank>();
  const byAircraft = new Map<string, { flights: Tank; enRoute: Tank; unattributed: Tank }>();
  const all = { flights: new Tank(), enRoute: new Tank(), unattributed: new Tank() };
  for (const r of input.records) {
    const span = flightOf(r, input.spans, input.aircraftOf, claimsOf);
    const bucket = !span ? "unattributed" : span.arrived ? "flights" : "enRoute";
    if (span) {
      if (!bySpan.has(span.key)) bySpan.set(span.key, new Tank());
      bySpan.get(span.key)!.add(r);
    }
    all[bucket].add(r);
    const ac = input.aircraftOf(r.session);
    if (!ac) continue;
    if (!byAircraft.has(ac)) byAircraft.set(ac, { flights: new Tank(), enRoute: new Tank(), unattributed: new Tank() });
    byAircraft.get(ac)![bucket].add(r);
  }
  if (input.leaks) {
    for (const t of bySpan.values()) t.leak = emptyLeaks();
    for (const e of input.leaks) {
      const span = flightOf(e, input.spans, input.aircraftOf, claimsOf);
      const t = span && bySpan.get(span.key);
      if (t) addLeak(t.leak!, e);
    }
  }
  if (input.warnings) {
    for (const t of bySpan.values()) t.warn = emptyWarnings();
    for (const w of input.warnings) {
      const span = flightOf(w, input.spans, input.aircraftOf, claimsOf);
      const t = span && bySpan.get(span.key);
      if (t) countWarnings([w], t.warn!);
    }
  }
  const spanByKey = new Map(input.spans.map((s) => [s.key, s]));
  const flights: FlightRow[] = [...bySpan].map(([key, tank]) => {
    const s = spanByKey.get(key)!;
    return {
      key,
      flight: s.flight,
      arrived: s.arrived,
      aircraft: [...new Set(s.segments.map((g) => g.aircraft))],
      sessions: [...tank.sessions].sort(),
      fuel: tank.fuel(),
    };
  });
  const sum = (f: FlightFuel) => f.captain.requests + f.crew.requests;
  flights.sort((a, b) => sum(b.fuel) - sum(a.fuel) || a.key.localeCompare(b.key));
  const view = (t: { flights: Tank; enRoute: Tank; unattributed: Tank }): AircraftAttribution => ({
    flights: t.flights.part(),
    enRoute: t.enRoute.part(),
    unattributed: t.unattributed.part(),
  });
  return { flights, aircraft: new Map([...byAircraft].map(([k, v]) => [k, view(v)])), totals: view(all) };
}

// LOGBOOK arrived 줄에 붙일 fuel. 모르면 null(필드를 넣지 않는다): 출발 시각을 몰라 PR을 연 때부터 쟀거나(departedFrom "pr"),
// 출발이 읽은 기간(since)보다 이르거나, 들어간 요청이 하나도 없을 때(대화 기록이 지워졌거나 Claude 세션이 아닌 FLIGHT)
export function fuelForEntry(e: LogEntry, att: Attribution, since: number): FlightFuel | null {
  if (e.departedFrom === "pr" || Date.parse(e.departedAt) < since) return null;
  const row = att.flights.find((f) => f.key === e.key);
  return row && row.fuel.captain.requests + row.fuel.crew.requests > 0 ? row.fuel : null;
}
