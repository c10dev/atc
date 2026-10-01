import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Icon } from "../../Icon.tsx";

// 카드의 접는 칸(ATC-325, 디자인 취향 v1 / 디자인 언어 원칙 7): 한 줄 요약이 먼저, 누르면 그 자리에서 열린다. 정보는 지우지 않고 접는다.
// 라벨 칸 폭과 왼쪽 가장자리는 모든 칸이 같다(.fl-fold-head의 격자). 어느 칸이 열렸는지는 이 브라우저에만 기억한다(localStorage, 못 쓰면 닫힘).
const KEY = "atc.fleet.fold";

function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeOpen(id: string, open: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readOpen(), [id]: open }));
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 창 등)에서는 이번 화면에서만 기억한다
  }
}

// summary: 접힌 채 보이는 한 줄(비 상호작용 요소만). children이 없으면 접을 것이 없는 줄이라 버튼 없이 같은 격자로 그린다
// name: 머리 버튼의 접근 가능한 이름(요약 안의 요소가 많아 이름이 길어질 때). 없으면 라벨 + 요약
export function Fold({ id, label, summary, tone, name, children }: { id: string; label: string; summary: ReactNode; tone?: "short"; name?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(() => Boolean(children) && readOpen()[id] === true);
  const bodyId = useId();
  const sum = <span className={`fl-fold-sum${tone === "short" ? " fl-short" : ""}`}>{summary}</span>;
  if (!children) {
    return (
      <div className="fl-fold is-static" role="group" aria-label={label}>
        <span className="fl-fold-head">
          <span className="fl-fold-k">{label}</span>
          {sum}
        </span>
      </div>
    );
  }
  return (
    <div className={`fl-fold${open ? " is-open" : ""}`} role="group" aria-label={label}>
      <button
        type="button"
        className="fl-fold-head"
        aria-expanded={open}
        aria-label={name}
        aria-controls={bodyId}
        onClick={() => {
          writeOpen(id, !open);
          setOpen(!open);
        }}
      >
        <span className="fl-fold-k">{label}</span>
        {sum}
        <Icon icon={open ? ChevronDown : ChevronRight} />
      </button>
      {open && (
        <div id={bodyId} className="fl-fold-body">
          {children}
        </div>
      )}
    </div>
  );
}
