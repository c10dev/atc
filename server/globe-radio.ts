// GLOBE G7(ATC-268, docs/globe.md 3.9): RADIO가 이미 합친 교신(GET /api/radio)을 지구본과 AIRPORT 뷰에 그리기 위한 순수 계산.
// 브라우저에서도 쓰므로 node 모듈을 끌어오지 않고 타입만 가져온다. 새 데이터도 새 상태도 없다 — 기록된 것만 그린다.
// 모르는 주파수·종류가 와도 깨지지 않는다(일반 스테이션으로 그린다).
import type { GlobeFlight, GlobeFlightState } from "./globe.ts";
import { compareRegistration } from "./registration.ts";
import type { Transmission } from "./radio.ts";

const MIN = 60_000;
export const GLOBE_WINDOW_MS = 2 * MIN; // 지구본 위의 전파(펄스)는 최근 2분
export const AIRPORT_WINDOW_MS = 10 * MIN; // AIRPORT 뷰의 선은 최근 10분(아래 목록은 더 길다)
export const AIRPORT_LINES_MAX = 8; // 뷰 안에 글을 단 선은 최대 8개(나머지는 목록)

// ── 스테이션 ──
export const STATIONS = ["OCC", "TOWER", "MCC", "CROSSCHECK", "RADIO"] as const;
export type Station = (typeof STATIONS)[number];

// 3.9의 표: DELIVERY·COMPANY는 OCC, TOWER는 TOWER, GROUND는 MCC, PREFLIGHT는 CROSSCHECK. 그 밖의 주파수는 일반 스테이션(RADIO)
export function stationOf(t: Pick<Transmission, "freq">): Station {
  switch (t.freq) {
    case "DELIVERY":
    case "COMPANY":
      return "OCC";
    case "TOWER":
      return "TOWER";
    case "GROUND":
      return "MCC";
    case "PREFLIGHT":
      return "CROSSCHECK";
    default:
      return "RADIO";
  }
}

// ── 호출의 상태: 열림 · 늦음(overdueAt을 넘김) · 답함(답이거나 닫힌 호출) ──
export type CallState = "open" | "overdue" | "answered";
export function callStateOf(t: Pick<Transmission, "replyTo" | "open" | "overdueAt">, now: number): CallState {
  if (t.replyTo || !t.open) return "answered";
  return t.overdueAt && Number.isFinite(Date.parse(t.overdueAt)) && now > Date.parse(t.overdueAt) ? "overdue" : "open";
}

// ── 교신 → 비행기 ──
// flight 키가 맞는 것을 먼저, 없으면 AIRCRAFT REGISTRATION으로. AIRPORT가 적혀 있으면 같은 AIRPORT의 것을 먼저 고른다
export function planeOf(t: Pick<Transmission, "flight" | "aircraft" | "airport">, flights: readonly GlobeFlight[]): GlobeFlight | null {
  const pick = (xs: GlobeFlight[]) => xs.find((f) => !t.airport || f.airport === t.airport) ?? xs[0] ?? null;
  if (t.flight) {
    const hit = pick(flights.filter((f) => f.key === t.flight));
    if (hit) return hit;
  }
  if (t.aircraft) return pick(flights.filter((f) => f.aircraft === t.aircraft));
  return null;
}

export interface Pulse {
  tx: Transmission;
  station: Station;
  state: CallState;
  plane: GlobeFlight | null;
  airport: string | null; // 교신의 AIRPORT, 없으면 비행기의 AIRPORT. 둘 다 없으면 지구본에 그릴 곳이 없다
}

// windowMs 안의 교신(시각순). 시각이 이상한 줄은 버린다. 열린 호출(답이 아직 없음)은 창이 지나도 답이 올 때까지 남는다
export function pulsesOf(txs: readonly Transmission[], flights: readonly GlobeFlight[], now: number, windowMs: number): Pulse[] {
  const out: Pulse[] = [];
  for (const tx of txs) {
    const at = Date.parse(tx.at);
    if (!Number.isFinite(at) || at - now > MIN) continue;
    if (now - at > windowMs && callStateOf(tx, now) === "answered") continue;
    const plane = planeOf(tx, flights);
    out.push({ tx, station: stationOf(tx), state: callStateOf(tx, now), plane, airport: tx.airport ?? plane?.airport ?? null });
  }
  return out.sort((a, b) => Date.parse(a.tx.at) - Date.parse(b.tx.at));
}

// 한 AIRPORT의 교신(목록과 선): 교신의 AIRPORT가 이 AIRPORT이거나, 없으면 비행기가 이 AIRPORT에 있다.
// MCC의 GROUND 방송(INSPECTION·LAND·RTS)은 AIRPORT도 비행기도 없이 "ALL"에게 가므로 모든 AIRPORT 뷰의 목록에 든다
export const isBroadcast = (p: Pulse) => p.airport === null && p.plane === null && p.tx.to === "ALL";
export const atAirport = (pulses: readonly Pulse[], code: string) => pulses.filter((p) => p.airport === code || isBroadcast(p));

// ── AIRPORT 뷰의 배치(900 × 560) ──
export const VIEW_W = 900;
export const VIEW_H = 560;
export interface Pt {
  x: number;
  y: number;
}
export interface Spot extends Pt {
  heading: number; // 0 = 위, 시계 방향
}

export const RUNWAY = { x1: 60, x2: 840, y: 440 } as const;
export const TAXIWAY_Y = 372;
const GATE_Y = 300;
const TOUCHDOWN: Pt = { x: 230, y: RUNWAY.y };

// 스테이션(시설) 자리. 위쪽 띠에 늘어선다. CROSSCHECK는 PREFLIGHT 교신이 있을 때만 그린다
export const FACILITIES: Record<Exclude<Station, "RADIO">, Pt & { label: string; sub: string }> = {
  OCC: { x: 130, y: 88, label: "OCC", sub: "DELIVERY · COMPANY" },
  CROSSCHECK: { x: 290, y: 88, label: "CROSSCHECK", sub: "PREFLIGHT" },
  TOWER: { x: 450, y: 78, label: "TOWER", sub: "TOWER" },
  MCC: { x: 770, y: 88, label: "MCC", sub: "GROUND · RTS" },
};
// 일반 스테이션(모르는 주파수)은 가운데 오른쪽 띠
export const GENERIC_STATION: Pt = { x: 610, y: 88 };
export const stationPoint = (s: Station): Pt => (s === "RADIO" ? GENERIC_STATION : FACILITIES[s]);

// 게이트 n개를 활주로와 나란한 앱론 선에 고르게
export function gatePoints(n: number): Pt[] {
  const k = Math.max(1, n);
  return Array.from({ length: k }, (_, i) => ({ x: k === 1 ? 450 : 220 + (460 * i) / (k - 1), y: GATE_Y }));
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const headingOf = (a: Pt, b: Pt) => ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360;
const clamp01 = (t: number) => Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));

function alongPoly(path: readonly Pt[], t: number): Spot {
  const lens = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let d = clamp01(t) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, d / lens[i]) : 0;
      const p = lerp(path[i], path[i + 1], k);
      return { ...p, heading: headingOf(path[i], path[i + 1]) };
    }
    d -= lens[i];
  }
  return { ...path[0], heading: 0 };
}

export const CRUISE_PATH: readonly Pt[] = [{ x: 820, y: RUNWAY.y }, { x: 888, y: 40 }]; // 활주로 끝에서 오른쪽 위 가장자리로 나간다
export const FINAL_PATH: readonly Pt[] = [{ x: 14, y: RUNWAY.y }, TOUCHDOWN]; // 왼쪽 가장자리에서 들어와 활주로 앞에서 멈춘다(도착은 마일스톤이 알려 준다)
export const MISSED_PATH: readonly Pt[] = [TOUCHDOWN, { x: 330, y: 330 }, { x: 150, y: 230 }]; // 활주로 위에서 올라가 왼쪽으로 돈다
export const HOLD_CENTER: Pt = { x: 90, y: 190 };
export const taxiPath = (gate: Pt): Pt[] => [{ x: 700, y: RUNWAY.y }, { x: 700, y: TAXIWAY_Y }, { x: gate.x, y: TAXIWAY_Y }, gate];

// 장면의 상태(G2의 8가지)를 AIRPORT 뷰의 자리로. 서버가 정한 t만 쓰고 새 추정은 없다.
// boarding·arrived·nordo는 게이트, cruise는 오른쪽 위로 나가는 길, hold는 왼쪽 위의 홀딩, final은 왼쪽에서 활주로로, goAround는 활주로 위의 올라가는 고리,
// taxi는 활주로(터치다운)에서 게이트로. taxi의 t는 서버가 추정하지 않아 0이라 활주로에서 시작한다
export function planeSpot(state: GlobeFlightState, t: number, gate: Pt): Spot {
  switch (state) {
    case "cruise":
      return alongPoly(CRUISE_PATH, t);
    case "final":
      return alongPoly(FINAL_PATH, t);
    case "goAround":
      return alongPoly(MISSED_PATH, 0.5);
    case "hold":
      return { ...HOLD_CENTER, heading: 90 };
    case "taxi":
      return alongPoly(taxiPath(gate), t);
    default:
      return { ...gate, heading: 180 }; // boarding·arrived·nordo: 게이트에서 코가 활주로 쪽
  }
}

// 게이트를 쓰는 비행기·세워 둔 AIRCRAFT에 게이트를 정해 준다(key 순, 그다음 세워 둔 것 REGISTRATION 순)
export interface Gated {
  flights: Map<string, Pt>;
  parked: Map<string, Pt>;
  all: Pt[];
}
export function assignGates(flights: readonly GlobeFlight[], parked: readonly { registration: string }[]): Gated {
  const fl = [...flights].sort((a, b) => a.key.localeCompare(b.key));
  const pk = [...parked].sort((a, b) => compareRegistration(a.registration, b.registration));
  const all = gatePoints(Math.max(4, fl.length + pk.length));
  const gf = new Map<string, Pt>();
  const gp = new Map<string, Pt>();
  fl.forEach((f, i) => gf.set(f.key, all[i]));
  pk.forEach((p, i) => gp.set(p.registration, all[fl.length + i]));
  return { flights: gf, parked: gp, all };
}

// 선의 끝: 시설 아래 가운데에서 비행기까지. 비행기를 모르면 선이 없다(목록에만)
// MCC의 방송(비행기 없음)은 활주로 가운데로 내린다(머지는 활주로에서 일어난다)
export const RUNWAY_MID: Pt = { x: (RUNWAY.x1 + RUNWAY.x2) / 2, y: RUNWAY.y };
export const lineOf = (p: Pulse, spot: Pt | null): { from: Pt; to: Pt } | null => {
  if (!spot) spot = isBroadcast(p) && p.station === "MCC" ? RUNWAY_MID : null;
  if (!spot) return null;
  const s = stationPoint(p.station);
  return { from: { x: s.x, y: s.y + 24 }, to: spot };
};

// PREFLIGHT 교신이 하나라도 있으면 CROSSCHECK를 그린다(없으면 시설도 없다: 조용할 때는 그리지 않는다)
export const showCrosscheck = (txs: readonly Pick<Transmission, "freq">[]) => txs.some((t) => t.freq === "PREFLIGHT");

// RADIO 탭으로 가는 AIRPORT 필터 값(radio-log의 atc.radio.airport와 같은 키)
export const RADIO_AIRPORT_KEY = "atc.radio.airport";

// 주소 #globe/<CODE>에서 AIRPORT 코드. 모양이 맞지 않으면 null
export function airportOfHash(hash: string): string | null {
  const m = /^#?globe\/([A-Za-z0-9]{3,6})\/?$/.exec(hash);
  return m ? m[1].toUpperCase() : null;
}
