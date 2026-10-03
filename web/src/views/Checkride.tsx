import { compareRegistration } from "../../../server/registration.ts";
import { useCallback, useEffect, useState } from "react";
import type { CheckrideRow, CheckrideStatus } from "../../../server/checkride.ts";
import { flightNumber } from "../aviation.ts";
import "./Checkride.css";
import { apiGet, apiSend } from "../api.ts";

// CHECKRIDE: AIRCRAFT × TYPE RATING마다 LOGBOOK 근거와 부여·재검토 추천(docs/fleet.md 8.2).
// 추천만 한다. 부여·회수는 SUPERVISOR가 누를 때만 fleet.json에 쓴다.

const ORDER: CheckrideStatus[] = ["REVIEW", "GRANT", "BLOCKED", "BUILDING", "HOLDS"];
const LABEL: Record<CheckrideStatus, string> = {
  GRANT: "부여 추천",
  REVIEW: "재검토 추천",
  BLOCKED: "추천 안 함",
  BUILDING: "근거 쌓는 중",
  HOLDS: "보유",
};
const SOURCE = { label: "라벨", schedule: "SCHEDULE" };

export function Checkride({ refreshKey, onChanged }: { refreshKey: string; onChanged: () => void }) {
  const [rows, setRows] = useState<CheckrideRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/fleet/checkride");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRows(data.rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const act = async (r: CheckrideRow, action: "grant" | "revoke") => {
    const what = action === "grant" ? "부여" : "회수";
    if (!confirm(`${r.callsign}(${r.registration})${action === "grant" ? "에" : "의"} ${r.rating}를 ${what}할까요?\n\n${r.reason}`)) return;
    setBusy(`${r.registration}:${r.rating}`);
    try {
      const res = await apiSend("POST", `/api/fleet/${encodeURIComponent(r.registration)}/checkride`, { rating: r.rating, action });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // 볼 것만: 추천·막힘은 늘, 쌓는 중·보유는 근거가 있을 때만
  const shown = (rows ?? [])
    .filter((r) => r.status === "GRANT" || r.status === "REVIEW" || r.status === "BLOCKED" || r.evidence.length > 0)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || compareRegistration(a.registration, b.registration));

  return (
    <section className="cr" aria-labelledby="cr-title">
      <h2 className="label cr-title" id="cr-title">
        CHECKRIDE <em>LOGBOOK으로 본 TYPE RATING 근거 · 추천만 하고, 부여·회수는 SUPERVISOR가 누른다</em>
      </h2>
      {error && (
        <p className="fl-error" role="alert">
          {error}
        </p>
      )}
      {!rows ? (
        <p className="faint">불러오는 중…</p>
      ) : !shown.length ? (
        <p className="faint">근거가 된 FLIGHT가 아직 없음 — rating 라벨이나 받아들인 CLASSIFY가 있는 FLIGHT가 ARRIVED하면 쌓인다</p>
      ) : (
        <ul className="cr-rows">
          {shown.map((r) => (
            <li key={`${r.registration}:${r.rating}`} className={`cr-row st-${r.status}`}>
              <div className="cr-head">
                <b className="cr-callsign">{r.callsign}</b>
                <span className="mono faint">{r.registration}</span>
                <span className={`chip r-${r.rating}`}>{r.rating}</span>
                <span className="cr-status">{LABEL[r.status]}</span>
                {r.status === "GRANT" && (
                  <button className="btn is-primary" disabled={busy !== null} onClick={() => act(r, "grant")}>
                    부여
                  </button>
                )}
                {r.status === "REVIEW" && (
                  <button className="btn is-danger" disabled={busy !== null} onClick={() => act(r, "revoke")}>
                    회수
                  </button>
                )}
              </div>
              <p className="cr-reason">{r.reason}</p>
              {r.evidence.length > 0 && (
                <details className="cr-evidence">
                  <summary>근거 {r.evidence.length}건 (최근 {r.grant.days}일)</summary>
                  <ul>
                    {r.evidence.map((e) => (
                      <li key={e.key}>
                        <a href={e.pr?.url ?? e.standFree?.evidence.url ?? undefined} target="_blank" rel="noreferrer" title={e.pr?.title ?? e.standFree?.evidence.note}>
                          {flightNumber(e.flight)}
                        </a>
                        <span className="faint">{e.pr ? `#${e.pr.number}` : "STAND 없음"}</span>
                        <span className="cr-source">{e.source === "schedule" ? `${SOURCE.schedule} ${e.scheduleId ?? ""}` : SOURCE.label}</span>
                        <span className="faint">Codex {e.codexFindings}</span>
                        {e.reverted && <span className="fl-bad">REVERTED</span>}
                        <span className="faint cr-date">{e.arrivedAt.slice(5, 10)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
