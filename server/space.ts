import { type GlobeFlightState, type GlobeScene, hash32 } from "./globe.ts";

// GLOBE G4(ATC-261, docs/globe.md 5): SPACE 테마의 계산. 같은 장면(GET /api/globe)을 우주로 그린다. 순수 함수(브라우저에서도 쓴다).
// 새 데이터도 새 상태도 없다: 장면의 airports(bearing·distance)와 flights(state·t·outbound)만 자리로 바꾼다.
// 좌표는 SVG 좌표(원점이 가운데, x 오른쪽, y 아래). 각도는 위가 0°, 시계 방향이다.

export type GlobeMode = "globe" | "space";
// 저장된 값이 있으면 그것, 처음이면 night(Night Sky) 테마는 SPACE로, 나머지는 GLOBE로 연다
export function modeOf(saved: unknown, theme: string): GlobeMode {
  if (saved === "globe" || saved === "space") return saved;
  return theme === "night" ? "space" : "globe";
}

export const SPACE_SIZE = 1000;
export const EARTH_R = 44; // 홈 AIRPORT(지구)
export const PLANET_R = 20;
export const RING_MIN = 190; // 가장 안쪽 행성 궤도 반지름(지구의 비행 궤도 바깥)
export const RING_MAX = 450;
export const ORBIT = 2.3; // 비행 궤도(몸 반지름의 배수). 1 = 지표(발사대)
export const PARK = 3.0; // 대기 궤도(HOLD, 착륙이 막힘)

export interface Body {
  id: string;
  code: string;
  home: boolean; // 지구
  x: number;
  y: number;
  r: number; // 몸의 반지름(px)
  ring: number; // 그 몸의 궤도 반지름(원점에서, px). 지구는 0
}

// 지구는 홈 AIRPORT(없으면 허브에서 가장 가까운 것). 나머지는 장면의 distance 순위로 궤도를 정하고(같으면 id 순),
// 각도는 bearing 그대로라 같은 날 같은 자리에 있다. 궤도 반지름은 순위로만 정해 몸이 한 줄로 퍼지지 않게 한다
export function layoutBodies(scene: Pick<GlobeScene, "airports" | "home">): Body[] {
  const list = [...scene.airports];
  if (!list.length) return [];
  const earth = list.find((a) => a.code === scene.home) ?? [...list].sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1))[0]!;
  const others = list.filter((a) => a.id !== earth.id).sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1));
  const out: Body[] = [{ id: earth.id, code: earth.code, home: true, x: 0, y: 0, r: EARTH_R, ring: 0 }];
  others.forEach((a, i) => {
    const ring = RING_MIN + ((RING_MAX - RING_MIN) * (i + 0.5)) / others.length;
    const rad = (a.bearing * Math.PI) / 180;
    out.push({ id: a.id, code: a.code, home: false, x: ring * Math.sin(rad), y: -ring * Math.cos(rad), r: PLANET_R, ring });
  });
  return out;
}

// ── FLIGHT: 발사, 궤도, 착륙 ─────────────────────────────────────────
// 자기 몸 둘레의 극좌표: r은 몸 반지름의 배수, ang는 위가 0°인 시계 방향. 발사대는 outbound 방위의 지표다.
export interface Polar {
  r: number;
  ang: number;
}
const ease = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const ORBIT_SWEEP = 300; // cruise가 도는 각(도). 남은 60°는 하강(final)

export function polarOf(state: GlobeFlightState, t: number, out: number): Polar {
  const k = clamp01(t);
  switch (state) {
    case "cruise":
    case "nordo":
      return { r: 1 + (ORBIT - 1) * ease(clamp01(k / 0.2)), ang: out + ORBIT_SWEEP * k };
    case "hold":
      return { r: PARK, ang: out + ORBIT_SWEEP * k };
    case "final":
      return { r: ORBIT - (ORBIT - 1) * ease(k), ang: out + ORBIT_SWEEP + (360 - ORBIT_SWEEP) * k };
    case "goAround": {
      // 하강 끝에서 다시 올라갔다 내려오는 한 번의 고리
      const m = missedLoop(out);
      return m[Math.round(0.5 * (m.length - 1))]!;
    }
    case "taxi":
      return { r: 1, ang: out - 12 * (1 - k) };
    case "boarding":
    case "arrived":
      return { r: 1, ang: out };
  }
}

// 고어라운드 고리: 지표 가까이(최종의 80 %)에서 위로 올라 궤도에 닿았다가 IAF 쪽으로 돌아온다
export function missedLoop(out: number, n = 24): Polar[] {
  const pts: Polar[] = [];
  const a0 = out + ORBIT_SWEEP + (360 - ORBIT_SWEEP) * 0.8;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push({ r: 1.15 + (ORBIT - 1.15) * Math.sin(Math.PI * s), ang: a0 - 40 * s });
  }
  return pts;
}

// 대기 궤도 전체(원)
export function parkLoop(start = 0, n = 48): Polar[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ r: PARK, ang: start + (360 * i) / n }));
}

// 한 바퀴의 선(cruise + final). 옅게 그린다
export function routeOf(out: number, n = 36): Polar[] {
  const pts: Polar[] = [];
  for (let i = 0; i <= n; i++) pts.push(polarOf("cruise", i / n, out));
  for (let i = 1; i <= n / 3; i++) pts.push(polarOf("final", i / (n / 3), out));
  return pts;
}

export interface XY {
  x: number;
  y: number;
}
// 몸 중심 + 극좌표 → SVG 점
export function pointOf(center: XY, bodyR: number, p: Polar): XY {
  const a = (p.ang * Math.PI) / 180;
  return { x: center.x + bodyR * p.r * Math.sin(a), y: center.y - bodyR * p.r * Math.cos(a) };
}

const norm360 = (a: number) => ((a % 360) + 360) % 360;
// 비행기가 향하는 쪽(위가 0°, 시계 방향). 움직이는 상태는 진행 방향, 발사대에 선 상태는 바깥쪽(nose out)
export function headingOf(state: GlobeFlightState, t: number, out: number): number {
  if (state === "boarding" || state === "arrived" || state === "taxi") return norm360(polarOf(state, t, out).ang);
  if (state === "goAround") {
    const m = missedLoop(out);
    const i = Math.round(0.5 * (m.length - 1));
    return headingBetween(m[i - 1]!, m[i + 1]!);
  }
  if (state === "hold") return headingBetween(polarOf("hold", t, out), polarOf("hold", t + 0.02, out));
  const d = 0.02;
  const a = t + d > 1 ? t - d : t;
  const b = t + d > 1 ? t : t + d;
  return headingBetween(polarOf(state, a, out), polarOf(state, b, out));
}
function headingBetween(a: Polar, b: Polar): number {
  const p = pointOf({ x: 0, y: 0 }, 1, a);
  const q = pointOf({ x: 0, y: 0 }, 1, b);
  return norm360((Math.atan2(q.x - p.x, -(q.y - p.y)) * 180) / Math.PI);
}

// ── 별(고정 배경) ───────────────────────────────────────────────────
// 시드가 같으면 같은 별. 움직이지 않는다(Starfield.tsx는 화면당 하나의 애니메이션이라 따로 둔다)
export interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
}
export function starsOf(n = 90, size = SPACE_SIZE, seed = "atc-space"): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < n; i++) {
    const h = hash32(`${seed}#${i}`);
    const h2 = hash32(`${seed}#${i}#y`);
    const h3 = hash32(`${seed}#${i}#s`);
    out.push({ x: (h % 10_000) / 10_000 * size, y: (h2 % 10_000) / 10_000 * size, r: 0.6 + (h3 % 3) * 0.4, o: 0.25 + ((h3 >>> 4) % 5) * 0.12 });
  }
  return out;
}
