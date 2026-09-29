import { classOf } from "./crew.ts";
import { DONE_STATES } from "./dispatch.ts";
import { type ColdCache, type PricedEntry, type TripFuel, tripFuelOf } from "./fuel-view.ts";
import type { Ticket } from "./model.ts";
import { regKey } from "./registration.ts";
import type { Route } from "./routes.ts";
import { fetchIssueDetail } from "./sources/linear.ts";

// BRIEFING(ATC-4): DISPATCH 카드 맨 위의 쉬운 세 줄(OCC가 쓴다)과 서버가 계산하는 사실 줄.
// 사실 줄은 모델 없이 스냅샷·LOGBOOK·ROUTE MAP·제안 기록 위의 순수 함수다. 설계: docs/dispatch.md "BRIEFING"

const DAY = 86_400_000;
export const BRIEFING_MAX = 300; // 한 줄 최대 글자
export const RECENT_DAYS = 30; // 같은 ROUTE 최근 FLIGHT를 볼 기간
export const RECENT_MAX = 3;
export const LEAD_MAX = 160;

export interface Briefing {
  what: string; // 무슨 일
  why: string; // 왜 이 AIRCRAFT
  risk: string; // 걸리는 점
  at: string;
}

export class BriefingError extends Error {}

// POST 본문 → 세 줄. 줄마다 공백을 한 칸으로 모으고, 비었거나 너무 길면 오류
export function parseBriefing(body: unknown): Omit<Briefing, "at"> {
  const b = (body ?? {}) as Record<string, unknown>;
  const line = (k: "what" | "why" | "risk", label: string) => {
    const v = typeof b[k] === "string" ? (b[k] as string).replace(/\s+/g, " ").trim() : "";
    if (!v) throw new BriefingError(`${k}(${label})가 필요함`);
    if (v.length > BRIEFING_MAX) throw new BriefingError(`${k}(${label})는 ${BRIEFING_MAX}자 이내`);
    return v;
  };
  return { what: line("what", "무슨 일"), why: line("why", "왜 이 AIRCRAFT"), risk: line("risk", "걸리는 점") };
}

// 본문 첫 문장(BRIEFING이 없을 때 대신 보인다). 제목 줄(#, "Why:" 같은 한 단어 머리)·목록 기호·링크 문법은 벗긴다
export function firstSentence(description: string | null | undefined, max = LEAD_MAX): string | null {
  if (!description) return null;
  const text = description
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l) && !/^[^\s]{1,24}:$/.test(l) && !/^(---|\*\*\*|```)/.test(l))
    .map((l) => l.replace(/^([-*+]|\d+[.)])\s+/, ""))
    .join(" ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const m = /^(.+?[.!?。](?=\s|$)|.+?다\.(?=\s|$))/.exec(text);
  const s = (m ? m[1] : text).trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export interface Facts {
  priority: number | null; // Linear 우선순위(0 없음, 1 긴급 … 4 낮음). FLIGHT를 모르면 null
  waitDays: number | null; // FLIGHT를 만든 뒤 지난 날(내림)
  route: string | null;
  waypoint: { name: string; state: "passed" | "active" | "planned"; remaining: number } | null;
  blockers: { key: string; state: string | null; done: boolean }[]; // Linear blockedBy ∪ DISPATCH HOLD 선행
  recent: { key: string; title: string | null; at: string; how: "ARRIVED" | "ENROUTE" }[]; // 이 AIRCRAFT가 같은 ROUTE에서 최근 맡은 FLIGHT
  crosscheck: { verdict: "agree" | "disagree"; reason: string } | null;
  // FUEL F8(ATC-56): 지난 NET FUEL COST p50–p90(TYPE × WAKE, 모자라면 WAKE·AIRPORT). 보여 주기만 한다 — 점수·배정에 쓰지 않는다
  tripFuel?: TripFuel;
  // 이 AIRCRAFT가 HOLDING인데 캐시가 식었으면 FLIGHT PLAN이 접두부를 다시 쓴다. 경고만(막지 않는다)
  coldCache?: ColdCache | null;
}

export interface FactsProposal {
  id: string;
  flight: string;
  airport?: string | null;
  aircraftName: string | null;
  hold: string[];
  crosscheck: { verdict: "agree" | "disagree"; reason: string } | null;
}

export interface FactsContext {
  now: number;
  tickets: Ticket[];
  routes: Route[];
  entries: PricedEntry[]; // fuelCost가 있으면 TRIP FUEL을 계산한다
  coldCache?: ColdCache[]; // HOLDING CAPTAIN의 COLD CACHE(fuel-watch.ts)
  // 이 AIRCRAFT가 맡아 날고 있는 ASSIGN(ENROUTE 쪽 최근 FLIGHT)
  flying: { flight: string; aircraftName: string | null; at: string }[];
}

// WAYPOINT FLIGHT key → ROUTE·WAYPOINT(남은 FLIGHT 수 포함)
export function waypointIndex(routes: Route[]): Map<string, { route: string; waypoint: NonNullable<Facts["waypoint"]> }> {
  const out = new Map<string, { route: string; waypoint: NonNullable<Facts["waypoint"]> }>();
  for (const r of routes)
    for (const w of r.waypoints) {
      const remaining = w.counts.active + w.counts.blocked + w.counts.planned;
      for (const f of w.flights) out.set(f.key, { route: r.project, waypoint: { name: w.name, state: w.state, remaining } });
    }
  return out;
}

export function factsOf(p: FactsProposal, ctx: FactsContext, index = waypointIndex(ctx.routes)): Facts {
  const byKey = new Map(ctx.tickets.map((t) => [t.key, t]));
  const t = byKey.get(p.flight);
  const wp = index.get(p.flight);
  const route = t?.project ?? wp?.route ?? null;
  const created = t?.createdAt ? Date.parse(t.createdAt) : NaN;
  const blockers = [...new Set([...(t?.blockedBy ?? []), ...p.hold])].sort().map((key) => {
    const b = byKey.get(key);
    return { key, state: b?.state ?? null, done: b ? DONE_STATES.has(b.stateType) : false };
  });
  const projectOf = (key: string) => byKey.get(key)?.project ?? index.get(key)?.route ?? null;
  const since = ctx.now - RECENT_DAYS * DAY;
  const reg = p.aircraftName ? regKey(p.aircraftName) : null; // 제안의 세션 이름과 LOGBOOK의 옛 표기를 한 REGISTRATION으로(ATC-67)
  const recent: Facts["recent"] = [];
  if (reg && route) {
    for (const f of ctx.flying)
      if (f.flight !== p.flight && (f.aircraftName ? regKey(f.aircraftName) : null) === reg && projectOf(f.flight) === route)
        recent.push({ key: f.flight, title: byKey.get(f.flight)?.title ?? null, at: f.at, how: "ENROUTE" });
    for (const e of ctx.entries) {
      const at = Date.parse(e.arrivedAt);
      if (!e.flight || e.flight === p.flight || (e.aircraft ? regKey(e.aircraft) : null) !== reg || at < since || at > ctx.now) continue;
      if (projectOf(e.flight) === route && !recent.some((r) => r.key === e.flight))
        recent.push({ key: e.flight, title: byKey.get(e.flight)?.title ?? e.pr?.title ?? null, at: e.arrivedAt, how: "ARRIVED" });
    }
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));
  return {
    priority: t ? t.priority : null,
    waitDays: Number.isFinite(created) ? Math.max(0, Math.floor((ctx.now - created) / DAY)) : null,
    route,
    waypoint: wp && wp.route === route ? wp.waypoint : null,
    blockers,
    recent: recent.slice(0, RECENT_MAX),
    crosscheck: p.crosscheck ? { verdict: p.crosscheck.verdict, reason: p.crosscheck.reason } : null,
    tripFuel: tripFuelOf({ key: null, class: t ? (({ type, wake }) => ({ type, wake }))(classOf(t.labels)) : null, airport: p.airport ?? null }, ctx.entries, ctx.now),
    coldCache: (reg && ctx.coldCache?.find((c) => c.aircraft === reg)) || null,
  };
}

// ---- 입출력: 본문 첫 문장 캐시 ----
// BRIEFING이 없는 카드에만 쓴다. 부른 시점엔 있는 값을 돌려주고, 없거나 오래됐으면 백그라운드로 읽는다.

const LEAD_TTL_MS = 30 * 60_000;
const leads = new Map<string, { text: string | null; at: number }>();
const pending = new Set<string>();

export function leadOf(key: string, now = Date.now()): string | null {
  const got = leads.get(key);
  if ((!got || now - got.at > LEAD_TTL_MS) && !pending.has(key)) {
    pending.add(key);
    fetchIssueDetail(key)
      .then((d) => {
        const desc = (d as { description?: unknown }).description;
        leads.set(key, { text: firstSentence(typeof desc === "string" ? desc : null), at: Date.now() });
      })
      .catch(() => leads.set(key, { text: got?.text ?? null, at: Date.now() }))
      .finally(() => pending.delete(key));
  }
  return got?.text ?? null;
}
