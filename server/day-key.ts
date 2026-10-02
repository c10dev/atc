// 서버 로컬 날짜(YYYY-MM-DD). weekStartOf와 같은 로컬 시간 기준
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
