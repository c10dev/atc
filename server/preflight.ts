import { FLIGHT_HOLD_CODES } from "./dispatch.ts";
import type { Proposal } from "./proposals.ts";
import { composeReason } from "./reasons.ts";

// PREFLIGHT(ATC-3): FLIGHT 자체가 아직 시작할 상태가 아닌 제안은 SUPERVISOR 대기열에 올리지 않고 HELD로 보낸다.
// 걸리는 길은 OCC HOLD(hold op)다. CROSSCHECK가 FLIGHT 칩으로 disagree해 서버가 걸던 길은 CROSSCHECK 은퇴로 닫혔다(ATC-371). 옛 preflight 줄은 기록으로 읽힌다.
// HELD 제안은 판정하지 않는다 — SUPERVISOR는 대기열로 돌리거나(requeue) FLIGHT 보류를 확정한다(confirm-hold).
// 설계는 docs/dispatch.md 6.2.

export interface Preflight {
  at: string;
  by: string; // mark를 단 쪽(CROSSCHECK)
  model: string; // mark의 모델(전체 이름, 표시는 계열)
  codes: string[]; // FLIGHT 칩만
  reason: string; // mark의 이유 한 줄
}

// 사유 칩 중 FLIGHT 자체의 문제인 것(#56의 FLIGHT 보류 칩)
export const flightCodesOf = (codes: readonly string[] | undefined): string[] =>
  (codes ?? []).filter((c) => (FLIGHT_HOLD_CODES as readonly string[]).includes(c));

// FLIGHT 보류 확정에 쓸 칩: PREFLIGHT의 칩 → HOLD 전에 달린 CROSSCHECK mark의 FLIGHT 칩 → 선행 없는 OCC HOLD는 needs-human
// (선행 없는 HOLD는 정의상 "사람 결정·외부 입력 대기"다. 이유 문장에서 칩을 추정하지 않는다)
export function confirmCodesOf(p: Pick<Proposal, "preflight" | "crosscheck">): string[] {
  if (p.preflight?.codes.length) return p.preflight.codes;
  const marked = flightCodesOf(p.crosscheck?.verdict === "disagree" ? p.crosscheck.reasonCodes : []);
  return marked.length ? marked : ["needs-human"];
}

// 확정 기록의 사유: "<칩> — PREFLIGHT 확정 · <누가>: <이유>"
export function confirmReasonOf(p: Pick<Proposal, "preflight" | "note">, codes: string[]): string {
  const src = p.preflight ? `CROSSCHECK: ${p.preflight.reason}` : `OCC HOLD${p.note ? `: ${p.note}` : ""}`;
  const memo = `PREFLIGHT 확정 · ${src}`;
  return composeReason(codes, memo) ?? memo;
}
