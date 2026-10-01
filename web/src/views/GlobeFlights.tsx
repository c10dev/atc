import { useMemo } from "react";
import { flightKeyOf } from "../../../server/detail.ts";
import {
  ARRIVED_FADE_MIN,
  circuitOf,
  circuitSize,
  clamp,
  clipPolyline,
  distanceDeg,
  destination,
  pointAlong,
  racetrack,
  type GlobeFlight,
  type GlobeFlightState,
  type GlobeScene,
  type LatLon,
  type View,
} from "../../../server/globe.ts";
import { f1, pathOf, toPx } from "./globe-draw.ts";

// GLOBE G2(ATC-260, docs/globe.md 3.2·3.3): FLIGHT마다 자기 AIRPORT에서 뜨고 내리는 바퀴와 그 위의 비행기.
// 서버가 상태(state)와 구간 안의 위치(t)를 정해서 보내고, 여기서는 그 자리를 그리기만 한다. 홀딩 레이스트랙과 고어라운드 고리는
// settings.motion이 켜졌을 때만 SVG 애니메이션(animateMotion)으로 돈다. 꺼져 있으면 멈춘 그림이다.

export const STATE_LABEL: Record<GlobeFlightState, string> = {
  boarding: "BOARDING",
  cruise: "ENROUTE",
  hold: "HOLDING",
  final: "FINAL",
  goAround: "GO AROUND",
  taxi: "TAXI",
  arrived: "ARRIVED",
  nordo: "NORDO",
};
const flightNumber = (key: string) => key.replace("-", "");

// 상태 → 색 토큰(:root). hold·goAround·late는 호박, 나는 중은 레이더, 나머지는 흐리게
function toneOf(f: GlobeFlight): "radar" | "amber" | "faint" {
  if (f.state === "nordo" || f.state === "boarding" || f.state === "arrived") return "faint";
  if (f.state === "hold" || f.state === "goAround" || f.late) return "amber";
  return "radar";
}

interface Placed {
  f: GlobeFlight;
  tone: "radar" | "amber" | "faint";
  at: LatLon;
  heading: number;
  path: LatLon[] | null; // 비행기가 도는 닫힌 길(홀딩 레이스트랙, 고어라운드 고리)
  route: LatLon[]; // 바퀴의 선(cruise + final)
  opacity: number;
}

export function FlightsLayer({ scene, positions, view, C, R, motion, now }: { scene: GlobeScene; positions: ReadonlyMap<string, LatLon>; view: View; C: number; R: number; motion: boolean; now: number }) {
  const placed = useMemo<Placed[]>(() => {
    const byCode = new Map(scene.airports.map((a) => [a.code, a]));
    const out: Placed[] = [];
    for (const f of scene.flights) {
      const a = byCode.get(f.airport);
      const apt = a && positions.get(a.id);
      if (!a || !apt) continue;
      let nearest: number | null = null;
      for (const o of scene.airports) {
        const p = o.id === a.id ? null : positions.get(o.id);
        if (p) nearest = Math.min(nearest ?? Infinity, distanceDeg(apt, p));
      }
      const size = circuitSize(nearest);
      const c = circuitOf(apt, a.runway, f.outbound, size);
      let at = c.gate;
      let heading = a.runway;
      let path: LatLon[] | null = null;
      if (f.state === "cruise" || f.state === "nordo") {
        ({ at, heading } = pointAlong(c.cruise, f.t));
      } else if (f.state === "final") {
        ({ at, heading } = pointAlong(c.final, f.t));
      } else if (f.state === "taxi") {
        ({ at, heading } = pointAlong(c.taxi, f.t));
      } else if (f.state === "hold") {
        const q = pointAlong(c.cruise, f.t);
        at = q.at;
        heading = q.heading;
        path = racetrack(q.at, q.heading, 0.55 * size, 0.25 * size);
      } else if (f.state === "goAround") {
        ({ at, heading } = pointAlong(c.missed, 0.5));
        path = c.missed;
      }
      const fade = f.state === "arrived" && f.fadeFrom ? clamp(1 - (now - Date.parse(f.fadeFrom)) / (ARRIVED_FADE_MIN * 60_000), 0, 1) : 1;
      const route = f.state === "boarding" || f.state === "arrived" || f.state === "taxi" ? [] : [...c.cruise, ...c.final];
      out.push({ f, tone: toneOf(f), at, heading, path, route, opacity: 0.25 + 0.75 * fade });
    }
    return out;
  }, [scene, positions, now]);

  // 바퀴의 선(옅게). 화면 뒤쪽은 지평선에서 잘린다
  const routes = useMemo(() => placed.map((p) => ({ key: p.f.key, tone: p.tone, d: pathOf(clipPolyline(p.route, view), false, C, C, R) })), [placed, view.lat, view.lon, R]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <g className="globe-flights">
      {routes.map((r) => r.d && <path key={`r-${r.key}`} className={`globe-route tone-${r.tone}`} d={r.d} />)}
      {placed.map((p) => {
        const px = toPx(p.at, view, C, R);
        if (px.depth <= 0.02) return null;
        const ahead = toPx(destination(p.at, p.heading, 0.4), view, C, R);
        const angle = (Math.atan2(ahead.x - px.x, -(ahead.y - px.y)) * 180) / Math.PI;
        const anim = motion && p.path && p.f.state !== "nordo";
        const loop = p.path ? p.path.map((q) => toPx(q, view, C, R)) : [];
        const loopD = loop.length ? `M${loop.map((q) => `${f1(q.x)} ${f1(q.y)}`).join("L")}${p.f.state === "hold" ? "Z" : ""}` : "";
        const key = flightKeyOf(p.f.key);
        const marks = [p.f.state === "goAround" ? "GA" : p.f.state === "nordo" ? "NORDO" : "", p.f.late ? "LATE" : "", p.f.reverted ? "REVERTED" : ""].filter(Boolean).join(" ");
        const tip = `${p.f.callsign ?? "STAND 없음"} · ${flightNumber(p.f.key)} · ${STATE_LABEL[p.f.state]}${p.f.late ? " (길어짐)" : ""}${p.f.blocks.length ? ` — ${p.f.blocks.join(", ")}` : ""}`;
        const glyph = (
          <>
            <circle className="globe-plane-hit" r={14} />
            <path className={`globe-plane tone-${p.tone}${p.f.state === "nordo" ? " nordo" : ""}`} d="M0 -9 L6 8 L0 4 L-6 8 Z" transform={anim ? "rotate(90)" : undefined} />
          </>
        );
        const body = (
          <>
            <title>{tip}</title>
            {p.f.state === "hold" && loop.length > 0 && <path className={`globe-hold tone-${p.tone}`} d={loopD} />}
            {p.f.state === "goAround" && loop.length > 0 && <path className="globe-hold tone-amber" d={loopD} />}
            {anim ? (
              <g>
                <animateMotion dur={p.f.state === "hold" ? "9s" : "7s"} repeatCount="indefinite" rotate="auto" path={loopD} />
                {glyph}
              </g>
            ) : (
              <g transform={`translate(${f1(px.x)} ${f1(px.y)}) rotate(${f1(angle)})`}>{glyph}</g>
            )}
            <text className={`globe-plane-label tone-${p.tone}`} x={f1(px.x + 12)} y={f1(px.y + 22)}>
              {flightNumber(p.f.key)}
              {marks && <tspan className="globe-plane-mark"> {marks}</tspan>}
            </text>
          </>
        );
        return key ? (
          <a key={p.f.key} href={`#flight/${key}`} data-flight={p.f.key} className="globe-flight" style={{ opacity: p.opacity }}>
            {body}
          </a>
        ) : (
          <g key={p.f.key} data-flight={p.f.key} className="globe-flight" style={{ opacity: p.opacity }}>
            {body}
          </g>
        );
      })}
    </g>
  );
}

// 지구본 옆 글 목록(스크린 리더, 좁은 화면): 콜사인, FLIGHT, 상태, 막는 조건
export function FlightRows({ flights }: { flights: readonly GlobeFlight[] }) {
  return (
    <section className="globe-rows globe-flight-rows" aria-label="FLIGHT 목록">
      <h2 className="globe-rows-head">FLIGHTS</h2>
      {flights.length === 0 ? (
        <p className="empty">지금 나는 FLIGHT가 없다.</p>
      ) : (
        <ul>
          {flights.map((f) => {
            const k = flightKeyOf(f.key);
            return (
              <li key={f.key}>
                <span className="globe-row-code">{k ? <a href={`#flight/${k}`}>{flightNumber(f.key)}</a> : flightNumber(f.key)}</span>
                <span className="globe-row-name">
                  {f.callsign ?? "STAND 없음"} · {f.airport} · <b className={`tone-${toneOf(f)}`}>{STATE_LABEL[f.state]}</b>
                  {f.late && <em> 길어짐</em>}
                  {f.reverted && <em> 되돌려짐</em>}
                </span>
                {f.blocks.length > 0 && <span className="globe-row-parked">{f.blocks.join(" · ")}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
