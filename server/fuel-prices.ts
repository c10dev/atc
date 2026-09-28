import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { mergePriceTables, parsePriceTable, type PriceTable } from "./fuel-cost.ts";

// FUEL COST 가격표(ATC-54): 저장소의 server/fuel-prices.json 위에 운영 상태 폴더의 fuel-prices.json(있으면)을 모델 단위로 덮는다.
// 파일 크기·시각이 같으면 다시 읽지 않는다. 읽지 못한 파일과 잘못된 항목은 errors로 돌려준다(그 모델은 값 없음)
export const DEFAULT_PRICES_FILE = new URL("./fuel-prices.json", import.meta.url).pathname;
const priceCache = new Map<string, { key: string; table: PriceTable | null; errors: string[] }>();
export function readPrices(files = [DEFAULT_PRICES_FILE, join(config.stateDir, "fuel-prices.json")]) {
  const tables: (PriceTable | null)[] = [];
  const used: string[] = [];
  const errors: string[] = [];
  for (const [i, file] of files.entries()) {
    let st: { size: number; mtimeMs: number };
    try {
      st = statSync(file);
    } catch {
      if (i === 0) errors.push(`${file}: 없음`);
      continue; // 덮어쓰는 파일은 없어도 된다
    }
    const key = `${st.size}:${st.mtimeMs}`;
    let hit = priceCache.get(file);
    if (hit?.key !== key) {
      const errs: string[] = [];
      let table: PriceTable | null = null;
      try {
        table = parsePriceTable(JSON.parse(readFileSync(file, "utf8")), errs);
      } catch (e) {
        errs.push(`읽지 못함: ${(e as Error).message}`);
      }
      hit = { key, table, errors: errs.map((x) => `${file}: ${x}`) };
      priceCache.set(file, hit);
    }
    tables.push(hit.table);
    if (hit.table) used.push(file);
    errors.push(...hit.errors);
  }
  return { table: mergePriceTables(...tables), files: used, errors };
}

