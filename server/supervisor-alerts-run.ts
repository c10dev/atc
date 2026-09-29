import { followingNow } from "./following.ts";
import { readMccRecords } from "./mcc.ts";
import { rtsState } from "./mcc-run.ts";
import type { Snapshot } from "./model.ts";
import { allProposals } from "./proposals.ts";
import { type AlertEvent, diffAlerts, type SupervisorAlert, supervisorAlertsOf } from "./supervisor-alerts.ts";

// SUPERVISOR alerts(ATC-87)의 읽기와 상태. 계산은 supervisor-alerts.ts(순수). 여기는 파일을 읽어 입력을 모으고 지난 key 집합을 든다.
// 파일(logbook·제안·rts)을 읽으므로 스냅샷마다가 아니라 GAP_MS에 한 번만 다시 센다.
export const GAP_MS = 5_000;

let known = new Map<string, SupervisorAlert>();
let lastAt = 0;
let warmed = false;

export const currentAlerts = (): SupervisorAlert[] => [...known.values()];

export function collectAlerts(s: Snapshot, now: number): SupervisorAlert[] {
  return supervisorAlertsOf({
    sessions: s.sessions,
    alerts: s.alerts,
    workspaces: s.workspaces,
    tickets: s.tickets,
    following: followingNow(s, now),
    proposals: allProposals(),
    pulls: s.pulls ?? [],
    rts: rtsState(readMccRecords()).last,
  });
}

// 스냅샷이 새로 나올 때 부른다. 바뀐 것이 있으면 `alert` 이벤트를 돌려주고, 아니면 null
export function runSupervisorAlerts(s: Snapshot, now = Date.now()): AlertEvent | null {
  if (now - lastAt < GAP_MS) return null;
  lastAt = now;
  const items = collectAlerts(s, now);
  const d = diffAlerts(known, items);
  known = new Map(items.map((a) => [a.key, a]));
  // 서버를 켠 첫 번은 기준선이다: 화면은 initial 이벤트를 이미 있던 것으로 맞춰 본다(알리지 않는다)
  if (!warmed) {
    warmed = true;
    return { raised: items, cleared: [], initial: true, items };
  }
  return d.raised.length || d.cleared.length ? { ...d, initial: false, items } : null;
}
