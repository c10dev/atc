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

// RELEASE의 사이드바는 목록이 아니라 구역 색인이다(ATC-423, docs/layout.md Q7). 고르면 주소가 `#release/<구역>`이 되고 RELEASE가 그 구역으로 스크롤한다.
// 구역은 발권 순서(상위 이슈마다 나무 + SCHEDULE NEW 제안) · 발권 전 Todo · 최근 발권이고, 수는 화면과 사이드바가 같은 함수로 센다
export const RELEASE_SECTIONS = [
  { id: "order", label: "발권 순서", hash: "release/order" },
  { id: "unreleased", label: "Todo 발권 전", hash: "release/unreleased" },
  { id: "recent", label: "최근 발권", hash: "release/recent" },
] as const;
export type ReleaseSection = (typeof RELEASE_SECTIONS)[number]["id"];

// 발권 나무(server/release-tree.ts)의 줄을 가른다: 쏠 수 있는 줄(fire)은 후보, 이미 Todo인 줄(release)은 발권 전(`Todo 발권 전` 구역), 나머지(대기·진행 중)는 따로. 나무 순서를 지킨다. 화면의 나무는 모든 줄을 그리고, 이 가름은 `Todo 발권 전`과 수에 쓴다
export function partitionRelease<T extends { fire: "fire" | "release" | null; children: T[] }>(groups: readonly { rows: readonly T[] }[]): { candidates: T[]; unreleased: T[]; rest: T[] } {
  const out: { candidates: T[]; unreleased: T[]; rest: T[] } = { candidates: [], unreleased: [], rest: [] };
  const walk = (rows: readonly T[]) => {
    for (const r of rows) {
      (r.fire === "fire" ? out.candidates : r.fire === "release" ? out.unreleased : out.rest).push(r);
      walk(r.children);
    }
  };
  for (const g of groups) walk(g.rows);
  return out;
}

// 나무가 그리는 줄 수(중첩 포함). 끝난 이슈는 줄이 아니라 그룹의 끝남 수에 든다
export function treeSize(groups: readonly { rows: readonly { children: readonly unknown[] }[] }[]): number {
  const count = (rows: readonly { children: readonly unknown[] }[]): number => rows.reduce((n, r) => n + 1 + count(r.children as readonly { children: readonly unknown[] }[]), 0);
  return groups.reduce((n, g) => n + count(g.rows), 0);
}

// GET /api/releases 한 덩이에서 구역마다 수를 센다(발권 순서는 나무의 줄에 SCHEDULE NEW 제안을 더한다). 읽지 못하면 빈 수
export function releaseSectionCounts(j: unknown): { id: ReleaseSection; label: string; hash: string; count: number }[] {
  const d = (j ?? {}) as { tree?: { rows: { fire: "fire" | "release" | null; children: never[] }[] }[]; proposals?: unknown[]; recent?: unknown[] };
  const p = partitionRelease(Array.isArray(d.tree) ? d.tree : []);
  const count = { order: treeSize(Array.isArray(d.tree) ? d.tree : []) + (Array.isArray(d.proposals) ? d.proposals.length : 0), unreleased: p.unreleased.length, recent: Array.isArray(d.recent) ? d.recent.length : 0 };
  return RELEASE_SECTIONS.map((s) => ({ ...s, count: count[s.id] }));
}

// 지금 주소의 RELEASE 구역(#release/order …). 없거나 모르면 null
export function releaseSectionOf(hash: string): ReleaseSection | null {
  const sub = hash.replace(/^#/, "").split("/")[1] ?? "";
  return RELEASE_SECTIONS.find((s) => s.id === sub)?.id ?? null;
}

// METRICS 하위 화면과 HOME 닻. 주소 조각(hash)과 이름을 한곳에 둔다
export const METRICS_ITEMS = [
  { id: "ops", label: "OPERATIONS", hash: "metrics" },
  { id: "leaks", label: "LEAKS", hash: "metrics/leaks" },
  { id: "misfire", label: "MISFIRE", hash: "metrics/misfire" },
  { id: "fuel", label: "FUEL", hash: "metrics/fuel" },
  { id: "network", label: "NETWORK", hash: "metrics/network" },
] as const;

// HOME의 사이드바는 할 일 목록을 종류별로 거른다(ATC-422, S1b). 고르면 주소가 `#home/<id>`가 되고 HOME이 그 주소를 읽는다. 전체가 기본이다.
// QUEUE는 결정을 기다리는 줄(알림·막힌 FLIGHT·EFFECT·CLOSE가 아닌 것), DONE은 Linear에서 직접 Done으로 바꿀 CLOSE
export const HOME_FILTERS = [
  { id: "all", label: "전체", hash: "home" },
  { id: "queue", label: "QUEUE", hash: "home/queue" },
  { id: "alert", label: "ALERT", hash: "home/alert" },
  { id: "stuck", label: "STUCK", hash: "home/stuck" },
  { id: "effect", label: "EFFECT", hash: "home/effect" },
  { id: "done", label: "DONE", hash: "home/done" },
] as const;
export type HomeFilter = (typeof HOME_FILTERS)[number]["id"];

// 큐 항목의 kind → 어느 거름에 드나(전체는 모두)
export function homeFilterOfKind(kind: string): Exclude<HomeFilter, "all"> {
  switch (kind) {
    case "ALERT":
      return "alert";
    case "STUCK":
      return "stuck";
    case "EFFECT":
      return "effect";
    case "CLOSE":
    case "ARRIVED":
      return "done";
    default:
      return "queue";
  }
}

// 거름마다 항목 수. 전체는 모두이고, 항목이 없는 거름은 목록에서 뺀다(전체는 늘 있다)
export function homeFilterCounts(items: readonly { kind: string }[]): { id: HomeFilter; label: string; hash: string; count: number }[] {
  const by: Record<string, number> = {};
  for (const i of items) by[homeFilterOfKind(i.kind)] = (by[homeFilterOfKind(i.kind)] ?? 0) + 1;
  return HOME_FILTERS.map((f) => ({ ...f, count: f.id === "all" ? items.length : (by[f.id] ?? 0) })).filter((f) => f.id === "all" || f.count > 0);
}

// 지금 주소의 거름(#home, #home/alert …). 모르는 것은 전체
export function homeFilterOf(hash: string): HomeFilter {
  const sub = hash.replace(/^#/, "").split("/")[1] ?? "";
  return HOME_FILTERS.some((f) => f.id === sub) ? (sub as HomeFilter) : "all";
}

export function filterLabeled<T extends { label: string }>(items: readonly T[], query: string): T[] {
  return items.filter((i) => matchesQuery(query, [i.label]));
}

// 지금 주소의 METRICS 하위 화면(#metrics, #metrics/leaks …)
export function metricsSubOf(hash: string): string {
  const sub = hash.replace(/^#/, "").split("/")[1] ?? "";
  return METRICS_ITEMS.some((m) => m.id === sub) ? sub : "ops";
}
