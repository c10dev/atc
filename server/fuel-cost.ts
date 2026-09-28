import type { FuelRecord, Kinds } from "./fuel.ts";

// FUEL COST(ATC-54, docs/fuel.md 7): 설정 파일의 가격표로만 값을 매긴다. 코드에는 가격이 없다(server/fuel-prices.json,
// ~/.local/state/atc/fuel-prices.json이 모델별로 덮어쓴다). 표에 없는 모델·배수는 비용에서 빼고 경고로 남긴다(원칙 4).
// cost = (input·P_in + cacheWrite5m·w5m·P_in + cacheWrite1h·w1h·P_in + cacheRead·readMult·P_in + output·P_out) × 배수, USD

export interface ModelPrice {
  in: number; // USD / 백만 토큰
  out: number;
  readMult: number; // 캐시 읽기 = readMult × P_in
  multipliers?: Record<string, number>; // "speed:fast" 같은 이 모델만의 배수
}
export interface PriceTable {
  source: string | null;
  writeMult: { "5m": number; "1h": number };
  multipliers: Record<string, number>; // 모든 모델에 드는 배수("inferenceGeo:us" 등)
  models: Record<string, ModelPrice>;
}
export interface Cost extends Kinds {
  total: number;
}

const MTOK = 1_000_000;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function multipliersOf(v: unknown, where: string, errors: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (v === undefined) return out;
  if (!v || typeof v !== "object") {
    errors.push(`${where}.multipliers: 객체가 아님`);
    return out;
  }
  for (const [k, m] of Object.entries(v)) {
    if (num(m)) out[k] = m;
    else errors.push(`${where}.multipliers.${k}: 숫자가 아님`);
  }
  return out;
}

// 가격표 JSON → PriceTable. 잘못된 항목은 버리고 errors에 적는다(그 모델은 값 없는 모델이 된다). 표 전체가 아니면 null
export function parsePriceTable(json: unknown, errors: string[] = []): PriceTable | null {
  if (!json || typeof json !== "object") {
    errors.push("가격표가 객체가 아님");
    return null;
  }
  const j = json as Record<string, any>;
  const table: PriceTable = { source: typeof j.source === "string" ? j.source : null, writeMult: { "5m": NaN, "1h": NaN }, multipliers: {}, models: {} };
  if (j.writeMult !== undefined) {
    for (const tier of ["5m", "1h"] as const) {
      if (num(j.writeMult?.[tier])) table.writeMult[tier] = j.writeMult[tier];
      else errors.push(`writeMult.${tier}: 숫자가 아님`);
    }
  }
  table.multipliers = multipliersOf(j.multipliers, "", errors);
  if (j.models !== undefined && (!j.models || typeof j.models !== "object")) errors.push("models: 객체가 아님");
  for (const [model, p] of Object.entries((j.models ?? {}) as Record<string, any>)) {
    if (!p || !num(p.in) || !num(p.out) || !num(p.readMult)) {
      errors.push(`models.${model}: in·out·readMult가 숫자가 아님`);
      continue;
    }
    table.models[model] = { in: p.in, out: p.out, readMult: p.readMult, multipliers: multipliersOf(p.multipliers, `models.${model}`, errors) };
  }
  return table;
}

// 뒤 표가 앞 표를 모델·배수 단위로 덮어쓴다(운영 상태 폴더의 표가 저장소 표 위에)
export function mergePriceTables(...tables: (PriceTable | null)[]): PriceTable {
  const out: PriceTable = { source: null, writeMult: { "5m": NaN, "1h": NaN }, multipliers: {}, models: {} };
  for (const t of tables) {
    if (!t) continue;
    if (t.source) out.source = t.source;
    for (const tier of ["5m", "1h"] as const) if (num(t.writeMult[tier])) out.writeMult[tier] = t.writeMult[tier];
    Object.assign(out.multipliers, t.multipliers);
    Object.assign(out.models, t.models);
  }
  return out;
}

export interface Rate {
  pIn: number; // 배수를 곱한 USD / 토큰
  pOut: number;
  readMult: number;
  write5m: number;
  write1h: number;
}
export type RateOrWhy = { rate: Rate } | { unpriced: string };

type Priced = Pick<FuelRecord, "model" | "speed" | "geo">;

// 모델 이름이 표의 키와 같거나, 키 뒤에 날짜만 붙은 것(claude-haiku-4-5-20251001)만 맞춘다. 비슷한 모델로 짐작하지 않는다
export function modelPriceOf(table: PriceTable, model: string): ModelPrice | null {
  const exact = table.models[model];
  if (exact) return exact;
  const dated = /^(.*)-\d{8}$/.exec(model);
  return dated ? (table.models[dated[1]] ?? null) : null;
}

// 요청 하나의 단가. speed가 standard가 아니면 그 배수가 표에 있어야 한다. inferenceGeo는 표에 있을 때만 곱한다
export function rateOf(table: PriceTable, r: Priced): RateOrWhy {
  const p = modelPriceOf(table, r.model);
  if (!p) return { unpriced: "no price for model" };
  if (!num(table.writeMult["5m"]) || !num(table.writeMult["1h"])) return { unpriced: "no writeMult in price table" };
  let mult = 1;
  if (r.speed && r.speed !== "standard") {
    const key = `speed:${r.speed}`;
    const m = p.multipliers?.[key] ?? table.multipliers[key];
    if (m === undefined) return { unpriced: `no price for ${key}` };
    mult *= m;
  }
  if (r.geo) mult *= p.multipliers?.[`inferenceGeo:${r.geo}`] ?? table.multipliers[`inferenceGeo:${r.geo}`] ?? 1;
  return { rate: { pIn: (p.in * mult) / MTOK, pOut: (p.out * mult) / MTOK, readMult: p.readMult, write5m: table.writeMult["5m"], write1h: table.writeMult["1h"] } };
}

export function costOf(k: Kinds, rate: Rate): Cost {
  const c = {
    input: k.input * rate.pIn,
    cacheWrite5m: k.cacheWrite5m * rate.write5m * rate.pIn,
    cacheWrite1h: k.cacheWrite1h * rate.write1h * rate.pIn,
    cacheRead: k.cacheRead * rate.readMult * rate.pIn,
    output: k.output * rate.pOut,
  };
  return { ...c, total: c.input + c.cacheWrite5m + c.cacheWrite1h + c.cacheRead + c.output };
}

export const zeroCost = (): Cost => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, total: 0 });
export function addCost(to: Cost, c: Cost) {
  for (const k of ["input", "cacheWrite5m", "cacheWrite1h", "cacheRead", "output", "total"] as const) to[k] += c[k];
}
// 화면·API에는 1/10,000달러까지
export function roundCost(c: Cost): Cost {
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return { input: r(c.input), cacheWrite5m: r(c.cacheWrite5m), cacheWrite1h: r(c.cacheWrite1h), cacheRead: r(c.cacheRead), output: r(c.output), total: r(c.total) };
}

// FUEL LEAK의 값(F3): rewritten × (writeMult − readMult). 단위는 입력 단가(units, 배수 전)와 USD(cost, 배수 뒤)
export function leakPriceOf(rewritten: number, r: Priced & Pick<FuelRecord, "cacheWrite1h">, table: PriceTable | null): { units: number; cost: number } | null {
  if (!table) return null;
  const got = rateOf(table, r);
  if (!("rate" in got)) return null;
  const write = r.cacheWrite1h > 0 ? got.rate.write1h : got.rate.write5m;
  const units = rewritten * (write - got.rate.readMult);
  return { units: Math.round(units), cost: units * got.rate.pIn };
}

export interface PriceWarning {
  model: string;
  reason: string;
  requests: number;
  tokens: number;
}
