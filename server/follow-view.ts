import type { FollowBundle, FollowRow, FollowStage } from "./follow.ts";

// FOLLOW 줄을 FLIGHTS 목록과 FLIGHT 서랍이 같이 읽는 작은 조각(ATC-492). 브라우저도 불러오므로 타입만 가져오고 follow.ts 값은 끌어오지 않는다.

export const STAGE_LABEL: Record<FollowStage, string> = { todo: "Todo", proposed: "제안", approved: "승인", sent: "발송", readback: "READBACK", pr: "PR", ci: "CLEARED", landed: "착륙(ON)", deployed: "배포(IN)" };

export const clock = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 번들에 따라가는 FLIGHT의 줄. 어느 번들에도 없으면 null이라 서랍이 아무것도 그리지 않는다
export function followRowOf(bundles: readonly FollowBundle[] | undefined, key: string): FollowRow | null {
  for (const b of bundles ?? []) {
    const r = b.rows.find((x) => x.key === key);
    if (r) return r;
  }
  return null;
}

// 서랍이 보이는 단계: 이 FLIGHT에 없는 단계(na)는 뺀다
export function stagesShown(row: FollowRow): FollowStage[] {
  return (Object.keys(row.stages) as FollowStage[]).filter((s) => !row.stages[s].na); // stages는 서버가 단계 순서대로 만든다
}
