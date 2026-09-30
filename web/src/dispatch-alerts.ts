// DISPATCH 탭이 brief를 다시 읽을 때를 알리는 키(ATC-212). 제안이 새로 생기거나 사라지면(승인·거절·CROSSCHECK 판정) 키가 바뀐다.
// items는 종류 설정(kindFilter)을 거치지 않은 전체라 설정과 상관없다. 순서와 다른 종류의 알림은 키에 영향이 없다.
const PROPOSAL_PREFIX = "pending|proposal|";

export function proposalAlertKey(items: readonly { key: string }[]): string {
  return items
    .map((a) => a.key)
    .filter((k) => k.startsWith(PROPOSAL_PREFIX))
    .sort()
    .join(",");
}
