import { useEffect, useState } from "react";
import { changeText, metricOf, noCompareText, type TrendMetric, type UsagePeriod, type UsageTrend } from "../../../server/fuel-trend.ts";
import { usd } from "../../../server/fuel-view.ts";
import { apiGet } from "../api.ts";

// USAGE TREND(ATC-389, docs/fuel.md "USAGE TREND as built"): 에이전트를 얼마나 쓰는지 지난 같은 기간·최근 주와 견준다. 읽기만 한다.
// 값과 변화율은 서버(/api/fuel/trend)가 셈하고 여기서는 보이기만 한다. FUEL 개요의 기간·새로고침을 따른다

type TrendData = UsageTrend & { at: string };

const money = (v: number) => (v === 0 ? "$0" : usd(v));
const hoursText = (h: number) => `${h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString("en-US")}h`;
const count = (n: number) => n.toLocaleString("en-US");
const md = (iso: string) => iso.slice(5, 10);
// 주의 이름: 끝나는 날(그날 지금 시각까지). 마지막 주는 "이번 주"
const weekName = (w: UsagePeriod, last: boolean) => (last ? "이번 주" : `${md(w.from)}–${md(new Date(Date.parse(w.to) - 1).toISOString())}`);

interface Tile {
  metric: TrendMetric;
  label: string;
  value: (p: UsagePeriod) => string;
  sub?: (p: UsagePeriod) => string;
}
const GROUPS: { id: string; label: string; tiles: Tile[] }[] = [
  {
    id: "fuel",
    label: "FUEL",
    tiles: [
      // CAPTAIN·CREW 비용과 가격 없는 모델은 아래 요약이 보인다(되풀이하지 않는다)
      { metric: "cost", label: "COST", value: (p) => money(p.cost) },
      { metric: "requests", label: "요청", value: (p) => count(p.requests) },
    ],
  },
  {
    id: "work",
    label: "가동",
    tiles: [
      { metric: "hours", label: "가동 시간", value: (p) => hoursText(p.captainHours + p.crewHours), sub: (p) => `CAPTAIN ${hoursText(p.captainHours)} · CREW ${hoursText(p.crewHours)}` },
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
  { metric: "hours", label: "가동 시간", text: (p) => hoursText(p.captainHours + p.crewHours) },
  { metric: "flights", label: "ARRIVED", text: (p) => count(p.flights) },
];

export function MetricsFuelTrend({ days, tick }: { days: number; tick: number }) {
  const [data, setData] = useState<TrendData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet(`/api/fuel/trend?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/api/fuel/trend → HTTP ${r.status}`))))
      .then((d: TrendData) => alive && (setData(d), setLoading(false)))
      .catch((e) => alive && (setError(String((e as Error).message ?? e)), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [days, tick]);

  return (
    <section className="mf-sec mft" aria-label="사용량 추세" aria-busy={loading}>
      <h2 className="label">
        USAGE <em>{data ? `이번 ${data.days}일 · 지난 ${data.days}일과 견줌` : "에이전트 사용량"}</em>
      </h2>
      {error ? (
        <p className="mx-error" role="alert">사용량 추세를 불러오지 못함: {error}</p>
      ) : !data ? (
        <p className="empty">{loading ? "불러오는 중…" : "기록 없음"}</p>
      ) : (
        <Body data={data} />
      )}
    </section>
  );
}

function Body({ data }: { data: TrendData }) {
  const { current: cur, previous: prev, days } = data;
  const comparable = prev.coverage >= 1;
  return (
    <>
      {!comparable && (
        <p className="mft-note faint">
          {noCompareText(prev, days)}
          {data.historyStart ? ` · 대화 기록은 ${data.historyStart.slice(0, 10)}부터` : ""} — 변화는 지난 기간 기록이 다 찬 뒤에 보인다
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
                  {t.sub && t.sub(cur) ? <dd className="mft-sub faint">{t.sub(cur)}</dd> : null}
                  <dd className="mft-prev">
                    <Change data={data} tile={t} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <Weeks data={data} />
    </>
  );
}

// 지난 기간 값과 변화. 견줄 수 없으면 지난 값만(있을 때)
function Change({ data, tile }: { data: TrendData; tile: Tile }) {
  const text = changeText(data.change[tile.metric]);
  const prevKnown = data.previous.coverage > 0;
  return (
    <>
      <span className="muted">지난 {data.days}일 {prevKnown ? tile.value(data.previous) : "—"}</span>
      {text ? <b className="mft-delta"> {text}</b> : null}
    </>
  );
}

function Weeks({ data }: { data: TrendData }) {
  const weeks = data.weeks;
  const last = weeks.length - 1;
  const [focus, setFocus] = useState<number>(last);
  const [table, setTable] = useState(false);
  const w = weeks[focus] ?? weeks[last];
  const before = weeks.filter((x) => x.coverage === 0).length;
  return (
    <div className="mft-weeks">
      <h3 className="mft-glabel">
        최근 {weeks.length}주 <span className="faint">7일씩, 지금에서 거꾸로{before ? ` · 앞 ${before}주는 기록 전` : ""}</span>
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
        {w.coverage === 0 ? " · 기록 전" : w.coverage < 1 ? ` · 기록 ${Math.round(w.coverage * 7 * 10) / 10}/7일` : ""}
        {w.coverage > 0 ? ` · 요청 ${count(w.requests)} · AIRCRAFT ${w.aircraft} · PR ${w.prs}` : ""}
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
                  <td className="num">{hoursText(x.captainHours + x.crewHours)}</td>
                  <td className="num">{x.aircraft}</td>
                  <td className="num">{x.flights}</td>
                  <td className="num">{x.prs}</td>
                  <td className="num">{x.coverage === 0 ? "기록 전" : x.coverage < 1 ? `${Math.round(x.coverage * 7 * 10) / 10}/7일` : "7/7일"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
