import type { AircraftView, FlightDetail } from "./fleet.ts";
import type { Job } from "./job-state.ts";
import type { Activity } from "./activity.ts";
import { ACCOUNT_HOLD_NEXT, accountHoldDetail, accountHoldLabel, type HealthCode, healthLabel } from "./health.ts";
import { fuelHoldTag, fuelTitle } from "./fuel-remaining.ts";
import { type ContextBadge, contextBadgeOf } from "./fuel-context.ts";
import { fleetFuelLabel, fleetFuelTitle } from "./fuel-view.ts";
import { compareRegistration, conflictHintOf, renameHintOf } from "./registration.ts";
import { RESTARTING_TEXT } from "./restarting.ts";
import { originBadgeOf } from "./session-origin.ts";

// FLEET 운항 상태 목록(ATC-44, UI report #99): AIRCRAFT 한 대가 한 줄. 화면과 같이 쓰는 순수 함수.

export type FleetStatus = "AIRBORNE" | "HOLDING" | "PARKED" | "RESTARTING" | "AOG" | "NORDO" | "NOT IN SERVICE" | "RETIRED";

// RADAR·STRIPS와 같은 말: 작업 중 AIRBORNE, 대기 중 STAND를 쥐었으면 HOLDING, 아니면 PARKED
// 점유는 놓쳤어도 멈춘 채 FLIGHT를 쥔 AIRCRAFT(ATC-86, flights의 kept)도 HOLDING이다
// /clear 뒤 첫 메시지를 기다리는 AIRCRAFT(ATC-91, restartGraceMin 안)는 세션이 없어도 RESTARTING이다
export const fleetStatusOf = (a: Pick<AircraftView, "retired" | "aog" | "status" | "flying"> & Partial<Pick<AircraftView, "flights" | "restarting">>): FleetStatus =>
  a.retired
    ? "RETIRED"
    : a.aog
      ? "AOG"
      : a.status === "busy"
        ? "AIRBORNE"
        : a.status === "idle"
          ? (a.flights?.length ?? a.flying.length)
            ? "HOLDING"
            : "PARKED"
          : a.status === "dead"
            ? "NORDO"
            : a.restarting
              ? "RESTARTING"
              : "NOT IN SERVICE";

// AIRBORNE → HOLDING → PARKED, 그다음 손볼 것(NORDO, AOG), 세션 없음, 퇴역
const RANK: FleetStatus[] = ["AIRBORNE", "HOLDING", "PARKED", "RESTARTING", "NORDO", "AOG", "NOT IN SERVICE", "RETIRED"];

export interface FleetRow {
  registration: string;
  callsign: string;
  airport: string | null;
  status: FleetStatus;
  flight: { key: string; title: string | null; kept?: true; detail?: FlightDetail } | null; // 첫 FLYING FLIGHT. kept: 점유는 지났지만 멈춘 AIRCRAFT가 쥔 FLIGHT(ATC-86)
  more: number; // 그 밖의 FLYING FLIGHT 수
  elapsedMin: number | null; // 지금 쥔 STAND를 잡은 뒤 흐른 분(FLYING일 때만)
  lastActiveAt: string | null;
  week: number; // 이번 주 ARRIVED
  weekOnTime: number | null; // 이번 주 정시율(0–1). 잴 FLIGHT가 없으면 null
  // RESTARTING(ATC-91): "세션 없음 — /clear 뒤 첫 메시지 대기". until까지 기다린다
  restarting: { label: string; until: string } | null;
  // AIRCRAFT health(ATC-45): "HOLD · LIMIT until 07:40Z" 같은 짧은 글과 원인·다음 한 걸음
  health: { code: HealthCode; level: "info" | "alert"; label: string; detail: string; next: string } | null;
  job?: Job | null; // 백그라운드 job 상태(ATC-99): blocked면 NEEDS YOU
  activity: Activity | null; // ACTIVITY(ATC-97): 지금 하는 일 한 줄
  report: AircraftView["report"] | null; // 마지막 턴의 REPORT 판정(ATC-89, 그림자). 칩과 툴팁
  account: string | null; // ACCOUNT 라벨(ATC-51). 등록부에 라벨이 하나도 없으면 null
  accountIsDefault: boolean;
  observedAccount: string | null; // home과 다른 폴더에서 돌 때의 ACCOUNT(ATC-146). 줄은 "acct-1 (home acct-2)"로 보인다
  // 같은 ACCOUNT의 LIMIT으로 붙들림(ATC-51): "HOLD · LIMIT (account pro-2) until 07:40Z". health 코드는 아니다
  accountHold: { label: string; detail: string; next: string } | null;
  // ACCOUNT의 FUEL이 hold 수준일 때만(ATC-81): "HOLD · FUEL (account acct-2) until 21:00Z". 사용 %는 줄에 싣지 않는다(툴팁에만).
  // 줄의 연료는 AIRCRAFT 자기 것 FOB(context)다. statusline 값이 없거나 hold 아래면 null
  fuelHold: { label: string; title: string } | null;
  // FUEL F8(ATC-56): 최근 14일 "FUEL $6.20/FLT · CACHE 97%". FUEL REMAINING 옆에 둔다. fuel 있는 FLIGHT가 없으면 null
  fuelBurn: { label: string; title: string } | null;
  // FOB(ATC-81, CONTEXT SIZE는 ATC-69): "FOB 50% · 504k/1M". 살아 있는 세션의 기록이 없으면 null
  context: ContextBadge | null;
  // 세션 이름(ATC-67): 같은 REGISTRATION으로 읽히는 세션이 둘 이상이면 충돌, 정식 표기가 아니면 이름 바꾸기 힌트. 없으면 null
  name: { label: string; title: string; conflict: boolean } | null;
  // 세션 출처(ATC-76): BG·DESKTOP·TERM과 permission mode. 세션이 없으면 null
  origin: ReturnType<typeof originBadgeOf>;
  // 백그라운드 세션(ATC-98): jobId(모르면 null). 살아 있는 세션이 없거나 백그라운드가 아니면 null
  background: { jobId: string | null; attachDir?: string } | null;
}

// 목록 줄: 상태 순서, 같은 상태 안에서는 AIRPORT(없으면 뒤), 그다음 REGISTRATION
export function fleetRows(aircraft: readonly AircraftView[], now: number): FleetRow[] {
  const rows = aircraft.map((a): FleetRow => {
    const flights = a.flights ?? a.flying.map((key) => ({ key, title: null }));
    const since = a.flyingSince ? Date.parse(a.flyingSince) : NaN;
    return {
      registration: a.registration,
      callsign: a.callsign,
      airport: a.base,
      status: fleetStatusOf(a),
      flight: flights[0] ?? null,
      more: Math.max(0, flights.length - 1),
      elapsedMin: flights.length && Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 60_000)) : null,
      lastActiveAt: a.lastActiveAt ?? null,
      week: a.actuals.week,
      weekOnTime: a.actuals.weekOnTime?.rate ?? null,
      restarting: a.restarting ? { label: RESTARTING_TEXT, until: a.restarting.until } : null,
      job: a.job ?? null,
      activity: a.activity ?? null,
      report: a.report ?? null,
      health: a.health ? { code: a.health.code, level: a.health.level, label: healthLabel(a.health, now), detail: a.health.detail, next: a.health.next } : null,
      account: a.account ?? null,
      accountIsDefault: Boolean(a.accountIsDefault),
      observedAccount: a.observedAccount ?? null,
      accountHold: a.accountHold ? { label: accountHoldLabel(a.accountHold, now), detail: accountHoldDetail(a.accountHold), next: ACCOUNT_HOLD_NEXT } : null,
      fuelHold: a.fuel?.level === "hold" ? { label: fuelHoldTag(a.fuel, now), title: fuelTitle(a.fuel, now) } : null,
      fuelBurn: a.fuelBurn && fleetFuelLabel(a.fuelBurn) ? { label: fleetFuelLabel(a.fuelBurn)!, title: fleetFuelTitle(a.fuelBurn) } : null,
      context: contextBadgeOf(a.context),
      name: a.sessionConflict?.length
        ? { label: `세션 ${a.sessionConflict.length}개`, title: conflictHintOf(a.sessionConflict, a.registration), conflict: true }
        : a.sessionName
          ? { label: "이름", title: renameHintOf(a.sessionName, a.registration), conflict: false }
          : null,
      origin: originBadgeOf(a.background ? "background" : a.origin, a.permissionMode, a.background?.jobId, a.background?.attachDir),
      background: a.background ?? null,
    };
  });
  return rows.sort(
    (x, y) =>
      RANK.indexOf(x.status) - RANK.indexOf(y.status) ||
      (x.airport ?? "￿").localeCompare(y.airport ?? "￿") ||
      compareRegistration(x.registration, y.registration),
  );
}

// FLIGHT 옆의 한 줄(ATC-86): "59a9fdc 7h ago · pushed · no PR". 워크트리를 모르면 "no worktree"
export function flightDetailText(d: FlightDetail, now: number): { text: string; unpushed: boolean } {
  const parts: string[] = [];
  if (d.commit) {
    const at = d.commit.at ? Date.parse(d.commit.at) : NaN;
    parts.push(`${d.commit.sha}${Number.isFinite(at) ? ` ${elapsedText(Math.max(0, Math.floor((now - at) / 60_000)))} ago` : ""}`);
  } else parts.push("no worktree");
  if (d.pushed !== null) parts.push(d.pushed ? "pushed" : "not pushed");
  parts.push(d.pr ? `PR #${d.pr.number}${d.pr.draft ? " draft" : ""}` : "no PR");
  return { text: parts.join(" · "), unpushed: d.pushed === false };
}

// 경과 시간: 45m, 3h05m, 2d4h
export function elapsedText(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? String(min % 60).padStart(2, "0") + "m" : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}
