import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { foldSummary } from "./fold.ts";
import { Icon } from "./Icon.tsx";
import "./Fold.css";

// 접기 하나(design-language 4.3, level로 h2·h3): 머리글이 늘 개수나 한 줄 요약을 말한다. 버튼이라 클릭·Enter·Space로 열고 닫고 aria-expanded가 상태를 말한다.
// foldable=false면 접을 수 없는 머리글(WARNING은 접지 않는다, 4.3)이고 모양은 같다. 열림 상태는 이 부품이 들고 있다(기본은 열림).
export function Fold({ title, count, total, summary, defaultOpen = true, foldable = true, label, level = 2, children }: { title: string; count?: number; total?: number; summary?: string; defaultOpen?: boolean; foldable?: boolean; label?: string; level?: 2 | 3; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const shown = !foldable || open;
  const text = foldSummary({ count, total, summary });
  const Heading = `h${level}` as const; // 다른 구역 안의 접기는 h3로 두어 제목 구조를 지킨다
  const head = (
    <>
      {foldable && <Icon icon={shown ? ChevronDown : ChevronRight} />}
      <span className="kit-fold-title">{title}</span>
      {text && <em>{text}</em>}
    </>
  );
  return (
    <section className="kit-fold" aria-label={label ?? title}>
      <Heading className="kit-fold-head">
        {foldable ? (
          <button type="button" aria-expanded={shown} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            {head}
          </button>
        ) : (
          <span className="kit-fold-static">{head}</span>
        )}
      </Heading>
      <div id={id} hidden={!shown}>
        {children}
      </div>
    </section>
  );
}
