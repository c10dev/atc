import { loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";
import { bustQueue } from "./queue-bust.ts";
import { chatCreateMisfiresOf, type ReleaseLine } from "./release.ts";
import { appendReleaseLines, readReleaseLines } from "./release-store.ts";

// 채팅 발권(ATC-471)의 입출력 쪽: 스위치 읽기, L1 길(duty-l1-run.ts)에 꽂는 조각, 이 길의 발권 수·오작동 수.
// 판정과 세기는 release.ts(순수). 서버는 스스로 발권하지 않는다: 발권은 SUPERVISOR 글이 시작한 DUTY 턴에서 DUTY가 `create --release`를 부를 때뿐이다.
export const chatReleaseOn = () => loadDispatchConfig().chatRelease !== "off";

// duty-l1-run.ts에 꽂는다. turn은 지금 도는 DUTY 턴을 시작한 SUPERVISOR 글(DutyRuntime.supervisorTurn)
export function chatReleaseHooks(turn: () => string | null, append: (l: ReleaseLine) => void = (l) => appendReleaseLines([l])) {
  return {
    chatRelease: {
      on: chatReleaseOn,
      turn,
      append: (l: ReleaseLine) => {
        append(l);
        bustQueue(); // 새 발권이 SUPERVISOR QUEUE·후보 목록에 곧바로 보인다
      },
    },
  };
}

// 설정 창의 세기는 스냅숏을 인자로 받지 못한다: 서버가 들고 있는 마지막 스냅숏을 엿본다(없으면 거둔 줄만으로 센다)
let peek: () => Pick<Snapshot, "tickets"> | null | undefined = () => null;
export const setSnapshotPeek = (f: typeof peek) => void (peek = f);

export function chatCreateCountsNow(now = Date.now(), tickets?: Pick<Snapshot, "tickets">["tickets"], lines: readonly ReleaseLine[] = readReleaseLines()) {
  return { on: chatReleaseOn(), ...chatCreateMisfiresOf(lines, tickets ?? peek()?.tickets ?? [], now) };
}
