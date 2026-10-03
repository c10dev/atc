import { type ControlList, controlPollDue } from "../../server/control-view.ts";
import { apiGet } from "./api.ts";

// /api/control/sessions를 읽는 값의 모듈 공유(ATC-127). 아래 CONTROL 패널의 머리(ControlPanel)와 그 표(ControlSessions)가 같은 값과 같은 "마지막으로 읽은 시각"을 쓴다.
// 값(list)만 나눈다. 띠의 "마지막으로 읽은 시각"(at)은 띠만 쓰고, FLEET 구역은 자기 시각으로 60초마다 읽는다(ACCOUNT도 읽어야 하므로).
// 둘이 읽는 것은 서버가 `claude agents`를 30초 캐시해 명령은 한 번이다(server/agents-cache.ts).
export type ControlAccounts = { labeled: boolean; rows: { name: string; label: string | null; account: string | null }[] };
export const controlMemo: { list: ControlList | null; accounts: ControlAccounts | null; at: number | null } = { list: null, accounts: null, at: null };

// force(동작 뒤)면 서버 캐시도 건너뛴다(?fresh=1). 못 읽으면 마지막 값을 그대로 돌려준다
let inflight: Promise<ControlList | null> | null = null;
export function fetchControlList(force = false): Promise<ControlList | null> {
  if (inflight) return inflight;
  if (!controlPollDue(controlMemo.at, Date.now(), force)) return Promise.resolve(controlMemo.list);
  controlMemo.at = Date.now();
  inflight = apiGet(`/api/control/sessions${force ? "?fresh=1" : ""}`)
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
