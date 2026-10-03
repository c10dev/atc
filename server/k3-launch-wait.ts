import { record } from "./recorder.ts";

// 기다리는 launch 카드(ATC-506): K3 entries를 못 만들어 LAUNCH하지 않은 승인 카드. 서버 메모리에만 둔다 —
// 서버가 다시 뜨면 잊고, 카드는 launchCardTimeoutMin 뒤에 전과 같이 닫힌다(스스로 다시 띄우지 않는다는 규칙 그대로)
const waiting = new Map<string, string>();
export const k3LaunchWaits = (): ReadonlyMap<string, string> => waiting;
export const k3WaitOf = (id: string) => waiting.get(id);
export const k3WaitSet = (id: string, why: string) => void waiting.set(id, why); // 시험용: 기록 없이 기다림만 적는다
export const k3WaitClear = (id: string) => void waiting.delete(id);
// 오작동 수(k3-hold.ts)가 세는 기록: 카드마다 처음 기다릴 때 한 줄
export function k3WaitMark(id: string, flight: string, why: string, now = new Date().toISOString()) {
  const first = !waiting.has(id);
  waiting.set(id, why);
  if (first) record({ t: now, kind: "dispatch", op: "k3-launch-wait", id, flight });
}
