import type { ReactNode } from "react";
import { type Milestones, milestoneTitle } from "../../../server/milestones.ts";
import { type FlightProgress, progressText, SEGMENTS } from "../../../server/progress.ts";
import { formatClock, type Settings } from "../settings.ts";
import "./FlightProgress.css";

// STRIPS의 FLIGHT 진행 막대(ATC-211). 그리기만 한다. 셈은 server/progress.ts(순수, GLOBE도 쓴다).
// 네 칸 work | landing | rts | in: 지난 칸은 실선, 지금 칸은 점선과 표식, 앞 칸은 옅은 점선. 표식은 지금 칸의 경과/p75(칸 끝에서 멈춤).
// p75를 넘으면 amber. 퍼센트도 도착 시각도 없다. 글로 같은 내용을 준다(스크린 리더용 aria-label, 화면은 이정표 한 줄).
export function FlightProgressBar({ progress: p, milestones, clock, children }: { progress: FlightProgress; milestones: Milestones | null; clock: Settings["clock"]; children?: ReactNode }) {
  const text = progressText(p);
  const times = milestoneTitle(milestones, (iso) => formatClock(iso, clock));
  const now = SEGMENTS.indexOf(p.segment);
  const label = `FLIGHT 진행: ${text}. ${times.replace(/\n/g, ", ")}`;
  // OOOI 시각은 title에만 두지 않는다(원칙 11) — 접은 이정표 줄로 화면에 둔다
  const timesFoot = <span className="flp-times faint mono">{times.replace(/\n/g, " · ")}</span>;
  // 끝난 FLIGHT(done)는 막대를 그리지 않는다: 네 칸이 모두 찬 막대는 새 정보가 없는데 STRIPS에서 가장 진한 표시가 돼 진행 중인 FLIGHT를 가린다.
  // 작은 글과 이정표 줄만 남긴다
  if (p.segment === "done")
    return (
      <div className="flp is-done" aria-label={label} role="group">
        <span className="flp-text mono">{text}</span>
        {timesFoot}
      </div>
    );
  const segs = p.standFree ? SEGMENTS.slice(0, 1) : SEGMENTS;
  const frac = p.marker === null ? 0 : Math.min(1, Math.max(0, p.marker * segs.length - now)); // 지금 칸 안의 위치. 채움과 표식이 같은 자리다
  return (
    <div className={`flp${p.late ? " is-late" : ""}`} aria-label={label} role="group">
      <div className="flp-bar" aria-hidden="true">
        {segs.map((seg, i) => (
          <span key={seg} className={`flp-seg ${i < now ? "is-past" : i === now ? "is-now" : "is-future"}`}>
            {i === now && <span className="flp-fill" style={{ width: `${frac * 100}%` }} />}
          </span>
        ))}
        {p.marker !== null && <i className="flp-mark" style={{ left: `${((now + frac) / segs.length) * 100}%` }} />}
      </div>
      <span className="flp-text mono">{text}</span>
      {timesFoot}
      {children}
    </div>
  );
}
