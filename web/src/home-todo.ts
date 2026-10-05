import { ageShort } from "./kit/todo-group.ts";
import type { FlowTodo, FlowTodoLine, FlowView } from "../../server/home-flow.ts";

// HOME 할 일 묶음(ATC-503, docs/home-flow.md 3.5): 순서와 묶음은 서버가 정한다(GET /api/flow의 todo·todoLines·todoRest). 화면은 다시 정렬하지 않는다.
// 여기는 화면이 서버 순서를 그대로 쓰면서 필요한 순수 계산만 둔다: 거른 목록을 같은 규칙으로 줄로 묶기, 접힌 나머지 줄, 묶음·줄 찾기, 나이 글자.

// 같은 묶음 열쇠(group)를 가진 항목은 첫 항목 자리에 한 줄로 모인다. 서버 flowViewOf의 묶는 방식과 같다(테스트가 서로 맞춘다)
export function groupLines(todo: readonly FlowTodo[]): FlowTodoLine[] {
  const lines: FlowTodoLine[] = [];
  const seen = new Set<string>();
  for (const t of todo) {
    if (!t.group) {
      lines.push({ type: "item", item: t });
      continue;
    }
    if (seen.has(t.group)) continue;
    seen.add(t.group);
    const items = todo.filter((y) => y.group === t.group);
    const tone = items.some((y) => y.tone === "warning") ? "warning" : items.some((y) => y.tone === "caution") ? "caution" : null;
    lines.push({ type: "group", group: t.group, groupNeed: t.groupNeed ?? "", kind: t.kind, tone, count: items.length, oldestMin: Math.max(...items.map((y) => y.ageMin)), items });
  }
  return lines;
}

export interface TodoPlan {
  shown: FlowTodoLine[]; // 처음 보이는 줄(서버가 접은 5줄, 거르면 전부)
  rest: FlowTodoLine[]; // 접힌 줄(펼치면 보인다). 거르면 비어 있다
  restText: string | null; // 서버가 보내는 `나머지 n건 BACKLOG 3 …`
}

// 거르지 않으면 서버의 todoLines·todoRest 그대로, 접힌 줄은 같은 순서의 나머지다. 거르면(종류 하나) 순서를 지킨 채 같은 규칙으로 다시 묶고 접지 않는다
export function planOf(flow: Pick<FlowView, "todo" | "todoLines" | "todoRest">, keep: ((t: FlowTodo) => boolean) | null): TodoPlan {
  if (!keep) {
    const all = groupLines(flow.todo);
    return { shown: flow.todoLines, rest: all.slice(flow.todoLines.length), restText: flow.todoRest?.text ?? null };
  }
  return { shown: groupLines(flow.todo.filter(keep)), rest: [], restText: null };
}

export const lineKeyOf = (l: FlowTodoLine): string => (l.type === "group" ? l.group : l.item.key);
export const lineItems = (l: FlowTodoLine): FlowTodo[] => (l.type === "group" ? l.items : [l.item]);

// 흐름판 칸의 `n건 모두 아래 할 일에 있다 ↓`가 가리키는 곳(todoGroup: 묶음 열쇠나 항목 key): 어느 줄이고 접힌 쪽에 있는지, 묶음이면 그 안의 항목 key
export interface TodoTarget {
  where: "shown" | "rest";
  line: string; // 줄 열쇠(묶음 열쇠나 항목 key)
  item: string | null; // 묶음 안의 항목 key(묶음 열쇠로 찾았으면 null)
}
export function locateTodo(plan: Pick<TodoPlan, "shown" | "rest">, key: string): TodoTarget | null {
  for (const where of ["shown", "rest"] as const) {
    for (const l of plan[where]) {
      if (lineKeyOf(l) === key) return { where, line: lineKeyOf(l), item: null };
      if (l.type === "group" && l.items.some((i) => i.key === key)) return { where, line: lineKeyOf(l), item: key };
    }
  }
  return null;
}

export { ageShort };

// 줄 열쇠를 요소 id로(공백·슬래시·# 같은 글자를 뺀다). 같은 열쇠는 늘 같은 id
export const todoDomId = (key: string): string => `home-todo-${key.replace(/[^A-Za-z0-9가-힣_-]+/g, "-")}`;

// 흐름판이 부르는 길(H3): 이 이벤트를 보내면 HOME이 그 묶음(또는 항목)을 펼치고 화면에 올려 초점을 준다
export const OPEN_TODO_EVENT = "atc:home-todo-open";
export function openTodoGroup(key: string): void {
  dispatchEvent(new CustomEvent<string>(OPEN_TODO_EVENT, { detail: key }));
}
