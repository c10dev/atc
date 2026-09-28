import { CONFIGURATIONS, type ConfigurationId, canFly, type CrewMember, DEFAULT_ACCOUNT, type FleetFile, type Rating } from "./crew.ts";
import type { Plan, Unserved } from "./dispatch.ts";
import type { AircraftView } from "./fleet.ts";
import { type FuelRemaining, fuelLabel, membersText } from "./fuel-remaining.ts";
import { hhmm } from "./health.ts";
import type { LogEntry } from "./logbook.ts";
import { GATE } from "./proposals.ts";
import { MAX_LAUNCHED, PERMISSION_MODES, type PermissionMode } from "./session-control.ts";

// FLEET PLAN(docs/fleet.md 8.6): 수요·활주로·예비를 보고 LAUNCH·ENTRY·STOP·RESTART·AOG·RETIRE를 제안한다.
// 여기는 계산만(순수). 기록·API·주기 실행은 fleet-plan-run.ts. 1·2단계는 그림자: 제안하고 SUPERVISOR가 동의·반대만 한다.
// 3단계(8.7)는 승인 운용: SUPERVISOR가 승인하면 FLEET 탭 버튼과 같은 코드로 바로 실행한다(executionOf가 단계를 정한다).

export interface FleetPlanConfig {
  reserve: number; // 수요가 있는 AIRPORT마다 남겨 둘 PARKED AIRCRAFT
  waitMin: number; // LAUNCH·ENTRY: 받을 곳 없는 FLIGHT가 이만큼 이어져야 제안
  idleHours: number; // STOP: 백그라운드 세션이 이만큼 쉬었으면
  restartDays: number; // RESTART: 백그라운드 세션이 이보다 오래됐으면
  retireDays: number; // RETIRE: 이 기간 ARRIVED가 없으면
  minDwellMin: number; // LAUNCH·STOP 뒤 이만큼은 반대 제안을 하지 않는다
}
// SUPERVISOR 결정(2026-09-28): 제안한 기본값 그대로
export const FLEET_PLAN_DEFAULTS: FleetPlanConfig = { reserve: 1, waitMin: 120, idleHours: 12, restartDays: 3, retireDays: 30, minDwellMin: 120 };

export const FLEET_PLAN_KINDS = ["LAUNCH", "ENTRY", "STOP", "RESTART", "AOG", "RETIRE", "RETURN"] as const;
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
  airport: string | null;
  configuration?: ConfigurationId; // ENTRY
  reasons: PlanReason[];
}

// AIRCRAFT 이름의 세션(claude agents --json)
export interface SessionFact {
  registration: string;
  kind: string; // background | interactive
  id?: string;
  startedAt: number | null;
}

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
  logbook: Pick<LogEntry, "aircraft" | "airport" | "arrivedAt" | "blockMin" | "landingWaitMin">[];
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
  const wait = median(recent.map((e) => e.landingWaitMin));
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
export function fuelOfPlan(i: Pick<FleetInputs, "aircraft" | "fuelAccounts">, kind: FleetPlanKind, registration: string | null): FuelRemaining | null {
  const accounts = i.fuelAccounts ?? [];
  if (kind === "ENTRY") return accounts.find((f) => f.account === DEFAULT_ACCOUNT) ?? null;
  const a = registration ? i.aircraft.find((x) => x.registration === registration.toUpperCase()) : undefined;
  if (!a) return null;
  if (a.account) return accounts.find((f) => f.account === a.account) ?? null;
  return accounts.find((f) => f.group === `aircraft:${a.registration}`) ?? null;
}

// FUEL 100% (account acct-1) until 21:00Z
export const fuelHoldText = (f: FuelRemaining, now: number) =>
  `FUEL ${Math.round(f.top.pct)}%${f.account ? ` (account ${f.account})` : ""} until ${hhmm(Date.parse(f.top.resetsAt), now)}`;

const fuelInfoReason = (f: FuelRemaining, now: number): PlanReason => ({
  code: "fuel",
  detail: `${fuelLabel(f, now)}${f.account ? ` (account ${f.account})` : ""} — 한도에 가까움(INFO) · ${membersText(f) || "구성원 없음"}`,
  value: f.top.pct,
});

// 열린 LAUNCH·ENTRY 제안의 ACCOUNT가 hold 수준이 됐으면 그 사유(syncFleetPlan이 expire한다)
export function fuelExpiryOf(i: Pick<FleetInputs, "aircraft" | "fuelAccounts" | "now">, p: Pick<FleetProposal, "kind" | "aircraft">): string | null {
  if (p.kind !== "LAUNCH" && p.kind !== "ENTRY") return null;
  const f = fuelOfPlan(i, p.kind, p.aircraft);
  return f?.level === "hold" ? `${fuelHoldText(f, i.now)} — ACCOUNT가 FUEL hold 수준` : null;
}

export function fleetPlanOf(i: FleetInputs): { candidates: FleetCandidate[]; demand: DemandRow[] } {
  const cfg = i.config;
  const out: FleetCandidate[] = [];
  const byReg = new Map(i.aircraft.map((a) => [a.registration, a]));
  const assigned = new Set(i.plan.assign.map((p) => p.aircraftName.toUpperCase()));
  const unserved = i.plan.unserved ?? [];
  const background = i.sessions.filter((x) => x.kind === "background");
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
    const idle = i.aircraft.filter((a) => a.status === "absent" && !a.retired && !a.aog && a.base === code && !i.nordo.has(a.registration) && !dwelling(a.registration, "stop"));
    const fitting = idle
      .map((a) => ({ a, served: mine.filter((u) => canServe(a.registration, a.ratings, a.complement, u)), fuel: fuelOfPlan(i, "LAUNCH", a.registration) }))
      .filter((x) => x.served.length)
      .sort((x, y) => y.served.length - x.served.length || y.a.actuals.total - x.a.actuals.total || x.a.registration.localeCompare(y.a.registration));
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
    // 맞는 AIRCRAFT가 모두 FUEL hold면, 다른 이유로 막혀도 FUEL을 먼저 말한다
    const blockedBy = (why: string) => (heldText ? `${heldText} · ${why}` : why);
    // 맞는 등록 AIRCRAFT가 없으면 새로 들이기. tail로 정한 FLIGHT는 그 팀만 받으므로 새 AIRCRAFT로 풀리지 않는다
    if (!i.nextRegistration) {
      row.blocked = blockedBy("맞는 AIRCRAFT가 없고 남은 등록번호도 없음");
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
      row.blocked = blockedBy(open.length ? "맞는 등록 AIRCRAFT도 CONFIGURATION도 없음" : `tail로 정한 팀이 운항할 수 없음: ${mine.map((u) => `${u.flight}(tail:${u.tails.join(",")})`).join(", ")}`);
      continue;
    }
    // 새 AIRCRAFT는 default ACCOUNT로 센다
    const entryFuel = fuelOfPlan(i, "ENTRY", i.nextRegistration);
    if (entryFuel?.level === "hold") {
      row.blocked = [heldText, `${fuelHoldText(entryFuel, i.now)} — 새 AIRCRAFT(ENTRY)가 들 ACCOUNT`].filter(Boolean).join(" · ");
      continue;
    }
    const pick = configs[0];
    const c = pick.id === "general" ? i.defaults : CONFIGURATIONS[pick.id];
    out.push({
      key: `DEMAND|${code}`, kind: "ENTRY", aircraft: i.nextRegistration, airport: code, configuration: pick.id,
      reasons: [
        ...common(pick.served),
        heldFits.length
          ? { code: "fuel-held", detail: `${code}의 맞는 등록 AIRCRAFT는 FUEL hold: ${heldText}` }
          : { code: "no-fit", detail: `${code}에 운항하지 않는 등록 AIRCRAFT 중 맞는 것이 없음` },
        { code: "fits", detail: `${pick.id} CONFIGURATION: TYPE RATING ${c.ratings.join("·")}, CREW ${c.complement.map((m) => m.position).join("·")}` },
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
    .map((x) => ({ x, a: byReg.get(x.registration.toUpperCase()), idle: idleFor(x.registration.toUpperCase()) }))
    .sort((p, q) => (q.idle ?? 0) - (p.idle ?? 0));
  for (const { x, a, idle } of stopOrder) {
    const reg = x.registration.toUpperCase();
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
    const session = i.sessions.find((x) => x.registration.toUpperCase() === a.registration);
    const reasons: PlanReason[] = [
      { code: h.code.toLowerCase(), detail: `${h.code} — ${h.detail} (since ${h.since.slice(0, 16).replace("T", " ")}Z)`, value: h.since },
      { code: "handoff", detail: a.flying.length ? `STAND·PR(${a.flying.join(", ")})은 새 세션에 HANDOFF — ${h.next}` : h.next },
      {
        code: "session",
        detail: session?.kind === "background" ? `BG ${session.id ?? "?"} — 멈추고 새 CREW BRIEFING으로 다시 띄움` : "데스크톱·터미널 세션 — 승인 실행은 안 됨, 그 창을 닫고 새 CREW BRIEFING으로 연다",
      },
    ];
    const key = `RESTART|${a.registration}`;
    const same = out.find((c) => c.key === key);
    if (same) same.reasons.unshift(...reasons.slice(0, 2));
    else out.push({ key, kind: "RESTART", aircraft: a.registration, airport: a.base, reasons });
  }

  // ── AOG: NORDO, 최근 LOS, AIRCRAFT health의 MODEL·주간 LIMIT(ATC-48) ──
  for (const a of i.aircraft) {
    if (a.retired || a.aog) continue;
    const reasons: PlanReason[] = [];
    if (i.nordo.has(a.registration)) reasons.push({ code: "nordo", detail: "NORDO — 세션이 응답하지 않음" });
    const los = i.los.get(a.registration);
    if (los) reasons.push({ code: "los", detail: `최근 24시간 LOS(${los.slice(0, 16).replace("T", " ")}Z)` });
    const h = a.health;
    if (h?.code === "MODEL") reasons.push({ code: "model", detail: `MODEL — ${h.detail}. ${h.next}` });
    const weekly = h?.code === "LIMIT" && h.weekly ? h : null;
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
  return { candidates: out, demand };
}

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
  | { op: "create"; id: string; key: string; kind: FleetPlanKind; aircraft: string | null; airport: string | null; configuration?: ConfigurationId; reasons: PlanReason[]; at: string }
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
  | { action: "entry"; registration: string; configuration: ConfigurationId; base: string }
  | { action: "launch"; registration: string; permissionMode: PermissionMode; model: string | null }
  | { action: "stop"; registration: string }
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
  configuration?: ConfigurationId;
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
const OPPOSITE: Partial<Record<FleetPlanKind, FleetPlanKind[]>> = { LAUNCH: ["STOP"], STOP: ["LAUNCH"], RESTART: ["LAUNCH"] };

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
  const same = (p: Pick<FleetProposal, "kind" | "aircraft">, c: FleetCandidate) => p.kind === c.kind && p.aircraft === c.aircraft;
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
    const line: FleetPlanOp = { op: "create", id, key: c.key, kind: c.kind, aircraft: c.aircraft, airport: c.airport, ...(c.configuration ? { configuration: c.configuration } : {}), reasons: c.reasons, at };
    ops.push(line);
    created.push({ ...c, id, at, status: "open", closedAt: null, verdict: null, closeReason: null, approval: null, execution: null });
  }
  return ops;
}

// 그림자 게이트: DISPATCH·SCHEDULE과 같은 기준(20건, 합의율 80%). 종류마다 건수도 보인다
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
  return { decided: decided.length, agreed, agreement, target: GATE, ready: decided.length >= GATE.decided && agreement !== null && agreement >= GATE.agreement, byKind };
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
  mode: "shadow" | "approval";
  latest: FleetCandidate[]; // 최근 주기의 후보
  ranAt: string | null;
  aircraft: AircraftView[];
  sessions: SessionFact[]; // claude agents(지금)
  taken: string[]; // 등록부와 세션에 이미 있는 이름
  lastLaunch: Map<string, { permissionMode?: string; model?: string }>; // AIRCRAFT의 마지막 LAUNCH(FLIGHT RECORDER)
  maxLaunched?: number;
  now: number;
}

// 최근 주기가 같은 AIRCRAFT에 같은 종류를 여전히 내나
export function isStale(p: Pick<FleetProposal, "key" | "kind" | "aircraft">, latest: FleetCandidate[], ranAt: string | null, now: number): boolean {
  if (!ranAt || now - Date.parse(ranAt) > STALE_MS) return true;
  return !latest.some((c) => c.key === p.key && c.kind === p.kind && c.aircraft === p.aircraft);
}

// 승인 양식 값을 검사해 단계로 만든다(순수). 8.5의 거절 조건 중 지금 알 수 있는 것을 먼저 본다 —
// 두 단계짜리(ENTRY·RESTART)가 첫 단계만 하고 멈추는 일을 줄이려고. 실행할 때 8.5 코드가 다시 본다
export function executionOf(p: FleetProposal, input: Record<string, unknown>, ctx: ExecContext): { steps: ExecStep[]; options: ApproveOptions } {
  if (ctx.mode !== "approval") throw new PlanError("그림자 운용 중 — 승인 운용을 켜야 실행한다");
  if (p.status !== "open") throw new PlanError(`${p.id}는 이미 닫힘(${p.status})`);
  if (isStale(p, ctx.latest, ctx.ranAt, ctx.now)) throw new PlanError("조건이 바뀜 — 최근 주기가 이 제안을 더는 내지 않는다. 다음 주기를 기다린다");
  const reg = p.aircraft ?? "";
  const a = ctx.aircraft.find((x) => x.registration === reg);
  const bg = ctx.sessions.filter((x) => x.kind === "background");
  const session = ctx.sessions.find((x) => x.registration === reg);
  const max = ctx.maxLaunched ?? MAX_LAUNCHED;
  const launchOptions = (fallback?: { permissionMode?: string; model?: string }) => {
    const mode = (input.permissionMode ?? fallback?.permissionMode ?? "auto") as PermissionMode;
    if (!PERMISSION_MODES.includes(mode)) throw new PlanError(`permission mode는 ${PERMISSION_MODES.join(" | ")}`, 400);
    const raw = input.model === undefined ? (fallback?.model ?? "") : input.model;
    const model = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (model && !/^[\w.:[\]-]+$/.test(model)) throw new PlanError(`모델 이름이 이상함: ${model}`, 400);
    return { permissionMode: mode, model };
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
    if (session.kind !== "background") throw new PlanError(`${reg}는 데스크톱·터미널 세션 — 그 창에서 닫는다`);
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
      if (ctx.taken.some((n) => n.toUpperCase() === reg)) throw new PlanError(`${reg}는 이미 쓰는 등록번호 — 다음 주기가 새 번호로 제안한다`);
      if (!p.configuration || !p.airport) throw new PlanError("ENTRY에 CONFIGURATION·AIRPORT가 없음");
      capRoom();
      const o = launchOptions();
      return {
        steps: [
          { action: "entry", registration: reg, configuration: p.configuration, base: p.airport },
          { action: "launch", registration: reg, ...o },
        ],
        options: o,
      };
    }
    case "STOP":
      needBackground();
      return { steps: [{ action: "stop", registration: reg }], options: {} };
    case "RESTART": {
      const x = needAircraft();
      if (x.retired) throw new PlanError(`${reg}는 RETIRED`);
      needBase(x);
      needBackground();
      const o = launchOptions(ctx.lastLaunch.get(reg));
      return { steps: [{ action: "stop", registration: reg }, { action: "launch", registration: reg, ...o }], options: o };
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
      const stop = stopSession && session?.kind === "background";
      return {
        steps: [{ action: "retire", registration: reg, reason: `FLEET PLAN ${p.id}` }, ...(stop ? [{ action: "stop" as const, registration: reg }] : [])],
        options: { stopSession },
      };
    }
  }
}
