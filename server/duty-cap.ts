// DUTY 컨텍스트 CAP(ATC-496, docs/duty.md): 화면의 머리줄 `context 365k/…k`가 DUTY가 실제로 도는 모델의 창과 맞게 한다. 순수.
// duty.json의 cap(토큰)이 있으면 그것, 없으면 마지막으로 본 모델 id가 `[1m]`으로 끝나면 100만, 아니면 25만(옛 고정값).
// 범위를 벗어났거나 정수가 아닌 cap은 무시하고 상태가 그렇다고 알린다(기본 규칙으로 돌아간다).

export const DUTY_CAP_PLAIN = 250_000;
export const DUTY_CAP_1M = 1_000_000;
export const DUTY_CAP_RANGE = [50_000, 1_000_000] as const;

export type DutyCapSource = "duty.json" | "model" | "default";

export const dutyCapValid = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= DUTY_CAP_RANGE[0] && v <= DUTY_CAP_RANGE[1];

export interface DutyCap {
  cap: number;
  source: DutyCapSource;
  ignored: string | null; // duty.json의 cap을 무시했으면 그 까닭(상태가 SUPERVISOR에게 보인다)
}

export function dutyCapOf(cfg: { cap?: unknown }, model: string | null): DutyCap {
  if (dutyCapValid(cfg.cap)) return { cap: cfg.cap, source: "duty.json", ignored: null };
  const set = cfg.cap !== undefined && cfg.cap !== null;
  const ignored = set ? `duty.json의 cap(${JSON.stringify(cfg.cap)})을 무시함 — ${DUTY_CAP_RANGE[0]}~${DUTY_CAP_RANGE[1]} 사이의 정수 토큰이어야 한다` : null;
  return typeof model === "string" && model.endsWith("[1m]") ? { cap: DUTY_CAP_1M, source: "model", ignored } : { cap: DUTY_CAP_PLAIN, source: "default", ignored };
}
