import { useState } from "react";
import { showNewVersion } from "../../server/version.ts";

// 서버가 새 번들로 배포되면 알린다. 입력 중인 내용(거절 사유 등)이 날아가지 않게 저절로 새로고침하지 않는다.
// own: 이 화면이 돌리는 번들, server: 서버가 지금 내주는 번들(SSE version).
export function NewVersionBar({ own, server }: { own: string; server: string | null | undefined }) {
  // 닫은 번들은 이 탭이 떠 있는 동안만 기억한다(새로고침하면 어차피 새 번들이다)
  const [dismissed, setDismissed] = useState<string | null>(null);
  const show = showNewVersion(own, server, dismissed);
  // 알림 영역은 늘 두고 안만 바꿔야 화면 읽기 프로그램이 새로 뜬 것을 읽는다
  return (
    <div className="new-version" role="status">
      {show && (
        <div className="new-version-bar">
          <span className="new-version-text">
            <i className="new-version-dot" aria-hidden />새 버전이 배포됨
          </span>
          <button type="button" className="btn is-primary" onClick={() => location.reload()}>
            새로고침
          </button>
          <button type="button" className="btn new-version-close" onClick={() => setDismissed(server ?? null)} aria-label="새 버전 알림 닫기">
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
