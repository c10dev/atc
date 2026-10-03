import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { dockedEscapeAction, escapeAction, FOCUSABLE, trapMove } from "./dialog-focus.ts";

const visible = (el: HTMLElement) => el.getClientRects().length > 0;

// aria-modal 창 하나가 지키는 키보드 규칙(ATC-406): 열면 창으로 포커스, Tab은 창 안에서만 돈다,
// 닫으면 연 컨트롤로 돌아간다, Escape는 닫되 글 입력칸에서는 칸만 벗어난다.
// resetKey가 바뀌면(서랍이 다른 항목으로 바뀜) 창으로 다시 포커스하고 맨 위로 스크롤한다.
// 옆에 붙은 서랍(ATC-444)은 modal이 아니다: opts.trap=false면 Tab을 가두지 않고, Escape는 서랍 밖 글 입력칸에서는 가로채지 않는다.
// opts.restore=false면 연 컨트롤로 돌려보내는 일은 부르는 쪽이 한다(서랍은 항목이 바뀔 때 다시 그려져 연 컨트롤을 잃기 쉽다).
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, resetKey?: string, opts: { trap?: boolean; restore?: boolean } = {}) {
  const { trap = true, restore = true } = opts;
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (restore && opener && opener !== document.body && opener.isConnected) opener.focus();
    };
    // restore는 마운트 때 정한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollTo?.({ top: 0 });
  }, [ref, resetKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === "Tab") {
        if (!trap) return;
        const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
        const move = trapMove(list.indexOf(document.activeElement as HTMLElement), list.length, e.shiftKey);
        if (!move) return;
        e.preventDefault();
        (move === "first" ? list[0] : move === "last" ? list[list.length - 1] : root)?.focus();
        return;
      }
      const target = e.target as HTMLElement | null;
      const act = trap
        ? escapeAction(e.key, target, e.isComposing, e.defaultPrevented)
        : dockedEscapeAction(e.key, target, e.isComposing, e.defaultPrevented, target instanceof Node && root.contains(target));
      if (act === "close") close.current();
      else if (act === "leave-field") {
        e.preventDefault();
        root.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [ref, trap]);
}

// 서랍이 화면 옆에 붙는 폭인가(≥ 861px, docs/layout.md 7.3). 860px 이하에서는 서랍이 화면을 덮는다
const WIDE = "(min-width: 861px)";
export function useDocked(): boolean {
  const [docked, setDocked] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE);
    const on = () => setDocked(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return docked;
}
