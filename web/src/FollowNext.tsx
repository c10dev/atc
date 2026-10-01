import { useEffect, useRef, useState } from "react";

// 머리의 NEXT n(docs/follow.md 3.4): 따라가는 번들 전체에서 다음 할 일이 있는 줄 수. 0이면 보이지 않는다.
// 수는 서버가 센다(GET /api/follow의 next). 스냅샷이 바뀌면 다시 읽되 10초에 한 번만
const MIN_GAP_MS = 10_000;

export function FollowNext({ refreshKey }: { refreshKey: string }) {
  const [n, setN] = useState(0);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const wait = Math.max(0, last.current + MIN_GAP_MS - Date.now());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      last.current = Date.now();
      try {
        const res = await fetch("/api/follow");
        if (res.ok) setN(Number((await res.json()).next) || 0);
      } catch {
        // 못 읽으면 지난 수를 그대로 둔다
      }
    }, wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refreshKey]);
  if (n <= 0) return null;
  return (
    <a className="readout is-button" href="#follow" aria-label={`FOLLOW 다음 할 일 ${n}건`}>
      <b>{String(n).padStart(2, "0")}</b>
      <span>NEXT</span>
    </a>
  );
}
