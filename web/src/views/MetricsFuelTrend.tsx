import { useEffect, useState } from "react";
import {
  changeText, leverageText, metricOf, noCompareText, previousLabel, recordedDays, type TrendMetric, tzName, type UsagePeriod, type UsageTrend,
} from "../../../server/fuel-trend.ts";
import { usd } from "../../../server/fuel-view.ts";
import { apiGet } from "../api.ts";

// USAGE TREND(ATC-389, docs/fuel.md "USAGE TREND as built"): 에이전트를 얼마나 쓰는지 어제·지난 같은 기간·최근 주와 견준다. 읽기만 한다.
// 값과 변화율은 서버(/api/fuel/trend)가 셈하고 여기서는 보이기만 한다. FUEL 개요의 기간·새로고침을 따른다.
// 이번 기간의 COST·요청은 FUEL 요약 줄에 지난 기간과 함께 붙는다(SummaryChange). 여기서 되풀이하지 않는다

export type TrendData = UsageTrend & { at: string };
export interface TrendState {
  data: TrendData | null;
  error: string | null;
  loading: boolean;
}

const money = (v: number) => (v === 0 ? "$0" : usd(v));
const hoursText = (h: number) => `${h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString("en-US")}h`;
const count = (n: number) => n.toLocaleString("en-US");
const md = (iso: string) => iso.slice(5, 10);
// 주의 이름: 시작 날–끝 날(UTC). 마지막 주는 "이번 주"
const weekName = (w: UsagePeriod, last: boolean) => (last ? "이번 주" : `${md(w.from)}–${md(new Date(Date.parse(w.to) - 1).toISOString())}`);
const hours = (p: UsagePeriod) => p.captainHours + p.crewHours;
// 그 시간대의 벽시계 HH:MM(서버가 준 시간대 차이로. 브라우저 시간대에 기대지 않는다)
const clockAt = (iso: string, tzOffsetMin: number) => new Date(Date.parse(iso) - tzOffsetMin * 60_000).toISOString().slice(11, 16);

// 기간·새로고침을 따라 /api/fuel/trend를 읽는다. 다시 읽는 동안 앞 값을 그대로 둔다(자리가 흔들리지 않게)
export function useUsageTrend(days: number, tick: number): TrendState {
  const [st, setSt] = useState<TrendState>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    const tz = new Date().getTimezoneOffset(); // 어제와 견주기의 하루 경계: 보는 사람의 시간대
    apiGet(`/api/fuel/trend?days=${days}&tz=${tz}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/api/fuel/trend → HTTP ${r.status}`))))
      .then((data: TrendData) => alive && setSt({ data, error: null, loading: false }))
      .catch((e) => alive && setSt((s) => ({ ...s, loading: false, error: String((e as Error).message ?? e) })));
    return () => {
      alive = false;
    };
  }, [days, tick]);
  return st;
}

// 변화 한 줄: "지난 7일 $768 · +12%". 지난 기간 일부만 기록이 있으면 그 날 수를 붙이고 %는 뺀다(서버의 change가 null)
function Change({ label, prev, value, change }: { label: string; prev: UsagePeriod; value: string; change: number | null }) {
  const text = changeText(change);
  return (
    <>
      <span className="muted">{label} {prev.coverage > 0 ? value : "—"}</span>
      {text ? <b className="mft-delta"> {text}</b> : null}
    </>
  );
}

// FUEL 요약 줄(FUEL COST·요청) 밑에 붙는 지난 기간 줄
export function SummaryChange({ trend, metric }: { trend: TrendData | null; metric: "cost" | "requests" }) {
  if (!trend) return null;
  const p = trend.previous;
  return (
    <span className="mft-prev">
      <Change label={previousLabel(p, trend.days)} prev={p} value={metric === "cost" ? money(p.cost) : count(p.requests)} change={trend.change[metric]} />
    </span>
  );
}

// ── 오늘 대 어제(기간 고르기와 상관없이 늘 보인다) ──
// LEVERAGE(ATC-397): 에이전트 가동 시간의 합이 흐른 시간의 몇 배인가. 밑줄에 그 나눗셈을 보인다
const leverageSub = (p: UsagePeriod) => `가동 ${hoursText(hours(p))} ÷ ${hoursText(p.elapsedHours)}`;
const TODAY: { metric: TrendMetric; label: string; text: (p: UsagePeriod) => string; sub?: (p: UsagePeriod) => string }[] = [
  { metric: "leverage", label: "LEVERAGE", text: (p) => leverageText(p.leverage), sub: leverageSub },
  { metric: "cost", label: "COST", text: (p) => money(p.cost) },
  { metric: "requests", label: "요청", text: (p) => count(p.requests) },
  { metric: "hours", label: "가동 시간", text: (p) => hoursText(hours(p)) },
  { metric: "flights", label: "ARRIVED", text: (p) => count(p.flights) },
];

export function UsageToday({ trend }: { trend: TrendState }) {
  const d = trend.data;
  return (
    <section className="mf-sec mft mft-today" aria-label="오늘과 어제" aria-busy={trend.loading}>
      <h2 className="label">
        TODAY{" "}
        <em>
          {d
            ? `오늘 0시부터 ${clockAt(d.at, d.today.tzOffsetMin)}까지(${tzName(d.today.tzOffsetMin)}) · 어제 같은 시각까지와 견줌`
            : "오늘과 어제"}
        </em>
      </h2>
      {trend.error ? (
        <p className="mx-error" role="alert">사용량 추세를 불러오지 못함: {trend.error}</p>
      ) : !d ? (
        <p className="empty">{trend.loading ? "불러오는 중…" : "기록 없음"}</p>
      ) : (
        <dl className="mft-tiles mft-tiles-4">
          {TODAY.map((t) => (
            <div key={t.metric}>
              <dt>{t.label}</dt>
              <dd className="mft-value">{t.text(d.today.current)}</dd>
              {t.sub ? <dd className="mft-sub muted">{t.sub(d.today.current)}</dd> : null}
              <dd className="mft-prev">
                <Change label={d.today.previous.coverage < 1 ? "어제(기록 일부)" : "어제"} prev={d.today.previous} value={t.text(d.today.previous)} change={d.today.change[t.metric]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// ── 이번 기간: 가동·결과(COST·요청은 FUEL 요약 줄에) ──
interface Tile {
  metric: TrendMetric;
  label: string;
  value: (p: UsagePeriod) => string;
  sub?: (p: UsagePeriod) => string;
}
const GROUPS: { id: string; label: string; tiles: Tile[] }[] = [
  {
    id: "work",
    label: "가동",
    tiles: [
      { metric: "hours", label: "가동 시간", value: (p) => hoursText(hours(p)), sub: (p) => `CAPTAIN ${hoursText(p.captainHours)} · CREW ${hoursText(p.crewHours)}` },
      { metric: "leverage", label: "LEVERAGE", value: (p) => leverageText(p.leverage), sub: (p) => `÷ 흐른 ${hoursText(p.elapsedHours)}` },
      { metric: "aircraft", label: "AIRCRAFT", value: (p) => count(p.aircraft), sub: () => "요청이 있던 팀" },
    ],
  },
  {
    id: "result",
    label: "결과",
    tiles: [
      { metric: "flights", label: "ARRIVED", value: (p) => count(p.flights), sub: (p) => `PR ${count(p.prs)}` },
      { metric: "costPerFlight", label: "FLIGHT당", value: (p) => (p.costPerFlight === null ? "—" : money(p.costPerFlight)), sub: () => "COST ÷ ARRIVED" },
    ],
  },
];

// 주 추세의 줄: 단위가 다른 값이라 한 축에 겹치지 않고 줄마다 따로 잰다
const ROWS: { metric: TrendMetric; label: string; text: (p: UsagePeriod) => string }[] = [
  { metric: "cost", label: "COST", text: (p) => money(p.cost) },
  { metric: "hours", label: "가동 시간", text: (p) => hoursText(hours(p)) },
  { metric: "flights", label: "ARRIVED", text: (p) => count(p.flights) },
];

export function MetricsFuelTrend({ trend }: { trend: TrendState }) {
  const d = trend.data;
  if (!d) return null; // 불러오는 중·오류는 TODAY가 보인다
  const { current: cur, previous: prev, days } = d;
  return (
    <section className="mf-sec mft" aria-label="사용량 추세">
      <h2 className="label">
        USAGE <em>이번 {days}일 · 지난 {days}일과 견줌</em>
      </h2>
      {prev.coverage < 1 && (
        <p className="mft-note muted">
          {noCompareText(prev, days)}
          {d.historyStart ? ` · 대화 기록은 ${d.historyStart.slice(0, 10)}부터` : ""} — 변화는 지난 기간 기록이 다 찬 뒤에 보인다
        </p>
      )}
      <div className="mft-groups">
        {GROUPS.map((g) => (
          <section key={g.id} className="mft-group" aria-label={g.label}>
            <h3 className="mft-glabel">{g.label}</h3>
            <dl className="mft-tiles">
              {g.tiles.map((t) => (
                <div key={t.metric}>
                  <dt>{t.label}</dt>
                  <dd className="mft-value">{t.value(cur)}</dd>
                  {t.sub && t.sub(cur) ? <dd className="mft-sub muted">{t.sub(cur)}</dd> : null}
                  <dd className="mft-prev">
                    <Change label={previousLabel(prev, days)} prev={prev} value={t.value(prev)} change={d.change[t.metric]} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <Weeks data={d} />
    </section>
  );
}

function Weeks({ data }: { data: TrendData }) {
  const weeks = data.weeks;
  const last = weeks.length - 1;
  const [focus, setFocus] = useState<number>(last);
  const [table, setTable] = useState(false);
  const w = weeks[focus] ?? weeks[last];
  const before = weeks.filter((x) => x.coverage === 0).length;
  const cov = (x: UsagePeriod) => (x.coverage === 0 ? "기록 전" : x.coverage < 1 ? `${recordedDays(x.coverage, 7)}/7일` : "7/7일");
  return (
    <div className="mft-weeks">
      <h3 className="mft-glabel">
        최근 {weeks.length}주 <span className="muted">7일씩, 지금에서 거꾸로{before ? ` · 앞 ${before}주는 기록 전` : ""}</span>
      </h3>
      <div className="mft-rows" onMouseLeave={() => setFocus(last)}>
        {ROWS.map((row) => {
          const vals = weeks.map((x) => metricOf(x, row.metric) ?? 0);
          const max = Math.max(0, ...vals);
          return (
            <div key={row.metric} className="mft-row">
              <span className="mft-rlabel">{row.label}</span>
              <div className="mft-bars" role="list" aria-label={`${row.label} 주별`}>
                {weeks.map((x, i) => (
                  <span
                    key={x.from}
                    role="listitem"
                    tabIndex={0}
                    className={`mft-cell${i === focus ? " is-focus" : ""}${x.coverage === 0 ? " is-empty" : x.coverage < 1 ? " is-partial" : ""}${i === last ? " is-now" : ""}`}
                    aria-label={`${weekName(x, i === last)} ${row.label} ${x.coverage === 0 ? "기록 전" : row.text(x)}${x.coverage > 0 && x.coverage < 1 ? " (일부만 기록)" : ""}`}
                    onMouseEnter={() => setFocus(i)}
                    onFocus={() => setFocus(i)}
                  >
                    <span className="mft-fill" style={{ height: `${max ? Math.max(vals[i] ? 4 : 0, (vals[i] / max) * 100) : 0}%` }} />
                  </span>
                ))}
              </div>
              <span className="mft-rvalue">{w.coverage === 0 ? "—" : row.text(w)}</span>
            </div>
          );
        })}
      </div>
      <p className="mft-readout muted" aria-live="polite">
        <b>{weekName(w, weeks.indexOf(w) === last)}</b>
        {w.coverage === 0 ? " · 기록 전" : w.coverage < 1 ? ` · 기록 ${cov(w)}` : ""}
        {w.coverage > 0 ? ` · LEVERAGE ${leverageText(w.leverage)} · 요청 ${count(w.requests)} · AIRCRAFT ${w.aircraft} · PR ${w.prs}` : ""}
      </p>
      <button type="button" className="mf-linkbtn" aria-expanded={table} onClick={() => setTable((v) => !v)}>
        {table ? "표 닫기" : "표로 보기"}
      </button>
      {table && (
        <div className="mf-scroll">
          <table className="mf-table">
            <thead>
              <tr>
                <th>주(UTC)</th>
                <th className="num">COST</th>
                <th className="num">요청</th>
                <th className="num">가동 시간</th>
                <th className="num">LEVERAGE</th>
                <th className="num">AIRCRAFT</th>
                <th className="num">ARRIVED</th>
                <th className="num">PR</th>
                <th className="num">기록</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((x, i) => (
                <tr key={x.from}>
                  <td className="mono">{weekName(x, i === last)}</td>
                  <td className="num">{money(x.cost)}</td>
                  <td className="num">{count(x.requests)}</td>
                  <td className="num">{hoursText(hours(x))}</td>
                  <td className="num">{leverageText(x.leverage)}</td>
                  <td className="num">{x.aircraft}</td>
                  <td className="num">{x.flights}</td>
                  <td className="num">{x.prs}</td>
                  <td className="num">{cov(x)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
