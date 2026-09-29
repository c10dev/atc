import { type MccMode, mccLands } from "./mcc.ts";

// 누가 이 PR을 착륙시키나(ATC-151, docs/mcc.md "Who lands on the MCC AIRPORT"). 순수 함수.
//   mcc        — MCC AIRPORT의 PR이고 MCC 모드가 착륙시키고(land·land+rts) 등급이 auto·flagged, ESCALATE·HOLD 없음. TOWER는 LAND를 내지 않는다
//   supervisor — 같은 AIRPORT인데 user 등급, ESCALATE·HOLD, shadow·rts 모드(MCC가 착륙시키지 않음), 등급을 아직 모름. TOWER는 팀에 아무것도 보내지 않는다
//   holder     — 다른 AIRPORT는 지금 그대로: TOWER가 STAND를 쥔 팀에 LAND. 단 그 AIRPORT가 teamsMerge: false면 supervisor(ATC-154)
export type LandBy = "mcc" | "supervisor" | "holder";

export interface MccLandInfo {
  repo: string; // MCC AIRPORT의 저장소 경로(PullRequest.repo와 같은 꼴)
  mode: MccMode;
  holds: readonly number[]; // SUPERVISOR HOLD가 걸린 PR 번호
  escalated: readonly number[]; // MCC가 ESCALATE한 PR 번호(head가 바뀌어도 남는다)
  // MCC가 이미 재는 등급(deploy/landing-tier.mjs를 tierOfFiles로). head가 다르면 옛 값이라 쓰지 않는다
  tiers: ReadonlyMap<number, { head: string; tier: "auto" | "flagged" | "user" }>;
}

// teamsMerge: 이 PR의 AIRPORT가 "팀은 여기서 머지하지 않는다"로 표시됐나(ATC-154). MCC AIRPORT는 위 ATC-151 규칙이 먼저다
export function landByOf(p: { repo: string; number: number; head: string }, mcc: MccLandInfo | null, teamsMerge = true): LandBy {
  if (!mcc || p.repo !== mcc.repo) return teamsMerge ? "holder" : "supervisor";
  if (!mccLands(mcc.mode)) return "supervisor";
  if (mcc.holds.includes(p.number) || mcc.escalated.includes(p.number)) return "supervisor";
  const t = mcc.tiers.get(p.number);
  if (!t || t.head !== p.head) return "supervisor"; // 등급을 아직 모르면 팀에 LAND를 내지 않는다
  return t.tier === "user" ? "supervisor" : "mcc";
}
