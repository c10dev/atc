import { useState } from "react";
import { usePanelFocus } from "./usePanelFocus.ts";

// CREW BRIEFING: 새 세션에 붙여 넣을 시작 지시문. 카드에서 열면 카드 아래, ENTRY INTO SERVICE 뒤면 맨 위
export function BriefingPanel({ registration, text, opener, onClose }: { registration: string; text: string; opener: HTMLElement | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { ref, close, onKeyDown } = usePanelFocus<HTMLElement>(opener, onClose);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section ref={ref} className="fl-briefing fl-panel" onKeyDown={onKeyDown} aria-label={`${registration} CREW BRIEFING`}>
      <h2 className="label">
        CREW BRIEFING <em>{registration} — 새 세션을 그 저장소에서 열고, 세션 이름을 {registration}로 둔 뒤 아래를 붙여 넣는다</em>
      </h2>
      <p className="fl-entry-preview faint">Linear에 tail:{registration} 라벨이 없으면 먼저 만들어야 이 팀에 배정 라벨을 붙일 수 있다.</p>
      <textarea
        className="fl-briefing-text"
        readOnly
        value={text}
        rows={Math.min(24, text.split("\n").length + 1)}
        aria-label={`${registration} CREW BRIEFING 본문`}
      />
      <div className="fl-actions">
        <button className="btn" onClick={close}>
          닫기
        </button>
        <button className="btn is-primary" onClick={copy}>
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </section>
  );
}
