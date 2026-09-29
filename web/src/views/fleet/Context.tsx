import type { ContextBadge } from "../../../../server/fuel-context.ts";

// FOB(ATC-81, CONTEXT SIZE는 ATC-69): AIRCRAFT 자기 연료 = 살아 있는 세션의 창에 남은 몫. FLEET 목록의 칸과 카드의 줄

export function ContextCell({ c }: { c: ContextBadge | null }) {
  return (
    <span className={`fl-r-ctx mono${c ? ` lv-${c.level}` : ""}`} title={c?.title ?? "살아 있는 세션의 최근 7일 기록 없음"}>
      {c ? c.short : <span className="faint">—</span>}
    </span>
  );
}

export function ContextLine({ c }: { c: ContextBadge | null }) {
  if (!c) return null;
  return (
    <p className={`fl-ctx lv-${c.level}`} title={c.title}>
      {c.label}
    </p>
  );
}
