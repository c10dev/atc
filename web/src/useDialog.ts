import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { escapeAction, FOCUSABLE, trapMove } from "./dialog-focus.ts";

const visible = (el: HTMLElement) => el.getClientRects().length > 0;

// aria-modal 창 하나가 지키는 키보드 규칙(ATC-406): 열면 창으로 포커스, Tab은 창 안에서만 돈다,
// 닫으면 연 컨트롤로 돌아간다, Escape는 닫되 글 입력칸에서는 칸만 벗어난다.
// resetKey가 바뀌면(서랍이 다른 항목으로 바뀜) 창으로 다시 포커스하고 맨 위로 스크롤한다.
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, resetKey?: string) {
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
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
        const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
        const move = trapMove(list.indexOf(document.activeElement as HTMLElement), list.length, e.shiftKey);
        if (!move) return;
        e.preventDefault();
        (move === "first" ? list[0] : move === "last" ? list[list.length - 1] : root)?.focus();
        return;
      }
      const act = escapeAction(e.key, e.target as HTMLElement | null, e.isComposing, e.defaultPrevented);
      if (act === "close") close.current();
      else if (act === "leave-field") {
        e.preventDefault();
        root.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [ref]);
}
