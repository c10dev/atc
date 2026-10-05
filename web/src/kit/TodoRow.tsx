import { Fragment, type ReactNode, useId, useState } from "react";
import { ageShort, type GroupSpec, groupItems } from "./todo-group.ts";
import "./TodoRow.css";

// 할 일 줄 하나(design-language 4.1 행과 펼침, docs/design-system.md 결정 S4): 한 줄에 칸 위치가 고정이다.
//   [종류 태그] [대상] [무엇이 필요한가 한 문장] … [나이] [단추]
// 줄을 누르면 바로 아래에 상세가 열린다(나머지 동작·이유·증거). 누르는 것은 대상 칸의 버튼 하나이고 줄 전체로 늘려 놓았다(키보드·aria-expanded는 이 버튼의 것).
// 단추 칸은 이 버튼 위에 있어 따로 눌린다. 카드 없음: 면은 화면 그대로이고 줄 사이는 여백뿐이다. 올린 줄·열린 줄은 --layer-hover로 오른다.
// tone: WARNING은 왼쪽 가장자리에 2px --alert 막대(바탕 칠 없음), CAUTION은 태그만 호박색이다. 색은 :root 토큰만.
// quiet: 지금은 사람이 할 일이 아닌 줄(기다림·진행 중). 태그와 글이 옅다. children: 이 줄 밑에 놓일 줄들(진짜 중첩 목록, ATC-494). 들여쓰기는 깊이마다 줄고 줄 높이·hover는 그 줄 자신만 쓴다.
export type TodoTone = "warning" | "caution" | null;

export function TodoRow({
  tag,
  tone = null,
  quiet = false,
  subject,
  need,
  age,
  action,
  open,
  onToggle,
  detail,
  children,
  childrenLabel,
}: {
  tag: string;
  tone?: TodoTone;
  quiet?: boolean;
  subject: string;
  need: ReactNode;
  age: ReactNode;
  action: ReactNode;
  open: boolean;
  onToggle: () => void;
  detail?: ReactNode;
  children?: ReactNode;
  childrenLabel?: string;
}) {
  const id = useId();
  const nested = children !== undefined && children !== null && children !== false;
  const Box = nested ? "div" : "li"; // 밑에 줄이 있으면 li는 줄 + 중첩 목록을 담고, 줄 상자는 div다
  const row = (
    <Box className={`kit-todo${open ? " is-open" : ""}${quiet ? " is-quiet" : ""}`}>
      {tone === "warning" && <span className="kit-todo-bar" aria-hidden="true" />}
      <div className="kit-todo-line">
        <span className="tag kit-todo-tag" data-tone={tone === "warning" ? "alert" : tone === "caution" ? "amber" : undefined}>
          {tag}
        </span>
        <button type="button" className="kit-todo-main" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          {subject}
        </button>
        <span className="kit-todo-need">{need}</span>
        <span className="kit-todo-age faint">{age}</span>
        <span className="kit-todo-act">{action}</span>
      </div>
      <div id={id} className="kit-todo-detail" hidden={!open}>
        {open && detail}
      </div>
    </Box>
  );
  if (!nested) return row;
  return (
    <li className="kit-todo-node">
      {row}
      <ul className="kit-todo-nest" aria-label={childrenLabel}>
        {children}
      </ul>
    </li>
  );
}

// 묶음 줄(ATC-504, design-language 4.1·12): 같은 종류에 같은 필요인 줄을 한 줄로. `[종류 태그] [n건] [같은 필요] … [최장 나이] [펼치기 n]`.
// 단추는 펼치기 하나뿐이다: 한꺼번에 하는 동작은 어디에도 없다. 펼치면 항목마다 TodoRow 한 줄이 그대로 나오고 줄마다 자기 단추가 있다(children).
// domId: 바깥에서 이 묶음을 찾아 스크롤·초점을 줄 때 쓰는 id(펼치기 단추가 초점을 받는다).
export function TodoGroupRow({
  domId,
  tag,
  tone = null,
  count,
  need,
  oldest,
  open,
  onToggle,
  children,
}: {
  domId?: string;
  tag: string;
  tone?: TodoTone;
  count: number;
  need: ReactNode;
  oldest: ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  const itemsId = `${id}-items`;
  return (
    <li id={domId} className={`kit-todo-group${open ? " is-open" : ""}`}>
      <div className="kit-todo-group-line">
        {tone === "warning" && <span className="kit-todo-group-bar" aria-hidden="true" />}
        <span className="tag" data-tone={tone === "warning" ? "alert" : tone === "caution" ? "amber" : undefined}>
          {tag}
        </span>
        <span className="kit-todo-group-count">{count}건</span>
        <span className="kit-todo-group-need">{need}</span>
        <span className="kit-todo-group-age faint">{oldest}</span>
        <button type="button" className="btn kit-todo-group-toggle" aria-expanded={open} aria-controls={itemsId} onClick={onToggle}>
          {open ? "접기" : `펼치기 ${count}`}
        </button>
      </div>
      <ul id={itemsId} className="kit-todo-group-items" hidden={!open}>
        {open && children}
      </ul>
    </li>
  );
}

// 묶는 목록(ATC-504): 서버가 묶지 않는 목록(RELEASE 등)을 같은 종류·같은 필요끼리 묶어 그린다. 둘 이상 같은 것만 묶이고 하나뿐인 줄은 그대로다. 열림 상태는 이 목록이 쥔다.
// render는 항목 하나의 줄(TodoRow)을 그린다. 묶음 안에서도 항목 줄은 같은 것이다.
export function TodoGroupedList<T>({
  items,
  specOf,
  keyOf,
  render,
  className,
  label,
}: {
  items: readonly T[];
  specOf: (t: T) => GroupSpec;
  keyOf: (t: T) => string;
  render: (t: T) => ReactNode;
  className?: string;
  label: string;
}) {
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const toggle = (k: string) => setOpenGroups((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set(s).add(k)));
  return (
    <ul className={className} aria-label={label}>
      {groupItems(items, specOf).map((l) =>
        l.type === "item" ? (
          render(l.item)
        ) : (
          <TodoGroupRow
            key={`group/${l.key}`}
            tag={l.kind}
            tone={l.tone}
            count={l.count}
            need={l.need}
            oldest={l.oldestMin === null ? "—" : `최장 ${ageShort(l.oldestMin)}`}
            open={openGroups.has(l.key)}
            onToggle={() => toggle(l.key)}
          >
            {l.items.map((t) => (
              <Fragment key={keyOf(t)}>{render(t)}</Fragment>
            ))}
          </TodoGroupRow>
        ),
      )}
    </ul>
  );
}

// 목록 머리(design-language 4.3): 이름과 개수 한 줄. 접는 머리글은 Fold, 접지 않는 머리글은 이것이다
export function SectionHead({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="kit-head">
      {children}
      {count !== undefined && <em>{count}</em>}
    </h2>
  );
}
