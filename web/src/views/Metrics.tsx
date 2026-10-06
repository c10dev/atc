import { type KeyboardEvent, type MouseEvent, useEffect, useState } from "react";
import type { MetricsView as MetricsData, SeriesPoint } from "../../../server/metrics.ts";
import type { Snapshot } from "../../../server/model.ts";
import type { Sample } from "../../../server/recorder.ts";
import { formatClock, useSettings } from "../settings.ts";
import { MetricsControl } from "./MetricsControl.tsx";
import { MetricsFuel } from "./MetricsFuel.tsx";
import { MetricsLeaks } from "./MetricsLeaks.tsx";
import { MetricsTouches } from "./MetricsTouches.tsx";
import { MetricsMisfire } from "./MetricsMisfire.tsx";
import { Network } from "./Network.tsx";
import { SingleLane } from "./SingleLane.tsx";
import "./Metrics.css";
import { apiGet } from "../api.ts";
import { Empty } from "../kit/Empty.tsx";
import { Loading } from "../kit/Loading.tsx";
import { Segmented } from "../kit/Segmented.tsx";
import { TableScroll } from "../kit/TableScroll.tsx";

// 1.5단계 운용 지표. FLIGHT RECORDER 기록으로 2단계(DISPATCH)로 넘어갈지 판단한다.

const RANGES = [
  { days: 1, label: "24시간" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
] as const;

const TRENDS: { key: keyof Sample; label?: string; code: string }[] = [
  { key: "airborne", code: "AIRBORNE" },
  { key: "claims", label: "점유", code: "STANDS" },
  { key: "alerts", code: "ALERTS" },
  { key: "landing", code: "LANDING SEQUENCE" },
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

// 하위 화면(ATC-137, ATC-380): #metrics는 운용 지표, #metrics/leaks·touches·misfire·fuel·network. 주소로 고른다.
// 옛 #network는 #metrics/network로 열린다(legacy-hash.ts)
type Sub = "ops" | "leaks" | "touches" | "misfire" | "control" | "fuel" | "network";
const SUBS: readonly (readonly [Sub, string])[] = [
  ["ops", "OPERATIONS"],
  ["leaks", "LEAKS"],
  ["touches", "TOUCHES"],
  ["misfire", "MISFIRE"],
  ["control", "CONTROL"],
  ["fuel", "FUEL"],
  ["network", "NETWORK"],
];
const subOfHash = (): Sub => {
  const p = location.hash.slice(1).split("/")[1];
  return SUBS.find(([id]) => id === p)?.[0] ?? "ops";
};
function useSub(): [Sub, (s: Sub) => void] {
  const [sub, setSub] = useState<Sub>(subOfHash);
  useEffect(() => {
    const on = () => setSub(subOfHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return [sub, (s) => (location.hash = s === "ops" ? "metrics" : `metrics/${s}`)];
}

export function Metrics({ refreshKey, snapshot }: { refreshKey: string; snapshot?: Snapshot | null }) {
  const [sub, goSub] = useSub();
  return (
    <section className="metrics">
      <div className="mx-sub" role="tablist" aria-label="METRICS">
        {SUBS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={sub === id} onClick={() => goSub(id)}>
            {label}
          </button>
        ))}
      </div>
      {sub === "fuel" ? (
        <MetricsFuel snapshot={snapshot ?? null} />
      ) : sub === "leaks" ? (
        <MetricsLeaks refreshKey={refreshKey} />
      ) : sub === "touches" ? (
        <MetricsTouches refreshKey={refreshKey} />
      ) : sub === "misfire" ? (
        <MetricsMisfire refreshKey={refreshKey} />
      ) : sub === "control" ? (
        <MetricsControl refreshKey={refreshKey} />
      ) : sub === "network" ? (
        <Network refreshKey={refreshKey} />
      ) : (
        <Operations refreshKey={refreshKey} />
      )}
    </section>
  );
}

function Operations({ refreshKey }: { refreshKey: string }) {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<MetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 스냅샷이 바뀔 때(최대 몇 초 간격)와 기간을 바꿀 때 다시 읽는다.
  useEffect(() => {
    let alive = true;
    apiGet(`/api/metrics?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [days, refreshKey]);

  return (
    <>
      <div className="toolbar">
        <span className="muted">
          FLIGHT RECORDER 기록 기준
          {data?.recording.since ? ` · ${data.recording.since.slice(0, 10)}부터 기록됨` : " · 아직 기록 없음"}
        </span>
        <Segmented label="기간" value={days} options={RANGES.map((r) => [r.days, r.label] as const)} onChange={setDays} />
      </div>

      {error && (
        <p className="mx-error" role="alert">
          지표를 불러오지 못함: {error}
        </p>
      )}
      {!data ? (
        <Loading>불러오는 중…</Loading>
      ) : (
        <>
          <Readiness data={data} />
          <KpiRow data={data} />
          <Flow data={data} />
          <SingleLane refreshKey={refreshKey} />
          <h2 className="label">
            TRENDS <em>5분 표본</em>
          </h2>
          {data.series.length < 2 ? (
            <Empty className="mx-empty">표본이 아직 모자람 — 5분마다 하나씩 쌓인다.</Empty>
          ) : (
            <div className="mx-trends">
              {TRENDS.map((t) => (
                <Trend key={t.key} code={t.code} label={t.label} points={data.series} field={t.key} />
              ))}
            </div>
          )}
          <Daily data={data} />
          <DutyLanguage data={data} />
        </>
      )}
    </>
  );
}

function Readiness({ data }: { data: MetricsData }) {
  const passed = data.readiness.filter((r) => r.status === "pass").length;
  return (
    <div className="mx-ready">
      <h2 className="label">
        STAGE 2 <em>DISPATCH 진입 점검 · {passed}/{data.readiness.length} 충족</em>
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

// 나이처럼 한 단위로(디자인 언어 9번): 59m까지 분, 47h까지 시간, 그 위는 일
const spanOf = (min: number | null) => (min === null ? "—" : min < 60 ? `${Math.round(min)}m` : min < 2880 ? `${Math.round(min / 60)}h` : `${Math.round(min / 1440)}d`);
const sinceOf = (iso: string | null) => (iso ? `${iso.slice(0, 10)}부터 기록` : "기록 없음");

// FLOW(ATC-468): 일이 어디서 시간을 쓰나. 놀고-큐가 빈 분과 이슈가 지나는 세 구간의 중앙값. 숫자마다 기록에서 왔는지 대신한 값인지 적는다
function Flow({ data }: { data: MetricsData }) {
  const f = data.flow;
  const idle = f.idleEmpty;
  const stretch = (name: keyof typeof f.stretches, label: string, note: string) => {
    const s = f.stretches[name];
    const src = [s.record.n ? `기록 ${s.record.n}` : "", s.substitute.n ? `대신한 값 ${s.substitute.n}(만든 시각 기준)` : ""].filter(Boolean).join(" · ");
    return { label, value: s.n ? spanOf(s.medianMin) : "—", sub: s.n ? `중앙값 · ${s.n}건 · ${src}` : `이 기간에 마친 이슈 없음 · ${note}` };
  };
  const tiles = [
    {
      label: "IDLE · 큐 빔",
      value: idle.minutes === null ? "기록 안 됨" : spanOf(idle.minutes),
      sub: idle.minutes === null ? `놀 AIRCRAFT가 있는데 기다리는 Todo가 없던 시간 · ${sinceOf(f.recordedSince.samples)}` : `놀 AIRCRAFT가 있고 기다리는 Todo가 없던 시간 · 표본 ${idle.recordedSamples}개${idle.unrecordedSamples ? ` · 옛 표본 ${idle.unrecordedSamples}개는 기록 안 됨` : ""} · ${sinceOf(f.recordedSince.samples)}`,
    },
    { ...stretch("created-todo", "CREATED → TODO", sinceOf(f.recordedSince.ticketLines)) },
    { ...stretch("todo-release", "TODO → RELEASED", "발권 기록 기준") },
    { ...stretch("release-launch", "RELEASED → LAUNCH", "발권과 LAUNCH 기록 기준") },
  ];
  return (
    <>
      <h2 className="label">
        FLOW <em>일이 어디서 시간을 쓰나</em>
      </h2>
      <div className="mx-kpis mx-flow">
        {tiles.map((t) => (
          <div key={t.label} className="mx-kpi">
            <div className="mx-kpi-label">{t.label}</div>
            <div className="mx-kpi-value">{t.value}</div>
            <div className="mx-kpi-sub">{t.sub}</div>
          </div>
        ))}
      </div>
      <p className="mx-note">CREATED → TODO는 {sinceOf(f.recordedSince.ticketLines)}(서버가 본 상태 변화)만 잰다. 그 앞은 알 수 없다. TODO → RELEASED는 기록 전 이슈를 만든 시각 기준으로 대신한다. 마친 구간만 센다.</p>
    </>
  );
}

function KpiRow({ data }: { data: MetricsData }) {
  const c = data.clearances;
  const types = Object.entries(c.byType)
    .map(([t, n]) => `${t} ${n}`)
    .join(" · ");
  const tiles = [
    { label: "READBACK 비율", value: pct(c.readbackRate), sub: `READBACK ${c.readBack} / CLEARANCE ${c.issued - c.cancelled} · 중앙값 ${mins(c.readbackMedianMin)}` },
    { label: "CLEARANCE", value: String(c.issued), sub: types || "CLEARANCE 없음" },
    ...(c.fixReadback && c.fixReadback.elsewhere.n + c.fixReadback.direct.n > 0
      ? [
          {
            label: "FIX·GO AROUND READBACK(중앙값)",
            value: mins(c.fixReadback.elsewhere.medianMin),
            sub: `다른 FLIGHT 중 ${c.fixReadback.elsewhere.readBack}/${c.fixReadback.elsewhere.n}건 · 바로 ${mins(c.fixReadback.direct.medianMin)} (${c.fixReadback.direct.readBack}/${c.fixReadback.direct.n}건)`,
          },
        ]
      : []),
    { label: "LOSS OF SEPARATION", value: String(data.conflicts.count), sub: `지속 중앙값 ${mins(data.conflicts.medianMin)} · 열린 ${data.conflicts.open}` },
    { label: "HANDOFF", value: String(data.handoffs), sub: `OUTSTATION 시작 ${data.away}` },
    {
      label: "LANDING 대기(중앙값)",
      value: mins(data.landing.medianWaitMin),
      sub: `LANDING ${data.landing.landed} · 대기 중 ${data.landing.waiting} · 최대 ${mins(data.landing.maxWaitMin)}`,
    },
    { label: "NORDO", value: String(data.lost), sub: `NO CONTACT ${data.noContact} · UNID ${data.unattended}` },
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
function Trend({ code, label, points, field }: { code: string; label?: string; points: SeriesPoint[]; field: keyof Sample }) {
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
        <span className="mx-trend-code">{code}</span>{label && ` ${label}`}
        <span className="mx-trend-now">
          {hover === null ? "최근" : stamp(points[i].t, clock, multiDay)} <b>{values[i]}</b>
        </span>
      </figcaption>
      <div
        className="mx-plot"
        tabIndex={0}
        role="img"
        aria-label={`${code}${label ? ` ${label}` : ""}: 최근 ${latest}, 최대 ${Math.max(...values)}, 최소 ${Math.min(...values)}. 방향키로 시각별 값`}
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

// DUTY 글의 언어 검사(ATC-510): 가나·한자만 있고 한글이 없는 줄을 센다. 경고일 뿐 글은 막지 않는다
function DutyLanguage({ data }: { data: MetricsData }) {
  const rows = [...data.dutyLanguage].reverse().filter((d) => d.checked > 0);
  return (
    <>
      <h2 className="label">
        DUTY LANGUAGE <em>UTC 날짜 · 가나·한자만 있는 줄(경고, 글은 막지 않음)</em>
      </h2>
      {rows.length === 0 ? (
        <Empty>이 기간에 검사한 DUTY 글이 없습니다</Empty>
      ) : (
        <TableScroll label="DUTY 언어 검사 표">
          <table className="kit-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th className="num">검사한 줄</th>
                <th className="num">걸린 줄</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.date}>
                  <td className="mono">{d.date}</td>
                  <td className="num">{d.checked}</td>
                  <td className="num">{d.flagged ? <b>{d.flagged}</b> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}

function Daily({ data }: { data: MetricsData }) {
  const rows = [...data.daily].reverse();
  return (
    <>
      <h2 className="label">
        DAILY <em>UTC 날짜</em>
      </h2>
      <TableScroll label="일별 표">
      <table className="kit-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>TOWER</th>
            <th className="num">LOS</th>
            <th className="num">HANDOFF</th>
            <th className="num">CLEARANCE</th>
            <th className="num">READBACK</th>
            <th className="num">LANDING</th>
            <th className="num">NORDO</th>
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
      </TableScroll>
    </>
  );
}
