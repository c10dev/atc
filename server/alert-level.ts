import type { Alert, Ticket } from "./model.ts";

// ALERT 등급(ATC-110, ECAM의 WARNING·CAUTION·ADVISORY). 상단 숫자와 ALERT 줄은 조치가 필요한 WARNING·CAUTION만 센다.
// ADVISORY는 지워지지 않는다: 목록에는 그대로 있고 숫자판에 `+n ADV`로 보인다
export type AlertLevel = "warning" | "caution" | "advisory";
export const ALERT_LEVELS: readonly AlertLevel[] = ["warning", "caution", "advisory"];
export const alertLevelLabel: Record<AlertLevel, string> = { warning: "WARNING", caution: "CAUTION", advisory: "ADVISORY" };

// orphan(NORDO STAND)은 그 STAND의 FLIGHT가 ARRIVED·CANCELLED면 정리만 하면 되는 ADVISORY, 아니면(FLIGHT 없음 포함) CAUTION
export function alertLevel(
  a: Pick<Alert, "kind" | "workspacePath"> & { key?: string },
  idx: { wsByPath: ReadonlyMap<string, { ticketKey: string | null }>; ticketByKey: ReadonlyMap<string, Pick<Ticket, "stateType">> },
): AlertLevel {
  switch (a.kind) {
    case "conflict":
    case "stranded":
      return "warning";
    case "orphan": {
      const key = a.workspacePath ? idx.wsByPath.get(a.workspacePath)?.ticketKey : null;
      const type = key ? idx.ticketByKey.get(key)?.stateType : undefined;
      return type === "completed" || type === "canceled" ? "advisory" : "caution";
    }
    case "health":
      return a.key?.startsWith("health|CONTROL-BLOCKED|") ? "warning" : "caution"; // 관제 세션이 blocked로 끝난 규칙 위반(ATC-352)
    case "no-workspace":
    case "unattended":
      return "caution";
  }
}
