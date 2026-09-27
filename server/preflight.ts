import { FLIGHT_HOLD_CODES } from "./dispatch.ts";
import type { Op, Proposal } from "./proposals.ts";
import { composeReason } from "./reasons.ts";

// PREFLIGHT(ATC-3): FLIGHT 자체가 아직 시작할 상태가 아닌 제안은 SUPERVISOR 대기열에 올리지 않고 HELD로 보낸다.
// 걸리는 길은 둘이다: CROSSCHECK가 FLIGHT 칩으로 disagree(이 파일이 preflight op를 만든다), OCC HOLD(hold op).
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

// 열린 ASSIGN에 FLIGHT 칩 disagree mark가 있으면 PREFLIGHT HOLD op. 이미 HOLD거나
// SUPERVISOR가 대기열로 돌린 제안(requeuedAt)은 다시 잡지 않는다. wrong-aircraft·other·칩 없음은 대기열에 남는다
export function preflightOf(p: Proposal, at: string): Extract<Op, { op: "preflight" }> | null {
  const m = p.crosscheck;
  if (p.kind !== "ASSIGN" || p.status !== "proposed" || p.holdAt !== null || p.requeuedAt || !m || m.verdict !== "disagree") return null;
  const codes = flightCodesOf(m.reasonCodes);
  if (!codes.length) return null;
  return { op: "preflight", id: p.id, at, by: m.by, model: m.model, codes, reason: m.reason };
}

// 서버 tick마다: 열린 제안 중 PREFLIGHT에 걸릴 것(배포 전에 달린 mark 포함)
export const preflightOps = (proposals: Proposal[], at: string): Op[] => proposals.map((p) => preflightOf(p, at)).filter((o) => o !== null);

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
