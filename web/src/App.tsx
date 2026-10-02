import { AlertBell, SoundLockChip } from "./AlertBell.tsx";
import { FollowNext } from "./FollowNext.tsx";
import { canonicalHash } from "./legacy-hash.ts";
import { SinceLook } from "./SinceLook.tsx";
import { drawerOfHash, type DrawerRef } from "../../server/detail.ts";
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showNewVersion } from "../../server/version.ts";
import { alertCode, alertLabel, alertLevel, alertLevelLabel, alertMessage, callsign, flightNumber, groupAlerts, HANDOFF_LABEL } from "./aviation.ts";
import { buildIndex, timeAgo } from "./derive.ts";
import { ControlStrip } from "./ControlStrip.tsx";
import { NewVersionBar } from "./NewVersion.tsx";
import { UpdateBar, useUpdate } from "./UpdateBar.tsx";
import { SupervisorPairing, useSupervisorAuth } from "./SupervisorPairing.tsx";
import { MoonIcon, Starfield } from "./Starfield.tsx";
import { Ticker } from "./Ticker.tsx";
import { formatClock, useSettings } from "./settings.ts";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { HelpMenu } from "./HelpMenu.tsx";
import { GlobeMode } from "./GlobeMode.tsx";
import { Globe as GlobeIcon } from "lucide-react";
import { Icon } from "./kit/Icon.tsx";
import type { SettingsTab } from "../../server/settings-policy.ts";
import { lazyTab, TabBoundary, TabLoading } from "./lazyTab.tsx";
import { useNow, useSnapshot } from "./useSnapshot.ts";
import { useDuty } from "./useDuty.ts";
import { readoutState } from "../../server/duty-chat.ts";
import type { Snapshot } from "../../server/model.ts";
import type { Index } from "./derive.ts";
import { Empty } from "./kit/Empty.tsx";

// 첫 화면(RADAR)만 메인 번들에 두고, 나머지 탭은 처음 열 때 불러온다(청크마다 그 탭의 CSS·라이브러리까지, 예: DOCS의 marked).
const Flights = lazyTab<{ snapshot: Snapshot; idx: Index; now: number; refreshKey: string }>(() => import("./views/Flights.tsx"), "Flights");
const Fleet = lazyTab<{ refreshKey: string; snapshot: Snapshot }>(() => import("./views/fleet/Fleet.tsx"), "Fleet");
const Metrics = lazyTab<{ refreshKey: string; snapshot: Snapshot }>(() => import("./views/Metrics.tsx"), "Metrics");
const Release = lazyTab<{ refreshKey: string }>(() => import("./views/Release.tsx"), "Release");
const Home = lazyTab<{ refreshKey: string; now: number; snapshot: Snapshot; onOpenSettings: () => void }>(() => import("./views/Home.tsx"), "Home");
const Docs = lazyTab<Record<string, never>>(() => import("./views/Docs.tsx"), "Docs");
// 서랍은 처음 열 때 불러온다(Markdown 렌더러까지 그 청크에)
const Drawer = lazy(() => import("./Drawer.tsx"));
const DutyDrawer = lazy(() => import("./DutyDrawer.tsx"));
const IdeasDrawer = lazy(() => import("./IdeasDrawer.tsx"));

// 화면(주소 #<id>가 여는 것). 탭 줄에 보이는 것은 ROW뿐이다(ATC-381, docs/layout.md Y6): DOCS는 도움말 메뉴, GLOBE는 보기 모드, AIRPORTS는 설정 창으로 옮겼다.
// NETWORK는 METRICS의 하위 화면이다(ATC-380): #network는 #metrics/network를 연다
const TABS = [
  { id: "home", code: "HOME" },
  { id: "release", code: "RELEASE" },
  { id: "flights", code: "FLIGHTS" },
  { id: "fleet", code: "FLEET" },
  { id: "metrics", code: "METRICS" },
  { id: "docs", code: "DOCS" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const IN_ROW = (t: Tab) => t !== "docs";
// 탭이 아닌 보기: #globe(#globe/<AIRPORT>)는 GLOBE 창을, #airports는 설정 창의 AIRPORTS를 연다
const headOf = (hash: string) => hash.replace(/^#/, "").split("/")[0];

const connectionLabel = { live: "실시간", connecting: "연결 중", lost: "끊김" } as const;

// 주소 #탭 또는 #탭/하위(예: #docs/requesting, #flights/board). 하위 경로는 그 탭이 읽는다.
function initialTab(): Tab {
  const canon = canonicalHash(location.hash);
  if (canon) history.replaceState(null, "", canon);
  const hash = location.hash.slice(1).split("/")[0];
  return TABS.some((t) => t.id === hash) ? (hash as Tab) : "home";
}

export function App({ build }: { build: string }) {
  const { snapshot, connection, serverBuild } = useSnapshot();
  const now = useNow();
  const update = useUpdate(connection);
  const supervisorAuth = useSupervisorAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => headOf(location.hash) === "airports");
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(() => (headOf(location.hash) === "airports" ? "airports" : null));
  const [globeOpen, setGlobeOpen] = useState(() => headOf(location.hash) === "globe");
  const closeSettings = useCallback(() => (setSettingsOpen(false), setSettingsTab(null)), []);
  const settings = useSettings();
  const idx = useMemo(() => (snapshot ? buildIndex(snapshot) : null), [snapshot]);

  // FLIGHT·PR 서랍(#flight/<KEY>, #pr/<AIRPORT>/<번호>): 탭 위에 열리고, 탭은 그대로다
  const [drawer, setDrawer] = useState<DrawerRef | null>(() => drawerOfHash(location.hash));
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    history.replaceState(null, "", `#${tabRef.current}`);
  }, []);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // DUTY 서랍(#duty, ATC-220): 어느 탭 위에서도 열린다. 꺼져 있으면 헤더에 readout이 없고, 주소로 열면 꺼짐 안내만 보인다
  const duty = useDuty();
  const [dutyOpen, setDutyOpen] = useState(() => location.hash === "#duty");
  const closeDuty = useCallback(() => {
    setDutyOpen(false);
    history.replaceState(null, "", `#${tabRef.current}`);
  }, []);
  useEffect(() => {
    // 같은 탭의 하위 경로(#docs/requesting)는 그대로 둔다. 서랍이 열려 있으면 주소를 건드리지 않는다
    if (drawerOfHash(location.hash) || location.hash === "#duty" || headOf(location.hash) === "globe") return;
    if (headOf(location.hash) !== tab) history.replaceState(null, "", `#${tab}`);
  }, [tab]);
  // GLOBE 창을 닫으면 열기 전 화면의 주소로 돌아간다
  const closeGlobe = useCallback(() => {
    setGlobeOpen(false);
    history.replaceState(null, "", `#${tabRef.current}`);
  }, []);
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
    const onHash = () => {
      const d = drawerOfHash(location.hash);
      setDrawer(d);
      const isDuty = location.hash === "#duty";
      setDutyOpen(isDuty);
      // #globe는 창, #airports는 설정 창의 AIRPORTS(ATC-381): 탭은 그대로다
      const head = headOf(location.hash);
      setGlobeOpen(head === "globe");
      if (head === "airports") {
        setSettingsTab("airports");
        setSettingsOpen(true);
        history.replaceState(null, "", `#${tabRef.current}`);
        return;
      }
      if (!d && !isDuty && head !== "globe") setTab(initialTab());
    };
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
          {settingsOpen && <SettingsPanel key={settingsTab ?? "last"} settings={settings} snapshot={snapshot} onClose={closeSettings} openTab={settingsTab} />}
        </div>
        <nav className="tabs" role="tablist" ref={tabsRef}>
          {TABS.filter((t) => IN_ROW(t.id)).map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
              <span className="tab-code">{t.code}</span>
            </button>
          ))}
        </nav>
        <div className="readouts">
          <Readout code="AIRBORNE" value={busy} tone="radar" />
          <Readout code="STANDS" label="점유" value={stands} />
          <Readout code="ENROUTE" value={inProgress} />
          <FollowNext refreshKey={snapshot?.at ?? ""} />
          {duty.status?.enabled && (
            <button
              className="readout is-button duty-readout"
              onClick={() => void (location.hash = "duty")}
              aria-haspopup="dialog"
              aria-expanded={dutyOpen}
              title={`DUTY · ${duty.status.state}${duty.status.error ? ` — ${duty.status.error}` : ""}`}
            >
              <b className={`duty-dot is-${readoutState(duty.status)}`} aria-hidden="true">
                ●
              </b>
              <span>DUTY</span>
            </button>
          )}
          <button className="readout is-button" onClick={() => setAlertsOpen((v) => !v)} aria-expanded={alertsOpen}>
            <b>{pad(handoffs.length)}</b>
            <span>HANDOFF</span>
          </button>
          <button
            className={`readout is-button readout-alerts${serious ? " tone-alert" : actionable.length ? " tone-amber" : ""}`}
            onClick={() => setAlertsOpen((v) => !v)}
            aria-expanded={alertsOpen}
          >
            <b>{pad(actionable.length)}</b>
            <span>
              ALERTS{advisories > 0 && <em className="adv-count"> +{advisories} ADV</em>}
            </span>
          </button>
          <AlertBell />
          <button type="button" className={`readout is-button${globeOpen ? " is-on" : ""}`} onClick={() => (globeOpen ? closeGlobe() : void (location.hash = "globe"))} aria-pressed={globeOpen} aria-label="GLOBE 보기 모드">
            <b>
              <Icon icon={GlobeIcon} size={16} />
            </b>
            <span>GLOBE</span>
          </button>
          <HelpMenu docsOpen={tab === "docs"} />
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

      <SupervisorPairing auth={supervisorAuth} />
      <UpdateBar update={update} />
      <NewVersionBar own={build} server={serverBuild} />

      {actionable.length > 0 && !alertsOpen && (
        <button className={`ticker${serious ? " is-serious" : ""}`} onClick={() => setAlertsOpen(true)} aria-label="경보 목록 펼치기">
          <span className="ticker-head">ALERT</span>
          <Ticker>
            {actionable.map((a, i) => (
              <span key={i} className={`ticker-item alert-${a.kind} lv-${levelOf(a)}`}>
                <span className="tag code-chip" data-tone="inherit">{alertCode[a.kind]}</span>
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
                  <span className="tag code-chip" data-tone="inherit">{alertCode[a.kind]}</span>
                  {alertLabel[a.kind] !== alertCode[a.kind] && <span className="alert-label">{alertLabel[a.kind]}</span>}
                  <span className="mono">{subjectOf(a)}</span>
                  <span className="muted">{alertMessage(a, nameOf)}</span>
                </li>
              ))}
            </Fragment>
          ))}
          {handoffs.map((h) => (
            <li key={`${h.workspacePath}:${h.from}`} className="alert alert-handoff">
              <span className="tag code-chip" data-tone="inherit">HO</span>
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
          <Empty>{connection === "lost" ? "서버에 연결할 수 없음" : "불러오는 중…"}</Empty>
        ) : (
          // 탭마다 오류 경계를 새로 둔다(한 탭의 오류·못 불러온 청크가 다른 탭을 막지 않게)
          <>
            {/* 처음 도착하는 탭(HOME, ATC-377)의 맨 위 */}
            {tab === "home" && <SinceLook refreshKey={snapshot.at.slice(0, 16)} />}
            <TabBoundary key={tab} stale={showNewVersion(build, serverBuild, null)}>
              <Suspense fallback={<TabLoading />}>{tabView(tab, snapshot, idx, now, () => setSettingsOpen(true))}</Suspense>
            </TabBoundary>
          </>
        )}
      </main>
      {globeOpen && snapshot && (
        <TabBoundary key="globe" stale={false}>
          <Suspense fallback={<TabLoading />}>
            <GlobeMode refreshKey={snapshot.at.slice(0, 16)} onClose={closeGlobe} />
          </Suspense>
        </TabBoundary>
      )}
      {dutyOpen && (
        <TabBoundary key="duty" stale={false}>
          <Suspense fallback={null}>
            <DutyDrawer chat={duty} onClose={closeDuty} airports={snapshot?.airports ?? []} refreshKey={snapshot?.at ?? ""} now={now} />
          </Suspense>
        </TabBoundary>
      )}
      {drawer && !dutyOpen && (
        <TabBoundary key={JSON.stringify(drawer)} stale={false}>
          <Suspense fallback={null}>
            {drawer.kind === "ideas" || drawer.kind === "idea" ? (
              <IdeasDrawer target={drawer} onClose={closeDrawer} now={now} gate={{ enabled: duty.status ? duty.status.enabled : null, blocked: duty.status?.blocked === true }} />
            ) : (
              <Drawer target={drawer} onClose={closeDrawer} now={now} />
            )}
          </Suspense>
        </TabBoundary>
      )}
    </div>
  );
}

// 탭 이름 → view. 하위 경로(#docs/requesting)는 그 view가 location.hash에서 읽는다.
function tabView(tab: Tab, snapshot: Snapshot, idx: Index, now: number, onOpenSettings: () => void) {
  const refreshKey = snapshot.at.slice(0, 16);
  switch (tab) {
    case "flights":
      return <Flights snapshot={snapshot} idx={idx} now={now} refreshKey={snapshot.at} />;
    case "fleet":
      return <Fleet refreshKey={refreshKey} snapshot={snapshot} />;
    case "metrics":
      return <Metrics refreshKey={refreshKey} snapshot={snapshot} />;
    case "release":
      return <Release refreshKey={refreshKey} />;
    case "home":
      return <Home refreshKey={refreshKey} now={now} snapshot={snapshot} onOpenSettings={onOpenSettings} />;
    case "docs":
      return <Docs />;
    default:
      return <Home refreshKey={refreshKey} now={now} snapshot={snapshot} onOpenSettings={onOpenSettings} />;
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
