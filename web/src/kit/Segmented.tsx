import { type KeyboardEvent, useRef } from "react";
import { nextSegment, tabStop } from "./segmented.ts";
import "./Segmented.css";

// 고르기 하나(radio 그룹): role=radiogroup, 칸마다 role=radio와 aria-checked, 탭은 선택된 칸 하나에만 멈추고(roving tabindex)
// 화살표·Home·End가 칸을 옮기며 고른다. 설정 창의 두 사본(SettingsPanel, SettingsAlerts)을 하나로 합쳤다(ATC-414).
export function Segmented<T extends string | boolean>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex(([v]) => v === value);
  const stop = tabStop(options.length, selected);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = nextSegment(options.length, selected, e.key);
    if (to === null) return;
    e.preventDefault();
    onChange(options[to][0]);
    refs.current[to]?.focus();
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map(([v, text], i) => (
        <button key={String(v)} ref={(el) => void (refs.current[i] = el)} type="button" role="radio" aria-checked={value === v} tabIndex={i === stop ? 0 : -1} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
