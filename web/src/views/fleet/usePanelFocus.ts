import { type KeyboardEvent, useEffect, useRef } from "react";

// 카드 버튼이 연 패널(ATC-61): 열리면 화면 안으로 스크롤하고 첫 칸에 초점을 둔다.
// 닫으면(취소·닫기·Esc) 연 버튼으로 초점을 돌린다
export function usePanelFocus<T extends HTMLElement>(opener: HTMLElement | null, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 위에 붙은 콘솔(좁은 화면에선 여러 줄) 아래로 오게. 남은 높이보다 크면 머리부터, 아니면 모자란 만큼만 움직인다
    const top = document.querySelector(".console")?.getBoundingClientRect().bottom ?? 0;
    el.style.scrollMarginTop = `${Math.round(top) + 12}px`;
    el.scrollIntoView({ block: el.offsetHeight > window.innerHeight - top ? "start" : "nearest" });
    el.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
  }, []);
  const close = () => {
    onClose();
    if (opener?.isConnected) opener.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  };
  return { ref, close, onKeyDown };
}
