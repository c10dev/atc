import { useEffect, useMemo, useState } from "react";
import { alertCode, alertLabel, alertMessage, callsign, flightNumber, HANDOFF_LABEL } from "./aviation.ts";
import { buildIndex, timeAgo } from "./derive.ts";
import { MoonIcon, Starfield } from "./Starfield.tsx";
import { applyTheme, storedTheme, type Theme, THEMES } from "./theme.ts";
import { useNow, useSnapshot } from "./useSnapshot.ts";
import { Airports } from "./views/Airports.tsx";
import { MapView } from "./views/Map.tsx";
import { Teams } from "./views/Teams.tsx";
import { Tickets } from "./views/Tickets.tsx";

const TABS = [
  { id: "radar", code: "RADAR", label: "레이더" },
  { id: "strips", code: "STRIPS", label: "운항 스트립" },
  { id: "board", code: "FIDS", label: "운항 정보판" },
  { id: "airports", code: "AIRPORTS", label: "공항" },
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
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const idx = useMemo(() => (snapshot ? buildIndex(snapshot) : null), [snapshot]);

  useEffect(() => applyTheme(theme), [theme]);
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
      {theme === "night" && <Starfield />}
      <header className="console">
        <div className="brand">
          {theme === "night" ? <MoonIcon /> : <ScopeIcon />}
          <div>
            <span className="brand-name">ATC</span>
            <span className="brand-sector">LOCAL CONTROL · {location.port || "80"}</span>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
              <span className="tab-code">{t.code}</span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="theme-switch" role="radiogroup" aria-label="테마">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={theme === t.id} title={t.label} onClick={() => setTheme(t.id)}>
              {t.code}
            </button>
          ))}
        </div>
        <div className="readouts">
          <Readout code="AIRBORNE" label="비행 중" value={busy} tone="radar" />
          <Readout code="STANDS" label="주기장 점유" value={stands} />
          <Readout code="ENROUTE" label="순항 편" value={inProgress} />
          <button className="readout is-button" onClick={() => setAlertsOpen((v) => !v)} aria-expanded={alertsOpen}>
            <b>{pad(handoffs.length)}</b>
            <span>
              HANDOFF <em>이양</em>
            </span>
          </button>
          <button
            className={`readout is-button${serious ? " tone-alert" : alerts.length ? " tone-amber" : ""}`}
            onClick={() => setAlertsOpen((v) => !v)}
            aria-expanded={alertsOpen}
          >
            <b>{pad(alerts.length)}</b>
            <span>
              ALERTS <em>경보</em>
            </span>
          </button>
          <div className="readout clock">
            <UtcClock />
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
          <span className="ticker-list">
            {alerts.map((a, i) => (
              <span key={i} className={`ticker-item alert-${a.kind}`}>
                <span className="code-chip">{alertCode[a.kind]}</span>
                {alertLabel[a.kind]} · <span className="mono">{subjectOf(a)}</span> · {alertMessage(a, nameOf)}
              </span>
            ))}
          </span>
        </button>
      )}

      {alertsOpen && alerts.length + handoffs.length > 0 && (
        <ul className="alerts">
          {alerts.map((a, i) => (
            <li key={i} className={`alert alert-${a.kind}`}>
              <span className="code-chip">{alertCode[a.kind]}</span>
              <span className="alert-label">{alertLabel[a.kind]}</span>
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
        ) : (
          <Tickets snapshot={snapshot} idx={idx} now={now} />
        )}
      </main>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function Readout({ code, label, value, tone }: { code: string; label: string; value: number; tone?: string }) {
  return (
    <div className={`readout${tone ? ` tone-${tone}` : ""}`}>
      <b>{pad(value)}</b>
      <span>
        {code} <em>{label}</em>
      </span>
    </div>
  );
}

// 앱 전체가 매초 다시 그려지지 않도록 시계만 따로 돈다.
function UtcClock() {
  const now = useNow(1000);
  return <b className="utc">{new Date(now).toISOString().slice(11, 19)}Z</b>;
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
