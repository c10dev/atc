import { alertSoundLocked, resumeSound, useAlerts } from "./alerts-runtime.ts";
import "./alerts.css";

// 소리가 켜져 있는데 브라우저가 잠갔을 때 헤더에 계속 보이는 칩(ATC-162). 누르면 푼다. 풀리면(running) 사라진다
export function SoundLockChip() {
  const { prefs, audio, missed } = useAlerts();
  if (!alertSoundLocked(prefs, audio)) return null;
  return (
    <button className="sound-lock" onClick={() => void resumeSound()} title="아무 곳이나 누르거나 이 칩을 누르면 소리가 켜진다">
      🔇 소리 잠김 — 클릭하면 켜짐{missed.length > 0 && <em> · 놓침 {missed.length}</em>}
    </button>
  );
}

// 옛 헤더 BELL(ATC-87)은 ATC-447에서 사이드바 머리의 atc 알림(Notices.tsx)으로 옮겼다
