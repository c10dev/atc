import type { CrewMember } from "./crew.ts";
import type { AgentMeta, FuelRecord } from "./fuel.ts";

// CREW 경고(ATC-57, docs/fuel.md 5): 서브에이전트 사용에서 보이는 낭비 신호. 보여 주기만 하고 LEAK에 넣지 않는다.
// 요청 기록(숫자·모델·시각)과 agent-*.meta.json의 agentType·spawnDepth, FLEET의 COMPLEMENT 선언만 본다. 본문은 읽지 않는다.
// 문턱은 설계의 제안값이다(docs/fuel.md 5에 잰 분포).

export type CrewWarningKind =
  | "heavyPrefix"
  | "trivialDelegation"
  | "highCrewShare"
  | "deepNesting"
  | "expensiveReadOnly"
  | "coldCrew"
  | "complementDrift";
export const CREW_WARNING_KINDS: CrewWarningKind[] = [
  "heavyPrefix",
  "trivialDelegation",
  "highCrewShare",
  "deepNesting",
  "expensiveReadOnly",
  "coldCrew",
  "complementDrift",
];

export const HEAVY_PREFIX_TOKENS = 30_000; // 첫 CREW 요청이 캐시에 쓴 것
export const TRIVIAL_PREFIX_SHARE = 0.5; // 첫 요청 프롬프트가 그 서브에이전트 입력 전체에서 차지하는 몫
export const TRIVIAL_MAX_TURNS = 3;
export const HIGH_CREW_SHARE = 0.5; // FLIGHT 토큰 중 CREW 몫
export const DEEP_NESTING_DEPTH = 2; // spawnDepth
export const READ_ONLY_TYPES = ["Explore", "Plan"];
export const COLD_CREW_MS = 5 * 60_000; // CREW는 5m 층으로 쓴다(docs/fuel.md 8.1)

export interface CrewWarning {
  kind: CrewWarningKind;
  session: string;
  agent: string | null; // highCrewShare는 null
  agentType: string | null;
  t: string; // 경고가 가리키는 요청(highCrewShare는 FLIGHT의 마지막 요청)
  value: number; // 종류마다: 토큰, 몫, 깊이, 쉰 ms
  detail: string | null; // complementDrift: "general-purpose: declared claude-opus-5-5, actual claude-sonnet-5"
}
export type CrewWarningCounts = Record<CrewWarningKind, number>;
export const emptyWarnings = (): CrewWarningCounts => Object.fromEntries(CREW_WARNING_KINDS.map((k) => [k, 0])) as CrewWarningCounts;

const promptOf = (r: FuelRecord) => r.input + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead;
const GENERIC = new Set(["general-purpose", "claude"]);
const FAMILY = /(opus|sonnet|haiku|fable|deepseek|muse|gpt|glm)/i;

// 서브에이전트마다 가장 많이 답한 모델(같으면 먼저 본 것). COMPLEMENT DRIFT와 crew-observed.ts가 쓴다
export function agentModels(records: Iterable<FuelRecord>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of records) {
    if (!r.sidechain || !r.agent) continue;
    let m = counts.get(r.agent);
    if (!m) counts.set(r.agent, (m = new Map()));
    m.set(r.model, (m.get(r.model) ?? 0) + 1);
  }
  return new Map([...counts].map(([a, m]) => [a, [...m].sort((x, y) => y[1] - x[1])[0][0]]));
}

// 모델 이름을 비교할 모양으로: 프록시 접두어(claude-ocx-…--, opencode-go/)를 떼고 글자·숫자만
export const normModel = (m: string) =>
  m
    .toLowerCase()
    .replace(/^claude-ocx-[a-z0-9-]*?--/, "")
    .replace(/^[a-z0-9-]+\//, "")
    .replace(/[^a-z0-9]/g, "");

// 선언한 agent가 모델 이름일 때만 견준다(ui-builder 같은 agent 타입 이름은 모델을 말하지 않는다)
export function declaresModel(agent: string): boolean {
  return FAMILY.test(agent) && /\d/.test(agent);
}
export function sameModel(declared: string, actual: string): boolean {
  const d = normModel(declared);
  const a = normModel(actual);
  return a.includes(d) || d.includes(a);
}

// COMPLEMENT DRIFT: 선언과 실제 message.model이 어긋남. 선언이 없거나 모델을 말하지 않으면 판단하지 않는다(null).
// - agentType이 POSITION이나 agent 이름과 같고 그 선언이 모델이면, 실제 모델과 다를 때
// - general-purpose·claude는 실제 모델과 같은 모델을 선언한 POSITION이 없을 때
export function driftOf(agentType: string, actual: string, complement: CrewMember[] | null): string | null {
  if (!complement?.length) return null;
  const t = agentType.toLowerCase();
  const direct = complement.find((m) => m.position.toLowerCase() === t || m.agent.toLowerCase() === t);
  if (direct) {
    if (!declaresModel(direct.agent) || sameModel(direct.agent, actual)) return null;
    return `${agentType}: declared ${direct.agent}, actual ${actual}`;
  }
  if (!GENERIC.has(t)) return null;
  const models = complement.filter((m) => declaresModel(m.agent));
  if (!models.length || models.some((m) => sameModel(m.agent, actual))) return null;
  return `${agentType}: no POSITION declares ${actual}`;
}

export interface AgentInput {
  records: FuelRecord[]; // 한 서브에이전트의 요청(시각 순)
  meta: AgentMeta | null;
  complement: CrewMember[] | null; // 이 세션 AIRCRAFT의 COMPLEMENT(모르면 null)
}

// 서브에이전트 하나의 경고. highCrewShare는 FLIGHT 단위라 flightWarning이 낸다
export function agentWarnings({ records, meta, complement }: AgentInput): CrewWarning[] {
  if (!records.length) return [];
  const first = records[0];
  const agentType = meta?.agentType ?? null;
  const base = { session: first.session, agent: first.agent, agentType, detail: null };
  const out: CrewWarning[] = [];
  const firstWrite = first.cacheWrite5m + first.cacheWrite1h;
  if (firstWrite > HEAVY_PREFIX_TOKENS) out.push({ ...base, kind: "heavyPrefix", t: first.t, value: firstWrite });
  const total = records.reduce((a, r) => a + promptOf(r), 0);
  const share = total ? promptOf(first) / total : 0;
  if (records.length <= TRIVIAL_MAX_TURNS && share > TRIVIAL_PREFIX_SHARE) out.push({ ...base, kind: "trivialDelegation", t: first.t, value: Math.round(share * 1000) / 1000 });
  if (meta?.spawnDepth != null && meta.spawnDepth >= DEEP_NESTING_DEPTH) out.push({ ...base, kind: "deepNesting", t: first.t, value: meta.spawnDepth });
  const opus = records.find((r) => /opus/i.test(r.model));
  if (agentType && READ_ONLY_TYPES.includes(agentType) && opus) out.push({ ...base, kind: "expensiveReadOnly", t: opus.t, value: records.filter((r) => /opus/i.test(r.model)).length });
  for (let i = 1; i < records.length; i++) {
    const gap = Date.parse(records[i].t) - Date.parse(records[i - 1].t);
    if (gap > COLD_CREW_MS) out.push({ ...base, kind: "coldCrew", t: records[i].t, value: gap });
  }
  const actual = agentModels(records).get(first.agent ?? "");
  const drift = agentType && actual ? driftOf(agentType, actual, complement) : null;
  if (drift) out.push({ ...base, kind: "complementDrift", t: first.t, value: 1, detail: drift });
  return out;
}

export interface CrewWarningInput {
  records: Iterable<FuelRecord>; // 중복을 없앤 기록(CAPTAIN이 섞여도 된다)
  agents: Map<string, AgentMeta>;
  complementOf: (session: string) => CrewMember[] | null;
}

// 모든 서브에이전트의 경고(시각 순)
export function crewWarnings(input: CrewWarningInput): CrewWarning[] {
  const byAgent = new Map<string, FuelRecord[]>();
  for (const r of input.records) {
    if (!r.sidechain || !r.agent) continue;
    const k = `${r.session}\u0000${r.agent}`;
    let list = byAgent.get(k);
    if (!list) byAgent.set(k, (list = []));
    list.push(r);
  }
  const out: CrewWarning[] = [];
  for (const list of byAgent.values()) {
    list.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    out.push(...agentWarnings({ records: list, meta: input.agents.get(list[0].agent!) ?? null, complement: input.complementOf(list[0].session) }));
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

const tokens = (k: { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number }) =>
  k.input + k.cacheWrite5m + k.cacheWrite1h + k.cacheRead + k.output;

// HIGH CREW SHARE: FLIGHT 토큰 중 CREW 몫이 문턱을 넘으면 몫(0~1), 아니면 null
export function crewShareOf(captain: Parameters<typeof tokens>[0], crew: Parameters<typeof tokens>[0]): number | null {
  const all = tokens(captain) + tokens(crew);
  if (!all) return null;
  const share = tokens(crew) / all;
  return share > HIGH_CREW_SHARE ? Math.round(share * 1000) / 1000 : null;
}

export function countWarnings(ws: Iterable<Pick<CrewWarning, "kind">>, into = emptyWarnings()): CrewWarningCounts {
  for (const w of ws) into[w.kind]++;
  return into;
}
