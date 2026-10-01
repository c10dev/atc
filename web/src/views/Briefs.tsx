import { useEffect, useState } from "react";
import type { BriefKind, BriefRow, BriefStats, CrewMode, GridKey } from "../../../server/briefs.ts";
import { flightNumber } from "../aviation.ts";
import "./Briefs.css";

// VECTORS 대 DIRECT(ATC-32, docs/dispatch.md "DIRECT briefs"), SOLO 대 CREW(ATC-33). LOGBOOK의 measured 줄로
// 지시서 종류별·SOLO·CREW별·둘을 겹친 2×2로 중간 질문·READBACK → PR·P0–P2 지적·PR 뒤 수정 커밋을 나란히 보여 주기만 한다.

interface BriefsData {
  days: number;
  rows: BriefRow[];
  stats: Record<BriefKind, BriefStats>;
  crewStats?: Record<CrewMode, BriefStats>; // ATC-33 전 서버에는 없다
  grid?: Record<GridKey, BriefStats>;
  unmeasured: number;
  crewUnknown?: number;
}
type Group = "brief" | "crew" | "both";
const GROUPS: { id: Group; label: string }[] = [
  { id: "brief", label: "지시서" },
  { id: "crew", label: "SOLO·CREW" },
  { id: "both", label: "2×2" },
];
// 묶음마다 열: 머리글(넓을 때·좁을 때)과 그 열의 지표
function columnsOf(d: BriefsData, g: Group): { key: string; head: string; short: string; tone: string; stats: BriefStats }[] {
  if (g === "crew" && d.crewStats) return CREWS.map((c) => ({ key: c, head: c, short: c, tone: c.toLowerCase(), stats: d.crewStats![c] }));
  if (g === "both" && d.grid)
    return KINDS.flatMap((k) => CREWS.map((c) => ({ key: `${k}·${c}`, head: `${k} · ${c}`, short: `${k[0]}·${c}`, tone: k.toLowerCase(), stats: d.grid![`${k}·${c}`] })));
  return KINDS.map((k) => ({ key: k, head: k, short: k, tone: k.toLowerCase(), stats: d.stats[k] }));
}
const RANGES = [14, 30, 90] as const;
const KINDS: BriefKind[] = ["VECTORS", "DIRECT"];
const CREWS: CrewMode[] = ["SOLO", "CREW"];
const MIN_SAMPLE = 5; // 칸 중 하나라도 이보다 적으면 표본 부족으로 적는다

const num = (x: number | null) => (x === null ? "—" : String(x));
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
function dur(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${Math.round(min)}분`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}시간${min % 60 ? ` ${Math.round(min % 60)}분` : ""}`;
  return `${(min / 1440).toFixed(1)}일`;
}

const METRICS: { label: string; hint: string; show: (s: BriefStats) => string }[] = [
  { label: "FLIGHT", hint: "기간 안에 ARRIVED하고 지시서를 찾은 FLIGHT", show: (s) => String(s.flights) },
  { label: "중간 질문 / FLIGHT", hint: "READBACK 뒤 PR을 열기 전까지 지시한 세션에 보낸 메시지와 AskUserQuestion", show: (s) => num(s.questionsPerFlight) },
  { label: "질문 없이 PR", hint: "중간 질문 0건으로 PR까지 간 비율", show: (s) => pct(s.oneShot) },
  { label: "READBACK → PR", hint: "중앙값. READBACK을 못 찾으면 지시서를 받은 시각부터", show: (s) => dur(s.readbackToPrMedianMin) },
  { label: "P0–P2 지적 / FLIGHT", hint: "Codex 인라인 지적(배지 없으면 P2)과 착륙 리뷰. 괄호는 잰 FLIGHT 수", show: (s) => `${num(s.findingsPerFlight)} (${s.findingsMeasured})` },
  { label: "PR 뒤 수정 커밋 / FLIGHT", hint: "PR을 연 뒤 쓴 커밋(병합 커밋 제외). 괄호는 잰 FLIGHT 수", show: (s) => `${num(s.reworkPerFlight)} (${s.reworkMeasured})` },
];

export function BriefsPanel({ refreshKey }: { refreshKey: string }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<BriefsData | null>(null);
  const [group, setGroup] = useState<Group>("brief");

  // 서버에 비교가 없거나(404) 실패하면 아무것도 그리지 않는다
  useEffect(() => {
    let alive = true;
    fetch(`/api/logbook/briefs?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setData(d?.stats ? d : null))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [days, refreshKey]);

  if (!data) return null;
  const hasCrew = Boolean(data.crewStats && data.grid);
  const g = hasCrew ? group : "brief";
  const cols = columnsOf(data, g);
  const thin = cols.some((c) => c.stats.flights < MIN_SAMPLE);

  return (
    <section className="bf" aria-labelledby="bf-title">
      <header className="bf-head">
        <h2 className="label" id="bf-title">
          VECTORS · DIRECT <em>지시서 비교{hasCrew ? " · SOLO·CREW" : ""}</em>
        </h2>
        <div className="bf-tools">
          {hasCrew && (
            <div className="bf-range" role="radiogroup" aria-label="묶기">
              {GROUPS.map((x) => (
                <button key={x.id} role="radio" aria-checked={g === x.id} onClick={() => setGroup(x.id)}>
                  {x.label}
                </button>
              ))}
            </div>
          )}
          <div className="bf-range" role="radiogroup" aria-label="기간">
            {RANGES.map((d) => (
              <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)}>
                {d}일
              </button>
            ))}
          </div>
        </div>
      </header>

      <table className={`bf-table${cols.length > 2 ? " is-grid" : ""}`}>
        <thead>
          <tr>
            <th scope="col">
              <span className="bf-sr">지표</span>
            </th>
            {cols.map((c) => (
              <th key={c.key} scope="col" className={`bf-kind is-${c.tone}`} title={c.head}>
                <span className="bf-wide">{c.head}</span>
                <span className="bf-narrow">{c.short}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m.label}>
              <th scope="row" title={m.hint}>
                {m.label}
              </th>
              {cols.map((c) => (
                <td key={c.key} className="tn">
                  {m.show(c.stats)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="faint bf-note">
        {thin ? `표본 부족(칸마다 ${MIN_SAMPLE}건 미만) — 경향만 보세요. ` : ""}
        지시서를 찾지 못했거나 아직 재지 않은 FLIGHT {data.unmeasured}건은 뺐다.
        {g !== "brief" && data.crewUnknown ? ` SOLO·CREW를 모르는 ${data.crewUnknown}건도 이 묶음에서 빠졌다.` : ""} 보여 주기만 하고 점수나 배정에 쓰지 않는다.
      </p>

      {data.rows.length > 0 && (
        <details className="bf-rows">
          <summary>FLIGHT별 {data.rows.length}건</summary>
          <ul>
            {data.rows.map((r) => (
              <li key={r.key}>
                <span className={`bf-tag is-${r.kind.toLowerCase()}`}>{r.kind}</span>
                {r.crew && <span className={`bf-tag is-${r.crew.toLowerCase()}`}>{r.crew}</span>}
                <b className="mono">{r.flight ? flightNumber(r.flight) : r.key}</b>
                <span className="mono faint">{r.aircraft ?? "—"}</span>
                <span>질문 {r.questions}</span>
                <span>READBACK → PR {dur(r.readbackToPrMin)}</span>
                <span>지적 {num(r.findings)}</span>
                <span>수정 {num(r.rework)}</span>
                {r.by && <span className="faint">지시 {r.by}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
