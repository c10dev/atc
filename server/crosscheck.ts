import { parseReasonCodes, type ReasonCode, ReasonCodeError } from "./reasons.ts";

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
  reasonCodes?: string[]; // DISPATCH disagree의 거절 사유 칩(server/reasons.ts). 옛 mark에는 없다 — 이유 문장에서 추정하지 않는다
}

// 판정을 어떻게 내렸나: "CROSSCHECK에 동의" 한 번 클릭(crosscheck) 또는 직접 고름(manual).
// 옛 기록에는 없다(undefined 그대로 — 채워 넣지 않는다).
// "atfm"은 3단계 자동 판정이다(서버 안에서만 붙인다). 모든 사람 판정 점검과 일치율에서 뺀다(docs/atfm.md 원칙 2).
export type Via = "crosscheck" | "manual" | "atfm";
// API 입력: "crosscheck"만 그대로, 나머지(없음·"atfm" 포함)는 manual — 밖에서 atfm이라고 적을 수 없다
export const viaOf = (body: { via?: unknown }): Via => (body.via === "crosscheck" ? "crosscheck" : "manual");

// 사람이 내린 판정: shadow의 agreed/disagreed, approval의 approved/rejected
export interface HumanDecision {
  verdict: CrosscheckVerdict;
  at: string;
  reason: string | null;
  via?: Via; // 옛 기록에는 없다
}

export const CROSSCHECK_REASON_MAX = 500;
const BY_MAX = 60;
const MODEL_MAX = 120;
export const UNKNOWN_MODEL = "unknown";

// 기록 한 줄(옛 기록에는 model이 없다)
export type CrosscheckLine = Omit<Crosscheck, "model"> & { model?: string };
// 모델 계열: 경로 접두어(claude-ocx-opencode-go--, claude-ocx-native--)와 [1m] 같은 접미어, -contributor를 뗀다.
// 같은 모델이 경로(ocx, ClaudeRipple)마다 다른 이름으로 기록되므로 집계·표시는 계열로 한다. 기록(mark의 model)은 그대로 둔다.
// claude-ocx-opencode-go--muse-spark-1.3-contributor[1m] → muse-spark-1.3, claude-ocx-native--gpt-5.6-terra → gpt-5.6-terra
export function modelFamily(model: string | null | undefined): string {
  const raw = String(model ?? "").trim().toLowerCase();
  if (!raw || raw === UNKNOWN_MODEL) return UNKNOWN_MODEL;
  const s = raw.slice(raw.lastIndexOf("--") >= 0 ? raw.lastIndexOf("--") + 2 : 0).replace(/\[[^\]]*\]$/, "").replace(/-contributor$/, "");
  return s || raw;
}

export const markOf = (l: CrosscheckLine): Crosscheck => ({
  by: l.by,
  model: l.model || UNKNOWN_MODEL,
  verdict: l.verdict,
  reason: l.reason,
  at: l.at,
  ...(l.reasonCodes?.length ? { reasonCodes: l.reasonCodes } : {}),
});

export class CrosscheckError extends Error {}

// API 입력 검사. verdict는 agree|disagree, reason은 필수 500자 이내.
// reasonCodes는 DISPATCH disagree에서만(codes에 거절 사유 칩 목록을 넘긴 경우). SCHEDULE은 칩이 달라 받지 않는다.
export function parseCrosscheck(body: Record<string, unknown>, at: string, codes?: readonly ReasonCode[]): Crosscheck {
  if (body.verdict !== "agree" && body.verdict !== "disagree") throw new CrosscheckError("verdict는 agree|disagree");
  const reason = typeof body.reason === "string" ? body.reason.trim().replace(/\s+/g, " ") : "";
  if (!reason) throw new CrosscheckError("reason(이유 한 줄)이 필요함");
  if (reason.length > CROSSCHECK_REASON_MAX) throw new CrosscheckError(`reason은 ${CROSSCHECK_REASON_MAX}자 이내 (지금 ${reason.length}자)`);
  const by = typeof body.by === "string" && body.by.trim() ? body.by.trim().slice(0, BY_MAX) : "CROSSCHECK";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, MODEL_MAX) : UNKNOWN_MODEL;
  let reasonCodes: string[] = [];
  if (body.reasonCodes != null) {
    if (!codes) throw new CrosscheckError("reasonCodes(사유 칩)는 DISPATCH 제안에만");
    if (body.verdict !== "disagree") throw new CrosscheckError("reasonCodes(사유 칩)는 disagree에만");
    try {
      reasonCodes = parseReasonCodes(body.reasonCodes, codes);
    } catch (e) {
      if (e instanceof ReasonCodeError) throw new CrosscheckError(e.message);
      throw e;
    }
  }
  return { by, model, verdict: body.verdict, reason, at, ...(reasonCodes.length ? { reasonCodes } : {}) };
}

export interface CrosscheckRate {
  marked: number;
  matched: number;
  rate: number | null;
}

// 일치율: 사람이 판정한 건 중 판정 전에 mark가 있던 건만 센다.
// agree는 agreed/approved와, disagree는 disagreed/rejected와 맞으면 일치. 전체 합계와 모델 계열별(byModel, 키는 modelFamily).
export function crosscheckRateOf(items: { crosscheck: Crosscheck | null; human: HumanDecision | null }[]) {
  const marked = items.filter((x) => x.crosscheck && x.human && Date.parse(x.crosscheck.at) <= Date.parse(x.human.at));
  const rateOf = (xs: typeof marked): CrosscheckRate => {
    const matched = xs.filter((x) => x.crosscheck!.verdict === x.human!.verdict).length;
    return { marked: xs.length, matched, rate: xs.length ? matched / xs.length : null };
  };
  const familyOf = (x: (typeof marked)[number]) => modelFamily(x.crosscheck!.model);
  const families = [...new Set(marked.map(familyOf))].sort();
  const byModel: Record<string, CrosscheckRate> = Object.fromEntries(families.map((f) => [f, rateOf(marked.filter((x) => familyOf(x) === f))]));
  return { ...rateOf(marked), byModel };
}

// 한 번 클릭 판정 비율의 재료: 한 번 클릭이 가능했던 사람 판정(decided — 판정 전에 mark가 있었고 via가 기록됨) 중
// CROSSCHECK에 동의로 내린 것(count). via 없는 옛 판정은 뺀다. CROSSCHECK를 따르는 습관이 게이트를 부풀리는지 본다.
export function oneClickOf(items: { crosscheck: Crosscheck | null; human: HumanDecision | null }[]) {
  const recorded = items.filter((x) => x.crosscheck && x.human?.via && Date.parse(x.crosscheck.at) <= Date.parse(x.human.at));
  return { count: recorded.filter((x) => x.human!.via === "crosscheck").length, decided: recorded.length };
}

// 보정용 예시: 최근 사람 판정(사유가 있는 것 먼저). CROSSCHECK 세션이 SUPERVISOR의 기준을 보고 맞추게 한다.
export const EXAMPLE_COUNT = 8;
export function examplesOf<T extends { human: HumanDecision | null }>(items: T[], n = EXAMPLE_COUNT): T[] {
  const decided = items.filter((x) => x.human).sort((a, b) => b.human!.at.localeCompare(a.human!.at));
  return [...decided.filter((x) => x.human!.reason), ...decided.filter((x) => !x.human!.reason)].slice(0, n);
}
