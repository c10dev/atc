import { useEffect } from "react";
import { useLate } from "./kit/Loading.tsx";
import "./ApproachScene.css";

// 첫 불러오기의 장면(ATC-453): 조종석에서 본 최종 접근. 원근으로 선 활주로, 문턱을 향해 달아나는 접근등, 가로 불빛 한 줄, 아래에 글.
// 이 파일 하나가 장면의 전부라 나중에 떼어도 줄 단위 표시(kit/Loading)만 남는다. 첫 스냅샷이 300 ms 안에 오면 아무것도 그리지 않는다.
// 스냅샷이 오면(ready) 문턱 불빛이 --radar가 되고, 장면은 --dur-base 동안 사라지며 그 사이 화면이 들어온다(onGone으로 장면을 내린다)

// 중심선의 접근등: 문턱(위)에서 보는 사람(아래)으로 간격과 크기가 커진다. 토끼는 아래에서 문턱 쪽으로 달린다
const ROWS = Array.from({ length: 7 }, (_, k) => ({ y: 88 + 5.2 * (k + 1) ** 1.35, r: 0.9 + 0.32 * (k + 1) }));
const CROSSBAR = 3; // 가로 불빛 한 줄이 서는 줄
const BAR_DX = [-14, -7, 7, 14];

// 토큰 --dur-base(ms)를 읽는다. 읽지 못하면 200
function durBaseMs(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--dur-base").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith("ms") ? n : n * 1000) : 200;
}

export function ApproachScene({ ready, onShow, onGone }: { ready: boolean; onShow: () => void; onGone: () => void }) {
  const late = useLate();
  useEffect(() => {
    if (late && !ready) onShow();
  }, [late, ready, onShow]);
  useEffect(() => {
    if (!ready) return;
    if (!late) return onGone(); // 빨리 왔다: 장면을 그린 적이 없다
    const t = setTimeout(onGone, durBaseMs());
    return () => clearTimeout(t);
  }, [ready, late, onGone]);
  if (!late) return null;
  return (
    <div className={`approach${ready ? " is-ready" : ""}`}>
      <svg className="approach-svg" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <line className="ap-horizon" x1="0" y1="60" x2="200" y2="60" />
        <polygon className="ap-rwy-edge" points="96,60 104,60 118,88 82,88" />
        <polygon className="ap-rwy" points="97,61 103,61 114,87 86,87" />
        <line className="ap-centre" x1="100" y1="62" x2="100" y2="86" />
        <g className="ap-threshold">
          {[-12, -8, -4, 4, 8, 12].map((dx) => (
            <circle key={dx} cx={100 + dx} cy="88" r="0.9" />
          ))}
        </g>
        <g className="ap-lights">
          {ROWS.map((row, k) => (
            <circle key={k} cx="100" cy={row.y} r={row.r} style={{ animationDelay: `${(ROWS.length - 1 - k) * 0.12}s` }} />
          ))}
          {BAR_DX.map((dx) => (
            <circle key={dx} className="ap-crossbar" cx={100 + dx * (1 + CROSSBAR * 0.18)} cy={ROWS[CROSSBAR].y} r={ROWS[CROSSBAR].r * 0.8} />
          ))}
        </g>
      </svg>
      <p className="approach-text" role="status">
        불러오는 중…
      </p>
    </div>
  );
}
