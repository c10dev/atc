import { useCallback, useEffect, useState } from "react";
import type { Proposal } from "../../server/proposals.ts";
import { apiGet } from "./api.ts";
import { timeAgo } from "./derive.ts";
import { FlightBrakes, type FreshVerdict } from "./FlightBrakes.tsx";
import "./FlightDispatch.css";

// FLIGHT 서랍의 배정 기록(ATC-377): DISPATCH 탭이 하던 한 FLIGHT의 제안 이력을 서랍에서 읽는다. 카드마다 단계 시각, 사유, 그리고 지금 할 수 있는 brake(CANCEL·RECALL·FRESH START).
// 기록이 없으면 아무것도 그리지 않는다(정상 상태에 빈 절을 두지 않는다).

const STEPS = ["proposed", "approved", "sent", "accepted", "departed", "arrived"] as const;
const LABEL: Record<string, string> = { proposed: "제안", approved: "승인", sent: "발송", accepted: "READBACK", departed: "DEPARTED", arrived: "ARRIVED", declined: "UNABLE", recalling: "RECALL", recalled: "RECALLED", superseded: "SUPERSEDED", rejected: "거절", expired: "만료", closed: "닫힘", agreed: "동의", disagreed: "반대" };

interface Data {
  mode: "shadow" | "approval";
  proposals: Proposal[];
}

export function FlightDispatch({ k, now }: { k: string; now: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [fresh, setFresh] = useState<Record<string, FreshVerdict>>({});
  const load = useCallback(() => {
    apiGet(`/api/dispatch/proposals?flight=${encodeURIComponent(k)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && Array.isArray(d.proposals) ? d : null))
      .catch(() => setData(null));
    apiGet("/api/dispatch/fresh-start")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFresh(d?.verdicts ?? {}))
      .catch(() => setFresh({}));
  }, [k]);
  useEffect(load, [load]);
  if (!data || data.proposals.length === 0) return null;
  return (
    <>
      <h3 className="dr-h">배정 기록 {data.proposals.length}</h3>
      <ul className="fd-list">
        {data.proposals.map((p) => {
          const steps = STEPS.filter((s) => p.timeline[s]);
          const end = !STEPS.includes(p.status as (typeof STEPS)[number]) ? p.status : null;
          return (
            <li key={p.id} className="fd-row">
              <div className="fd-head">
                <b className="mono">{p.id}</b>
                <span className="mono faint">{p.kind}{p.launch ? " · LAUNCH" : ""}{p.via === "auto" ? " · auto" : ""}</span>
                <span>{p.aircraftName ?? "—"}</span>
                <span className={`fd-status s-${p.status}`}>{LABEL[p.status] ?? p.status}</span>
                <time className="faint" dateTime={p.statusAt}>{timeAgo(p.statusAt, now)}</time>
              </div>
              <p className="fd-steps faint">
                {steps.map((s, i) => (
                  <span key={s}>
                    {i > 0 && " → "}
                    {LABEL[s]} {timeAgo(p.timeline[s]!, now)}
                  </span>
                ))}
                {end && <span>{steps.length ? " → " : ""}{LABEL[end] ?? end} {timeAgo(p.statusAt, now)}</span>}
              </p>
              {p.reason && <p className="fd-reason">{p.reason}</p>}
              {p.recallReason && <p className="fd-reason">RECALL 사유: {p.recallReason}</p>}
              <FlightBrakes p={p} mode={data.mode} fresh={fresh[p.id]} onDone={load} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
