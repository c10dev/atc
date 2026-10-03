import { timeAgo } from "../derive.ts";
import { scheduleHomeOf, SLIP_LABEL, slipLineOf } from "../home-rows.ts";
import { Fold } from "../kit/Fold.tsx";
import { useScheduleHome } from "./Brakes.tsx";
import "./LateWaypoints.css";

// LATE WAYPOINTS(ATC-378, 2026-10-03 HOME에서 옮김 ATC-422): ETA가 목표일을 넘거나 목표일이 지난 WAYPOINT. 예외라 있을 때만 그린다.
// FLIGHTS 목록 맨 위의 접힌 구역 `LATE WAYPOINTS n`이다. 읽기는 `GET /api/schedule/home`(HOME이 읽던 길 그대로)
export function LateWaypoints({ refreshKey, now }: { refreshKey: string; now: number }) {
  const { data } = useScheduleHome(refreshKey);
  const { slips } = scheduleHomeOf(data);
  if (slips.length === 0) return null;
  return (
    <Fold title="LATE WAYPOINTS" count={slips.length} defaultOpen={false}>
      <ul className="lw-list">
        {slips.map((x) => (
          <li key={x.key} className="lw-row">
            <span className="tag" data-tone="amber">
              {SLIP_LABEL[x.code]}
            </span>
            <span className="lw-wp mono">
              {x.route} · <b>{x.waypoint}</b>
            </span>
            <span className="lw-line muted mono">{slipLineOf(x)}</span>
            <span className="lw-report faint">{x.reportedAt ? `OCC 보고 ${timeAgo(x.reportedAt, now)}` : "OCC 보고 전"}</span>
          </li>
        ))}
      </ul>
    </Fold>
  );
}
