import type { FollowBundle, FollowRow } from "../../server/follow.ts";
import type { SupervisorAlert } from "../../server/supervisor-alerts.ts";

// HOME(ATC-377)가 그릴 줄을 고르는 순수 함수. 새 규칙은 없다: 알림과 FOLLOW 보드가 이미 센 것에서 한 곳에만 둘 것을 고른다.

// WARNING·CAUTION 가운데 조건(dest alerts)만. 막힌 FLIGHT 줄(follow|stuck)은 STUCK이 이미 보이니 여기서 뺀다
export const homeAlertsOf = (items: readonly SupervisorAlert[]): SupervisorAlert[] =>
  items.filter((a) => (a.level === "warning" || a.level === "caution") && a.dest === "alerts" && !a.key.startsWith("follow|stuck|"));

// 막힌 FLIGHT 줄: 끝나지 않은 막힌 줄, 같은 FLIGHT는 한 번(번들이 겹치면 먼저 나온 것)
export function stuckRowsOf(bundles: readonly Pick<FollowBundle, "rows">[]): FollowRow[] {
  const seen = new Set<string>();
  return bundles.flatMap((b) => b.rows).filter((r) => r.stuck && !r.finished && !seen.has(r.key) && (seen.add(r.key), true));
}

// ── SCHEDULE을 나눈 뒤 HOME에 남은 것(ATC-378, docs/layout.md Y3) ──
// 서버 `GET /api/schedule/home`의 모양(server/schedule.ts)과 같다. LATE WAYPOINTS는 예외라 있을 때만 그린다
export interface HomeSlip {
  key: string;
  code: "target-passed" | "eta-after-target" | "linear-overdue";
  route: string;
  waypoint: string;
  targetDate: string | null;
  eta: string | null;
  days: number | null;
  reportedAt: string | null;
}
export interface HomeCloseManual {
  id: string;
  flight: string | null;
  status: string;
  statusAt: string;
  title: string | null;
  url: string | null;
  pr: { repo: string; number: number; url: string };
}
export interface ScheduleHome {
  mode: "shadow" | "approval";
  slips: HomeSlip[] | null; // 마일스톤을 못 읽었으면 null
  closeManual: HomeCloseManual[];
}

export const SLIP_LABEL: Record<HomeSlip["code"], string> = { "target-passed": "목표일 지남", "eta-after-target": "ETA 늦음", "linear-overdue": "Linear overdue" };

// 한 줄: `목표 2026-10-05 · ETA 2026-10-09 · 4일`
export const slipLineOf = (x: Pick<HomeSlip, "targetDate" | "eta" | "days">): string =>
  `목표 ${x.targetDate ?? "—"} · ETA ${x.eta ?? "모름"}${x.days != null ? ` · ${x.days}일` : ""}`;

// PR 한 줄: `vocado_nextjs#400`
export const prNameOf = (p: Pick<HomeCloseManual["pr"], "repo" | "number">): string => `${p.repo.split("/").pop()}#${p.number}`;

// 읽은 값 → 그릴 것. 아무것도 그릴 게 없으면 둘 다 빈 목록(정상이면 HOME에 아무것도 없다, design-language 원칙 1)
export const scheduleHomeOf = (d: ScheduleHome | null): { slips: HomeSlip[]; closeManual: HomeCloseManual[] } => ({ slips: d?.slips ?? [], closeManual: d?.closeManual ?? [] });
