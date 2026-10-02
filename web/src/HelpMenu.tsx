import { CircleHelp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./kit/Icon.tsx";
import "./alerts.css";

// 도움말 메뉴(ATC-381, docs/layout.md Y6): DOCS는 탭이 아니라 여기서 연다. 주소 #docs/<쪽>은 그대로 열린다.
const ITEMS: readonly { hash: string; label: string; note: string }[] = [
  { hash: "docs", label: "사용 안내", note: "소개 · 빠른 시작 · 개념" },
  { hash: "docs/screens", label: "화면 안내", note: "각 화면이 보이는 것" },
  { hash: "docs/troubleshooting", label: "문제 해결", note: "자주 막히는 곳" },
  { hash: "docs/changelog", label: "변경 기록", note: "무엇이 바뀌었나" },
];

export function HelpMenu({ docsOpen }: { docsOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onPointer);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  return (
    <div className="bell-wrap" ref={ref}>
      <button type="button" className={`readout is-button${docsOpen ? " is-on" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label="도움말 메뉴">
        <b>
          <Icon icon={CircleHelp} size={16} />
        </b>
        <span>HELP</span>
      </button>
      {open && (
        <ul className="bell-list help-list" role="menu" aria-label="도움말">
          {ITEMS.map((i) => (
            <li key={i.hash} role="none">
              <a role="menuitem" className="help-item" href={`#${i.hash}`} onClick={() => setOpen(false)}>
                <b>{i.label}</b>
                <span className="muted">{i.note}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
