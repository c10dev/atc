import { type ReactNode, useId } from "react";
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

// 목록 머리(design-language 4.3): 이름과 개수 한 줄. 접는 머리글은 Fold, 접지 않는 머리글은 이것이다
export function SectionHead({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="kit-head">
      {children}
      {count !== undefined && <em>{count}</em>}
    </h2>
  );
}
