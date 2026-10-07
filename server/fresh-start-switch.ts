import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { type FreshStartMode, type FreshStartSwitch, freshStartSwitchOf, upgradeFreshStartOnce } from "./fresh-start-auto.ts";

// 자동 FRESH START 스위치(ATC-560): 상태 폴더의 `fresh-start.json`(원자적으로 바꿔 쓴다). AIRPORT마다 off | always | over.
// 쓰는 것은 설정 창의 PUT /api/settings(fromThisApp)와 배포 뒤 첫 시작의 한 번 올리기뿐이다. atcctl 명령은 없다.
const FILE = () => join(config.stateDir, "fresh-start.json");

export function readFreshStartSwitch(file = FILE()): { sw: FreshStartSwitch; raw: unknown } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { sw: freshStartSwitchOf(null, (e as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "broken"), raw: null };
  }
  try {
    const raw = JSON.parse(text) as unknown;
    return { sw: freshStartSwitchOf(raw, "ok"), raw };
  } catch {
    return { sw: freshStartSwitchOf(null, "broken"), raw: null };
  }
}
export const loadFreshStartSwitch = (file = FILE()) => readFreshStartSwitch(file).sw;

function write(next: Record<string, unknown>, file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
}

// AIRPORT 몇 개의 값을 바꾼다. 다른 AIRPORT·default·migrated는 그대로. 깨진 파일은 덮어쓰지 않는다(SUPERVISOR가 손으로 고친다)
export function saveFreshStartAirports(changes: Record<string, FreshStartMode>, file = FILE()) {
  const { sw, raw } = readFreshStartSwitch(file);
  if (sw.source === "broken") throw new Error("fresh-start.json을 읽을 수 없음 — 손으로 고친 뒤 다시");
  const prev = sw.source === "ok" ? (raw as Record<string, unknown>) : {};
  const airports = { ...sw.airports };
  for (const [code, mode] of Object.entries(changes)) airports[code.toUpperCase()] = mode;
  write({ ...prev, airports }, file);
}

// 서버가 시작할 때 한 번(ATC-560): 열린 AIRPORT마다 always로 올리고 migrated를 남긴다. 기록이 있거나 깨진 파일이면 아무것도 하지 않는다
export function migrateFreshStartOnce(openAirports: readonly string[], now = Date.now(), file = FILE()): "migrated" | "already" | "unreadable" {
  const { sw, raw } = readFreshStartSwitch(file);
  if (sw.source === "broken") return "unreadable";
  const next = upgradeFreshStartOnce(sw, raw, openAirports, new Date(now).toISOString());
  if (!next) return "already";
  write(next, file);
  return "migrated";
}
