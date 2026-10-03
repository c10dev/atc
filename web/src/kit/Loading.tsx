import { type ReactNode, useEffect, useState } from "react";
import { LOADING_DELAY_MS } from "./loading.ts";
import "./Loading.css";

// 늦을 때만 true: 지정한 시간이 지나서야 켜진다(빨리 끝나는 불러오기에는 아무것도 더 보이지 않는다)
export function useLate(ms: number = LOADING_DELAY_MS): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return late;
}

// 접근등 "토끼"(ATC-453): 흰 불빛 넷이 왼쪽에서 오른쪽으로 차례로 밝아졌다 꺼지고, 짧은 중립 막대(활주로 문턱)에서 끝난다.
// 자리는 처음부터 잡아 두고(글이 밀리지 않게) 불빛은 늦을 때만 그린다. 글이 이름이라 장식(aria-hidden)이다
export function Lights() {
  const late = useLate();
  return (
    <span className="kit-lights" aria-hidden="true">
      {late && (
        <>
          <i />
          <i />
          <i />
          <i />
          <b />
        </>
      )}
    </span>
  );
}

// 기다리는 줄 하나(design-language 4.6): 불빛과 글. 글("불러오는 중…")은 그대로 role="status"로 남는다.
// className은 자리(여백) 조정용이다
export function Loading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={className ? `kit-loading ${className}` : "kit-loading"} role="status">
      <Lights />
      <span>{children}</span>
    </p>
  );
}
