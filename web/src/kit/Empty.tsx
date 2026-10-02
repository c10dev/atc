import type { ReactNode } from "react";
import "./Empty.css";

// 빈 상태 한 줄(design-language 4.6): 무엇이 있을 자리인지 옅은 한 줄. 목록이 그 자리의 본문일 때만 쓴다.
// className은 자리(여백) 조정용이고, 색·글자는 이 부품이 정한다.
export function Empty({ children, className, role }: { children: ReactNode; className?: string; role?: "status" }) {
  return (
    <p className={className ? `kit-empty ${className}` : "kit-empty"} role={role}>
      {children}
    </p>
  );
}
