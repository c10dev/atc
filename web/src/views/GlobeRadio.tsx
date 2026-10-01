import { useEffect, useMemo, useState } from "react";
import {
  circuitOf,
  circuitSize,
  distanceDeg,
  pointAlong,
  type GlobeFlight,
  type GlobeScene,
  type LatLon,
  type View,
} from "../../../server/globe.ts";
import { GLOBE_WINDOW_MS, type Pulse, pulsesOf } from "../../../server/globe-radio.ts";
import type { Transmission } from "../../../server/radio.ts";
import { mergeTx } from "../radio-log.ts";
import { f1, toPx } from "./globe-draw.ts";
import "./GlobeRadio.css";

// GLOBE G7(ATC-268, docs/globe.md 3.9): RADIO가 이미 합친 교신을 지구본 위에 그린다. 새 데이터도 새 길도 없다 —
// GET /api/radio와 SSE 토픽 radio를 RADIO 탭과 같은 방식으로 읽는다. 열린 호출은 답이 올 때까지 깜박이고 overdueAt을 넘기면 호박색이 된다.
// 움직임(깜박임·전파 점)은 settings.motion이 켜졌을 때만. 꺼져 있으면 멈춘 선이다. 색은 :root 토큰만 쓴다.

// 교신 목록: 마운트하면 받아 오고, radio 토픽으로 새것을 합친다. 연결이 (다시) 열리면 한 번 더 받아 빈틈을 메운다
export function useRadioFeed(): { txs: Transmission[]; error: boolean } {
  const [txs, setTxs] = useState<Transmission[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/radio");
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { transmissions: Transmission[] };
        if (!live) return;
        setTxs((prev) => mergeTx(prev, body.transmissions, Date.now()));
        setError(false);
      } catch {
        if (live) setError(true);
      }
    };
    void load();
    const es = new EventSource("/api/events?topics=radio");
    es.onopen = () => void load();
    es.addEventListener("radio", (e) => {
      try {
        const { transmissions } = JSON.parse((e as MessageEvent<string>).data) as { transmissions: Transmission[] };
        setTxs((prev) => mergeTx(prev, transmissions, Date.now()));
      } catch {
        /* 못 읽은 줄은 건너뛴다 */
      }
    });
    return () => {
      live = false;
      es.close();
    };
  }, []);
  return { txs, error };
}

// 비행기의 지구본 위 자리. GlobeFlights와 같은 규칙으로 셈한다(장면 파일은 바꾸지 않는다)
export function flightAt(f: GlobeFlight, scene: GlobeScene, positions: ReadonlyMap<string, LatLon>): LatLon | null {
  const a = scene.airports.find((x) => x.code === f.airport);
  const apt = a && positions.get(a.id);
  if (!a || !apt) return null;
  let nearest: number | null = null;
  for (const o of scene.airports) {
    const p = o.id === a.id ? null : positions.get(o.id);
    if (p) nearest = Math.min(nearest ?? Infinity, distanceDeg(apt, p));
  }
  const size = circuitSize(nearest);
  const c = circuitOf(apt, a.runway, f.outbound, size);
  if (f.state === "cruise" || f.state === "nordo") return pointAlong(c.cruise, f.t).at;
  if (f.state === "final") return pointAlong(c.final, f.t).at;
  if (f.state === "taxi") return pointAlong(c.taxi, f.t).at;
  if (f.state === "hold") return pointAlong(c.cruise, f.t).at;
  if (f.state === "goAround") return pointAlong(c.missed, 0.5).at;
  return c.gate;
}

const TONE: Record<Pulse["state"], string> = { open: "cyan", overdue: "amber", answered: "radar" };

export function RadioLayer({ scene, txs, positions, view, C, R, motion, now }: { scene: GlobeScene; txs: readonly Transmission[]; positions: ReadonlyMap<string, LatLon>; view: View; C: number; R: number; motion: boolean; now: number }) {
  const pulses = useMemo(() => pulsesOf(txs, scene.flights, now, GLOBE_WINDOW_MS), [txs, scene.flights, now]);
  if (!pulses.length) return null;
  const byCode = new Map(scene.airports.map((a) => [a.code, a]));
  return (
    <g className="globe-radio" aria-hidden="true">
      {pulses.map((p) => {
        const a = p.airport ? byCode.get(p.airport) : undefined;
        const apt = a && positions.get(a.id);
        if (!apt) return null;
        const from = toPx(apt, view, C, R);
        if (from.depth <= 0.02) return null;
        const at = p.plane ? flightAt(p.plane, scene, positions) : null;
        const to = at ? toPx(at, view, C, R) : null;
        const tone = TONE[p.state];
        const title = <title>{p.tx.head}</title>;
        if (!to || to.depth <= 0.02) {
          // 비행기를 모르면 AIRPORT에서 퍼지는 고리 하나
          return (
            <g key={p.tx.id} className={`globe-pulse tone-${tone} is-${p.state}${motion ? " is-moving" : ""}`}>
              {title}
              <circle cx={f1(from.x)} cy={f1(from.y)} r={11} />
            </g>
          );
        }
        const d = `M${f1(from.x)} ${f1(from.y)}L${f1(to.x)} ${f1(to.y)}`;
        return (
          <g key={p.tx.id} className={`globe-pulse tone-${tone} is-${p.state}${motion ? " is-moving" : ""}`}>
            {title}
            <path className="globe-pulse-line" d={d} />
            {motion ? (
              <circle className="globe-pulse-dot" r={2.5}>
                <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
              </circle>
            ) : (
              <circle className="globe-pulse-dot" cx={f1((from.x + to.x) / 2)} cy={f1((from.y + to.y) / 2)} r={2.5} />
            )}
          </g>
        );
      })}
    </g>
  );
}
