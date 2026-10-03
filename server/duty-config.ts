// duty.json(상태 폴더): DUTY 설정(ATC-220). 기본은 꺼짐. briefMaxChars는 D1의 브리프가 읽는다(duty-api.ts loadBriefMaxChars).
// 읽기는 관대하게(없거나 깨지면 기본값), 쓰기는 원자적으로. 모르는 키는 그대로 둔다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { briefDecisionsOf, briefMaxCharsOf } from "./duty-brief.ts";
import { type CharterMode, charterModeOf } from "./duty-charters.ts";

export interface DutyConfig {
  enabled: boolean;
  account: string;
  idleMin: number;
  briefMaxChars: number;
  briefDecisions: number;
  charter: CharterMode; // D5: DUTY가 만든 CHARTER REQUEST를 OCC가 읽는 정도. off(기본) · shadow · on
  l1: boolean; // D7a: DUTY STAND(duty-*)와 Linear 쓰기 길을 여는 스위치. 기본 꺼짐. 설정 → OPERATIONS → DUTY L1(ATC-349, SUPERVISOR 전용)이나 duty.json으로 바꾼다
  // REVIEW(ATC-396): 서버가 SUPERVISOR의 글 없이 DUTY 턴을 시작한다. 스위치는 SUPERVISOR만(설정 창). 기본 켜짐(live first). DUTY가 꺼져 있으면 돌지 않는다
  review: boolean;
  reviewEveryMin: number; // 정기 점검 간격
  reviewIdleMin: number; // 놀고 있는 AIRCRAFT가 일감을 두고 이만큼 이어지면 트리거
  reviewLeakMin: number; // leak이 이만큼 열려 있으면 트리거
  reviewGapMin: number; // 점검과 점검 사이 최소 간격(트리거가 몰려도)
}

export const REVIEW_DEFAULTS = { everyMin: 240, idleMin: 20, leakMin: 60, gapMin: 30 } as const;
export const REVIEW_RANGES = { everyMin: [30, 1440], idleMin: [5, 240], leakMin: [15, 1440], gapMin: [10, 240] } as const;
const reviewNum = (raw: unknown, def: number, [lo, hi]: readonly [number, number]) => (typeof raw === "number" && Number.isInteger(raw) && raw >= lo && raw <= hi ? raw : def);

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
    charter: charterModeOf(o.charter),
    l1: o.l1 === true,
    review: o.review !== false,
    reviewEveryMin: reviewNum(o.reviewEveryMin, REVIEW_DEFAULTS.everyMin, REVIEW_RANGES.everyMin),
    reviewIdleMin: reviewNum(o.reviewIdleMin, REVIEW_DEFAULTS.idleMin, REVIEW_RANGES.idleMin),
    reviewLeakMin: reviewNum(o.reviewLeakMin, REVIEW_DEFAULTS.leakMin, REVIEW_RANGES.leakMin),
    reviewGapMin: reviewNum(o.reviewGapMin, REVIEW_DEFAULTS.gapMin, REVIEW_RANGES.gapMin),
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
