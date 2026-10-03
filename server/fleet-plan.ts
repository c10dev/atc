import { CONFIGURATIONS, type ConfigurationId, canFly, type CrewMember, DEFAULT_ACCOUNT, type FleetFile, type Rating } from "./crew.ts";
import type { Plan, Unserved } from "./dispatch.ts";
import { K3_FRESH_WHY } from "./k3-allow.ts";
import type { AircraftView } from "./fleet.ts";
import { type ContextSize, contextLabel, type RefreshSaving, refreshSavingOf, tokensShort } from "./fuel-context.ts";
import type { PriceTable } from "./fuel-cost.ts";
import { type FuelRemaining, fuelUsedText, membersText } from "./fuel-remaining.ts";
import { hhmm } from "./health.ts";
import type { LogEntry } from "./logbook.ts";
import { isFlap, type RepositionEvent } from "./reposition.ts";
import { compareRegistration, regKey } from "./registration.ts";
import { MAX_LAUNCHED, PERMISSION_MODES, type PermissionMode } from "./launch-limits.ts";
import { isBackground, manualStepsOf, type SessionOrigin } from "./session-origin.ts";

// FLEET PLAN(docs/fleet.md 8.6): 수요·활주로·예비를 보고 LAUNCH·ENTRY·STOP·RESTART·REFRESH·AOG·RETIRE를 제안한다.
// 여기는 계산만(순수). 기록·API·주기 실행은 fleet-plan-run.ts. 1·2단계는 그림자: 제안하고 SUPERVISOR가 동의·반대만 한다.
// 3단계(8.7)는 승인 운용: SUPERVISOR가 승인하면 FLEET 탭 버튼과 같은 코드로 바로 실행한다(executionOf가 단계를 정한다).

export interface FleetPlanConfig {
  reserve: number; // 수요가 있는 AIRPORT마다 남겨 둘 PARKED AIRCRAFT
  waitMin: number; // LAUNCH·ENTRY: 받을 곳 없는 FLIGHT가 이만큼 이어져야 제안
  idleHours: number; // STOP: 백그라운드 세션이 이만큼 쉬었으면
  restartDays: number; // RESTART: 백그라운드 세션이 이보다 오래됐으면
  retireDays: number; // RETIRE: 이 기간 ARRIVED가 없으면
  minDwellMin: number; // LAUNCH·STOP 뒤 이만큼은 반대 제안을 하지 않는다
  refreshTokens: number; // REFRESH(ATC-69): 쉬는 AIRCRAFT의 대화가 이 토큰을 넘거나
  refreshPct: number; // 창의 이 몫(0–1)을 넘으면. 창을 짐작만 했으면(200k 기본) 토큰 기준만 본다
  accountChangeLimitMin: number; // ACCOUNT CHANGE(ATC-148): LIMIT의 reset이 이 분 넘게 남았으면 ACCOUNT를 옮기자고 제안
}
// SUPERVISOR 결정(2026-09-28): 제안한 기본값 그대로. REFRESH는 ATC-69 명세의 기본값(300k 또는 창의 40%)
export const FLEET_PLAN_DEFAULTS: FleetPlanConfig = { reserve: 1, waitMin: 120, idleHours: 12, restartDays: 3, retireDays: 30, minDwellMin: 120, refreshTokens: 300_000, refreshPct: 0.4, accountChangeLimitMin: 60 };

export const FLEET_PLAN_KINDS = ["LAUNCH", "ENTRY", "STOP", "RESTART", "REFRESH", "ACCOUNT CHANGE", "REPOSITION", "K3 RELAUNCH", "AOG", "RETIRE", "RETURN"] as const;
export type FleetPlanKind = (typeof FLEET_PLAN_KINDS)[number];

export interface PlanReason {
  code: string;
  detail: string;
  value?: number | string | null;
}

export interface FleetCandidate {
  key: string; // 지속 조건을 세는 열쇠. LAUNCH·ENTRY는 AIRPORT마다 하나(DEMAND|VCDO), 나머지는 종류|REGISTRATION
  kind: FleetPlanKind;
  aircraft: string | null; // REGISTRATION. ENTRY는 새로 들일 등록번호
  airport: string | null; // REPOSITION은 옮길 AIRPORT(to)
  from?: string; // REPOSITION(ATC-179): 옛 base AIRPORT
  configuration?: ConfigurationId; // ENTRY
  account?: string; // ENTRY(ATC-147): 새 AIRCRAFT가 날 ACCOUNT. 등록부가 없으면 없다
  reasons: PlanReason[];
}

// AIRCRAFT 이름의 세션(claude agents --json)
export interface SessionFact {
  registration: string;
  kind: string; // background | interactive
  id?: string;
  startedAt: number | null;
  origin?: SessionOrigin; // ATC-76: background·desktop·terminal·unknown. 없으면 kind로 본다
}
// atc가 멈추고 다시 띄울 수 있는 세션인가(ATC-76): 출처가 background
const originOfFact = (x: Pick<SessionFact, "kind" | "origin"> | null | undefined): SessionOrigin | null => (x ? (x.origin ?? (x.kind === "background" ? "background" : "unknown")) : null);
const isBgFact = (x: Pick<SessionFact, "kind" | "origin"> | null | undefined) => isBackground(originOfFact(x));

// AIRPORT마다 수요와 막힌 이유(화면용)
export interface DemandRow {
  airport: string;
  served: number; // 이번 계획에서 AIRCRAFT를 받은 FLIGHT
  unserved: string[]; // 받을 곳이 없는 FLIGHT
  parked: number; // 계획 뒤에도 남는 PARKED AIRCRAFT
  blocked: string | null; // LAUNCH를 막는 이유(GROUND STOP, 활주로, 상한)
}

export interface FleetInputs {
  aircraft: AircraftView[]; // fleetView
  plan: Pick<Plan, "assign" | "unserved">; // 모든 Linear 팀으로 돌린 planner
  sessions: SessionFact[];
  lastActive: Map<string, string>; // REGISTRATION → 마지막 활동(없으면 세션 시작)
  nordo: Set<string>; // 세션이 죽었고 살아 있는 같은 이름 세션이 없는 REGISTRATION
  los: Map<string, string>; // REGISTRATION → 최근 24시간 LOS 시각
  logbook: (Pick<LogEntry, "aircraft" | "airport" | "arrivedAt" | "blockMin" | "landingWaitMin"> & Partial<Pick<LogEntry, "flight">>)[];
  openPrs: Set<string>; // 열린 PR의 STAND를 쥔 REGISTRATION
  groundStops: Set<string>; // GROUND STOP(kind stop) 중인 AIRPORT
  dwell: Map<string, { op: "launch" | "stop"; at: string }>; // 마지막 LAUNCH·STOP(FLIGHT RECORDER)
  maxLaunched: number;
  nextRegistration: string | null;
  defaults: FleetFile["defaults"];
  config: FleetPlanConfig;
  now: number;
  // FUEL REMAINING(ATC-55·60)의 ACCOUNT마다 한 줄(snapshot.fuelAccounts). 없으면 FUEL을 보지 않는다(전과 같다)
  fuelAccounts?: FuelRemaining[];
  // 등록된 ACCOUNT와 로그인 여부(ATC-147, loggedIn null=모름). 없거나 비면 ENTRY는 전과 같다(ACCOUNT를 고르지 않는다)
  accountLogins?: { label: string; loggedIn: boolean | null; maxLaunched?: number; running?: number }[];
  // LAUNCH ACCOUNT(ATC-239): AIRCRAFT의 것이 설정돼 있고 등록부에 있으면 그 라벨. 있으면 AIRCRAFT의 효과 있는 home이다(없으면 프로필 home)
  launchAccount?: string | null;
  // CONTEXT SIZE(ATC-69): REGISTRATION → 살아 있는 세션의 대화 크기와 F5 가격표. 없으면 REFRESH를 내지 않는다
  context?: Map<string, ContextSize>;
  prices?: PriceTable | null;
  // REPOSITION(ATC-179): 최근 24시간의 옮김(FLIGHT RECORDER `fleet` `reposition`). 없으면 옮긴 적 없음
  repositions?: (RepositionEvent & { baseChanged?: boolean })[];
  // K3 RELAUNCH(ATC-509): dispatch.json k3Relaunch가 "on"이면 true. 없거나 false면 카드를 내지 않는다
  k3Relaunch?: boolean;
  k3Relaunched?: ReadonlySet<string>; // 최근 minDwell 안에 K3 RELAUNCH를 승인한 FLIGHT. 같은 FLIGHT로 되풀이해 멈추지 않는다
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const RUNWAY_DAYS = 14;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
// 45m, 3h30m, 2d4h
export function spanText(min: number) {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? `${String(m % 60).padStart(2, "0")}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}

// 활주로가 병목인가: 최근 14일 착륙 대기 중앙값이 block time 중앙값보다 길면. 기록이 없으면 병목이 아니다
export function runwayOf(logbook: FleetInputs["logbook"], airport: string, now: number): { bottleneck: boolean; detail: string } {
  const recent = logbook.filter((e) => e.airport === airport && now - Date.parse(e.arrivedAt) < RUNWAY_DAYS * DAY);
  const wait = median(recent.flatMap((e) => e.landingWaitMin ?? []));
  const block = median(recent.map((e) => e.blockMin).filter((x): x is number => x !== null));
  if (wait === null || block === null) return { bottleneck: false, detail: `최근 ${RUNWAY_DAYS}일 착륙 기록 부족 — 활주로 확인 못 함` };
  const text = `착륙 대기 중앙값 ${spanText(wait)} · block ${spanText(block)} (${RUNWAY_DAYS}일 ${recent.length}건)`;
  return { bottleneck: wait > block, detail: text };
}

// 이 AIRCRAFT(또는 구성)가 그 FLIGHT를 날 수 있나: tail, TYPE RATING, CREW. 분류 라벨이 없으면 rating은 비어 있어 통과한다
const canServe = (reg: string | null, ratings: Rating[], complement: CrewMember[], u: Unserved) =>
  (!u.tails.length || (reg !== null && u.tails.includes(reg))) && u.ratings.every((r) => ratings.includes(r)) && canFly(complement, u.type);

// FLEET PLAN 승인으로 건 AOG의 사유 머리(8.7). RETURN은 이것만 본다
export const FLEET_PLAN_AOG = /^FLEET PLAN F-\d+/;

const isParked = (a: AircraftView) => !a.retired && !a.aog && a.status === "idle" && !a.flying.length;

// ── FUEL(ATC-63, docs/fuel.md 6·fleet.md 8.6): ACCOUNT가 hold 수준이면 LAUNCH·ENTRY를 내지 않고, info면 사유 줄을 단다 ──
// DISPATCH HOLD 스위치(D3)와 상관없이 hold 수준(holdPct 이상)을 쓴다: 제안은 조언이고, 빈 ACCOUNT에 세션을 띄우자는 제안은 쓸모가 없다.
// LAUNCH할 AIRCRAFT는 세션이 없어 AircraftView.fuel이 비므로 ACCOUNT로 찾는다(관제 세션만 적은 ACCOUNT도 잡힌다).
// ENTRY로 들일 새 AIRCRAFT는 라벨이 없으니 default ACCOUNT로 센다. ACCOUNT를 모르면(라벨 없음) 그 AIRCRAFT 자신의 값만
export function fuelOfPlan(i: Pick<FleetInputs, "aircraft" | "fuelAccounts"> & Partial<Pick<FleetInputs, "launchAccount">>, kind: FleetPlanKind, registration: string | null): FuelRemaining | null {
  const accounts = i.fuelAccounts ?? [];
  // LAUNCH ACCOUNT가 있으면 이름 없는 LAUNCH·ENTRY는 거기서 뜬다(ATC-239): hold 검사도 그 ACCOUNT로
  if (i.launchAccount && (kind === "ENTRY" || kind === "LAUNCH")) return accounts.find((f) => f.account === i.launchAccount) ?? null;
  if (kind === "ENTRY") return accounts.find((f) => f.account === DEFAULT_ACCOUNT) ?? null;
  const a = registration ? i.aircraft.find((x) => x.registration === regKey(registration)) : undefined;
  if (!a) return null;
  if (a.account) return accounts.find((f) => f.account === a.account) ?? null;
  return accounts.find((f) => f.group === `aircraft:${a.registration}`) ?? null;
}

// FUEL 사용 100% (account acct-1) until 21:00Z
export const fuelHoldText = (f: FuelRemaining, now: number) =>
  `FUEL 사용 ${Math.round(f.top.pct)}%${f.account ? ` (account ${f.account})` : ""} until ${hhmm(Date.parse(f.top.resetsAt), now)}`;

const fuelInfoReason = (f: FuelRemaining, now: number): PlanReason => ({
  code: "fuel",
  detail: `${fuelUsedText(f, now)}${f.account ? ` (account ${f.account})` : ""} — 한도에 가까움(INFO) · ${membersText(f) || "구성원 없음"}`,
  value: f.top.pct,
});

// ENTRY가 새 AIRCRAFT를 올릴 ACCOUNT(ATC-147, 순수). 등록부가 있으면: 등록되고 로그인이 안 됐다고 알려지지 않은(loggedIn이 false가 아닌) ACCOUNT 중
// hold 수준(holdPct) 아래에서 사용이 가장 낮은 것(기록이 없으면 0으로, 같으면 라벨 순). 하나도 없으면 blocked 사유. 등록부가 없으면 registered false(전과 같다)
export function entryAccountOf(i: Pick<FleetInputs, "accountLogins" | "fuelAccounts"> & Partial<Pick<FleetInputs, "launchAccount">>): { registered: boolean; account: string | null; use: number | null; blocked: string | null } {
  const logins = i.accountLogins ?? [];
  if (!logins.length) return { registered: false, account: null, use: null, blocked: null };
  const fuel = i.fuelAccounts ?? [];
  // LAUNCH ACCOUNT(ATC-239): 설정돼 있으면 새 AIRCRAFT도 거기서 난다. 거절 사유(로그인 안 됨·hold)가 있으면 다른 ACCOUNT로 돌리지 않고 막는다
  if (i.launchAccount) {
    const l = logins.find((x) => x.label === i.launchAccount);
    if (l) {
      const f = fuel.find((x) => x.account === l.label) ?? null;
      if (l.loggedIn === false || f?.level === "hold") return { registered: true, account: null, use: null, blocked: `새 AIRCRAFT(ENTRY)가 날 LAUNCH ACCOUNT ${l.label}를 쓸 수 없음 — ${l.loggedIn === false ? "로그인 안 됨" : `FUEL hold${f ? ` ${Math.round(f.top.pct)}%` : ""}`}` };
      return { registered: true, account: l.label, use: f?.top.pct ?? null, blocked: null };
    }
  }
  const rows = logins.map((l) => ({ label: l.label, loggedIn: l.loggedIn, f: fuel.find((x) => x.account === l.label) ?? null }));
  const ok = rows.filter((r) => r.loggedIn !== false && r.f?.level !== "hold").sort((a, b) => (a.f?.top.pct ?? 0) - (b.f?.top.pct ?? 0) || a.label.localeCompare(b.label));
  if (ok.length) return { registered: true, account: ok[0].label, use: ok[0].f?.top.pct ?? null, blocked: null };
  const why = rows.map((r) => `${r.label}: ${r.loggedIn === false ? "로그인 안 됨" : `FUEL hold${r.f ? ` ${Math.round(r.f.top.pct)}%` : ""}`}`).join(", ");
  return { registered: true, account: null, use: null, blocked: `새 AIRCRAFT(ENTRY)가 날 ACCOUNT가 없음 — ${why}` };
}

// ── ACCOUNT CHANGE(ATC-148, docs/fleet.md 8.6): FLIGHT 사이의 AIRCRAFT를 사용 한도가 남은 ACCOUNT로 옮기자는 제안(순수) ──
// 조건: (1) 지금 ACCOUNT(관찰한 것)가 hold 수준(holdPct)이거나 reset이 accountChangeLimitMin분 넘게 남은 LIMIT — 또는 home이 아닌 ACCOUNT에서 돌고 home이 infoPct 아래로 돌아옴,
// (2) FLIGHT 사이: 세션이 쉬고(idle) 열린 FLIGHT·점유·PR이 없고 이번 계획에서 FLIGHT를 받지 않음. 살아 있는 FLIGHT는 옮기지 않는다 — 한도로 잘린 FLIGHT는 같은 ACCOUNT의 RESUME(ATC-86·129),
// (3) 다른 등록 ACCOUNT가 로그인 안 됨으로 알려지지 않았고 infoPct 아래(level ok)이고 ACCOUNT 상한(maxLaunched) 아래. 목표는 그중 사용이 가장 낮은 것(기록 없음=0, 같으면 라벨 순)
// atc가 멈추고 다시 띄울 수 있는 백그라운드 세션만. 등록부가 없으면 없다
export function accountChangeOf(
  a: AircraftView,
  session: SessionFact | null,
  i: Pick<FleetInputs, "accountLogins" | "fuelAccounts" | "openPrs" | "config" | "now"> & Partial<Pick<FleetInputs, "launchAccount">>,
  assigned: boolean,
  launchedRecently: boolean,
): FleetCandidate | null {
  const logins = i.accountLogins ?? [];
  // LAUNCH ACCOUNT가 설정돼 있으면(ATC-239) 그것이 효과 있는 home이다: 프로필 home로 돌아가자는 제안은 없고, "돌아감"은 LAUNCH ACCOUNT로 돌아감이다
  const launchHome = i.launchAccount && logins.some((l) => l.label === i.launchAccount) ? i.launchAccount : null;
  const home = launchHome ?? a.account;
  const cur = a.observedAccount ?? a.account;
  if (!logins.length || !home || !cur || a.retired || a.aog || !isBgFact(session) || launchedRecently) return null;
  if (!logins.some((l) => l.label === cur)) return null; // 등록되지 않은 폴더의 ACCOUNT는 옮길 근거를 모른다
  if (a.status !== "idle" || a.flying.length || a.flights.length || assigned || i.openPrs.has(a.registration)) return null;
  if (a.health?.code === "LIMIT" && a.health.cut) return null; // 한도로 잘린 턴은 RESUME(같은 ACCOUNT)
  const fuel = i.fuelAccounts ?? [];
  const fuelOf = (label: string) => fuel.find((f) => f.account === label) ?? null;
  const use = (label: string) => fuelOf(label)?.top.pct ?? 0;
  const curFuel = fuelOf(cur);
  const why: PlanReason[] = [];
  if (curFuel?.level === "hold") why.push({ code: "account", detail: `${fuelHoldText(curFuel, i.now)} — hold 수준`, value: curFuel.top.pct });
  const h = a.health;
  const limitLeft = h?.code === "LIMIT" && h.resetsAt ? Date.parse(h.resetsAt) - i.now : null;
  if (limitLeft !== null && limitLeft > i.config.accountChangeLimitMin * MIN) why.push({ code: "limit", detail: `ACCOUNT ${cur}: LIMIT — reset ${h!.resetsAt!.slice(11, 16)}Z까지 ${spanText(limitLeft / MIN)} 남음(기준 ${i.config.accountChangeLimitMin}분)`, value: h!.resetsAt ?? null });
  const eligible = (l: { label: string; loggedIn: boolean | null; maxLaunched?: number; running?: number }) =>
    l.label !== cur && l.loggedIn !== false && (fuelOf(l.label)?.level ?? "ok") === "ok" && !(l.maxLaunched && (l.running ?? 0) >= l.maxLaunched);
  const targets = logins.filter(eligible).sort((x, y) => use(x.label) - use(y.label) || x.label.localeCompare(y.label));
  // home로 돌아가는 제안(자동이 아니다): home이 아닌 ACCOUNT에서 돌고 home이 infoPct 아래
  const back = cur !== home && targets.some((t) => t.label === home);
  if (back) why.push({ code: "home", detail: `${launchHome ? "LAUNCH ACCOUNT" : "home ACCOUNT"} ${home}: 사용 ${Math.round(use(home))}% — infoPct 아래로 돌아옴`, value: use(home) });
  if (!why.length || !targets.length) return null;
  const to = back && !why.some((r) => r.code !== "home") ? home : targets[0].label; // home로 돌아가는 것만이 이유면 home로
  const tf = fuelOf(to);
  const reasons: PlanReason[] = [
    ...why,
    { code: "target", detail: `옮길 ACCOUNT ${to}: ${tf ? `사용 ${Math.round(tf.top.pct)}%(reset ${tf.top.resetsAt.slice(11, 16)}Z)` : "사용 기록 없음"} — 등록됨, 로그인 안 됨 아님, infoPct 아래${targets.length > 1 ? `, 사용이 가장 낮음(다른 후보 ${targets.slice(1).map((t) => `${t.label} ${Math.round(use(t.label))}%`).join(", ")})` : ""}`, value: to },
    { code: "between", detail: "FLIGHT 사이: 세션이 쉬고 열린 FLIGHT·점유·PR이 없음" },
    { code: "cold", detail: "새 세션은 캐시 없이 시작한다(ACCOUNT마다 캐시가 다름). FUEL LEAK의 ACCOUNT CHANGE로 따로 보인다" },
    { code: "session", detail: `BG ${session!.id ?? "?"} — ACCOUNT ${cur}에서 멈추고 ACCOUNT ${to}에서 CREW BRIEFING으로 다시 띄움. ${launchHome ? `프로필 home ACCOUNT ${a.account}는 그대로(지금은 LAUNCH ACCOUNT ${launchHome}가 기준)` : `home ACCOUNT ${home}는 그대로`}` },
  ];
  return { key: `ACCOUNT CHANGE|${a.registration}`, kind: "ACCOUNT CHANGE", aircraft: a.registration, airport: a.base, account: to, reasons };
}

// ── REPOSITION(ATC-179, docs/fleet.md 8.6): 쉬는 AIRCRAFT의 base를 FLIGHT가 기다리는데 AIRCRAFT가 없는 AIRPORT로 옮기자는 제안(순수) ──
// 세션은 시작한 폴더의 CLAUDE.md를 읽으므로 살아 있는 세션은 저장소를 바꿀 수 없다: 멈추고, base를 바꾸고, 그 AIRPORT 저장소에서 다시 띄운다.
// 목표: 받을 AIRCRAFT가 없는(no-aircraft, 부모·우선순위·HOLD·슬롯이 아닌) FLIGHT가 기다리고, 그 AIRPORT에 소속 AIRCRAFT가 하나도 없고(ABSENT 포함), GROUND STOP이 아님.
// 출발: 다른 AIRPORT 소속이고 FLIGHT 사이(ACCOUNT CHANGE와 같은 시험)이고, 떠난 뒤에도 그 AIRPORT가 자기 FLIGHT 수만큼은 AIRCRAFT를 갖고, 기다리는 FLIGHT 하나는 날 수 있음.
// 고르는 순서: 그 AIRPORT의 ARRIVED 이력(14일), 가장 오래 쉼, REGISTRATION. 목표 AIRPORT마다 하나. flaps: 조건은 다 맞지만 minDwell 안에 직전 base로 되돌아가는 것
export interface RepositionFlap {
  aircraft: string;
  from: string; // 지금 base
  to: string; // 되돌아갈 AIRPORT(직전 base)
}
const HISTORY_DAYS = 14;
export function repositionOf(
  i: Pick<FleetInputs, "aircraft" | "plan" | "sessions" | "lastActive" | "nordo" | "logbook" | "openPrs" | "groundStops" | "dwell" | "config" | "now" | "fuelAccounts" | "repositions">,
  assigned: ReadonlySet<string>,
  skip: ReadonlySet<string> = new Set(),
): { candidates: FleetCandidate[]; flaps: RepositionFlap[] } {
  const unserved = i.plan.unserved ?? [];
  const cfg = i.config;
  const out: FleetCandidate[] = [];
  const flaps: RepositionFlap[] = [];
  // 배정할 수 있는 AIRCRAFT(퇴역·AOG 아님, 세션 없는 ABSENT도 DISPATCH가 LAUNCH할 수 있으므로 센다)
  const usable = (a: AircraftView) => !a.retired && !a.aog;
  const availableAt = (code: string) => i.aircraft.filter((a) => a.base === code && usable(a)).length;
  const demandAt = (code: string) => i.plan.assign.filter((p) => p.airport === code).length + unserved.filter((u) => u.airport === code).length;
  const leftAt = new Map<string, number>(); // 이번 계획에서 이미 떠나게 한 수(같은 출발 AIRPORT에서 둘을 빼지 않게)
  const taken = new Set<string>();
  const targets = [...new Set(unserved.filter((u) => u.why === "no-aircraft" && !u.tails.length).map((u) => u.airport))].sort();
  for (const target of targets) {
    if (i.groundStops.has(target) || availableAt(target) > 0) continue;
    const waiting = unserved.filter((u) => u.airport === target && u.why === "no-aircraft" && !u.tails.length);
    const pool = i.aircraft
      .filter((a) => a.base && a.base !== target && usable(a) && !taken.has(a.registration) && !skip.has(a.registration))
      .map((a) => ({ a, session: i.sessions.find((x) => regKey(x.registration) === a.registration) ?? null, served: waiting.filter((u) => canServe(a.registration, a.ratings, a.complement, u)) }))
      .filter(({ a, session, served }) => {
        if (!isBgFact(session) || a.status !== "idle" || a.restarting || i.nordo.has(a.registration)) return false;
        if (a.flying.length || a.flights.length || assigned.has(a.registration) || i.openPrs.has(a.registration)) return false;
        if (a.health?.code === "LIMIT") return false; // 한도로 잘린 턴은 RESUME이다. 한도 근처 세션도 옮기지 않는다
        const fuel = a.fuel ?? (a.account ? ((i.fuelAccounts ?? []).find((f) => f.account === a.account) ?? null) : null);
        if (fuel?.level === "hold") return false;
        if (!served.length) return false;
        return availableAt(a.base!) - (leftAt.get(a.base!) ?? 0) - 1 >= demandAt(a.base!);
      });
    // minDwell 안에 LAUNCH·STOP·옮김이 있으면 옮기지 않는다. 직전 base로 되돌아가는 것이면 flapping으로 센다
    const dwelling = (reg: string) => {
      const d = i.dwell.get(reg);
      return (d ? i.now - Date.parse(d.at) < cfg.minDwellMin * MIN : false) || (i.repositions ?? []).some((e) => e.aircraft === reg && (e.ok || e.baseChanged) && i.now - Date.parse(e.at) < cfg.minDwellMin * MIN);
    };
    const fit = pool.filter(({ a }) => {
      if (!dwelling(a.registration)) return true;
      if (isFlap(i.repositions ?? [], a.registration, target, i.now, cfg.minDwellMin)) flaps.push({ aircraft: a.registration, from: a.base!, to: target });
      return false;
    });
    if (!fit.length) continue;
    const history = (reg: string) => i.logbook.filter((e) => e.aircraft === reg && e.airport === target && i.now - Date.parse(e.arrivedAt) < HISTORY_DAYS * DAY).length;
    const idleFrom = (reg: string) => Date.parse(i.lastActive.get(reg) ?? "") || 0;
    const [best] = [...fit].sort((x, y) => history(y.a.registration) - history(x.a.registration) || idleFrom(x.a.registration) - idleFrom(y.a.registration) || compareRegistration(x.a.registration, y.a.registration));
    const { a, session, served } = best;
    const src = a.base!;
    taken.add(a.registration);
    leftAt.set(src, (leftAt.get(src) ?? 0) + 1);
    const idleMs = i.lastActive.has(a.registration) ? i.now - Date.parse(i.lastActive.get(a.registration)!) : null;
    const seen = history(a.registration);
    out.push({
      key: `REPOSITION|${target}`, kind: "REPOSITION", aircraft: a.registration, airport: target, from: src,
      reasons: [
        { code: "waiting", detail: `${target}: ${waiting.map((u) => u.flight).join(", ")} 대기, 소속 AIRCRAFT 0`, value: waiting.length },
        { code: "source", detail: `${src}: 쉬는 AIRCRAFT ${availableAt(src)} → ${availableAt(src) - 1}, 대기 FLIGHT ${demandAt(src)}`, value: availableAt(src) },
        { code: "between", detail: `${a.registration}: ${a.status === "idle" ? "HOLDING·PARKED" : a.status}${idleMs !== null ? ` ${spanText(idleMs / MIN)}` : ""}, FLIGHT·STAND·PR 없음` },
        { code: "fits", detail: `${a.registration}: TYPE RATING ${a.ratings.join("·") || "없음"}, CREW가 ${served.map((u) => u.flight).join(", ")}를 날 수 있음` },
        ...(seen ? [{ code: "history", detail: `${a.registration}: 최근 ${HISTORY_DAYS}일 ${target}에서 ARRIVED ${seen}건`, value: seen }] : []),
        { code: "cold", detail: `새 세션은 ${target} 저장소에서 캐시 없이 시작한다(CLAUDE.md도 그 저장소의 것)` },
        { code: "session", detail: `BG ${session!.id ?? "?"} — ${src}에서 멈추고 base를 ${target}으로 바꾼 뒤 ${target} 저장소에서 CREW BRIEFING으로 다시 띄움` },
      ],
    });
  }
  return { candidates: out, flaps };
}

// ── K3 RELAUNCH(ATC-509, docs/autonomy.md K3): K3 FLIGHT를 받을 새 세션이 없을 때 쉬는 AIRCRAFT를 멈추고 그 FLIGHT로 다시 띄우자는 제안(순수) ──
// 돌고 있는 세션은 새 `--settings`(autoMode.allow)를 받지 못하므로 K3 FLIGHT는 새로 띄운 AIRCRAFT만 받는다. 그 AIRPORT에 쓸 수 있는 ABSENT AIRCRAFT가 있으면 DISPATCH가 launch 카드로 보내니 이 카드는 없다.
// 고르는 AIRCRAFT: 그 AIRPORT 소속, 백그라운드 세션이 쉼(idle·NORDO 아님), 열린 PR·STAND·FLIGHT 없음, LIMIT 아님, ACCOUNT가 FUEL hold 아님, 그 FLIGHT를 날 수 있음. 하나만: 가장 오래 쉰 것, 같으면 REGISTRATION
export const K3_RELAUNCH_KEY = (flight: string) => `K3 RELAUNCH|${flight}`;
export function k3RelaunchExcludedOf(
  i: Pick<FleetInputs, "aircraft" | "sessions" | "nordo" | "openPrs" | "fuelAccounts" | "launchAccount">,
  a: AircraftView,
  assigned: ReadonlySet<string>,
): string | null {
  const session = i.sessions.find((x) => regKey(x.registration) === a.registration) ?? null;
  if (a.retired || a.aog) return "RETIRED·AOG";
  if (!isBgFact(session)) return "백그라운드 세션이 아님";
  if (a.status !== "idle" || a.restarting || i.nordo.has(a.registration)) return "쉬는 중이 아님";
  if (a.flying.length || a.flights.length || assigned.has(a.registration)) return "STAND·FLIGHT가 있음";
  if (i.openPrs.has(a.registration)) return "열린 PR이 있음";
  if (a.health?.code === "LIMIT") return "LIMIT";
  const fuel = a.fuel ?? (a.account ? ((i.fuelAccounts ?? []).find((f) => f.account === a.account) ?? null) : null);
  if (fuel?.level === "hold") return "FUEL hold";
  return null;
}
export function k3RelaunchOf(
  i: Pick<FleetInputs, "aircraft" | "plan" | "sessions" | "lastActive" | "nordo" | "openPrs" | "groundStops" | "fuelAccounts" | "launchAccount" | "now" | "k3Relaunch" | "k3Relaunched">,
  assigned: ReadonlySet<string>,
  skip: ReadonlySet<string> = new Set(),
): FleetCandidate[] {
  if (!i.k3Relaunch) return [];
  const waiting = (i.plan.unserved ?? []).filter((u) => u.why === "no-aircraft" && u.k3);
  const out: FleetCandidate[] = [];
  const taken = new Set<string>(skip);
  const usable = (a: AircraftView) => !a.retired && !a.aog;
  for (const u of [...waiting].sort((a, b) => a.flight.localeCompare(b.flight))) {
    if (i.groundStops.has(u.airport) || i.k3Relaunched?.has(u.flight)) continue;
    // 그 AIRPORT에 이 FLIGHT를 받을 수 있는 ABSENT AIRCRAFT(DISPATCH가 launch 카드로 쓰는 것)가 있으면 그쪽이 먼저다
    const absent = i.aircraft.some((a) => a.base === u.airport && usable(a) && a.status === "absent" && !a.restarting && !i.nordo.has(a.registration) && canServe(a.registration, a.ratings, a.complement, u));
    if (absent) continue;
    const pool = i.aircraft
      .filter((a) => a.base === u.airport && !taken.has(a.registration) && canServe(a.registration, a.ratings, a.complement, u) && k3RelaunchExcludedOf(i, a, assigned) === null)
      .sort((x, y) => (Date.parse(i.lastActive.get(x.registration) ?? "") || 0) - (Date.parse(i.lastActive.get(y.registration) ?? "") || 0) || compareRegistration(x.registration, y.registration));
    const a = pool[0];
    if (!a) continue;
    taken.add(a.registration);
    const session = i.sessions.find((x) => regKey(x.registration) === a.registration)!;
    const idleMs = i.lastActive.has(a.registration) ? i.now - Date.parse(i.lastActive.get(a.registration)!) : null;
    out.push({
      key: K3_RELAUNCH_KEY(u.flight), kind: "K3 RELAUNCH", aircraft: a.registration, airport: u.airport,
      reasons: [
        { code: "flight", detail: `${u.flight}: ${K3_FRESH_WHY} — 그 AIRPORT에 쓸 수 있는 ABSENT AIRCRAFT가 없음`, value: u.flight },
        { code: "between", detail: `${a.registration}: HOLDING·PARKED${idleMs !== null ? ` ${spanText(idleMs / MIN)}` : ""}, 열린 PR·STAND·FLIGHT 없음, LIMIT·FUEL hold 아님` },
        { code: "fits", detail: `${a.registration}: TYPE RATING ${a.ratings.join("·") || "없음"}, CREW가 ${u.type}를 날 수 있음` },
        { code: "session", detail: `BG ${session.id ?? "?"} — 멈춘 뒤 ${u.flight}의 K3 allow를 --settings로 받아 새로 띄움(대화는 남지만 캐시는 새로 시작)` },
      ],
    });
  }
  return out;
}

// 열린 LAUNCH·ENTRY 제안의 ACCOUNT가 hold 수준이 됐으면 그 사유(syncFleetPlan이 expire한다)
export function fuelExpiryOf(i: Pick<FleetInputs, "aircraft" | "fuelAccounts" | "now">, p: Pick<FleetProposal, "kind" | "aircraft"> & { account?: string }): string | null {
  // ACCOUNT CHANGE(ATC-148)의 옮길 ACCOUNT가 infoPct 이상이 됐으면 여유가 없다
  if (p.kind === "ACCOUNT CHANGE") {
    const t = p.account ? ((i.fuelAccounts ?? []).find((x) => x.account === p.account) ?? null) : null;
    return t && t.level !== "ok" ? `${fuelHoldText(t, i.now)} — 옮길 ACCOUNT에 여유가 없음` : null;
  }
  if (p.kind !== "LAUNCH" && p.kind !== "ENTRY" && p.kind !== "K3 RELAUNCH") return null;
  const f = p.kind === "ENTRY" && p.account ? ((i.fuelAccounts ?? []).find((x) => x.account === p.account) ?? null) : fuelOfPlan(i, p.kind, p.aircraft); // ENTRY가 ACCOUNT를 정했으면 그 ACCOUNT(ATC-147)
  return f?.level === "hold" ? `${fuelHoldText(f, i.now)} — ACCOUNT가 FUEL hold 수준` : null;
}

export function fleetPlanOf(i: FleetInputs): { candidates: FleetCandidate[]; demand: DemandRow[]; flaps: RepositionFlap[] } {
  const cfg = i.config;
  const out: FleetCandidate[] = [];
  const byReg = new Map(i.aircraft.map((a) => [a.registration, a]));
  const assigned = new Set(i.plan.assign.map((p) => regKey(p.aircraftName))); // 제안은 세션 이름 그대로(ATC-67)
  const unserved = i.plan.unserved ?? [];
  const background = i.sessions.filter(isBgFact);
  // 최근 LAUNCH·STOP이 minDwell 안이면 반대 제안을 하지 않는다
  const dwelling = (reg: string, op: "launch" | "stop") => {
    const d = i.dwell.get(reg);
    return d?.op === op && i.now - Date.parse(d.at) < cfg.minDwellMin * MIN ? d : null;
  };
  const airports = [...new Set([...i.plan.assign.map((p) => p.airport), ...unserved.map((u) => u.airport), ...i.aircraft.map((a) => a.base).filter(Boolean)])].sort() as string[];
  const demandAt = (code: string) => i.plan.assign.filter((p) => p.airport === code).length + unserved.filter((u) => u.airport === code).length;
  // 계획이 FLIGHT를 주지 않은 PARKED AIRCRAFT(AIRPORT의 예비)
  const parkedAt = new Map(airports.map((code) => [code, i.aircraft.filter((a) => a.base === code && isParked(a) && !assigned.has(a.registration)).length]));
  const launchPicks = new Set<string>();
  const demand: DemandRow[] = [];

  // ── LAUNCH·ENTRY: 받을 곳 없는 FLIGHT ──
  for (const code of airports) {
    const mine = unserved.filter((u) => u.airport === code);
    const row: DemandRow = { airport: code, served: i.plan.assign.filter((p) => p.airport === code).length, unserved: mine.map((u) => u.flight), parked: parkedAt.get(code) ?? 0, blocked: null };
    demand.push(row);
    if (!mine.length) continue;
    const runway = runwayOf(i.logbook, code, i.now);
    if (i.groundStops.has(code)) row.blocked = "GROUND STOP 중";
    else if (runway.bottleneck) row.blocked = `활주로가 병목 — ${runway.detail}`;
    else if (background.length >= i.maxLaunched) row.blocked = `백그라운드 세션 ${background.length}/${i.maxLaunched} — 상한`;
    if (row.blocked) continue;
    const common = (served: Unserved[]): PlanReason[] => [
      { code: "waiting", detail: `받을 AIRCRAFT가 없는 FLIGHT ${served.length}건: ${served.map((u) => u.flight).join(", ")}`, value: served.length },
      ...(served.some((u) => !u.labeled) ? [{ code: "unlabeled", detail: `분류 라벨 없음 — rating 확인 없이 셈: ${served.filter((u) => !u.labeled).map((u) => u.flight).join(", ")}` }] : []),
      { code: "reserve", detail: `${code} PARKED ${row.parked} · 예비 ${cfg.reserve}`, value: row.parked },
      { code: "runway", detail: runway.detail },
      { code: "cap", detail: `백그라운드 세션 ${background.length}/${i.maxLaunched}`, value: background.length },
    ];
    // 운항하지 않는 등록 AIRCRAFT 중 가장 많은 FLIGHT를 받을 수 있는 것. 같으면 최근 ARRIVED가 많은 쪽
    const idle = i.aircraft.filter((a) => a.status === "absent" && !a.restarting && !a.retired && !a.aog && a.base === code && !i.nordo.has(a.registration) && !dwelling(a.registration, "stop"));
    const fitting = idle
      .map((a) => ({ a, served: mine.filter((u) => canServe(a.registration, a.ratings, a.complement, u)), fuel: fuelOfPlan(i, "LAUNCH", a.registration) }))
      .filter((x) => x.served.length)
      .sort((x, y) => y.served.length - x.served.length || y.a.actuals.total - x.a.actuals.total || compareRegistration(x.a.registration, y.a.registration));
    // ACCOUNT가 FUEL hold 수준인 AIRCRAFT는 고르지 않는다
    const fits = fitting.filter((x) => x.fuel?.level !== "hold");
    const heldFits = fitting.filter((x) => x.fuel?.level === "hold");
    const heldText = [...new Map(heldFits.map((x) => [x.fuel!.group, x.fuel!])).values()]
      .map((f) => `${fuelHoldText(f, i.now)} — ${heldFits.filter((x) => x.fuel!.group === f.group).map((x) => x.a.registration).join(", ")}`)
      .join(" · ");
    if (fits.length) {
      const { a, served, fuel } = fits[0];
      launchPicks.add(a.registration);
      const types = [...new Set(served.map((u) => u.type))].join("·");
      out.push({
        key: `DEMAND|${code}`, kind: "LAUNCH", aircraft: a.registration, airport: code,
        reasons: [
          ...common(served),
          { code: "fits", detail: `${a.registration}: TYPE RATING ${a.ratings.join("·") || "없음"}, CREW가 ${types}를 날 수 있음` },
          ...(fuel?.level === "info" ? [fuelInfoReason(fuel, i.now)] : []),
          ...(heldFits.length ? [{ code: "fuel-held", detail: `맞지만 FUEL hold라 건너뜀: ${heldText}` }] : []),
        ],
      });
      continue;
    }
    // 맞는 AIRCRAFT가 모두 FUEL hold면 아무것도 제안하지 않는다(ENTRY로 넘기지 않는다, ENGINEERING 결정).
    // 새 세션은 이 기기에 로그인된 계정으로 열리는데 atc는 그 계정을 모른다 — 바닥난 계정에 새 세션을 띄우자는 제안이 될 수 있다.
    // ACCOUNT 등록부가 있으면(ATC-147) 새 세션이 열릴 ACCOUNT를 atc가 골라 주므로 이 경우는 없다: 아래 ENTRY가 다른 ACCOUNT를 고른다
    const entryAcct = entryAccountOf(i);
    if (heldFits.length && !entryAcct.registered) {
      row.blocked = `${heldText} — ENTRY도 제안 안 함(새 세션이 열릴 계정을 모름)`;
      continue;
    }
    // 맞는 등록 AIRCRAFT가 없으면 새로 들이기. tail로 정한 FLIGHT는 그 팀만 받으므로 새 AIRCRAFT로 풀리지 않는다
    if (!i.nextRegistration) {
      row.blocked = "맞는 AIRCRAFT가 없고 남은 등록번호도 없음";
      continue;
    }
    const open = mine.filter((u) => !u.tails.length);
    const configs = (Object.keys(CONFIGURATIONS) as ConfigurationId[])
      .map((id) => {
        const c = id === "general" ? i.defaults : CONFIGURATIONS[id];
        return { id, served: open.filter((u) => canServe(null, c.ratings, c.complement, u)) };
      })
      .filter((x) => x.served.length)
      .sort((x, y) => y.served.length - x.served.length);
    if (!configs.length) {
      row.blocked = open.length ? "맞는 등록 AIRCRAFT도 CONFIGURATION도 없음" : `tail로 정한 팀이 운항할 수 없음: ${mine.map((u) => `${u.flight}(tail:${u.tails.join(",")})`).join(", ")}`;
      continue;
    }
    // 평소의 ENTRY(맞는 등록 AIRCRAFT가 없음)는 새 AIRCRAFT를 default ACCOUNT로 센다. 등록부가 있으면 고른 ACCOUNT(ATC-147)
    if (entryAcct.registered && !entryAcct.account) {
      row.blocked = entryAcct.blocked;
      continue;
    }
    const entryFuel = entryAcct.registered ? ((i.fuelAccounts ?? []).find((x) => x.account === entryAcct.account) ?? null) : fuelOfPlan(i, "ENTRY", i.nextRegistration);
    if (entryFuel?.level === "hold") {
      row.blocked = `${fuelHoldText(entryFuel, i.now)} — 새 AIRCRAFT(ENTRY)가 들 ACCOUNT`;
      continue;
    }
    const pick = configs[0];
    const c = pick.id === "general" ? i.defaults : CONFIGURATIONS[pick.id];
    out.push({
      key: `DEMAND|${code}`, kind: "ENTRY", aircraft: i.nextRegistration, airport: code, configuration: pick.id,
      ...(entryAcct.account ? { account: entryAcct.account } : {}),
      reasons: [
        ...common(pick.served),
        { code: "no-fit", detail: `${code}에 운항하지 않는 등록 AIRCRAFT 중 맞는 것이 없음` },
        { code: "fits", detail: `${pick.id} CONFIGURATION: TYPE RATING ${c.ratings.join("·")}, CREW ${c.complement.map((m) => m.position).join("·")}` },
        ...(entryAcct.account ? [{ code: "account", detail: `새 AIRCRAFT는 ACCOUNT ${entryAcct.account}에서(등록·로그인됨, hold 아래에서 사용이 가장 낮음${entryAcct.use !== null ? `: ${Math.round(entryAcct.use)}%` : ", FUEL 기록 없음"})`, value: entryAcct.account }] : []),
        ...(entryFuel?.level === "info" ? [fuelInfoReason(entryFuel, i.now)] : []),
      ],
    });
  }

  // ── STOP·RESTART: 백그라운드 세션 ──
  const idleFor = (reg: string) => {
    const at = i.lastActive.get(reg);
    return at ? i.now - Date.parse(at) : null;
  };
  const stopOrder = background
    .map((x) => ({ x, a: byReg.get(regKey(x.registration)), idle: idleFor(regKey(x.registration)) }))
    .sort((p, q) => (q.idle ?? 0) - (p.idle ?? 0));
  for (const { x, a, idle } of stopOrder) {
    const reg = regKey(x.registration);
    if (!a) continue;
    const bg = `BG ${x.id ?? "?"} — 멈춰도 대화는 남아 다시 이어짐`;
    if (a.retired) {
      out.push({ key: `STOP|${reg}`, kind: "STOP", aircraft: reg, airport: a.base, reasons: [{ code: "retired", detail: "RETIRED인데 세션이 떠 있음" }, { code: "session", detail: bg }] });
      continue;
    }
    if (a.status !== "idle" || a.flying.length || assigned.has(reg) || dwelling(reg, "launch")) continue;
    const code = a.base;
    const parked = code ? (parkedAt.get(code) ?? 0) : 0;
    const after = isParked(a) ? parked - 1 : parked; // AOG인 AIRCRAFT는 예비에 들지 않는다
    const needReserve = code && demandAt(code) > 0 ? cfg.reserve : 0;
    const restartAge = x.startedAt !== null ? i.now - x.startedAt : null;
    if (idle !== null && idle >= cfg.idleHours * HOUR && after >= needReserve) {
      if (code) parkedAt.set(code, after);
      out.push({
        key: `STOP|${reg}`, kind: "STOP", aircraft: reg, airport: code,
        reasons: [
          { code: "idle", detail: `STAND·FLIGHT·활동 없이 ${spanText(idle / MIN)} (기준 ${cfg.idleHours}h)`, value: Math.round(idle / HOUR) },
          { code: "reserve", detail: needReserve ? `${code} PARKED ${parked} → ${after} · 예비 ${needReserve}` : `${code ?? "AIRPORT 없음"}에 수요 없음 — 예비 불필요` },
          { code: "session", detail: bg },
        ],
      });
      continue;
    }
    if (restartAge !== null && restartAge >= cfg.restartDays * DAY) {
      out.push({
        key: `RESTART|${reg}`, kind: "RESTART", aircraft: reg, airport: code,
        reasons: [
          { code: "age", detail: `세션이 ${spanText(restartAge / MIN)} 됨 (기준 ${cfg.restartDays}일) — PARKED일 때 새 CREW BRIEFING으로`, value: Math.round(restartAge / DAY) },
          { code: "session", detail: bg },
        ],
      });
    }
  }

  // ── RESTART: AIRCRAFT health(ATC-48). CONTEXT(맥락이 넘쳐 이어갈 수 없음), 오래가는 HUNG(ALERT) ──
  for (const a of i.aircraft) {
    const h = a.health;
    if (a.retired || a.aog || !h || !(h.code === "CONTEXT" || (h.code === "HUNG" && h.level === "alert"))) continue;
    const session = i.sessions.find((x) => regKey(x.registration) === a.registration);
    const reasons: PlanReason[] = [
      { code: h.code.toLowerCase(), detail: `${h.code} — ${h.detail} (since ${h.since.slice(0, 16).replace("T", " ")}Z)`, value: h.since },
      { code: "handoff", detail: a.flying.length ? `STAND·PR(${a.flying.join(", ")})은 새 세션에 HANDOFF — ${h.next}` : h.next },
      {
        code: "session",
        detail: isBgFact(session) ? `BG ${session!.id ?? "?"} — 멈추고 새 CREW BRIEFING으로 다시 띄움` : `승인 실행은 안 됨 — ${manualStepsOf(originOfFact(session), a.registration, "restart")}`,
      },
    ];
    const key = `RESTART|${a.registration}`;
    const same = out.find((c) => c.key === key);
    if (same) same.reasons.unshift(...reasons.slice(0, 2));
    else out.push({ key, kind: "RESTART", aircraft: a.registration, airport: a.base, reasons });
  }

  // ── REFRESH(ATC-69): FLIGHT를 마치고 쉬는 AIRCRAFT의 대화가 크면 새로 시작 ──
  for (const a of i.aircraft) {
    const c = i.context?.get(a.registration);
    if (!c) continue;
    const session = i.sessions.find((x) => x.registration.toUpperCase() === a.registration);
    const why = refreshOf(a, c, session ?? null, i, assigned.has(a.registration), dwelling(a.registration, "launch") !== null);
    if (!why) continue;
    const key = `RESTART|${a.registration}`;
    const same = out.find((x) => x.key === key);
    // 같은 AIRCRAFT에 RESTART가 이미 있으면 같은 실행이다 — 사유만 붙인다
    if (same) same.reasons.push(...why.filter((r) => r.code === "context" || r.code === "saving"));
    else out.push({ key: `REFRESH|${a.registration}`, kind: "REFRESH", aircraft: a.registration, airport: a.base, reasons: why });
  }

  // ── ACCOUNT CHANGE(ATC-148): FLIGHT 사이의 AIRCRAFT를 여유 있는 ACCOUNT로 ──
  const moving = new Set<string>();
  for (const a of i.aircraft) {
    const session = i.sessions.find((x) => regKey(x.registration) === a.registration) ?? null;
    const c = accountChangeOf(a, session, i, assigned.has(a.registration), dwelling(a.registration, "launch") !== null);
    if (c) {
      out.push(c);
      moving.add(a.registration);
    }
  }

  // ── REPOSITION(ATC-179): FLIGHT가 기다리는데 AIRCRAFT가 없는 AIRPORT로 쉬는 AIRCRAFT를 옮긴다. ACCOUNT CHANGE 중인 AIRCRAFT는 뺀다 ──
  const rep = repositionOf(i, assigned, moving);
  out.push(...rep.candidates);
  for (const c of rep.candidates) if (c.aircraft) moving.add(c.aircraft);

  // ── K3 RELAUNCH(ATC-509): 스위치 k3Relaunch가 on일 때만. ACCOUNT CHANGE·REPOSITION이 쥔 AIRCRAFT는 뺀다 ──
  out.push(...k3RelaunchOf(i, assigned, moving));

  // ── AOG: NORDO, 최근 LOS, AIRCRAFT health의 MODEL·주간 LIMIT(ATC-48) ──
  for (const a of i.aircraft) {
    if (a.retired || a.aog) continue;
    const reasons: PlanReason[] = [];
    if (i.nordo.has(a.registration)) reasons.push({ code: "nordo", detail: "NORDO — 세션이 응답하지 않음" });
    const los = i.los.get(a.registration);
    if (los) reasons.push({ code: "los", detail: `최근 24시간 LOS(${los.slice(0, 16).replace("T", " ")}Z)` });
    const h = a.health;
    if (h?.code === "MODEL") reasons.push({ code: "model", detail: `MODEL — ${h.detail}. ${h.next}` });
    const weekly = h?.code === "LIMIT" && h.weekly && !moving.has(a.registration) ? h : null; // 옮길 ACCOUNT가 있으면 주간 LIMIT만으로 AOG를 제안하지 않는다(ATC-148)
    if (weekly) reasons.push({ code: "limit", detail: `주간 LIMIT — ${weekly.resetsAt ? `reset ${weekly.resetsAt.slice(0, 16).replace("T", " ")}Z까지` : "reset 시각 모름"}`, value: weekly.resetsAt ?? null });
    if (!reasons.length) continue;
    // 주간 LIMIT만이면 reset 날까지, 다른 사유가 있으면 24시간(reset이 더 늦으면 그날)
    const day = new Date(i.now + DAY).toISOString().slice(0, 10);
    const resetDay = weekly?.resetsAt?.slice(0, 10) ?? null;
    const onlyLimit = reasons.every((r) => r.code === "limit");
    const until = resetDay && (onlyLimit || resetDay > day) ? resetDay : day;
    const why = until === resetDay ? "주간 LIMIT reset 날" : "24시간";
    out.push({ key: `AOG|${a.registration}`, kind: "AOG", aircraft: a.registration, airport: a.base, reasons: [...reasons, { code: "until", detail: `해제 기한 ${until}(${why})`, value: until }] });
  }

  // ── RETURN: FLEET PLAN이 건 AOG의 해제 기한(그날 끝)이 지남(8.7) ──
  for (const a of i.aircraft) {
    if (a.retired || !a.aog?.until || !FLEET_PLAN_AOG.test(a.aog.reason)) continue;
    if (i.now < Date.parse(a.aog.until) + DAY) continue;
    const cause = i.nordo.has(a.registration)
      ? "아직 NORDO — 풀면 LAUNCH 후보로 다시 나온다"
      : i.los.has(a.registration)
        ? "최근 24시간 LOS가 있음"
        : a.status === "absent"
          ? "세션 없음 — 풀면 LAUNCH 후보로 다시 나온다"
          : "원인이 풀림 — 살아 있는 세션, 24시간 LOS 없음";
    out.push({
      key: `RETURN|${a.registration}`, kind: "RETURN", aircraft: a.registration, airport: a.base,
      reasons: [{ code: "expired", detail: `AOG 해제 기한 ${a.aog.until} 지남 (${a.aog.reason})`, value: a.aog.until }, { code: "cause", detail: cause }],
    });
  }

  // ── RETIRE: 오래 ARRIVED 없음 ──
  for (const a of i.aircraft) {
    if (a.retired || a.status === "busy" || a.flying.length || i.openPrs.has(a.registration) || launchPicks.has(a.registration)) continue;
    if (a.enteredAt && i.now - Date.parse(a.enteredAt) < cfg.retireDays * DAY) continue;
    const arrived = i.logbook.filter((e) => e.aircraft === a.registration && i.now - Date.parse(e.arrivedAt) < cfg.retireDays * DAY).length;
    if (arrived) continue;
    const code = a.base;
    if (code && isParked(a) && demandAt(code) > 0 && (parkedAt.get(code) ?? 0) - 1 < cfg.reserve) continue;
    const last = i.logbook.filter((e) => e.aircraft === a.registration).map((e) => e.arrivedAt).sort().at(-1);
    out.push({
      key: `RETIRE|${a.registration}`, kind: "RETIRE", aircraft: a.registration, airport: code,
      reasons: [
        { code: "no-arrival", detail: `${cfg.retireDays}일 동안 ARRIVED 없음${last ? ` (마지막 ${last.slice(0, 10)})` : " (LOGBOOK에 없음)"}`, value: 0 },
        { code: "no-pr", detail: "열린 PR·STAND 없음" },
      ],
    });
  }
  return { candidates: out, demand, flaps: rep.flaps };
}

// 대화가 REFRESH 기준(refreshTokens 또는 창의 refreshPct)을 넘었나. FRESH START(ATC-73)도 같은 기준을 쓴다(순수)
// 창을 짐작만 했으면(200k 기본) 몫은 사실이 아니다 — 토큰 기준만
export function overRefreshThreshold(c: Pick<ContextSize, "contextTokens" | "windowSource" | "pct">, cfg: Pick<FleetPlanConfig, "refreshTokens" | "refreshPct">): boolean {
  if (c.contextTokens === null) return false;
  return c.contextTokens >= cfg.refreshTokens || (c.windowSource !== "default" && c.pct !== null && c.pct >= cfg.refreshPct);
}

// REFRESH를 낼 때의 사유. 조건이 맞지 않으면 null(순수).
// PARKED나 HOLDING(쉬는 세션)이고, 쥔 STAND가 모두 ARRIVED한 FLIGHT 것이고, 열린 PR이 없고, 이번 계획에서 FLIGHT를 받지 않고,
// 최근 LAUNCH가 minDwell 안이 아니고, 대화가 refreshTokens나 창의 refreshPct를 넘으면
export function refreshOf(
  a: AircraftView,
  c: ContextSize,
  session: SessionFact | null,
  i: Pick<FleetInputs, "config" | "logbook" | "openPrs" | "prices" | "now">,
  assigned = false,
  launchedRecently = false,
): PlanReason[] | null {
  const cfg = i.config;
  if (a.retired || a.aog || a.status !== "idle" || assigned || launchedRecently || i.openPrs.has(a.registration)) return null;
  if (c.contextTokens === null) return null;
  const arrived = new Set(i.logbook.filter((e) => e.aircraft === a.registration && e.flight).map((e) => e.flight));
  const open = a.flying.filter((k) => !arrived.has(k));
  if (open.length) return null;
  if (!overRefreshThreshold(c, cfg)) return null;
  const saving = refreshSavingOf(c, i.prices ?? null);
  const last = i.logbook.filter((e) => e.aircraft === a.registration).sort((x, y) => x.arrivedAt.localeCompare(y.arrivedAt)).at(-1);
  const threshold = `기준 ${tokensShort(cfg.refreshTokens)}${c.windowSource === "default" ? "" : ` 또는 ${Math.round(cfg.refreshPct * 100)}%`}`;
  const windowNote = c.windowSource === "observed" ? ", 창은 본 크기로 짐작" : c.windowSource === "default" ? ", 창은 기본값" : "";
  const manual = !isBgFact(session);
  return [
    { code: "context", detail: `${contextLabel(c).replace(/^context /, "")} — ${c.model}, ${c.at.slice(0, 16).replace("T", " ")}Z (${threshold}${windowNote})`, value: c.contextTokens },
    { code: "saving", detail: savingText(saving, c.tier), value: saving?.coldWake ?? null },
    {
      code: "arrived",
      detail: last ? `마지막 FLIGHT ${last.flight ?? "AD HOC"} ARRIVED ${last.arrivedAt.slice(0, 16).replace("T", " ")}Z${a.flying.length ? ` · 남은 STAND ${a.flying.join(", ")}은 ARRIVED` : ""}` : "열린 FLIGHT 없음",
    },
    {
      code: "session",
      detail: manual
        ? manualStepsOf(originOfFact(session), a.registration, "refresh")
        : `BG ${session?.id ?? "?"} — 멈추고 새 CREW BRIEFING으로 다시 띄움`,
      value: manual ? "interactive" : "background", // isManual이 본다(저장된 제안과 같은 값). 출처는 detail에
    },
  ];
}

function savingText(s: RefreshSaving | null, tier: "5m" | "1h") {
  if (!s) return "아낌 — 크기를 모름";
  const usd = (v: number) => `$${v.toFixed(2)}`;
  const money = s.coldWake === null ? " (가격표에 없는 모델 — 값 없음)" : ` ≈ ${usd(s.coldWake)} 캐시 쓰기(${tier})를 다음 cold wake에 아낌 · 한 턴마다 읽기 ${usd(s.perTurn ?? 0)}`;
  return `새로 시작하면 ${tokensShort(s.tokens)}${money}`;
}

// 승인 운용에서 사람이 하는 제안(실행할 단계가 없다): 데스크톱·터미널 세션의 REFRESH
export const isManual = (p: Pick<FleetProposal, "kind" | "reasons">) => p.kind === "REFRESH" && p.reasons.some((r) => r.code === "session" && r.value === "interactive");

// ── 지속 조건: 두 주기, LAUNCH·ENTRY는 waitMin ──

// pending: 열쇠 → 처음 본 시각. 이번 주기에 없는 열쇠는 지운다(조건이 끊기면 처음부터)
export function persistOf(pending: Record<string, string>, candidates: FleetCandidate[], now: number, cfg: FleetPlanConfig) {
  const next: Record<string, string> = {};
  const ready: FleetCandidate[] = [];
  for (const c of candidates) {
    const first = pending[c.key] ?? new Date(now).toISOString();
    next[c.key] = first;
    const held = now - Date.parse(first);
    const demandKind = c.kind === "LAUNCH" || c.kind === "ENTRY";
    if (demandKind ? held >= cfg.waitMin * MIN : c.key in pending) ready.push(c);
  }
  return { pending: next, ready };
}

// ── 기록(fleet-plan.jsonl, 추가만) ──

export type FleetPlanOp =
  | { op: "create"; id: string; key: string; kind: FleetPlanKind; aircraft: string | null; airport: string | null; from?: string; configuration?: ConfigurationId; account?: string; reasons: PlanReason[]; at: string }
  | { op: "verdict"; id: string; verdict: "agree" | "disagree"; by: string; reason?: string; at: string }
  | { op: "expire"; id: string; reason?: string; at: string }
  | { op: "supersede"; id: string; by: string; at: string }
  | { op: "approve"; id: string; by: string; options: ApproveOptions; at: string } // 승인 운용(8.7): 곧바로 실행
  | { op: "executed"; id: string; ok: boolean; steps: StepResult[]; at: string };

// executing: 승인한 요청이 실행하는 동안. executed·failed: 실행 결과(승인은 게이트에서 동의로 센다)
export type FleetProposalStatus = "open" | "agreed" | "disagreed" | "expired" | "superseded" | "executing" | "executed" | "failed";
export interface ApproveOptions {
  permissionMode?: PermissionMode;
  model?: string | null;
  until?: string | null;
  stopSession?: boolean;
}
export type ExecStep =
  | { action: "entry"; registration: string; configuration: ConfigurationId; base: string; account?: string }
  | { action: "launch"; registration: string; permissionMode: PermissionMode; model: string | null; lastModel?: string | null; account?: string; flight?: string; proposal?: string } // flight·proposal: K3 RELAUNCH(ATC-509) — 그 FLIGHT의 K3 entries로 띄우고 카드 id를 기록에 남긴다. model: 양식에 적은 것만. lastModel: 마지막 LAUNCH의 모델(설정이 하나도 안 맞을 때만 쓴다, ATC-279)
  | { action: "stop"; registration: string; proposal?: string }
  | { action: "base"; registration: string; base: string } // REPOSITION(ATC-179): fleet.json의 base를 바꾼다
  | { action: "aog"; registration: string; reason: string; until: string | null }
  | { action: "return"; registration: string }
  | { action: "retire"; registration: string; reason: string };
export interface StepResult {
  action: ExecStep["action"];
  registration: string;
  ok: boolean;
  jobId?: string;
  error?: string;
}
export interface FleetProposal {
  id: string;
  key: string;
  kind: FleetPlanKind;
  aircraft: string | null;
  airport: string | null;
  from?: string; // REPOSITION(ATC-179): 옛 base
  configuration?: ConfigurationId;
  account?: string; // ENTRY(ATC-147)
  reasons: PlanReason[];
  at: string;
  status: FleetProposalStatus;
  closedAt: string | null;
  verdict: { verdict: "agree" | "disagree"; by: string; reason?: string; at: string } | null;
  closeReason: string | null; // expire 사유, supersede면 이어 쓴 id
  approval: { by: string; at: string; options: ApproveOptions } | null;
  execution: { at: string; ok: boolean; steps: StepResult[] } | null;
}

export function foldFleetPlan(ops: FleetPlanOp[]): FleetProposal[] {
  const byId = new Map<string, FleetProposal>();
  for (const o of ops) {
    if (o.op === "create") {
      if (byId.has(o.id)) continue;
      const { op: _op, ...rest } = o;
      byId.set(o.id, { ...rest, status: "open", closedAt: null, verdict: null, closeReason: null, approval: null, execution: null });
      continue;
    }
    const p = byId.get(o.id);
    if (!p) continue;
    // 실행 결과는 실행 중인 제안에만. 나머지는 열린 제안에만(닫힌 제안은 다시 바뀌지 않는다)
    if (o.op === "executed") {
      if (p.status !== "executing") continue;
      p.status = o.ok ? "executed" : "failed";
      p.execution = { at: o.at, ok: o.ok, steps: o.steps };
      p.closedAt = o.at;
      continue;
    }
    if (p.status !== "open") continue;
    if (o.op === "approve") {
      p.status = "executing";
      p.approval = { by: o.by, at: o.at, options: o.options };
      continue;
    }
    p.closedAt = o.at;
    if (o.op === "verdict") {
      p.status = o.verdict === "agree" ? "agreed" : "disagreed";
      p.verdict = { verdict: o.verdict, by: o.by, ...(o.reason ? { reason: o.reason } : {}), at: o.at };
    } else if (o.op === "expire") {
      p.status = "expired";
      p.closeReason = o.reason ?? null;
    } else if (o.op === "supersede") {
      p.status = "superseded";
      p.closeReason = o.by;
    }
  }
  return [...byId.values()];
}

export const nextFleetPlanId = (all: Pick<FleetProposal, "id">[]) =>
  `F-${String(all.reduce((n, p) => Math.max(n, Number(p.id.slice(2)) || 0), 0) + 1).padStart(4, "0")}`;

// 판정한 제안과 같은 짝(열쇠·종류·AIRCRAFT)은 24시간 다시 내지 않는다
export const COOLDOWN_MS = DAY;
// 판정한 시각: 동의·반대, 또는 실행을 끝낸 승인. 실패한 실행은 쉬지 않는다(SUPERVISOR 결정 2026-09-28)
export const judgedAtOf = (p: Pick<FleetProposal, "verdict" | "status" | "execution">) =>
  p.verdict?.at ?? (p.status === "executed" ? (p.execution?.at ?? null) : null);
const OPPOSITE: Partial<Record<FleetPlanKind, FleetPlanKind[]>> = { LAUNCH: ["STOP"], STOP: ["LAUNCH"], RESTART: ["LAUNCH"], REFRESH: ["LAUNCH", "RESTART"] };

// 한 주기의 기록 줄: 조건이 풀린 열린 제안은 expire, 같은 열쇠의 다른 제안이 되면 supersede하고 새로,
// 지속 조건을 채운 후보는 create. 판정 뒤 24시간과 minDwell 안의 반대 제안은 내지 않는다
// fuelExpiry(ATC-63): 열린 LAUNCH·ENTRY의 ACCOUNT가 FUEL hold 수준이 되면 같은 후보가 남아 있어도 그 사유로 expire한다
export function syncFleetPlan(
  all: FleetProposal[],
  candidates: FleetCandidate[],
  ready: FleetCandidate[],
  now: number,
  cfg: FleetPlanConfig,
  fuelExpiry: (p: FleetProposal) => string | null = () => null,
): FleetPlanOp[] {
  const at = new Date(now).toISOString();
  const ops: FleetPlanOp[] = [];
  const current = new Map(candidates.map((c) => [c.key, c]));
  const fuelHeld = new Map(all.filter((p) => p.status === "open").map((p) => [p.id, fuelExpiry(p)] as const).filter(([, why]) => why !== null));
  const open = all.filter((p) => p.status === "open");
  const openByKey = new Map(open.filter((p) => !fuelHeld.has(p.id)).map((p) => [p.key, p]));
  const created: FleetProposal[] = [];
  const same = (p: Pick<FleetProposal, "kind" | "aircraft"> & { account?: string }, c: FleetCandidate) => p.kind === c.kind && p.aircraft === c.aircraft && (c.kind !== "ACCOUNT CHANGE" || p.account === c.account); // 옮길 ACCOUNT가 바뀌면 다른 제안(ATC-148)
  for (const p of open) {
    const c = current.get(p.key);
    if (fuelHeld.has(p.id)) ops.push({ op: "expire", id: p.id, reason: fuelHeld.get(p.id)!, at });
    else if (!c) ops.push({ op: "expire", id: p.id, reason: "조건이 풀림", at });
  }
  const busy = new Set(all.filter((p) => p.status === "executing").map((p) => p.key));
  for (const c of ready) {
    if (busy.has(c.key)) continue;
    const o = openByKey.get(c.key);
    if (o && same(o, c)) continue;
    const recentDecided = all.some((p) => {
      const at = judgedAtOf(p);
      return at !== null && p.key === c.key && same(p, c) && now - Date.parse(at) < COOLDOWN_MS;
    });
    if (recentDecided) continue;
    const opposite = (OPPOSITE[c.kind] ?? []).some((k) =>
      [...all, ...created].some((p) => p.kind === k && p.aircraft === c.aircraft && now - Date.parse(p.at) < cfg.minDwellMin * MIN),
    );
    if (opposite) continue;
    const id = nextFleetPlanId([...all, ...created]);
    if (o) ops.push({ op: "supersede", id: o.id, by: id, at });
    const line: FleetPlanOp = { op: "create", id, key: c.key, kind: c.kind, aircraft: c.aircraft, airport: c.airport, ...(c.from ? { from: c.from } : {}), ...(c.configuration ? { configuration: c.configuration } : {}), ...(c.account ? { account: c.account } : {}), reasons: c.reasons, at };
    ops.push(line);
    created.push({ ...c, id, at, status: "open", closedAt: null, verdict: null, closeReason: null, approval: null, execution: null });
  }
  return ops;
}

// 그림자 게이트(ATC-273): FLEET PLAN만 5건·합의율 80%. DISPATCH·SCHEDULE은 proposals.ts GATE(20건, 80%)로 그대로다.
// 제안이 드물어(2026-09-28부터 7건) 20건을 채우려면 너무 오래 걸린다. 종류마다 건수도 보인다
export const FLEET_PLAN_GATE = { decided: 5, agreement: 0.8 } as const;
// 승인 운용에서 승인(실행 중·실행됨·실패)은 동의로 센다
const AGREED: FleetProposalStatus[] = ["agreed", "executing", "executed", "failed"];
export function fleetPlanGateOf(all: FleetProposal[]) {
  const decided = all.filter((p) => AGREED.includes(p.status) || p.status === "disagreed");
  const agreed = decided.filter((p) => AGREED.includes(p.status)).length;
  const agreement = decided.length ? agreed / decided.length : null;
  const byKind = Object.fromEntries(
    FLEET_PLAN_KINDS.map((k) => {
      const mine = decided.filter((p) => p.kind === k);
      return [k, { decided: mine.length, agreed: mine.filter((p) => AGREED.includes(p.status)).length }];
    }),
  ) as Record<FleetPlanKind, { decided: number; agreed: number }>;
  return { decided: decided.length, agreed, agreement, target: FLEET_PLAN_GATE, ready: decided.length >= FLEET_PLAN_GATE.decided && agreement !== null && agreement >= FLEET_PLAN_GATE.agreement, byKind };
}

// ── 승인 운용(8.7): 승인하면 실행할 단계 ──

export class PlanError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

// 최근 주기가 이만큼 지났으면 승인하지 않는다(DISPATCH 주기 5분의 두 배)
export const STALE_MS = 10 * MIN;

export interface ExecContext {
  mode: "shadow" | "approval"; // REPOSITION은 자기 스위치(approval·auto면 approval)
  latest: FleetCandidate[]; // 최근 주기의 후보
  ranAt: string | null;
  aircraft: AircraftView[];
  sessions: SessionFact[]; // claude agents(지금)
  taken: string[]; // 등록부와 세션에 이미 있는 이름
  lastLaunch: Map<string, { permissionMode?: string; model?: string }>; // AIRCRAFT의 마지막 LAUNCH(FLIGHT RECORDER)
  maxLaunched?: number;
  airports?: { code: string; repo: string | null }[]; // REPOSITION: 옮길 AIRPORT의 저장소를 확인한다
  now: number;
}

// 최근 주기가 같은 AIRCRAFT에 같은 종류를 여전히 내나
export function isStale(p: Pick<FleetProposal, "key" | "kind" | "aircraft"> & { account?: string }, latest: FleetCandidate[], ranAt: string | null, now: number): boolean {
  if (!ranAt || now - Date.parse(ranAt) > STALE_MS) return true;
  return !latest.some((c) => c.key === p.key && c.kind === p.kind && c.aircraft === p.aircraft && (p.kind !== "ACCOUNT CHANGE" || c.account === p.account));
}

// 승인 양식 값을 검사해 단계로 만든다(순수). 8.5의 거절 조건 중 지금 알 수 있는 것을 먼저 본다 —
// 두 단계짜리(ENTRY·RESTART)가 첫 단계만 하고 멈추는 일을 줄이려고. 실행할 때 8.5 코드가 다시 본다
export function executionOf(p: FleetProposal, input: Record<string, unknown>, ctx: ExecContext): { steps: ExecStep[]; options: ApproveOptions } {
  if (ctx.mode !== "approval") throw new PlanError("그림자 운용 중 — 승인 운용을 켜야 실행한다");
  if (p.status !== "open") throw new PlanError(`${p.id}는 이미 닫힘(${p.status})`);
  if (isStale(p, ctx.latest, ctx.ranAt, ctx.now)) throw new PlanError("조건이 바뀜 — 최근 주기가 이 제안을 더는 내지 않는다. 다음 주기를 기다린다");
  const reg = p.aircraft ?? "";
  const a = ctx.aircraft.find((x) => x.registration === reg);
  const bg = ctx.sessions.filter(isBgFact);
  const session = ctx.sessions.find((x) => regKey(x.registration) === regKey(reg));
  const max = ctx.maxLaunched ?? MAX_LAUNCHED;
  const launchOptions = (fallback?: { permissionMode?: string; model?: string }) => {
    const mode = (input.permissionMode ?? fallback?.permissionMode ?? "auto") as PermissionMode;
    if (!PERMISSION_MODES.includes(mode)) throw new PlanError(`permission mode는 ${PERMISSION_MODES.join(" | ")}`, 400);
    // 모델(ATC-279): 양식에 적은 것만 model이다(우선). 비워 두면 launchAircraft가 AIRCRAFT > AIRPORT > 기본 설정을 먼저 보고, 마지막 LAUNCH의 모델(lastModel)은 그다음이다
    const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : null;
    if (model && !/^[\w.:[\]-]+$/.test(model)) throw new PlanError(`모델 이름이 이상함: ${model}`, 400);
    const lastModel = fallback?.model?.trim() || null;
    return { permissionMode: mode, model, ...(lastModel ? { lastModel } : {}) };
  };
  const needAircraft = () => {
    if (!a) throw new PlanError(`FLEET에 없음: ${reg}`, 404);
    return a;
  };
  const needBase = (x: AircraftView) => {
    if (!x.base) throw new PlanError(`${reg}의 base AIRPORT가 없음`);
    return x.base;
  };
  const needBackground = () => {
    if (!session) throw new PlanError(`${reg} 세션이 떠 있지 않음`);
    if (!isBgFact(session)) throw new PlanError(manualStepsOf(originOfFact(session), reg, p.kind === "STOP" ? "stop" : p.kind === "REFRESH" ? "refresh" : "restart"));
  };
  const capRoom = () => {
    if (bg.length >= max) throw new PlanError(`백그라운드 세션 ${bg.length}개 — 상한 ${max}(ATC_MAX_LAUNCHED)`);
  };
  switch (p.kind) {
    case "LAUNCH": {
      const x = needAircraft();
      if (x.retired) throw new PlanError(`${reg}는 RETIRED`);
      needBase(x);
      if (session) throw new PlanError(`${reg} 세션이 이미 떠 있음`);
      capRoom();
      const o = launchOptions();
      return { steps: [{ action: "launch", registration: reg, ...o }], options: o };
    }
    case "ENTRY": {
      if (ctx.taken.some((n) => regKey(n) === regKey(reg))) throw new PlanError(`${reg}는 이미 쓰는 등록번호 — 다음 주기가 새 번호로 제안한다`);
      if (!p.configuration || !p.airport) throw new PlanError("ENTRY에 CONFIGURATION·AIRPORT가 없음");
      capRoom();
      const o = launchOptions();
      return {
        steps: [
          { action: "entry", registration: reg, configuration: p.configuration, base: p.airport, ...(p.account ? { account: p.account } : {}) },
          { action: "launch", registration: reg, ...o },
        ],
        options: o,
      };
    }
    case "STOP":
      needBackground();
      return { steps: [{ action: "stop", registration: reg }], options: {} };
    case "REFRESH":
      // 데스크톱·터미널 세션은 atc가 다시 띄우지 않는다: SUPERVISOR가 /clear하고 CREW BRIEFING을 붙여 넣은 뒤 "했음"(동의)
      if (isManual(p)) throw new PlanError(`${reg}는 백그라운드 세션이 아님 — 그 세션에서 /clear 후 CREW BRIEFING을 붙여 넣고 "했음"을 누른다`);
    // falls through: 백그라운드 세션은 RESTART와 같은 단계(8.5 STOP → LAUNCH)
    case "RESTART": {
      const x = needAircraft();
      if (x.retired) throw new PlanError(`${reg}는 RETIRED`);
      needBase(x);
      needBackground();
      const o = launchOptions(ctx.lastLaunch.get(reg));
      return { steps: [{ action: "stop", registration: reg }, { action: "launch", registration: reg, ...o }], options: o };
    }
    case "ACCOUNT CHANGE": {
      // 실행할 때 다시 본다: 살아 있는 FLIGHT는 옮기지 않는다(최근 주기가 이미 확인했지만 승인까지 시간이 걸렸을 수 있다)
      const x = needAircraft();
      if (x.retired) throw new PlanError(`${reg}는 RETIRED`);
      if (!p.account) throw new PlanError("ACCOUNT CHANGE에 옮길 ACCOUNT가 없음");
      needBase(x);
      needBackground();
      if (x.status !== "idle" || x.flying.length || x.flights.length) throw new PlanError(`${reg}가 FLIGHT 중(${[...x.flying, ...x.flights.map((f) => f.key)].join(", ") || x.status}) — 살아 있는 FLIGHT는 옮기지 않는다`);
      const o = launchOptions(ctx.lastLaunch.get(reg));
      return { steps: [{ action: "stop", registration: reg }, { action: "launch", registration: reg, ...o, account: p.account }], options: o };
    }
    case "REPOSITION": {
      // 실행할 때 다시 본다(승인까지 시간이 걸렸을 수 있다): 살아 있는 FLIGHT는 옮기지 않는다. 목표 저장소는 STOP 전에 확인한다
      const x = needAircraft();
      if (x.retired) throw new PlanError(`${reg}는 RETIRED`);
      if (x.aog) throw new PlanError(`${reg}는 AOG`);
      if (!p.airport) throw new PlanError("REPOSITION에 옮길 AIRPORT가 없음");
      if (x.base === p.airport) throw new PlanError(`${reg}는 이미 ${p.airport} 소속`);
      needBackground();
      if (x.status !== "idle" || x.flying.length || x.flights.length) throw new PlanError(`${reg}가 FLIGHT 중(${[...x.flying, ...x.flights.map((f) => f.key)].join(", ") || x.status}) — 살아 있는 FLIGHT는 옮기지 않는다`);
      if (ctx.airports && !ctx.airports.find((a) => a.code === p.airport)?.repo) throw new PlanError(`${p.airport}의 저장소를 모름 — ${reg}는 멈추지 않았다`);
      const o = launchOptions(ctx.lastLaunch.get(reg));
      return { steps: [{ action: "stop", registration: reg }, { action: "base", registration: reg, base: p.airport }, { action: "launch", registration: reg, ...o }], options: o };
    }
    case "K3 RELAUNCH": {
      // 실행할 때 다시 본다(승인까지 시간이 걸렸을 수 있다): 쉬는 AIRCRAFT만 멈춘다. STOP 전에 거절해 STOP만 되고 LAUNCH가 안 되는 일을 줄인다
      const x = needAircraft();
      const flight = String(p.reasons.find((r) => r.code === "flight")?.value ?? "");
      if (!flight) throw new PlanError("K3 RELAUNCH에 FLIGHT가 없음");
      if (x.retired) throw new PlanError(`${reg}는 RETIRED`);
      needBase(x);
      needBackground();
      if (x.status !== "idle" || x.flying.length || x.flights.length) throw new PlanError(`${reg}가 FLIGHT 중(${[...x.flying, ...x.flights.map((f) => f.key)].join(", ") || x.status}) — 살아 있는 FLIGHT는 멈추지 않는다`);
      const o = launchOptions(ctx.lastLaunch.get(reg));
      return { steps: [{ action: "stop", registration: reg, proposal: p.id }, { action: "launch", registration: reg, ...o, flight, proposal: p.id }], options: o };
    }
    case "AOG": {
      const x = needAircraft();
      if (x.aog) throw new PlanError(`${reg}는 이미 AOG`);
      const until = input.until === undefined ? (p.reasons.find((r) => r.code === "until")?.value ?? null) : input.until;
      if (until !== null && (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until))) throw new PlanError("until은 YYYY-MM-DD", 400);
      const codes = p.reasons.filter((r) => ["nordo", "los", "model", "limit"].includes(r.code)).map((r) => r.code.toUpperCase());
      return { steps: [{ action: "aog", registration: reg, reason: `FLEET PLAN ${p.id}: ${codes.join("·") || "AOG"}`, until: until as string | null }], options: { until: until as string | null } };
    }
    case "RETURN": {
      const x = needAircraft();
      if (!x.aog) throw new PlanError(`${reg}는 AOG가 아님`);
      return { steps: [{ action: "return", registration: reg }], options: {} };
    }
    case "RETIRE": {
      const x = needAircraft();
      if (x.retired) throw new PlanError(`${reg}는 이미 RETIRED`);
      // SUPERVISOR 결정: 백그라운드 세션도 기본으로 멈춘다(체크를 풀면 남김)
      const stopSession = input.stopSession !== false;
      const stop = stopSession && isBgFact(session);
      return {
        steps: [{ action: "retire", registration: reg, reason: `FLEET PLAN ${p.id}` }, ...(stop ? [{ action: "stop" as const, registration: reg }] : [])],
        options: { stopSession },
      };
    }
  }
}
