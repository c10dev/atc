import { Check, Circle, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "../kit/Icon.tsx";

// 상태 표시(3.5.6): 글자 기호(✓ ✗ ○ △) 대신 Lucide 아이콘. 색만으로 전하지 않으니 옆에 글자를 꼭 같이 쓴다.
export type MarkState = "pass" | "fail" | "insufficient" | "check";
const ICON = { pass: Check, fail: X, insufficient: Circle, check: TriangleAlert } as const;

export function StateMark({ state, children }: { state: MarkState; children: ReactNode }) {
  return (
    <>
      <Icon icon={ICON[state]} /> {children}
    </>
  );
}
