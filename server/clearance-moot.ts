import type { Clearance } from "./model.ts";

// 이유를 잃은 CLEARANCE(ATC-515, 순수 함수). TOWER가 READBACK을 기다리는 CLEARANCE 가운데 그 FLIGHT의 PR이 모두 끝난 것을 브리핑에 올린다.
// 서버는 고르기만 한다 — 취소(`atcctl cancel`)는 TOWER가 한다. 스위치는 SUPERVISOR만 바꾼다(기본 on).

export const MOOT_SWITCHES = ["off", "on"] as const;
export type MootSwitch = (typeof MOOT_SWITCHES)[number];
export const parseMootSwitch = (raw: unknown): MootSwitch => (raw === "off" ? "off" : "on");

export type PrState = "open" | "merged" | "closed";
export interface FlightPr {
  flight: string; // "VOC-228"
  number: number;
  state: PrState;
  at?: string; // 머지 시각(LOGBOOK ARRIVED). 모르면 비운다(stranded)
}

const isOpen = (c: Clearance) => !c.readbackAt && !c.unableAt && !c.cancelledAt;

// 고르는 조건: 열려 있고(READBACK·ROGER·UNABLE·취소 없음), FLIGHT가 있고, 그 FLIGHT의 PR이 하나 이상이며 모두 머지됐거나 닫혔고,
// CLEARANCE가 가장 늦은 머지보다 먼저 나갔다(머지 뒤에 나간 CLEARANCE는 후속 일일 수 있어 고르지 않는다. 머지 시각을 아는 PR이 없으면 고르지 않는다).
// CLEARANCE에는 PR 번호가 없어 FLIGHT가 고리다. FLIGHT가 없거나 PR이 아직 없는 것은 고르지 않는다(기존 규칙대로 TOWER가 처리한다)
export function mootClearancesOf(clearances: readonly Clearance[], prs: readonly FlightPr[], sw: MootSwitch): Clearance[] {
  if (sw === "off") return [];
  const byFlight = new Map<string, FlightPr[]>();
  for (const p of prs) byFlight.set(p.flight, [...(byFlight.get(p.flight) ?? []), p]);
  return clearances.filter((c) => {
    if (!isOpen(c) || !c.flight) return false;
    const list = byFlight.get(c.flight);
    if (!list?.length || !list.every((p) => p.state !== "open")) return false;
    const lastMerge = Math.max(...list.map((p) => (p.at ? Date.parse(p.at) : NaN)).filter((t) => !Number.isNaN(t)), -Infinity);
    return Date.parse(c.at) <= lastMerge;
  });
}

// 기록(clearance-moot-events.jsonl, 추가만): listed = 서버가 이 CLEARANCE를 골라 올렸다(처음 한 번), misfire = 취소된 뒤 틀렸다고 드러났다
export type MisfireWhy = "new-clearance" | "reopened";
export type MootEvent =
  | { op: "listed"; t: string; id: string; flight: string; prs: number[] }
  | { op: "misfire"; t: string; id: string; why: MisfireWhy };
export const MISFIRE_WINDOW_MS = 24 * 3_600_000;

// 새로 올릴 listed 줄(이미 올린 id는 다시 올리지 않는다)
export function listedEvents(picked: readonly Clearance[], prs: readonly FlightPr[], events: readonly MootEvent[], now: number): MootEvent[] {
  const seen = new Set(events.filter((e) => e.op === "listed").map((e) => e.id));
  return picked
    .filter((c) => !seen.has(c.id))
    .map((c) => ({ op: "listed" as const, t: new Date(now).toISOString(), id: c.id, flight: c.flight!, prs: prs.filter((p) => p.flight === c.flight).map((p) => p.number) }));
}

// MISFIRE: 올렸던 CLEARANCE가 취소된 뒤, (a) 같은 FLIGHT에 24시간 안에 새 CLEARANCE가 나갔거나 (b) 그 FLIGHT의 PR이 다시 열렸다(올릴 때 있던 PR 번호가 지금 open).
// 스위치가 off면 세지 않는다. id마다 한 번만. 취소되지 않은 것은 세지 않는다
export function newMisfires(events: readonly MootEvent[], clearances: readonly Clearance[], openPrs: readonly FlightPr[], now: number, sw: MootSwitch): MootEvent[] {
  if (sw === "off") return [];
  const counted = new Set(events.filter((e) => e.op === "misfire").map((e) => e.id));
  const out: MootEvent[] = [];
  for (const e of events) {
    if (e.op !== "listed" || counted.has(e.id)) continue;
    const c = clearances.find((x) => x.id === e.id);
    if (!c?.cancelledAt) continue;
    const cancelled = Date.parse(c.cancelledAt);
    const renewed = clearances.some((x) => x.id !== c.id && x.flight === e.flight && Date.parse(x.at) > cancelled && Date.parse(x.at) - cancelled <= MISFIRE_WINDOW_MS);
    const reopened = openPrs.some((p) => p.flight === e.flight && p.state === "open" && e.prs.includes(p.number));
    if (renewed || reopened) {
      counted.add(e.id);
      out.push({ op: "misfire", t: new Date(now).toISOString(), id: e.id, why: renewed ? "new-clearance" : "reopened" });
    }
  }
  return out;
}

export interface MootCounter {
  listed: number;
  cancelled: number;
  misfires: number;
}
export function mootCounterOf(events: readonly MootEvent[], clearances: readonly Clearance[]): MootCounter {
  const listed = new Set(events.filter((e) => e.op === "listed").map((e) => e.id));
  const cancelled = [...listed].filter((id) => clearances.find((c) => c.id === id)?.cancelledAt).length;
  return { listed: listed.size, cancelled, misfires: new Set(events.filter((e) => e.op === "misfire").map((e) => e.id)).size };
}
