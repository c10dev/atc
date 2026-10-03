import { config } from "../config.ts";
import { hostedDbOfAirport, loadRegistry } from "../airports.ts";
import { loadMigrate, notReadyWhy, setMigrateAirport } from "../migrate-config.ts";
import { defineSwitch } from "../switch-def.ts";

type Change = { code: string; on: boolean; db: ReturnType<typeof hostedDbOfAirport> };

// 마이그레이션 리허설(ATC-368, K1·K2): migrate.json. AIRPORT 코드 → 켜짐. 켜기는 시험 DB와 토큰이 준비된 AIRPORT만. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음.
// 줄은 화면의 SettingsAutomation이 AIRPORT마다 그린다(자료는 data)
export default defineSwitch({
  key: "migrateRehearsal",
  label: "MIGRATE REHEARSAL",
  group: "landing",
  block: { code: "MIGRATE", label: "마이그레이션 리허설", windowLabel: "마이그레이션 리허설(SUPERVISOR 전용)", words: "migrate 마이그레이션 리허설 hostedDb 시험 DB PITR migrateRehearsal", searchOrder: 34 },
  default: "{}",
  risky: [],
  line: false,
  row: () => ({ label: "MIGRATE", env: "migrate", note: "" }),
  data: () => ({
    tokenSet: Boolean(config.supabaseMigrateToken),
    airports: loadRegistry()
      .entries.filter((e) => !e.closed && hostedDbOfAirport(e.path))
      .map((e) => ({ code: e.code, enabled: loadMigrate().airports[e.code.toUpperCase()] === true, why: notReadyWhy(hostedDbOfAirport(e.path), config.supabaseMigrateToken) })),
  }),
  validate: (raw) => {
    const m = raw as Record<string, unknown>;
    if (!m || typeof m !== "object" || Array.isArray(m) || !Object.keys(m).length || Object.values(m).some((v) => typeof v !== "boolean")) return { ok: false, error: "AIRPORT 코드 → true 또는 false" };
    const entries = loadRegistry().entries.filter((e) => !e.closed);
    const changes: Change[] = [];
    for (const [code, on] of Object.entries(m)) {
      const e = entries.find((x) => x.code.toUpperCase() === code.toUpperCase());
      const db = e ? hostedDbOfAirport(e.path) : null;
      if (!e || !db) return { ok: false, error: `${code}: hostedDb가 있는 AIRPORT가 아님` };
      if (on === true && notReadyWhy(db, config.supabaseMigrateToken)) return { ok: false, error: `${code}: ${notReadyWhy(db, config.supabaseMigrateToken)}` };
      changes.push({ code, on: on as boolean, db });
    }
    return { ok: true, value: changes };
  },
  order: 34,
  applyOrder: 155,
  read: () => JSON.stringify(loadMigrate().airports),
  save: (v: Change[]) => {
    for (const ch of v) setMigrateAirport(ch.code, ch.on, ch.db, config.supabaseMigrateToken);
  },
  record: (v: Change[]) => v.map((m) => `migrate.${m.code}=${m.on ? "on" : "off"}`).join(", "),
});
