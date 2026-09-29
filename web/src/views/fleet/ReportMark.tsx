import { useState } from "react";
import type { AircraftView } from "../../../../server/fleet.ts";
import { REPORT_CLASSES, REPORT_LABEL } from "../../../../server/judges/report.ts";

type Report = NonNullable<AircraftView["report"]>;
const pct = (p: number) => `${Math.round(p * 100)}%`;

// 행의 칩·툴팁 글: 분류와 확률(그림자 판정, ATC-89)
export const reportTitle = (r: Report) =>
  `JEV REPORT (그림자) · ${REPORT_LABEL[r.class]} · ${REPORT_CLASSES.map((c) => `${REPORT_LABEL[c]} ${pct(r.probabilities[c])}`).join(" · ")} · 마지막 메시지 ${r.chars}자를 보냄 · 카드에서 맞다·틀리다고 표시`;

export function ReportChip({ r }: { r: Report }) {
  return (
    <span className={`fl-r-report${r.decision ? " is-decision" : ""}`} title={reportTitle(r)}>
      {REPORT_LABEL[r.class]}
    </span>
  );
}

// 카드의 REPORT 줄: SUPERVISOR가 분류를 맞다·틀리다고 표시한다(일치율은 FLEET PLAN 게이트 줄에 센다)
export function ReportLine({ r }: { r: Report }) {
  const [mark, setMark] = useState<"right" | "wrong" | null>(r.mark);
  const [id, setId] = useState(r.id);
  const [error, setError] = useState<string | null>(null);
  if (id !== r.id) {
    setId(r.id); // 새 턴이 판정되면 표시를 다시 받는다
    setMark(r.mark);
  }
  const send = async (verdict: "right" | "wrong") => {
    setError(null);
    const res = await fetch(`/api/judges/report/${encodeURIComponent(r.id)}/mark`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict }) });
    if (res.ok) setMark(verdict);
    else setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  };
  return (
    <p className="fl-report" title={reportTitle(r)}>
      <span className="fl-report-mark mono">JEV REPORT</span> {REPORT_LABEL[r.class]} <span className="faint">· 결정 필요 {pct(r.decisionP)}</span>{" "}
      <span className="fl-report-btns" role="group" aria-label="분류가 맞나">
        <button className={`fl-btn${mark === "right" ? " is-on" : ""}`} aria-pressed={mark === "right"} onClick={() => send("right")}>
          맞음
        </button>
        <button className={`fl-btn${mark === "wrong" ? " is-on" : ""}`} aria-pressed={mark === "wrong"} onClick={() => send("wrong")}>
          틀림
        </button>
      </span>
      {error && <span className="fl-error"> {error}</span>}
    </p>
  );
}
