import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

// 전광판 티커: 내용이 폭을 넘칠 때만 증권거래소·공항 안내판처럼 왼쪽으로 흐른다.
// 같은 내용을 한 벌 더 이어 붙여 끊김 없이 돌고, 속도는 길이와 상관없이 초당 SPEED px로 같다.
// 마우스를 올리거나 포커스하면 멈추고, 애니메이션을 끈 설정에서는 흐르지 않는다(App.css). WARNING이 없으면 두 바퀴 뒤 멈춘다(원칙 10).
const SPEED = 50;

export function Ticker({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [loop, setLoop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const v = viewport.current;
    const c = copy.current;
    if (!v || !c) return;
    const measure = () => {
      const width = c.getBoundingClientRect().width;
      setLoop(width > v.clientWidth ? Math.round(width) : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const style = loop ? ({ "--loop": `${loop}px`, "--duration": `${loop / SPEED}s` } as CSSProperties) : undefined;
  return (
    <span className={`ticker-list${loop ? " is-running" : ""}`} ref={viewport}>
      <span className="ticker-track" style={style}>
        <span className="ticker-copy" ref={copy}>
          {children}
        </span>
        {loop && (
          <span className="ticker-copy" aria-hidden>
            {children}
          </span>
        )}
      </span>
    </span>
  );
}
