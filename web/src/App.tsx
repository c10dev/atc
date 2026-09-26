import { useCallback, useEffect, useMemo, useState } from "react";
import { alertCode, alertLabel, alertMessage, callsign, flightNumber, HANDOFF_LABEL } from "./aviation.ts";
import { buildIndex, timeAgo } from "./derive.ts";
import { MoonIcon, Starfield } from "./Starfield.tsx";
import { Ticker } from "./Ticker.tsx";
import { formatClock, useSettings } from "./settings.ts";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { useNow, useSnapshot } from "./useSnapshot.ts";
import { Airports } from "./views/Airports.tsx";
import { MapView } from "./views/Map.tsx";
import { Metrics } from "./views/Metrics.tsx";
import { Teams } from "./views/Teams.tsx";
import { Tickets } from "./views/Tickets.tsx";

const TABS = [
  { id: "radar", code: "RADAR" },
  { id: "strips", code: "STRIPS" },
  { id: "board", code: "FIDS" },
  { id: "airports", code: "AIRPORTS" },
  { id: "metrics", code: "METRICS" },
] as const;
type Tab = (typeof TABS)[number]["id"];

// 이전 주소(#map, #teams, #tickets) 북마크도 열리게 한다.
const LEGACY_HASH: Record<string, Tab> = { map: "radar", teams: "strips", tickets: "board" };

const connectionLabel = { live: "실시간", connecting: "연결 중", lost: "끊김" } as const;

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const settings = useSettings();
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
  const stands = snapshot?.claims.filter((c) => c.state === "active").length ?? 0;
  const inProgress = snapshot?.tickets.filter((t) => t.stateType === "started").length ?? 0;
  const alerts = snapshot?.alerts ?? [];
  const handoffs = snapshot?.handoffs ?? [];
  const serious = alerts.filter((a) => a.kind === "conflict" || a.kind === "orphan").length;
  const nameOf = (id: string) => {
    const session = idx?.sessionById.get(id);
    return session ? callsign(session) : id.slice(0, 8);
  };
  const subjectOf = (a: (typeof alerts)[number]) =>
    a.ticketKey ? flightNumber(a.ticketKey) : a.workspacePath?.split("/").pop();

  return (
    <div className="app">
      {settings.theme === "night" && <Starfield motion={settings.motion} meteors={settings.meteors} />}
      <header className="console">
        <div className="brand-wrap">
          <button
            className="brand"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-controls="settings"
            aria-haspopup="dialog"
            title="설정"
          >
            {settings.theme === "night" ? <MoonIcon /> : <ScopeIcon />}
            <span className="brand-text">
              <span className="brand-name">ATC</span>
              <span className="brand-sector">LOCAL CONTROL · {location.port || "80"}</span>
            </span>
            <GearIcon />
          </button>
          {settingsOpen && <SettingsPanel settings={settings} onClose={closeSettings} />}
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
              <span className="tab-code">{t.code}</span>
            </button>
          ))}
        </nav>
        <div className="readouts">
          <Readout code="AIRBORNE" value={busy} tone="radar" />
          <Readout code="STANDS" label="점유" value={stands} />
          <Readout code="ENROUTE" value={inProgress} />
          <button className="readout is-button" onClick={() => setAlertsOpen((v) => !v)} aria-expanded={alertsOpen}>
            <b>{pad(handoffs.length)}</b>
            <span>HANDOFF</span>
          </button>
          <button
            className={`readout is-button${serious ? " tone-alert" : alerts.length ? " tone-amber" : ""}`}
            onClick={() => setAlertsOpen((v) => !v)}
            aria-expanded={alertsOpen}
          >
            <b>{pad(alerts.length)}</b>
            <span>ALERTS</span>
          </button>
          <div className="readout clock">
            <Clock clock={settings.clock} />
            <span className={`link link-${connection}`}>
              <i />
              LINK <em>{connectionLabel[connection]}</em>
            </span>
          </div>
        </div>
      </header>

      {alerts.length > 0 && !alertsOpen && (
        <button className={`ticker${serious ? " is-serious" : ""}`} onClick={() => setAlertsOpen(true)} aria-label="경보 목록 펼치기">
          <span className="ticker-head">ALERT</span>
          <Ticker>
            {alerts.map((a, i) => (
              <span key={i} className={`ticker-item alert-${a.kind}`}>
                <span className="code-chip">{alertCode[a.kind]}</span>
                {alertLabel[a.kind] !== alertCode[a.kind] && `${alertLabel[a.kind]} · `}
                <span className="mono">{subjectOf(a)}</span> · {alertMessage(a, nameOf)}
              </span>
            ))}
          </Ticker>
        </button>
      )}

      {alertsOpen && alerts.length + handoffs.length > 0 && (
        <ul className="alerts">
          {alerts.map((a, i) => (
            <li key={i} className={`alert alert-${a.kind}`}>
              <span className="code-chip">{alertCode[a.kind]}</span>
              {alertLabel[a.kind] !== alertCode[a.kind] && <span className="alert-label">{alertLabel[a.kind]}</span>}
              <span className="mono">{subjectOf(a)}</span>
              <span className="muted">{alertMessage(a, nameOf)}</span>
            </li>
          ))}
          {handoffs.map((h) => (
            <li key={`${h.workspacePath}:${h.from}`} className="alert alert-handoff">
              <span className="code-chip">HO</span>
              <span className="alert-label">{HANDOFF_LABEL}</span>
              <span className="mono">{h.workspacePath.split("/").pop()}</span>
              <span className="muted">
                {nameOf(h.from)} → {nameOf(h.to)} · {timeAgo(h.at, now)}
              </span>
            </li>
          ))}
          <li className="alerts-close">
            <button onClick={() => setAlertsOpen(false)}>접기</button>
          </li>
        </ul>
      )}

      <main className="main">
        {!snapshot || !idx ? (
          <p className="empty">{connection === "lost" ? "서버에 연결할 수 없음" : "불러오는 중…"}</p>
        ) : tab === "radar" ? (
          <MapView snapshot={snapshot} idx={idx} now={now} />
        ) : tab === "strips" ? (
          <Teams snapshot={snapshot} idx={idx} now={now} />
        ) : tab === "airports" ? (
          <Airports snapshot={snapshot} />
        ) : tab === "metrics" ? (
          <Metrics refreshKey={snapshot.at.slice(0, 16)} />
        ) : (
          <Tickets snapshot={snapshot} idx={idx} now={now} />
        )}
      </main>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function Readout({ code, label, value, tone }: { code: string; label?: string; value: number; tone?: string }) {
  return (
    <div className={`readout${tone ? ` tone-${tone}` : ""}`}>
      <b>{pad(value)}</b>
      <span>
        {code}
        {label && <> <em>{label}</em></>}
      </span>
    </div>
  );
}

// 앱 전체가 매초 다시 그려지지 않도록 시계만 따로 돈다.
function Clock({ clock }: { clock: "utc" | "local" }) {
  const now = useNow(1000);
  return <b className="utc">{formatClock(now, clock, true)}</b>;
}

function GearIcon() {
  return (
    <svg className="brand-gear" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6.9 1.5h2.2l.3 1.7a5 5 0 0 1 1.3.7l1.6-.6 1.1 1.9-1.3 1.1a5 5 0 0 1 0 1.5l1.3 1.1-1.1 1.9-1.6-.6a5 5 0 0 1-1.3.7l-.3 1.7H6.9l-.3-1.7a5 5 0 0 1-1.3-.7l-1.6.6-1.1-1.9 1.3-1.1a5 5 0 0 1 0-1.5L2.6 5.2l1.1-1.9 1.6.6a5 5 0 0 1 1.3-.7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ScopeIcon() {
  return (
    <svg className="scope-icon" viewBox="0 0 26 26" aria-hidden>
      <circle cx="13" cy="13" r="11.5" fill="none" stroke="var(--radar)" strokeOpacity=".5" />
      <circle cx="13" cy="13" r="6.5" fill="none" stroke="var(--radar)" strokeOpacity=".3" />
      <g className="scope-sweep">
        <path d="M13 13 L13 1.5 A11.5 11.5 0 0 1 23 7.3 Z" fill="var(--radar)" fillOpacity=".35" />
      </g>
      <circle cx="18" cy="7" r="1.6" fill="var(--radar)" />
      <circle cx="13" cy="13" r="1.3" fill="var(--radar)" />
    </svg>
  );
}
