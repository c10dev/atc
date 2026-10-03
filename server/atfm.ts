import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { classOf } from "./crew.ts";
import type { AircraftState } from "./dispatch.ts";
import { tailsOf } from "./dispatch.ts";
import { inSequence, pullKey } from "./landing.ts";
import type { GhPull } from "./landing.ts";
import type { Clearance, PullRequest, Snapshot, Ticket } from "./model.ts";
import type { AircraftView } from "./fleet.ts";
import type { Proposal } from "./proposals.ts";
import { regKey } from "./registration.ts";
import type { ScheduleOp } from "./schedule.ts";

// ATFM(3단계 흐름 관리). 설계: docs/atfm.md. 이 파일은 8장의 1~5단계다:
// 데이터(기본 브랜치 CI, 체크 소요 시간, BEHIND 전이, 되돌린 라벨), 출발 중지(GROUND STOP) 계산,
// 머지 슬롯·자동 배정 대상·S3 대상의 그림자 판정. 출발 중지는 다섯 가지 모두 켤 수 있지만(6단계, ATC-62)
// 기본값은 켜져 있지 않다. 자동 배정·자동 S3는 없다(판정만 보여 주고 FLIGHT RECORDER에 남긴다).

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ── 스위치 (~/.local/state/atc/atfm.json, SUPERVISOR 결정 10) ──

export type StopMode = "off" | "shadow" | "on";
export type ShadowMode = "off" | "shadow";

export interface ManualStop {
  airport: string; // AIRPORT 코드
  reason: string;
  at: string;
}

export interface AtfmConfig {
  groundStop: {
    mainBroken: StopMode; // 켤 수 있음(결정 8)
    manual: "off" | "on"; // 켤 수 있음(결정 8)
    failureWave: StopMode; // 켤 수 있음(ATC-62). 켜는 것은 SUPERVISOR(ATC-23)
    congestion: StopMode; // on이면 GROUND DELAY(AIRBORNE 슬롯 −1)
    los: StopMode; // on이면 새 ASSIGN만 막는다
  };
  slots: StopMode; // on이면 TOWER가 in-slot PR에만 LAND(7단계)
  autoAssign: ShadowMode;
  s3: ShadowMode;
  slotLimits: Record<string, number | null>; // AIRPORT 코드 → 동시에 LAND를 받는 PR 수(null은 무제한). 없으면 기본 규칙
  manualStops: ManualStop[];
}

export const DEFAULT_ATFM: AtfmConfig = {
  groundStop: { mainBroken: "shadow", manual: "off", failureWave: "shadow", congestion: "shadow", los: "shadow" },
  slots: "shadow",
  autoAssign: "shadow",
  s3: "shadow",
  slotLimits: {},
  manualStops: [],
};

const FILE = () => join(config.stateDir, "atfm.json");

export class AtfmError extends Error {}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

// 파일을 읽어 기본값에 합친다. 모르는 값은 기본값으로(깨진 파일이 무엇도 켜지 않게).
export function parseAtfm(raw: unknown): AtfmConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const g = (r.groundStop && typeof r.groundStop === "object" ? r.groundStop : {}) as Record<string, unknown>;
  const d = DEFAULT_ATFM.groundStop;
  const limits: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(r.slotLimits && typeof r.slotLimits === "object" ? r.slotLimits : {})) {
    if (v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10)) limits[k.toUpperCase()] = v as number | null;
  }
  const stops = (Array.isArray(r.manualStops) ? r.manualStops : [])
    .filter((m: any) => m && typeof m.airport === "string" && typeof m.reason === "string" && typeof m.at === "string")
    .map((m: any) => ({ airport: m.airport.toUpperCase(), reason: m.reason, at: m.at }));
  return {
    groundStop: {
      mainBroken: pick(g.mainBroken, ["off", "shadow", "on"] as const, d.mainBroken),
      manual: pick(g.manual, ["off", "on"] as const, d.manual),
      failureWave: pick(g.failureWave, ["off", "shadow", "on"] as const, d.failureWave),
      congestion: pick(g.congestion, ["off", "shadow", "on"] as const, d.congestion),
      los: pick(g.los, ["off", "shadow", "on"] as const, d.los),
    },
    slots: pick(r.slots, ["off", "shadow", "on"] as const, DEFAULT_ATFM.slots),
    autoAssign: pick(r.autoAssign, ["off", "shadow"] as const, DEFAULT_ATFM.autoAssign),
    s3: pick(r.s3, ["off", "shadow"] as const, DEFAULT_ATFM.s3),
    slotLimits: limits,
    manualStops: stops,
  };
}

export function loadAtfm(file = FILE()): AtfmConfig {
  try {
    return parseAtfm(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseAtfm({});
  }
}

// 원자적으로 바꿔 쓴다(임시 파일 → rename)
export function saveAtfm(next: AtfmConfig, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
}

// 스위치 하나 바꾸기(순수). key는 "groundStop.mainBroken", "slots" 같은 경로. 켤 수 없는 값은 오류.
const SWITCHES: Record<string, readonly string[]> = {
  "groundStop.mainBroken": ["off", "shadow", "on"],
  "groundStop.manual": ["off", "on"],
  "groundStop.failureWave": ["off", "shadow", "on"],
  "groundStop.congestion": ["off", "shadow", "on"],
  "groundStop.los": ["off", "shadow", "on"],
  slots: ["off", "shadow", "on"],
  autoAssign: ["off", "shadow"],
  s3: ["off", "shadow"],
};
export function setSwitch(cfg: AtfmConfig, key: unknown, value: unknown): AtfmConfig {
  const allowed = SWITCHES[String(key)];
  if (!allowed) throw new AtfmError(`모르는 스위치: ${key} (가능: ${Object.keys(SWITCHES).join(", ")})`);
  if (!allowed.includes(String(value))) throw new AtfmError(`${key}는 ${allowed.join("|")}만 된다`);
  const next: AtfmConfig = structuredClone(cfg);
  const [head, tail] = String(key).split(".");
  if (tail) (next.groundStop as Record<string, string>)[tail] = String(value);
  else (next as unknown as Record<string, string>)[head] = String(value);
  return next;
}

// 모든 스위치를 그림자(켤 수 없는 것은 그대로, on은 shadow로, 수동은 off)로 — "ATFM OFF"
export function allShadow(cfg: AtfmConfig): AtfmConfig {
  const g = cfg.groundStop;
  const down = (m: StopMode): StopMode => (m === "on" ? "shadow" : m);
  return {
    ...cfg,
    groundStop: { ...g, mainBroken: down(g.mainBroken), failureWave: down(g.failureWave), congestion: down(g.congestion), los: down(g.los), manual: "off" },
    slots: down(cfg.slots),
  };
}

// ── 데이터: 기본 브랜치 head의 CI (sources/github.ts가 채운다) ──

export interface MainStatus {
  repo: string;
  slug: string;
  branch: string;
  sha: string | null;
  state: "success" | "failure" | "pending" | "none"; // none: 체크가 하나도 없음(CI 없는 저장소)
  failing: string[];
  checks: number;
  at: string;
  // ATC-330: 실패한 체크 런이 속한 워크플로 이름(AUTOLAND GROUND STOP의 applicationCheck가 체크 이름이든 워크플로 이름이든 걸리게).
  // names: 이 head에서 보이는 체크 런·commit status·워크플로 이름 전부. 워크플로를 못 읽었으면 둘 다 없다(모름 — 경고도 하지 않는다)
  workflowsFailing?: string[];
  names?: string[];
}

const FAIL = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "error"]);

// 체크 런 → 워크플로 이름(순수). suites: check suite id → 워크플로 이름(워크플로가 아닌 앱의 suite는 null). null이면 못 읽음.
// 실패한 체크 런의 suite가 가리키는 워크플로가 workflowsFailing, 보이는 이름 전부가 names
export function workflowNamesOf(
  runs: { name: string; conclusion: string | null; suite?: number | null }[],
  statuses: { context: string }[],
  suites: ReadonlyMap<number, string | null> | null,
): Pick<MainStatus, "workflowsFailing" | "names"> {
  if (!suites) return {};
  const failing = runs.filter((r) => FAIL.has(String(r.conclusion).toLowerCase()) && r.suite != null).map((r) => suites.get(r.suite!) ?? null);
  const workflows = runs.map((r) => (r.suite != null ? suites.get(r.suite) ?? null : null));
  const keep = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
  return { workflowsFailing: keep(failing), names: keep([...runs.map((r) => r.name), ...statuses.map((s) => s.context), ...workflows]) };
}

// check-runs(name·status·conclusion)와 commit status(context·state)로 head 상태를 정한다(순수).
// expectCheck: 이 저장소가 main에서 늘 돌리는 체크 이름(MCC AIRPORT의 ciCheck). 그 체크가 이 SHA에 아직 없으면 — 새 커밋이라 체크가 뜨기 전 —
// none·success가 아니라 pending이다(ATC-121). 실패한 체크가 이미 있으면 그대로 failure. 정하지 않은 저장소는 예전 그대로
export function mainStateOf(
  runs: { name: string; status: string; conclusion: string | null }[],
  statuses: { context: string; state: string }[],
  expectCheck: string | null = null,
): Pick<MainStatus, "state" | "failing" | "checks"> {
  const failing = [
    ...runs.filter((r) => FAIL.has(String(r.conclusion).toLowerCase())).map((r) => r.name),
    ...statuses.filter((s) => FAIL.has(s.state.toLowerCase())).map((s) => s.context),
  ];
  const checks = runs.length + statuses.length;
  if (failing.length) return { state: "failure", failing: [...new Set(failing)], checks };
  const waiting = Boolean(expectCheck) && !runs.some((r) => r.name === expectCheck) && !statuses.some((x) => x.context === expectCheck);
  if (waiting) return { state: "pending", failing: [], checks };
  if (!checks) return { state: "none", failing: [], checks };
  const pending = runs.some((r) => r.status.toLowerCase() !== "completed") || statuses.some((s) => s.state.toLowerCase() === "pending");
  return { state: pending ? "pending" : "success", failing: [], checks };
}

// PR 한 head의 CI 소요 시간(분): 체크가 모두 끝났을 때 가장 이른 시작 → 가장 늦은 끝. 아니면 null
export function ciMinutesOf(rollup: GhPull["statusCheckRollup"]): number | null {
  const runs = (rollup ?? []).filter((c) => c.__typename !== "StatusContext");
  if (!runs.length || runs.some((c) => c.status !== "COMPLETED" || !c.startedAt || !c.completedAt)) return null;
  const start = Math.min(...runs.map((c) => Date.parse(c.startedAt!)));
  const end = Math.max(...runs.map((c) => Date.parse(c.completedAt!)));
  return Math.round(((end - start) / MIN) * 10) / 10;
}

// ── 출발 중지(GROUND STOP) ──

export type StopTrigger = "main-broken" | "failure-wave" | "congestion" | "los" | "manual";

export interface GroundStop {
  airport: string;
  repo: string | null;
  trigger: StopTrigger;
  kind: "stop" | "delay"; // delay(GROUND DELAY)는 AIRBORNE 슬롯만 하나 줄인다
  land: boolean; // 켜졌을 때 LAND도 막는가(main 깨짐·실패 몰림·수동). LOS는 새 ASSIGN만, 혼잡은 슬롯만(ATC-62)
  enforced: boolean; // 켜진 스위치로 실제로 막는 중인가. false면 그림자
  text: string;
  evidence: string[];
  check?: string; // failure-wave: 실패가 몰린 체크 이름. key와 해제 판정에 쓴다
  since: string;
  clearSince?: string | null; // 트리거가 풀린 뒤 해제 규칙을 기다리는 중이면 풀린 시각(ATC-62)
  releasing?: string | null; // 해제까지 남은 것("기준 아래 12분 / 30분", "통과 PR 1/2")
}

export const WAVE = { prs: 3, windowMs: HOUR, releasePrs: 2 };
// 혼잡: 30분 넘게 도는 체크가 있는 PR이 4개 넘게, 또는 최근 2시간 체크 소요 시간 중앙값이 그 앞 7일 중앙값의 2배를 넘음(표본 3·10개 이상)
export const CONGESTION = { prs: 4, pendingMs: 30 * MIN, slowFactor: 2, recentMs: 2 * HOUR, baselineMs: 7 * DAY, recentN: 3, baselineN: 10 };
export const LOS_OPEN = 2;
export const LOS_DAY = 3; // 24시간 안 LOS 수
export const RELEASE_MS = 30 * MIN; // 혼잡·LOS는 기준 아래로 30분 이어져야 풀린다

export interface CiTrend {
  recentMin: number; // 최근 2시간 체크 소요 시간 중앙값(분)
  baselineMin: number; // 그 앞 7일 중앙값(분)
  recentN: number;
  baselineN: number;
}

export interface StopInput {
  airports: { code: string; repo: string }[];
  mains: Map<string, MainStatus>; // repo → 기본 브랜치 상태
  pulls: Map<string, GhPull[]>; // repo → 열린 PR(원본)
  losOpen: Map<string, number>; // repo → 열린 LOS 수
  ciTrend?: Map<string, CiTrend>; // repo → 체크 소요 시간 추세(두 번째 혼잡 트리거)
  losDay?: Map<string, number>; // repo → 24시간 안 LOS 수(두 번째 LOS 트리거)
  cfg: AtfmConfig;
  now: number;
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 체크 소요 시간 표본(FLIGHT RECORDER의 atfm ci 줄) → 최근 2시간과 그 앞 7일의 중앙값. 표본이 모자라면 null
export function ciTrendOf(samples: { t: string; minutes: number }[], now: number): CiTrend | null {
  const cut = now - CONGESTION.recentMs;
  const recent = samples.filter((x) => Date.parse(x.t) > cut && Date.parse(x.t) <= now).map((x) => x.minutes);
  const base = samples.filter((x) => Date.parse(x.t) <= cut && Date.parse(x.t) > cut - CONGESTION.baselineMs).map((x) => x.minutes);
  if (recent.length < CONGESTION.recentN || base.length < CONGESTION.baselineN) return null;
  return { recentMin: medianOf(recent), baselineMin: medianOf(base), recentN: recent.length, baselineN: base.length };
}

// 24시간 안 LOS(alert.raised conflict) 수를 저장소별로. STAND → 저장소는 지금 워크트리나 착수 기록으로 찾는다
export function losDayOf(events: { at: string; workspacePath?: string | null }[], repoOfStand: (stand: string) => string | null, now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (!e.workspacePath || now - Date.parse(e.at) > DAY || Date.parse(e.at) > now) continue;
    const repo = repoOfStand(e.workspacePath);
    if (repo) out.set(repo, (out.get(repo) ?? 0) + 1);
  }
  return out;
}

// 지금 걸린 출발 중지(순수). since는 부르는 쪽이 이어 붙인다(처음 본 시각). 해제 규칙은 holdStops
export function groundStopsOf(inp: StopInput): Omit<GroundStop, "since">[] {
  const out: Omit<GroundStop, "since">[] = [];
  const g = inp.cfg.groundStop;
  for (const a of inp.airports) {
    const main = inp.mains.get(a.repo);
    if (g.mainBroken !== "off" && main?.state === "failure") {
      out.push({
        airport: a.code, repo: a.repo, trigger: "main-broken", kind: "stop", land: true, enforced: g.mainBroken === "on",
        text: `main 깨짐: ${main.branch} ${main.sha?.slice(0, 7) ?? ""} 실패 체크 ${main.failing.join(", ")}`.trim(),
        evidence: main.failing,
      });
    }
    const pulls = inp.pulls.get(a.repo) ?? [];
    if (g.failureWave !== "off") {
      const failedBy = new Map<string, Set<number>>();
      for (const p of pulls) {
        for (const c of p.statusCheckRollup ?? []) {
          const name = c.name ?? c.context ?? "";
          const failed = FAIL.has(String(c.conclusion ?? c.state ?? "").toLowerCase());
          const when = c.completedAt ?? c.startedAt;
          if (!name || !failed || !when || inp.now - Date.parse(when) > WAVE.windowMs) continue;
          failedBy.set(name, (failedBy.get(name) ?? new Set()).add(p.number));
        }
      }
      for (const [name, prs] of failedBy) {
        if (prs.size < WAVE.prs) continue;
        out.push({
          airport: a.code, repo: a.repo, trigger: "failure-wave", kind: "stop", land: true, enforced: g.failureWave === "on",
          text: `CI 실패가 몰림: ${name} — 1시간 안에 PR ${prs.size}개`, evidence: [...prs].sort((x, y) => x - y).map((n) => `#${n}`), check: name,
        });
      }
    }
    if (g.congestion !== "off") {
      const stuck = pulls.filter((p) =>
        (p.statusCheckRollup ?? []).some((c) => c.status && c.status !== "COMPLETED" && c.startedAt && inp.now - Date.parse(c.startedAt) > CONGESTION.pendingMs),
      );
      const trend = inp.ciTrend?.get(a.repo);
      const slow = trend && trend.recentMin > CONGESTION.slowFactor * trend.baselineMin ? trend : null;
      const base = { airport: a.code, repo: a.repo, trigger: "congestion" as const, kind: "delay" as const, land: false, enforced: g.congestion === "on" };
      if (stuck.length > CONGESTION.prs) {
        out.push({ ...base, text: `CI 혼잡: 30분 넘게 끝나지 않은 체크가 있는 PR ${stuck.length}개`, evidence: stuck.map((p) => `#${p.number}`) });
      } else if (slow) {
        out.push({
          ...base,
          text: `CI 혼잡: 최근 2시간 체크 중앙값 ${Math.round(slow.recentMin)}분, 7일 기준 ${Math.round(slow.baselineMin)}분의 2배 넘음`,
          evidence: [`최근 ${slow.recentN}건`, `7일 ${slow.baselineN}건`],
        });
      }
    }
    const los = inp.losOpen.get(a.repo) ?? 0;
    const losDay = inp.losDay?.get(a.repo) ?? 0;
    if (g.los !== "off" && (los >= LOS_OPEN || losDay >= LOS_DAY)) {
      const text = los >= LOS_OPEN ? `LOS 증가: 열린 LOS ${los}건` : `LOS 증가: 24시간 안 LOS ${losDay}건`;
      out.push({ airport: a.code, repo: a.repo, trigger: "los", kind: "stop", land: false, enforced: g.los === "on", text, evidence: [] });
    }
  }
  if (g.manual === "on") {
    for (const m of inp.cfg.manualStops) {
      const a = inp.airports.find((x) => x.code === m.airport);
      out.push({ airport: m.airport, repo: a?.repo ?? null, trigger: "manual", kind: "stop", land: true, enforced: true, text: `수동 출발 중지: ${m.reason}`, evidence: [] });
    }
  }
  return out;
}

// 실패 몰림은 체크 이름으로 잇는다(PR 수가 바뀌어도 같은 출발 중지). 예전 key(문구)는 한 번 풀리고 새 key로 다시 잡힌다
export const stopKey = (s: Pick<GroundStop, "airport" | "trigger" | "text" | "check">) =>
  `${s.airport}|${s.trigger}|${s.trigger === "failure-wave" ? (s.check ?? s.text) : ""}`;

// 트리거마다 지금 스위치. main 깨짐·수동은 트리거가 풀리면 바로 해제라 붙들지 않는다(null)
const holdModeOf = (cfg: AtfmConfig, t: StopTrigger): StopMode | null =>
  t === "failure-wave" ? cfg.groundStop.failureWave : t === "congestion" ? cfg.groundStop.congestion : t === "los" ? cfg.groundStop.los : null;

// 그 체크가 t 뒤에 끝난 실행에서 통과한 PR 번호(지금 head 기준)
export function passedSince(pulls: GhPull[], check: string, t: number): number[] {
  const out: number[] = [];
  for (const p of pulls) {
    const ok = (p.statusCheckRollup ?? []).some((c) => {
      const name = c.name ?? c.context ?? "";
      const pass = String(c.conclusion ?? c.state ?? "").toLowerCase() === "success";
      const when = c.completedAt ?? c.startedAt;
      return name === check && pass && when && Date.parse(when) > t;
    });
    if (ok) out.push(p.number);
  }
  return out.sort((a, b) => a - b);
}

// 트리거가 풀린 출발 중지를 해제 규칙까지 붙든다(순수, ATC-62, docs/atfm.md 6장).
// - main 깨짐·수동: 트리거가 풀리면 바로 해제(지금과 같다)
// - 혼잡·LOS: 트리거가 30분 이어서 풀려 있어야 해제. 그 사이 다시 걸리면(깜빡임) 같은 출발 중지로 이어지고 30분을 다시 센다
// - 실패 몰림: 그 체크가 출발 중지가 시작된 뒤 끝난 실행에서 PR 2개가 통과해야 해제
// 스위치가 off면 붙들지 않는다. enforced는 지금 스위치로 다시 정한다
export function holdStops(prev: GroundStop[], found: Omit<GroundStop, "since">[], inp: { pulls: Map<string, GhPull[]>; cfg: AtfmConfig; now: number }): GroundStop[] {
  const at = new Date(inp.now).toISOString();
  const before = new Map(prev.map((p) => [stopKey(p), p]));
  const seen = new Set<string>();
  const out: GroundStop[] = [];
  for (const f of found) {
    const k = stopKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...f, since: before.get(k)?.since ?? at, clearSince: null, releasing: null });
  }
  for (const p of prev) {
    const k = stopKey(p);
    if (seen.has(k)) continue;
    const mode = holdModeOf(inp.cfg, p.trigger);
    if (mode === null || mode === "off") continue;
    const clearSince = p.clearSince ?? at;
    const base = { ...p, enforced: mode === "on", clearSince };
    if (p.trigger === "failure-wave") {
      const passed = passedSince(inp.pulls.get(p.repo ?? "") ?? [], p.check ?? "", Date.parse(p.since));
      if (passed.length >= WAVE.releasePrs) continue;
      out.push({ ...base, releasing: `${p.check} 통과 PR ${passed.length}/${WAVE.releasePrs}${passed.length ? ` (${passed.map((n) => `#${n}`).join(", ")})` : ""}` });
    } else {
      const below = inp.now - Date.parse(clearSince);
      if (below >= RELEASE_MS) continue;
      out.push({ ...base, releasing: `기준 아래 ${Math.floor(below / MIN)}분 / ${RELEASE_MS / MIN}분` });
    }
    seen.add(k);
  }
  return out;
}

// 재시작 뒤: atfm-state.json의 stops(key → since, FLIGHT RECORDER에 적은 출발 중지)로 붙들던 출발 중지를 되살린다.
// 트리거가 여전하면 groundStopsOf가 다시 찾고, 아니면 해제 규칙을 처음부터(풀린 시각 = 지금) 센다. main 깨짐·수동은 되살리지 않는다
export function reviveStops(recorded: Record<string, string>, airports: { code: string; repo: string }[]): GroundStop[] {
  const out: GroundStop[] = [];
  for (const [key, since] of Object.entries(recorded)) {
    const [airport, trigger, rest = ""] = key.split("|") as [string, StopTrigger, string?];
    if (trigger !== "failure-wave" && trigger !== "congestion" && trigger !== "los") continue;
    const repo = airports.find((a) => a.code === airport)?.repo ?? null;
    const check = trigger === "failure-wave" ? (/^CI 실패가 몰림: (.+) — /.exec(rest)?.[1] ?? rest) : undefined;
    out.push({
      airport, repo, trigger, since,
      kind: trigger === "congestion" ? "delay" : "stop",
      land: trigger === "failure-wave",
      enforced: false,
      text: trigger === "failure-wave" ? `CI 실패가 몰림: ${check}` : trigger === "congestion" ? "CI 혼잡" : "LOS 증가",
      evidence: [],
      ...(check !== undefined ? { check } : {}),
    });
  }
  return out;
}

// atfm-state.json의 stops만 읽는다(atfm-run.ts가 쓴다). 없거나 깨졌으면 빈 것
export function readRecordedStops(file = join(config.stateDir, "atfm-state.json")): Record<string, string> {
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return r?.stops && typeof r.stops === "object" ? r.stops : {};
  } catch {
    return {};
  }
}

// 두 번째 트리거의 입력(체크 소요 시간 추세, 24시간 LOS). atfm-run.ts가 1분마다 FLIGHT RECORDER로 채우고 스냅샷이 읽는다.
// 아직 채우지 않았으면 비어 있다(두 번째 트리거가 걸리지 않을 뿐)
let figures: { ciTrend: Map<string, CiTrend>; losDay: Map<string, number> } = { ciTrend: new Map(), losDay: new Map() };
export const stopFigures = () => figures;
export function setStopFigures(next: typeof figures) {
  figures = next;
}

// 실제로 막는(enforced) 출발 중지를 AIRPORT별로. scope "assign"은 새 ASSIGN을 막는 것(kind stop 모두),
// "land"는 LAND도 막는 것(main 깨짐·실패 몰림·수동). LOS는 ASSIGN만, 혼잡(delay)은 어느 쪽도 아니다
export function enforcedStops(stops: GroundStop[], scope: "assign" | "land" = "assign"): Map<string, GroundStop> {
  const out = new Map<string, GroundStop>();
  for (const s of stops) if (s.enforced && s.kind === "stop" && (scope === "assign" || s.land) && !out.has(s.airport)) out.set(s.airport, s);
  return out;
}

// 켜진 GROUND DELAY(혼잡)가 걸린 AIRPORT. DISPATCH가 그 AIRPORT의 AIRBORNE 슬롯을 하나 줄인다
export function delayedAirports(stops: GroundStop[] | undefined): Set<string> {
  return new Set((stops ?? []).filter((s) => s.enforced && s.kind === "delay").map((s) => s.airport));
}

export const groundStopWhy = (s: Pick<GroundStop, "text">) => `GROUND STOP — ${s.text}`;

// 계획에서 막힌 AIRPORT의 ASSIGN을 제외 목록으로 옮긴다(순수). 이유는 SUPERSEDED 사유로도 쓰인다.
export function applyGroundStops<P extends { assign: { flight: string; airport: string | null }[]; excluded: { flight: string; reason: string }[] }>(plan: P, stops: GroundStop[]): P {
  const stopped = enforcedStops(stops);
  if (!stopped.size) return plan;
  const keep = plan.assign.filter((a) => !(a.airport && stopped.has(a.airport)));
  const moved = plan.assign.filter((a) => a.airport && stopped.has(a.airport)).map((a) => ({ flight: a.flight, reason: groundStopWhy(stopped.get(a.airport!)!) }));
  return { ...plan, assign: keep, excluded: [...plan.excluded, ...moved] };
}

// ── 머지 슬롯 (그림자, 켜면 TOWER가 따른다 — 7단계) ──

export const LAND_TIMEOUT_MS = 30 * MIN; // 결정 7

export interface SlotView {
  slot: "in-slot" | "waiting-slot";
  lanePos: number; // 슬롯 순서로 센 저장소·base 안의 자리(1부터)
  limit: number | null; // null은 무제한
  urgent: boolean;
  landAt: string | null; // 이 PR에 나간 LAND CLEARANCE 시각
  landTimedOut: boolean; // LAND 뒤 30분이 지나도 머지되지 않음(슬롯을 비운다)
}

// 저장소별 동시 LAND 수. 설정이 있으면 그것, 없으면 기본 브랜치에 CI가 있으면 1, 없으면 무제한(결정 6)
export function slotLimitOf(airport: string | null, main: MainStatus | undefined, cfg: AtfmConfig): number | null {
  if (airport && airport in cfg.slotLimits) return cfg.slotLimits[airport];
  return main && main.checks > 0 ? 1 : null;
}

// CLEARED PR마다 슬롯(순수). 순서: 이미 LAND가 나간 PR(밀어내지 않는다) → Urgent → readyAt.
export function slotsOf(
  pulls: PullRequest[],
  opts: { limitOf: (repo: string) => number | null; priorityOf: (key: string | null) => number; landOf: (p: PullRequest) => string | null; now: number },
): Map<string, SlotView> {
  const out = new Map<string, SlotView>();
  const cleared = pulls.filter((p) => inSequence(p) && p.landing === "CLEARED");
  const lanes = new Map<string, PullRequest[]>();
  for (const p of cleared) lanes.set(`${p.repo}|${p.base}`, [...(lanes.get(`${p.repo}|${p.base}`) ?? []), p]);
  for (const lane of lanes.values()) {
    const limit = opts.limitOf(lane[0].repo);
    const info = lane.map((p) => {
      const landAt = opts.landOf(p);
      return { p, landAt, urgent: opts.priorityOf(p.ticketKey) === 1, timedOut: Boolean(landAt && opts.now - Date.parse(landAt) > LAND_TIMEOUT_MS) };
    });
    const rank = (x: (typeof info)[number]) => (x.landAt && !x.timedOut ? 0 : x.urgent ? 1 : 2);
    info.sort((a, b) => rank(a) - rank(b) || (a.landAt ?? "").localeCompare(b.landAt ?? "") || (a.p.readyAt ?? "").localeCompare(b.p.readyAt ?? ""));
    let used = 0;
    info.forEach((x, i) => {
      const inSlot = !x.timedOut && (limit === null || used < limit);
      if (inSlot) used++;
      out.set(pullKey(x.p), { slot: inSlot ? "in-slot" : "waiting-slot", lanePos: i + 1, limit, urgent: x.urgent, landAt: x.landAt, landTimedOut: x.timedOut });
    });
  }
  return out;
}

// 슬롯이 켜졌을 때(slots "on") LAND를 내지 않을 이유(순수). 그림자·꺼짐이거나 in-slot이면 null
export function slotHoldOf(slot: SlotView | null | undefined, mode: AtfmConfig["slots"]): { text: string } | null {
  if (mode !== "on" || !slot || slot.slot !== "waiting-slot") return null;
  if (slot.landTimedOut) return { text: `LAND 뒤 ${LAND_TIMEOUT_MS / MIN}분이 지나도 머지되지 않아 슬롯을 비움 — 다음 PR이 먼저` };
  return { text: `머지 슬롯 대기 — 저장소 안 ${slot.lanePos}번째, 동시 LAND ${slot.limit ?? "무제한"}` };
}

// ── 머지 슬롯 켜기 판단 숫자(5장 Turn-on): 같은 저장소에서 동시에 살아 있던 LAND, LAND → 머지 시간, 시간 초과 ──

// LAND 하나가 살아 있던 구간. 머지(LOGBOOK ARRIVED)로 끝나면 merged, 짝이 없으면 취소 시각이나 시간 제한까지
export interface LandSpan {
  airport: string;
  start: number;
  end: number;
  mergedMin: number | null; // LAND → 머지(분), 머지를 못 찾으면 null
  timedOut: boolean; // LAND 뒤 30분 안에 머지되지 않음
}

// LAND를 머지된 LOGBOOK 줄에 짝짓는다(순수): 같은 STAND(없으면 같은 FLIGHT), LAND 뒤 가장 이른 ARRIVED.
// AIRPORT는 짝의 airport, 짝이 없으면 airportOf(STAND·FLIGHT로 찾음). 둘 다 모르면 뺀다
export function landSpansOf(
  lands: Pick<Clearance, "type" | "at" | "stand" | "flight" | "cancelledAt">[],
  entries: { airport: string | null; arrivedAt: string; stands: string[]; flight: string | null }[],
  airportOf: (land: Pick<Clearance, "stand" | "flight">) => string | null,
  now: number,
): LandSpan[] {
  const out: LandSpan[] = [];
  for (const c of lands) {
    if (c.type !== "LAND") continue;
    const start = Date.parse(c.at);
    const match = entries
      .filter((e) => Date.parse(e.arrivedAt) >= start && ((c.stand && e.stands.includes(c.stand)) || (!c.stand && c.flight && e.flight === c.flight)))
      .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt))[0];
    const airport = match?.airport ?? airportOf(c);
    if (!airport) continue;
    if (match) {
      const end = Date.parse(match.arrivedAt);
      out.push({ airport, start, end, mergedMin: Math.round((end - start) / MIN), timedOut: end - start > LAND_TIMEOUT_MS });
    } else {
      const cancelled = c.cancelledAt ? Date.parse(c.cancelledAt) : null;
      const end = Math.min(now, cancelled ?? Infinity, start + LAND_TIMEOUT_MS);
      out.push({ airport, start, end, mergedMin: null, timedOut: cancelled === null && now - start > LAND_TIMEOUT_MS });
    }
  }
  return out;
}

export interface LandFigure {
  airport: string;
  lands: number; // 창 안에서 나간 LAND
  concurrent: number; // 같은 AIRPORT의 다른 LAND와 겹쳐 살아 있던 LAND 수
  mergedMedianMin: number | null; // LAND → 머지 중앙값
  timeouts: number; // 30분 안에 머지되지 않은 LAND
}

// AIRPORT별 LAND 숫자(순수). 창(from 이후 시작한 LAND)만 센다. 겹침은 같은 AIRPORT 안에서 구간이 겹치는 것
export function landFiguresOf(spans: LandSpan[], from: number): LandFigure[] {
  const byAirport = new Map<string, LandSpan[]>();
  for (const x of spans) if (x.start >= from) byAirport.set(x.airport, [...(byAirport.get(x.airport) ?? []), x]);
  return [...byAirport]
    .map(([airport, xs]) => ({
      airport,
      lands: xs.length,
      concurrent: xs.filter((a) => xs.some((b) => b !== a && a.start < b.end && b.start < a.end)).length,
      mergedMedianMin: median(xs.map((x) => x.mergedMin).filter((m): m is number => m !== null)),
      timeouts: xs.filter((x) => x.timedOut).length,
    }))
    .sort((a, b) => a.airport.localeCompare(b.airport));
}

// 이 PR을 연 뒤 같은 STAND(없으면 같은 FLIGHT)로 나간 마지막 LAND(controller.ts의 짝짓기와 같다)
export function landOf(p: PullRequest, clearances: Clearance[]): string | null {
  const land = clearances
    .filter((c) => c.type === "LAND" && !c.cancelledAt && c.at >= p.createdAt && ((p.standPath && c.stand === p.standPath) || (!c.stand && p.ticketKey && c.flight === p.ticketKey)))
    .at(-1);
  return land?.at ?? null;
}

// ── 자동 배정 대상 판정 (그림자, docs/atfm.md 3장 A1~A10) ──

export const AUTO_TYPES = new Set(["BUILD", "MAINT", "FERRY"]); // 결정 1: SURVEY 제외
export const AUTO_CAP = { assignPerDay: 3, s3PerDay: 5, inFlightPerAircraft: 1 }; // 결정 3

export interface Check {
  code: string;
  ok: boolean;
  text: string;
}
export interface Eligibility {
  id: string;
  flight: string | null;
  eligible: boolean;
  failed: Check[];
  checked: string[]; // 본 조건 코드(FLIGHT RECORDER에 남긴다)
}

export interface AutoContext {
  ticket: Ticket | undefined;
  aircraft: AircraftView | undefined;
  state: AircraftState | undefined;
  parentKeys: Set<string>;
  history: Proposal[]; // 같은 FLIGHT·AIRCRAFT의 지난 제안 판단용(모든 제안)
  stopped: Map<string, GroundStop>;
  now: number;
}

export function autoEligibility(p: Proposal, ctx: AutoContext): Eligibility {
  const t = ctx.ticket;
  const cls = classOf(t?.labels ?? []);
  const name = regKey(p.aircraftName); // 제안의 세션 이름 → REGISTRATION(ATC-67)
  const checks: Check[] = [];
  const add = (code: string, ok: boolean, text: string) => checks.push({ code, ok, text });
  add("A1", cls.explicit.type && cls.explicit.wake, "type:·wake: 라벨이 명시돼 있어야 함(기본값 BUILD·M 아님)");
  add("A2", cls.wake === "L" || cls.wake === "M", `WAKE L·M만 (지금 ${cls.wake})`);
  add("A3", AUTO_TYPES.has(cls.type), `FLIGHT TYPE BUILD·MAINT·FERRY만 (지금 ${cls.type})`);
  add("A4", !cls.ratings.includes("SEC"), "rating:SEC·Risk 라벨이 없어야 함");
  add("A5", Boolean(p.note) && !p.caution && p.holdAt === null, "OCC 메모가 있고 CAUTION·HOLD가 없어야 함");
  const tails = t ? tailsOf(t, ctx.now) : new Set<string>();
  const routeOk = tails.size ? tails.has(name) : Boolean(t?.project && ctx.aircraft?.routes.includes(t.project));
  add("A6", routeOk, tails.size ? `tail:${[...tails].join(",")}이 이 AIRCRAFT여야 함` : `프로젝트(${t?.project ?? "없음"})가 이 AIRCRAFT의 ROUTE에 있어야 함`);
  // A7(CROSSCHECK agree)은 CROSSCHECK 은퇴로 없앴다(ATC-371). 번호는 docs/atfm.md와 기록(옛 checked 목록)을 위해 비워 둔다
  const ratingsOk = cls.ratings.every((r) => ctx.aircraft?.ratings.includes(r));
  const mine = ctx.history.filter((x) => regKey(x.aircraftName) === name);
  const noReadback = mine.some((x) => x.status === "sent" && ctx.now - Date.parse(x.statusAt) > 10 * MIN);
  const declined = mine.some((x) => x.timeline.declined && ctx.now - Date.parse(x.timeline.declined) < 7 * DAY);
  // STAND 없이 DEPARTED한 FLIGHT(SURVEY·CHECK)를 날고 있는 AIRCRAFT는 세션이 쉬고 있어도 실제로는 바쁘다(ARRIVED 보고 전)
  const flyingLight = mine.some((x) => x.status === "departed" && x.departedVia === "readback");
  add(
    "A8",
    Boolean(ctx.state?.available) && !ctx.aircraft?.aog && ratingsOk && !noReadback && !declined && !flyingLight,
    "AIRCRAFT가 배정 가능하고 AOG 아님, rating을 모두 가짐, NO READBACK·7일 안 DECLINED 없음, ARRIVED 전 STAND 없는 FLIGHT 없음",
  );
  const before = ctx.history.filter((x) => x.flight === p.flight && x.id !== p.id);
  const rejectedBefore = before.some((x) => x.status === "disagreed" || x.status === "rejected" || x.status === "declined");
  add("A9", Boolean(t && t.priority > 0 && !ctx.parentKeys.has(t.key)) && !rejectedBefore, "우선순위가 있고 상위 이슈 아님, 전에 거절·DECLINED된 적 없음");
  const stop = p.airport ? ctx.stopped.get(p.airport) : undefined;
  add("A10", !stop, stop ? groundStopWhy(stop) : "출발 중지 없음");
  const failed = checks.filter((c) => !c.ok);
  return { id: p.id, flight: p.flight, eligible: !failed.length, failed, checked: checks.map((c) => c.code) };
}

// ── S3 자동 처리 대상 판정 (그림자, docs/atfm.md 4장 S1~S4. S5=S2 운용 중은 켜는 조건으로 따로 본다) ──

const cites = (reason: string, section: string) => new RegExp(`(^|[^\\d.])${section.replace(".", "\\.")}(?![\\d])`).test(reason);

export interface S3Context {
  standTickets: Set<string>; // STAND(워크트리)가 있는 FLIGHT
  inFlight: Set<string>; // DISPATCH 제안이 READBACK 뒤 아직 끝나지 않은 FLIGHT(STAND 없는 FLIGHT 포함)
  cautions: Set<string>; // OCC가 CAUTION을 단 제안이 있는 FLIGHT
}

// SEC 관련은 절대 자동으로 처리하지 않는다: 티켓을 모르면(라벨을 확인할 수 없으면) S2도 떨어진다
export function s3Eligibility(op: ScheduleOp, ticket: Ticket | undefined, ctx: S3Context): Eligibility {
  const checks: Check[] = [];
  const add = (code: string, ok: boolean, text: string) => checks.push({ code, ok, text });
  const p = op.payload as { type?: string; wake?: string; ratings?: string[] };
  const cls = classOf(ticket?.labels ?? []);
  add("S1", op.kind === "CLASSIFY" && !(p.type && cls.explicit.type) && !(p.wake && cls.explicit.wake), "CLASSIFY이고 빈 축에 라벨을 더하기만(있는 라벨을 바꾸지 않음)");
  add(
    "S2",
    Boolean(ticket) && !(p.ratings ?? []).includes("SEC") && !cls.ratings.includes("SEC") && !(op.flight && ctx.cautions.has(op.flight)),
    "rating:SEC를 더하지 않고, FLIGHT에 rating:SEC·Risk 라벨(Risk:Security 등)과 OCC CAUTION이 없어야 함",
  );
  const cited = (!p.type || cites(op.reason, "4.1")) && (!p.wake || cites(op.reason, "4.2")) && (!(p.ratings ?? []).length || cites(op.reason, "4.3"));
  add("S3", cited, "근거에 정한 축마다 fleet.md 절(4.1·4.2·4.3) 인용(CROSSCHECK agree는 은퇴로 보지 않는다, ATC-371)");
  add(
    "S4",
    Boolean(ticket && (ticket.stateType === "unstarted" || ticket.stateType === "backlog") && !ctx.standTickets.has(ticket.key) && !ctx.inFlight.has(ticket.key)),
    "Todo·Backlog이고 어느 팀도 날고 있지 않아야 함(STAND 없음, READBACK 뒤 끝나지 않은 제안 없음)",
  );
  const failed = checks.filter((c) => !c.ok);
  return { id: op.id, flight: op.flight, eligible: !failed.length, failed, checked: checks.map((c) => c.code) };
}

// ── 그림자 정확도 ──

export interface Precision {
  eligible: number; // 대상으로 판정된 적 있는 건
  decided: number; // 그중 사람이 판정한 건
  approved: number;
  rate: number | null;
  bad: number; // 막아야 했던 사유(이미 완료, 상위 이슈, 선행 대기, 사람 결정)로 거절된 건
}
export const BAD_REASONS = new Set(["already-done", "parent-issue", "waiting-on-prior", "needs-human"]);

export function precisionOf(ids: Set<string>, items: { id: string; human: { verdict: "agree" | "disagree" } | null; reasonCodes?: string[] }[]): Precision {
  const seen = items.filter((x) => ids.has(x.id));
  const decided = seen.filter((x) => x.human);
  const approved = decided.filter((x) => x.human!.verdict === "agree").length;
  const bad = decided.filter((x) => x.human!.verdict === "disagree" && (x.reasonCodes ?? []).some((c) => BAD_REASONS.has(c))).length;
  return { eligible: ids.size, decided: decided.length, approved, rate: decided.length ? approved / decided.length : null, bad };
}

export const THRESHOLDS = { precision: 0.95, precisionN: 20, crosscheck: 0.9, crosscheckN: 20, trip: 0.85 }; // 결정 2

// ── 되돌린 라벨: S2로 APPLIED된 CLASSIFY가 7일 안에 Linear에서 사라짐 ──

export function undoneOf(ops: ScheduleOp[], tickets: Ticket[], changesOf: (op: ScheduleOp, t: Ticket) => string[], now: number): string[] {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  return ops
    .filter((o) => o.kind === "CLASSIFY" && o.status === "applied" && o.flight && now - Date.parse(o.statusAt) < 7 * DAY)
    .filter((o) => {
      const t = byKey.get(o.flight!);
      return t && changesOf(o, t).length > 0;
    })
    .map((o) => o.id);
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export type { Snapshot };
