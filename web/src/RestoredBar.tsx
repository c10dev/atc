import type { Snapshot } from "../../server/model.ts";
import { timeAgo } from "./derive.ts";

// WARM START(ATC-539): 재시작 직후 서버가 저장해 둔 마지막 스냅샷을 보여 주는 동안 한 줄. 첫 살아 있는 스냅샷이 오면 사라진다.
// 알림 영역은 늘 두고 안만 바꿔야 화면 읽기 프로그램이 새로 뜬 것을 읽는다
export function RestoredBar({ restored, now }: { restored: Snapshot["restored"]; now: number }) {
  return (
    <div className="restored" role="status">
      {restored && (
        <div className="restored-bar">
          <i className="restored-dot" aria-hidden />
          <span>
            재시작 직후라 마지막 상태를 보여 주는 중입니다 · <span className="mono">{timeAgo(restored.savedAt, now)}</span> 저장 · 새 데이터가 오면 바뀝니다
          </span>
        </div>
      )}
    </div>
  );
}
