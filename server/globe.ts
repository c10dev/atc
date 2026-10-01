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
export function globeSceneOf(input: { at: Date; airports: readonly GlobeAirportIn[]; sessions: readonly GlobeSessionIn[]; aircraft: readonly GlobeAircraftIn[]; home?: string | null }): GlobeScene {
  const { airports } = input;
  const def = defaultHome(airports, input.sessions);
  const home = input.home && airports.some((a) => a.code === input.home) ? input.home : def;
  const homeId = airports.find((a) => a.code === home)?.id ?? null;
  const places = new Map(layoutAirports(airports.map((a) => a.id), homeId).map((p) => [p.id, p]));
  const codes = new Set(airports.map((a) => a.code));
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
      .filter((x) => !x.flying && !x.retired && x.base && codes.has(x.base))
      .map((x) => ({ registration: x.registration, callsign: x.callsign, airport: x.base! }))
      .sort((a, b) => (a.registration < b.registration ? -1 : 1)),
  };
}
