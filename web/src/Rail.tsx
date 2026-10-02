import { ChartColumn, Globe, House, Plane, Rocket, UserRound, Users } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { apiGet } from "./api.ts";
import { Icon } from "./kit/Icon.tsx";
import "./Rail.css";

// 왼쪽 아이콘 레일(ATC-442, docs/layout.md 7절 Z1). 탭 줄이 여기로 왔다. 화면 주소(#home …)와 서랍 위에서도 탭이 바뀌는 동작은 그대로다.
// 아이콘만 보인다(툴팁 + 접근 가능한 이름). 숫자 배지는 SUPERVISOR가 해야 할 것만(HOME: QUEUE 항목, RELEASE: READY).
export interface RailScreen {
  id: string;
  code: string;
  icon: LucideIcon;
  note: string; // 툴팁에 붙는 한 줄(결정에 필요한 말은 여기에만 두지 않는다)
}
export const RAIL_SCREENS = [
  { id: "home", code: "HOME", icon: House, note: "지금 할 일" },
  { id: "release", code: "RELEASE", icon: Rocket, note: "발권 후보" },
  { id: "flights", code: "FLIGHTS", icon: Plane, note: "FLIGHT 목록·레이더" },
  { id: "fleet", code: "FLEET", icon: Users, note: "AIRCRAFT" },
  { id: "metrics", code: "METRICS", icon: ChartColumn, note: "지표" },
] as const satisfies readonly RailScreen[];

// 새 폴링 없이, 화면이 이미 받는 snapshot이 바뀔 때(refreshKey)만 읽는다. 화면 안의 숫자와 같은 길(GET)이다
function useCount(path: string, pick: (j: unknown) => number, refreshKey: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    apiGet(path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => alive && setN(pick(j)))
      .catch(() => alive && setN(0));
    return () => {
      alive = false;
    };
    // pick은 모듈 상수라 의존성에 두지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, refreshKey]);
  return n;
}
const lenOf = (key: string) => (j: unknown) => {
  const v = (j as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? v.length : 0;
};
const queueCount = lenOf("items");
const readyCount = lenOf("ready");

export function Rail({
  tab,
  onTab,
  refreshKey,
  brandTitle,
  brand,
  settingsOpen,
  onSettings,
  globeOpen,
  onGlobe,
  help,
  children,
}: {
  tab: string;
  onTab: (id: string) => void;
  refreshKey: string;
  brandTitle: string;
  brand: ReactNode;
  settingsOpen: boolean;
  onSettings: () => void;
  globeOpen: boolean;
  onGlobe: () => void;
  help: ReactNode; // HelpMenu(메뉴가 레일 옆으로 열린다)
  children?: ReactNode; // 설정 창(모달)
}) {
  const badges: Record<string, number> = {
    home: useCount("/api/supervisor/queue", queueCount, refreshKey),
    release: useCount("/api/releases", readyCount, refreshKey),
  };
  const ref = useRef<HTMLElement>(null);
  // 방향키로 레일의 단추 사이를 옮긴다(Tab으로도 닿는다). 세로 레일은 위·아래, 아래 탭 줄은 좌·우도 받는다
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(".rail-item") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <nav className="rail" aria-label="화면" ref={ref} onKeyDown={onKey}>
      <span className="rail-brand" title={brandTitle} role="img" aria-label={brandTitle}>
        {brand}
      </span>
      <div className="rail-screens">
        {RAIL_SCREENS.map((s) => {
          const n = badges[s.id] ?? 0;
          const name = n > 0 ? `${s.code} · ${n}` : s.code;
          return (
            <button key={s.id} type="button" className="rail-item" aria-current={tab === s.id ? "page" : undefined} aria-label={name} data-tip={`${s.code} · ${s.note}`} onClick={() => onTab(s.id)}>
              <Icon icon={s.icon} size={16} />
              <span className="rail-label">{s.code}</span>
              {n > 0 && (
                <span className="rail-badge" aria-hidden="true">
                  {n > 99 ? "99+" : n}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="rail-foot">
        <button type="button" className={`rail-item${globeOpen ? " is-on" : ""}`} aria-pressed={globeOpen} aria-label="GLOBE 보기 모드" data-tip="GLOBE · 지구본 보기" onClick={onGlobe}>
          <Icon icon={Globe} size={16} />
        </button>
        {help}
        <button type="button" className={`rail-item${settingsOpen ? " is-on" : ""}`} aria-expanded={settingsOpen} aria-haspopup="dialog" aria-controls="settings" aria-label="설정 · SUPERVISOR" data-tip="설정 · SUPERVISOR" onClick={onSettings}>
          <Icon icon={UserRound} size={16} />
        </button>
        {children}
      </div>
    </nav>
  );
}

