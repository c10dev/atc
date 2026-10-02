import type { ReactNode } from "react";
import "./Table.css";

// 넓은 표는 자기 상자 안에서만 가로로 넘긴다(design-system L1). 이름 붙은 region이고 키보드 초점을 받는다.
// className은 자리(여백) 조정용이고, 넘침·초점 모양은 이 부품이 정한다.
export function TableScroll({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `kit-scroll ${className}` : "kit-scroll"} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
