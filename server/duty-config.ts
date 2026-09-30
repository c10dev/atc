// duty.json(상태 폴더): DUTY 설정(ATC-220). 기본은 꺼짐. briefMaxChars는 D1의 브리프가 읽는다(duty-api.ts loadBriefMaxChars).
// 읽기는 관대하게(없거나 깨지면 기본값), 쓰기는 원자적으로. 모르는 키는 그대로 둔다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { briefDecisionsOf, briefMaxCharsOf } from "./duty-brief.ts";

export interface DutyConfig {
  enabled: boolean;
  account: string;
  idleMin: number;
  briefMaxChars: number;
  briefDecisions: number;
}

export const DEFAULT_ACCOUNT = "acct-2";
export const DEFAULT_IDLE_MIN = 30;
export const IDLE_MIN_RANGE = [1, 720] as const;

export const dutyConfigFile = () => join(config.stateDir, "duty.json");

export function idleMinOf(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= IDLE_MIN_RANGE[0] && raw <= IDLE_MIN_RANGE[1] ? raw : DEFAULT_IDLE_MIN;
}

export function parseDutyConfig(raw: unknown): DutyConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    enabled: o.enabled === true,
    account: typeof o.account === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(o.account) ? o.account : DEFAULT_ACCOUNT,
    idleMin: idleMinOf(o.idleMin),
    briefMaxChars: briefMaxCharsOf(o.briefMaxChars),
    briefDecisions: briefDecisionsOf(o.briefDecisions),
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export const loadDutyConfig = (file = dutyConfigFile()): DutyConfig => parseDutyConfig(readJson(file));

export function saveDutyConfig(patch: Partial<DutyConfig>, file = dutyConfigFile()): DutyConfig {
  const user = readJson(file);
  const base = user && typeof user === "object" && !Array.isArray(user) ? (user as Record<string, unknown>) : {};
  const next = { ...base, ...patch };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
  return parseDutyConfig(next);
}
