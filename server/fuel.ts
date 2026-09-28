import { addCost, type Cost, costOf, type PriceTable, type PriceWarning, rateOf, roundCost, zeroCost } from "./fuel-cost.ts";
import { addLeak, emptyLeaks, type LeakEvent, type LeakTotals } from "./fuel-leaks.ts";

// FUEL(ATC-50, docs/fuel.md 1·2·4): 대화 기록의 message.usage로 요청마다 토큰을 센다. 순수 함수만 둔다(읽기는 fuel-run.ts).
// 본문은 읽지도 남기지도 않는다 — "usage"·"compact_boundary"·"agent-name"이 없는 줄은 JSON.parse 전에 버리고,
// 파싱한 줄에서는 숫자·모델·시각 같은 필드만 새 객체로 옮긴다(message.content, wireToolInputs는 옮기지 않는다).

export interface Kinds {
  input: number; // 캐시 안 된 입력
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface FuelRecord extends Kinds {
  key: string; // 중복 제거 열쇠(dedupeKey)
  session: string;
  sidechain: boolean; // CREW(서브에이전트) 요청
  agent: string | null; // CREW 기록 파일의 agent id(agent-<id>.jsonl)
  t: string; // ISO
  model: string;
  stopReason: string | null;
  version: string | null;
  effort: string | null;
  speed: string | null; // usage.speed(standard·fast). FUEL COST 배수
  geo: string | null; // usage.inference_geo. FUEL COST 배수
}

export interface Compaction {
  session: string;
  t: string;
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
}

export interface ParsedFuel {
  records: FuelRecord[];
  compactions: Compaction[];
  name: string | null; // 마지막 agent-name 줄(세션 이름)
  unknown: number; // 걸러 읽었지만 모양을 모르는 줄
  synthetic: number; // model "<synthetic>"(API 호출이 없던 줄). 세지 않는다
}

export const KIND_KEYS = ["input", "cacheWrite5m", "cacheWrite1h", "cacheRead", "output"] as const;

export const zero = (): Kinds => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 });
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : v == null ? 0 : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
export const tokenSum = (k: Kinds): number => k.input + k.cacheWrite5m + k.cacheWrite1h + k.cacheRead + k.output;

// 요청 하나의 열쇠: (message.id, requestId). requestId가 없는 줄(프록시로 도는 DeepSeek·Muse 등)은 (message.id, sessionId).
// 설계의 (message.id, sessionId, timestamp)는 쓰지 않는다 — 한 응답의 내용 블록 줄마다 timestamp가 달라 같은 요청이 여러 번 세진다
export function dedupeKey(messageId: string, requestId: string | null, session: string): string {
  return requestId ? `${messageId}|${requestId}` : `${messageId}|s:${session}`;
}

// usage → 다섯 가지. 쓰기 합은 cache_creation_input_tokens를 믿고, 그중 1h 몫만 cache_creation에서 가져온다.
// cache_creation이 없으면 쓰기 전부가 5m(API 기본 TTL)다. input_tokens·output_tokens가 숫자가 아니면 모르는 모양
export function kindsOf(usage: Record<string, unknown>): Kinds | null {
  if (typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") return null;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const write = count(usage.cache_creation_input_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  if (input === null || output === null || write === null || cacheRead === null) return null;
  const cc = usage.cache_creation as Record<string, unknown> | null | undefined;
  const w1h = Math.min(write, (cc && typeof cc === "object" && count(cc.ephemeral_1h_input_tokens)) || 0);
  return { input, cacheWrite5m: write - w1h, cacheWrite1h: w1h, cacheRead, output };
}

export interface ParseOpts {
  session?: string; // 파일로 안 세션(줄에 sessionId가 없을 때)
  crew?: boolean; // subagents/ 아래 파일
  agent?: string | null;
}

// 대화 기록 텍스트(줄바꿈으로 끝나는 온전한 줄들) → 요청 기록. 같은 파일 안 중복은 그대로 두고 dedupeFuel이 없앤다
export function parseFuelLines(text: string, opts: ParseOpts = {}): ParsedFuel {
  const out: ParsedFuel = { records: [], compactions: [], name: null, unknown: 0, synthetic: 0 };
  let from = 0;
  while (from < text.length) {
    let end = text.indexOf("\n", from);
    if (end < 0) end = text.length;
    const line = text.slice(from, end);
    from = end + 1;
    const usage = line.includes('"usage"');
    const compact = !usage && line.includes('"compact_boundary"');
    const named = !usage && !compact && line.includes('"agent-name"');
    if (!usage && !compact && !named) continue;
    let d: Record<string, any>;
    try {
      d = JSON.parse(line);
    } catch {
      out.unknown++;
      continue;
    }
    if (!d || typeof d !== "object") {
      out.unknown++;
      continue;
    }
    if (d.message && typeof d.message === "object") delete d.message.content; // 본문은 곧바로 버린다
    delete d.content;
    delete d.wireToolInputs;
    delete d.toolUseResult;
    const session = str(d.sessionId) ?? opts.session ?? null;
    if (named) {
      if (d.type === "agent-name" && str(d.agentName)?.trim()) out.name = d.agentName.trim();
      continue;
    }
    if (compact) {
      if (d.type !== "system" || d.subtype !== "compact_boundary") continue; // 본문 속 낱말(줄 모양이 다름)
      const t = str(d.timestamp);
      if (!session || !t || !Number.isFinite(Date.parse(t))) {
        out.unknown++;
        continue;
      }
      const m = d.compactMetadata && typeof d.compactMetadata === "object" ? d.compactMetadata : {};
      out.compactions.push({
        session,
        t,
        trigger: str(m.trigger),
        preTokens: typeof m.preTokens === "number" ? m.preTokens : null,
        postTokens: typeof m.postTokens === "number" ? m.postTokens : null,
      });
      continue;
    }
    const msg = d.message;
    // "usage" 키가 도구 결과(toolUseResult.usage) 같은 다른 곳에 있는 사용자 줄은 요청이 아니다
    if (d.type !== "assistant") {
      if (msg && typeof msg === "object" && msg.usage && d.type !== "user") out.unknown++;
      continue;
    }
    if (!msg || typeof msg !== "object" || !msg.usage || typeof msg.usage !== "object") {
      out.unknown++;
      continue;
    }
    if (msg.model === "<synthetic>") {
      out.synthetic++;
      continue;
    }
    const kinds = kindsOf(msg.usage);
    const id = str(msg.id);
    const t = str(d.timestamp);
    const model = str(msg.model);
    if (!kinds || !id || !t || !Number.isFinite(Date.parse(t)) || !model || !session) {
      out.unknown++;
      continue;
    }
    out.records.push({
      key: dedupeKey(id, str(d.requestId), session),
      session,
      sidechain: d.isSidechain === true || opts.crew === true,
      agent: opts.agent ?? null,
      t,
      model,
      ...kinds,
      stopReason: str(msg.stop_reason),
      version: str(d.version),
      effort: str(d.effort),
      speed: str(msg.usage.speed),
      geo: str(msg.usage.inference_geo),
    });
  }
  return out;
}

// 같은 요청의 사본 중 하나: CAPTAIN(non-sidechain) 사본, 다음은 토큰 합이 큰 것(스트리밍 첫 조각보다 끝난 응답), 같으면 먼저 본 것
export function better(a: FuelRecord, b: FuelRecord): FuelRecord {
  if (a.sidechain !== b.sidechain) return a.sidechain ? b : a;
  return tokenSum(b) > tokenSum(a) ? b : a;
}

// 전역 중복 제거. 넣는 순서가 같은 크기의 사본 중 주인을 정한다(먼저 쓴 파일 = 이어 받기 전 원래 세션)
export function dedupeFuel(records: Iterable<FuelRecord>, into = new Map<string, FuelRecord>()): Map<string, FuelRecord> {
  for (const r of records) {
    const had = into.get(r.key);
    into.set(r.key, had ? better(had, r) : r);
  }
  return into;
}

export function cacheHit(k: Kinds): number | null {
  const denom = k.input + k.cacheWrite5m + k.cacheWrite1h + k.cacheRead;
  return denom > 0 ? Math.round((k.cacheRead / denom) * 1000) / 1000 : null;
}

export interface TokenBurn extends Kinds {
  requests: number;
  cacheHit: number | null;
}
export interface Burn extends TokenBurn {
  cost: Cost; // FUEL COST(ATC-54), USD. 가격표에 있는 요청만
  unpriced: { requests: number; tokens: number }; // 가격표에 없어 cost에서 뺀 요청
}
export interface CrewBurn extends Burn {
  outputLowerBound: true; // 서브에이전트 줄은 응답 첫 조각(stop_reason null)만 남는 일이 많다
  nullStopShare: number | null; // stop_reason이 null인 요청의 몫
  agents: number;
  byType: Record<string, number>; // agentType → 요청 수
  maxSpawnDepth: number | null;
}
export interface SessionFuel {
  session: string;
  name: string | null;
  live: boolean;
  first: string;
  last: string;
  captain: Burn;
  crew: CrewBurn;
  total: Burn;
  models: Record<string, number>; // 모델 → 요청 수
  versions: string[];
  compactions: number;
  unknownLines: number;
  leak: LeakTotals; // FUEL LEAK(ATC-52): CAPTAIN 요청의 miss를 규칙별로
  netCost: number; // NET FUEL(ATC-54): total.cost.total − 값이 매겨진 LEAK, USD
}
export interface AircraftFuel {
  aircraft: string; // 세션 이름(대문자). REGISTRATION이면 FLEET의 AIRCRAFT
  sessions: string[];
  captain: Burn;
  crew: CrewBurn;
  total: Burn;
  models: Record<string, number>;
  leak: LeakTotals;
  netCost: number;
}
export interface FuelSummary {
  days: number;
  since: string;
  totals: { captain: Burn; crew: CrewBurn; total: Burn; leak: LeakTotals; netCost: number };
  models: Record<string, number>;
  requests: number;
  unknownLines: number;
  priceWarnings: PriceWarning[]; // 가격표에 없어 비용에서 뺀 모델(요청이 많은 순서)
  sessions: SessionFuel[];
  aircraft: AircraftFuel[];
  leakEvents: (LeakEvent & { name: string | null })[]; // 기간 안에서 큰 순서로 LEAK_EVENTS_MAX개(expectedRebuild 제외)
}

export const LEAK_EVENTS_MAX = 20;

export interface AgentMeta {
  agentType: string | null;
  spawnDepth: number | null;
}
export interface SummaryInput {
  records: Iterable<FuelRecord>; // 이미 중복을 없앤 기록
  compactions?: Compaction[];
  unknownBySession?: Map<string, number>;
  names?: Map<string, string>; // session → 이름
  live?: Set<string>;
  agents?: Map<string, AgentMeta>; // agent id → meta
  leaks?: LeakEvent[]; // findLeaks(기간 앞 요청과도 비교하도록 전체 기록으로 구한 것)
  prices?: PriceTable | null; // 없으면 모든 요청이 값 없음
  now: number;
  days: number;
}

export const addKinds = (to: Kinds, r: Kinds) => {
  for (const k of KIND_KEYS) to[k] += r[k];
};

// 요청들의 합: 토큰, 요청 수, 값이 매겨진 비용, 값 없는 요청
interface Tally {
  k: Kinds;
  n: number;
  cost: Cost;
  unpricedN: number;
  unpricedTokens: number;
}
const tally = (): Tally => ({ k: zero(), n: 0, cost: zeroCost(), unpricedN: 0, unpricedTokens: 0 });
function addRecord(t: Tally, r: FuelRecord, cost: Cost | null) {
  addKinds(t.k, r);
  t.n++;
  if (cost) addCost(t.cost, cost);
  else {
    t.unpricedN++;
    t.unpricedTokens += tokenSum(r);
  }
}
function addTally(to: Tally, from: Tally) {
  addKinds(to.k, from.k);
  to.n += from.n;
  addCost(to.cost, from.cost);
  to.unpricedN += from.unpricedN;
  to.unpricedTokens += from.unpricedTokens;
}
const costBurn = (t: Tally): Burn => ({
  ...t.k,
  requests: t.n,
  cacheHit: cacheHit(t.k),
  cost: roundCost(t.cost),
  unpriced: { requests: t.unpricedN, tokens: t.unpricedTokens },
});

class CrewAcc {
  t = tally();
  nullStop = 0;
  agents = new Set<string>();
  byType: Record<string, number> = {};
  depth: number | null = null;
  add(r: FuelRecord, cost: Cost | null, meta: Map<string, AgentMeta> | undefined) {
    addRecord(this.t, r, cost);
    if (r.stopReason === null) this.nullStop++;
    if (!r.agent) return;
    this.agents.add(r.agent);
    const m = meta?.get(r.agent);
    const type = m?.agentType ?? "unknown";
    this.byType[type] = (this.byType[type] ?? 0) + 1;
    if (m?.spawnDepth != null) this.depth = Math.max(this.depth ?? 0, m.spawnDepth);
  }
  merge(o: CrewAcc) {
    addTally(this.t, o.t);
    this.nullStop += o.nullStop;
    for (const a of o.agents) this.agents.add(a);
    for (const [t, n] of Object.entries(o.byType)) this.byType[t] = (this.byType[t] ?? 0) + n;
    if (o.depth != null) this.depth = Math.max(this.depth ?? 0, o.depth);
  }
  view(): CrewBurn {
    return {
      ...costBurn(this.t),
      outputLowerBound: true,
      nullStopShare: this.t.n ? Math.round((this.nullStop / this.t.n) * 1000) / 1000 : null,
      agents: this.agents.size,
      byType: this.byType,
      maxSpawnDepth: this.depth,
    };
  }
}

// 토큰만의 합(FLIGHT 몫·LOGBOOK fuel, F4). 비용은 붙이지 않는다 — LOGBOOK 줄 형식을 바꾸지 않으려고
export const burn = (k: Kinds, requests: number): TokenBurn => ({ ...k, requests, cacheHit: cacheHit(k) });

interface Acc {
  captain: Tally;
  crew: CrewAcc;
  models: Record<string, number>;
}
const acc = (): Acc => ({ captain: tally(), crew: new CrewAcc(), models: {} });
const totalOf = (a: Acc): Burn => {
  const t = tally();
  addTally(t, a.captain);
  addTally(t, a.crew.t);
  return costBurn(t);
};
const addModels = (to: Record<string, number>, from: Record<string, number>) => {
  for (const [m, n] of Object.entries(from)) to[m] = (to[m] ?? 0) + n;
};
// NET FUEL: 전체 비용에서 값이 매겨진 LEAK를 뺀다(LEAK는 CAPTAIN 요청에서만 나온다)
const netOf = (total: Burn, leak: LeakTotals) => Math.round((total.cost.total - leak.total.cost) * 10_000) / 10_000;

// 기간(now − days) 안의 기록을 세션·AIRCRAFT(세션 이름)별로 모은다. 많이 쓴 순서
export function summarizeFuel(input: SummaryInput): FuelSummary {
  const since = input.now - input.days * 86_400_000;
  const bySession = new Map<string, Acc & { first: string; last: string; versions: Set<string> }>();
  const all = acc();
  const warnings = new Map<string, PriceWarning>();
  for (const r of input.records) {
    if (Date.parse(r.t) < since) continue;
    let s = bySession.get(r.session);
    if (!s) bySession.set(r.session, (s = { ...acc(), first: r.t, last: r.t, versions: new Set() }));
    const rate = input.prices ? rateOf(input.prices, r) : { unpriced: "no price table" };
    const cost = "rate" in rate ? costOf(r, rate.rate) : null;
    if (!("rate" in rate)) {
      const key = `${r.model}\n${rate.unpriced}`;
      const w = warnings.get(key) ?? { model: r.model, reason: rate.unpriced, requests: 0, tokens: 0 };
      w.requests++;
      w.tokens += tokenSum(r);
      warnings.set(key, w);
    }
    for (const a of [s, all]) {
      if (r.sidechain) a.crew.add(r, cost, input.agents);
      else addRecord(a.captain, r, cost);
      a.models[r.model] = (a.models[r.model] ?? 0) + 1;
    }
    if (r.t < s.first) s.first = r.t;
    if (r.t > s.last) s.last = r.t;
    if (r.version) s.versions.add(r.version);
  }
  const leakOf = new Map<string, LeakTotals>();
  const allLeak = emptyLeaks();
  const leakEvents: FuelSummary["leakEvents"] = [];
  for (const e of input.leaks ?? []) {
    if (Date.parse(e.t) < since) continue;
    let l = leakOf.get(e.session);
    if (!l) leakOf.set(e.session, (l = emptyLeaks()));
    addLeak(l, e);
    addLeak(allLeak, e);
    if (e.rule !== "expectedRebuild") leakEvents.push({ ...e, name: input.names?.get(e.session) ?? null });
  }
  leakEvents.sort((a, b) => b.rewritten - a.rewritten || a.t.localeCompare(b.t));
  const compactions = new Map<string, number>();
  for (const c of input.compactions ?? []) {
    if (Date.parse(c.t) >= since) compactions.set(c.session, (compactions.get(c.session) ?? 0) + 1);
  }
  const sessions: SessionFuel[] = [...bySession].map(([session, a]) => {
    const total = totalOf(a);
    const leak = leakOf.get(session) ?? emptyLeaks();
    return {
      session,
      name: input.names?.get(session) ?? null,
      live: input.live?.has(session) ?? false,
      first: a.first,
      last: a.last,
      captain: costBurn(a.captain),
      crew: a.crew.view(),
      total,
      models: a.models,
      versions: [...a.versions].sort(),
      compactions: compactions.get(session) ?? 0,
      unknownLines: input.unknownBySession?.get(session) ?? 0,
      leak: roundLeaks(leak),
      netCost: netOf(total, leak),
    };
  });
  sessions.sort((x, y) => tokenSum(y.total) - tokenSum(x.total) || x.session.localeCompare(y.session));

  const byName = new Map<string, Acc & { sessions: string[]; leak: LeakTotals }>();
  for (const s of sessions) {
    if (!s.name) continue;
    const key = s.name.toUpperCase();
    let g = byName.get(key);
    if (!g) byName.set(key, (g = { ...acc(), sessions: [], leak: emptyLeaks() }));
    mergeLeaks(g.leak, leakOf.get(s.session) ?? emptyLeaks());
    const a = bySession.get(s.session)!;
    addTally(g.captain, a.captain);
    g.crew.merge(a.crew);
    addModels(g.models, a.models);
    g.sessions.push(s.session);
  }
  const aircraft: AircraftFuel[] = [...byName].map(([name, g]) => {
    const total = totalOf(g);
    return {
      aircraft: name,
      sessions: g.sessions,
      captain: costBurn(g.captain),
      crew: g.crew.view(),
      total,
      models: g.models,
      leak: roundLeaks(g.leak),
      netCost: netOf(total, g.leak),
    };
  });
  aircraft.sort((x, y) => tokenSum(y.total) - tokenSum(x.total) || x.aircraft.localeCompare(y.aircraft));

  let unknown = 0;
  for (const n of input.unknownBySession?.values() ?? []) unknown += n;
  const total = totalOf(all);
  return {
    days: input.days,
    since: new Date(since).toISOString(),
    totals: { captain: costBurn(all.captain), crew: all.crew.view(), total, leak: roundLeaks(allLeak), netCost: netOf(total, allLeak) },
    models: all.models,
    requests: all.captain.n + all.crew.t.n,
    unknownLines: unknown,
    priceWarnings: [...warnings.values()].sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model)),
    sessions,
    aircraft,
    leakEvents: leakEvents.slice(0, LEAK_EVENTS_MAX).map((e) => ({ ...e, cost: e.cost === null ? null : Math.round(e.cost * 10_000) / 10_000 })),
  };
}

function mergeLeaks(to: LeakTotals, from: LeakTotals) {
  for (const k of Object.keys(to) as (keyof LeakTotals)[]) {
    to[k].count += from[k].count;
    to[k].tokens += from[k].tokens;
    to[k].units += from[k].units;
    to[k].cost += from[k].cost;
    to[k].unpricedTokens += from[k].unpricedTokens;
  }
}

function roundLeaks(l: LeakTotals): LeakTotals {
  const out = emptyLeaks();
  mergeLeaks(out, l);
  for (const b of Object.values(out)) b.cost = Math.round(b.cost * 10_000) / 10_000;
  return out;
}
