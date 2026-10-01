import { project, type LatLon, type View, type XY } from "../../../server/globe.ts";

// GLOBE 그리기 도우미(Globe.tsx와 GlobeFlights.tsx가 같이 쓴다). 계산은 server/globe.ts에 있다.
export const SIZE = 1000; // SVG 좌표계(viewBox)
export const f1 = (n: number) => n.toFixed(1);

// 원판 좌표 꺾은선들 → SVG path
export function pathOf(rings: XY[][], close: boolean, cx: number, cy: number, r: number): string {
  return rings.map((pts) => pts.map((p, i) => `${i ? "L" : "M"}${f1(cx + p.x * r)} ${f1(cy - p.y * r)}`).join("") + (close ? "Z" : "")).join("");
}

// 위도·경도 → SVG 점. depth ≤ 0이면 뒷면이다
export function toPx(p: LatLon, view: View, cx: number, r: number): { x: number; y: number; depth: number } {
  const q = project(p, view);
  return { x: cx + q.x * r, y: cx - q.y * r, depth: q.depth };
}
