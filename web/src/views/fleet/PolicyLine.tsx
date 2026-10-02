import { useEffect, useState } from "react";
import type { PolicyView } from "../../../../server/policy-hook.ts";
import { apiGet } from "../../api.ts";

// AIRCRAFT policy hook(ATC-369): AIRCRAFT는 사람에게 도구 승인을 묻지 않는다. PENDING은 0이어야 하고, hook이 거절한 것은 class별로 센다.
// 읽기만(GET /api/policy). 못 읽으면 아무것도 그리지 않는다. 거절한 class만 센다 — 명령·경로의 본문은 기록하지 않는다
const TOP = 4;

export function PolicyLine({ refreshKey }: { refreshKey: string }) {
  const [v, setV] = useState<PolicyView | null>(null);
  useEffect(() => {
    let live = true;
    apiGet("/api/policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setV(d as PolicyView | null))
      .catch(() => live && setV(null));
    return () => {
      live = false;
    };
  }, [refreshKey]);
  if (!v) return null;
  const { pending, denials, staleStop } = v;
  const shown = denials.byClass.slice(0, TOP);
  const rest = denials.byClass.slice(TOP).reduce((n, c) => n + c.n, 0);
  return (
    <p className="fl-policy" aria-label="AIRCRAFT POLICY">
      <span className={`fl-la-chip${pending.count > 0 ? " is-warn" : ""}`} title={pending.count ? `도구 승인을 기다리는 AIRCRAFT: ${pending.aircraft.join(", ")}` : "도구 승인을 기다리는 AIRCRAFT 없음 — 정상은 0"}>
        PENDING {pending.count}
      </span>
      <span className="fl-la-chip" title={`policy hook이 지난 ${denials.windowH}시간에 거절한 호출. class만 센다(본문은 기록하지 않음)`}>
        DENIED {denials.windowH}h {denials.total}
      </span>
      {shown.map((c) => (
        <span key={c.cls} className="fl-policy-class mono" title={`class ${c.cls}`}>
          {c.cls} <b>{c.n}</b>
        </span>
      ))}
      {rest > 0 && <span className="fl-policy-class faint">+{rest}</span>}
      <span className="faint" title="FLIGHT가 끝났는데(머지·ARRIVED) PENDING·HUNG으로 30분 남은 AIRCRAFT를 서버가 멈춘다. 끄는 곳은 설정 → OPERATIONS(SUPERVISOR 전용)">
        STALE STOP {staleStop.mode}
        {staleStop.stopped24h + staleStop.failed24h > 0 ? ` · 24h ${staleStop.stopped24h} stopped${staleStop.failed24h ? `, ${staleStop.failed24h} failed` : ""}` : ""}
      </span>
    </p>
  );
}
