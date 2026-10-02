import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "../../../server/model.ts";
import { DEFAULT_TEAM_PATTERN } from "../../../server/registration.ts";
import type { FuelSummary } from "../../../server/fuel.ts";
import { CREW_WARNING_LABEL, pctText, tokensText, usd } from "../../../server/fuel-view.ts";
import {
  clampWindow, crewWarningRowsOf, dayBarsOf, FUEL_DEFAULT_WINDOW, FUEL_WINDOWS, groupedRows, leakViewsOf, type LogbookFuelEntry, modelRowsOf, PRICE_NOTE, rowsOf,
  type SortKey, summaryOf, topFlightsOf,
} from "../fuel-overview.ts";
import { FuelAccounts } from "./fleet/Fuel.tsx";
import { MetricsFuelTrend, SummaryChange, type TrendData, type TrendState, UsageToday, useUsageTrend } from "./MetricsFuelTrend.tsx";
import "./MetricsFuel.css";
import { apiGet } from "../api.ts";

// FUEL 개요(ATC-137, docs/fuel.md "FUEL overview as built"): METRICS 탭 안 #metrics/fuel. 읽기만 한다.
// /api/fuel과 /api/logbook은 열 때, 기간을 바꿀 때, 새로고침 버튼을 누를 때만 읽는다(스냅샷마다 읽지 않는다).

type FuelData = FuelSummary & { at: string; teamPattern?: string; scan?: { files: number; bytesRead: number; ms: number } };
interface State {
  days: number;
  fuel: FuelData | null;
  entries: LogbookFuelEntry[];
  loading: boolean;
  error: string | null;
}

const money = (v: number) => (v === 0 ? "$0" : usd(v));
const pctOrDash = (v: number | null) => (v === null ? "—" : pctText(v));
const stamp = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}Z`;

export function MetricsFuel({ snapshot }: { snapshot: Snapshot | null }) {
  const [days, setDays] = useState<number>(FUEL_DEFAULT_WINDOW);
  const [st, setSt] = useState<State>({ days: FUEL_DEFAULT_WINDOW, fuel: null, entries: [], loading: true, error: null });
  const [tick, setTick] = useState(0); // 새로고침 버튼
  const trend = useUsageTrend(days, tick); // ATC-389: 어제·지난 기간·최근 주와 견주기(요약 줄과 USAGE가 같이 쓴다)

  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    const get = (url: string) => apiGet(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url} → HTTP ${r.status}`))));
    Promise.all([get(`/api/fuel?days=${days}`), get(`/api/logbook?days=${days}`).catch(() => ({ entries: [] }))])
      .then(([fuel, log]) => alive && setSt({ days, fuel, entries: Array.isArray(log.entries) ? log.entries : [], loading: false, error: null }))
      .catch((e) => alive && setSt((s) => ({ ...s, loading: false, error: String((e as Error).message ?? e) })));
    return () => {
      alive = false;
    };
  }, [days, tick]);

  const { fuel } = st;
  return (
    <section className="mf" aria-label="FUEL 개요" aria-busy={st.loading}>
      <div className="toolbar mf-bar">
        <span className="muted">
          {fuel ? (
            <>
              {stamp(fuel.since)}부터 {fuel.days}일 · {stamp(fuel.at)} 읽음
              {fuel.scan ? <span className="faint"> · 파일 {fuel.scan.files}개 {fuel.scan.ms}ms</span> : null}
            </>
          ) : st.loading ? (
            "FUEL 기록을 읽는 중…"
          ) : (
            "FUEL 기록 없음"
          )}
        </span>
        <div className="mx-range" role="radiogroup" aria-label="기간">
          {FUEL_WINDOWS.map((d) => (
            <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(clampWindow(d))}>
              {d}일
            </button>
          ))}
        </div>
        <button type="button" className="mf-refresh" onClick={() => setTick((n) => n + 1)} disabled={st.loading} aria-label="FUEL 다시 읽기">
          {st.loading ? "읽는 중…" : "새로고침"}
        </button>
      </div>

      <UsageToday trend={trend} />

      {st.error && (
        <p className="mx-error" role="alert">
          FUEL을 불러오지 못함: {st.error}{" "}
          <button type="button" className="mf-refresh" onClick={() => setTick((n) => n + 1)}>
            다시 시도
          </button>
        </p>
      )}
      {!fuel ? (
        st.loading ? <p className="empty">불러오는 중…</p> : null
      ) : fuel.requests === 0 ? (
        <p className="empty mf-empty">이 기간({fuel.days}일)에 읽은 요청이 없다 — ~/.claude/projects의 대화 기록에 그 기간 기록이 없다.</p>
      ) : (
        <Body fuel={fuel} entries={st.entries} snapshot={snapshot} trend={trend} />
      )}
    </section>
  );
}

function Body({ fuel, entries, snapshot, trend }: { fuel: FuelData; entries: LogbookFuelEntry[]; snapshot: Snapshot | null; trend: TrendState }) {
  const sum = summaryOf(fuel.totals, fuel.requests);
  // 지난 기간 줄은 같은 기간의 추세일 때만(기간을 바꾸는 사이 앞 기간 값이 붙지 않게)
  const prev: TrendData | null = trend.data && trend.data.days === fuel.days ? trend.data : null;
  return (
    <>
      <section className="mf-sum" aria-label="요약">
        <dl className="mf-kpis">
          <div>
            <dt>FUEL COST</dt>
            <dd>{money(sum.total)}</dd>
            <dd className="mf-kpi-prev"><SummaryChange trend={prev} metric="cost" /></dd>
          </div>
          <div>
            <dt>CAPTAIN</dt>
            <dd>{money(sum.captain)}</dd>
          </div>
          <div>
            <dt title="서브에이전트 출력은 하한">CREW</dt>
            <dd>
              {money(sum.crew)} <span className="faint">{pctOrDash(sum.crewShare)}</span>
            </dd>
          </div>
          <div>
            <dt>CACHE HIT</dt>
            <dd>{pctOrDash(sum.cacheHit)}</dd>
          </div>
          <div>
            <dt>요청</dt>
            <dd>{sum.requests.toLocaleString("en-US")}</dd>
            <dd className="mf-kpi-prev"><SummaryChange trend={prev} metric="requests" /></dd>
          </div>
          <div>
            <dt title="비용 − 값이 매겨진 LEAK">NET</dt>
            <dd>{money(fuel.totals.netCost)}</dd>
          </div>
        </dl>
        <p className="mf-unpriced" title="가격표(server/fuel-prices.json)에 없는 모델의 요청은 비용에 넣지 않는다. 0이 아니라 빠진 것이다">
          {sum.unpriced}
        </p>
        <p className="faint mf-note">{PRICE_NOTE}</p>
      </section>

      <MetricsFuelTrend trend={trend} />

      {snapshot?.fuelAccounts?.length ? <FuelAccounts accounts={snapshot.fuelAccounts} /> : null}

      <Rows fuel={fuel} />
      <Models byModel={fuel.byModel ?? []} />
      <Leaks fuel={fuel} />
      <Daily fuel={fuel} />
      <Top entries={entries} since={fuel.since} tickets={snapshot?.tickets ?? []} />
    </>
  );
}

// ── AIRCRAFT · 세션 ──
const COLS: { key: SortKey; label: string; num?: boolean; title?: string }[] = [
  { key: "label", label: "AIRCRAFT · 세션" },
  { key: "cost", label: "COST", num: true },
  { key: "requests", label: "요청", num: true },
  { key: "cacheHit", label: "CACHE", num: true, title: "CACHE HIT" },
  { key: "crewShare", label: "CREW 몫", num: true, title: "비용 중 CREW 몫" },
  { key: "leakCost", label: "LEAK", num: true, title: "값이 매겨진 LEAK 비용" },
  { key: "net", label: "NET", num: true, title: "비용 − LEAK" },
  { key: "topModel", label: "주 모델", title: "요청이 가장 많은 모델" },
];

function Rows({ fuel }: { fuel: FuelData }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "cost", dir: "desc" });
  const rows = useMemo(() => rowsOf(fuel.aircraft, fuel.sessions, fuel.teamPattern ?? DEFAULT_TEAM_PATTERN), [fuel]);
  const groups = groupedRows(rows, sort.key, sort.dir);
  const flip = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "label" || key === "topModel" ? "asc" : "desc" }));
  return (
    <section className="mf-sec" aria-label="AIRCRAFT와 세션별">
      <h2 className="label">
        BY AIRCRAFT <em>세션 {fuel.sessions.length}개 · 팀 AIRCRAFT 먼저, 관제 세션, 기타</em>
      </h2>
      <div className="mf-scroll">
        <table className="mf-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={c.num ? "num" : undefined} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} title={c.title}>
                  <button type="button" onClick={() => flip(c.key)}>
                    {c.label}
                    <span aria-hidden> {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.id}>
              <tr className="mf-group">
                <th colSpan={COLS.length} scope="colgroup">
                  {g.label} <span className="faint">{g.rows.length}</span>
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.key}>
                  <td className="mf-name mono">{r.fleet ? <a href={`#fleet/${encodeURIComponent(r.label)}`} title="FLEET 카드로">{r.label}</a> : r.label}</td>
                  <td className="num">{money(r.cost)}</td>
                  <td className="num">{r.requests.toLocaleString("en-US")}</td>
                  <td className="num">{pctOrDash(r.cacheHit)}</td>
                  <td className="num">{pctOrDash(r.crewShare)}</td>
                  <td className="num">{r.leakCost ? money(r.leakCost) : "—"}</td>
                  <td className="num">{money(r.net)}</td>
                  <td className="mono mf-model" title={r.topModel ?? undefined}>{r.topModel ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

// ── 모델 ──
function Models({ byModel }: { byModel: FuelData["byModel"] }) {
  const { priced, unpriced } = modelRowsOf(byModel);
  if (!byModel.length) return null;
  return (
    <section className="mf-sec" aria-label="모델별">
      <h2 className="label">
        BY MODEL <em>{byModel.length}개</em>
      </h2>
      <div className="mf-scroll">
        <table className="mf-table">
          <thead>
            <tr>
              <th>모델</th>
              <th className="num">요청</th>
              <th className="num">토큰</th>
              <th className="num">COST</th>
            </tr>
          </thead>
          <tbody>
            {[...priced, ...unpriced].map((m) => (
              <tr key={m.model} className={unpriced.includes(m) ? "mf-noprice" : undefined}>
                <td className="mono mf-model" title={m.model}>{m.model}</td>
                <td className="num">{m.requests.toLocaleString("en-US")}</td>
                <td className="num">{tokensText(m.tokens)}</td>
                <td className="num">
                  {unpriced.includes(m) ? (
                    <span className="mf-noprice-tag" title="가격표에 없는 모델 — 비용에 넣지 않았다">no price</span>
                  ) : (
                    <>
                      {money(m.cost)}
                      {m.unpricedRequests > 0 && <span className="faint" title={`일부 요청 ${m.unpricedRequests}건은 값이 없다`}> +{m.unpricedRequests}건 값 없음</span>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── LEAK · CREW 경고 ──
function Leaks({ fuel }: { fuel: FuelData }) {
  const leaks = leakViewsOf(fuel.totals.leak);
  const warns = crewWarningRowsOf(fuel.totals.crewWarnings);
  return (
    <section className="mf-sec" aria-label="LEAK과 CREW 경고">
      <h2 className="label">
        LEAKS <em>합계 {fuel.totals.leak.total.count}건 · {money(fuel.totals.leak.total.cost)}</em>
      </h2>
      <div className="mf-scroll">
        <table className="mf-table">
          <thead>
            <tr>
              <th>종류</th>
              <th className="num">건</th>
              <th className="num">다시 쓴 토큰</th>
              <th className="num">COST</th>
              <th>뜻</th>
            </tr>
          </thead>
          <tbody>
            {leaks.map((l) => (
              <tr key={l.key} className={l.outside ? "mf-outside" : undefined}>
                <td><span className="mono">{l.label}</span>{l.outside && <span className="faint"> (LEAK 밖)</span>}</td>
                <td className="num">{l.count}</td>
                <td className="num">{tokensText(l.tokens)}</td>
                <td className="num">{l.cost ? money(l.cost) : l.unpricedTokens ? "no price" : "—"}</td>
                <td className="mf-mean">{l.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mf-sub">CREW 경고</h3>
      <ul className="mf-warns">
        {warns.map((w) => (
          <li key={w.kind} className={w.count ? "has" : undefined}>
            <span className="mono">{CREW_WARNING_LABEL[w.kind]}</span> <b>{w.count}</b> <span className="faint">{w.meaning}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── 날짜별 ──
const W = 640;
const H = 180;
const PAD = { l: 44, r: 8, t: 10, b: 22 };

function Daily({ fuel }: { fuel: FuelData }) {
  const { bars, max } = useMemo(() => dayBarsOf(fuel.byDay ?? [], fuel.since, Date.parse(fuel.at)), [fuel]);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / Math.max(1, bars.length);
  const bw = Math.min(28, slot * 0.7);
  const y = (v: number) => PAD.t + plotH - (max ? (v / max) * plotH : 0);
  const cur = hover === null ? null : bars[hover];
  const ticks = [0, 0.5, 1].map((f) => max * f);
  return (
    <section className="mf-sec" aria-label="날짜별">
      <h2 className="label">
        PER DAY <em>UTC 날짜 · CAPTAIN과 CREW 비용</em>
      </h2>
      <ul className="mf-legend" aria-label="범례">
        <li><span className="mf-swatch cap" aria-hidden /> CAPTAIN</li>
        <li><span className="mf-swatch crew" aria-hidden /> CREW</li>
        <li className="faint"><span className="mf-swatch unpriced" aria-hidden /> 가격 없는 모델이 있는 날(그 몫은 비용에 없다)</li>
      </ul>
      <div className="mf-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`날짜별 FUEL COST, 최대 ${money(max)}`} preserveAspectRatio="none">
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="mf-grid" />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="mf-axis">{v === 0 ? "0" : usd(v)}</text>
            </g>
          ))}
          {bars.map((b, i) => {
            const x = PAD.l + slot * i + (slot - bw) / 2;
            const capH = max ? (b.captain / max) * plotH : 0;
            const crewH = max ? (b.crew / max) * plotH : 0;
            const gap = capH > 0 && crewH > 0 ? 2 : 0;
            return (
              <g key={b.day} className={hover === i ? "is-hover" : undefined}>
                {capH > 0 && <rect x={x} y={y(0) - capH} width={bw} height={capH} rx={2} className="mf-bar-cap" />}
                {crewH > 0 && <rect x={x} y={y(0) - capH - crewH - gap} width={bw} height={crewH} rx={2} className="mf-bar-crew" />}
                {b.unpricedTokens > 0 && <rect x={x} y={PAD.t + plotH + 3} width={bw} height={3} className="mf-bar-unpriced" />}
                <rect
                  x={PAD.l + slot * i}
                  y={PAD.t}
                  width={slot}
                  height={plotH + PAD.b}
                  className="mf-hit"
                  tabIndex={0}
                  role="img"
                  aria-label={`${b.day} CAPTAIN ${money(b.captain)} CREW ${money(b.crew)} 요청 ${b.requests}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          {bars.map((b, i) => (i === 0 || i === bars.length - 1 || (bars.length > 8 && i === Math.floor(bars.length / 2)) ? (
            <text key={b.day} x={PAD.l + slot * i + slot / 2} y={H - 6} textAnchor={i === 0 ? "start" : i === bars.length - 1 ? "end" : "middle"} className="mf-axis">{b.day.slice(5)}</text>
          ) : null))}
        </svg>
        {cur && (
          <div className="mf-tip" role="status" style={{ left: `${Math.min(80, Math.max(0, ((PAD.l + slot * (hover ?? 0)) / W) * 100))}%` }}>
            <b className="mono">{cur.day}</b>
            <span><span className="mf-swatch cap" aria-hidden /> CAPTAIN {money(cur.captain)}</span>
            <span><span className="mf-swatch crew" aria-hidden /> CREW {money(cur.crew)}</span>
            <span className="faint">요청 {cur.requests}{cur.unpricedTokens ? ` · 값 없음 ${tokensText(cur.unpricedTokens)} tok` : ""}</span>
          </div>
        )}
      </div>
      <button type="button" className="mf-linkbtn" aria-expanded={table} onClick={() => setTable((v) => !v)}>
        {table ? "표 닫기" : "표로 보기"}
      </button>
      {table && (
        <div className="mf-scroll">
          <table className="mf-table">
            <thead>
              <tr>
                <th>UTC 날짜</th>
                <th className="num">CAPTAIN</th>
                <th className="num">CREW</th>
                <th className="num">요청</th>
                <th className="num">값 없는 토큰</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.day}>
                  <td className="mono">{b.day}</td>
                  <td className="num">{money(b.captain)}</td>
                  <td className="num">{money(b.crew)}</td>
                  <td className="num">{b.requests}</td>
                  <td className="num">{b.unpricedTokens ? tokensText(b.unpricedTokens) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── 비싼 FLIGHT ──
function Top({ entries, since, tickets }: { entries: LogbookFuelEntry[]; since: string; tickets: Snapshot["tickets"] }) {
  const top = topFlightsOf(entries, since);
  const urlOf = new Map(tickets.map((t) => [t.key, t.url]));
  return (
    <section className="mf-sec" aria-label="비싼 FLIGHT">
      <h2 className="label">
        TOP FLIGHTS <em>ARRIVED, NET 큰 순서 · 최대 10</em>
      </h2>
      {top.length === 0 ? (
        <p className="empty mf-empty">이 기간에 값이 매겨진 ARRIVED FLIGHT가 없다.</p>
      ) : (
        <div className="mf-scroll">
          <table className="mf-table">
            <thead>
              <tr>
                <th>FLIGHT</th>
                <th>AIRCRAFT</th>
                <th className="num">NET</th>
                <th>TRIP</th>
              </tr>
            </thead>
            <tbody>
              {top.map((f) => (
                <tr key={f.flight}>
                  <td className="mono">
                    {urlOf.get(f.flight) ? (
                      <a href={urlOf.get(f.flight)!} target="_blank" rel="noreferrer">{f.flight}</a>
                    ) : (
                      f.flight
                    )}
                  </td>
                  <td className="mono">{f.aircraft ?? "—"}</td>
                  <td className="num">{money(f.net)}</td>
                  <td>
                    {f.verdict === "unexpected" ? (
                      <span className="mf-verdict is-bad" title="같은 TYPE × WAKE의 TRIP FUEL p90을 넘음">UNEXPECTED</span>
                    ) : f.verdict === "inside" ? (
                      <span className="mf-verdict" title="TRIP FUEL 안">inside</span>
                    ) : (
                      <span className="faint" title="비교할 FLIGHT가 모자람">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

