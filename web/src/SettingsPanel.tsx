import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Snapshot } from "../../server/model.ts";
import { formatClock, type Settings, THEMES, updateSettings } from "./settings.ts";
import { type SettingsEntry, type SettingsTab, settingsSearch, settingsTabOf } from "../../server/settings-policy.ts";
import { AccountsBlock } from "./SettingsAccounts.tsx";
import { AlertsSettings } from "./SettingsAlerts.tsx";
import { LandingSettings, OperationsSettings } from "./SettingsAutomation.tsx";
import { AgentSettings, LinearSettings, useServerSettings } from "./SettingsServer.tsx";

// 왼쪽 메뉴. group이 있는 분류는 그 묶음 제목 아래에 모인다(AUTOMATION = SUPERVISOR 정책 스위치)
const TABS: readonly { id: SettingsTab; label: string; sub: string; group?: string }[] = [
  { id: "display", label: "화면", sub: "테마 · 밀도 · 시계" },
  { id: "linear", label: "LINEAR", sub: "연결 · 팀" },
  { id: "agents", label: "AGENTS", sub: "SOURCES · STANDS · 콜사인" },
  { id: "accounts", label: "ACCOUNTS", sub: "설정 폴더 · LOGIN" },
  { id: "alerts", label: "알림", sub: "알림 · 소리 · 음성" },
  { id: "landing", label: "LANDING", sub: "AUTOLAND · MCC · REVIEW", group: "AUTOMATION" },
  { id: "operations", label: "OPERATIONS", sub: "FUEL · REPOSITION · RECYCLE · JEV", group: "AUTOMATION" },
];
const labelOf = (t: SettingsTab) => TABS.find((x) => x.id === t)!.label;

// 마지막에 쓴 분류를 기억한다(ATC-131). 저장소를 못 쓰거나 값이 없으면 화면
const TAB_KEY = "atc.settings.tab";
const loadTab = (): SettingsTab => {
  try {
    return settingsTabOf(localStorage.getItem(TAB_KEY), TABS.map((t) => t.id), "display");
  } catch {
    return "display";
  }
};
const saveTab = (t: SettingsTab) => {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {}
};

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

// 로고를 누르면 열리는 설정 창: 가운데 넓은 모달, 왼쪽 메뉴(분류와 찾기), 오른쪽 내용.
// 화면 설정은 이 브라우저에, 나머지는 서버 설정을 읽어 보여 준다. 바깥(어두운 뒤판)을 누르거나 Esc로 닫는다.
// 상단 바의 backdrop-filter 안에서는 흐림이 먹지 않아 body에 띄운다(portal)
export function SettingsPanel({
  settings,
  snapshot,
  onClose,
}: {
  settings: Settings;
  snapshot: Snapshot | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SettingsTab>(loadTab);
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState<string | null>(null);
  const chooseTab = (t: SettingsTab) => {
    setTab(t);
    saveTab(t);
    mainRef.current?.scrollTo({ top: 0 });
  };
  const { server, save } = useServerSettings();
  const hits = settingsSearch(query);

  // 찾기 결과를 누르면 그 분류로 가서 블록까지 내려가고 잠깐 밝힌다
  const go = (e: SettingsEntry) => {
    chooseTab(e.tab);
    setQuery("");
    setJump(e.code);
  };
  useEffect(() => {
    if (!jump) return;
    const el = mainRef.current?.querySelector<HTMLElement>(`[data-code="${CSS.escape(jump)}"]`);
    setJump(null);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.classList.add("is-found");
    const t = setTimeout(() => el.classList.remove("is-found"), 1600);
    return () => clearTimeout(t);
  }, [jump, tab]);

  // 폰에서는 메뉴가 가로로 넘어가니 고른 분류가 보이게
  useEffect(() => {
    ref.current?.querySelector(".settings-menu [aria-selected='true']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(".settings-nav [aria-selected='true']")?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // 포커스를 창 안에 가둔다(Tab이 뒤 화면으로 새지 않게)
      if (e.key === "Tab" && ref.current) {
        const all = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!all.length) return;
        const first = all[0];
        const last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
        else if (!ref.current.contains(document.activeElement)) (e.preventDefault(), first.focus());
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);

  // 찾기 칸: Enter는 첫 결과로, Esc는 글이 있으면 지우기만(창은 그대로)
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && hits[0]) go(hits[0]);
    if (e.key === "Escape" && query) {
      e.stopPropagation();
      setQuery("");
    }
  };

  let lastGroup: string | undefined;
  return createPortal(
    <div
      className="settings-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings" id="settings" role="dialog" aria-modal="true" aria-label="설정" ref={ref}>
        <header className="settings-head">
          <span className="settings-title">
            SETTINGS <em>설정</em>
          </span>
          <button className="settings-close" onClick={onClose} aria-label="설정 닫기">
            ×
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="설정 종류">
            <input
              className="settings-search"
              type="search"
              placeholder="찾기: FUEL, 음성, LOGIN…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              aria-label="설정 찾기"
            />
            {query.trim() ? (
              <ul className="settings-hits" aria-label="찾은 설정">
                {hits.length ? (
                  hits.map((e) => (
                    <li key={e.code}>
                      <button onClick={() => go(e)}>
                        <b>{e.code}</b> <span>{e.label}</span>
                        <em>{labelOf(e.tab)}</em>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="settings-hits-none">찾은 설정 없음</li>
                )}
              </ul>
            ) : (
              <div className="settings-menu" role="tablist" aria-orientation="vertical">
                {TABS.map((t) => {
                  const head = t.group && t.group !== lastGroup ? t.group : null;
                  lastGroup = t.group;
                  return (
                    <div key={t.id} className="settings-menu-item">
                      {head && <span className="settings-menu-group">{head}</span>}
                      <button role="tab" aria-selected={tab === t.id} aria-controls="settings-main" onClick={() => chooseTab(t.id)}>
                        <b>{t.label}</b>
                        <span>{t.sub}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </nav>

          <div className="settings-main" id="settings-main" role="tabpanel" aria-label={labelOf(tab)} ref={mainRef}>
            {tab === "display" ? (
              <DisplaySettings settings={settings} />
            ) : tab === "linear" ? (
              <LinearSettings snapshot={snapshot} server={server} save={save} />
            ) : tab === "agents" ? (
              <AgentSettings snapshot={snapshot} server={server} save={save} onNavigate={onClose} />
            ) : tab === "accounts" ? (
              <AccountsBlock />
            ) : tab === "alerts" ? (
              <AlertsSettings save={save} />
            ) : tab === "landing" ? (
              <LandingSettings server={server} save={save} />
            ) : (
              <OperationsSettings server={server} save={save} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DisplaySettings({ settings }: { settings: Settings }) {
  const now = Date.now();
  return (
    <>

      <Section code="THEME" label="테마">
        <div className="theme-cards" role="radiogroup" aria-label="테마">
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={settings.theme === t.id}
              className="theme-card"
              onClick={() => updateSettings({ theme: t.id })}
            >
              <span className="theme-swatch" aria-hidden>
                {t.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span className="theme-name">
                <b>{t.code}</b> {t.label}
              </span>
              <span className="theme-note">{t.note}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section code="MOTION" label="애니메이션" hint="RADAR 스위프, 별, 깜빡임">
        <Segmented
          label="애니메이션"
          value={settings.motion}
          options={[
            [true, "켜기"],
            [false, "끄기"],
          ]}
          onChange={(motion) => updateSettings({ motion })}
        />
      </Section>

      <Section code="TIME" label="시각 표시" hint="상단 시계, FLIGHT STRIPS의 LAST CONTACT">
        <Segmented
          label="시각 표시"
          value={settings.clock}
          options={[
            ["utc", `UTC · ${formatClock(now, "utc")}`],
            ["local", `현지 · ${formatClock(now, "local")}`],
          ]}
          onChange={(clock) => updateSettings({ clock })}
        />
      </Section>

      <Section code="DENSITY" label="밀도" hint="촘촘하게: RADAR 블록, FLIGHT STRIPS, 카드, FIDS 행을 한 단계(4px)씩 줄여 한 화면에 더 많이">
        <Segmented
          label="밀도"
          value={settings.density}
          options={[
            ["comfortable", "기본"],
            ["compact", "촘촘하게"],
          ]}
          onChange={(density) => updateSettings({ density })}
        />
      </Section>

      {settings.theme === "night" && (
        <Section code="METEORS" label="유성" hint="Night Sky에서 가끔 지나가는 유성">
          <Segmented
            label="유성"
            value={settings.meteors}
            options={[
              [true, "켜기"],
              [false, "끄기"],
            ]}
            onChange={(meteors) => updateSettings({ meteors })}
          />
        </Section>
      )}

      <p className="settings-foot">이 브라우저에만 저장됩니다.</p>
    </>
  );
}

function Section({ code, label, hint, children }: { code: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="settings-section" data-code={code}>
      <h3 className="label">
        {code} <em>{label}</em>
      </h3>
      {children}
      {hint && <p className="settings-hint">{hint}</p>}
    </section>
  );
}

function Segmented<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
