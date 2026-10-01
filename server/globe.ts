import { EMPTY_MILESTONES, type Milestones } from "./milestones.ts";
import type { LandBy, LandDecision, LandWhy } from "./land-by.ts";
import type { FlightProgress } from "./progress.ts";

// GLOBE(ATC-254, docs/globe.md): 지구본의 계산. 순수 함수만 두고 그리는 것과 나눈다(server/progress.ts처럼 브라우저에서도 쓴다).
// node 모듈과 상태 파일을 끌어오지 않는다. 각도는 도(degree), 위도 lat(−90..90)·경도 lon(−180..180).
// 이 모듈은 SUPERVISOR의 위치를 모른다. 장소는 허브(홈 AIRPORT)에 대한 방위와 호 거리로만 셈하고, 허브를 어디에 둘지는 화면이 정한다.

export interface LatLon {
  lat: number;
  lon: number;
}
export type Vec = [number, number, number];
export interface XY {
  x: number;
  y: number;
}
// 지구본의 중심(화면 한가운데에 보이는 점)
export type View = LatLon;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const normLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function toVec(p: LatLon): Vec {
  const la = p.lat * RAD;
  const lo = p.lon * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
export function fromVec(v: Vec): LatLon {
  const [x, y, z] = v;
  return { lat: Math.atan2(z, Math.hypot(x, y)) * DEG, lon: Math.atan2(y, x) * DEG };
}
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec): Vec => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

// 두 점 사이의 호 거리(도)
export function distanceDeg(a: LatLon, b: LatLon): number {
  return Math.acos(clamp(dot(toVec(a), toVec(b)), -1, 1)) * DEG;
}

// a에서 b를 보는 처음 방위(북 0, 동 90, 0..360)
export function bearingDeg(a: LatLon, b: LatLon): number {
  const f1 = a.lat * RAD;
  const f2 = b.lat * RAD;
  const dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

// from에서 방위 bearing으로 호 distance(도)만큼 간 점
export function destination(from: LatLon, bearing: number, distance: number): LatLon {
  const f1 = from.lat * RAD;
  const b = bearing * RAD;
  const d = distance * RAD;
  const f2 = Math.asin(clamp(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b), -1, 1));
  const l2 = from.lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 * DEG, lon: normLon(l2 * DEG) };
}

// 큰 원 위의 점(구면 선형 보간). t는 0..1
export function slerp(a: LatLon, b: LatLon, t: number): LatLon {
  const va = toVec(a);
  const vb = toVec(b);
  const w = Math.acos(clamp(dot(va, vb), -1, 1));
  if (w < 1e-9) return { ...a };
  const s = Math.sin(w);
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  return fromVec([ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]]);
}

// ── 정사영 ──────────────────────────────────────────────────────────
// 단위 원판에 그린다: x 오른쪽, y 위쪽, 반지름 1. depth > 0이면 앞면(보이는 쪽).
export function project(p: LatLon, v: View): XY & { depth: number } {
  const f = p.lat * RAD;
  const f0 = v.lat * RAD;
  const dl = (p.lon - v.lon) * RAD;
  return {
    x: Math.cos(f) * Math.sin(dl),
    y: Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(dl),
    depth: Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos(dl),
  };
}

// 화면 점(원판 안) → 위도·경도. 원판 밖이면 null
export function unproject(pt: XY, v: View): LatLon | null {
  const r2 = pt.x * pt.x + pt.y * pt.y;
  if (r2 > 1) return null;
  const z = Math.sqrt(1 - r2);
  const f0 = v.lat * RAD;
  const lat = Math.asin(clamp(z * Math.sin(f0) + pt.y * Math.cos(f0), -1, 1));
  const lon = v.lon * RAD + Math.atan2(pt.x, z * Math.cos(f0) - pt.y * Math.sin(f0));
  return { lat: lat * DEG, lon: normLon(lon * DEG) };
}

// 지평선과 만나는 점. 두 점의 단위 벡터를 선형 보간해 depth가 0이 되는 곳이 큰 원 위의 교차점이다(정규화는 부호를 바꾸지 않는다).
function crossing(a: LatLon, da: number, b: LatLon, db: number): LatLon {
  const t = clamp(da / (da - db), 0, 1);
  const va = toVec(a);
  const vb = toVec(b);
  return fromVec(unit([va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t]));
}
// 지평선 위의 점(depth가 0 근처)은 보이지 않는 쪽으로 친다. 수치 오차로 앞뒤가 흔들리는 것을 막는다.
const EPS = 1e-9;
const seen = (depth: number) => depth > EPS;
const onLimb = (p: LatLon, v: View): XY => {
  const q = project(p, v);
  const n = Math.hypot(q.x, q.y) || 1;
  return { x: q.x / n, y: q.y / n };
};

// 열린 선(경선, 위선, 항적)을 지평선에서 잘라 보이는 조각들로 돌려준다.
export function clipPolyline(points: readonly LatLon[], v: View): XY[][] {
  const out: XY[][] = [];
  let cur: XY[] = [];
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  let prev: { p: LatLon; depth: number } | null = null;
  for (const p of points) {
    const q = project(p, v);
    if (prev) {
      if (seen(prev.depth) !== seen(q.depth)) {
        const c = onLimb(crossing(prev.p, prev.depth, p, q.depth), v);
        if (seen(prev.depth)) {
          cur.push(c);
          flush();
        } else cur.push(c);
      }
    }
    if (seen(q.depth)) cur.push({ x: q.x, y: q.y });
    prev = { p, depth: q.depth };
  }
  flush();
  return out;
}

// 각도 from에서 to까지 반시계로 얼마나 도는가(0..2π). 수치 오차로 0에 아주 가까운 음수가 한 바퀴로 읽히지 않게 붙인다.
const ccwAngle = (from: number, to: number) => {
  const d = (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return d > 2 * Math.PI - 1e-7 ? 0 : d;
};

// 화면 반시계 방향으로 한계선(지평선 원)을 따라 from → to 호를 샘플링한다(끝점 제외).
function limbArc(from: XY, to: XY, stepDeg = 6): XY[] {
  const a0 = Math.atan2(from.y, from.x);
  const d = ccwAngle(a0, Math.atan2(to.y, to.x));
  const n = Math.max(1, Math.ceil((d * DEG) / stepDeg));
  const pts: XY[] = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + (d * i) / n;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return pts;
}

// 닫힌 고리(육지, 밤 영역)를 지평선에서 잘라 채울 수 있는 다각형들로 돌려준다(고리 하나가 여러 조각이 될 수 있다).
// 고리는 구 바깥에서 볼 때 반시계(안쪽이 왼쪽)여야 한다. 원본 육지 데이터는 그렇게 뒤집어 두었다.
// 보이는 구간(run)은 지평선을 들어오는 점에서 나가는 점까지다. 나가는 점에서는 한계선 원을 반시계로 따라가
// 그다음에 만나는 들어오는 점으로 이어진다(안쪽이 왼쪽이므로 나가는 점의 반시계쪽이 안쪽이다).
// 순서대로 잇지 않고 반시계로 가장 가까운 들어오는 점을 고르는 것이 요점이다. 지평선을 여러 번 드나드는 큰 대륙이 맞게 닫힌다.
// 하나도 안 보이면 빈 배열이고, 그래도 고리가 원판 전체를 감싸면(containsCenter) 원판 전체를 돌려준다.
export function clipRing(points: readonly LatLon[], v: View, containsCenter = false): XY[][] {
  const n = points.length;
  if (n < 3) return [];
  const q = points.map((p) => project(p, v));
  const hidden = q.findIndex((s) => !seen(s.depth));
  if (hidden < 0) return [q.map((s) => ({ x: s.x, y: s.y }))];
  if (q.every((s) => !seen(s.depth))) return containsCenter ? [Array.from({ length: 60 }, (_, i) => ({ x: Math.cos((i * 2 * Math.PI) / 60), y: Math.sin((i * 2 * Math.PI) / 60) }))] : [];

  interface Run {
    pts: XY[];
    entry: XY;
    exit: XY;
  }
  const runs: Run[] = [];
  let cur: { pts: XY[]; entry: XY } | null = null;
  for (let k = 1; k <= n; k++) {
    const i = (hidden + k) % n;
    const j = (hidden + k - 1) % n;
    const a = seen(q[j].depth);
    const b = seen(q[i].depth);
    if (!a && b) {
      const c = onLimb(crossing(points[j], q[j].depth, points[i], q[i].depth), v);
      cur = { pts: [c], entry: c };
    }
    if (b && cur) cur.pts.push({ x: q[i].x, y: q[i].y });
    if (a && !b && cur) {
      const c = onLimb(crossing(points[j], q[j].depth, points[i], q[i].depth), v);
      cur.pts.push(c);
      runs.push({ pts: cur.pts, entry: cur.entry, exit: c });
      cur = null;
    }
  }
  const ang = (p: XY) => Math.atan2(p.y, p.x);
  const next = runs.map((r) => {
    let best = 0;
    let bestD = Infinity;
    runs.forEach((o, j) => {
      const d = ccwAngle(ang(r.exit), ang(o.entry));
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    return best;
  });
  const done = new Set<number>();
  const out: XY[][] = [];
  for (let s = 0; s < runs.length; s++) {
    if (done.has(s)) continue;
    const poly: XY[] = [];
    for (let c = s; !done.has(c); c = next[c]) {
      done.add(c);
      poly.push(...runs[c].pts, ...limbArc(runs[c].exit, runs[next[c]].entry));
    }
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

// 중심 c에서 반지름 radius(도)인 작은 원의 고리(반시계). 밤 영역 같은 모자를 그릴 때 쓴다.
export function capRing(center: LatLon, radius: number, steps = 90): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i < steps; i++) pts.push(destination(center, -(360 * i) / steps, radius));
  return pts;
}

// ── 해와 밤 ────────────────────────────────────────────────────────
// 해가 머리 위에 있는 점(적위와 균시차가 들어 있는 적경으로 셈한다. 오차 0.05° 안팎)
export function subsolarPoint(at: Date | number): LatLon {
  const ms = typeof at === "number" ? at : at.getTime();
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0; // J2000으로부터의 날
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  return { lat: dec * DEG, lon: normLon(ra * DEG - gmst) };
}
export const antisolarPoint = (sun: LatLon): LatLon => ({ lat: -sun.lat, lon: normLon(sun.lon + 180) });
// 밤 반구: 해 반대편 점을 중심으로 한 반지름 90°의 모자
export function nightRing(at: Date | number): { ring: LatLon[]; center: LatLon } {
  const center = antisolarPoint(subsolarPoint(at));
  return { ring: capRing(center, 90), center };
}

// ── AIRPORT 배치 ───────────────────────────────────────────────────
// 안정된 해시(FNV-1a, 32비트). AIRPORT id가 같으면 늘 같은 자리에 놓는다.
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const PLACE_MIN_ARC = 12; // 허브에서 가장 가까운 호 거리(도)
export const PLACE_MAX_ARC = 30;
export const PLACE_MIN_SEP = 9; // AIRPORT 사이 최소 간격(도)
const NUDGE_TURN = 47; // 겹치면 방위를 이만큼씩 돌린다
const NUDGE_TRIES = 8;
const NUDGE_STEP = 2.5; // 한 바퀴를 다 돌아도 겹치면 이만큼 더 멀리
const PLACE_LIMIT = 40;

export interface Place {
  id: string;
  bearing: number; // 허브에서 본 방위(0..360)
  distance: number; // 허브에서 호 거리(도). 홈 AIRPORT는 0
  runway: number; // 활주로 방향(0..180)
}

// 허브(홈 AIRPORT)에 대한 상대 배치. 허브는 (0,0)에 두고 셈한다(두 점 사이 거리는 구를 돌려도 같다).
// id 순서로 하나씩 놓고, 이미 놓은 것과 PLACE_MIN_SEP보다 가까우면 방위를 돌리고 그래도 안 되면 더 멀리 놓는다.
// 같은 입력은 같은 출력이다. 홈이 없으면(ids에 없으면) 허브에는 아무것도 놓지 않는다.
export function layoutAirports(ids: readonly string[], homeId: string | null): Place[] {
  const hub: LatLon = { lat: 0, lon: 0 };
  const placed: { place: Place; at: LatLon }[] = [];
  const sorted = [...new Set(ids)].sort();
  const runwayOf = (id: string) => hash32(`${id}#rwy`) % 180;
  if (homeId && sorted.includes(homeId)) placed.push({ place: { id: homeId, bearing: 0, distance: 0, runway: runwayOf(homeId) }, at: hub });
  for (const id of sorted) {
    if (id === homeId) continue;
    let bearing = (hash32(`${id}#brg`) % 3600) / 10;
    let distance = PLACE_MIN_ARC + ((hash32(`${id}#dst`) % 1000) / 1000) * (PLACE_MAX_ARC - PLACE_MIN_ARC);
    let at = destination(hub, bearing, distance);
    for (let lap = 0; lap < 4 && placed.some((p) => distanceDeg(p.at, at) < PLACE_MIN_SEP); lap++) {
      for (let k = 0; k < NUDGE_TRIES && placed.some((p) => distanceDeg(p.at, at) < PLACE_MIN_SEP); k++) {
        bearing = (bearing + NUDGE_TURN) % 360;
        at = destination(hub, bearing, distance);
      }
      if (placed.some((p) => distanceDeg(p.at, at) < PLACE_MIN_SEP)) {
        distance = Math.min(PLACE_LIMIT, distance + NUDGE_STEP);
        at = destination(hub, bearing, distance);
      }
    }
    placed.push({ place: { id, bearing: Math.round(bearing * 10) / 10, distance: Math.round(distance * 10) / 10, runway: runwayOf(id) }, at });
  }
  return placed.map((p) => p.place);
}

// 화면이 허브 위치와 사용자가 옮긴 자리(overrides, id → 위치)로 AIRPORT의 실제 위치를 셈한다. 옮긴 자리가 이긴다.
export function placeAirports(hub: LatLon, places: readonly Place[], overrides: Readonly<Record<string, LatLon>> = {}): Map<string, LatLon> {
  const out = new Map<string, LatLon>();
  for (const p of places) out.set(p.id, overrides[p.id] ?? (p.distance === 0 ? { ...hub } : destination(hub, p.bearing, p.distance)));
  return out;
}

// ── 육지 위의 자리(ATC-291, docs/globe.md "Land placement as built") ─────────────────────
// 실제 공항 목록(web/src/views/globe-geo.ts, [IATA, lat×10, lon×10])을 인자로 받는다. 이 모듈은 표를 들고 있지 않는다.
export type GeoAirport = readonly [iata: string, lat10: number, lon10: number];
export type PlacedAt = LatLon & { iata?: string };
export const LAND_BANDS = [30, 35, 40, 45]; // 허브에서 PLACE_MIN_ARC 이상, 이 호 거리 안에서 후보를 찾는다(없으면 다음 값으로 넓힌다)
export const LAND_MIN_SEP = 3; // 같은 구역에 공항이 몰려도(도쿄 HND·NRT) 이만큼은 떨어진 공항을 먼저 고른다

// 허브 기준 상대 배치(layoutAirports)가 정한 방위에 가장 가까운 실제 공항에 AIRPORT를 놓는다.
// id 순서로 하나씩 놓고 이미 고른 공항은 피하므로, 뒤에 붙는 AIRPORT는 앞의 자리를 옮기지 않는다.
// 홈(distance 0)은 허브 그대로, 옮긴 자리(overrides)가 이긴다. 45° 안에 후보가 없으면(바다 한가운데) placeAirports의 자리 그대로다.
export function placeOnLand(hub: LatLon, places: readonly Place[], airports: readonly GeoAirport[], overrides: Readonly<Record<string, LatLon>> = {}): Map<string, PlacedAt> {
  const out: Map<string, PlacedAt> = placeAirports(hub, places, overrides);
  const cand = airports
    .map((a) => {
      const at: LatLon = { lat: a[1] / 10, lon: a[2] / 10 };
      return { iata: a[0], at, d: distanceDeg(hub, at), b: bearingDeg(hub, at) };
    })
    .filter((c) => c.d >= PLACE_MIN_ARC && c.d <= LAND_BANDS[LAND_BANDS.length - 1])
    .sort((x, y) => (x.iata < y.iata ? -1 : 1));
  const taken: LatLon[] = [];
  const used = new Set<string>();
  const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  for (const p of [...places].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (p.distance === 0 || overrides[p.id]) continue;
    for (const lim of LAND_BANDS) {
      const inBand = cand.filter((c) => c.d <= lim && !used.has(c.iata));
      const apart = inBand.filter((c) => !taken.some((t) => distanceDeg(t, c.at) < LAND_MIN_SEP));
      const pool = apart.length ? apart : inBand;
      if (!pool.length) continue;
      let best = pool[0];
      for (const c of pool) if (turn(c.b, p.bearing) < turn(best.b, p.bearing)) best = c;
      out.set(p.id, { ...best.at, iata: best.iata });
      taken.push(best.at);
      used.add(best.iata);
      break;
    }
  }
  return out;
}

// 브라우저의 시간대(IANA 이름)에서 대표 도시의 위치. 표에 없으면(Etc/*, 모르는 이름) null이라 화면이 UTC 오프셋 규칙으로 돌아간다.
export function tzCity(tz: string | null | undefined, table: Readonly<Record<string, readonly [number, number]>>): LatLon | null {
  const c = tz ? table[tz] : undefined;
  return c ? { lat: c[0] / 10, lon: c[1] / 10 } : null;
}

// ── FLIGHT의 바퀴(circuit)의 모양(G2, docs/globe.md 3.2) ───────────────────────
// 서버가 준 outbound 방위와 AIRPORT 자리·활주로 방향으로 화면이 그린다. 점들은 큰 원 위의 꼭짓점이고 pointAlong이 꼭짓점 사이를 slerp한다.
//   cruise: 출발(AIRPORT) → 회전점(outbound로 size°) → IAF(활주로 뒤쪽)
//   final:  IAF → AIRPORT 위 활주로
//   taxi:   활주로 끝 → 게이트
//   missed: 최종의 끝 가까이에서 활주로 위로 날아 올라 한 바퀴 돌아 IAF로 돌아오는 고리(GO AROUND)
export const RUNWAY_HALF = 1.1; // 활주로 반 길이(도). 화면의 활주로 선과 같다
export interface Circuit {
  gate: LatLon;
  runwayStart: LatLon;
  runwayEnd: LatLon;
  iaf: LatLon;
  cruise: LatLon[];
  final: LatLon[];
  taxi: LatLon[];
  missed: LatLon[];
}

// 바퀴의 크기: 가장 가까운 다른 AIRPORT까지 거리의 0.35배, 2°~7°. 다른 AIRPORT가 없으면 거리를 20°로 친다.
export const circuitSize = (nearestDeg: number | null) => clamp(0.35 * (nearestDeg ?? 20), 2, 7);

export function circuitOf(airport: LatLon, runway: number, outbound: number, size: number): Circuit {
  const runwayStart = destination(airport, runway + 180, RUNWAY_HALF);
  const runwayEnd = destination(airport, runway, RUNWAY_HALF);
  const gate = destination(airport, runway + 90, 0.6);
  const iaf = destination(runwayStart, runway + 180, 0.55 * size);
  const turn = destination(airport, outbound, size);
  const finalPoint = slerp(iaf, airport, 0.8);
  const m1 = destination(runwayEnd, runway, 0.3 * size);
  const m2 = destination(m1, runway + 90, 0.4 * size);
  return {
    gate,
    runwayStart,
    runwayEnd,
    iaf,
    cruise: [airport, turn, iaf],
    final: [iaf, airport],
    taxi: [runwayEnd, gate],
    missed: [finalPoint, m1, m2, iaf],
  };
}

// 꺾은선 위의 점과 그 자리의 진행 방위. t는 0..1(전체 길이 몫). 점이 하나뿐이면 그 점
export function pointAlong(path: readonly LatLon[], t: number): { at: LatLon; heading: number } {
  if (path.length === 0) return { at: { lat: 0, lon: 0 }, heading: 0 };
  if (path.length === 1) return { at: path[0], heading: 0 };
  const lens = path.slice(1).map((p, i) => distanceDeg(path[i], p));
  const total = lens.reduce((a, b) => a + b, 0);
  const at = (u: number): LatLon => {
    let d = clamp(u, 0, 1) * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) return slerp(path[i], path[i + 1], lens[i] > 0 ? clamp(d / lens[i], 0, 1) : 0);
      d -= lens[i];
    }
    return path[path.length - 1];
  };
  const here = at(t);
  const ahead = t < 0.98 ? at(t + 0.02) : null;
  return { at: here, heading: ahead ? bearingDeg(here, ahead) : bearingDeg(at(t - 0.02), here) };
}

// 홀딩 레이스트랙(오른쪽 선회). center를 가운데로 heading 방향으로 length°, 너비 width°. 닫힌 꼭짓점 열
export function racetrack(center: LatLon, heading: number, length: number, width: number, arcSteps = 6): LatLon[] {
  const at = (u: number, v: number) => destination(destination(center, heading, u), heading + 90, v);
  const pts: LatLon[] = [at(-length / 2, -width / 2), at(length / 2, -width / 2)];
  for (let i = 1; i < arcSteps; i++) {
    const a = (Math.PI * i) / arcSteps; // 끝 반원: 오른쪽(−v)에서 왼쪽(+v)으로
    pts.push(at(length / 2 + (width / 2) * Math.sin(a), -(width / 2) * Math.cos(a)));
  }
  pts.push(at(length / 2, width / 2), at(-length / 2, width / 2));
  for (let i = 1; i < arcSteps; i++) {
    const a = (Math.PI * i) / arcSteps;
    pts.push(at(-length / 2 - (width / 2) * Math.sin(a), (width / 2) * Math.cos(a)));
  }
  return pts;
}

// ── GET /api/globe의 장면(G1: airports[]와 parked[]) ──────────────────
export interface GlobeAirportIn {
  id: string;
  code: string;
  name: string;
  repo: string;
}
export interface GlobeSessionIn {
  repo: string | null;
  status: "busy" | "idle" | "dead";
}
export interface GlobeAircraftIn {
  registration: string;
  callsign: string; // 화면이 콜사인 규칙(server/callsign.ts)을 따로 끌어오지 않게 서버가 붙인다
  base: string | null; // AIRPORT 코드
  flying: boolean; // 지금 STAND를 쥔 FLIGHT가 있다
  retired: boolean;
}
export interface GlobeScene {
  at: string;
  home: string | null; // AIRPORT 코드
  airports: { id: string; code: string; name: string; bearing: number; distance: number; runway: number }[];
  parked: { registration: string; callsign: string; airport: string }[];
  flights: GlobeFlight[]; // G2
}

// ── FLIGHT의 장면(G2, docs/globe.md 3.2·3.3) ───────────────────────────
// FLIGHT는 자기 AIRPORT에서 떠서 같은 AIRPORT로 내리는 한 바퀴(circuit)를 돈다. 서버는 상태와 그 구간 안의 위치 t만 정하고,
// 바퀴의 모양(출발 → 회전점 → IAF → 최종 → 활주로 → 게이트)은 화면이 AIRPORT 자리와 outbound 방위로 그린다.
// 위치 t는 진행 막대(server/progress.ts)의 marker에서만 온다(추정은 지금 구간 안에서만). 추정이 없으면 t = 0이고 퍼센트·ETA는 어디에도 없다.
export type GlobeFlightState = "boarding" | "cruise" | "hold" | "final" | "goAround" | "taxi" | "arrived" | "nordo";

export interface GlobeFlight {
  key: string;
  airport: string; // AIRPORT 코드
  aircraft: string | null; // REGISTRATION. STAND를 쥔 AIRCRAFT가 없으면 null
  callsign: string | null;
  state: GlobeFlightState;
  t: number; // 0..1, 그 상태의 구간 안. cruise: 출발→IAF, hold: 그 바퀴 위의 점(IAF면 1), final: IAF→활주로, 나머지는 0
  outbound: number; // 나가는 방위(0..360). FLIGHT key의 해시를, 같은 AIRPORT의 다른 FLIGHT에서 떨어지게 밀어서
  late: boolean; // 지금 구간이 보통 범위의 p75를 넘었다(IAF 앞에서 멈춘다)
  blocks: string[]; // 착륙을 막는 조건 코드(APPROACH일 때)
  fadeFrom: string | null; // arrived: 서서히 사라지기 시작한 시각(ISO). IN, RTS가 없으면 ON
  reverted: boolean; // ON의 PR이 되돌려졌다
  // 착륙을 누가 해 주나(ATC-300). landing 구간에 열린 PR이 있는 FLIGHT(hold·final·goAround)만이고 나머지는 null.
  // landBy는 TOWER가 쓰는 landByOf 그대로, landWhy는 supervisor일 때의 이유 코드(land-by.ts의 LandWhy). 옛 장면을 읽는 쪽은 없을 수 있다
  landBy?: LandBy | null;
  landWhy?: LandWhy | null;
}

export const CRUISE_CAP = 0.9; // cruise·final의 t는 IAF·활주로 앞에서 멈춘다(도착은 마일스톤이 알려 주는 것)
export const ARRIVED_FADE_MIN = 30;
export const GO_AROUND_MIN = 30;
const OUTBOUND_MIN_SEP = 25;

export interface GlobeAircraftState {
  registration: string;
  callsign: string;
  status: "busy" | "idle" | "dead" | "absent";
  flying: string[]; // 지금 STAND를 쥔 FLIGHT key
}
export interface GlobeFlightsIn {
  now: number;
  tickets: readonly { key: string; stateType: string }[];
  workspaces: readonly { ticketKey: string | null; repo: string; isMain: boolean }[];
  pulls: readonly { ticketKey: string | null; repo: string; landing: "CLEARED" | "APPROACH"; blocks: readonly { code: string }[]; number?: number; head?: string }[];
  clearances: readonly { type: string; flight: string | null; at: string; cancelledAt: string | null }[];
  aircraft: readonly GlobeAircraftState[];
  milestones: Readonly<Record<string, Milestones>>;
  progress: Readonly<Record<string, FlightProgress>>;
  // 누가 착륙시키나(ATC-300): 부르는 쪽이 landDecisionOf를 MCC 정보와 묶어 넘긴다. 없으면 landBy·landWhy는 모두 null
  land?: (pull: { repo: string; number: number; head: string }) => LandDecision;
}

const SEGMENT_INDEX: Record<string, number> = { work: 0, landing: 1, rts: 2, done: 3 };
const CLOSED_TICKET = new Set(["completed", "canceled", "duplicate"]);
const isConflictBlock = (code: string) => code === "dirty" || code === "behind";
const clamp01 = (x: number) => clamp(x, 0, 1);

// 같은 AIRPORT의 FLIGHT끼리 나가는 방위가 겹치지 않게: key 순서로 하나씩, 이미 정한 것과 25°보다 가까우면 37°씩 돌린다.
// 앞선 key의 방위는 뒤에 오는 key가 늘어도 바뀌지 않는다.
export function outboundBearings(keys: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const taken: number[] = [];
  for (const key of [...new Set(keys)].sort()) {
    let b = hash32(`${key}#out`) % 360;
    const apart = (x: number) => taken.every((t) => Math.abs(((x - t + 540) % 360) - 180) >= OUTBOUND_MIN_SEP);
    for (let k = 0; k < 12 && !apart(b); k++) b = (b + 37) % 360;
    taken.push(b);
    out.set(key, b);
  }
  return out;
}

// 열린 HOLD: 그 FLIGHT의 HOLD CLEARANCE가 있고 그 뒤에 CONTINUE·LAND가 없다(취소된 것은 세지 않는다)
function holdIsOpen(key: string, clearances: GlobeFlightsIn["clearances"]): boolean {
  const mine = clearances.filter((c) => c.flight === key && !c.cancelledAt).sort((a, b) => a.at.localeCompare(b.at));
  const lastHold = mine.findLast((c) => c.type === "HOLD");
  return Boolean(lastHold && !mine.some((c) => (c.type === "CONTINUE" || c.type === "LAND") && c.at > lastHold.at));
}
const recentGoAround = (key: string, clearances: GlobeFlightsIn["clearances"], now: number) =>
  clearances.some((c) => c.type === "GO AROUND" && c.flight === key && !c.cancelledAt && now >= Date.parse(c.at) && now - Date.parse(c.at) < GO_AROUND_MIN * 60_000);

// 지금 STAND를 쥐었거나 진행 중이거나 막 도착한 FLIGHT마다 한 줄. 순수 함수.
export function flightsOf(input: GlobeFlightsIn, airports: readonly GlobeAirportIn[]): GlobeFlight[] {
  const { now } = input;
  const codeOfRepo = (repo: string | null | undefined) => airports.find((a) => a.repo === repo)?.code ?? null;
  const keys = new Set<string>([...Object.keys(input.progress), ...input.aircraft.flatMap((a) => a.flying)]);
  const rows: Omit<GlobeFlight, "outbound">[] = [];
  for (const key of [...keys].sort()) {
    const ws = input.workspaces.find((w) => w.ticketKey === key && !w.isMain);
    const pull = input.pulls.find((p) => p.ticketKey === key) ?? null;
    const airport = codeOfRepo(ws?.repo) ?? codeOfRepo(pull?.repo);
    if (!airport) continue; // 어느 AIRPORT인지 모르면 놓을 자리가 없다
    const holder = input.aircraft.find((a) => a.flying.includes(key)) ?? null;
    const m = input.milestones[key] ?? EMPTY_MILESTONES;
    const p = input.progress[key] ?? null;
    const closed = CLOSED_TICKET.has(input.tickets.find((t) => t.key === key)?.stateType ?? "");
    const base = { key, airport, aircraft: holder?.registration ?? null, callsign: holder?.callsign ?? null, late: Boolean(p?.late), blocks: [] as string[], fadeFrom: null as string | null, reverted: Boolean(m.reverted), landBy: null as LandBy | null, landWhy: null as LandWhy | null };

    // 끝난 FLIGHT: 30분 동안 게이트에서 서서히 사라진다
    if (p?.segment === "done") {
      const from = m.in ?? m.on ?? m.out;
      if (!from || now - Date.parse(from) >= ARRIVED_FADE_MIN * 60_000) continue;
      rows.push({ ...base, state: "arrived", t: 0, fadeFrom: from, late: false });
      continue;
    }
    if (closed) continue; // 이미 닫힌 이슈의 지난 FLIGHT는 그리지 않는다
    // OUT이 없으면 STAND만 쥔 채 게이트에서 출발을 기다린다
    if (!p) {
      if (holder) rows.push({ ...base, state: holder.status === "dead" ? "nordo" : "boarding", t: 0 });
      continue;
    }
    // 구간 안의 위치: 진행 막대 marker가 (구간 번호 + 구간 안 몫)/4다. 추정이 없으면 몫은 0
    const frac = p.marker === null ? 0 : clamp01(p.marker * 4 - (SEGMENT_INDEX[p.segment] ?? 0));
    const cruiseT = Math.min(frac, CRUISE_CAP);
    const blocks = pull && pull.landing === "APPROACH" ? pull.blocks.map((b) => b.code) : [];
    const holdOpen = holdIsOpen(key, input.clearances);
    const goAround = Boolean(pull && pull.landing !== "CLEARED" && (pull.blocks.some((b) => isConflictBlock(b.code)) || recentGoAround(key, input.clearances, now)));
    let state: GlobeFlightState;
    let t = 0;
    if (holder?.status === "dead") {
      state = "nordo";
      t = p.segment === "work" ? cruiseT : p.segment === "landing" ? 1 : 0;
    } else if (p.segment === "rts") {
      state = "taxi";
    } else if (p.segment === "landing") {
      if (goAround) state = "goAround";
      else if (blocks.length || holdOpen) {
        state = "hold";
        t = 1;
      } else {
        state = "final";
        t = cruiseT;
      }
    } else if (holder?.status === "idle" || holdOpen) {
      state = "hold";
      t = cruiseT;
    } else {
      state = "cruise";
      t = cruiseT;
    }
    // 누가 착륙시키나: landing 구간의 열린 PR이 있는 hold·final·goAround만. 규칙은 landByOf(land-by.ts) 한 곳이다
    const landing = p.segment === "landing" && pull && pull.number !== undefined && pull.head !== undefined && (state === "hold" || state === "final" || state === "goAround");
    const d = landing && input.land ? input.land({ repo: pull.repo, number: pull.number!, head: pull.head! }) : null;
    rows.push({ ...base, state, t, blocks, landBy: d?.by ?? null, landWhy: d?.why ?? null });
  }
  // 나가는 방위: AIRPORT마다 key 순서로
  const outbound = new Map<string, number>();
  for (const code of new Set(rows.map((r) => r.airport))) {
    for (const [k, b] of outboundBearings(rows.filter((r) => r.airport === code).map((r) => r.key))) outbound.set(`${code}|${k}`, b);
  }
  return rows.map((r) => ({ ...r, outbound: outbound.get(`${r.airport}|${r.key}`)! }));
}

// 홈 AIRPORT의 기본값: 살아 있는 세션이 가장 많은 곳, 없으면 코드순 첫 곳. 같은 수면 코드순
export function defaultHome(airports: readonly GlobeAirportIn[], sessions: readonly GlobeSessionIn[]): string | null {
  const count = new Map<string, number>();
  for (const s of sessions) {
    const a = airports.find((x) => x.repo === s.repo);
    if (a && s.status !== "dead") count.set(a.code, (count.get(a.code) ?? 0) + 1);
  }
  const sorted = [...airports].map((a) => a.code).sort();
  return [...sorted].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || (a < b ? -1 : 1))[0] ?? null;
}

// 열린 AIRPORT만 받는다(폐쇄·경로 없음은 부르는 쪽이 뺀다). home이 모르는 코드면 기본값을 쓴다.
// parked는 FLIGHT가 없는 AIRCRAFT의 base. base가 없거나 모르는 AIRPORT면 그리지 않는다.
// flights가 있으면 FLIGHT(G2)를 얹고, 그려진 FLIGHT의 AIRCRAFT는 세워 두지 않는다. 없으면 flights는 비고 parked는 flying 표시로 가른다(G1).
export function globeSceneOf(input: { at: Date; airports: readonly GlobeAirportIn[]; sessions: readonly GlobeSessionIn[]; aircraft: readonly GlobeAircraftIn[]; home?: string | null; flights?: GlobeFlightsIn }): GlobeScene {
  const { airports } = input;
  const def = defaultHome(airports, input.sessions);
  const home = input.home && airports.some((a) => a.code === input.home) ? input.home : def;
  const homeId = airports.find((a) => a.code === home)?.id ?? null;
  const places = new Map(layoutAirports(airports.map((a) => a.id), homeId).map((p) => [p.id, p]));
  const codes = new Set(airports.map((a) => a.code));
  const flights = input.flights ? flightsOf(input.flights, airports) : [];
  const drawn = new Set(flights.flatMap((f) => (f.aircraft ? [f.aircraft] : [])));
  return {
    at: input.at.toISOString(),
    home,
    airports: [...airports]
      .sort((a, b) => (a.code < b.code ? -1 : 1))
      .map((a) => {
        const p = places.get(a.id)!;
        return { id: a.id, code: a.code, name: a.name, bearing: p.bearing, distance: p.distance, runway: p.runway };
      }),
    parked: input.aircraft
      .filter((x) => (input.flights ? !drawn.has(x.registration) : !x.flying) && !x.retired && x.base && codes.has(x.base))
      .map((x) => ({ registration: x.registration, callsign: x.callsign, airport: x.base! }))
      .sort((a, b) => (a.registration < b.registration ? -1 : 1)),
    flights,
  };
}
