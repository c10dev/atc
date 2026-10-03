// Fold 머리글의 요약 글(design-language 4.3): 늘 개수나 한 줄 요약을 말한다. 순수 함수.
// summary가 있으면 그것이 먼저고, 없으면 개수(`13`, 더 있으면 `3 / 13`). 둘 다 없으면 빈 글(호출부가 개수나 요약을 주지 않은 것)
export function foldSummary({ count, total, summary }: { count?: number; total?: number; summary?: string }): string {
  if (summary) return summary;
  if (count === undefined) return "";
  if (total !== undefined && total > count) return `${count} / ${total}`;
  return String(count);
}
