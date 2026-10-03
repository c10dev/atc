import { canceledKeysOf, canceledPrsOf, standHoldersOf } from "./canceled-flight.ts";
import { overCapNow, waitStuckNow } from "./control-recycle-run.ts";
import { readRecords } from "./recorder.ts";
import { k3HoldOf } from "./k3-allow.ts";
import { type EndedKey, followingNow } from "./following.ts";
import { endsTrackable, endsView, type EndsView, firstSeenOf, trackEnds } from "./alert-ends.ts";
import { appendReappeared, loadEnds, readReappeared, saveEnds } from "./alert-ends-run.ts";
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
import { waitingOnPersonOf } from "./waiting-person.ts";
import { readRadio, setRadioPendingSource } from "./radio-run.ts";
import { registrationOf } from "./registration.ts";
import { loadScheduleMode, loadScheduleOps } from "./schedule.ts";
import { CONTROL_SESSIONS, controlDirOf, jobStateOf, MAX_LAUNCHED } from "./session-control.ts";
import { capIdleNow } from "./dispatch-launch.ts";
import { stoppedAirports } from "./auto-revert-run.ts";
import { duplicatesNow } from "./control-stop-check-run.ts";
import { type StopCheckLine, unverifiedOf } from "./control-stop-check.ts";
import { type AlertEvent, alertKeyOf, type ControlOp, controlDownOf, controlGoneOf, diffAlerts, mergeControlDown, repositionStuckOf, rtsHaltedOf, type SupervisorAlert, DUPLICATED, supervisorAlertsOf, UNOWNED_KINDS } from "./supervisor-alerts.ts";
import { hostMemoryNow } from "./host-memory-run.ts";
import { sinceLookNow } from "./since-look-run.ts";
import { todoNow } from "./queue-todo.ts";
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

// 관제 세션마다 마지막으로 겪은 일(ATC-203): FLIGHT RECORDER의 control launch·stop·recycle 기록에서. SUPERVISOR의 STOP인지 가르는 데 쓴다.
// 새 상태 파일은 없다: 처음 한 번 CONTROL_STOP_LOOKBACK_MS만큼 읽고, 그 뒤로는 지난번 읽은 시각부터만 읽어 메모리에 든다(서버를 다시 켜면 다시 읽는다)
export const CONTROL_STOP_LOOKBACK_MS = 14 * 24 * 3_600_000;
// 다음에 읽을 때 이만큼 겹쳐 읽는다. launchControl·stopControl은 t를 먼저 정하고 claude 호출(시간 제한 60초)을 한 뒤에 기록을 붙이므로, 늦게 붙은 줄은 t가 옛날이다.
// 가장 긴 동작보다 훨씬 길게 겹쳐야 그 줄을 놓치지 않는다(같은 줄을 두 번 읽어도 해가 없다: 세션마다 가장 늦은 t만 남긴다). 못 보면 옛 STOP이 남아 죽은 세션을 SUPERVISOR의 뜻으로 오해한다
export const CONTROL_READ_OVERLAP_MS = 5 * 60_000;
const controlLast = new Map<string, ControlOp>();
let controlReadFrom = 0;
export function controlOpsNow(now: number, read: (sinceMs: number) => ReturnType<typeof readRecords> = readRecords): ReadonlyMap<string, ControlOp> {
  const from = controlReadFrom || now - CONTROL_STOP_LOOKBACK_MS;
  controlReadFrom = now - CONTROL_READ_OVERLAP_MS;
  for (const r of read(from)) {
    if (r.kind !== "control" || (r.op !== "launch" && r.op !== "stop" && r.op !== "recycle")) continue;
    if (r.op === "recycle" && (r.result === "would" || r.result === "would-wait")) continue; // 그림자 판정은 일어난 일이 아니다
    const prev = controlLast.get(r.session);
    if (!prev || prev.t <= r.t) controlLast.set(r.session, { t: r.t, op: r.op, by: r.by, ok: r.ok });
  }
  return controlLast;
}
// 시험이 기억을 비운다
export const resetControlOps = () => {
  controlLast.clear();
  controlReadFrom = 0;
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

// 끝 규칙의 상태(ATC-385): 처음 본 시각과 끝 규칙이 뺀 알림. 처음 쓸 때 파일에서 읽는다
let ends: ReturnType<typeof loadEnds> | null = null;

// 알림 목록과 끝 규칙이 뺀 알림. endRules를 끄면 규칙 없이 센 옛 목록(전후 비교용)이다
function collectWith(s: Snapshot, now: number, endRules: boolean): { items: SupervisorAlert[]; ended: EndedKey[] } {
  ends ??= loadEnds();
  const ended: EndedKey[] = [];
  const following = followingNow(s, now, endRules ? ended : undefined, endRules);
  const ownerless = s.alerts.filter((a) => UNOWNED_KINDS.has(a.kind)).map(alertKeyOf);
  const items = collectItems(s, now, following, endRules ? { now, since: new Map(Object.entries(firstSeenOf(ends.firstSeen, ownerless, now))), ended } : undefined);
  // following 문제의 key는 알림 key로 바꾼다(supervisorAlertsOf가 `following|`을 붙인다)
  // 알림이 아니었던 문제(다른 경로가 알리는 health·stranded·landing-wait)는 뺀 것으로 세지 않는다
  return { items, ended: ended.filter((e) => e.key.startsWith("alert|") || !DUPLICATED.has(e.key.split("|")[1] ?? "")).map((e) => (e.key.startsWith("alert|") ? e : { ...e, key: `following|${e.key}` })) };
}

export function collectAlerts(s: Snapshot, now: number): SupervisorAlert[] {
  const { items, ended } = collectWith(s, now, true);
  if (!endsTrackable(s)) return items; // Linear를 아직 못 읽은 주기는 기록하지 않는다(ATC-385)
  try {
    const prev = ends!;
    const t = trackEnds(prev, ended, new Set(items.map((a) => a.key)), now);
    const next = { firstSeen: firstSeenOf(prev.firstSeen, s.alerts.filter((a) => UNOWNED_KINDS.has(a.kind)).map(alertKeyOf), now), cleared: t.state.cleared };
    appendReappeared(t.reappeared);
    if (JSON.stringify(next) !== JSON.stringify(prev)) saveEnds(next);
    ends = next;
  } catch (e) {
    console.warn(`[atc] alert-ends: ${e instanceof Error ? e.message : e}`); // 기록을 못 써도 알림은 그대로
  }
  return items;
}

// 끝 규칙 24시간 요약과, 같은 상태에서 규칙 없이/있이 센 CAUTION 수(ATC-385)
export function endsNow(s: Snapshot, now = Date.now()): EndsView {
  const cautions = (r: { items: SupervisorAlert[] }) => r.items.filter((a) => a.level === "caution").length;
  ends ??= loadEnds();
  return { ...endsView(ends, readReappeared(), now), caution: { before: cautions(collectWith(s, now, false)), after: cautions(collectWith(s, now, true)) } };
}

// DISPATCH가 K3 hold로 보내지 않는 Todo FLIGHT(ATC-398). 스위치가 꺼져 있으면 없다.
// 발권 전의 FLIGHT는 RELEASE 화면이 K3 상태를 보이므로(발권하면 allow를 준다) 읽히지 않는 줄과, 이미 allow를 못 주는 채널로 발권된 FLIGHT만 알린다
function k3HoldsOf(s: Snapshot): { flight: string; text: string; fix: string }[] {
  if (loadDispatchConfig().k3Hold === "off") return [];
  return s.tickets.flatMap((t) => {
    if (!t.k3Check || t.stateType !== "unstarted") return [];
    const h = k3HoldOf({ check: t.k3Check, declared: t.k3, flight: t.key, hash: t.releaseHash, releases: s.releases });
    if (!h || (h.code === "release-on-screen" && !s.releases?.records[t.key])) return [];
    return [{ flight: t.key, text: h.why, fix: h.fix }];
  });
}

// 취소된 FLIGHT에 열린 PR(ATC-460). 그 PR의 STAND를 쥔 AIRCRAFT를 함께 적는다
function canceledPrsNow(s: Snapshot, teamPattern: string) {
  const nameOf = new Map(s.sessions.map((x) => [x.id, registrationOf(x.name, teamPattern) ?? x.name]));
  return canceledPrsOf(s.pulls ?? [], canceledKeysOf(s.tickets), standHoldersOf(s.claims, (id) => nameOf.get(id)), (repo) => s.airports.find((a) => a.repo === repo)?.code ?? null);
}

function collectItems(s: Snapshot, now: number, following: ReturnType<typeof followingNow>, unowned: Parameters<typeof supervisorAlertsOf>[0]["unowned"]): SupervisorAlert[] {
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
    following,
    ...(unowned ? { unowned } : {}),
    proposals,
    autoDispatch: loadDispatchConfig().autoDispatch === "on",
    capIdle: capIdleNow(s.sessions, proposals, MAX_LAUNCHED, teamPattern, now),
    pulls: s.pulls ?? [],
    rts: rtsNow.last,
    rtsHalted: rtsHaltedOf(rtsNow.stop, rtsNow.last),
    revertStops: stoppedAirports().map((l) => ({ airport: l.airport ?? "?", at: l.at, detail: l.detail ?? "" })),
    k3Holds: k3HoldsOf(s),
    canceledPrs: canceledPrsNow(s, teamPattern),
    // RECYCLE이 멈춘 채인 것(이유가 분명)과 이유 불문 없는 것(ATC-203)을 세션마다 하나로
    controlDown: mergeControlDown(
      controlDownOf(recyclesAll, running.control),
      controlGoneOf({ sessions: CONTROL_SESSIONS.filter((c) => c.launch === "bg" && !c.retired).map((c) => c.name), running: running.control, last: controlOpsNow(now), now }),
    ),
    controlChecks: { unverified: unverifiedOf(rs.flatMap((r) => (r.kind === "control" && r.op === "stop-check" ? [r as unknown as StopCheckLine] : [])), (id) => jobStateOf(id), now), duplicates: duplicatesNow() },
    hostMemory: hostMemoryNow(now),
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
    waiting: waitingOnPersonOf({ sessions: s.sessions.filter((x) => x.status !== "dead"), proposals: allProposals(), now, blockedMin: config.health.blockedMin ?? DEFAULT_HEALTH.blockedMin!, teamPattern }),
    fuelAccounts: s.fuelAccounts ?? [],
    rts: rtsState(readMccRecords()).last,
    working: workingOf(s.sessions.filter((x) => x.status !== "dead"), (name) => registrationOf(name, teamPattern), CONTROL_SESSIONS.map((c) => c.name)),
    at: new Date(now).toISOString(),
  });
  const todo = todoNow();
  return { ...base, ...(todo === null ? {} : { todo }), sinceLook: sinceLookNow(s, items, now) }; // ATC-383: 발권 기록·OOOI는 5초 캐시 안에서만 읽는다
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
