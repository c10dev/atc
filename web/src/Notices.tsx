import { Bell, GitPullRequest } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ack, openAlert, useAlerts } from "./alerts-runtime.ts";
import { apiGet } from "./api.ts";
import { Icon } from "./kit/Icon.tsx";
import type { NoticeGroup, Notices } from "../../server/notices.ts";
import "./Notices.css";

// 알림 세 개(ATC-447, docs/layout.md 7.2·E4): Linear·GitHub·atc. 무엇이 들어가는지는 서버(GET /api/notices)가 정하고 여기는 그리기만 한다.
// 숫자는 항목 수만. atc는 조치가 필요하고(action) 아직 확인(ACK)하지 않은 것만 센다(옛 BELL과 같은 규칙).

const EMPTY_GROUP: NoticeGroup = { total: 0, items: [] };
const NONE: Notices = { v: 1, at: "", linear: EMPTY_GROUP, github: EMPTY_GROUP, atc: EMPTY_GROUP };

// 스냅샷이 바뀌거나 알림 수가 달라졌을 때만 다시 읽는다(새 폴링 없음)
export function useNotices(refreshKey: string): Notices {
  const { items } = useAlerts();
  const [v, setV] = useState<Notices>(NONE);
  const key = `${refreshKey}|${items.length}`;
  useEffect(() => {
    let alive = true;
    apiGet("/api/notices")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Notices) => alive && setV(j))
      .catch(() => {}); // 못 읽으면 지난 값을 그대로 둔다
    return () => {
      alive = false;
    };
  }, [key]);
  return v;
}

// 화면에 보이는 숫자: linear·github는 서버의 수, atc는 조치가 필요하고 확인하지 않은 것
export function noticeCounts(n: Notices, acked: readonly string[]): { linear: number; github: number; atc: number; total: number } {
  const atc = n.atc.items.filter((x) => x.action && !acked.includes(x.key)).length;
  return { linear: n.linear.total, github: n.github.total, atc, total: n.linear.total + n.github.total + atc };
}

const LinearMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="ico">
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4.2 9.6 9.6 4.2M4.2 12.1l7.9-7.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

type Which = "linear" | "github" | "atc";
const META: Record<Which, { label: string; title: string; icon: ReactNode }> = {
  linear: { label: "Linear", title: "Linear 알림", icon: <LinearMark /> },
  github: { label: "GitHub", title: "GitHub 알림", icon: <Icon icon={GitPullRequest} size={16} /> },
  atc: { label: "atc", title: "atc 알림", icon: <Icon icon={Bell} size={16} /> },
};

export function NoticeIcons({ notices, onPick }: { notices: Notices; onPick?: () => void }) {
  const { acked, items } = useAlerts();
  const [open, setOpen] = useState<Which | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const btns = useRef<Partial<Record<Which, HTMLButtonElement | null>>>({});
  const counts = noticeCounts(notices, acked);

  // Esc는 목록만 닫고 초점을 아이콘으로 돌려준다. 사이드바(좁은 폭)의 Esc보다 먼저 받아 그쪽이 같이 닫히지 않게 한다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      btns.current[open]?.focus();
      setOpen(null);
    };
    const onPointer = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const group = open ? notices[open] : null;
  const activate = (link: string, key: string) => {
    if (open === "atc") {
      const a = items.find((x) => x.key === key);
      if (a) openAlert(a);
      else location.hash = link;
    } else if (/^https?:/.test(link)) window.open(link, "_blank", "noopener,noreferrer");
    else location.hash = link;
    setOpen(null);
    onPick?.();
  };

  return (
    <div className="sb-notify" ref={wrap}>
      {(Object.keys(META) as Which[]).map((w) => (
        <button
          key={w}
          type="button"
          ref={(el) => void (btns.current[w] = el)}
          className={`notice-btn${open === w ? " is-open" : ""}${counts[w] ? " has-count" : ""}${w === "atc" && notices.atc.items.some((x) => x.action && !acked.includes(x.key)) ? " is-act" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open === w}
          aria-controls={open === w ? "notice-list" : undefined}
          aria-label={`${META[w].title} ${counts[w]}건`}
          title={META[w].title}
          onClick={() => setOpen((v) => (v === w ? null : w))}
        >
          {META[w].icon}
          {counts[w] > 0 && <b className="notice-n mono">{counts[w] > 99 ? "99+" : counts[w]}</b>}
        </button>
      ))}
      {open && group && (
        <div className="notice-list" id="notice-list" role="dialog" aria-label={META[open].title}>
          <header>
            <span className="mono">{META[open].label}</span>
            {open === "atc" && counts.atc > 0 && (
              <button type="button" onClick={() => ack(notices.atc.items.filter((x) => x.action).map((x) => x.key))}>
                모두 확인
              </button>
            )}
          </header>
          {group.items.length === 0 ? (
            <p className="notice-empty faint">평소 상태</p>
          ) : (
            <ul>
              {group.items.map((n) => (
                <li key={n.key} className={`notice-item${open === "atc" && acked.includes(n.key) ? " is-acked" : ""}`}>
                  <button type="button" className="notice-open" onClick={() => activate(n.link, n.key)} autoFocus={n === group.items[0]}>
                    <span className="notice-text">{n.text}</span>
                    <span className="notice-src mono">
                      {n.source}
                      {n.at ? ` · ${new Date(n.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}
                    </span>
                  </button>
                  {open === "atc" && n.action && !acked.includes(n.key) && (
                    <button type="button" className="notice-ack mono" onClick={() => ack([n.key])} aria-label="확인">
                      ACK
                    </button>
                  )}
                </li>
              ))}
              {group.total > group.items.length && <li className="notice-more faint">외 {group.total - group.items.length}건</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// 사이드바를 접었을 때 접기 단추 옆에 놓는 합계 하나(E4). 누르면 사이드바를 편다
export function NoticeTotal({ notices, onOpen }: { notices: Notices; onOpen: () => void }) {
  const { acked } = useAlerts();
  const { total } = noticeCounts(notices, acked);
  return (
    <button type="button" className={`notice-total${total ? " has-count" : ""}`} onClick={onOpen} aria-label={`알림 ${total}건, 사이드바를 펴서 보기`} title="알림 (사이드바를 펴서 본다)">
      <Icon icon={Bell} size={16} />
      <b className="notice-n mono">{total}</b>
    </button>
  );
}
