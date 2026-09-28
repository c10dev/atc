// deploy/lander.mjs의 타입(서버가 기록을 접고 게이트를 보여 줄 때 쓴다)
export interface LanderReason {
  code: string;
  text: string;
}
export interface LanderEvaluate {
  t: string;
  op: "evaluate";
  pr: number;
  head: string;
  title?: string;
  tier: "auto" | "flagged" | "user";
  verdict: "would-merge" | "would-skip";
  readyExceptReview: boolean;
  reasons: LanderReason[];
  checks: { merge: boolean; test: boolean; tsc: boolean; build: boolean; note: string | null } | null;
  review: { ok: boolean; verdict: string | null; family?: string | null };
}
export interface LanderOutcome {
  t: string;
  op: "outcome";
  pr: number;
  outcome: "merged-as-is" | "merged-changed" | "closed";
  head: string;
  mergedAt: string | null;
  mergedBy: string | null;
}
export type LanderLine = LanderEvaluate | LanderOutcome;
export function foldLander(lines: LanderLine[]): { pr: number; last: LanderEvaluate | null; outcome: LanderOutcome | null }[];
export function landerGateOf(lines: LanderLine[]): {
  decided: number;
  agreed: number;
  agreement: number | null;
  refused: number;
  reviewOnly: number;
  target: { decided: number; agreement: number };
  ready: boolean;
};
