import { type KeyboardEvent, type MouseEvent, useEffect, useState } from "react";
import type { Metrics as MetricsData, SeriesPoint } from "../../../server/metrics.ts";
import type { Sample } from "../../../server/recorder.ts";
import { formatClock, useSettings } from "../settings.ts";
import "./Metrics.css";

// 1.5단계 운용 지표. 블랙박스 기록으로 2단계(운항 관리)로 넘어갈지 판단한다.

const RANGES = [
  { days: 1, label: "24시간" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
] as const;

const TRENDS: { key: keyof Sample; label: string; code: string }[] = [
  { key: "airborne", label: "비행 중", code: "AIRBORNE" },
  { key: "claims", label: "주기장 점유", code: "STANDS" },
  { key: "alerts", label: "열린 경보", code: "ALERTS" },
  { key: "landing", label: "착륙 대기열", code: "LANDING" },
];

const statusMark = {
  pass: { icon: "✓", label: "충족" },
  fail: { icon: "✗", label: "미달" },
  insufficient: { icon: "○", label: "데이터 부족" },
} as const;

// 여러 날에 걸친 추이는 시각 앞에 날짜를 붙인다(설정한 시간대 기준).
function stamp(iso: string, clock: "utc" | "local", withDate: boolean): string {
  if (!withDate) return formatClock(iso, clock);
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = clock === "utc" ? iso.slice(5, 10) : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${formatClock(iso, clock)}`;
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const mins = (x: number | null) => (x === null ? "—" : `${x}분`);

export function Metrics({ refreshKey }: { refreshKey: string }) {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<MetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 스냅샷이 바뀔 때(최대 몇 초 간격)와 기간을 바꿀 때 다시 읽는다.
  useEffect(() => {
    let alive = true;
    fetch(`/api/metrics?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [days, refreshKey]);

  return (
    <section className="metrics">
      <div className="toolbar">
        <span className="muted">
          블랙박스 기록 기준
          {data?.recording.since ? ` · ${data.recording.since.slice(0, 10)}부터 기록됨` : " · 아직 기록 없음"}
        </span>
        <div className="mx-range" role="radiogroup" aria-label="기간">
          {RANGES.map((r) => (
            <button key={r.days} role="radio" aria-checked={days === r.days} onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mx-error" role="alert">
          지표를 불러오지 못함: {error}
        </p>
      )}
      {!data ? (
        <p className="empty">불러오는 중…</p>
      ) : (
        <>
          <Readiness data={data} />
          <KpiRow data={data} />
          <h2 className="label">
            TRENDS <em>추이 · 5분 표본</em>
          </h2>
          {data.series.length < 2 ? (
            <p className="empty mx-empty">표본이 아직 모자람 — 5분마다 하나씩 쌓인다.</p>
          ) : (
            <div className="mx-trends">
              {TRENDS.map((t) => (
                <Trend key={t.key} code={t.code} label={t.label} points={data.series} field={t.key} />
              ))}
            </div>
          )}
          <Daily data={data} />
        </>
      )}
    </section>
  );
}

function Readiness({ data }: { data: MetricsData }) {
  const passed = data.readiness.filter((r) => r.status === "pass").length;
  return (
    <div className="mx-ready">
      <h2 className="label">
        STAGE 2 <em>운항 관리 진입 점검 · {passed}/{data.readiness.length} 충족</em>
      </h2>
      <ul>
        {data.readiness.map((r) => (
          <li key={r.id} className={`mx-check s-${r.status}`}>
            <span className="mx-check-mark" aria-hidden>
              {statusMark[r.status].icon}
            </span>
            <span className="mx-check-label">{r.label}</span>
            <span className="mx-check-value">{r.value}</span>
            <span className="mx-check-target">기준 {r.target}</span>
            <span className="mx-check-state">{statusMark[r.status].label}</span>
          </li>
        ))}
      </ul>
      <p className="mx-note">기준은 제안값이다(server/metrics.ts의 READINESS). 운용해 보며 조정한다.</p>
    </div>
  );
}

function KpiRow({ data }: { data: MetricsData }) {
  const c = data.clearances;
  const types = Object.entries(c.byType)
    .map(([t, n]) => `${t} ${n}`)
    .join(" · ");
  const tiles = [
    { label: "복창률", value: pct(c.readbackRate), sub: `복창 ${c.readBack} / 지시 ${c.issued - c.cancelled} · 중앙값 ${mins(c.readbackMedianMin)}` },
    { label: "관제 지시", value: String(c.issued), sub: types || "지시 없음" },
    { label: "분리 기준 위반", value: String(data.conflicts.count), sub: `지속 중앙값 ${mins(data.conflicts.medianMin)} · 열린 ${data.conflicts.open}` },
    { label: "관제 이양", value: String(data.handoffs), sub: `원정 시작 ${data.away}` },
    {
      label: "착륙 대기(중앙값)",
      value: mins(data.landing.medianWaitMin),
      sub: `착륙 ${data.landing.landed} · 대기 중 ${data.landing.waiting} · 최대 ${mins(data.landing.maxWaitMin)}`,
    },
    { label: "무선 두절", value: String(data.lost), sub: `레이더 미포착 ${data.noContact} · 미식별 ${data.unattended}` },
  ];
  return (
    <div className="mx-kpis">
      {tiles.map((t) => (
        <div key={t.label} className="mx-kpi">
          <div className="mx-kpi-label">{t.label}</div>
          <div className="mx-kpi-value">{t.value}</div>
          <div className="mx-kpi-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// 계열 하나짜리 추이. 가로선(마우스·방향키)으로 시각과 값을 읽는다.
function Trend({ code, label, points, field }: { code: string; label: string; points: SeriesPoint[]; field: keyof Sample }) {
  const { clock } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p[field]);
  const max = Math.max(1, ...values);
  const x = (i: number) => (i / (points.length - 1)) * 100;
  const y = (v: number) => 100 - (v / max) * 100;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;
  const latest = values.at(-1)!;
  const i = hover ?? points.length - 1;
  const multiDay = Date.parse(points.at(-1)!.t) - Date.parse(points[0].t) > 20 * 3_600_000;

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.round(((e.clientX - box.left) / box.width) * (points.length - 1)));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setHover(Math.max(0, i - 1));
    else if (e.key === "ArrowRight") setHover(Math.min(points.length - 1, i + 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure className="mx-trend">
      <figcaption>
        <span className="mx-trend-code">{code}</span> {label}
        <span className="mx-trend-now">
          {hover === null ? "최근" : stamp(points[i].t, clock, multiDay)} <b>{values[i]}</b>
        </span>
      </figcaption>
      <div
        className="mx-plot"
        tabIndex={0}
        role="img"
        aria-label={`${label}: 최근 ${latest}, 최대 ${Math.max(...values)}, 최소 ${Math.min(...values)}. 방향키로 시각별 값`}
        onMouseMove={pick}
        onMouseLeave={() => setHover(null)}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        <span className="mx-ymax">{max}</span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line className="mx-grid" x1="0" x2="100" y1="0" y2="0" vectorEffect="non-scaling-stroke" />
          <path className="mx-area" d={area} />
          <path className="mx-line" d={line} vectorEffect="non-scaling-stroke" />
          <line className="mx-base" x1="0" x2="100" y1="100" y2="100" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover !== null && (
          <>
            <span className="mx-cross" style={{ left: `${x(i)}%` }} />
            <span className="mx-dot" style={{ left: `${x(i)}%`, top: `${y(values[i])}%` }} />
          </>
        )}
      </div>
      <div className="mx-xaxis">
        <span>{stamp(points[0].t, clock, multiDay)}</span>
        <span>{stamp(points.at(-1)!.t, clock, multiDay)}</span>
      </div>
    </figure>
  );
}

function Daily({ data }: { data: MetricsData }) {
  const rows = [...data.daily].reverse();
  return (
    <>
      <h2 className="label">
        DAILY <em>일별 · UTC 날짜</em>
      </h2>
      <table className="mx-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>TOWER</th>
            <th className="num">충돌</th>
            <th className="num">이양</th>
            <th className="num">지시</th>
            <th className="num">복창</th>
            <th className="num">착륙</th>
            <th className="num">두절</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date}>
              <td className="mono">{d.date}</td>
              <td>{d.towerActive ? <span className="mx-on">✓ 운용</span> : <span className="faint">—</span>}</td>
              <td className="num">{d.conflicts}</td>
              <td className="num">{d.handoffs}</td>
              <td className="num">{d.clearances}</td>
              <td className="num">{d.clearances ? `${d.readBack}/${d.clearances}` : "—"}</td>
              <td className="num">{d.landings}</td>
              <td className="num">{d.lost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
