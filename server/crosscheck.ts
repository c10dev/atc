// CROSSCHECK — OCC와 다른 계열의 모델이 SHADOW 판정 대상(DISPATCH 제안, SCHEDULE 초안)에 먼저 달아 두는 예비 판정.
// 상태를 바꾸지 않는 참고 표시다(note와 같은 방식). SUPERVISOR는 한 번 클릭으로 따르거나 이유를 적고 뒤집는다.
// 게이트(20건·80%)에는 계속 사람 판정만 센다. CROSSCHECK가 사람과 얼마나 맞았는지는 따로 잰다(crosscheckRateOf).

export type CrosscheckVerdict = "agree" | "disagree";

export interface Crosscheck {
  by: string; // 표시한 세션(기본 "CROSSCHECK")
  model: string; // 표시한 모델 id. 세션이 아니라 crosscheck/.claude/settings.json의 env가 정한다. 옛 기록은 "unknown"
  verdict: CrosscheckVerdict;
  reason: string;
  at: string;
}

// 사람이 내린 판정: shadow의 agreed/disagreed, approval의 approved/rejected
export interface HumanDecision {
  verdict: CrosscheckVerdict;
  at: string;
  reason: string | null;
}

export const CROSSCHECK_REASON_MAX = 500;
const BY_MAX = 60;
const MODEL_MAX = 120;
export const UNKNOWN_MODEL = "unknown";

// 기록 한 줄(옛 기록에는 model이 없다)
export type CrosscheckLine = Omit<Crosscheck, "model"> & { model?: string };
export const markOf = (l: CrosscheckLine): Crosscheck => ({ by: l.by, model: l.model || UNKNOWN_MODEL, verdict: l.verdict, reason: l.reason, at: l.at });

export class CrosscheckError extends Error {}

// API 입력 검사. verdict는 agree|disagree, reason은 필수 500자 이내.
export function parseCrosscheck(body: Record<string, unknown>, at: string): Crosscheck {
  if (body.verdict !== "agree" && body.verdict !== "disagree") throw new CrosscheckError("verdict는 agree|disagree");
  const reason = typeof body.reason === "string" ? body.reason.trim().replace(/\s+/g, " ") : "";
  if (!reason) throw new CrosscheckError("reason(이유 한 줄)이 필요함");
  if (reason.length > CROSSCHECK_REASON_MAX) throw new CrosscheckError(`reason은 ${CROSSCHECK_REASON_MAX}자 이내 (지금 ${reason.length}자)`);
  const by = typeof body.by === "string" && body.by.trim() ? body.by.trim().slice(0, BY_MAX) : "CROSSCHECK";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, MODEL_MAX) : UNKNOWN_MODEL;
  return { by, model, verdict: body.verdict, reason, at };
}

export interface CrosscheckRate {
  marked: number;
  matched: number;
  rate: number | null;
}

// 일치율: 사람이 판정한 건 중 판정 전에 mark가 있던 건만 센다.
// agree는 agreed/approved와, disagree는 disagreed/rejected와 맞으면 일치. 전체 합계와 모델별(byModel).
export function crosscheckRateOf(items: { crosscheck: Crosscheck | null; human: HumanDecision | null }[]) {
  const marked = items.filter((x) => x.crosscheck && x.human && Date.parse(x.crosscheck.at) <= Date.parse(x.human.at));
  const rateOf = (xs: typeof marked): CrosscheckRate => {
    const matched = xs.filter((x) => x.crosscheck!.verdict === x.human!.verdict).length;
    return { marked: xs.length, matched, rate: xs.length ? matched / xs.length : null };
  };
  const models = [...new Set(marked.map((x) => x.crosscheck!.model || UNKNOWN_MODEL))].sort();
  const byModel: Record<string, CrosscheckRate> = Object.fromEntries(models.map((m) => [m, rateOf(marked.filter((x) => (x.crosscheck!.model || UNKNOWN_MODEL) === m))]));
  return { ...rateOf(marked), byModel };
}

// 보정용 예시: 최근 사람 판정(사유가 있는 것 먼저). CROSSCHECK 세션이 SUPERVISOR의 기준을 보고 맞추게 한다.
export const EXAMPLE_COUNT = 8;
export function examplesOf<T extends { human: HumanDecision | null }>(items: T[], n = EXAMPLE_COUNT): T[] {
  const decided = items.filter((x) => x.human).sort((a, b) => b.human!.at.localeCompare(a.human!.at));
  return [...decided.filter((x) => x.human!.reason), ...decided.filter((x) => !x.human!.reason)].slice(0, n);
}
