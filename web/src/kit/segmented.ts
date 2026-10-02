// Segmented의 화살표 키 이동(radio 그룹 규칙). 순수 함수: 다음에 선택할 칸의 번호, 처리할 키가 아니면 null.
// 양끝에서 돈다. Home·End는 처음·끝 칸.
export function nextSegment(count: number, current: number, key: string): number | null {
  if (count <= 0) return null;
  const at = current < 0 ? 0 : current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (at + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// 탭으로 들어갈 칸(roving tabindex): 선택된 칸, 없으면 첫 칸
export function tabStop(count: number, selected: number): number {
  return selected >= 0 && selected < count ? selected : count > 0 ? 0 : -1;
}
