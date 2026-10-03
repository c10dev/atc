import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { standFreeTimeliness } from "./standfree-run.ts";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import {
  AUTO_CAP,
  type AtfmConfig,
  AtfmError,
  allShadow,
  autoEligibility,
  ciMinutesOf,
  ciTrendOf,
  enforcedStops,
  type GroundStop,
  type Eligibility,
  landFiguresOf,
  landOf,
  landSpansOf,
  loadAtfm,
  losDayOf,
  median,
  precisionOf,
  s3Eligibility,
  saveAtfm,
  setStopFigures,
  setSwitch,
  slotHoldOf,
  slotLimitOf,
  slotsOf,
  stopKey,
  THRESHOLDS,
  undoneOf,
} from "./atfm.ts";
import { allClearances } from "./clearances.ts";
import { config } from "./config.ts";
import { readDepartures } from "./departures.ts";
import { modelFamily, UNKNOWN_MODEL } from "./crosscheck.ts";
import { landedOf, loadDispatchConfig, mccAirportNow, planDispatch, readFlightHistory } from "./dispatch.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import { pullKey } from "./landing.ts";
import { loadLogbook } from "./logbook.ts";
import { parentKeysOf, type Snapshot } from "./model.ts";
import { allProposals, gate3Of, gateOf as dispatchGateOf, humanOf as proposalHuman, isInFlight, reservedOf } from "./proposals.ts";
import { readRecords, record, type RecordLine } from "./recorder.ts";
import { regKey } from "./registration.ts";
import { changesOf, gateOf as scheduleGateOf, humanOf as scheduleHuman, loadScheduleMode, loadScheduleOps } from "./schedule.ts";
import { activeWaypointsOf } from "./routes.ts";
import { readGithub } from "./sources/github.ts";
import { readLinearProjects } from "./sources/linear-projects.ts";
import { accountFolders } from "./accounts.ts";
import { orphanCountsNow } from "./orphan-flight-run.ts";

// ATFM 실행부: 스냅샷마다 출발 중지의 시작·끝을, 1분마다 데이터(CI 소요 시간, BEHIND 전이, 되돌린 라벨)와
// 그림자 판정(자동 배정 대상, S3 대상)을 FLIGHT RECORDER의 atfm 줄로 남기고, /api/atfm으로 보여 준다.
// 같은 것을 두 번 적지 않게 적은 키를 ~/.local/state/atc/atfm-state.json에 둔다.

const MIN = 60_000;
const DAY = 86_400_000;
const HEAVY_MS = MIN;
const KEEP = 1000;

interface RunState {
  stops: Record<string, string>; // stopKey → since (그림자 포함)
  ci: string[]; // repo#pr@head
  behind: Record<string, string>; // repo#pr → mergeStateStatus
  eligible: string[]; // D-xxxx
  s3: string[]; // S-xxxx
  undone: string[]; // S-xxxx
  slotHold: string[]; // repo#pr@head — 슬롯이 켜져(on) LAND를 막은 PR
}
const STATE_FILE = () => join(config.stateDir, "atfm-state.json");

function loadState(file = STATE_FILE()): RunState {
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return { stops: r.stops ?? {}, ci: r.ci ?? [], behind: r.behind ?? {}, eligible: r.eligible ?? [], s3: r.s3 ?? [], undone: r.undone ?? [], slotHold: r.slotHold ?? [] };
  } catch {
    return { stops: {}, ci: [], behind: {}, eligible: [], s3: [], undone: [], slotHold: [] };
  }
}
function saveState(st: RunState, file = STATE_FILE()) {
  const trim = (xs: string[]) => xs.slice(-KEEP);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...st, ci: trim(st.ci), eligible: trim(st.eligible), s3: trim(st.s3), undone: trim(st.undone), slotHold: trim(st.slotHold) }) + "\n");
  renameSync(tmp, file);
}

const atfmLine = (op: string, fields: { id?: string; airport?: string | null; data?: Record<string, unknown> } = {}): RecordLine => ({
  t: new Date().toISOString(),
  kind: "atfm",
  op,
  ...(fields.id ? { id: fields.id } : {}),
  ...(fields.airport ? { airport: fields.airport } : {}),
  ...(fields.data ? { data: fields.data } : {}),
});

let state: RunState | null = null;
let lastHeavy = 0;
let lastFigures = 0;
const lastSeen = new Map<string, GroundStop>(); // stopKey → 지난 tick의 출발 중지(해제 사유를 적으려고)

// 두 번째 트리거 입력(순수): FLIGHT RECORDER의 atfm ci 줄 → AIRPORT 저장소별 체크 소요 시간 추세,
// event 줄의 LOS(alert.raised conflict) → 24시간 안 LOS 수
export function stopFiguresOf(lines: RecordLine[], airports: { code: string; repo: string }[], repoOfStand: (stand: string) => string | null, now: number) {
  const ciTrend = new Map<string, NonNullable<ReturnType<typeof ciTrendOf>>>();
  for (const a of airports) {
    const samples = lines.flatMap((r) =>
      r.kind === "atfm" && r.op === "ci" && r.airport === a.code && Number.isFinite(Number(r.data?.minutes)) ? [{ t: r.t, minutes: Number(r.data!.minutes) }] : [],
    );
    const trend = ciTrendOf(samples, now);
    if (trend) ciTrend.set(a.repo, trend);
  }
  const los = lines.flatMap((r) =>
    r.kind === "event" && r.event.kind === "alert.raised" && r.event.alertKind === "conflict" ? [{ at: r.event.at ?? r.t, workspacePath: r.event.workspacePath ?? null }] : [],
  );
  return { ciTrend, losDay: losDayOf(los, repoOfStand, now) };
}

// 풀린 출발 중지의 해제 사유(ATC-62). 스위치를 끔, 해제 규칙(30분, 통과 PR 2개), 트리거가 풀림, 재시작 전 것
export function releasedBy(last: GroundStop | undefined, cfg: AtfmConfig): string {
  if (!last) return "restart";
  const mode = last.trigger === "failure-wave" ? cfg.groundStop.failureWave : last.trigger === "congestion" ? cfg.groundStop.congestion : last.trigger === "los" ? cfg.groundStop.los : null;
  if (mode === "off") return "switched-off";
  if (last.clearSince) return last.trigger === "failure-wave" ? "passed-in-2-prs" : "30-min-below";
  return "cleared";
}

// 서버 tick마다 부른다. GitHub을 아직 못 읽었으면 출발 중지 비교를 하지 않는다(스냅샷도 비어 있다).
export function runAtfm(s: Snapshot, now = Date.now()) {
  state ??= loadState();
  let dirty = false;
  if (s.github.fetchedAt) {
    const current = new Map(s.atfm.groundStops.map((g) => [stopKey(g), g]));
    const cfgNow = loadAtfm();
    for (const [k, g] of current) {
      if (k in state.stops) continue;
      state.stops[k] = g.since;
      record(
        atfmLine("ground-stop", {
          airport: g.airport,
          data: { trigger: g.trigger, kind: g.kind, land: g.land, enforced: g.enforced, text: g.text, evidence: g.evidence, ...(g.check ? { check: g.check } : {}) },
        }),
      );
      dirty = true;
    }
    for (const k of Object.keys(state.stops)) {
      if (current.has(k)) continue;
      const [airport, trigger] = k.split("|");
      record(atfmLine("ground-release", { airport, data: { trigger, since: state.stops[k], releasedBy: releasedBy(lastSeen.get(k), cfgNow) } }));
      delete state.stops[k];
      dirty = true;
    }
    lastSeen.clear();
    for (const [k, g] of current) lastSeen.set(k, g);
  }
  // 머지 슬롯이 켜져 있으면(7단계) LAND를 막은 PR을 head마다 한 번 적는다
  const cfg = loadAtfm();
  if (cfg.slots === "on" && s.github.fetchedAt) {
    for (const h of slotHoldsOf(s, cfg, now)) {
      if (state.slotHold.includes(h.key)) continue;
      state.slotHold.push(h.key);
      record(atfmLine("slot-hold", { airport: h.airport, data: { pr: h.pr, head: h.head, lanePos: h.lanePos, limit: h.limit, landTimedOut: h.landTimedOut, text: h.text } }));
      dirty = true;
    }
  }
  // 두 번째 트리거 입력(7일 CI 추세, 24시간 LOS)을 1분마다 다시 센다. STAND → 저장소는 지금 워크트리, 없으면 착수 기록
  if (now - lastFigures >= HEAVY_MS) {
    lastFigures = now;
    const repoOf = new Map(s.workspaces.map((w) => [w.path, w.repo]));
    for (const d of readDepartures()) if (d.stand && !repoOf.has(d.stand)) repoOf.set(d.stand, d.repo);
    const lines = readRecords(now - 7 * DAY - 2 * 3_600_000);
    setStopFigures(stopFiguresOf(lines, s.airports.map((a) => ({ code: a.code, repo: a.repo })), (stand) => repoOf.get(stand) ?? null, now));
  }
  if (now - lastHeavy >= HEAVY_MS && s.github.fetchedAt && s.linear.fetchedAt) {
    lastHeavy = now;
    dirty = heavy(s, state, now) || dirty;
  }
  if (dirty) saveState(state);
}

function heavy(s: Snapshot, st: RunState, now: number): boolean {
  let dirty = false;
  const codeOf = (repo: string) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  // CI 소요 시간(체크가 모두 끝난 PR head마다 한 번), BEHIND 전이(열린 PR이 BEHIND가 됨)
  const gh = readGithub(s.airports.map((a) => a.repo));
  const ciSeen = new Set(st.ci);
  const nextBehind: Record<string, string> = {};
  for (const [repo, pulls] of gh.byRepo) {
    for (const p of pulls) {
      const key = `${repo}#${p.number}@${p.headRefOid}`;
      const minutes = ciMinutesOf(p.statusCheckRollup);
      if (minutes !== null && !ciSeen.has(key)) {
        ciSeen.add(key);
        st.ci.push(key);
        record(atfmLine("ci", { airport: codeOf(repo), data: { pr: p.number, head: p.headRefOid.slice(0, 7), minutes } }));
        dirty = true;
      }
      const k = `${repo}#${p.number}`;
      nextBehind[k] = p.mergeStateStatus;
      // DIRTY 전이(ATC-71): 그때 파일이 겹치는 다른 열린 PR이 있었나 — DISPATCH가 볼 수 있었던 겹침의 지표
      if (p.mergeStateStatus === "DIRTY" && k in st.behind && st.behind[k] !== "DIRTY") {
        const mine = new Set(p.changed ?? []);
        const overlaps = pulls
          .filter((o) => o.number !== p.number && o.changed)
          .map((o) => ({ pr: o.number, files: o.changed!.filter((f) => mine.has(f)).length }))
          .filter((o) => o.files > 0);
        record(atfmLine("dirty", { airport: codeOf(repo), data: { pr: p.number, was: st.behind[k], overlaps } }));
        dirty = true;
      }
      if (p.mergeStateStatus === "BEHIND" && k in st.behind && st.behind[k] !== "BEHIND") {
        record(atfmLine("behind", { airport: codeOf(repo), data: { pr: p.number, was: st.behind[k] } }));
        dirty = true;
      }
    }
  }
  if (JSON.stringify(nextBehind) !== JSON.stringify(st.behind)) {
    st.behind = nextBehind;
    dirty = true;
  }
  // 그림자 판정: 처음 대상이 된 제안·초안을 적는다(정확도는 나중에 사람 판정과 맞춰 본다)
  const view = eligibilityView(s, now);
  for (const e of view.auto) {
    if (!e.eligible || st.eligible.includes(e.id)) continue;
    st.eligible.push(e.id);
    record(atfmLine("eligible", { id: e.id, airport: e.airport, data: { flight: e.flight, aircraft: e.aircraft, checked: e.checked } }));
    dirty = true;
  }
  for (const e of view.s3) {
    if (!e.eligible || st.s3.includes(e.id)) continue;
    st.s3.push(e.id);
    record(atfmLine("s3-eligible", { id: e.id, data: { flight: e.flight, checked: e.checked } }));
    dirty = true;
  }
  const ops = loadScheduleOps();
  for (const id of undoneOf(ops, s.tickets, (o, t) => changesOf(o.kind, o.payload, t), now)) {
    if (st.undone.includes(id)) continue;
    st.undone.push(id);
    record(atfmLine("undone", { id }));
    dirty = true;
  }
  return dirty;
}

type AutoItem = Eligibility & { aircraft: string | null; airport: string | null };

// 열린 ASSIGN·CLASSIFY 초안의 그림자 판정
export function eligibilityView(s: Snapshot, now = Date.now()) {
  const cfg = loadDispatchConfig();
  const proposals = allProposals();
  const fleet = loadFleet();
  const logbook = loadLogbook();
  const plan = planDispatch(s, readFlightHistory(), cfg, now, reservedOf(proposals), fleet, landedOf(logbook), logbook, activeWaypointsOf(readLinearProjects().milestones), undefined, undefined, mccAirportNow(), accountFolders(), undefined, orphanCountsNow(s, now, proposals, landedOf(logbook), cfg.teamPattern));
  const aircraftViews = fleetView(s, fleet, cfg.teamPattern, logbook, now);
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const parentKeys = parentKeysOf(s.tickets);
  const stopped = enforcedStops(s.atfm.groundStops);
  const auto: AutoItem[] = proposals
    .filter((p) => p.kind === "ASSIGN" && p.status === "proposed" && p.holdAt === null)
    .map((p) => {
      const name = regKey(p.aircraftName, cfg.teamPattern); // `Team G`도 TEAM_G(ATC-67)
      const e = autoEligibility(p, {
        ticket: byKey.get(p.flight),
        aircraft: aircraftViews.find((a) => a.registration === name),
        state: plan.aircraft.find((a) => regKey(a.name, cfg.teamPattern) === name),
        parentKeys,
        history: proposals,
        stopped,
        now,
      });
      return { ...e, aircraft: p.aircraftName, airport: p.airport };
    });
  const ops = loadScheduleOps();
  const s3ctx = {
    standTickets: new Set(s.workspaces.map((w) => w.ticketKey).filter(Boolean) as string[]),
    inFlight: new Set(proposals.filter(isInFlight).map((p) => p.flight)),
    cautions: new Set(proposals.filter((p) => p.caution).map((p) => p.flight)),
  };
  const s3 = ops.filter((o) => o.status === "draft" && o.kind === "CLASSIFY").map((o) => s3Eligibility(o, o.flight ? byKey.get(o.flight) : undefined, s3ctx));
  return { auto, s3, proposals, ops };
}

type Row = { id: string; label: string; value: string; target: string; status: "pass" | "fail" | "insufficient" | "check" };
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

// approval 운용 기간(켜는 조건 "2주 이상"). FLIGHT RECORDER의 마지막 `mode:` 줄에서 잰다.
// 지금 모드가 approval인데 마지막 전환 기록이 approval이 아니거나 없으면(파일을 직접 고쳤거나 보존 기간 30일 밖) 잴 수 없어 "check"(확인 필요).
export const APPROVAL_RUN_DAYS = 14;
export function approvalRunOf(records: { t: string; kind: string; op?: string }[], kind: "dispatch" | "schedule", mode: string, now: number): { status: Row["status"]; since: string | null; days: number | null } {
  if (mode !== "approval") return { status: "fail", since: null, days: null };
  const last = records.filter((r) => r.kind === kind && typeof r.op === "string" && r.op.startsWith("mode:")).sort((a, b) => a.t.localeCompare(b.t)).at(-1);
  if (!last || last.op !== "mode:approval") return { status: "check", since: null, days: null };
  const days = (now - Date.parse(last.t)) / DAY;
  return { status: days >= APPROVAL_RUN_DAYS ? "pass" : "insufficient", since: last.t, days };
}
const runRow = (id: string, label: string, mode: string, run: ReturnType<typeof approvalRunOf>): Row => ({
  id, label,
  value: run.since ? `${mode} · ${Math.floor(run.days!)}일째(${run.since.slice(0, 10)}부터)` : run.status === "check" ? `${mode} · 전환 기록 없음(확인 필요)` : mode,
  target: `approval · ${APPROVAL_RUN_DAYS}일`,
  status: run.status,
});

// 지금 쓰는 CROSSCHECK 모델 계열(가장 최근 mark의 계열)의 일치율. unknown(모델 기록 전의 mark)은 세지 않는다
export function currentModelRate(items: { crosscheck: { model: string; at: string } | null }[], byModel: Record<string, { marked: number; matched: number; rate: number | null }>) {
  const latest = items.filter((x) => x.crosscheck && modelFamily(x.crosscheck.model) !== UNKNOWN_MODEL).sort((a, b) => b.crosscheck!.at.localeCompare(a.crosscheck!.at))[0]?.crosscheck?.model;
  if (!latest) return null;
  const family = modelFamily(latest);
  const r = byModel[family] ?? { marked: 0, matched: 0, rate: null };
  return { model: family, marked: r.marked, matched: r.matched, rate: r.rate };
}
// CROSSCHECK 일치 줄은 은퇴로 켜기 점검에서 뺐다(ATC-371). 모델 계열별 옛 일치율(currentModelRate)은 기록으로 남는다
const rateRow = (id: string, label: string, r: { marked: number; rate: number | null; model?: string } | null, n: number, min: number): Row => ({
  id, label: r?.model ? `${label} · ${r.model}` : label,
  value: r ? `${pct(r.rate)} (${r.marked}건)` : "—",
  target: `≥ ${Math.round(min * 100)}% · ${n}건`,
  status: !r || r.marked < n ? "insufficient" : (r.rate ?? 0) >= min ? "pass" : "fail",
});

// 지금 슬롯이 LAND를 막는 PR(slots "on"일 때만 나온다)
function slotHoldsOf(s: Snapshot, cfg: AtfmConfig, now: number) {
  const codeOf = (repo: string) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  const mainOf = new Map(s.atfm.mains.map((m) => [m.repo, m]));
  const priorityOf = new Map(s.tickets.map((t) => [t.key, t.priority]));
  const slotMap = slotsOf(s.pulls, {
    limitOf: (repo) => slotLimitOf(codeOf(repo), mainOf.get(repo), cfg),
    priorityOf: (k) => (k ? (priorityOf.get(k) ?? 0) : 0),
    landOf: (p) => landOf(p, s.clearances),
    now,
  });
  return s.pulls.flatMap((p) => {
    const v = slotMap.get(pullKey(p));
    const hold = slotHoldOf(v, cfg.slots);
    return v && hold ? [{ key: `${p.repo}#${p.number}@${p.head}`, airport: codeOf(p.repo), pr: p.number, head: p.head.slice(0, 7), lanePos: v.lanePos, limit: v.limit, landTimedOut: v.landTimedOut, text: hold.text }] : [];
  });
}

export function atfmView(s: Snapshot, cfg: AtfmConfig = loadAtfm(), now = Date.now()) {
  const codeOf = (repo: string | null) => (repo ? (s.airports.find((a) => a.repo === repo)?.code ?? null) : null);
  const mainOf = new Map(s.atfm.mains.map((m) => [m.repo, m]));
  const priorityOf = new Map(s.tickets.map((t) => [t.key, t.priority]));
  const slotMap = slotsOf(s.pulls, {
    limitOf: (repo) => slotLimitOf(codeOf(repo), mainOf.get(repo), cfg),
    priorityOf: (k) => (k ? (priorityOf.get(k) ?? 0) : 0),
    landOf: (p) => landOf(p, s.clearances),
    now,
  });
  const slots = s.pulls
    .filter((p) => slotMap.has(pullKey(p)))
    .map((p) => ({ airport: codeOf(p.repo), pr: p.number, title: p.title, url: p.url, ...slotMap.get(pullKey(p))! }))
    .sort((a, b) => (a.airport ?? "").localeCompare(b.airport ?? "") || a.lanePos - b.lanePos);

  const all = readRecords(now - 30 * DAY);
  const records = all.filter((r) => r.kind === "atfm") as Extract<RecordLine, { kind: "atfm" }>[];
  const ids = (op: string) => new Set(records.filter((r) => r.op === op && r.id).map((r) => r.id!));
  const { auto, s3, proposals, ops } = eligibilityView(s, now);

  const dispatchItems = proposals.map((p) => ({ id: p.id, human: proposalHuman(p), reasonCodes: p.reasonCodes, crosscheck: p.crosscheck }));
  const autoPrecision = precisionOf(new Set([...ids("eligible"), ...auto.filter((e) => e.eligible).map((e) => e.id)]), dispatchItems);
  const g3 = gate3Of(proposals, standFreeTimeliness());
  const logbook = loadLogbook();
  const losRecent = logbook.filter((e) => now - Date.parse(e.arrivedAt) < 14 * DAY && e.los > 0).length;
  const dispatchMode = loadDispatchConfig().mode;
  const autoTurnOn: Row[] = [
    runRow("2b", "2b 승인 운용 2주 이상", dispatchMode, approvalRunOf(all as { t: string; kind: string; op?: string }[], "dispatch", dispatchMode, now)),
    { id: "gate3", label: "2b 점검(gate3): READBACK·DEPARTED", value: `${g3.dispatched}건 · READBACK ${pct(g3.readbackRate)} · DEPARTED ${pct(g3.departedRate)}${g3.standFree.readBack ? ` · STAND 없음 ${g3.standFree.readBack}건(ARRIVED ${g3.standFree.arrived}${g3.standFree.timely?.total ? `, 24시간 안 ${g3.standFree.timely.within}/${g3.standFree.timely.total}` : ""})` : ""}`, target: "≥ 10건 · 90% · 80%", status: g3.ready ? "pass" : g3.dispatched < 3 ? "insufficient" : "fail" },
    {
      id: "precision", label: "그림자 정확도(대상 중 사람 승인)",
      value: `${pct(autoPrecision.rate)} (${autoPrecision.decided}건${autoPrecision.bad ? ` · 막아야 했던 거절 ${autoPrecision.bad}` : ""})`,
      target: `≥ ${THRESHOLDS.precision * 100}% · ${THRESHOLDS.precisionN}건 · 막아야 했던 거절 0`,
      status: autoPrecision.decided < THRESHOLDS.precisionN ? "insufficient" : (autoPrecision.rate ?? 0) >= THRESHOLDS.precision && !autoPrecision.bad ? "pass" : "fail",
    },
    { id: "los", label: "LOS 없음(14일, LOGBOOK)", value: `${losRecent}건`, target: "0건", status: losRecent ? "fail" : "pass" },
  ];

  const scheduleItems = ops.map((o) => ({ id: o.id, human: scheduleHuman(o), crosscheck: o.crosscheck }));
  const s3Precision = precisionOf(new Set([...ids("s3-eligible"), ...s3.filter((e) => e.eligible).map((e) => e.id)]), scheduleItems);
  // #29 뒤 규칙(근거에 fleet.md 절 인용)으로 쓴 CLASSIFY 초안의 사람 합의
  const cited = ops.filter((o) => o.kind === "CLASSIFY" && /(^|[^\d.])4\.[123](?!\d)/.test(o.reason)).map((o) => scheduleHuman(o)).filter(Boolean);
  const citedAgree = cited.length ? cited.filter((h) => h!.verdict === "agree").length / cited.length : null;
  const undone = ids("undone").size;
  const scheduleMode = loadScheduleMode();
  const s3TurnOn: Row[] = [
    runRow("s2", "S2 승인 운용 2주 이상", scheduleMode, approvalRunOf(all as { t: string; kind: string; op?: string }[], "schedule", scheduleMode, now)),
    { id: "classify", label: "CLASSIFY 사람 합의(fleet.md 절을 인용한 초안)", value: `${pct(citedAgree)} (${cited.length}건)`, target: "≥ 85% · 20건", status: cited.length < 20 ? "insufficient" : (citedAgree ?? 0) >= 0.85 ? "pass" : "fail" },
    {
      id: "precision", label: "그림자 정확도(대상 중 사람 승인)", value: `${pct(s3Precision.rate)} (${s3Precision.decided}건)`,
      target: `≥ ${THRESHOLDS.precision * 100}% · ${THRESHOLDS.precisionN}건`,
      status: s3Precision.decided < THRESHOLDS.precisionN ? "insufficient" : (s3Precision.rate ?? 0) >= THRESHOLDS.precision ? "pass" : "fail",
    },
    { id: "undone", label: "사람이 되돌린 자동 라벨(7일)", value: `${undone}건`, target: "0건", status: undone ? "fail" : "pass" },
  ];

  // 데이터: 7일 CI 중앙값, 머지당 BEHIND
  const week = records.filter((r) => now - Date.parse(r.t) < 7 * DAY);
  const airports = s.airports.map((a) => a.code);
  const ci = airports.map((code) => {
    const xs = week.filter((r) => r.op === "ci" && r.airport === code).map((r) => Number(r.data?.minutes)).filter((x) => Number.isFinite(x));
    return { airport: code, samples: xs.length, medianMin: median(xs) };
  });
  const behind = airports.map((code) => {
    const repo = s.airports.find((a) => a.code === code)?.repo;
    const merges = logbook.filter((e) => e.airport === code && now - Date.parse(e.arrivedAt) < 7 * DAY).length;
    const n = week.filter((r) => r.op === "behind" && r.airport === code).length;
    return { airport: code, repo, merges, behind: n, perMerge: merges ? Math.round((n / merges) * 100) / 100 : null };
  });
  // 7일 동안 DIRTY가 된 PR 수와, 그중 그때 파일이 겹치는 열린 PR이 있던 수(파일 겹침 지표, ATC-71)
  const dirtyWeek = airports.map((code) => {
    const rs = week.filter((r) => r.op === "dirty" && r.airport === code);
    return { airport: code, dirty: rs.length, seen: rs.filter((r) => Array.isArray(r.data?.overlaps) && (r.data!.overlaps as unknown[]).length > 0).length };
  });
  // 머지 슬롯 켜기 판단(5장 Turn-on): 7일 동안 AIRPORT별 LAND, 동시에 살아 있던 LAND, LAND → 머지 중앙값, 시간 초과
  const repoOfStand = new Map(s.workspaces.map((w) => [w.path, w.repo]));
  const lands = landFiguresOf(
    landSpansOf(
      allClearances().filter((c) => now - Date.parse(c.at) < 8 * DAY),
      logbook,
      (c) => (c.stand ? codeOf(repoOfStand.get(c.stand) ?? null) : null),
      now,
    ),
    now - 7 * DAY,
  );

  return {
    config: cfg,
    mains: s.atfm.mains.map((m) => ({ ...m, airport: codeOf(m.repo) })),
    groundStops: s.atfm.groundStops,
    slots,
    auto: { mode: cfg.autoAssign, open: auto.map(({ id, flight, aircraft, eligible, failed }) => ({ id, flight, aircraft, eligible, failed })), precision: autoPrecision, turnOn: autoTurnOn },
    s3: { mode: cfg.s3, open: s3.map(({ id, flight, eligible, failed }) => ({ id, flight, aircraft: null, eligible, failed })), precision: s3Precision, turnOn: s3TurnOn },
    data: { ci, behind: behind.map(({ repo: _r, ...x }) => x), dirty: dirtyWeek, undone, lands },
    caps: AUTO_CAP,
    thresholds: THRESHOLDS,
  };
}

// ── API ──

export function mountAtfm(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/atfm", async (c) => c.json(atfmView(await getSnapshot())));

  const change = (fn: (cfg: AtfmConfig, body: Record<string, unknown>, c: Context) => AtfmConfig, op: string) => async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const next = fn(loadAtfm(), body, c);
      saveAtfm(next);
      record(atfmLine(op, { airport: typeof body.airport === "string" ? body.airport : (c.req.param("airport") ?? null), data: { key: body.key, value: body.value, reason: body.reason } }));
      return c.json({ config: loadAtfm() });
    } catch (e) {
      if (e instanceof AtfmError) return c.json({ error: e.message }, 400);
      throw e;
    }
  };

  // 스위치 하나. 출발 중지 다섯 가지(결정 8, ATC-62)와 slots(7단계)는 on까지. 켜는 것은 SUPERVISOR(ATC-23)
  app.post("/api/atfm/switch", change((cfg, b) => setSwitch(cfg, b.key, b.value), "switch"));
  // ATFM OFF: 켜진 것을 모두 그림자로, 수동 출발 중지 스위치는 끔
  app.post("/api/atfm/off", change((cfg) => allShadow(cfg), "off"));

  // 수동 출발 중지 선언·해제. 스위치(groundStop.manual)가 켜져 있어야 선언할 수 있다
  app.post("/api/atfm/stops", async (c) => {
    const cfg = loadAtfm();
    if (cfg.groundStop.manual !== "on") return c.json({ error: "수동 출발 중지 스위치(groundStop.manual)가 꺼져 있음" }, 409);
    return change((cfg2, b) => {
      const airport = String(b.airport ?? "").trim().toUpperCase();
      const reason = typeof b.reason === "string" ? b.reason.trim() : "";
      if (!/^[A-Z0-9]{2,8}$/.test(airport)) throw new AtfmError("airport(AIRPORT 코드)가 필요함");
      if (!reason || reason.length > 200) throw new AtfmError("reason은 1~200자");
      return { ...cfg2, manualStops: [...cfg2.manualStops.filter((m) => m.airport !== airport), { airport, reason, at: new Date().toISOString() }] };
    }, "manual-stop")(c);
  });
  app.post(
    "/api/atfm/stops/:airport/release",
    change((cfg, _b, c) => {
      const airport = (c.req.param("airport") ?? "").toUpperCase();
      if (!cfg.manualStops.some((m) => m.airport === airport)) throw new AtfmError(`${airport}에 수동 출발 중지가 없음`);
      return { ...cfg, manualStops: cfg.manualStops.filter((m) => m.airport !== airport) };
    }, "manual-release"),
  );
}
