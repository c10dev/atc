import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { VoiceStatusAll as VoiceStatus } from "../../server/tts.ts";
import { disableSound, enableNotify, enableSound, previewSound, previewVoice, resumeSound, stopSound, updatePrefs, useAlerts } from "./alerts-runtime.ts";
import type { Save } from "./SettingsServer.tsx";
import { ALERT_GROUPS, GROUP_LABEL, SOUND_LABEL, SOUND_NAMES } from "./supervisor-alerts.ts";
import "./alerts.css";

// 설정 창의 알림 탭(ATC-87). 알림(브라우저 Notification)과 소리(Web Audio)는 각자 따로 켜고, 둘 다 이 브라우저에만 저장되며 기본은 꺼짐이다.
// 음성 콜아웃(ATC-140): 서버가 로컬 TTS 엔진으로 만든 WAV를 무전 체인으로 들려준다. 켜기·무전 효과는 이 브라우저에, 엔진·목소리는 서버 설정(.env.local)에 둔다
function useVoiceStatus() {
  const [status, setStatus] = useState<VoiceStatus | null | "error">(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/voice/status");
      setStatus(r.ok ? ((await r.json()) as VoiceStatus) : "error");
    } catch {
      setStatus("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { status, reload: load };
}

// docs/guide/voice.md가 적은 엔진 값 그대로(server/tts.ts TTS_ENGINES). stub은 시험용
const VOICE_ENGINES: [string, string][] = [
  ["none", "none"],
  ["piper", "piper"],
  ["espeak", "espeak"],
  ["kokoro", "kokoro"],
  ["stub", "stub (시험용)"],
];

export function AlertsSettings({ save }: { save: Save }) {
  const { prefs, permission, audio } = useAlerts();
  const [msg, setMsg] = useState<string | null>(null);
  const { status: voice, reload: reloadVoice } = useVoiceStatus();
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const noEngine = voice !== null && (voice === "error" || !voice.available);

  const pickVoice = async (name: string) => {
    setVoiceMsg(null);
    const r = await save({ ttsVoice: name });
    if (!r.ok) setVoiceMsg(r.error);
    await reloadVoice();
  };
  const pickEngine = async (engine: string) => {
    setVoiceMsg(null);
    const r = await save({ ttsEngine: engine });
    if (!r.ok) setVoiceMsg(r.error);
    await reloadVoice();
  };
  const listen = async () => {
    setVoiceMsg(null);
    const r = await previewVoice(voice && voice !== "error" ? (voice.selected ?? undefined) : undefined);
    if (!r.ok) setVoiceMsg(`미리 듣기 실패: ${r.error}`);
  };

  const toggleNotify = async (on: boolean) => {
    setMsg(null);
    if (!on) return updatePrefs({ notify: false });
    const p = await enableNotify();
    if (p === "unsupported") setMsg("이 브라우저는 알림을 지원하지 않습니다. 종 목록과 탭 제목 숫자로 알려 드립니다.");
    else if (p !== "granted") setMsg("알림 권한이 없어 꺼져 있습니다. 브라우저 사이트 설정에서 허용한 뒤 다시 켜세요. 종 목록과 탭 제목 숫자는 그대로 보입니다.");
  };

  return (
    <>
      <Section code="NOTIFY" label="브라우저 알림" hint="atc 탭이 열려 있으면 백그라운드에서도 하나씩 알립니다. 같은 항목은 한 번만, 여러 탭이 열려 있어도 한 번만 울립니다. 알림 글은 화면에 이미 있는 문구뿐이고 밖으로 나가지 않습니다.">
        <Segmented
          label="브라우저 알림"
          value={prefs.notify}
          options={[
            [true, "켜기"],
            [false, "끄기"],
          ]}
          onChange={toggleNotify}
        />
        <p className="settings-hint" data-testid="notify-permission">
          권한: {permission === "unsupported" ? "지원 안 함" : permission === "granted" ? "허용됨" : permission === "denied" ? "거부됨" : "아직 묻지 않음"}
        </p>
        {msg && <p className="settings-hint alert-msg">{msg}</p>}
        <fieldset className="alert-checks" aria-label="알림 종류" disabled={!prefs.notify && !prefs.sound}>
          <legend>받을 종류</legend>
          {ALERT_GROUPS.map((g) => (
            <label key={g}>
              <input type="checkbox" checked={prefs.groups[g]} onChange={(e) => updatePrefs((p) => ({ ...p, groups: { ...p.groups, [g]: e.target.checked } }))} />
              {GROUP_LABEL[g]}
            </label>
          ))}
        </fieldset>
      </Section>

      <Section code="SOUND" label="소리" hint="WARNING은 확인(ACK)할 때까지 되풀이, CAUTION은 한 번, SUPERVISOR를 기다리는 새 항목(CALL)은 짧게 한 번. ADVISORY는 조용합니다. 알림 권한이 없어도 울립니다. 켜는 클릭이 브라우저의 소리 잠금을 풉니다.">
        <Segmented
          label="소리"
          value={prefs.sound}
          options={[
            [true, "켜기"],
            [false, "끄기"],
          ]}
          onChange={(on) => void (on ? enableSound() : disableSound())}
        />
        {prefs.sound && audio !== "running" && (
          <button className="alert-unlock" onClick={() => void resumeSound()}>
            소리 꺼짐 — 눌러서 켜기
          </button>
        )}
        <fieldset className="alert-checks" aria-label="소리 종류" disabled={!prefs.sound}>
          <legend>낼 소리</legend>
          {SOUND_NAMES.map((n) => (
            <div key={n} className="alert-sound-row">
              <label>
                <input type="checkbox" checked={prefs.sounds[n]} onChange={(e) => updatePrefs((p) => ({ ...p, sounds: { ...p.sounds, [n]: e.target.checked } }))} />
                {SOUND_LABEL[n]}
              </label>
              <button className="alert-preview" onClick={() => previewSound(n)} aria-label={`${SOUND_LABEL[n]} 들어 보기`}>
                ▶
              </button>
            </div>
          ))}
          <button className="alert-preview" onClick={stopSound}>
            ■ 그치기
          </button>
        </fieldset>
        <label className="alert-range">
          음량
          <input type="range" min={0} max={100} value={Math.round(prefs.volume * 100)} disabled={!prefs.sound} onChange={(e) => updatePrefs({ volume: Number(e.target.value) / 100 })} aria-label="음량" />
          <span className="mono">{Math.round(prefs.volume * 100)}%</span>
        </label>
        <fieldset className="alert-checks" aria-label="조용한 시간" disabled={!prefs.sound}>
          <legend>조용한 시간(현지)</legend>
          <label>
            <input type="checkbox" checked={prefs.quiet.on} onChange={(e) => updatePrefs((p) => ({ ...p, quiet: { ...p.quiet, on: e.target.checked } }))} />
            이 시간에는 소리를 내지 않는다
          </label>
          <span className="alert-quiet">
            <input type="time" value={prefs.quiet.from} onChange={(e) => e.target.value && updatePrefs((p) => ({ ...p, quiet: { ...p.quiet, from: e.target.value } }))} aria-label="시작" />
            —
            <input type="time" value={prefs.quiet.to} onChange={(e) => e.target.value && updatePrefs((p) => ({ ...p, quiet: { ...p.quiet, to: e.target.value } }))} aria-label="끝" />
          </span>
        </fieldset>
      </Section>

      <Section
        code="VOICE"
        label="음성 콜아웃"
        hint="WARNING과 CALL은 톤 뒤에 짧은 영어 콜아웃을 한 번 읽습니다(예: “Supervisor, GOLF, standing by for approval.”). 목소리는 이 컴퓨터의 엔진이 만들고 밖으로 나가지 않습니다. 소리가 켜져 있어야 들립니다. CAUTION과 DONE은 톤만 냅니다."
      >
        <Segmented
          label="음성 콜아웃"
          value={prefs.voice.on}
          options={[
            [true, "켜기"],
            [false, "끄기"],
          ]}
          onChange={(on) => updatePrefs((p) => ({ ...p, voice: { ...p.voice, on } }))}
        />
        {voice !== null && voice !== "error" && (
          <label className="alert-range">
            엔진
            <select value={voice.engine} onChange={(e) => void pickEngine(e.target.value)} aria-label="엔진">
              {VOICE_ENGINES.map(([e, label]) => {
                // 없는 엔진은 못 고르게 흐리게 두고 사유를 붙인다(지금 고른 것은 그대로 보이게 남긴다). stub·none은 늘 쓸 수 있다
                const info = (voice.engines ?? []).find((x) => x.engine === e);
                const off = info !== undefined && !info.available && e !== voice.engine;
                return (
                  <option key={e} value={e} disabled={off} title={info?.error?.message}>
                    {info && !info.available ? `${label} — ${info.error?.message ?? "쓸 수 없음"}` : label}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {noEngine && (
          <p className="settings-hint alert-msg" data-testid="voice-none">
            <b>TTS 엔진 없음</b>
            {voice !== "error" && voice.error && voice.error.code !== "no-engine" ? ` — ${voice.error.message}` : ""}. 설치 방법은{" "}
            <a href="#docs/voice">
              음성 콜아웃 안내
            </a>
            를 보세요.
          </p>
        )}
        {voice !== null && voice !== "error" && voice.available && (
          <label className="alert-range">
            목소리
            <select value={voice.selected ?? ""} onChange={(e) => void pickVoice(e.target.value)} aria-label="목소리">
              {voice.voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <button className="alert-preview" onClick={() => void listen()} aria-label="목소리 미리 듣기">
              미리 듣기
            </button>
          </label>
        )}
        <label className="alert-range">
          무전 효과
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(prefs.voice.radio * 100)}
            onChange={(e) => updatePrefs((p) => ({ ...p, voice: { ...p.voice, radio: Number(e.target.value) / 100 } }))}
            aria-label="무전 효과"
          />
          <span className="mono">{Math.round(prefs.voice.radio * 100)}%</span>
        </label>
        {voiceMsg && <p className="settings-hint alert-msg">{voiceMsg}</p>}
      </Section>

      <p className="settings-foot">켜기·무전 효과는 이 브라우저에만 저장됩니다. 엔진과 목소리는 서버 설정입니다.</p>
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

function Segmented<T extends boolean>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
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
