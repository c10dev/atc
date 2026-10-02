import type { Health } from "./health.ts";

// STALE STOP(ATC-369): FLIGHT가 끝났는데(머지 또는 ARRIVED) 세션이 PENDING·HUNG으로 남아 슬롯과 경보를 쥐고 있으면 서버가 멈춘다.
// 여기는 순수 판정만 — 읽고 멈추고 기록하는 것은 stale-stop-run.ts. 스위치(dispatch.json staleStop)는 SUPERVISOR만 끈다.
// 시간: PENDING·HUNG이 시작된 때(health.since)부터 STALE_STOP_MIN분. 한 번 멈춘 세션은 다시 세지 않는다(세션이 없어진다).

export const STALE_STOP_MIN = 30;

export interface StaleFacts {
  registration: string;
  background: boolean; // atc가 띄운 `claude --bg` 세션만 멈춘다(데스크톱·tmux는 못 다룬다)
  health: Pick<Health, "code" | "since"> | null;
  startedAt: string | null; // 이 세션이 시작된 때. 그 뒤의 도착만 이 세션의 FLIGHT로 센다
  flights: readonly string[]; // 지금 쥐었거나 남겨 둔 FLIGHT(AircraftView.flights)
  arrivals: readonly { flight: string | null; arrivedAt: string }[]; // LOGBOOK의 이 AIRCRAFT 도착(머지·ARRIVED)
}

export type StaleSkip = "not-background" | "not-stuck" | "too-young" | "no-arrival" | "open-flight";

export type StaleVerdict = { stop: true; code: "PENDING" | "HUNG"; heldMin: number; flights: string[] } | { stop: false; why: StaleSkip };

// 끝난 FLIGHT가 있고(이 세션이 뜬 뒤의 도착이 하나 이상) 남은 FLIGHT가 모두 도착했으며, PENDING·HUNG이 STALE_STOP_MIN분 이어졌으면 멈춘다
export function staleStopOf(f: StaleFacts, now: number, minMin = STALE_STOP_MIN): StaleVerdict {
  if (!f.background) return { stop: false, why: "not-background" };
  const h = f.health;
  if (!h || (h.code !== "PENDING" && h.code !== "HUNG")) return { stop: false, why: "not-stuck" };
  const since = Date.parse(h.since);
  if (!Number.isFinite(since) || now - since < minMin * 60_000) return { stop: false, why: "too-young" };
  const from = f.startedAt ? Date.parse(f.startedAt) : NaN;
  const mine = f.arrivals.filter((a) => {
    const t = Date.parse(a.arrivedAt);
    return Number.isFinite(t) && (!Number.isFinite(from) || t >= from);
  });
  if (!mine.length) return { stop: false, why: "no-arrival" };
  const arrived = new Set(mine.flatMap((a) => (a.flight ? [a.flight] : [])));
  if (f.flights.some((k) => !arrived.has(k))) return { stop: false, why: "open-flight" };
  return { stop: true, code: h.code, heldMin: Math.floor((now - since) / 60_000), flights: [...arrived] };
}
