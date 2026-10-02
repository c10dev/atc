import type { ContextBadge } from "../../../../server/fuel-context.ts";

// FOB(ATC-81, CONTEXT SIZE는 ATC-69): AIRCRAFT 자기 연료 = 살아 있는 세션의 창에 남은 몫. FLEET 목록의 칸과 카드의 줄

export function ContextCell({ c }: { c: ContextBadge | null }) {
  return (
    <span className={`fl-r-ctx mono${c ? ` lv-${c.level}` : ""}`} title={c?.title}>
      {c ? <ContextShort short={c.short} /> : <span className="faint">—</span>}
    </span>
  );
}

// "FOB 50% · 504k/1M": 뒤쪽 창 크기는 좁은 폭에서 접힌다(ATC-366). 전체는 title에 있다
function ContextShort({ short }: { short: string }) {
  const i = short.indexOf(" · ");
  if (i < 0) return <>{short}</>;
  return (
    <>
      {short.slice(0, i)}
      <span className="fl-r-ctx-size">{short.slice(i)}</span>
    </>
  );
}

// 카드 줄: 창 크기·모델·창을 어떻게 알았나는 title(FOB·context·시각은 보이는 글에 있다)
export function ContextLine({ c }: { c: ContextBadge | null }) {
  if (!c) return null;
  const why = c.title.split("창: ")[1];
  return (
    <p className={`fl-ctx lv-${c.level}`} title={why ? `창: ${why}` : undefined}>
      {c.label}
    </p>
  );
}
