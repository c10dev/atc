import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { FlowTodo, FlowTodoLine, FlowView } from "../../../server/home-flow.ts";
import { apiGet } from "../api.ts";
import { TodoGroupRow } from "../kit/TodoRow.tsx";
import { ageShort, lineKeyOf, locateTodo, OPEN_TODO_EVENT, type TodoPlan, todoDomId } from "../home-todo.ts";
import "./HomeTodo.css";

// HOME의 묶은 할 일 목록(ATC-503, docs/home-flow.md 3.5). 묶음 줄 자체는 kit/TodoRow의 TodoGroupRow다(ATC-504). 여기는 서버가 정한 순서·열림 상태·스크롤만 맡는다.
// 순서·묶음·5줄 접기는 서버가 정한다(GET /api/flow). 화면은 다시 정렬하지 않는다. 묶음 줄에는 단추가 하나뿐이고 `펼치기 n`이다: 한꺼번에 하는 동작은 없다(design-language 12).
// 펼치면 항목마다 한 줄이 그대로 나오고 줄마다 자기 단추가 있다(renderItem이 그린다).

// GET /api/flow: 첫 snapshot 전에는 503이다. 못 읽으면 null이고 HOME은 큐를 그대로 한 줄씩 그린다
export function useFlow(refreshKey: string): FlowView | null {
  const [flow, setFlow] = useState<FlowView | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet("/api/flow")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((f: FlowView) => alive && setFlow(f))
      .catch(() => alive && setFlow(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return flow;
}

export function HomeTodoLines({ plan, renderItem, onFocusItem }: { plan: TodoPlan; renderItem: (t: FlowTodo) => ReactNode; onFocusItem: (itemKey: string) => void }) {
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [restOpen, setRestOpen] = useState(false);
  const [pending, setPending] = useState<{ line: string; item: string | null } | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  const toggle = useCallback((key: string) => setOpenGroups((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set(s).add(key))), []);

  // 흐름판 칸의 `모두 아래 할 일에 있다 ↓`: 그 묶음(또는 줄)을 펼치고 화면에 올린다
  useEffect(() => {
    const on = (e: Event) => {
      const key = String((e as CustomEvent<string>).detail ?? "");
      const t = locateTodo(planRef.current, key);
      if (!t) return;
      if (t.where === "rest") setRestOpen(true);
      setOpenGroups((s) => new Set(s).add(t.line));
      if (t.item) onFocusItem(t.item);
      setPending({ line: t.line, item: t.item });
    };
    addEventListener(OPEN_TODO_EVENT, on);
    return () => removeEventListener(OPEN_TODO_EVENT, on);
  }, [onFocusItem]);
  useEffect(() => {
    if (!pending) return;
    const root = document.getElementById(todoDomId(pending.line));
    const target = root?.querySelector<HTMLElement>(".kit-todo-group-toggle, .kit-todo-main") ?? root;
    if (target) {
      target.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    }
    setPending(null);
  }, [pending, restOpen, openGroups]);

  const lines = restOpen ? [...plan.shown, ...plan.rest] : plan.shown;
  return (
    <>
      <ul className="home-rows" aria-label="할 일">
        {lines.map((l) => (
          <Line key={lineKeyOf(l)} line={l} open={openGroups.has(lineKeyOf(l))} onToggle={() => toggle(lineKeyOf(l))} renderItem={renderItem} />
        ))}
      </ul>
      {plan.restText && plan.rest.length > 0 && (
        <p className="home-rest">
          <span>{plan.restText}</span>
          <button type="button" className="btn" aria-expanded={restOpen} onClick={() => setRestOpen((v) => !v)}>
            {restOpen ? "접기" : `펼치기 ${plan.rest.reduce((n, l) => n + (l.type === "group" ? l.count : 1), 0)}`}
          </button>
        </p>
      )}
    </>
  );
}

function Line({ line, open, onToggle, renderItem }: { line: FlowTodoLine; open: boolean; onToggle: () => void; renderItem: (t: FlowTodo) => ReactNode }) {
  const id = todoDomId(lineKeyOf(line));
  if (line.type === "item") {
    return (
      <li id={id} className="home-line">
        <ul className="home-rows">{renderItem(line.item)}</ul>
      </li>
    );
  }
  return (
    <TodoGroupRow domId={id} tag={line.kind} tone={line.tone} count={line.count} need={line.groupNeed} oldest={`최장 ${ageShort(line.oldestMin)}`} open={open} onToggle={onToggle}>
      {line.items.map((t) => renderItem(t))}
    </TodoGroupRow>
  );
}
