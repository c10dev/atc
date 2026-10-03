// 나이는 한 단위(design-language 원칙 9). 서버 home-flow.ts의 ageText와 같은 규칙: 3시간 안은 분, 이틀 안은 시간, 그 뒤는 일
export function ageText(min: number | null): string {
  if (min === null) return "—";
  if (min < 180) return `${min}m`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}
