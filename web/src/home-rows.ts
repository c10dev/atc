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
