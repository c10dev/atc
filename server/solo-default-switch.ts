import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { type SoloMode, type SoloSwitch, soloModeAt, soloSwitchOf, upgradeSoloOnce } from "./solo-default.ts";

// SOLO 기본 스위치(ATC-559): 상태 폴더의 `solo-default.json`(원자적으로 바꿔 쓴다). AIRPORT마다 on | off.
// 쓰는 것은 설정 창의 PUT /api/settings(fromThisApp)와 배포 뒤 첫 시작의 한 번 올리기뿐이다. atcctl 명령은 없다.
const FILE = () => join(config.stateDir, "solo-default.json");

export function readSoloSwitch(file = FILE()): { sw: SoloSwitch; raw: unknown } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { sw: soloSwitchOf(null, (e as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "broken"), raw: null };
  }
  try {
    const raw = JSON.parse(text) as unknown;
    return { sw: soloSwitchOf(raw, "ok"), raw };
  } catch {
    return { sw: soloSwitchOf(null, "broken"), raw: null };
  }
}
export const loadSoloSwitch = (file = FILE()) => readSoloSwitch(file).sw;
// 이 AIRPORT의 FLIGHT PLAN에 SOLO·CREW 줄을 넣나
export const soloOnAt = (airport: string | null | undefined, file = FILE()) => soloModeAt(loadSoloSwitch(file), airport) === "on";

function write(next: Record<string, unknown>, file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
}

// AIRPORT 몇 개의 값을 바꾼다. 다른 AIRPORT·default·migrated는 그대로. 깨진 파일은 덮어쓰지 않는다(SUPERVISOR가 손으로 고친다)
export function saveSoloAirports(changes: Record<string, SoloMode>, file = FILE()) {
  const { sw, raw } = readSoloSwitch(file);
  if (sw.source === "broken") throw new Error("solo-default.json을 읽을 수 없음 — 손으로 고친 뒤 다시");
  const prev = sw.source === "ok" ? (raw as Record<string, unknown>) : {};
  const airports = { ...sw.airports };
  for (const [code, mode] of Object.entries(changes)) airports[code.toUpperCase()] = mode;
  write({ ...prev, airports }, file);
}

// 서버가 시작할 때 한 번(ATC-559): 열린 AIRPORT마다 on으로 적고 migrated(배포 시각)를 남긴다. 기록이 있거나 깨진 파일이면 아무것도 하지 않는다
export function migrateSoloOnce(openAirports: readonly string[], now = Date.now(), file = FILE()): "migrated" | "already" | "unreadable" {
  const { sw, raw } = readSoloSwitch(file);
  if (sw.source === "broken") return "unreadable";
  const next = upgradeSoloOnce(sw, raw, openAirports, new Date(now).toISOString());
  if (!next) return "already";
  write(next, file);
  return "migrated";
}
