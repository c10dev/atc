import { useMemo } from "react";
import { arcLift, arcOf, clamp, MOVE_FADE_MIN, project, slerp, type GlobeMove, type GlobeScene, type LatLon, type View } from "../../../server/globe.ts";
import { f1 } from "./globe-draw.ts";

// GLOBE G3(ATC-263, docs/globe.md 3.4): AIRPORT 사이의 큰 원 호. OUTSTATION(base에서 다른 AIRPORT로, 점선, 비행기는 목적지)과
// REPOSITION(옛 base에서 새 base로, 흐린 페리 비행. t가 0이면 출발지, 새 LAUNCH 뒤 1이면 도착지, 중간점은 없다).
// 서버가 어디서 어디로와 t를 정해 보내고, 여기서는 호를 그리기만 한다. 호는 가운데가 살짝 떠서 비행으로 읽힌다(지상 궤적이 아니다).

export const MOVE_LABEL = (m: GlobeMove) => (m.kind === "outstation" ? "OUTSTATION" : m.failed ? "ferry 실패" : m.endedAt ? "ferry 도착" : "ferry");
type Tone = "radar" | "amber" | "faint";
// OUTSTATION과 진행 중인 ferry는 평소 상태라 신호색이 아니다(design-language 1, 3.2). 실패만 호박색. 둘은 점선 모양으로 가른다
export const moveTone = (m: GlobeMove): Tone => (m.failed ? "amber" : "faint");
export const moveTip = (m: GlobeMove) => `${m.callsign ?? m.aircraft} · ${MOVE_LABEL(m)} ${m.from} → ${m.to}${m.kind === "reposition" && !m.endedAt ? " (새 LAUNCH 전)" : ""}`;
// 끝난 옮김의 흔적은 MOVE_FADE_MIN 동안 옅어진다
export const moveFade = (m: GlobeMove, now: number) => (m.endedAt ? clamp(1 - (now - Date.parse(m.endedAt)) / (MOVE_FADE_MIN * 60_000), 0, 1) : 1);

interface Placed {
  m: GlobeMove;
  tone: Tone;
  d: string; // 보이는 부분의 호(점선)
  at: { x: number; y: number } | null; // 비행기 자리(뒷면이면 null)
  angle: number;
  opacity: number;
  stack: number; // 같은 자리에 겹친 비행기의 순번(0이 맨 앞). 글자와 비행기를 조금씩 비껴 세운다
}

// 한 점: 원판 좌표에 높이를 곱해 살짝 띄운다. depth ≤ 0이면 뒷면
function lifted(p: LatLon, s: number, view: View, C: number, R: number) {
  const q = project(p, view);
  const k = 1 + arcLift(s);
  return { x: C + q.x * R * k, y: C - q.y * R * k, depth: q.depth };
}

export function MovesLayer({ scene, positions, view, C, R, now }: { scene: GlobeScene; positions: ReadonlyMap<string, LatLon>; view: View; C: number; R: number; now: number }) {
  const placed = useMemo<Placed[]>(() => {
    const byCode = new Map(scene.airports.map((a) => [a.code, a.id]));
    const out: Placed[] = [];
    const slots = new Map<string, number>();
    for (const m of scene.moves) {
      const a = positions.get(byCode.get(m.from) ?? "");
      const b = positions.get(byCode.get(m.to) ?? "");
      if (!a || !b) continue;
      const pts = arcOf(a, b, 48).map((p, i, all) => lifted(p, i / (all.length - 1), view, C, R));
      // 앞면인 점만 이어 그린다(뒷면에서 끊기면 새 조각)
      let d = "";
      let pen = false;
      for (const p of pts) {
        if (p.depth <= 0) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${f1(p.x)} ${f1(p.y)}`;
        pen = true;
      }
      const here = lifted(slerp(a, b, m.t), m.t, view, C, R);
      const ahead = lifted(slerp(a, b, clamp(m.t + 0.02, 0, 1)), clamp(m.t + 0.02, 0, 1), view, C, R);
      const back = lifted(slerp(a, b, clamp(m.t - 0.02, 0, 1)), clamp(m.t - 0.02, 0, 1), view, C, R);
      const from = m.t >= 1 ? back : here;
      const to = m.t >= 1 ? here : ahead;
      const angle = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
      const slot = `${m.t >= 1 ? m.to : m.from}|${m.t >= 1 ? 1 : 0}`;
      const stack = slots.get(slot) ?? 0;
      slots.set(slot, stack + 1);
      out.push({ m, tone: moveTone(m), d, at: here.depth > 0.02 ? { x: here.x, y: here.y } : null, angle, opacity: 0.25 + 0.75 * moveFade(m, now), stack });
    }
    return out;
  }, [scene, positions, now, view.lat, view.lon, C, R]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <g className="globe-moves">
      {placed.map((p) => (
        <g key={`${p.m.kind}-${p.m.aircraft}-${p.m.proposal ?? p.m.to}`} className="globe-move" data-move={p.m.aircraft} style={{ opacity: p.opacity }}>
          <title>{moveTip(p.m)}</title>
          {p.d && <path className={`globe-move-arc tone-${p.tone} ${p.m.kind}`} d={p.d} />}
          {p.at && (
            <g transform={`translate(${f1(p.at.x + p.stack * 9)} ${f1(p.at.y)}) rotate(${f1(p.angle)})`}>
              <path className={`globe-plane tone-${p.tone}`} d="M0 -9 L6 8 L0 4 L-6 8 Z" />
            </g>
          )}
          {p.at && (
            <text className={`globe-plane-label tone-${p.tone}`} x={f1(p.at.x + 12 + p.stack * 9)} y={f1(p.at.y + 22 + p.stack * 14)}>
              {p.m.callsign ?? p.m.aircraft}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

// 지구본 옆 글 목록(스크린 리더, 좁은 화면). 옮김이 없으면 그리지 않는다(평소 화면에 "이상 없음" 줄을 두지 않는다)
export function MoveRows({ moves }: { moves: readonly GlobeMove[] }) {
  if (moves.length === 0) return null;
  return (
    <section className="globe-rows globe-move-rows" aria-label="AIRPORT 사이 이동">
      <h2 className="globe-rows-head">MOVES</h2>
      <ul>
        {moves.map((m) => (
          <li key={`${m.kind}-${m.aircraft}-${m.proposal ?? m.to}`}>
            <span className="globe-row-code">{m.aircraft}</span>
            <span className="globe-row-name">
              {m.callsign ?? "—"} · <b className={`tone-${moveTone(m)}`}>{MOVE_LABEL(m)}</b> {m.from} → {m.to}
            </span>
            {m.kind === "reposition" && <span className="globe-row-parked">{m.proposal}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
