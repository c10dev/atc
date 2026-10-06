import { useEffect, useState } from "react";
import type { LivenessData } from "../../../server/job-liveness-run.ts";
import { type AutoView, type DispatchMisfire, type GapView, type LagView, type OrphanView, LANE_OF_KIND, laneRowsOf, recentLinesOf, WHY_LABEL } from "../misfire-rows.ts";
import { apiGet } from "../api.ts";
import { timeAgo } from "../derive.ts";
import { AutoMisfire } from "./AutoMisfire.tsx";
import { Empty } from "../kit/Empty.tsx";
import { Loading } from "../kit/Loading.tsx";
import { TableScroll } from "../kit/TableScroll.tsx";

// METRICS → MISFIRE(ATC-380, docs/layout.md Y5): 사람 없이 도는 레인(DISPATCH, SCHEDULE, FLEET PLAN)이 한 일 가운데 나중에 틀렸다고 드러난 몫.
// 레인마다 한 줄(한 일·misfire·몫), 그 밑에 DISPATCH의 날짜별 줄과 SCHEDULE·FLEET PLAN의 최근 misfire. 읽기만 한다.
const DAYS = 7;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export function MetricsMisfire({ refreshKey }: { refreshKey: string }) {
  const now = Date.now();
  const [dispatch, setDispatch] = useState<DispatchMisfire | null>(null);
  const [auto, setAuto] = useState<AutoView | null>(null);
  const [gap, setGap] = useState<GapView | null>(null);
  const [orphan, setOrphan] = useState<OrphanView | null>(null);
  const [lag, setLag] = useState<LagView | null>(null);
  const [live, setLive] = useState<LivenessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const get = <T,>(path: string, set: (v: T) => void) =>
      apiGet(path)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: T) => alive && set(d));
    Promise.all([get<DispatchMisfire>(`/api/dispatch/misfire?days=${DAYS}`, setDispatch), get<AutoView>(`/api/autonomy/auto?days=${DAYS}`, setAuto), get<GapView>(`/api/landing-gap?days=${DAYS}`, setGap), get<OrphanView>(`/api/orphan-flight?days=${DAYS}`, setOrphan), get<LagView>(`/api/event-loop-lag?days=${DAYS}`, setLag), get<LivenessData>("/api/job-liveness", setLive)])
      .then(() => alive && setError(null))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const lanes = laneRowsOf(dispatch, auto, gap, orphan, lag);
  const recent = recentLinesOf(auto);
  return (
    <>
      <div className="toolbar">
        <span className="muted">서버가 사람 없이 한 일 가운데 나중에 틀렸다고 드러난 몫 · 지난 {DAYS}일(UTC)</span>
      </div>
      {error && (
        <p className="mx-error" role="alert">
          일부를 불러오지 못함: {error}
        </p>
      )}
      {lanes.length === 0 ? (
        !error && <Loading>불러오는 중…</Loading>
      ) : (
        <TableScroll label="레인별 MISFIRE 표">
        <table className="kit-table" aria-label="레인별 MISFIRE">
          <thead>
            <tr>
              <th scope="col">LANE</th>
              <th scope="col">스위치</th>
              <th scope="col" className="num">한 일</th>
              <th scope="col" className="num">MISFIRE</th>
              <th scope="col" className="num">몫</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((l) => (
              <tr key={l.lane}>
                <td className="mono">{l.lane}</td>
                <td className="mono">{l.switch ? l.switch.toUpperCase() : "—"}</td>
                <td className="num">
                  {l.applied}
                  {l.failed > 0 && <span className="muted"> · 실패 {l.failed}</span>}
                </td>
                <td className="num">{l.misfires}</td>
                <td className="num">{pct(l.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      )}
      {dispatch && typeof dispatch.total.crossAccount === "number" && (
        <p className="muted" data-testid="cross-account-closed">
          ACCOUNT 불일치로 닫은 DISPATCH 카드 <span className="mono">{dispatch.total.crossAccount}</span>건 · 지난 {DAYS}일 (OCC가 닿지 못하는 AIRCRAFT의 카드, 스위치 ACCOUNT RELEASE)
        </p>
      )}
      {dispatch && typeof dispatch.total.displaced === "number" && (
        <p className="muted" data-testid="contest-displaced">
          "더 나은 배정"으로 밀려난 DISPATCH 카드 <span className="mono">{dispatch.total.displaced}</span>건 · 그중 밀어낸 카드가 닫힌 MISFIRE <span className="mono">{dispatch.total.displacedMisfires ?? 0}</span>건 · 지난 {DAYS}일 (스위치 CONTEST GUARD)
        </p>
      )}
      {dispatch && typeof dispatch.total.launchStopped === "number" && (
        <p className="muted" data-testid="launch-stopped">
          LAUNCH 직후 "AIRCRAFT 멈춤"으로 거둔 LAUNCH 카드 <span className="mono">{dispatch.total.launchStopped}</span>건 · 지난 {DAYS}일 (launch-then-stopped, 0이어야 한다)
        </p>
      )}
      {live && (
        <p className="muted" data-testid="job-liveness">
          job이 사라져 다시 LAUNCH하거나 다른 AIRCRAFT로 넘긴 승인 카드 <span className="mono">{live.last7d.misfires}</span>건(LAUNCH {live.last7d.relaunch} · 넘김 {live.last7d.handoff}) · 사라진 job {live.last7d.gone} · init에서 죽은 LAUNCH {live.last7d.initDeath} · 지난 {DAYS}일 (스위치 JOB LIVENESS {live.mode.toUpperCase()})
        </p>
      )}
      <AutoMisfire refreshKey={refreshKey} />
      {recent.length > 0 && (
        <>
          <h2 className="label">
            SCHEDULE·FLEET PLAN MISFIRE <em>최근 {recent.length}건</em>
          </h2>
          <ul className="dp-misfire">
            {recent.map((m) => (
              <li key={`${m.kind}|${m.id}|${m.why}`}>
                <span className="mono">{LANE_OF_KIND[m.kind]}</span> <span className="mono">{m.id}</span> {m.what}
                {m.flight ? ` · ${m.flight}` : ""}
                {m.aircraft ? ` · ${m.aircraft}` : ""} — {WHY_LABEL[m.why]}
                {m.detail ? <span className="muted"> · {m.detail}</span> : null} <span className="faint">{timeAgo(m.at, now)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
