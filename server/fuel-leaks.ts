import { leakPriceOf, type PriceTable } from "./fuel-cost.ts";
import type { Compaction, FuelRecord } from "./fuel.ts";

// FUEL LEAK(ATC-52, docs/fuel.md 5): 이미 캐시에 있던 맥락을 다시 쓴 몫. 확신이 높은 세 규칙만 이름을 붙인다 —
// COLD CACHE(HOLD), COLD CACHE(control wake), MODEL SWITCH. 다른 miss는 UNEXPLAINED, compaction 뒤 다시 짓기는 F7로 넘긴다.
// 요청 기록(숫자·모델·시각)과 atc의 발신 기록(시각·받는 세션)만 본다. 본문은 읽지 않는다. 표시 전용(DISPATCH에 쓰지 않는다)

export const MISS_SHARE = 0.05; // 캐시에서 읽을 수 있던 것의 5 %를 넘게
export const MISS_MIN_TOKENS = 2_000; // 그리고 2,000 토큰 이상 다시 처리하면 miss(Claude Code의 기준)
export const TTL_5M_MS = 5 * 60_000;
export const TTL_1H_MS = 60 * 60_000;

// 쓰기·읽기 배수와 단가는 FUEL COST의 가격표(ATC-54, fuel-cost.ts)에서 온다. 표에 없는 모델은 값을 매기지 않는다

export type LeakRule = "coldCache" | "controlWake" | "modelSwitch" | "unexplained" | "expectedRebuild";
export const LEAK_RULES: LeakRule[] = ["coldCache", "controlWake", "modelSwitch", "unexplained"];

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
  speed: string | null; // 이번 요청의 usage.speed·inference_geo·쓰기 층: 나중에 가격표로 다시 값을 매길 때(ATC-59)
  geo: string | null;
  writeTier: "5m" | "1h";
  wake: ControlKind | null; // controlWake일 때 깨운 atc 발신
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

// 한 세션의 CAPTAIN 요청(시각 순)을 앞뒤로 비교한다. 첫 요청(SESSION CHANGE)과 CREW는 F7 몫이라 보지 않는다.
// 규칙 순서: 사이에 compaction → expectedRebuild(F7), 모델이 바뀜 → modelSwitch, 간격 > TTL → 사이에 atc 발신이 있으면 controlWake, 없으면 coldCache, 나머지 → unexplained
export function sessionLeaks(captain: FuelRecord[], compactions: string[], sends: ControlSend[], prices: PriceTable | null = null): LeakEvent[] {
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
        let rule: LeakRule = "unexplained";
        let wake: ControlKind | null = null;
        if (cuts.some(inGap)) rule = "expectedRebuild";
        else if (cur.model !== prev.model) rule = "modelSwitch";
        else if (gapMs > (ttl ?? TTL_5M_MS)) {
          wake = sendAt.findLast((s) => inGap(s.at))?.kind ?? null;
          rule = wake ? "controlWake" : "coldCache";
        }
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
          speed: cur.speed,
          geo: cur.geo,
          writeTier: cur.cacheWrite1h > 0 ? "1h" : "5m",
          wake,
        });
      }
    }
    ttl = ttlAfter(cur, ttl);
  }
  return out;
}

// 모든 세션. records는 전역 중복 제거를 마친 것. 발신은 세션 id가 같거나, 받는 이름이 세션 이름과 같으면(대소문자 무시) 그 세션 몫
export function findLeaks(
  records: Iterable<FuelRecord>,
  compactions: Compaction[],
  sends: ControlSend[],
  names: Map<string, string> = new Map(),
  prices: PriceTable | null = null,
): LeakEvent[] {
  const bySession = new Map<string, FuelRecord[]>();
  for (const r of records) {
    if (r.sidechain) continue;
    let list = bySession.get(r.session);
    if (!list) bySession.set(r.session, (list = []));
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
  return out.sort((a, b) => a.t.localeCompare(b.t));
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
  unexplained: LeakBucket;
  total: LeakBucket; // 위 넷의 합(FUEL LEAK)
  expectedRebuild: LeakBucket; // compaction 뒤 다시 짓기. F7이 cold였는지 가린다. LEAK에 넣지 않는다
}

const bucket = (): LeakBucket => ({ count: 0, tokens: 0, units: 0, cost: 0, unpricedTokens: 0 });
export const emptyLeaks = (): LeakTotals => ({
  coldCache: bucket(),
  controlWake: bucket(),
  modelSwitch: bucket(),
  unexplained: bucket(),
  total: bucket(),
  expectedRebuild: bucket(),
});

// LOGBOOK arrived 줄의 fuel.leak(F4)은 F4가 정한 모양 그대로 둔다: 비용(cost)은 넣지 않는다(기록 형식을 바꾸지 않으려고)
export type LeakCounts = Record<keyof LeakTotals, Omit<LeakBucket, "cost">>;
export function leakCountsOf(l: LeakTotals): LeakCounts {
  const out = {} as LeakCounts;
  for (const [k, { cost: _cost, ...rest }] of Object.entries(l) as [keyof LeakTotals, LeakBucket][]) out[k] = rest;
  return out;
}

export function addLeak(to: LeakTotals, e: LeakEvent) {
  for (const b of e.rule === "expectedRebuild" ? [to.expectedRebuild] : [to[e.rule], to.total]) {
    b.count++;
    b.tokens += e.rewritten;
    if (e.units === null) b.unpricedTokens += e.rewritten;
    else {
      b.units += e.units;
      b.cost += e.cost ?? 0;
    }
  }
}
