import { compareRegistration } from "../../server/registration.ts";

// 화면 사이드바(ATC-443, docs/layout.md 7.2)의 목록 계산. React도 입출력도 없는 순수 함수라 node:test로 시험한다(server/sidebar-rows.test.ts).
// 모양: AIRPORT마다 한 묶음, 묶음 안에서 살아 있는 것이 먼저, 끝난 FLIGHT는 개수 뒤로 접는다. 검색은 이 목록만 거른다.

export interface AirportLite {
  code: string;
  repo: string;
  name: string;
}

// 검색어: 공백으로 나눈 낱말이 모두 어느 글에든 들어 있으면 맞는다(대소문자 무시). 빈 검색어는 모두 맞는다
export function matchesQuery(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = fields
    .filter((f): f is string => Boolean(f))
    .join("\n")
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export interface Group<T> {
  code: string; // AIRPORT 코드. 어느 AIRPORT도 아니면 NO_AIRPORT
  repo: string | null;
  name: string | null;
  rows: T[];
}

export const NO_AIRPORT = "—";

// AIRPORT 순서(airports 배열 순서)를 따라 묶는다. 목록에 없는 코드와 코드 없음은 맨 뒤 한 묶음. 빈 묶음은 뺀다
export function groupByAirport<T extends { airport: string | null }>(items: readonly T[], airports: readonly AirportLite[]): Group<T>[] {
  const known = new Map(airports.map((a) => [a.code, a]));
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const code = it.airport && known.has(it.airport) ? it.airport : NO_AIRPORT;
    const list = buckets.get(code);
    if (list) list.push(it);
    else buckets.set(code, [it]);
  }
  const out: Group<T>[] = [];
  for (const a of airports) {
    const rows = buckets.get(a.code);
    if (rows?.length) out.push({ code: a.code, repo: a.repo, name: a.name, rows });
  }
  const rest = buckets.get(NO_AIRPORT);
  if (rest?.length) out.push({ code: NO_AIRPORT, repo: null, name: null, rows: rest });
  return out;
}

export interface FlightInput {
  key: string;
  title: string;
  state: string;
  stateType: string;
  priority: number; // 0 없음, 1 긴급 … 4 낮음
  airport: string | null;
  live: boolean; // 살아 있는 세션이 이 FLIGHT를 쥐고 있다
  updatedAt: string | null;
}

export interface FlightGroup extends Group<FlightInput> {
  done: FlightInput[]; // 끝난 FLIGHT(최근 것만): 개수 뒤에 접힌다
  doneCount: number;
  liveCount: number;
}

// 사이드바에 보이는 FLIGHT: 하는 중·기다리는 것과 최근에 끝난 것. 쌓아 둔 backlog는 FLIGHTS 화면의 접힌 열과 같이 뺀다(살아 있으면 넣는다)
export const DONE_WINDOW_MS = 7 * 24 * 3600_000;
const FINISHED = new Set(["completed", "canceled", "duplicate"]);
const ACTIVE = new Set(["triage", "unstarted", "started", "unknown"]);
const STATE_RANK: Record<string, number> = { started: 0, unstarted: 1, triage: 2, unknown: 3 };

export function isFinished(stateType: string): boolean {
  return FINISHED.has(stateType);
}

// 살아 있는 것 먼저, 그다음 하는 중 → 기다림, 우선순위(없음은 맨 뒤), key 순
export function compareFlights(a: FlightInput, b: FlightInput): number {
  if (a.live !== b.live) return a.live ? -1 : 1;
  const ra = STATE_RANK[a.stateType] ?? 9;
  const rb = STATE_RANK[b.stateType] ?? 9;
  if (ra !== rb) return ra - rb;
  const pa = a.priority || 9;
  const pb = b.priority || 9;
  if (pa !== pb) return pa - pb;
  return a.key.localeCompare(b.key, undefined, { numeric: true });
}

export function flightGroups(items: readonly FlightInput[], airports: readonly AirportLite[], query: string, now: number): FlightGroup[] {
  const shown = items.filter((f) => matchesQuery(query, [f.key, f.title, f.airport]));
  const open: FlightInput[] = [];
  const done: FlightInput[] = [];
  for (const f of shown) {
    if (isFinished(f.stateType)) {
      const at = f.updatedAt ? Date.parse(f.updatedAt) : NaN;
      if (f.live || (Number.isFinite(at) && now - at <= DONE_WINDOW_MS)) done.push(f);
    } else if (f.live || ACTIVE.has(f.stateType)) open.push(f);
  }
  // 열린 FLIGHT가 없고 끝난 것만 있는 AIRPORT도 묶음으로 보인다(개수만)
  return groupByAirport([...open, ...done], airports).map((g) => {
    const rows = g.rows.filter((f) => !isFinished(f.stateType)).sort(compareFlights);
    const finished = g.rows.filter((f) => isFinished(f.stateType)).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return { ...g, rows, done: finished, doneCount: finished.length, liveCount: rows.filter((f) => f.live).length };
  });
}

export interface AircraftInput {
  registration: string;
  callsign: string;
  airport: string | null;
  status: string; // busy | idle | dead | absent
  retired: boolean;
}

const AIRCRAFT_RANK: Record<string, number> = { busy: 0, idle: 1, dead: 2, absent: 3 };

// 상태 낱말(점 색만으로 상태를 말하지 않는다): 세션 배지와 같은 낱말
export function aircraftStateWord(status: string): string {
  return status === "busy" ? "AIRBORNE" : status === "idle" ? "IDLE" : status === "dead" ? "NORDO" : "ABSENT";
}

export function aircraftGroups(items: readonly AircraftInput[], airports: readonly AirportLite[], query: string): Group<AircraftInput>[] {
  const shown = items.filter((a) => !a.retired && matchesQuery(query, [a.registration, a.callsign, a.airport, aircraftStateWord(a.status)]));
  return groupByAirport(shown, airports).map((g) => ({
    ...g,
    rows: [...g.rows].sort((a, b) => (AIRCRAFT_RANK[a.status] ?? 9) - (AIRCRAFT_RANK[b.status] ?? 9) || compareRegistration(a.registration, b.registration)),
  }));
}

export interface ReleaseInput {
  key: string;
  title: string;
  priority: number;
  airport: string | null;
}

export function releaseGroups(items: readonly ReleaseInput[], airports: readonly AirportLite[], query: string): Group<ReleaseInput>[] {
  const shown = items.filter((r) => matchesQuery(query, [r.key, r.title, r.airport]));
  return groupByAirport(shown, airports).map((g) => ({
    ...g,
    rows: [...g.rows].sort((a, b) => (a.priority || 9) - (b.priority || 9) || a.key.localeCompare(b.key, undefined, { numeric: true })),
  }));
}

// METRICS 하위 화면과 HOME 닻. 주소 조각(hash)과 이름을 한곳에 둔다
export const METRICS_ITEMS = [
  { id: "ops", label: "OPERATIONS", hash: "metrics" },
  { id: "leaks", label: "LEAKS", hash: "metrics/leaks" },
  { id: "misfire", label: "MISFIRE", hash: "metrics/misfire" },
  { id: "fuel", label: "FUEL", hash: "metrics/fuel" },
  { id: "network", label: "NETWORK", hash: "metrics/network" },
] as const;

export const HOME_ANCHORS = [
  { id: "queue", label: "TO DO", ariaLabel: "SUPERVISOR QUEUE · 할 일" }, // 알림·막힌 FLIGHT·EFFECT·CLOSE도 이 목록에 있다(ATC-454)
  { id: "brakes", label: "BRAKES", ariaLabel: "BRAKES" },
] as const;

export function filterLabeled<T extends { label: string }>(items: readonly T[], query: string): T[] {
  return items.filter((i) => matchesQuery(query, [i.label]));
}

// 지금 주소의 METRICS 하위 화면(#metrics, #metrics/leaks …)
export function metricsSubOf(hash: string): string {
  const sub = hash.replace(/^#/, "").split("/")[1] ?? "";
  return METRICS_ITEMS.some((m) => m.id === sub) ? sub : "ops";
}
