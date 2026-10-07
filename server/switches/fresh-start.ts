import { loadRegistry } from "../airports.ts";
import { FRESH_START_OVER_MARGIN, type FreshStartMode, freshStartModeAt, isFreshStartMode } from "../fresh-start-auto.ts";
import { freshStartMisfiresNow } from "../fresh-start-run.ts";
import { loadFreshStartSwitch, saveFreshStartAirports } from "../fresh-start-switch.ts";
import { defineSwitch } from "../switch-def.ts";

// 자동 FRESH START(ATC-560): fresh-start.json. AIRPORT 코드 → off | always | over. 배포 뒤 첫 시작에 열린 AIRPORT마다 always로 올린다(없거나 깨진 파일은 off).
// SUPERVISOR만(이 화면 Origin), atcctl 명령 없음. 줄과 오작동 수는 화면의 SettingsAutomation이 AIRPORT마다 그린다(자료는 data)
export default defineSwitch({
  key: "freshStart",
  label: "FRESH START",
  group: "operations",
  block: {
    code: "FRESH START",
    label: "새 FLIGHT마다 세션을 새로 띄우기",
    windowLabel: "자동 FRESH START — 이미 FLIGHT를 날은 세션을 새로 띄워 배정(SUPERVISOR 전용)",
    words: "fresh start 자동 새 세션 restart stop launch 대화 context always over off 오작동 freshStart fresh-start.json",
    searchOrder: 54,
  },
  default: "{}",
  risky: [],
  line: false,
  row: () => ({ label: "FRESH START", env: "freshStart", note: "" }),
  data: () => {
    const sw = loadFreshStartSwitch();
    const airports = loadRegistry().entries.filter((e) => !e.closed).map((e) => e.code.toUpperCase());
    return {
      source: sw.source,
      margin: FRESH_START_OVER_MARGIN,
      airports: airports.map((code) => ({ code, mode: freshStartModeAt(sw, code) })),
      misfires: freshStartMisfiresNow(),
    };
  },
  validate: (raw) => {
    const m = raw as Record<string, unknown>;
    if (!m || typeof m !== "object" || Array.isArray(m) || !Object.keys(m).length) return { ok: false, error: "AIRPORT 코드 → off, always 또는 over" };
    const open = new Set(loadRegistry().entries.filter((e) => !e.closed).map((e) => e.code.toUpperCase()));
    const out: Record<string, FreshStartMode> = {};
    for (const [code, v] of Object.entries(m)) {
      if (!open.has(code.toUpperCase())) return { ok: false, error: `${code}: 열린 AIRPORT가 아님` };
      if (!isFreshStartMode(v)) return { ok: false, error: `${code}: off, always 또는 over` };
      out[code.toUpperCase()] = v;
    }
    if (loadFreshStartSwitch().source === "broken") return { ok: false, error: "fresh-start.json을 읽을 수 없음 — 손으로 고친 뒤 다시" };
    return { ok: true, value: out };
  },
  order: 39.6,
  applyOrder: 57.5,
  read: () => {
    const sw = loadFreshStartSwitch();
    return JSON.stringify(Object.fromEntries(loadRegistry().entries.filter((e) => !e.closed).map((e) => [e.code.toUpperCase(), freshStartModeAt(sw, e.code)])));
  },
  save: (v: Record<string, FreshStartMode>) => saveFreshStartAirports(v),
  record: (v: Record<string, FreshStartMode>) => Object.entries(v).map(([code, mode]) => `freshStart.${code}=${mode}`).join(", "),
});
