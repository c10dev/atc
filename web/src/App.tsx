import { useEffect, useMemo, useState } from "react";
import { alertLabel, alertMessage, callsign, flightNumber } from "./aviation.ts";
import { buildIndex } from "./derive.ts";
import { useNow, useSnapshot } from "./useSnapshot.ts";
import { MapView } from "./views/Map.tsx";
import { Teams } from "./views/Teams.tsx";
import { Tickets } from "./views/Tickets.tsx";

const TABS = [
  { id: "radar", label: "레이더" },
  { id: "strips", label: "운항 스트립" },
  { id: "board", label: "운항 정보판" },
] as const;
type Tab = (typeof TABS)[number]["id"];

// 이전 주소(#map, #teams, #tickets) 북마크도 열리게 한다.
const LEGACY_HASH: Record<string, Tab> = { map: "radar", teams: "strips", tickets: "board" };

function initialTab(): Tab {
  const hash = location.hash.slice(1);
  if (hash in LEGACY_HASH) return LEGACY_HASH[hash];
  return TABS.some((t) => t.id === hash) ? (hash as Tab) : "radar";
}

export function App() {
  const { snapshot, connection } = useSnapshot();
  const now = useNow();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const idx = useMemo(() => (snapshot ? buildIndex(snapshot) : null), [snapshot]);

  useEffect(() => {
    if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  }, [tab]);
  useEffect(() => {
    const onHash = () => setTab(initialTab());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const busy = snapshot?.sessions.filter((s) => s.status === "busy").length ?? 0;
  const inProgress = snapshot?.tickets.filter((t) => t.stateType === "started").length ?? 0;
  const alerts = snapshot?.alerts ?? [];
  const serious = alerts.filter((a) => a.kind === "conflict" || a.kind === "orphan").length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className={`live live-${connection}`} title={{ live: "실시간 연결됨", connecting: "연결 중", lost: "연결 끊김" }[connection]} />
          atc
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="stats">
          <Stat label="비행 중" value={busy} tone="busy" />
          <Stat label="주기장 점유" value={snapshot?.claims.length ?? 0} />
          <Stat label="순항 편" value={inProgress} />
          <button
            className={`stat stat-button${serious ? " tone-dead" : alerts.length ? " tone-warn" : ""}`}
            onClick={() => setAlertsOpen((v) => !v)}
            aria-expanded={alertsOpen}
          >
            <span className="stat-value">{alerts.length}</span>
            <span className="stat-label">경보</span>
          </button>
        </div>
      </header>

      {alertsOpen && alerts.length > 0 && (
        <ul className="alerts">
          {alerts.map((a, i) => (
            <li key={i} className={`alert alert-${a.kind}`}>
              <span className="tag">{alertLabel[a.kind]}</span>
              <span className="mono">{a.ticketKey ? flightNumber(a.ticketKey) : a.workspacePath?.split("/").pop()}</span>
              <span className="muted">
                {alertMessage(a, (id) => {
                  const session = idx?.sessionById.get(id);
                  return session ? callsign(session) : id.slice(0, 8);
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      <main className="main">
        {!snapshot || !idx ? (
          <p className="empty">{connection === "lost" ? "서버에 연결할 수 없음" : "불러오는 중…"}</p>
        ) : tab === "radar" ? (
          <MapView snapshot={snapshot} idx={idx} now={now} />
        ) : tab === "strips" ? (
          <Teams snapshot={snapshot} idx={idx} now={now} />
        ) : (
          <Tickets snapshot={snapshot} idx={idx} now={now} />
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
