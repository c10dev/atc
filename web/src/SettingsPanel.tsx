import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../../server/model.ts";
import { formatClock, type Settings, THEMES, updateSettings } from "./settings.ts";
import { AgentSettings, LinearSettings, useServerSettings } from "./SettingsServer.tsx";

const TABS = [
  { id: "display", label: "화면" },
  { id: "linear", label: "LINEAR" },
  { id: "agents", label: "AGENTS" },
] as const;
type Tab = (typeof TABS)[number]["id"];

// 로고를 누르면 열리는 설정 창. 화면 설정은 이 브라우저에, LINEAR·AGENTS는 서버 설정을 읽어 보여 준다.
// 바깥을 누르거나 Esc로 닫는다.
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
  const [tab, setTab] = useState<Tab>("display");
  const { server, save } = useServerSettings();

  useEffect(() => {
    const panel = ref.current;
    panel?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel && !panel.contains(target) && !(target as Element).closest?.(".brand")) onClose();
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onPointer);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  return (
    <div className="settings" id="settings" role="dialog" aria-label="설정" ref={ref}>
      <header className="settings-head">
        <span className="settings-title">
          SETTINGS <em>설정</em>
        </span>
        <button className="settings-close" onClick={onClose} aria-label="설정 닫기">
          ×
        </button>
      </header>
      <nav className="settings-tabs" role="tablist" aria-label="설정 종류">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
        {tab === "display" ? (
          <DisplaySettings settings={settings} />
        ) : tab === "linear" ? (
          <LinearSettings snapshot={snapshot} server={server} save={save} />
        ) : (
          <AgentSettings snapshot={snapshot} server={server} save={save} onNavigate={onClose} />
        )}
      </div>
    </div>
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
    <section className="settings-section">
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
