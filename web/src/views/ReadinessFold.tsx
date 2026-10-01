import { Check, ChevronRight, X } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { Icon } from "../Icon.tsx";
import { type LinePart, partText } from "../readiness-line.ts";
import "./ReadinessFold.css";

// READINESS(ATC-113): 단계 게이트·점검표·그림자 통계를 한 줄로 접은 자리. 펴면 원래 블록이 그대로 나온다.
// 펼침 상태는 탭마다 localStorage에 기억한다(저장소를 못 쓰면 접힌 채로).

export type FoldTab = "dispatch" | "schedule";
const keyOf = (tab: FoldTab) => `atc.readiness.${tab}`;

function load(tab: FoldTab): boolean {
  try {
    return localStorage.getItem(keyOf(tab)) === "open";
  } catch {
    return false;
  }
}

export function useFoldOpen(tab: FoldTab): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => load(tab));
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      try {
        localStorage.setItem(keyOf(tab), next ? "open" : "closed");
      } catch {}
    },
    [tab],
  );
  return [open, setOpen];
}

export function ReadinessFold({ id, open, onOpenChange, parts, children }: { id: string; open: boolean; onOpenChange: (open: boolean) => void; parts: LinePart[]; children: ReactNode }) {
  return (
    <details className="rf" id={id} open={open} onToggle={(e) => e.currentTarget.open !== open && onOpenChange(e.currentTarget.open)}>
      <summary className="rf-line" aria-label={`READINESS ${parts.map(partText).join(", ")}`}>
        <Icon icon={ChevronRight} />
        <span className="rf-title">READINESS</span>
        {parts.map((p) => (
          <span key={p.id} className={`rf-part s-${p.state}`}>
            <span className="rf-label">{p.label}</span> <b>{p.value}</b>
            {p.mark && <span className="rf-mark"> <Icon icon={p.mark === "✓" ? Check : X} /></span>}
          </span>
        ))}
      </summary>
      <div className="rf-body">{children}</div>
    </details>
  );
}
