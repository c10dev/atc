import { type ControlList, controlPollDue } from "../../server/control-view.ts";

// /api/control/sessions를 읽는 값의 모듈 공유(ATC-127). 헤더 CONTROL 띠(ControlStrip)와 FLEET의 CONTROL SESSIONS(ControlSessions)가 같은 값과 같은 "마지막으로 읽은 시각"을 쓴다.
// 그래서 둘이 함께 떠 있어도 60초에 한 번만 읽고, 탭을 오가도 60초 안에는 다시 읽지 않는다. 서버는 `claude agents`를 30초 캐시한다(server/agents-cache.ts).
export type ControlAccounts = { labeled: boolean; rows: { name: string; label: string | null; account: string | null }[] };
export const controlMemo: { list: ControlList | null; accounts: ControlAccounts | null; at: number | null } = { list: null, accounts: null, at: null };

// force(동작 뒤)면 서버 캐시도 건너뛴다(?fresh=1). 못 읽으면 마지막 값을 그대로 돌려준다
let inflight: Promise<ControlList | null> | null = null;
export function fetchControlList(force = false): Promise<ControlList | null> {
  if (inflight) return inflight;
  if (!controlPollDue(controlMemo.at, Date.now(), force)) return Promise.resolve(controlMemo.list);
  controlMemo.at = Date.now();
  inflight = fetch(`/api/control/sessions${force ? "?fresh=1" : ""}`)
    .then(async (res) => {
      if (res.ok) controlMemo.list = (await res.json()) as ControlList;
      return controlMemo.list;
    })
    .catch(() => controlMemo.list)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
