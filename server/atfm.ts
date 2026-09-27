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
import type { ScheduleOp } from "./schedule.ts";

// ATFM(3단계 흐름 관리). 설계: docs/atfm.md. 이 파일은 8장의 1~5단계다:
// 데이터(기본 브랜치 CI, 체크 소요 시간, BEHIND 전이, 되돌린 라벨), 출발 중지(GROUND STOP) 계산,
// 머지 슬롯·자동 배정 대상·S3 대상의 그림자 판정. 켜서 실제로 막는 것은 "main 깨짐"과 "수동" 출발 중지뿐이고
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
    failureWave: ShadowMode; // 나머지는 그림자까지만
    congestion: ShadowMode;
    los: ShadowMode;
  };
  slots: ShadowMode;
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
      failureWave: pick(g.failureWave, ["off", "shadow"] as const, d.failureWave),
      congestion: pick(g.congestion, ["off", "shadow"] as const, d.congestion),
      los: pick(g.los, ["off", "shadow"] as const, d.los),
    },
    slots: pick(r.slots, ["off", "shadow"] as const, DEFAULT_ATFM.slots),
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
  "groundStop.failureWave": ["off", "shadow"],
  "groundStop.congestion": ["off", "shadow"],
  "groundStop.los": ["off", "shadow"],
  slots: ["off", "shadow"],
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
  return { ...cfg, groundStop: { ...g, mainBroken: g.mainBroken === "on" ? "shadow" : g.mainBroken, manual: "off" } };
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
}

const FAIL = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "error"]);

// check-runs(name·status·conclusion)와 commit status(context·state)로 head 상태를 정한다(순수)
export function mainStateOf(
  runs: { name: string; status: string; conclusion: string | null }[],
  statuses: { context: string; state: string }[],
): Pick<MainStatus, "state" | "failing" | "checks"> {
  const failing = [
    ...runs.filter((r) => FAIL.has(String(r.conclusion).toLowerCase())).map((r) => r.name),
    ...statuses.filter((s) => FAIL.has(s.state.toLowerCase())).map((s) => s.context),
  ];
  const checks = runs.length + statuses.length;
  if (!checks) return { state: "none", failing: [], checks };
  if (failing.length) return { state: "failure", failing: [...new Set(failing)], checks };
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
  enforced: boolean; // 켜진 스위치로 실제로 막는 중인가. false면 그림자
  text: string;
  evidence: string[];
  since: string;
}

export const WAVE = { prs: 3, windowMs: HOUR };
export const CONGESTION = { prs: 4, pendingMs: 30 * MIN };
export const LOS_OPEN = 2;

export interface StopInput {
  airports: { code: string; repo: string }[];
  mains: Map<string, MainStatus>; // repo → 기본 브랜치 상태
  pulls: Map<string, GhPull[]>; // repo → 열린 PR(원본)
  losOpen: Map<string, number>; // repo → 열린 LOS 수
  cfg: AtfmConfig;
  now: number;
}

// 지금 걸린 출발 중지(순수). since는 부르는 쪽이 이어 붙인다(처음 본 시각).
export function groundStopsOf(inp: StopInput): Omit<GroundStop, "since">[] {
  const out: Omit<GroundStop, "since">[] = [];
  const g = inp.cfg.groundStop;
  for (const a of inp.airports) {
    const main = inp.mains.get(a.repo);
    if (g.mainBroken !== "off" && main?.state === "failure") {
      out.push({
        airport: a.code, repo: a.repo, trigger: "main-broken", kind: "stop", enforced: g.mainBroken === "on",
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
          airport: a.code, repo: a.repo, trigger: "failure-wave", kind: "stop", enforced: false,
          text: `CI 실패가 몰림: ${name} — 1시간 안에 PR ${prs.size}개`, evidence: [...prs].sort((x, y) => x - y).map((n) => `#${n}`),
        });
      }
    }
    if (g.congestion !== "off") {
      const stuck = pulls.filter((p) =>
        (p.statusCheckRollup ?? []).some((c) => c.status && c.status !== "COMPLETED" && c.startedAt && inp.now - Date.parse(c.startedAt) > CONGESTION.pendingMs),
      );
      if (stuck.length > CONGESTION.prs) {
        out.push({
          airport: a.code, repo: a.repo, trigger: "congestion", kind: "delay", enforced: false,
          text: `CI 혼잡: 30분 넘게 끝나지 않은 체크가 있는 PR ${stuck.length}개`, evidence: stuck.map((p) => `#${p.number}`),
        });
      }
    }
    const los = inp.losOpen.get(a.repo) ?? 0;
    if (g.los !== "off" && los >= LOS_OPEN) {
      out.push({ airport: a.code, repo: a.repo, trigger: "los", kind: "stop", enforced: false, text: `LOS 증가: 열린 LOS ${los}건`, evidence: [] });
    }
  }
  if (g.manual === "on") {
    for (const m of inp.cfg.manualStops) {
      const a = inp.airports.find((x) => x.code === m.airport);
      out.push({ airport: m.airport, repo: a?.repo ?? null, trigger: "manual", kind: "stop", enforced: true, text: `수동 출발 중지: ${m.reason}`, evidence: [] });
    }
  }
  return out;
}

export const stopKey = (s: Pick<GroundStop, "airport" | "trigger" | "text">) => `${s.airport}|${s.trigger}|${s.trigger === "failure-wave" ? s.text : ""}`;

// 실제로 막는(enforced) 출발 중지를 AIRPORT별로
export function enforcedStops(stops: GroundStop[]): Map<string, GroundStop> {
  const out = new Map<string, GroundStop>();
  for (const s of stops) if (s.enforced && s.kind === "stop" && !out.has(s.airport)) out.set(s.airport, s);
  return out;
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

// ── 머지 슬롯 (그림자) ──

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

// 이 PR을 연 뒤 같은 STAND(없으면 같은 FLIGHT)로 나간 마지막 LAND(controller.ts의 짝짓기와 같다)
export function landOf(p: PullRequest, clearances: Clearance[]): string | null {
  const land = clearances
    .filter((c) => c.type === "LAND" && !c.cancelledAt && c.at >= p.createdAt && ((p.standPath && c.stand === p.standPath) || (!c.stand && p.ticketKey && c.flight === p.ticketKey)))
    .at(-1);
  return land?.at ?? null;
}

// ── 자동 배정 대상 판정 (그림자, docs/atfm.md 3장 A1~A10) ──

// CROSSCHECK로 쓸 수 있는 모델(controller/guard.mjs의 CROSSCHECK_MODELS와 같다)
export const CROSSCHECK_MODELS = /muse-spark|gpt-5\.6-terra/i;
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
  const name = (p.aircraftName ?? "").toUpperCase();
  const checks: Check[] = [];
  const add = (code: string, ok: boolean, text: string) => checks.push({ code, ok, text });
  add("A1", cls.explicit.type && cls.explicit.wake, "type:·wake: 라벨이 명시돼 있어야 함(기본값 BUILD·M 아님)");
  add("A2", cls.wake === "L" || cls.wake === "M", `WAKE L·M만 (지금 ${cls.wake})`);
  add("A3", AUTO_TYPES.has(cls.type), `FLIGHT TYPE BUILD·MAINT·FERRY만 (지금 ${cls.type})`);
  add("A4", !cls.ratings.includes("SEC"), "rating:SEC·Risk 라벨이 없어야 함");
  add("A5", Boolean(p.note) && !p.caution && p.holdAt === null, "OCC 메모가 있고 CAUTION·HOLD가 없어야 함");
  const tails = t ? tailsOf(t) : new Set<string>();
  const routeOk = tails.size ? tails.has(name) : Boolean(t?.project && ctx.aircraft?.routes.includes(t.project));
  add("A6", routeOk, tails.size ? `tail:${[...tails].join(",")}이 이 AIRCRAFT여야 함` : `프로젝트(${t?.project ?? "없음"})가 이 AIRCRAFT의 ROUTE에 있어야 함`);
  const mark = p.crosscheck;
  add("A7", Boolean(mark && mark.verdict === "agree" && CROSSCHECK_MODELS.test(mark.model)), "허용 모델의 CROSSCHECK agree가 있어야 함");
  const ratingsOk = cls.ratings.every((r) => ctx.aircraft?.ratings.includes(r));
  const mine = ctx.history.filter((x) => (x.aircraftName ?? "").toUpperCase() === name);
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
  return { id: p.id, flight: p.flight, eligible: !failed.length, failed };
}

// ── S3 자동 처리 대상 판정 (그림자, docs/atfm.md 4장 S1~S4. S5=S2 운용 중은 켜는 조건으로 따로 본다) ──

const cites = (reason: string, section: string) => new RegExp(`(^|[^\\d.])${section.replace(".", "\\.")}(?![\\d])`).test(reason);

export function s3Eligibility(op: ScheduleOp, ticket: Ticket | undefined, standTickets: Set<string>): Eligibility {
  const checks: Check[] = [];
  const add = (code: string, ok: boolean, text: string) => checks.push({ code, ok, text });
  const p = op.payload as { type?: string; wake?: string; ratings?: string[] };
  const cls = classOf(ticket?.labels ?? []);
  add("S1", op.kind === "CLASSIFY" && !(p.type && cls.explicit.type) && !(p.wake && cls.explicit.wake), "CLASSIFY이고 빈 축에 라벨을 더하기만(있는 라벨을 바꾸지 않음)");
  add("S2", !(p.ratings ?? []).includes("SEC") && !cls.ratings.includes("SEC"), "rating:SEC를 더하지 않고 FLIGHT에도 SEC·Risk가 없어야 함");
  const mark = op.crosscheck;
  const cited = (!p.type || cites(op.reason, "4.1")) && (!p.wake || cites(op.reason, "4.2")) && (!(p.ratings ?? []).length || cites(op.reason, "4.3"));
  add("S3", Boolean(mark && mark.verdict === "agree" && CROSSCHECK_MODELS.test(mark.model)) && cited, "허용 모델의 CROSSCHECK agree, 근거에 정한 축마다 fleet.md 절(4.1·4.2·4.3) 인용");
  add("S4", Boolean(ticket && (ticket.stateType === "unstarted" || ticket.stateType === "backlog") && !standTickets.has(ticket.key)), "Todo·Backlog이고 STAND가 없어야 함");
  const failed = checks.filter((c) => !c.ok);
  return { id: op.id, flight: op.flight, eligible: !failed.length, failed };
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
