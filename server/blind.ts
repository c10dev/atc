// blind 표본(ATC-6): 열린 카드의 약 1/5은 판정 전까지 CROSSCHECK mark를 숨긴다.
// 제안 id의 해시로 정하므로 새로고침해도 바뀌지 않는다. blind 카드의 합의율은 anchoring 점검용이다
// (전체보다 크게 낮으면 SUPERVISOR가 CROSSCHECK 한 번 클릭을 기본값처럼 따르고 있다는 뜻). 설계: docs/dispatch.md 5.6

export const BLIND_EVERY = 5; // 1/5 ≈ 20%

// FNV-1a 32비트. 작은 id 문자열에 고르게 퍼진다
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const isBlind = (id: string) => hashId(id.toUpperCase()) % BLIND_EVERY === 0;

// 게이트가 센 판정(decided) 가운데 blind로 판정한 것의 합의율. 게이트에 넣고 빼는 규칙은 gateOf가 정한다
export function blindStatsOf(decided: { status: string; blind?: boolean }[]) {
  const blind = decided.filter((p) => p.blind);
  const agreed = blind.filter((p) => p.status === "agreed" || p.status === "approved").length;
  return { decided: blind.length, agreed, agreement: blind.length ? agreed / blind.length : null };
}
