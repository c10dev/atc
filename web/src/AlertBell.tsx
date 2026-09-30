import { useEffect, useRef, useState } from "react";
import { ack, openAlert, resumeSound, useAlerts } from "./alerts-runtime.ts";
import { needsAction, soundLocked, type SupervisorAlert } from "./supervisor-alerts.ts";
import { alertLevelLabel } from "./aviation.ts";
import "./alerts.css";

// 소리가 켜져 있는데 브라우저가 잠갔을 때 헤더에 계속 보이는 칩(ATC-162). 누르면 푼다. 풀리면(running) 사라진다
export function SoundLockChip() {
  const { prefs, audio, missed } = useAlerts();
  if (!soundLocked(prefs, audio)) return null;
  return (
    <button className="sound-lock" onClick={() => void resumeSound()} title="브라우저가 소리를 잠갔습니다. 아무 곳이나 누르거나 이 칩을 누르면 켜집니다">
      🔇 소리 잠김 — 클릭하면 켜짐{missed.length > 0 && <em> · 놓침 {missed.length}</em>}
    </button>
  );
}

// 헤더의 BELL(ATC-87): 알림을 못 받는 창(권한 거부·꺼짐)에서도 SUPERVISOR가 새 항목을 볼 수 있는 작은 목록.
// 숫자는 조치가 필요한 것(WARNING·CAUTION·SUPERVISOR 대기) 가운데 아직 확인(ACK)하지 않은 것.
export function AlertBell({ onNavigate }: { onNavigate?: () => void }) {
  const { items, acked, prefs, audio, playing } = useAlerts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const todo = items.filter((a) => needsAction(a) && !acked.includes(a.key));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onPointer);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const level = todo.some((a) => a.level === "warning") ? "warning" : todo.length ? "caution" : "none";
  const go = (a: SupervisorAlert) => {
    openAlert(a);
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div className="bell-wrap" ref={ref}>
      <button className={`readout is-button bell lv-${level}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={`알림 종 ${todo.length}건`}>
        <b>{String(todo.length).padStart(2, "0")}</b>
        <span>BELL{playing === "warning" && <em className="bell-ring"> ●</em>}</span>
      </button>
      {open && (
        <div className="bell-list" role="dialog" aria-label="알림 목록">
          <header>
            <span>
              BELL <em>알림</em>
            </span>
            {todo.length > 0 && <button onClick={() => ack(todo.map((a) => a.key))}>모두 확인</button>}
          </header>
          {prefs.sound && audio !== "running" && (
            <button className="alert-unlock" onClick={() => void resumeSound()}>
              소리 꺼짐 — 눌러서 켜기
            </button>
          )}
          {items.length === 0 ? (
            <p className="bell-empty">알릴 항목이 없습니다</p>
          ) : (
            <ul>
              {items.map((a) => (
                <li key={a.key} className={`bell-item lv-${a.level ?? "none"}${acked.includes(a.key) ? " is-acked" : ""}`}>
                  <button className="bell-open" onClick={() => go(a)}>
                    <span className="code-chip">{a.level ? alertLevelLabel[a.level] : a.cue === "call" ? "CALL" : "INFO"}</span>
                    <span className="mono">{[a.aircraft, a.flight].filter(Boolean).join(" · ") || a.group.toUpperCase()}</span>
                    <span className="bell-text">{a.text}</span>
                    {a.next && <span className="muted">→ {a.next}</span>}
                  </button>
                  {!acked.includes(a.key) && (
                    <button className="bell-ack" onClick={() => ack([a.key])} aria-label="확인">
                      ACK
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
