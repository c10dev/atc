import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

// 아이콘 한 벌(ATC-284, 디자인 언어 3.5.6): Lucide 외곽선 아이콘, 14·16px, 선 1.5, currentColor(테마색을 따른다), 기본은 aria-hidden.
// 아이콘만 있는 버튼은 IconButton으로 쓴다 — label이 필수라 이름 없는 버튼이 생기지 않는다. 아이콘은 쓰는 곳에서 하나씩 가져온다(번들에는 쓴 것만).
export function Icon({ icon: I, size = 14, className }: { icon: LucideIcon; size?: 14 | 16; className?: string }) {
  return <I size={size} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className={className ? `ico ${className}` : "ico"} />;
}

export function IconButton({ icon, label, size = 14, ...rest }: { icon: LucideIcon; label: string; size?: 14 | 16 } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">) {
  return (
    <button type="button" {...rest} aria-label={label}>
      <Icon icon={icon} size={size} />
    </button>
  );
}
