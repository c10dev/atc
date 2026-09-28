import { countWarnings, type CrewWarning, type CrewWarningCounts, emptyWarnings } from "./fuel-crew.ts";
import { addLeak, emptyLeaks, type LeakEvent, type LeakTotals, OUTSIDE_LEAK } from "./fuel-leaks.ts";

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
  proxied?: true; // requestId가 없는 줄(프록시 경로: DeepSeek·Muse, 일부 Opus). 캐시가 Anthropic 방식이 아니다(F7)
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
      ...(str(d.requestId) ? {} : { proxied: true as const }),
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

export interface Burn extends Kinds {
  requests: number;
  cacheHit: number | null;
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
  leak: LeakTotals; // FUEL LEAK(ATC-52·57): CAPTAIN·CREW 요청의 miss를 규칙별로
  crewWarnings: CrewWarningCounts; // CREW 경고 수(ATC-57). highCrewShare는 FLIGHT 단위라 여기서는 0
}
export interface AircraftFuel {
  aircraft: string; // 세션 이름(대문자). REGISTRATION이면 FLEET의 AIRCRAFT
  sessions: string[];
  captain: Burn;
  crew: CrewBurn;
  total: Burn;
  models: Record<string, number>;
  leak: LeakTotals;
  crewWarnings: CrewWarningCounts;
}
export interface FuelSummary {
  days: number;
  since: string;
  totals: { captain: Burn; crew: CrewBurn; total: Burn; leak: LeakTotals; crewWarnings: CrewWarningCounts };
  models: Record<string, number>;
  requests: number;
  unknownLines: number;
  sessions: SessionFuel[];
  aircraft: AircraftFuel[];
  leakEvents: (LeakEvent & { name: string | null })[]; // 기간 안에서 큰 순서로 LEAK_EVENTS_MAX개(LEAK 밖인 expectedRebuild·proxied 제외)
  crewWarningEvents: (CrewWarning & { name: string | null })[]; // 기간 안에서 최근 순서로 CREW_WARNING_EVENTS_MAX개
}

export const LEAK_EVENTS_MAX = 20;
export const CREW_WARNING_EVENTS_MAX = 50;

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
  leaks?: LeakEvent[]; // findLeaks(기간 앞 요청과도 비교하도록 전체 기록으로 구한 것)와 sessionChangeLeaks
  warnings?: CrewWarning[]; // crewWarnings(fuel-crew.ts)
  now: number;
  days: number;
}

export const addKinds = (to: Kinds, r: Kinds) => {
  for (const k of KIND_KEYS) to[k] += r[k];
};

class CrewAcc {
  k = zero();
  requests = 0;
  nullStop = 0;
  agents = new Set<string>();
  byType: Record<string, number> = {};
  depth: number | null = null;
  add(r: FuelRecord, meta: Map<string, AgentMeta> | undefined) {
    addKinds(this.k, r);
    this.requests++;
    if (r.stopReason === null) this.nullStop++;
    if (!r.agent) return;
    this.agents.add(r.agent);
    const m = meta?.get(r.agent);
    const type = m?.agentType ?? "unknown";
    this.byType[type] = (this.byType[type] ?? 0) + 1;
    if (m?.spawnDepth != null) this.depth = Math.max(this.depth ?? 0, m.spawnDepth);
  }
  merge(o: CrewAcc) {
    addKinds(this.k, o.k);
    this.requests += o.requests;
    this.nullStop += o.nullStop;
    for (const a of o.agents) this.agents.add(a);
    for (const [t, n] of Object.entries(o.byType)) this.byType[t] = (this.byType[t] ?? 0) + n;
    if (o.depth != null) this.depth = Math.max(this.depth ?? 0, o.depth);
  }
  view(): CrewBurn {
    return {
      ...burn(this.k, this.requests),
      outputLowerBound: true,
      nullStopShare: this.requests ? Math.round((this.nullStop / this.requests) * 1000) / 1000 : null,
      agents: this.agents.size,
      byType: this.byType,
      maxSpawnDepth: this.depth,
    };
  }
}

export const burn = (k: Kinds, requests: number): Burn => ({ ...k, requests, cacheHit: cacheHit(k) });

interface Acc {
  captain: Kinds;
  captainN: number;
  crew: CrewAcc;
  models: Record<string, number>;
}
const acc = (): Acc => ({ captain: zero(), captainN: 0, crew: new CrewAcc(), models: {} });
const totalOf = (a: Acc): Burn => {
  const k = zero();
  addKinds(k, a.captain);
  addKinds(k, a.crew.k);
  return burn(k, a.captainN + a.crew.requests);
};
const addModels = (to: Record<string, number>, from: Record<string, number>) => {
  for (const [m, n] of Object.entries(from)) to[m] = (to[m] ?? 0) + n;
};

// 기간(now − days) 안의 기록을 세션·AIRCRAFT(세션 이름)별로 모은다. 많이 쓴 순서
export function summarizeFuel(input: SummaryInput): FuelSummary {
  const since = input.now - input.days * 86_400_000;
  const bySession = new Map<string, Acc & { first: string; last: string; versions: Set<string> }>();
  const all = acc();
  for (const r of input.records) {
    if (Date.parse(r.t) < since) continue;
    let s = bySession.get(r.session);
    if (!s) bySession.set(r.session, (s = { ...acc(), first: r.t, last: r.t, versions: new Set() }));
    for (const a of [s, all]) {
      if (r.sidechain) a.crew.add(r, input.agents);
      else {
        addKinds(a.captain, r);
        a.captainN++;
      }
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
    if (!OUTSIDE_LEAK.includes(e.rule)) leakEvents.push({ ...e, name: input.names?.get(e.session) ?? null });
  }
  const warnOf = new Map<string, CrewWarningCounts>();
  const allWarn = emptyWarnings();
  const crewWarningEvents: FuelSummary["crewWarningEvents"] = [];
  for (const w of input.warnings ?? []) {
    if (Date.parse(w.t) < since) continue;
    if (!warnOf.has(w.session)) warnOf.set(w.session, emptyWarnings());
    countWarnings([w], warnOf.get(w.session));
    countWarnings([w], allWarn);
    crewWarningEvents.push({ ...w, name: input.names?.get(w.session) ?? null });
  }
  crewWarningEvents.sort((a, b) => b.t.localeCompare(a.t));
  leakEvents.sort((a, b) => b.rewritten - a.rewritten || a.t.localeCompare(b.t));
  const compactions = new Map<string, number>();
  for (const c of input.compactions ?? []) {
    if (Date.parse(c.t) >= since) compactions.set(c.session, (compactions.get(c.session) ?? 0) + 1);
  }
  const sessions: SessionFuel[] = [...bySession].map(([session, a]) => ({
    session,
    name: input.names?.get(session) ?? null,
    live: input.live?.has(session) ?? false,
    first: a.first,
    last: a.last,
    captain: burn(a.captain, a.captainN),
    crew: a.crew.view(),
    total: totalOf(a),
    models: a.models,
    versions: [...a.versions].sort(),
    compactions: compactions.get(session) ?? 0,
    unknownLines: input.unknownBySession?.get(session) ?? 0,
    leak: leakOf.get(session) ?? emptyLeaks(),
    crewWarnings: warnOf.get(session) ?? emptyWarnings(),
  }));
  sessions.sort((x, y) => tokenSum(y.total) - tokenSum(x.total) || x.session.localeCompare(y.session));

  const byName = new Map<string, Acc & { sessions: string[]; leak: LeakTotals; crewWarnings: CrewWarningCounts }>();
  for (const s of sessions) {
    if (!s.name) continue;
    const key = s.name.toUpperCase();
    let g = byName.get(key);
    if (!g) byName.set(key, (g = { ...acc(), sessions: [], leak: emptyLeaks(), crewWarnings: emptyWarnings() }));
    mergeLeaks(g.leak, s.leak);
    for (const k of Object.keys(g.crewWarnings) as (keyof CrewWarningCounts)[]) g.crewWarnings[k] += s.crewWarnings[k];
    const a = bySession.get(s.session)!;
    addKinds(g.captain, a.captain);
    g.captainN += a.captainN;
    g.crew.merge(a.crew);
    addModels(g.models, a.models);
    g.sessions.push(s.session);
  }
  const aircraft: AircraftFuel[] = [...byName].map(([name, g]) => ({
    aircraft: name,
    sessions: g.sessions,
    captain: burn(g.captain, g.captainN),
    crew: g.crew.view(),
    total: totalOf(g),
    models: g.models,
    leak: g.leak,
    crewWarnings: g.crewWarnings,
  }));
  aircraft.sort((x, y) => tokenSum(y.total) - tokenSum(x.total) || x.aircraft.localeCompare(y.aircraft));

  let unknown = 0;
  for (const n of input.unknownBySession?.values() ?? []) unknown += n;
  return {
    days: input.days,
    since: new Date(since).toISOString(),
    totals: { captain: burn(all.captain, all.captainN), crew: all.crew.view(), total: totalOf(all), leak: allLeak, crewWarnings: allWarn },
    models: all.models,
    requests: all.captainN + all.crew.requests,
    unknownLines: unknown,
    sessions,
    aircraft,
    leakEvents: leakEvents.slice(0, LEAK_EVENTS_MAX),
    crewWarningEvents: crewWarningEvents.slice(0, CREW_WARNING_EVENTS_MAX),
  };
}

function mergeLeaks(to: LeakTotals, from: LeakTotals) {
  for (const k of Object.keys(to) as (keyof LeakTotals)[]) {
    to[k].count += from[k].count;
    to[k].tokens += from[k].tokens;
    to[k].units += from[k].units;
    to[k].unpricedTokens += from[k].unpricedTokens;
  }
}
