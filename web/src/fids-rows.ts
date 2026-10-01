// FIDS 목록·보드의 그룹 접기(ATC-316, ATC-112의 ARRIVED 상한을 모든 그룹으로). 화면 계산만 한다 — 서버는 그대로.
// 그룹(목록은 비행 단계, 보드는 상태 열)은 앞의 FIDS_GROUP_CAP개만 보이고 나머지는 개수로만 알린다.
// 단, 지금 팀이 맡았거나(AIRCRAFT) 경고가 걸린 행은 접혀도 늘 보인다 — 사람이 볼 것이 접혀 숨지 않게. 상수이고 설정이 아니다.
export const FIDS_GROUP_CAP = 5;

export interface FoldedGroup<T> {
  rows: T[]; // 보일 행(들어온 순서 그대로)
  hidden: number; // 가려진 행 수. 0이면 "more" 줄이 없다
}

// rows는 이미 그 그룹의 보일 순서로 정렬된 것. pinned(row)가 참이면 상한과 상관없이 보인다. open이면 전부.
export function foldGroup<T>(rows: readonly T[], pinned: (row: T) => boolean, open: boolean, cap = FIDS_GROUP_CAP): FoldedGroup<T> {
  if (open || rows.length <= cap) return { rows: [...rows], hidden: 0 };
  const shown = rows.filter((row, i) => i < cap || pinned(row));
  return { rows: shown, hidden: rows.length - shown.length };
}

// 한 줄 카드의 나이: now · 5m · 3h · 2d (숫자가 화면에 보이게. 툴팁에 두지 않는다)
export function shortAge(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const sec = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (sec < 45) return "now";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86_400)}d`;
}
