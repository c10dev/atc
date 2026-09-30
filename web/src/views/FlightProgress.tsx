import type { ReactNode } from "react";
import { type Milestones, milestoneTitle } from "../../../server/milestones.ts";
import { type FlightProgress, progressText, SEGMENTS } from "../../../server/progress.ts";
import { formatClock, type Settings } from "../settings.ts";

// STRIPS의 FLIGHT 진행 막대(ATC-211). 그리기만 한다. 셈은 server/progress.ts(순수, GLOBE도 쓴다).
// 네 칸 work | landing | rts | in: 지난 칸은 실선, 지금 칸은 점선과 표식, 앞 칸은 옅은 점선. 표식은 지금 칸의 경과/p75(칸 끝에서 멈춤).
// p75를 넘으면 amber. 퍼센트도 도착 시각도 없다. 글로 같은 내용을 준다(스크린 리더용 aria-label, 마우스는 이정표 시각).
export function FlightProgressBar({ progress: p, milestones, clock, children }: { progress: FlightProgress; milestones: Milestones | null; clock: Settings["clock"]; children?: ReactNode }) {
  const text = progressText(p);
  const times = milestoneTitle(milestones, (iso) => formatClock(iso, clock));
  const now = SEGMENTS.indexOf(p.segment);
  const segs = p.standFree ? SEGMENTS.slice(0, 1) : SEGMENTS;
  const label = `FLIGHT 진행: ${text}. ${times.replace(/\n/g, ", ")}`;
  return (
    <div className={`fp${p.late ? " is-late" : ""}`} title={times} aria-label={label} role="group">
      <div className="fp-bar" aria-hidden="true">
        {segs.map((seg, i) => (
          <span key={seg} className={`fp-seg ${p.segment === "done" || i < now ? "is-past" : i === now ? "is-now" : "is-future"}`} />
        ))}
        {p.marker !== null && !p.standFree && <i className="fp-mark" style={{ left: `${p.marker * 100}%` }} />}
        {p.marker !== null && p.standFree && <i className="fp-mark" style={{ left: `${Math.min(1, p.marker * 4) * 100}%` }} />}
      </div>
      <span className="fp-text mono">{text}</span>
      {children}
    </div>
  );
}
