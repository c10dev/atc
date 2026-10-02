import { overCapNow, waitStuckNow } from "./control-recycle-run.ts";
import { readRecords } from "./recorder.ts";
import { followingNow } from "./following.ts";
import { readMccRecords } from "./mcc.ts";
import { mccLandInfoCached, rtsState } from "./mcc-run.ts";
import { landByOf, type LandBy } from "./land-by.ts";
import { type ControlName, controlNameOf } from "./crew.ts";
import type { Snapshot } from "./model.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { allProposals } from "./proposals.ts";
import { followNow, loadFollow } from "./follow-run.ts";
import { readReleaseView } from "./release-store.ts";
import { config } from "./config.ts";
import { DEFAULT_HEALTH } from "./health.ts";
import { pendingSinceByAircraft, waitingCallsByAircraft } from "./pending.ts";
import { readRadio, setRadioPendingSource } from "./radio-run.ts";
import { registrationOf } from "./registration.ts";
import { loadScheduleMode, loadScheduleOps } from "./schedule.ts";
import { CONTROL_SESSIONS, controlDirOf, MAX_LAUNCHED } from "./session-control.ts";
import { capIdleNow } from "./dispatch-launch.ts";
import { stoppedAirports } from "./auto-revert-run.ts";
import { type AlertEvent, controlDownOf, diffAlerts, repositionStuckOf, rtsHaltedOf, type SupervisorAlert, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { sinceLookNow } from "./since-look-run.ts";
import { summaryKey, summaryOf, type SupervisorSummary, workingOf } from "./supervisor-summary.ts";

// SUPERVISOR alerts(ATC-87)의 읽기와 상태. 계산은 supervisor-alerts.ts(순수). 여기는 파일을 읽어 입력을 모으고 지난 key 집합을 든다.
// 파일(logbook·제안·rts)을 읽으므로 스냅샷마다가 아니라 GAP_MS에 한 번만 다시 센다.
export const GAP_MS = 5_000;

let known = new Map<string, SupervisorAlert>();
let lastAt = 0;
let warmed = false;

export const currentAlerts = (): SupervisorAlert[] => [...known.values()];

// 최근 6시간의 재시작 기록(결과 알림은 이 창 안에서만 남는다)
export const RECYCLE_ALERT_MS = 6 * 3_600_000;
// 조건 항목(control|down, reposition|stuck)은 지금의 상태라 더 긴 창의 기록에서 마지막 결과를 본다(ATC-197). 한 번만 읽는다
export const CONDITION_WINDOW_MS = 24 * 3_600_000;
const recentRecycles = (rs: ReturnType<typeof readRecords>, now: number) =>
  rs.flatMap((r) => (r.kind === "control" && r.op === "recycle" && Date.parse(r.t) >= now - RECYCLE_ALERT_MS ? [r] : []));

// REPOSITION(ATC-179): 최근 6시간의 옮김과 auto → approval 기록
const repositionAlertInputs = (rs: ReturnType<typeof readRecords>, now: number) => {
  rs = rs.filter((r) => Date.parse(r.t) >= now - RECYCLE_ALERT_MS);
  return {
    repositions: rs.flatMap((r) => (r.kind === "fleet" && r.op === "reposition" && r.from && r.to ? [{ t: r.t, aircraft: r.aircraft, from: r.from, to: r.to, ok: r.ok, by: r.by, stage: r.stage, error: r.error }] : [])),
    repositionFlaps: rs.flatMap((r) => (r.kind === "reposition" && r.op === "mode" && r.by === "auto" ? [{ t: r.t, reason: r.reason ?? "flapping" }] : [])),
  };
};

// 지금 돌고 있는 관제 세션 이름과 AIRCRAFT REGISTRATION(조건 항목 control|down, reposition|stuck이 "다시 떴나"를 볼 때 쓴다)
function runningNames(s: Snapshot, teamPattern: string): { control: Set<string>; aircraft: Set<string> } {
  const dirs: Partial<Record<ControlName, string>> = {};
  for (const c of CONTROL_SESSIONS) if (c.dir) dirs[c.name as ControlName] = controlDirOf(c) ?? undefined;
  const live = s.sessions.filter((x) => x.status !== "dead");
  return {
    control: new Set(live.flatMap((x) => controlNameOf({ name: x.name, cwd: x.cwd }, dirs) ?? [])),
    aircraft: new Set(live.flatMap((x) => registrationOf(x.name, teamPattern) ?? [])),
  };
}

// land 항목의 목적지를 가르는 PR별 landBy(ATC-197). 이미 캐시된 등급만 쓴다(mccLandInfoCached) — 등급 규칙은 landByOf 그대로
function landByMap(s: Snapshot): Map<string, LandBy> {
  const info = mccLandInfoCached(s);
  return new Map((s.pulls ?? []).map((p) => [`${p.repo}#${p.number}`, landByOf(p, info, s.airports.find((a) => a.repo === p.repo)?.teamsMerge !== false)] as const));
}

export function collectAlerts(s: Snapshot, now: number): SupervisorAlert[] {
  const proposals = allProposals();
  const teamPattern = loadDispatchConfig().teamPattern;
  const rs = readRecords(now - CONDITION_WINDOW_MS);
  const running = runningNames(s, teamPattern);
  const rtsNow = rtsState(readMccRecords());
  const recyclesAll = rs.flatMap((r) => (r.kind === "control" && r.op === "recycle" ? [r] : []));
  const repositionsAll = rs.flatMap((r) => (r.kind === "fleet" && r.op === "reposition" && r.from && r.to ? [{ t: r.t, aircraft: r.aircraft, from: r.from, to: r.to, ok: r.ok, by: r.by, stage: r.stage, error: r.error }] : []));
  return supervisorAlertsOf({
    sessions: s.sessions,
    alerts: s.alerts,
    workspaces: s.workspaces,
    tickets: s.tickets,
    following: followingNow(s, now),
    proposals,
    autoDispatch: loadDispatchConfig().autoDispatch === "on",
    capIdle: capIdleNow(s.sessions, proposals, MAX_LAUNCHED, teamPattern, now),
    pulls: s.pulls ?? [],
    rts: rtsNow.last,
    rtsHalted: rtsHaltedOf(rtsNow.stop, rtsNow.last),
    revertStops: stoppedAirports().map((l) => ({ airport: l.airport ?? "?", at: l.at, detail: l.detail ?? "" })),
    controlDown: controlDownOf(recyclesAll, running.control),
    repositionStuck: repositionStuckOf(repositionsAll, running.aircraft),
    landBy: landByMap(s),
    schedule: { mode: loadScheduleMode(), ops: loadScheduleOps() },
    recycles: recentRecycles(rs, now),
    overCap: overCapNow(),
    ...repositionAlertInputs(rs, now),
    waiting: waitStuckNow(),
    follow: followAlertInput(s, now),
    pending: pendingInput(s, now, teamPattern),
  });
}

// PENDING approval(ATC-327): 승인을 기다리는 세션이 없으면 기록을 읽지 않는다. 있으면 그 AIRCRAFT에게 가는 열린 RADIO 호출을 센다(읽기만)
function pendingInput(s: Snapshot, now: number, teamPattern: string) {
  const pendingMin = config.health.pendingMin ?? DEFAULT_HEALTH.pendingMin!;
  if (!s.sessions.some((x) => x.status !== "dead" && x.health?.code === "PENDING")) return { now, pendingMin, calls: new Map(), teamPattern };
  try {
    return { now, pendingMin, calls: waitingCallsByAircraft(readRadio()), teamPattern };
  } catch {
    return { now, pendingMin, calls: new Map(), teamPattern }; // 교신 기록을 못 읽어도 시간 규칙은 그대로
  }
}

// FOLLOW(ATC-278): follow.json에 든 번들의 줄과, 발권한 FLIGHT의 줄(ATC-382, SUPERVISOR의 화살표). 접힌 번들은 뺀다. 따라가는 것이 없으면 보드를 셈하지 않는다
function followAlertInput(s: Snapshot, now: number) {
  if (!loadFollow().parents.length && !Object.keys(readReleaseView().records).length) return { rows: [], now };
  try {
    return { rows: followNow(s, now).bundles.filter((b) => !b.folded).flatMap((b) => b.rows), now };
  } catch {
    return { rows: [], now }; // 보드를 못 만들어도 다른 알림은 그대로
  }
}

// 스냅샷이 새로 나올 때 부른다. 바뀐 것이 있으면 `alert` 이벤트를 돌려주고, 아니면 null
export function runSupervisorAlerts(s: Snapshot, now = Date.now()): AlertEvent | null {
  // RADIO의 NO REPLY 사유(ATC-327): 받는 AIRCRAFT가 승인을 기다리는 중인지. 스냅샷마다 새로 정한다(간격 제한 앞에서)
  const pendingSince = pendingSinceByAircraft(s.sessions, loadDispatchConfig().teamPattern);
  setRadioPendingSource((reg) => pendingSince.get(reg) ?? null);
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

// SUPERVISOR SUMMARY(ATC-153): 지금 있는 알림 목록(currentAlerts)과 스냅샷의 FUEL·세션에서 센다. 파일은 sinceLook 칸만 읽는다(5초 캐시)
export function summaryNow(s: Snapshot, now = Date.now()): SupervisorSummary {
  const teamPattern = loadDispatchConfig().teamPattern;
  const items = currentAlerts();
  const base = summaryOf({
    items,
    fuelAccounts: s.fuelAccounts ?? [],
    rts: rtsState(readMccRecords()).last,
    working: workingOf(s.sessions.filter((x) => x.status !== "dead"), (name) => registrationOf(name, teamPattern), CONTROL_SESSIONS.map((c) => c.name)),
    at: new Date(now).toISOString(),
  });
  return { ...base, sinceLook: sinceLookNow(s, items, now) }; // ATC-383: 발권 기록·OOOI는 5초 캐시 안에서만 읽는다
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
