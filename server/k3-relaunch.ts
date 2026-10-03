import type { FleetProposal } from "./fleet-plan.ts";
import { launchWithFlightPromptOf } from "./fresh-start.ts";

// K3 RELAUNCH의 오작동 수(ATC-509, docs/autonomy.md 원칙 5·C9). 순수 함수만.
//   approved — 승인한 카드(실행 중·끝남·실패 모두)
//   expired  — 아무도 판정하지 않고 닫힌 카드(조건이 사라짐 포함)
//   rejected — SUPERVISOR가 반대한 카드
//   stopOnly — STOP은 됐는데 launch 카드 시한(launchCardTimeoutMin) 안에 같은 카드 id의 LAUNCH 줄(성공)이 없는 것
export interface K3RelaunchMisfires {
  approved: number;
  expired: number;
  rejected: number;
  stopOnly: { aircraft: string; proposal: string; t: string }[];
}
export interface K3RelaunchRecord {
  t: string;
  op: string;
  aircraft: string;
  proposal?: string;
  ok: boolean;
}

export function k3RelaunchMisfiresOf(input: { proposals: readonly Pick<FleetProposal, "id" | "kind" | "status" | "approval">[]; records: readonly K3RelaunchRecord[]; timeoutMin: number; now: number }): K3RelaunchMisfires {
  const cards = input.proposals.filter((p) => p.kind === "K3 RELAUNCH");
  const ids = new Set(cards.map((p) => p.id));
  const limit = input.timeoutMin * 60_000;
  const launches = input.records.filter((r) => r.op === "launch" && r.ok && r.proposal && ids.has(r.proposal));
  const stopOnly = input.records
    .filter((r) => r.op === "stop" && r.ok && r.proposal && ids.has(r.proposal))
    .filter((st) => {
      const at = Date.parse(st.t);
      if (launches.some((l) => l.proposal === st.proposal && Date.parse(l.t) >= at && Date.parse(l.t) - at <= limit)) return false;
      return input.now - at > limit; // 시한이 아직 안 지났으면 기다리는 중이다
    })
    .map((st) => ({ aircraft: st.aircraft, proposal: st.proposal!, t: st.t }));
  return {
    approved: cards.filter((p) => p.approval !== null).length,
    expired: cards.filter((p) => p.status === "expired").length,
    rejected: cards.filter((p) => p.status === "disagreed").length,
    stopOnly,
  };
}

// 새로 띄운 세션에 FLIGHT를 넘기는 옵션(ATC-509). allow만 받고 FLIGHT를 못 받으면 DISPATCH도 라이브 세션은 K3 FLIGHT에 짝지우지 않아(pairsOf: launch 카드만) 같은 STOP·LAUNCH를 되풀이한다.
// FLEET LAUNCH 라우트와 같은 길: 첫 프롬프트 = CREW BRIEFING + DIRECT 지시서
export const k3RelaunchLaunchOptionsOf = (flight: string, brief: string) => ({ flight, promptOf: (briefing: string) => launchWithFlightPromptOf(briefing, brief) });
