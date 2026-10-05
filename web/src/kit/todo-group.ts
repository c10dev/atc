import type { TodoTone } from "./TodoRow.tsx";

// 할 일 묶음의 순수 계산(ATC-504, design-language 4.1·12): 같은 종류에 같은 필요인 줄은 첫 줄 자리에 한 줄로 모인다.
// 한꺼번에 하는 동작은 없다: 묶음 줄의 단추는 펼치기뿐이고 항목마다 자기 단추가 있다. HOME은 서버가 묶은 줄을 그대로 쓰고(home-todo.ts), RELEASE처럼 서버가 묶지 않는 목록은 이 함수로 묶는다.
export interface GroupSpec {
  kind: string; // 줄의 종류 태그
  need: string; // 같은 필요(같은 단추)를 말하는 한 문장
  tone: TodoTone;
  ageMin: number | null; // 나이(분). 없으면 null
}
export type TodoGroupLine<T> =
  | { type: "item"; item: T }
  | { type: "group"; key: string; kind: string; need: string; tone: TodoTone; count: number; oldestMin: number | null; items: T[] };

export function groupItems<T>(items: readonly T[], specOf: (t: T) => GroupSpec): TodoGroupLine<T>[] {
  const keyOf = (s: GroupSpec) => `${s.kind}\u0000${s.need}`;
  const size = new Map<string, number>();
  for (const t of items) size.set(keyOf(specOf(t)), (size.get(keyOf(specOf(t))) ?? 0) + 1);
  const lines: TodoGroupLine<T>[] = [];
  const seen = new Set<string>();
  for (const t of items) {
    const s = specOf(t);
    const k = keyOf(s);
    if ((size.get(k) ?? 0) < 2) {
      lines.push({ type: "item", item: t });
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    const members = items.filter((y) => keyOf(specOf(y)) === k);
    const specs = members.map(specOf);
    const tone: TodoTone = specs.some((y) => y.tone === "warning") ? "warning" : specs.some((y) => y.tone === "caution") ? "caution" : null;
    const ages = specs.map((y) => y.ageMin).filter((a): a is number => a !== null);
    lines.push({ type: "group", key: k, kind: s.kind, need: s.need, tone, count: members.length, oldestMin: ages.length ? Math.max(...ages) : null, items: members });
  }
  return lines;
}

// `최장 6h`: 분을 가장 큰 단위 하나로(45m · 6h · 3d)
export function ageShort(min: number): string {
  if (min < 60) return `${Math.max(0, Math.round(min))}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}
