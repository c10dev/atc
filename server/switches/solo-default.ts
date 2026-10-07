import { loadRegistry } from "../airports.ts";
import { isSoloMode, type SoloMode, soloModeAt } from "../solo-default.ts";
import { soloMisfiresNow } from "../solo-default-run.ts";
import { loadSoloSwitch, saveSoloAirports } from "../solo-default-switch.ts";
import { defineSwitch } from "../switch-def.ts";

// SOLO 기본(ATC-559): solo-default.json. AIRPORT 코드 → on | off. 배포 뒤 첫 시작에 열린 AIRPORT마다 on을 적는다(없는 파일도 on, 깨진 파일은 off).
// SUPERVISOR만(이 화면 Origin), atcctl 명령 없음. 줄과 오작동 수는 화면의 SettingsAutomation이 AIRPORT마다 그린다(자료는 data)
const openAirports = () => loadRegistry().entries.filter((e) => !e.closed).map((e) => e.code.toUpperCase());

export default defineSwitch({
  key: "soloDefault",
  label: "SOLO",
  group: "operations",
  block: {
    code: "SOLO",
    label: "WAKE L·M FLIGHT는 CAPTAIN 혼자(CREW 없이)",
    windowLabel: "SOLO 기본 — WAKE L·M FLIGHT PLAN은 CAPTAIN 혼자, CREW는 WAKE H·여러 영역만(SUPERVISOR 전용)",
    words: "solo crew captain 혼자 팀원 subagent wake l m h multi-area 여러 영역 flight plan 오작동 soloDefault solo-default.json",
    searchOrder: 54.5,
  },
  default: "{}",
  risky: [],
  line: false,
  row: () => ({ label: "SOLO", env: "soloDefault", note: "" }),
  data: () => {
    const sw = loadSoloSwitch();
    return {
      source: sw.source,
      since: sw.migrated?.at ?? null,
      airports: openAirports().map((code) => ({ code, mode: soloModeAt(sw, code) })),
      misfires: soloMisfiresNow(),
    };
  },
  validate: (raw) => {
    const m = raw as Record<string, unknown>;
    if (!m || typeof m !== "object" || Array.isArray(m) || !Object.keys(m).length) return { ok: false, error: "AIRPORT 코드 → on 또는 off" };
    const open = new Set(openAirports());
    const out: Record<string, SoloMode> = {};
    for (const [code, v] of Object.entries(m)) {
      if (!open.has(code.toUpperCase())) return { ok: false, error: `${code}: 열린 AIRPORT가 아님` };
      if (!isSoloMode(v)) return { ok: false, error: `${code}: on 또는 off` };
      out[code.toUpperCase()] = v;
    }
    if (loadSoloSwitch().source === "broken") return { ok: false, error: "solo-default.json을 읽을 수 없음 — 손으로 고친 뒤 다시" };
    return { ok: true, value: out };
  },
  order: 39.7,
  applyOrder: 57.6,
  read: () => {
    const sw = loadSoloSwitch();
    return JSON.stringify(Object.fromEntries(openAirports().map((code) => [code, soloModeAt(sw, code)])));
  },
  save: (v: Record<string, SoloMode>) => saveSoloAirports(v),
  record: (v: Record<string, SoloMode>) => Object.entries(v).map(([code, mode]) => `soloDefault.${code}=${mode}`).join(", "),
});
