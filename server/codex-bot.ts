// Codex 봇 식별과 지적 등급 읽기: 순수 함수라 화면 번들에 닿아도 node:를 끌어오지 않는다(ATC-339)

// Codex 자동 리뷰 봇. GraphQL(reviews)은 [bot] 없이, REST(reactions·comments)는 [bot]을 붙여 준다.
export const CODEX_BOTS = ["chatgpt-codex-connector", "chatgpt-codex-connector[bot]"];
export const isCodexBot = (login: string | null | undefined) => Boolean(login && CODEX_BOTS.includes(login));
// Codex 인라인 지적의 등급 배지(![P2 Badge](…img.shields.io/badge/P2-yellow…)). 읽지 못하면 null
export function findingSeverityOf(body: string): 0 | 1 | 2 | 3 | null {
  const m = /!\[P([0-3]) Badge\]/i.exec(body) ?? /img\.shields\.io\/badge\/P([0-3])-/i.exec(body);
  return m ? (Number(m[1]) as 0 | 1 | 2 | 3) : null;
}
