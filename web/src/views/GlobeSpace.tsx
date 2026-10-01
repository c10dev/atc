import { useMemo } from "react";
import { flightKeyOf } from "../../../server/detail.ts";
import type { GlobeScene } from "../../../server/globe.ts";
import { headingOf, layoutBodies, missedLoop, ORBIT, PARK, parkLoop, pointOf, type Polar, polarOf, routeOf, SPACE_SIZE, starsOf, type XY } from "../../../server/space.ts";
import { f1 } from "./globe-draw.ts";
import { fadeOf, flightMarks, flightNumber, flightTip, toneOf } from "./GlobeFlights.tsx";
import "./GlobeSpace.css";

// GLOBE G4(ATC-261, docs/globe.md 5): 같은 장면(GET /api/globe)을 우주로 그린다. 지구 = 홈 AIRPORT, 행성 = 다른 AIRPORT,
// FLIGHT = 자기 몸 둘레의 발사·궤도·착륙. 새 데이터도 새 상태도 없고, 상태·색·툴팁·링크는 지구본과 같은 도우미(GlobeFlights.tsx)를 쓴다.
// 자리는 server/space.ts(순수). 별은 움직이지 않는 고정 그림이다. 궤도의 홀딩·고어라운드 움직임은 settings.motion이 켜졌을 때만 돈다.
// OUTSTATION·REPOSITION의 전이 궤도(G3)는 장면에 moves[]가 생기면 더한다. 아직 없어 그리지 않는다.

const HALF = SPACE_SIZE / 2;
const STARS = starsOf(90);

const dOf = (pts: XY[], close = false) => `M${pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join("L")}${close ? "Z" : ""}`;

export function SpaceView({ scene, motion, now }: { scene: GlobeScene; motion: boolean; now: number }) {
  const bodies = useMemo(() => layoutBodies(scene), [scene]);
  const byCode = useMemo(() => new Map(bodies.map((b) => [b.code, b])), [bodies]);
  const parked = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of scene.parked) m.set(p.airport, [...(m.get(p.airport) ?? []), p.callsign]);
    return m;
  }, [scene]);
  const flights = scene.flights;
  const withFlight = useMemo(() => new Set(flights.map((f) => f.airport)), [flights]);
  const withHold = useMemo(() => new Set(flights.filter((f) => f.state === "hold").map((f) => f.airport)), [flights]);

  const label = `우주 보기. 지구는 홈 AIRPORT${scene.home ? ` ${scene.home}` : ""}, 행성은 다른 AIRPORT ${Math.max(0, bodies.length - 1)}곳${flights.length ? `, 궤도를 도는 FLIGHT ${flights.length}개` : ""}. 같은 내용이 오른쪽 목록에 있다.`;

  return (
    <svg className="space-svg" viewBox={`${-HALF} ${-HALF} ${SPACE_SIZE} ${SPACE_SIZE}`} role="img" aria-label={label}>
      <rect className="space-sky" x={-HALF} y={-HALF} width={SPACE_SIZE} height={SPACE_SIZE} />
      <g className="space-stars" aria-hidden="true">
        {STARS.map((s, i) => (
          <circle key={i} cx={f1(s.x - HALF)} cy={f1(s.y - HALF)} r={s.r} opacity={s.o} />
        ))}
      </g>
      {bodies.filter((b) => !b.home).map((b) => (
        <circle key={`ring-${b.id}`} className="space-ring" cx={0} cy={0} r={f1(b.ring)} />
      ))}
      {bodies.map((b) => {
        const p = parked.get(b.code) ?? [];
        return (
          <g key={b.id} className={`space-body${b.home ? " home" : ""}`}>
            <title>{`${b.code}${b.home ? " (HOME) — 지구" : " — 행성"}${p.length ? ` — 세워 둔 AIRCRAFT: ${p.join(", ")}` : ""}`}</title>
            {withFlight.has(b.code) && <circle className="space-orbit" cx={f1(b.x)} cy={f1(b.y)} r={f1(b.r * ORBIT)} />}
            {withHold.has(b.code) && <circle className="space-orbit space-park" cx={f1(b.x)} cy={f1(b.y)} r={f1(b.r * PARK)} />}
            <circle className="space-planet" cx={f1(b.x)} cy={f1(b.y)} r={b.r} />
            <text className="globe-code" x={f1(b.x + b.r + 8)} y={f1(b.y - b.r * 0.4)}>
              {b.code}
            </text>
            {p.length > 0 && (
              <g className="globe-parked" transform={`translate(${f1(b.x - b.r - 12)} ${f1(b.y + b.r + 6)})`}>
                <path d="M0 -6 L4.5 5 L0 3 L-4.5 5 Z" />
                {p.length > 1 && (
                  <text x={8} y={5}>
                    ×{p.length}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
      <g className="globe-flights">
        {flights.map((f) => {
          const b = byCode.get(f.airport);
          if (!b) return null;
          const tone = toneOf(f);
          const at = pointOf(b, b.r, polarOf(f.state, f.t, f.outbound));
          const heading = headingOf(f.state, f.t, f.outbound);
          const loop: Polar[] | null = f.state === "hold" ? parkLoop(polarOf("hold", f.t, f.outbound).ang) : f.state === "goAround" ? missedLoop(f.outbound) : null;
          const loopD = loop ? dOf(loop.map((q) => pointOf(b, b.r, q)), f.state === "hold") : "";
          const anim = motion && loop && f.state !== "nordo";
          const route = f.state === "boarding" || f.state === "arrived" || f.state === "taxi" ? "" : dOf(routeOf(f.outbound).map((q) => pointOf(b, b.r, q)));
          const key = flightKeyOf(f.key);
          const marks = flightMarks(f);
          const glyph = (
            <>
              <circle className="globe-plane-hit" r={14} />
              <path className={`globe-plane tone-${tone}${f.state === "nordo" ? " nordo" : ""}`} d="M0 -9 L6 8 L0 4 L-6 8 Z" transform={anim ? "rotate(90)" : undefined} />
            </>
          );
          const body = (
            <>
              <title>{flightTip(f)}</title>
              {route && <path className={`globe-route tone-${tone}`} d={route} />}
              {f.state === "goAround" && loopD && <path className="globe-hold tone-amber" d={loopD} />}
              {anim ? (
                <g>
                  <animateMotion dur={f.state === "hold" ? "14s" : "7s"} repeatCount="indefinite" rotate="auto" path={loopD} />
                  {glyph}
                </g>
              ) : (
                <g transform={`translate(${f1(at.x)} ${f1(at.y)}) rotate(${f1(heading)})`}>{glyph}</g>
              )}
              <text className={`globe-plane-label tone-${tone}`} x={f1(at.x + 12)} y={f1(at.y + 22)}>
                {flightNumber(f.key)}
                {marks && <tspan className="globe-plane-mark"> {marks}</tspan>}
              </text>
            </>
          );
          const style = { opacity: 0.25 + 0.75 * fadeOf(f, now) };
          return key ? (
            <a key={f.key} href={`#flight/${key}`} data-flight={f.key} className="globe-flight" style={style}>
              {body}
            </a>
          ) : (
            <g key={f.key} data-flight={f.key} className="globe-flight" style={style}>
              {body}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
