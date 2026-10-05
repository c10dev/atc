import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { record } from "./recorder.ts";
import { DEFAULT_MAX_AGE_MIN, parseCache, type WarmCache } from "./warm-start.ts";

// WARM START의 읽고 쓰기(ATC-539). 캐시 파일 warm-snapshot.json은 지워도 안전하다(없거나 깨졌거나 오래됐으면 보통의 콜드 스타트).
// 스위치와 최대 나이는 warm-start.json(원자적 JSON, 기본 on·10분). 스위치는 설정 창(fromThisApp)에서만 바꾼다. 표시만 하므로 오발 카운터는 없다
export type WarmStartSwitch = "off" | "on";
export const WARM_START_SWITCHES = ["off", "on"] as const;
const CACHE_FILE = () => join(config.stateDir, "warm-snapshot.json");
const SWITCH_FILE = () => join(config.stateDir, "warm-start.json");

export interface WarmStartConfig {
  mode: WarmStartSwitch;
  maxAgeMin: number;
}

export function parseWarmStartConfig(raw: unknown): WarmStartConfig {
  const r = (raw ?? {}) as { mode?: unknown; maxAgeMin?: unknown };
  const age = typeof r.maxAgeMin === "number" && Number.isFinite(r.maxAgeMin) && r.maxAgeMin >= 1 && r.maxAgeMin <= 120 ? r.maxAgeMin : DEFAULT_MAX_AGE_MIN;
  return { mode: r.mode === "off" ? "off" : "on", maxAgeMin: age };
}

export function loadWarmStartConfig(file = SWITCH_FILE()): WarmStartConfig {
  try {
    return parseWarmStartConfig(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseWarmStartConfig(null);
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveWarmStartSwitch(v: WarmStartSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const cur = loadWarmStartConfig(file);
  if (cur.mode === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...cur, mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "warm-start-mode", by, from: cur.mode, to: v });
}

// 부팅 때 한 번. 스위치가 꺼져 있거나 파일이 없거나 깨졌거나 너무 오래됐으면 null
export function readWarmCache(nowMs: number, cfg = loadWarmStartConfig(), file = CACHE_FILE()): WarmCache | null {
  if (cfg.mode === "off") return null;
  try {
    return parseCache(readFileSync(file, "utf8"), nowMs, cfg.maxAgeMin * 60_000);
  } catch {
    return null;
  }
}

// 임시 파일에 쓰고 바꿔치기(원자적). 실패해도 서버는 영향이 없다
export async function writeWarmCache(text: string, file = CACHE_FILE()) {
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    await rename(tmp, file);
  } catch {}
}
