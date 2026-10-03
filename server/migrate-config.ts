// 마이그레이션 리허설 스위치(ATC-368): AIRPORT마다 하나. `migrate.json`(상태 폴더, 원자적으로 바꿔 쓴다).
// 쓰는 것은 설정 창의 PUT /api/settings(fromThisApp)뿐이다. atcctl 명령은 없다. 켜려면 그 AIRPORT의 시험 DB(airports.json hostedDb.testProjectRef)와 토큰이 있어야 한다("live first, no shadow": 준비되면 바로 실전).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { HostedDb } from "./migration-gate.ts";

export interface MigrateConfig {
  airports: Record<string, boolean>; // AIRPORT 코드 → 켜짐
}
export const DEFAULT_MIGRATE: MigrateConfig = { airports: {} };
const FILE = () => join(config.stateDir, "migrate.json");

export function loadMigrate(file = FILE()): MigrateConfig {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { airports?: Record<string, unknown> };
    const airports: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw.airports ?? {})) if (v === true) airports[k.toUpperCase()] = true;
    return { airports };
  } catch {
    return DEFAULT_MIGRATE;
  }
}

export function saveMigrate(next: MigrateConfig, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
}

// 준비되지 않은 이유(없으면 null). 켤 수 있는지와 화면 표시가 같은 판정을 쓴다
export function notReadyWhy(db: HostedDb | null, token: string): string | null {
  if (!db) return "hostedDb가 없음(airports.json)";
  if (!db.testProjectRef) return "시험 DB가 없음(hostedDb.testProjectRef)";
  if (!token) return "마이그레이션 토큰이 없음(.env.local SUPABASE_MIGRATE_TOKEN)";
  return null;
}

export type SwitchResult = { ok: true } | { ok: false; error: string };

// 한 AIRPORT의 스위치를 바꾼다. 켜기는 준비돼 있을 때만. 끄기는 언제든
export function setMigrateAirport(airport: string, on: boolean, db: HostedDb | null, token: string, file = FILE()): SwitchResult {
  const code = airport.toUpperCase();
  if (on) {
    const why = notReadyWhy(db, token);
    if (why) return { ok: false, error: `${code}: ${why}` };
  }
  const cur = loadMigrate(file);
  const airports = { ...cur.airports };
  if (on) airports[code] = true;
  else delete airports[code];
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  saveMigrate({ airports }, file);
  return { ok: true };
}
