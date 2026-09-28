import type { AircraftView } from "./fleet.ts";
import { ACCOUNT_HOLD_NEXT, accountHoldDetail, accountHoldLabel, type HealthCode, healthLabel } from "./health.ts";

// FLEET 운항 상태 목록(ATC-44, UI report #99): AIRCRAFT 한 대가 한 줄. 화면과 같이 쓰는 순수 함수.

export type FleetStatus = "AIRBORNE" | "HOLDING" | "PARKED" | "AOG" | "NORDO" | "NOT IN SERVICE" | "RETIRED";

// RADAR·STRIPS와 같은 말: 작업 중 AIRBORNE, 대기 중 STAND를 쥐었으면 HOLDING, 아니면 PARKED
export const fleetStatusOf = (a: Pick<AircraftView, "retired" | "aog" | "status" | "flying">): FleetStatus =>
  a.retired
    ? "RETIRED"
    : a.aog
      ? "AOG"
      : a.status === "busy"
        ? "AIRBORNE"
        : a.status === "idle"
          ? a.flying.length
            ? "HOLDING"
            : "PARKED"
          : a.status === "dead"
            ? "NORDO"
            : "NOT IN SERVICE";

// AIRBORNE → HOLDING → PARKED, 그다음 손볼 것(NORDO, AOG), 세션 없음, 퇴역
const RANK: FleetStatus[] = ["AIRBORNE", "HOLDING", "PARKED", "NORDO", "AOG", "NOT IN SERVICE", "RETIRED"];

export interface FleetRow {
  registration: string;
  callsign: string;
  airport: string | null;
  status: FleetStatus;
  flight: { key: string; title: string | null } | null; // 첫 FLYING FLIGHT
  more: number; // 그 밖의 FLYING FLIGHT 수
  elapsedMin: number | null; // 지금 쥔 STAND를 잡은 뒤 흐른 분(FLYING일 때만)
  lastActiveAt: string | null;
  week: number; // 이번 주 ARRIVED
  weekOnTime: number | null; // 이번 주 정시율(0–1). 잴 FLIGHT가 없으면 null
  // AIRCRAFT health(ATC-45): "HOLD · LIMIT until 07:40Z" 같은 짧은 글과 원인·다음 한 걸음
  health: { code: HealthCode; level: "info" | "alert"; label: string; detail: string; next: string } | null;
  account: string | null; // ACCOUNT 라벨(ATC-51). 등록부에 라벨이 하나도 없으면 null
  accountIsDefault: boolean;
  // 같은 ACCOUNT의 LIMIT으로 붙들림(ATC-51): "HOLD · LIMIT (account pro-2) until 07:40Z". health 코드는 아니다
  accountHold: { label: string; detail: string; next: string } | null;
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
      health: a.health ? { code: a.health.code, level: a.health.level, label: healthLabel(a.health, now), detail: a.health.detail, next: a.health.next } : null,
      account: a.account ?? null,
      accountIsDefault: Boolean(a.accountIsDefault),
      accountHold: a.accountHold ? { label: accountHoldLabel(a.accountHold, now), detail: accountHoldDetail(a.accountHold), next: ACCOUNT_HOLD_NEXT } : null,
    };
  });
  return rows.sort(
    (x, y) =>
      RANK.indexOf(x.status) - RANK.indexOf(y.status) ||
      (x.airport ?? "￿").localeCompare(y.airport ?? "￿") ||
      x.registration.localeCompare(y.registration),
  );
}

// 경과 시간: 45m, 3h05m, 2d4h
export function elapsedText(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? String(min % 60).padStart(2, "0") + "m" : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}
