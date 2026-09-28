import { leakPriceOf, type PriceTable } from "./fuel-cost.ts";
import type { Compaction, FuelRecord } from "./fuel.ts";

// FUEL LEAK(ATC-52·ATC-57, docs/fuel.md 5): 이미 캐시에 있던 맥락을 다시 쓴 몫. 규칙이 설명하는 miss만 이름을 붙인다 —
// COLD CACHE(HOLD), COLD CACHE(control wake), MODEL SWITCH(F3), COMPACTION, SESSION CHANGE, UPGRADE / EFFORT CHANGE(F7).
// 그 밖은 UNEXPLAINED. 프록시 경로(requestId 없음)의 miss는 캐시가 Anthropic 방식이 아니라 LEAK 밖 proxied로 둔다.
// 요청 기록(숫자·모델·시각·version·effort)과 atc의 발신 기록(시각·받는 세션)만 본다. 본문은 읽지 않는다. 표시 전용(DISPATCH에 쓰지 않는다)

export const MISS_SHARE = 0.05; // 캐시에서 읽을 수 있던 것의 5 %를 넘게
export const MISS_MIN_TOKENS = 2_000; // 그리고 2,000 토큰 이상 다시 처리하면 miss(Claude Code의 기준)
export const TTL_5M_MS = 5 * 60_000;
export const TTL_1H_MS = 60 * 60_000;

// 쓰기·읽기 배수와 단가는 FUEL COST의 가격표(ATC-54, fuel-cost.ts)에서 온다. 표에 없는 모델은 값을 매기지 않는다

export type LeakRule =
  | "coldCache"
  | "controlWake"
  | "modelSwitch"
  | "compaction"
  | "sessionChange"
  | "upgrade"
  | "unexplained"
  | "expectedRebuild"
  | "proxied";
// FUEL LEAK에 드는 규칙. expectedRebuild(캐시가 따뜻할 때 compaction 뒤 다시 짓기)와 proxied는 LEAK 밖
export const LEAK_RULES: LeakRule[] = ["coldCache", "controlWake", "modelSwitch", "compaction", "sessionChange", "upgrade", "unexplained"];
export const OUTSIDE_LEAK: LeakRule[] = ["expectedRebuild", "proxied"];

export type ControlKind = "CLEARANCE" | "FLIGHT PLAN" | "RECALL" | "CREW CHANGE";
export interface ControlSend {
  at: string;
  kind: ControlKind;
  session: string | null; // 받는 세션 id(아는 경우)
  name: string | null; // 받는 AIRCRAFT 이름(REGISTRATION)
}

export interface LeakEvent {
  session: string;
  t: string;
  rule: LeakRule;
  rewritten: number; // 캐시에서 읽을 수 있었는데 다시 처리한 토큰
  units: number | null; // rewritten × (writeMult − readMult), 입력 단가 단위. 가격표에 없는 모델은 null
  cost: number | null; // units × P_in(배수 포함), USD
  gapMs: number;
  model: string;
  prevModel: string;
  wake: ControlKind | null; // controlWake일 때 깨운 atc 발신
  crew?: boolean; // CREW(서브에이전트) 요청의 miss(F7)
  agent?: string | null; // CREW면 agent id
  change?: "version" | "effort" | null; // upgrade일 때 바뀐 것
}

const prompt = (r: FuelRecord) => r.input + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead;
const cached = (r: FuelRecord) => r.cacheWrite5m + r.cacheWrite1h + r.cacheRead;

// 앞 요청 뒤 캐시에 남은 것(앞 요청이 읽고 쓴 접두부) 중 이번에 읽지 못한 몫. miss가 아니면 0
export function rewrittenOf(prev: FuelRecord, cur: FuelRecord): number {
  const cacheable = cached(prev);
  const rewritten = Math.max(0, Math.min(cacheable, prompt(cur)) - cur.cacheRead);
  return rewritten > cacheable * MISS_SHARE && rewritten >= MISS_MIN_TOKENS ? rewritten : 0;
}

// 캐시 TTL은 마지막으로 캐시를 쓴 요청의 층: 1h를 썼으면 1시간, 5m만 썼으면 5분. 읽기만 한 요청은 그 층을 이어 간다
export function ttlAfter(r: FuelRecord, before: number | null): number | null {
  if (r.cacheWrite1h > 0) return TTL_1H_MS;
  if (r.cacheWrite5m > 0) return TTL_5M_MS;
  return before;
}

export function unitsOf(rewritten: number, cur: FuelRecord, prices: PriceTable | null): number | null {
  return leakPriceOf(rewritten, cur, prices)?.units ?? null;
}

// 한 세션의 CAPTAIN 요청(또는 CREW 하나의 요청, 시각 순)을 앞뒤로 비교한다. 첫 요청은 여기서 보지 않는다(SESSION CHANGE는 sessionChangeLeaks).
// 규칙 순서: 프록시 경로 → proxied(LEAK 밖), 사이에 compaction → 간격 > TTL이면 compaction(cold, LEAK) 아니면 expectedRebuild(LEAK 밖),
// 모델이 바뀜 → modelSwitch, 간격 > TTL → 사이에 atc 발신이 있으면 controlWake 없으면 coldCache,
// 둘 다 아는 version이나 effort가 바뀜 → upgrade, 나머지 → unexplained
export function sessionLeaks(
  captain: FuelRecord[],
  compactions: string[],
  sends: ControlSend[],
  prices: PriceTable | null = null,
  crew: { agent: string | null } | null = null,
): LeakEvent[] {
  const out: LeakEvent[] = [];
  const cuts = compactions.map(Date.parse).sort((a, b) => a - b);
  const sendAt = sends.map((s) => ({ at: Date.parse(s.at), kind: s.kind })).sort((a, b) => a.at - b.at);
  let ttl: number | null = null;
  for (let i = 0; i < captain.length; i++) {
    const cur = captain[i];
    if (i > 0) {
      const prev = captain[i - 1];
      const rewritten = rewrittenOf(prev, cur);
      if (rewritten > 0) {
        const p = Date.parse(prev.t);
        const c = Date.parse(cur.t);
        const gapMs = c - p;
        const inGap = (at: number) => at > p && at <= c;
        const cold = gapMs > (ttl ?? TTL_5M_MS);
        let rule: LeakRule = "unexplained";
        let wake: ControlKind | null = null;
        let change: LeakEvent["change"] = null;
        if (cur.proxied) rule = "proxied";
        else if (cuts.some(inGap)) rule = cold ? "compaction" : "expectedRebuild";
        else if (cur.model !== prev.model) rule = "modelSwitch";
        else if (cold) {
          wake = sendAt.findLast((s) => inGap(s.at))?.kind ?? null;
          rule = wake ? "controlWake" : "coldCache";
        } else if (prev.version && cur.version && prev.version !== cur.version) [rule, change] = ["upgrade", "version"];
        else if (prev.effort && cur.effort && prev.effort !== cur.effort) [rule, change] = ["upgrade", "effort"];
        const price = leakPriceOf(rewritten, cur, prices);
        out.push({
          session: cur.session,
          t: cur.t,
          rule,
          rewritten,
          units: price?.units ?? null,
          cost: price?.cost ?? null,
          gapMs,
          model: cur.model,
          prevModel: prev.model,
          wake,
          crew: crew !== null,
          agent: crew?.agent ?? null,
          change,
        });
      }
    }
    ttl = ttlAfter(cur, ttl);
  }
  return out;
}

// 모든 세션. records는 전역 중복 제거를 마친 것. 발신은 세션 id가 같거나, 받는 이름이 세션 이름과 같으면(대소문자 무시) 그 세션 몫.
// CREW는 서브에이전트 하나(agent id)씩 따로 잇는다. atc는 서브에이전트에게 보내지 않고 compaction은 본 대화 기록 것이라 둘 다 없이
export function findLeaks(
  records: Iterable<FuelRecord>,
  compactions: Compaction[],
  sends: ControlSend[],
  names: Map<string, string> = new Map(),
  prices: PriceTable | null = null,
): LeakEvent[] {
  const bySession = new Map<string, FuelRecord[]>();
  const byAgent = new Map<string, FuelRecord[]>();
  for (const r of records) {
    const [map, k] = r.sidechain ? [byAgent, `${r.session}\u0000${r.agent ?? ""}`] : [bySession, r.session];
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(r);
  }
  const cutsOf = new Map<string, string[]>();
  for (const c of compactions) {
    let list = cutsOf.get(c.session);
    if (!list) cutsOf.set(c.session, (list = []));
    list.push(c.t);
  }
  const out: LeakEvent[] = [];
  for (const [session, list] of bySession) {
    list.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const name = names.get(session)?.toUpperCase() ?? null;
    const mine = sends.filter((s) => s.session === session || (name !== null && s.name?.toUpperCase() === name));
    out.push(...sessionLeaks(list, cutsOf.get(session) ?? [], mine, prices));
  }
  for (const list of byAgent.values()) {
    list.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    out.push(...sessionLeaks(list, [], [], prices, { agent: list[0].agent }));
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

// ── SESSION CHANGE(F7) ──

// 새 세션의 값: 첫 CAPTAIN 요청이 캐시 없이 처리한 것(입력 + 캐시 쓰기). 시스템 프롬프트·도구·CLAUDE.md, 이어 받기면 옛 대화까지
export const firstWrite = (r: FuelRecord) => r.input + r.cacheWrite5m + r.cacheWrite1h;
export const BASELINE_MIN_SAMPLES = 3;

export interface Baseline {
  median: number;
  n: number;
}
export interface SessionChangeResult {
  events: LeakEvent[];
  baselines: Record<string, Baseline>; // AIRPORT → 새 세션 기준선. "*"는 모든 세션(AIRPORT 표본이 적을 때 쓴다)
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// 같은 FLIGHT(STAND)에 앞서 다른 세션이 있던 새 세션의 첫 CAPTAIN 요청 중 그 AIRPORT 기준선을 넘은 몫.
// 기준선은 기간 안 모든 새 세션 첫 요청의 중앙값(AIRPORT별, 표본이 BASELINE_MIN_SAMPLES보다 적으면 전체). 프록시 경로는 빼고,
// FLIGHT를 모르는 세션은 기준선에만 든다. flightOf는 요청 → 그 FLIGHT(fuel-flights.ts flightOf)
export function sessionChangeLeaks(
  records: Iterable<FuelRecord>,
  flightOf: (r: FuelRecord) => { key: string; airport: string | null } | null,
  prices: PriceTable | null = null,
): SessionChangeResult {
  const bySession = new Map<string, FuelRecord[]>();
  for (const r of records) {
    if (r.sidechain || r.proxied) continue;
    let list = bySession.get(r.session);
    if (!list) bySession.set(r.session, (list = []));
    list.push(r);
  }
  // FLIGHT마다 세션별 요청 시각(앞선 다른 세션을 찾으려고)
  const inFlight = new Map<string, { session: string; t: number }[]>();
  const starts: { r: FuelRecord; flight: { key: string; airport: string | null } | null }[] = [];
  for (const list of bySession.values()) {
    list.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    list.forEach((r, i) => {
      const f = flightOf(r);
      if (i === 0) starts.push({ r, flight: f });
      if (!f) return;
      let seen = inFlight.get(f.key);
      if (!seen) inFlight.set(f.key, (seen = []));
      seen.push({ session: r.session, t: Date.parse(r.t) });
    });
  }
  const samples = new Map<string, number[]>([["*", []]]);
  for (const { r, flight } of starts) {
    samples.get("*")!.push(firstWrite(r));
    const a = flight?.airport;
    if (a) samples.set(a, [...(samples.get(a) ?? []), firstWrite(r)]);
  }
  const baselines: Record<string, Baseline> = {};
  for (const [a, xs] of samples) if (xs.length) baselines[a] = { median: medianOf(xs), n: xs.length };
  const events: LeakEvent[] = [];
  for (const { r, flight } of starts) {
    if (!flight) continue;
    const t = Date.parse(r.t);
    const before = (inFlight.get(flight.key) ?? []).filter((x) => x.session !== r.session && x.t < t);
    if (!before.length) continue; // 그 FLIGHT의 첫 세션
    const own = flight.airport ? baselines[flight.airport] : undefined;
    const base = own && own.n >= BASELINE_MIN_SAMPLES ? own : baselines["*"];
    const rewritten = firstWrite(r) - (base?.median ?? 0);
    if (rewritten < MISS_MIN_TOKENS) continue;
    const prevAt = Math.max(...before.map((x) => x.t));
    const price = leakPriceOf(rewritten, r, prices);
    events.push({
      session: r.session,
      t: r.t,
      rule: "sessionChange",
      rewritten,
      units: price?.units ?? null,
      cost: price?.cost ?? null,
      gapMs: t - prevAt,
      model: r.model,
      prevModel: r.model,
      wake: null,
      crew: false,
      agent: null,
      change: null,
    });
  }
  return { events, baselines };
}

// atc가 CAPTAIN에게 보낸 발신의 시각. CLEARANCE는 기록한 때, FLIGHT PLAN은 send, RECALL은 요청한 때(recall-send는 기록이 없다), CREW CHANGE는 sent
export function controlSendsOf(input: {
  clearances?: { at: string; to: string; toName: string }[];
  proposals?: { aircraft: string | null; aircraftName: string | null; timeline: Partial<Record<string, string>> }[];
  crewChanges?: { registration: string; sentAt: string | null }[];
}): ControlSend[] {
  const out: ControlSend[] = [];
  for (const c of input.clearances ?? []) out.push({ at: c.at, kind: "CLEARANCE", session: c.to || null, name: c.toName || null });
  for (const p of input.proposals ?? []) {
    const who = { session: p.aircraft, name: p.aircraftName };
    if (p.timeline.sent) out.push({ at: p.timeline.sent, kind: "FLIGHT PLAN", ...who });
    if (p.timeline.recalling) out.push({ at: p.timeline.recalling, kind: "RECALL", ...who });
  }
  for (const c of input.crewChanges ?? []) if (c.sentAt) out.push({ at: c.sentAt, kind: "CREW CHANGE", session: null, name: c.registration });
  return out;
}

export interface LeakBucket {
  count: number;
  tokens: number;
  units: number; // 값이 매겨진 몫만
  cost: number; // USD, 값이 매겨진 몫만
  unpricedTokens: number; // 가격표에 없는 모델의 rewritten
}
export interface LeakTotals {
  coldCache: LeakBucket;
  controlWake: LeakBucket;
  modelSwitch: LeakBucket;
  compaction: LeakBucket; // compaction 뒤 다시 짓기 중 캐시가 식은 때(F7)
  sessionChange: LeakBucket; // 같은 FLIGHT의 새 세션 첫 요청 중 AIRPORT 기준선을 넘은 몫(F7)
  upgrade: LeakBucket; // version·effort가 바뀐 바로 뒤 miss(F7)
  unexplained: LeakBucket;
  total: LeakBucket; // 위 규칙들의 합(FUEL LEAK)
  crew: LeakBucket; // total 중 CREW 요청 몫(F7)
  expectedRebuild: LeakBucket; // 캐시가 따뜻할 때 compaction 뒤 다시 짓기. LEAK에 넣지 않는다
  proxied: LeakBucket; // 프록시 경로(DeepSeek·Muse 등)의 miss. 캐시가 암묵적이고 값이 다르다. LEAK에 넣지 않는다
}

const bucket = (): LeakBucket => ({ count: 0, tokens: 0, units: 0, cost: 0, unpricedTokens: 0 });
export const emptyLeaks = (): LeakTotals => ({
  coldCache: bucket(),
  controlWake: bucket(),
  modelSwitch: bucket(),
  compaction: bucket(),
  sessionChange: bucket(),
  upgrade: bucket(),
  unexplained: bucket(),
  total: bucket(),
  crew: bucket(),
  expectedRebuild: bucket(),
  proxied: bucket(),
});

// LOGBOOK arrived 줄의 fuel.leak(F4)은 F4가 정한 모양 그대로 둔다: 비용(cost)은 넣지 않는다(기록 형식을 바꾸지 않으려고)
export type LeakCounts = Record<keyof LeakTotals, Omit<LeakBucket, "cost">>;
export function leakCountsOf(l: LeakTotals): LeakCounts {
  const out = {} as LeakCounts;
  for (const [k, { cost: _cost, ...rest }] of Object.entries(l) as [keyof LeakTotals, LeakBucket][]) out[k] = rest;
  return out;
}

export function addLeak(to: LeakTotals, e: LeakEvent) {
  const outside = OUTSIDE_LEAK.includes(e.rule);
  for (const b of outside ? [to[e.rule]] : [to[e.rule], to.total, ...(e.crew ? [to.crew] : [])]) {
    b.count++;
    b.tokens += e.rewritten;
    if (e.units === null) b.unpricedTokens += e.rewritten;
    else {
      b.units += e.units;
      b.cost += e.cost ?? 0;
    }
  }
}
