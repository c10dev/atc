import { useEffect, useState } from "react";
import type { MisfireDay, MisfireView } from "../../../server/misfire.ts";
import { apiGet } from "../api.ts";

// 자동 운항 MISFIRE(ATC-367): 서버가 승인한 카드 가운데 나중에 틀렸다고 드러난 것(거절·UNABLE, RECALL, 보낸 뒤 SUPERSEDED, AIRCRAFT 불가)의 날짜별 몫.
// 승인이 하나도 없으면 아무것도 그리지 않는다(정상 상태에 줄이 없다). 읽기만 한다.

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const KIND_LABEL = { declined: "거절·UNABLE", recalled: "RECALL", "superseded-after-sent": "보낸 뒤 SUPERSEDED", "wrong-aircraft": "AIRCRAFT 불가" } as const;

function detail(d: MisfireDay): string {
  return (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[])
    .filter((k) => d.by[k] > 0)
    .map((k) => `${KIND_LABEL[k]} ${d.by[k]}`)
    .join(" · ");
}

export function AutoMisfire({ refreshKey }: { refreshKey: string }) {
  const [v, setV] = useState<MisfireView | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet("/api/dispatch/misfire?days=7")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setV(d))
      .catch(() => alive && setV(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  if (!v || v.total.approvals === 0) return null;
  const days = [...v.daily].reverse().filter((d) => d.approvals > 0);
  return (
    <>
      <h2 className="label">
        MISFIRE <em>서버가 승인한 카드 가운데 나중에 틀렸다고 드러난 몫(승인한 날 기준, UTC)</em>
      </h2>
      <ul className="dp-misfire">
        {days.map((d) => (
          <li key={d.day}>
            <span className="mono">{d.day}</span> 승인 <b>{d.approvals}</b> · misfire <b>{d.misfires}</b> (<b>{pct(d.share)}</b>)
            {d.misfires > 0 ? <span className="faint"> — {detail(d)}</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
