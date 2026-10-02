// 모달 창(서랍·GLOBE)의 키보드 규칙 중 DOM 없이 계산되는 부분(ATC-406). 훅은 useDialog.ts.

// 창 안에서 Tab으로 닿는 요소. 보이는지(렌더 여부)는 부르는 쪽이 거른다.
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Tab(shift면 Shift+Tab) 때 포커스를 어디로 보낼지. 같은 창 안에서 기본 이동에 맡기면 null.
// at: 지금 포커스가 목록의 몇 번째인지(창 자체이거나 창 밖이면 -1), count: 목록 길이.
export function trapMove(at: number, count: number, shift: boolean): "first" | "last" | "container" | null {
  if (count === 0) return "container"; // 닿을 곳이 없으면 창에 붙들어 둔다
  if (at < 0) return shift ? "last" : "first";
  if (shift && at === 0) return "last";
  if (!shift && at === count - 1) return "first";
  return null;
}

type Target = { tagName?: string; isContentEditable?: boolean; type?: string } | null;

// Escape가 글 입력칸에서 눌렸는지: 그러면 창을 닫지 않고 칸에서 빠져나오기만 한다.
export function isTextEntry(el: Target): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes((el.type ?? "text").toLowerCase());
}

export type EscapeAction = "close" | "leave-field" | "ignore";

export function escapeAction(key: string, target: Target, composing: boolean, defaultPrevented: boolean): EscapeAction {
  if (key !== "Escape" || composing || defaultPrevented) return "ignore";
  return isTextEntry(target) ? "leave-field" : "close";
}
