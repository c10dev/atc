import { overCapNow, waitStuckNow } from "./control-recycle-run.ts";
import { readRecords } from "./recorder.ts";
import { followingNow } from "./following.ts";
import { readMccRecords } from "./mcc.ts";
import { rtsState } from "./mcc-run.ts";
import type { Snapshot } from "./model.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { allProposals } from "./proposals.ts";
import { registrationOf } from "./registration.ts";
import { loadScheduleMode, loadScheduleOps } from "./schedule.ts";
import { CONTROL_SESSIONS, MAX_LAUNCHED } from "./session-control.ts";
import { capIdleNow } from "./dispatch-launch.ts";
import { type AlertEvent, diffAlerts, type SupervisorAlert, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { summaryKey, summaryOf, type SupervisorSummary, workingOf } from "./supervisor-summary.ts";

// SUPERVISOR alerts(ATC-87)의 읽기와 상태. 계산은 supervisor-alerts.ts(순수). 여기는 파일을 읽어 입력을 모으고 지난 key 집합을 든다.
// 파일(logbook·제안·rts)을 읽으므로 스냅샷마다가 아니라 GAP_MS에 한 번만 다시 센다.
export const GAP_MS = 5_000;

let known = new Map<string, SupervisorAlert>();
let lastAt = 0;
let warmed = false;

export const currentAlerts = (): SupervisorAlert[] => [...known.values()];

// 최근 6시간의 재시작 기록(알림은 이 창 안에서만 남는다)
export const RECYCLE_ALERT_MS = 6 * 3_600_000;
const recentRecycles = (now: number) =>
  readRecords(now - RECYCLE_ALERT_MS).flatMap((r) => (r.kind === "control" && r.op === "recycle" ? [r] : []));

// REPOSITION(ATC-179): 최근 6시간의 옮김과 auto → approval 기록
const repositionAlertInputs = (now: number) => {
  const rs = readRecords(now - RECYCLE_ALERT_MS);
  return {
    repositions: rs.flatMap((r) => (r.kind === "fleet" && r.op === "reposition" && r.from && r.to ? [{ t: r.t, aircraft: r.aircraft, from: r.from, to: r.to, ok: r.ok, by: r.by, stage: r.stage, error: r.error }] : [])),
    repositionFlaps: rs.flatMap((r) => (r.kind === "reposition" && r.op === "mode" && r.by === "auto" ? [{ t: r.t, reason: r.reason ?? "flapping" }] : [])),
  };
};

export function collectAlerts(s: Snapshot, now: number): SupervisorAlert[] {
  const proposals = allProposals();
  return supervisorAlertsOf({
    sessions: s.sessions,
    alerts: s.alerts,
    workspaces: s.workspaces,
    tickets: s.tickets,
    following: followingNow(s, now),
    proposals,
    capIdle: capIdleNow(s.sessions, proposals, MAX_LAUNCHED, loadDispatchConfig().teamPattern, now),
    pulls: s.pulls ?? [],
    rts: rtsState(readMccRecords()).last,
    schedule: { mode: loadScheduleMode(), ops: loadScheduleOps() },
    recycles: recentRecycles(now),
    overCap: overCapNow(),
    ...repositionAlertInputs(now),
    waiting: waitStuckNow(),
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

// SUPERVISOR SUMMARY(ATC-153): 지금 있는 알림 목록(currentAlerts)과 스냅샷의 FUEL·세션에서 센다. 파일을 더 읽지 않는다
export function summaryNow(s: Snapshot, now = Date.now()): SupervisorSummary {
  const teamPattern = loadDispatchConfig().teamPattern;
  return summaryOf({
    items: currentAlerts(),
    fuelAccounts: s.fuelAccounts ?? [],
    rts: rtsState(readMccRecords()).last,
    working: workingOf(s.sessions.filter((x) => x.status !== "dead"), (name) => registrationOf(name, teamPattern), CONTROL_SESSIONS.map((c) => c.name)),
    at: new Date(now).toISOString(),
  });
}

// 스냅샷이 새로 나올 때 부른다(runSupervisorAlerts 뒤에). 내용이 바뀌었을 때만 새 요약을 돌려준다(첫 번은 늘 돌려준다)
let lastSummaryKey: string | null = null;
export function runSummary(s: Snapshot, now = Date.now()): SupervisorSummary | null {
  const sum = summaryNow(s, now);
  const key = summaryKey(sum);
  if (key === lastSummaryKey) return null;
  lastSummaryKey = key;
  return sum;
}
