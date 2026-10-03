import { useEffect, useRef, useState } from "react";
import { announceCount, announceNew, type LiveAlert } from "./alert-live.ts";

const CLEAR_MS = 10_000; // 읽은 글은 비워 둔다: 같은 글이 다시 생겨도 다시 읽힌다

// 새 경보를 화면 읽기 프로그램에 알리는 보이지 않는 live region 둘(ATC-432). 폴링마다 읽지 않고, 지난번에 없던 경보만 읽는다.
// WARNING은 끼어들어 읽고(assertive), CAUTION과 atc 알림 수 증가는 하던 말이 끝나면 읽는다(polite). 티커는 읽지 않는다(상위 단추의 이름이 있다).
// ready: 첫 스냅샷이 온 뒤부터(처음 불러온 목록은 읽지 않는다)
export function AlertLive({ alerts, atcCount, ready }: { alerts: readonly LiveAlert[]; atcCount: number; ready: boolean }) {
  const seen = useRef<Set<string> | null>(null);
  const lastCount = useRef<number | null>(null);
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ready) return;
    const a = announceNew(seen.current, alerts);
    const c = announceCount(lastCount.current, atcCount);
    seen.current = new Set(alerts.map((x) => x.key));
    lastCount.current = atcCount;
    const p = [a.polite, c].filter(Boolean).join(". ");
    if (!p && !a.assertive) return;
    if (p) setPolite(p);
    if (a.assertive) setAssertive(a.assertive);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => (setPolite(""), setAssertive("")), CLEAR_MS);
  }, [ready, alerts, atcCount]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </>
  );
}
