import { AlertBell, SoundLockChip } from "./AlertBell.tsx";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showNewVersion } from "../../server/version.ts";
import { alertCode, alertLabel, alertLevel, alertLevelLabel, alertMessage, callsign, flightNumber, groupAlerts, HANDOFF_LABEL } from "./aviation.ts";
import { buildIndex, timeAgo } from "./derive.ts";
import { ControlStrip } from "./ControlStrip.tsx";
import { NewVersionBar } from "./NewVersion.tsx";
import { UpdateBar, useUpdate } from "./UpdateBar.tsx";
import { MoonIcon, Starfield } from "./Starfield.tsx";
import { Ticker } from "./Ticker.tsx";
import { formatClock, useSettings } from "./settings.ts";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { lazyTab, TabBoundary, TabLoading } from "./lazyTab.tsx";
import { useNow, useSnapshot } from "./useSnapshot.ts";
import { MapView } from "./views/Map.tsx";
import type { Snapshot } from "../../server/model.ts";
import type { Index } from "./derive.ts";

// 첫 화면(RADAR)만 메인 번들에 두고, 나머지 탭은 처음 열 때 불러온다(청크마다 그 탭의 CSS·라이브러리까지, 예: DOCS의 marked).
type SnapProps = { snapshot: Snapshot; idx: Index; now: number };
const Teams = lazyTab<SnapProps>(() => import("./views/Teams.tsx"), "Teams");
const Tickets = lazyTab<SnapProps>(() => import("./views/Tickets.tsx"), "Tickets");
const Airports = lazyTab<{ snapshot: Snapshot }>(() => import("./views/Airports.tsx"), "Airports");
const Fleet = lazyTab<{ refreshKey: string; snapshot: Snapshot }>(() => import("./views/fleet/Fleet.tsx"), "Fleet");
const Metrics = lazyTab<{ refreshKey: string; snapshot: Snapshot }>(() => import("./views/Metrics.tsx"), "Metrics");
const Network = lazyTab<{ refreshKey: string }>(() => import("./views/Network.tsx"), "Network");
const Dispatch = lazyTab<{ refreshKey: string; now: number }>(() => import("./views/Dispatch.tsx"), "Dispatch");
const Schedule = lazyTab<{ refreshKey: string; now: number }>(() => import("./views/Schedule.tsx"), "Schedule");
const Docs = lazyTab<Record<string, never>>(() => import("./views/Docs.tsx"), "Docs");

const TABS = [
  { id: "radar", code: "RADAR" },
  { id: "strips", code: "STRIPS" },
  { id: "board", code: "FIDS" },
  { id: "airports", code: "AIRPORTS" },
  { id: "fleet", code: "FLEET" },
  { id: "metrics", code: "METRICS" },
  { id: "network", code: "NETWORK" },
  { id: "dispatch", code: "DISPATCH" },
  { id: "schedule", code: "SCHEDULE" },
  { id: "docs", code: "DOCS" },
] as const;
type Tab = (typeof TABS)[number]["id"];

// 이전 주소(#map, #teams, #tickets) 북마크도 열리게 한다.
const LEGACY_HASH: Record<string, Tab> = { map: "radar", teams: "strips", tickets: "board" };

const connectionLabel = { live: "실시간", connecting: "연결 중", lost: "끊김" } as const;

// 주소 #탭 또는 #탭/하위(예: #docs/requesting). 하위 경로는 그 탭이 읽는다.
function initialTab(): Tab {
  const hash = location.hash.slice(1).split("/")[0];
  if (hash in LEGACY_HASH) return LEGACY_HASH[hash];
  return TABS.some((t) => t.id === hash) ? (hash as Tab) : "radar";
}

export function App({ build }: { build: string }) {
  const { snapshot, connection, serverBuild } = useSnapshot();
  const now = useNow();
  const update = useUpdate(connection);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const settings = useSettings();
  const idx = useMemo(() => (snapshot ? buildIndex(snapshot) : null), [snapshot]);

  useEffect(() => {
    // 같은 탭의 하위 경로(#docs/requesting)는 그대로 둔다
    if (location.hash.slice(1).split("/")[0] !== tab) history.replaceState(null, "", `#${tab}`);
  }, [tab]);
  // 탭 줄이 가로로 넘칠 때 선택한 탭이 보이게(글꼴·수치가 늦게 들어와 폭이 바뀌어도)
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const show = () => el.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const ro = new ResizeObserver(show);
    ro.observe(el);
    return () => ro.disconnect();
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
  // 등급(ATC-110): 숫자와 ALERT 줄은 조치가 필요한 WARNING·CAUTION만. ADVISORY는 목록과 `+n ADV`에 남는다
  const levelOf = (a: (typeof alerts)[number]) => (idx ? alertLevel(a, idx) : "caution");
  const actionable = alerts.filter((a) => levelOf(a) !== "advisory");
  const serious = actionable.filter((a) => levelOf(a) === "warning").length;
  const advisories = alerts.length - actionable.length;
  const nameOf = (id: string) => {
    const session = idx?.sessionById.get(id);
    return session ? callsign(session) : id.slice(0, 8);
  };
  const subjectOf = (a: (typeof alerts)[number]) =>
    a.ticketKey ? flightNumber(a.ticketKey) : (a.workspacePath?.split("/").pop() ?? a.sessionIds?.map(nameOf).join(", "));

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
          {settingsOpen && <SettingsPanel settings={settings} snapshot={snapshot} onClose={closeSettings} />}
        </div>
        <nav className="tabs" role="tablist" ref={tabsRef}>
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
            className={`readout is-button${serious ? " tone-alert" : actionable.length ? " tone-amber" : ""}`}
            onClick={() => setAlertsOpen((v) => !v)}
            aria-expanded={alertsOpen}
          >
            <b>{pad(actionable.length)}</b>
            <span>
              ALERTS{advisories > 0 && <em className="adv-count"> +{advisories} ADV</em>}
            </span>
          </button>
          <AlertBell />
          <SoundLockChip />
          <div className="readout clock">
            <Clock clock={settings.clock} />
            <span className={`link link-${update.kind === "restarting" ? "restarting" : connection}`}>
              <i />
              LINK <em>{update.kind === "restarting" ? "재시작" : connectionLabel[connection]}</em>
            </span>
          </div>
        </div>
        <ControlStrip snapshot={snapshot} now={now} />
      </header>

      <UpdateBar update={update} />
      <NewVersionBar own={build} server={serverBuild} />

      {actionable.length > 0 && !alertsOpen && (
        <button className={`ticker${serious ? " is-serious" : ""}`} onClick={() => setAlertsOpen(true)} aria-label="경보 목록 펼치기">
          <span className="ticker-head">ALERT</span>
          <Ticker>
            {actionable.map((a, i) => (
              <span key={i} className={`ticker-item alert-${a.kind} lv-${levelOf(a)}`}>
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
          {groupAlerts(alerts, levelOf).map((g) => (
            <Fragment key={g.level}>
              <li className={`alert-group lv-${g.level}`}>{alertLevelLabel[g.level]}</li>
              {g.alerts.map((a, i) => (
                <li key={i} className={`alert alert-${a.kind} lv-${g.level}`}>
                  <span className="code-chip">{alertCode[a.kind]}</span>
                  {alertLabel[a.kind] !== alertCode[a.kind] && <span className="alert-label">{alertLabel[a.kind]}</span>}
                  <span className="mono">{subjectOf(a)}</span>
                  <span className="muted">{alertMessage(a, nameOf)}</span>
                </li>
              ))}
            </Fragment>
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
        ) : (
          // 탭마다 오류 경계를 새로 둔다(한 탭의 오류·못 불러온 청크가 다른 탭을 막지 않게)
          <TabBoundary key={tab} stale={showNewVersion(build, serverBuild, null)}>
            <Suspense fallback={<TabLoading />}>{tabView(tab, snapshot, idx, now)}</Suspense>
          </TabBoundary>
        )}
      </main>
    </div>
  );
}

// 탭 이름 → view. 하위 경로(#docs/requesting)는 그 view가 location.hash에서 읽는다.
function tabView(tab: Tab, snapshot: Snapshot, idx: Index, now: number) {
  const refreshKey = snapshot.at.slice(0, 16);
  switch (tab) {
    case "radar":
      return <MapView snapshot={snapshot} idx={idx} now={now} />;
    case "strips":
      return <Teams snapshot={snapshot} idx={idx} now={now} />;
    case "airports":
      return <Airports snapshot={snapshot} />;
    case "fleet":
      return <Fleet refreshKey={refreshKey} snapshot={snapshot} />;
    case "metrics":
      return <Metrics refreshKey={refreshKey} snapshot={snapshot} />;
    case "network":
      return <Network refreshKey={refreshKey} />;
    case "dispatch":
      return <Dispatch refreshKey={refreshKey} now={now} />;
    case "schedule":
      return <Schedule refreshKey={refreshKey} now={now} />;
    case "docs":
      return <Docs />;
    default:
      return <Tickets snapshot={snapshot} idx={idx} now={now} />;
  }
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
