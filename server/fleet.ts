import type { Restarting } from "./restarting.ts";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { noteCrewChange, withCrew } from "./crew-change.ts";
import { OBSERVED_WINDOW_DAYS } from "./crew-observed.ts";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig } from "./dispatch.ts";
import { type Actuals, computeActuals, loadPricedLogbook } from "./logbook.ts";
import { type FleetFuel, fleetFuelOf, type PricedEntry, type TripFuel, tripCheckOf, type TripVerdict } from "./fuel-view.ts";
import { loadReportThreshold, type ReportView } from "./judges/store.ts";
import { needsDecision } from "./judges/report.ts";
import type { AccountHold, Health } from "./health.ts";
import type { FuelRemaining } from "./fuel-remaining.ts";
import { type ContextSize, type ContextView, contextView } from "./fuel-context.ts";
import type { Snapshot } from "./model.ts";
import { compareRegistration, fleetKeyOf, registrationOf, regKey } from "./registration.ts";
import { loadRulesRecords, rulesOfAircraft, type RulesView } from "./rules-state.ts";
import type { SessionOrigin } from "./session-origin.ts";
import type { Job } from "./job-state.ts";
import type { Activity } from "./activity.ts";
import { flightDetailOf, liveViewOf } from "./fleet-live.ts";
import { readRecords } from "./recorder.ts";

export { flightDetailOf };

// FLEET 등록부(~/.local/state/atc/fleet.json). 팀(AIRCRAFT)마다 CREW COMPLEMENT, TYPE RATING, ROUTE, TARGETS를 적는다.
// 설계: docs/fleet.md. 타입·기본값·판정은 crew.ts에 있고, planner도 그것을 쓴다.

import {
  ACCOUNT_RE,
  accountOf,
  CONTROL_NAMES,
  isControlName,
  type AircraftProfile,
  CONFIGURATIONS,
  type ConfigurationId,
  canHoldSec,
  type CrewMember,
  DEFAULT_FLEET,
  type FleetFile,
  RATINGS,
  type Rating,
  type Targets,
} from "./crew.ts";

export { canHoldSec, DEFAULT_FLEET, RATINGS };
export type { AircraftProfile, CrewMember, FleetFile, Rating, Targets };

export class FleetError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const fleetFile = () => join(config.stateDir, "fleet.json");

// 파일에 적힌 그대로(기본값을 채우지 않은 것). 저장할 때는 이것을 고쳐 쓴다 — 그래야 파일에 없는
// defaults는 코드의 기본값을 계속 따라간다.
function readRaw(file: string): Partial<FleetFile> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function loadFleet(file = fleetFile()): FleetFile {
  const raw = readRaw(file);
  return {
    defaults: { ...structuredClone(DEFAULT_FLEET.defaults), ...(raw.defaults ?? {}) },
    aircraft: raw.aircraft && typeof raw.aircraft === "object" ? raw.aircraft : {},
    ...(raw.control && typeof raw.control === "object" ? { control: raw.control } : {}), // 관제 세션 ACCOUNT(ATC-60). 옛 파일엔 없다
    ...(raw.accounts && typeof raw.accounts === "object" ? { accounts: raw.accounts } : {}), // ACCOUNT 등록부(ATC-146). 읽는 쪽은 accounts.ts loadAccounts가 검사한다
  };
}

// ACCOUNT 등록부를 바꿔 쓴다(ATC-146). 검사는 부르는 쪽(validateAccounts). 다른 항목은 그대로, 비면 항목을 지운다
export function saveAccounts(accounts: NonNullable<FleetFile["accounts"]>, file = fleetFile()) {
  const raw = readRaw(file);
  const next: Partial<FleetFile> = { ...raw, accounts };
  if (!Object.keys(accounts).length) delete next.accounts;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
}

// 관제 세션의 ACCOUNT 라벨을 바꿔 쓴다(ATC-60). 다른 항목은 그대로. null이나 ""이면 지운다
export function saveControlAccount(name: string, account: unknown, file = fleetFile()): string | null {
  const key = name.toUpperCase();
  if (!isControlName(key)) throw new FleetError(`관제 세션이 아님: ${name} (${CONTROL_NAMES.join(", ")})`, 404);
  const v = typeof account === "string" ? account.trim().toLowerCase() : account;
  if (v !== null && v !== "" && (typeof v !== "string" || !ACCOUNT_RE.test(v)))
    throw new FleetError("account는 SUPERVISOR가 정한 라벨(소문자·숫자·-, 24자까지. 예: main, pro-2) — email은 쓰지 않는다");
  const raw = readRaw(file);
  const control = { ...((raw.control as FleetFile["control"]) ?? {}) };
  if (v) control[key] = { ...(control[key] ?? {}), account: v as string };
  else delete control[key];
  const next: Partial<FleetFile> = { ...raw, control };
  if (!Object.keys(control).length) delete next.control;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
  return (v as string) || null;
}

export function saveAircraft(key: string, profile: AircraftProfile | null, file = fleetFile()) {
  const raw = readRaw(file);
  const aircraft = { ...(raw.aircraft ?? {}) };
  if (profile && Object.keys(profile).length) aircraft[key] = profile;
  else delete aircraft[key];
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...raw, aircraft }, null, 2) + "\n");
  renameSync(tmp, file);
}


// PATCH 본문을 검사해 프로필로 만든다. 값이 null이면 그 항목을 지워 기본값으로 돌린다.
export function applyPatch(
  current: AircraftProfile,
  patch: Record<string, unknown>,
  defaults: FleetFile["defaults"],
  now = new Date().toISOString(),
): AircraftProfile {
  const next: AircraftProfile = { ...current };
  const drop = (k: keyof AircraftProfile) => delete next[k];

  if ("ratings" in patch) {
    if (patch.ratings === null) drop("ratings");
    else {
      if (!Array.isArray(patch.ratings)) throw new FleetError("ratings는 배열");
      const bad = patch.ratings.find((r) => !RATINGS.includes(r as Rating));
      if (bad !== undefined) throw new FleetError(`모르는 TYPE RATING: ${bad} (가능: ${RATINGS.join(", ")})`);
      next.ratings = [...new Set(patch.ratings as Rating[])].sort((a, b) => RATINGS.indexOf(a) - RATINGS.indexOf(b));
    }
  }
  if ("complement" in patch) {
    if (patch.complement === null) drop("complement");
    else {
      if (!Array.isArray(patch.complement) || !patch.complement.length) throw new FleetError("complement는 한 명 이상의 배열");
      next.complement = patch.complement.map((m, i) => {
        const x = m as Partial<CrewMember>;
        if (typeof x?.position !== "string" || !x.position.trim() || typeof x.agent !== "string" || !x.agent.trim()) {
          throw new FleetError(`complement[${i}]에 position과 agent가 필요함`);
        }
        const limits = Array.isArray(x.limits) ? x.limits.map(String).filter(Boolean) : [];
        return { position: x.position.trim(), agent: x.agent.trim(), ...(limits.length ? { limits } : {}) };
      });
    }
  }
  if ("routes" in patch) {
    if (patch.routes === null) drop("routes");
    else {
      if (!Array.isArray(patch.routes)) throw new FleetError("routes는 배열");
      next.routes = [...new Set(patch.routes.map(String).map((r) => r.trim()).filter(Boolean))];
    }
  }
  if ("targets" in patch) {
    if (patch.targets === null) drop("targets");
    else {
      const t = patch.targets as Record<string, unknown>;
      const out: Targets = {};
      if (t.flightsPerWeek != null) {
        const n = Number(t.flightsPerWeek);
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new FleetError("flightsPerWeek는 0~100");
        out.flightsPerWeek = n;
      }
      if (t.onTime != null) {
        const n = Number(t.onTime);
        if (!Number.isFinite(n) || n < 0 || n > 1) throw new FleetError("onTime은 0~1");
        out.onTime = n;
      }
      // FUEL F8(ATC-56): FLIGHT당 NET FUEL COST 상한(USD)과 CACHE HIT 하한. 보여 주기만 한다
      if (t.fuelPerFlight != null) {
        const n = Number(t.fuelPerFlight);
        if (!Number.isFinite(n) || n <= 0 || n > 10_000) throw new FleetError("fuelPerFlight는 0보다 크고 10000 이하(USD)");
        out.fuelPerFlight = n;
      }
      if (t.cacheHit != null) {
        const n = Number(t.cacheHit);
        if (!Number.isFinite(n) || n < 0 || n > 1) throw new FleetError("cacheHit은 0~1");
        out.cacheHit = n;
      }
      if (Object.keys(out).length) next.targets = out;
      else drop("targets");
    }
  }
  if ("base" in patch) {
    if (patch.base === null || patch.base === "") drop("base");
    else if (typeof patch.base !== "string" || !/^[A-Z]{4}$/.test(patch.base)) throw new FleetError("base는 AIRPORT 코드(대문자 4자)");
    else next.base = patch.base;
  }
  if ("note" in patch) {
    if (patch.note === null || patch.note === "") drop("note");
    else next.note = String(patch.note).slice(0, 500);
  }
  // ACCOUNT(ATC-51): SUPERVISOR가 정한 라벨. 소문자·숫자·-만(email 같은 계정 정보는 받지 않는다)
  if ("account" in patch) {
    const v = typeof patch.account === "string" ? patch.account.trim().toLowerCase() : patch.account;
    if (v === null || v === "") drop("account");
    else if (typeof v !== "string" || !ACCOUNT_RE.test(v)) throw new FleetError("account는 SUPERVISOR가 정한 라벨(소문자·숫자·-, 24자까지. 예: main, pro-2) — email은 쓰지 않는다");
    else next.account = v;
  }
  // AOG: 잠시 운항 중지. 사유가 있어야 하고, 해제 예정일(YYYY-MM-DD)은 선택
  if ("aog" in patch) {
    if (patch.aog === null || patch.aog === false) drop("aog");
    else {
      const a = patch.aog as { reason?: unknown; until?: unknown };
      const reason = typeof a?.reason === "string" ? a.reason.trim() : "";
      if (!reason) throw new FleetError("AOG에는 사유가 필요함");
      const until = typeof a.until === "string" && a.until.trim() ? a.until.trim() : null;
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new FleetError("AOG 해제 예정일은 YYYY-MM-DD");
      next.aog = { reason: reason.slice(0, 200), until, at: now };
    }
  }
  // RETIREMENT: 퇴역. false면 복귀
  if ("retired" in patch) {
    if (patch.retired === null || patch.retired === false) drop("retired");
    else {
      const r = patch.retired as { reason?: unknown } | true;
      const reason = r !== true && typeof r?.reason === "string" && r.reason.trim() ? r.reason.trim().slice(0, 200) : null;
      next.retired = { at: now, reason };
    }
  }

  const complement = next.complement ?? defaults.complement;
  const ratings = next.ratings ?? defaults.ratings;
  if (ratings.includes("SEC") && !canHoldSec(complement)) {
    throw new FleetError("SEC는 보안 작업을 맡을 수 있는 팀원이 있어야 준다 — flash-helper만으로는 안 됨");
  }
  return next;
}

// FLEET 줄·카드가 FLIGHT 옆에 두는 것(ATC-86): 그 FLIGHT 워크트리의 마지막 커밋, origin에 있나, PR(없으면 null)
export interface FlightDetail {
  commit: { sha: string; at: string | null } | null;
  pushed: boolean | null; // 모르면 null(브랜치·origin 없음)
  pr: { number: number; url: string; draft: boolean } | null;
}
export interface AircraftFlight {
  key: string;
  title: string | null;
  kept?: true; // 점유(claimTtl)가 지나 STAND는 안 쥐었지만 멈춘 AIRCRAFT의 FLIGHT로 남겨 둔 것(cut LIMIT·RESUME·STALLED)
  detail?: FlightDetail;
}

export interface AircraftView {
  registration: string;
  callsign: string;
  status: "busy" | "idle" | "dead" | "absent";
  base: string | null;
  complement: CrewMember[];
  complementIsDefault: boolean;
  ratings: Rating[];
  ratingsIsDefault: boolean;
  routes: string[];
  targets: Targets;
  note: string | null;
  flying: string[]; // 지금 STAND를 쥔 FLIGHT
  flights: AircraftFlight[]; // flying 다음에 keptFlights. Linear 제목(모르면 null). FLEET 운항 상태 목록(ATC-44)
  restarting?: Restarting | null; // /clear 뒤 첫 메시지를 기다린다(ATC-91). 세션은 없다(status absent)
  flyingSince: string | null; // 지금 쥔 STAND를 처음 잡은 시각(점유 since 중 가장 이른 것). 없으면 null
  lastActiveAt: string | null; // 세션의 마지막 활동 시각
  health?: Health | null; // AIRCRAFT health(ATC-45). 세션이 없거나 문제가 없으면 null
  job?: Job | null; // 백그라운드 job 상태(ATC-99). NEEDS YOU는 state가 blocked일 때. bg 세션이 아니면 null
  activity?: Activity | null; // ACTIVITY(ATC-97): 마지막 도구·라벨·phase. 살아 있는 Claude 세션만
  account?: string | null; // ACCOUNT(ATC-51). 라벨이 없으면 기본 ACCOUNT, 등록부에 라벨이 하나도 없으면 null
  accountIsDefault?: boolean; // 라벨 없이 기본 ACCOUNT로 센다
  observedAccount?: string | null; // 세션이 home ACCOUNT와 다른 폴더에서 돌 때만(ATC-146): "acct-1 (home acct-2)". 오류가 아니다
  report?: (ReportView & { decision: boolean }) | null; // 마지막 턴의 REPORT 판정(ATC-89, 그림자 전용). decision: "결정이 필요함" 확률이 문턱 이상
  accountHold?: AccountHold | null; // 같은 ACCOUNT의 다른 AIRCRAFT가 LIMIT에 걸려 붙들림(ATC-51)
  fuel?: FuelRemaining | null; // 그 ACCOUNT의 FUEL REMAINING(ATC-55). statusline 값이 없으면 null
  configuration: ConfigurationId | null;
  enteredAt: string | null;
  aog: AircraftProfile["aog"] | null;
  retired: AircraftProfile["retired"] | null;
  actuals: Actuals; // LOGBOOK에서 센 TARGETS 실적(보여 주기만 함, docs/fleet.md 7.2)
  // FUEL F8(ATC-56): 최근 14일 ARRIVED FLIGHT의 FUEL COST·CACHE HIT·CREW 몫·LEAK. 보여 주기만 한다. 값이 없으면 null(0이 아님)
  fuelBurn?: FleetFuel;
  // 최근 FLIGHT(actuals.recent와 같은 순서)의 FUEL BURN·NET·LEAK과 TRIP FUEL 안이었나
  fuelRecent?: FuelRecent[];
  context?: ContextView | null; // CONTEXT SIZE(ATC-69). GET /api/fleet만 붙인다
  // 세션 이름(ATC-67): 살아 있는 세션 이름이 정식 REGISTRATION이 아니면 그 이름(바꾸라는 힌트), 아니면 null
  sessionName?: string | null;
  // 같은 REGISTRATION으로 읽히는 살아 있는 세션이 둘 이상이면 그 이름들(합치지 않고 충돌로 보인다, idea #96). 아니면 null
  sessionConflict?: string[] | null;
  // 세션 출처(ATC-76): background(atc가 띄움)·desktop(Claude 앱)·terminal·unknown. 세션이 없으면 null
  origin?: SessionOrigin | null;
  permissionMode?: string | null; // 세션의 permission mode. 모르면 null
  // 살아 있는 세션이 백그라운드일 때(ATC-98): 세션 파일의 jobId(모르면 null). `claude attach <jobId>`. 아니거나 세션이 없으면 null
  background?: { jobId: string | null } | null;
}

export interface FuelRecent {
  key: string;
  tokens: number | null; // FUEL BURN(CAPTAIN + CREW 토큰). fuel 없는 옛 줄은 null
  cost: number | null; // FUEL COST. 값이 없으면 null
  net: number | null;
  leakCost: number | null;
  leakTokens: number | null; // 다시 쓴 토큰(LEAK). fuel 없는 줄은 null
  unpriced: string[];
  trip: { p50: number | null; p90: number | null; level: TripFuel["level"]; group: string | null; samples: number };
  verdict: TripVerdict | null;
}

const burnTokens = (k: { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number }) =>
  k.input + k.cacheWrite5m + k.cacheWrite1h + k.cacheRead + k.output;

export function fuelRecentOf(e: PricedEntry, all: readonly PricedEntry[], now: number): FuelRecent {
  const c = tripCheckOf(e, all, now);
  const f = e.fuel;
  return {
    key: e.key,
    tokens: f ? burnTokens(f.captain) + burnTokens(f.crew) : null,
    cost: e.fuelCost?.total?.total ?? null,
    net: c.net,
    leakCost: e.fuelCost?.leakCost ?? null,
    leakTokens: f ? (f.leak?.total.tokens ?? null) : null,
    unpriced: e.fuelCost?.unpriced.map((u) => u.model) ?? [],
    trip: { p50: c.trip.p50, p90: c.trip.p90, level: c.trip.level, group: c.trip.group, samples: c.trip.samples },
    verdict: c.verdict,
  };
}

// 스냅샷의 TEAM 세션과 등록부를 합친다. 세션이 없는 등록 항목도 "absent"로 보인다.
export function fleetView(
  s: Pick<Snapshot, "sessions" | "claims" | "workspaces" | "airports"> & Partial<Pick<Snapshot, "tickets" | "fuel" | "pulls" | "restarting">>,
  fleet: FleetFile,
  teamPattern = DEFAULT_DISPATCH_CONFIG.teamPattern,
  logbook: PricedEntry[] = [], // loadPricedLogbook()이면 FUEL COST까지, loadPricedLogbook()이면 토큰까지
  now = Date.now(),
): AircraftView[] {
  const team = new RegExp(teamPattern, "i");
  const codeOf = (repo: string | null) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  const live = s.sessions.filter((x) => team.test(x.name) && x.status !== "dead");
  // 세션 이름은 `Team G`, `team_g`처럼 달라도 한 REGISTRATION으로 읽는다(ATC-67)
  const regOf = (name: string) => regKey(name, teamPattern);
  const names = [...new Set([...live.map((x) => regOf(x.name)), ...Object.keys(fleet.aircraft).map(regOf)])].sort(compareRegistration);
  // 라이브 부분(상태·FLYING·마지막 활동·health·chips)은 스냅샷만으로 셈한다(fleet-live.ts, 화면도 같이 쓴다)
  // 관찰한 ACCOUNT(ATC-146): 살아 있는 세션이 home과 다른 폴더에 있으면 LIMIT 붙들림은 그 폴더의 ACCOUNT로 센다
  const observedOf = (n: string) => live.find((x) => regOf(x.name) === regOf(n))?.account ?? null;
  const acctNow = (n: string) => (accountOf(fleet, n) === null ? null : (observedOf(n) ?? accountOf(fleet, n)));
  const liveOf = liveViewOf(s, names, teamPattern, acctNow, now);
  const reportMin = loadReportThreshold();
  return names.map((reg) => {
    const session = live.find((x) => regOf(x.name) === reg);
    const lv = liveOf.get(reg)!;
    const key = fleetKeyOf(Object.keys(fleet.aircraft), reg, teamPattern);
    const profile: AircraftProfile = (key ? fleet.aircraft[key] : undefined) ?? {};
    const actuals = computeActuals(logbook, reg, now);
    return {
      registration: reg,
      callsign: callsign({ name: reg }),
      ...lv,
      base: profile.base ?? (session ? codeOf(session.repo) : null),
      complement: profile.complement ?? fleet.defaults.complement,
      complementIsDefault: !profile.complement,
      ratings: profile.ratings ?? fleet.defaults.ratings,
      ratingsIsDefault: !profile.ratings,
      routes: profile.routes ?? [],
      targets: profile.targets ?? {},
      note: profile.note ?? null,
      report: session?.report ? { ...session.report, decision: needsDecision(session.report, reportMin) } : null,
      account: accountOf(fleet, reg),
      accountIsDefault: accountOf(fleet, reg) != null && !profile.account,
      observedAccount: acctNow(reg) !== accountOf(fleet, reg) ? acctNow(reg) : null,
      fuel: s.fuel?.[reg] ?? null,
      configuration: profile.configuration ?? null,
      enteredAt: profile.enteredAt ?? null,
      aog: profile.aog ?? null,
      retired: profile.retired ?? null,
      actuals,
      fuelBurn: fleetFuelOf(reg, logbook, now),
      fuelRecent: actuals.recent.map((e) => fuelRecentOf(e, logbook, now)),
    };
  });
}

// 새 AIRCRAFT의 기본 AIRPORT: 살아 있는 TEAM 세션이 가장 많은 AIRPORT, 없으면 DISPATCH가 배정하는 첫 AIRPORT
export function defaultBase(s: Pick<Snapshot, "sessions" | "airports">, teamPattern: string): string | null {
  const team = new RegExp(teamPattern, "i");
  const count = new Map<string, number>();
  for (const x of s.sessions) {
    const code = s.airports.find((a) => a.repo === x.repo)?.code;
    if (code && team.test(x.name) && x.status !== "dead") count.set(code, (count.get(code) ?? 0) + 1);
  }
  const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const mapped = Object.values(loadDispatchConfig().projectAirports).find(Boolean) ?? null;
  return top ?? (mapped && s.airports.some((a) => a.code === mapped) ? mapped : (s.airports[0]?.code ?? null));
}

// 비어 있는 다음 등록번호: TEAM_A … TEAM_Z, 그다음 TEAM_AA, TEAM_AB … TEAM_ZZ(ATC-181) 중 세션도 등록 항목도 없는(퇴역 포함) 첫 번호. 다 쓰면 null
export const REGISTRATION_SEQUENCE: readonly string[] = (() => {
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return [...L, ...[...L].flatMap((a) => [...L].map((b) => a + b))].map((x) => `TEAM_${x}`);
})();
export function nextRegistration(taken: Iterable<string>): string | null {
  const used = new Set([...taken].map((x) => regKey(x)));
  return REGISTRATION_SEQUENCE.find((r) => !used.has(r)) ?? null;
}

// ENTRY INTO SERVICE: 새 AIRCRAFT를 FLEET에 들인다. 세션은 사용자가 CREW BRIEFING을 붙여 넣어 연다.
// 템플릿이 general이면 팀원·자격은 기본값을 따르게 비워 둔다.
export function entryIntoService(
  fleet: FleetFile,
  input: Record<string, unknown>,
  liveNames: string[],
  teamPattern: string,
  now = new Date().toISOString(),
): { registration: string; profile: AircraftProfile } {
  const raw = String(input.registration ?? "").trim();
  const reg = registrationOf(raw, teamPattern); // 정식 표기로 들인다(ATC-67)
  if (!reg) throw new FleetError(`등록번호는 TEAM_X 형식: ${raw.toUpperCase() || "(비었음)"}`);
  const found = fleetKeyOf(Object.keys(fleet.aircraft), reg, teamPattern);
  const existing = found ? fleet.aircraft[found] : undefined;
  if (existing?.retired) throw new FleetError(`${reg}는 퇴역 상태 — 복귀(RETIREMENT 해제)를 쓰세요`, 409);
  if (existing || liveNames.some((n) => regKey(n, teamPattern) === reg)) throw new FleetError(`${reg}는 이미 FLEET에 있음`, 409);
  const cfgId = String(input.configuration ?? "general") as ConfigurationId;
  const template = CONFIGURATIONS[cfgId];
  if (!template) throw new FleetError(`모르는 CONFIGURATION: ${cfgId} (가능: ${Object.keys(CONFIGURATIONS).join(", ")})`);
  const patch: Record<string, unknown> = {
    base: input.base ?? null,
    routes: input.routes ?? null,
    note: input.note ?? null,
    ...(typeof input.account === "string" && input.account ? { account: input.account } : {}), // ENTRY가 고른 ACCOUNT(ATC-147). 라벨 검사는 applyPatch가

    ...(cfgId === "general" ? {} : { complement: template.complement, ratings: template.ratings }),
  };
  const profile = applyPatch({}, patch, fleet.defaults, now);
  return { registration: reg, profile: { ...profile, configuration: cfgId, enteredAt: now } };
}

// CREW BRIEFING: 새 세션에 붙여 넣을 시작 지시문. 에이전트끼리 주고받는 글이라 영어로 쓴다(ATC-126). 항공 용어와 머리말은 그대로.
export function crewBriefing(a: AircraftView, repo: string | null, mode: "shadow" | "approval"): string {
  const crew = a.complement.map((m) => `- ${m.position}: ${m.agent}${m.limits?.length ? ` (${m.limits.join(", ")})` : ""}`);
  const lines = [
    `[ATC FLEET] CREW BRIEFING · ${a.callsign} (${a.registration})${a.base ? ` · AIRPORT ${a.base}` : ""}`,
    "",
    `This session is named ${a.registration}.${repo ? ` Its working folder is ${repo}.` : ""} You are this team's CAPTAIN (lead) and follow the team rules in that repository's CLAUDE.md.`,
    "",
    "CREW COMPLEMENT (use this composition and these models when you create crew)",
    ...crew,
    "",
    `TYPE RATING: ${a.ratings.join(", ") || "none"} — FLIGHTs in this range are assigned to you.${a.ratings.includes("SEC") ? " Use the Codex Engineering Task template for SEC work, not flash-helper (DeepSeek)." : " You do not take SEC (DB, security, rights) work."}`,
    `ROUTE: ${a.routes.join(", ") || "unassigned"}`,
    "",
    "Write what the SUPERVISOR reads (your turn text in this session, questions, summaries) in Korean. Never Japanese or Chinese. Messages to other sessions stay English (ATC-126).",
    "",
    "Assignments and messages",
    `- Issues labeled tail:${a.registration} in Linear are this team's. Only the CAPTAIN writes to Linear.`,
    "- When atc TOWER sends a CLEARANCE starting with [ATC C-xxxx], answer that message with READBACK C-xxxx.",
    ...(mode === "approval" ? ["- When atc OCC sends a [DISPATCH D-xxxx] FLIGHT PLAN, answer READBACK D-xxxx if you take it, or UNABLE D-xxxx — reason if you cannot."] : []),
    '- Send every reply to OCC and TOWER to the session name ("OCC", "TOWER"), not to the from address of their message: the address changes when a control session restarts, and a reply to the old address fails (ENOENT).',
    "",
    `When ready, leave only the line \"${a.registration} IN SERVICE\" and wait for assignments.`,
  ];
  return lines.join("\n");
}

// LANGUAGE(ATC-150): 그 AIRCRAFT의 살아 있는 세션 중 CAPTAIN이 가나를 쓴 것의 처음 시각. 없으면 null(표시 전용)
function languageOf(sessions: Snapshot["sessions"], reg: string, teamPattern: string): { at: string } | null {
  const at = sessions.filter((x) => x.status !== "dead" && x.languageAt && regKey(x.name, teamPattern) === reg).map((x) => x.languageAt!).sort()[0];
  return at ? { at } : null;
}

// contextOf: REGISTRATION → CONTEXT SIZE(ATC-69). fuel-run.ts가 이 파일을 부르므로 index.ts가 넘긴다
export type AircraftContexts = (sessions: Snapshot["sessions"], teamPattern: string) => Map<string, ContextSize>;
export function mountFleet(app: Hono, getSnapshot: () => Promise<Snapshot>, contextOf: AircraftContexts = () => new Map()) {
  app.get("/api/fleet", async (c) => {
    const s = await getSnapshot();
    const fleet = loadFleet();
    const projects = [...new Set(s.tickets.map((t) => t.project).filter(Boolean) as string[])].sort();
    const cfg = loadDispatchConfig();
    // RULES(ATC-42): 그 AIRCRAFT의 살아 있는 세션이 규칙 파일 변경을 확인했나. rules-drift hook 기록이 없으면 null
    const rulesRecords = loadRulesRecords();
    const rulesOf = (reg: string): RulesView | null => rulesOfAircraft(s.sessions.filter((x) => x.status !== "dead" && regKey(x.name, cfg.teamPattern) === reg), rulesRecords);
    const context = contextOf(s.sessions, cfg.teamPattern);
    // REPOSITION(ATC-179): AIRCRAFT마다 마지막 옮김(최근 30일, FLIGHT RECORDER). 카드가 base 옆에 보인다
    const lastRepo = new Map<string, { from: string; to: string; at: string; by: string; ok: boolean }>();
    for (const r of readRecords(Date.now() - 30 * 86_400_000)) if (r.kind === "fleet" && r.op === "reposition" && r.from && r.to) lastRepo.set(regKey(r.aircraft, cfg.teamPattern), { from: r.from, to: r.to, at: r.t, by: r.by, ok: r.ok });
    const aircraft = fleetView(s, fleet, cfg.teamPattern, loadPricedLogbook())
      .map(withCrew(s))
      .map((a) => ({ ...a, lastReposition: lastRepo.get(a.registration) ?? null, rules: rulesOf(a.registration), language: languageOf(s.sessions, a.registration, cfg.teamPattern), context: contextView(context.get(a.registration) ?? null) }));
    const configurations = Object.entries(CONFIGURATIONS).map(([id, t]) => ({ id, label: t.label, complement: t.complement, ratings: t.ratings }));
    return c.json({
      ratings: RATINGS,
      fuelAccounts: s.fuelAccounts ?? [], // ACCOUNT마다 FUEL과 구성원(AIRCRAFT·관제 세션, ATC-60)
      defaults: fleet.defaults,
      projects,
      aircraft,
      observedWindowDays: OBSERVED_WINDOW_DAYS,
      configurations,
      airports: s.airports.map((a) => a.code),
      defaultBase: defaultBase(s, cfg.teamPattern),
      dispatchMode: cfg.mode, // approval(2b)일 때만 CREW CHANGE 승인을 보인다
      teamPattern: cfg.teamPattern, // 화면이 스냅샷으로 라이브 값을 덮을 때 같은 REGISTRATION 규칙을 쓴다(ATC-100)
      nextRegistration: nextRegistration([...aircraft.map((a) => a.registration), ...s.sessions.map((x) => x.name)]),
    });
  });
  // ENTRY INTO SERVICE
  app.post("/api/fleet", async (c: Context) => {
    const s = await getSnapshot();
    const teamPattern = loadDispatchConfig().teamPattern;
    const fleet = loadFleet();
    const body = await c.req.json().catch(() => ({}));
    const live = s.sessions.filter((x) => x.status !== "dead").map((x) => x.name);
    try {
      const base = body.base ?? defaultBase(s, teamPattern);
      const { registration, profile } = entryIntoService(fleet, { ...body, base }, live, teamPattern);
      saveAircraft(registration, profile);
      fleet.aircraft[registration] = profile;
      return c.json({ ok: true, aircraft: fleetView(s, fleet, teamPattern, loadPricedLogbook()).find((a) => a.registration === registration) });
    } catch (e) {
      if (e instanceof FleetError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
  app.get("/api/fleet/:registration/briefing", async (c) => {
    const cfg = loadDispatchConfig();
    const reg = regKey(c.req.param("registration"), cfg.teamPattern);
    const s = await getSnapshot();
    const a = fleetView(s, loadFleet(), cfg.teamPattern).find((x) => x.registration === reg);
    if (!a) return c.json({ error: `FLEET에 없음: ${reg}` }, 404);
    const repo = s.airports.find((x) => x.code === a.base)?.repo ?? null;
    return c.json({ registration: reg, briefing: crewBriefing(a, repo, cfg.mode) });
  });
  app.patch("/api/fleet/:registration", async (c: Context) => {
    const teamPattern = loadDispatchConfig().teamPattern;
    const reg = registrationOf(c.req.param("registration"), teamPattern);
    if (!reg) return c.json({ error: `TEAM 이름이 아님: ${(c.req.param("registration") ?? "").toUpperCase()}` }, 400);
    const body = await c.req.json().catch(() => ({}));
    const fleet = loadFleet();
    const key = fleetKeyOf(Object.keys(fleet.aircraft), reg, teamPattern) ?? reg;
    try {
      const next = applyPatch(fleet.aircraft[key] ?? {}, body, fleet.defaults);
      saveAircraft(key, next);
      const s = await getSnapshot();
      noteCrewChange(reg, fleet.aircraft[key] ?? {}, next, fleet.defaults, s.sessions); // CREW CHANGE 기록(2b에서는 승인 뒤 OCC가 보냄)
      if (Object.keys(next).length) fleet.aircraft[key] = next;
      else delete fleet.aircraft[key];
      return c.json({ ok: true, aircraft: fleetView(s, fleet, teamPattern, loadPricedLogbook()).map(withCrew(s)).find((a) => a.registration === reg) });
    } catch (e) {
      if (e instanceof FleetError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
}
