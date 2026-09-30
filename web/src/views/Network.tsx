import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { formatClock, useSettings } from "../settings.ts";
import "./Metrics.css";
import "./Network.css";
import { RouteMap } from "./RouteMap.tsx";

// 4단계 NETWORK: ROUTE(Linear 프로젝트)·AIRCRAFT·28일 추이를 한눈에. 읽기만 한다.
// 차트는 METRICS와 같은 모양(인라인 SVG, 계열 하나)으로 그린다.

interface Goal {
  targetDate: string | null;
  progress: number | null; // 0..1
  state: string | null;
}
interface RouteRow {
  project: string;
  goal: Goal | null;
  open: { todo: number; inProgress: number; inReview: number };
  arrived14: number;
  aircraft: string[];
  landingWaitMedianMin: number | null;
}
interface AircraftRow {
  registration: string;
  callsign: string;
  status: string; // busy | idle | dead | absent
  targets: { flightsPerWeek: number | null; onTime: number | null };
  actuals: { weekDone: number; onTimeRate: number | null; landingWaitMedianMin: number | null; reverts: number; los: number };
}
interface DayRow {
  date: string;
  arrived: number;
  landingWaitMedianMin: number | null;
  reverts: number;
}
interface GateRow {
  date: string;
  dispatchDecided: number;
  dispatchAgreement: number | null; // 그날까지 누적
  scheduleDecided: number;
  scheduleAgreement: number | null; // 그날까지 누적
  crosscheckMatch: number | null; // 그날까지 누적
}
interface NetworkData {
  at: string | null;
  windowDays: number;
  routes: RouteRow[];
  aircraft: AircraftRow[];
  trend: { days: DayRow[]; gates: GateRow[] };
  sources: { linear: boolean; github: boolean; githubOff?: boolean; logbook: boolean };
}

// 서버가 필드를 빠뜨려도(옛 서버·부분 실패) 화면이 깨지지 않게 채운다.
type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const int = (x: unknown): number => num(x) ?? 0;
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

function normalize(raw: unknown): NetworkData {
  const r = obj(raw);
  const trend = obj(r.trend);
  const src = obj(r.sources);
  return {
    at: str(r.at),
    windowDays: num(r.windowDays) ?? 28,
    routes: arr(r.routes).map((x) => {
      const o = obj(x);
      const open = obj(o.open);
      const g = o.goal ? obj(o.goal) : null;
      return {
        project: str(o.project) ?? "—",
        goal: g && { targetDate: str(g.targetDate), progress: num(g.progress), state: str(g.state) },
        open: { todo: int(open.todo), inProgress: int(open.inProgress), inReview: int(open.inReview) },
        arrived14: int(o.arrived14),
        aircraft: arr(o.aircraft).filter((a): a is string => typeof a === "string"),
        landingWaitMedianMin: num(o.landingWaitMedianMin),
      };
    }),
    aircraft: arr(r.aircraft).map((x) => {
      const o = obj(x);
      const t = obj(o.targets);
      const a = obj(o.actuals);
      return {
        registration: str(o.registration) ?? "—",
        callsign: str(o.callsign) ?? "",
        status: str(o.status) ?? "absent",
        targets: { flightsPerWeek: num(t.flightsPerWeek), onTime: num(t.onTime) },
        actuals: {
          weekDone: int(a.weekDone),
          onTimeRate: num(a.onTimeRate),
          landingWaitMedianMin: num(a.landingWaitMedianMin),
          reverts: int(a.reverts),
          los: int(a.los),
        },
      };
    }),
    trend: {
      days: arr(trend.days).map((x) => {
        const o = obj(x);
        return { date: str(o.date) ?? "", arrived: int(o.arrived), landingWaitMedianMin: num(o.landingWaitMedianMin), reverts: int(o.reverts) };
      }),
      gates: arr(trend.gates).map((x) => {
        const o = obj(x);
        return {
          date: str(o.date) ?? "",
          dispatchDecided: int(o.dispatchDecided),
          dispatchAgreement: num(o.dispatchAgreement),
          scheduleDecided: int(o.scheduleDecided),
          scheduleAgreement: num(o.scheduleAgreement),
          crosscheckMatch: num(o.crosscheckMatch),
        };
      }),
    },
    // 모르면 있다고 본다(알림은 서버가 false라고 말할 때만)
    sources: { linear: src.linear !== false, github: src.github !== false, githubOff: src.githubOff === true, logbook: src.logbook !== false },
  };
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
// FLEET 카드와 같은 표기: 45m, 3h20m, 2d4h
function dur(x: number | null): string {
  if (x === null) return "—";
  const min = Math.round(x);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? `${String(min % 60).padStart(2, "0")}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}
const count = (x: number | null) => (x === null ? "—" : String(x));
const shortDate = (d: string) => d.slice(5) || "—";

const STATUS: Record<string, string> = { busy: "AIRBORNE", idle: "대기", dead: "NORDO", absent: "NOT IN SERVICE" };
const GOAL_STATE: Record<string, string> = {
  backlog: "BACKLOG",
  planned: "PLANNED",
  started: "STARTED",
  paused: "PAUSED",
  completed: "COMPLETED",
  canceled: "CANCELED",
};

export function Network({ refreshKey }: { refreshKey: string }) {
  const { clock } = useSettings();
  const [data, setData] = useState<NetworkData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 스냅샷이 바뀔 때(최대 몇 초 간격) 다시 읽는다.
  useEffect(() => {
    let alive = true;
    fetch("/api/network")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && (setData(normalize(d)), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <section className="metrics network">
      <div className="toolbar">
        <span className="muted">
          Linear·LOGBOOK·DISPATCH·SCHEDULE 기록 기준
          {data?.at ? ` · ${formatClock(data.at, clock)} 집계` : ""}
        </span>
      </div>

      {error && (
        <p className="mx-error" role="alert">
          NETWORK를 불러오지 못함: {error}
        </p>
      )}
      {!data ? (
        !error && <p className="empty">불러오는 중…</p>
      ) : (
        <>
          <Sources sources={data.sources} />
          <RouteMap refreshKey={refreshKey} />
          <Routes routes={data.routes} />
          <Aircraft aircraft={data.aircraft} />
          <Trends days={data.trend.days} gates={data.trend.gates} windowDays={data.windowDays} />
        </>
      )}
    </section>
  );
}

// 출처 하나라도 못 읽었으면 빠진 데이터가 있을 수 있다고 알린다.
function Sources({ sources }: { sources: NetworkData["sources"] }) {
  const notes = [
    !sources.linear && { code: "LINEAR", text: "Linear를 읽지 못함 — ROUTES의 열린 FLIGHT와 프로젝트 목표가 빠졌을 수 있음" },
    !sources.github && {
      code: "GITHUB",
      text: sources.githubOff ? "GitHub off (ATC_GITHUB=off) — PR 자료를 읽지 않음, 최근 ARRIVED·LANDING 대기·되돌림이 없음" : "GitHub를 읽지 못함 — 최근 ARRIVED·LANDING 대기·되돌림이 빠졌을 수 있음",
    },
    !sources.logbook && { code: "LOGBOOK", text: "LOGBOOK을 읽지 못함 — AIRCRAFT 실적과 TRENDS가 빠졌을 수 있음" },
  ].filter((n): n is { code: string; text: string } => !!n);
  if (!notes.length) return null;
  return (
    <ul className="nw-sources" aria-label="데이터 출처 알림">
      {notes.map((n) => (
        <li key={n.code}>
          <span className="nw-source-code">{n.code}</span>
          {n.text}
        </li>
      ))}
    </ul>
  );
}

// 넓은 표는 자기 상자 안에서만 가로로 넘긴다(키보드로도 넘기게 초점을 받는다).
function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nw-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

// 목표 미달: 색에 더해 ▼ 표시와 스크린 리더용 글자로 말한다.
function Short({ short, children, title }: { short: boolean; children: ReactNode; title?: string }) {
  if (!short) return <>{children}</>;
  return (
    <span className="nw-short" title={title}>
      <span aria-hidden>▼ </span>
      {children}
      <span className="nw-sr"> (목표 미달)</span>
    </span>
  );
}

function Routes({ routes }: { routes: RouteRow[] }) {
  return (
    <>
      <h2 className="label">
        ROUTES <em>Linear 프로젝트별 · 열린 FLIGHT, 최근 14일 ARRIVED</em>
      </h2>
      {!routes.length ? (
        <p className="empty nw-empty">보여 줄 ROUTE가 없음 — FLEET에서 AIRCRAFT에 ROUTE(Linear 프로젝트)를 정하면 여기 나온다.</p>
      ) : (
        <Scroll label="ROUTES 표">
          <table className="mx-table nw-table">
            <thead>
              <tr>
                <th>ROUTE</th>
                <th className="num">TODO</th>
                <th className="num">IN PROGRESS</th>
                <th className="num">IN REVIEW</th>
                <th className="num">ARRIVED 14D</th>
                <th>AIRCRAFT</th>
                <th className="num" title="PR을 연 뒤 머지될 때까지, 최근 14일 중앙값">
                  LANDING <em>대기</em>
                </th>
                <th>GOAL</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.project}>
                  <th scope="row" className="nw-name">
                    {r.project}
                  </th>
                  <td className="num">{r.open.todo}</td>
                  <td className="num">{r.open.inProgress}</td>
                  <td className="num">{r.open.inReview}</td>
                  <td className="num">{r.arrived14}</td>
                  <td className="mono">{r.aircraft.length ? r.aircraft.join(" · ") : <span className="faint">—</span>}</td>
                  <td className="num">{dur(r.landingWaitMedianMin)}</td>
                  <td>
                    <GoalCell goal={r.goal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
    </>
  );
}

function GoalCell({ goal }: { goal: Goal | null }) {
  if (!goal || (goal.targetDate === null && goal.progress === null && goal.state === null)) return <span className="faint">—</span>;
  const p = goal.progress === null ? null : Math.max(0, Math.min(1, goal.progress));
  return (
    <span className="nw-goal">
      {goal.targetDate && <span className="mono">{goal.targetDate}</span>}
      {p !== null && (
        <span className="nw-goal-bar" title={`진척 ${pct(p)}`}>
          <span className="nw-goal-track" aria-hidden>
            <span style={{ width: `${p * 100}%` }} />
          </span>
          <span className="mono">{pct(p)}</span>
        </span>
      )}
      {goal.state && <span className="nw-goal-state">{GOAL_STATE[goal.state] ?? goal.state.toUpperCase()}</span>}
    </span>
  );
}

function Aircraft({ aircraft }: { aircraft: AircraftRow[] }) {
  const anyShort = aircraft.some((a) => weekShort(a) || onTimeShort(a));
  return (
    <>
      <h2 className="label">
        AIRCRAFT <em>TARGETS 대비 실적 · 정시율·LANDING 대기·되돌림·LOS는 최근 14일</em>
      </h2>
      {!aircraft.length ? (
        <p className="empty nw-empty">운항 중인 AIRCRAFT가 없음 — FLEET 탭의 ENTRY INTO SERVICE로 등록한다.</p>
      ) : (
        <>
          <Scroll label="AIRCRAFT 표">
            <table className="mx-table nw-table">
              <thead>
                <tr>
                  <th>AIRCRAFT</th>
                  <th>
                    <em>상태</em>
                  </th>
                  <th className="num">
                    <em>이번 주 / 목표</em>
                  </th>
                  <th className="num">
                    <em>정시율 / 목표</em>
                  </th>
                  <th className="num">
                    LANDING <em>대기</em>
                  </th>
                  <th className="num">
                    <em>되돌림</em>
                  </th>
                  <th className="num">LOS</th>
                </tr>
              </thead>
              <tbody>
                {aircraft.map((a) => (
                  <tr key={a.registration}>
                    <th scope="row" className="nw-name">
                      <span className="nw-reg">{a.registration}</span>
                      {a.callsign && <span className="nw-cs">{a.callsign}</span>}
                    </th>
                    <td className="nw-status">
                      {a.status in STATUS && a.status !== "absent" && <span className={`dot dot-${a.status}`} aria-hidden />}
                      {a.status === "idle" ? <em>{STATUS.idle}</em> : (STATUS[a.status] ?? a.status.toUpperCase())}
                    </td>
                    <td className="num">
                      <Short short={weekShort(a)} title={`이번 주 목표 ${a.targets.flightsPerWeek}편에 못 미침`}>
                        {a.actuals.weekDone}
                      </Short>
                      <span className="faint"> / {count(a.targets.flightsPerWeek)}</span>
                    </td>
                    <td className="num">
                      <Short short={onTimeShort(a)} title={`정시율 목표 ${pct(a.targets.onTime)}에 못 미침`}>
                        {pct(a.actuals.onTimeRate)}
                      </Short>
                      <span className="faint"> / {pct(a.targets.onTime)}</span>
                    </td>
                    <td className="num">{dur(a.actuals.landingWaitMedianMin)}</td>
                    <td className="num">{a.actuals.reverts}</td>
                    <td className="num">{a.actuals.los}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          <p className="mx-note">
            {anyShort ? "▼ 목표 미달. " : ""}목표가 없으면 "—". TARGETS는 FLEET에서 정하고, 실적은 보여 주기만 한다(배정·점수에 쓰지 않음).
          </p>
        </>
      )}
    </>
  );
}

const weekShort = (a: AircraftRow) => a.targets.flightsPerWeek !== null && a.actuals.weekDone < a.targets.flightsPerWeek;
const onTimeShort = (a: AircraftRow) =>
  a.targets.onTime !== null && a.actuals.onTimeRate !== null && a.actuals.onTimeRate < a.targets.onTime;

interface Series {
  code: string;
  label: string;
  values: (number | null)[];
  fmt: (x: number | null) => string;
  max?: number; // 비율은 1로 고정
  sum?: boolean; // 일별 개수: 머리에 기간 합계를 보인다
  running?: boolean; // 그날까지 누적 값: 머리에 최근 값을 보인다
}

function Trends({ days, gates, windowDays }: { days: DayRow[]; gates: GateRow[]; windowDays: number }) {
  const flow: Series[] = [
    { code: "ARRIVED", label: "일별", values: days.map((d) => d.arrived), fmt: count, sum: true },
    { code: "LANDING", label: "대기 중앙값", values: days.map((d) => d.landingWaitMedianMin), fmt: dur },
    { code: "REVERT", label: "되돌림", values: days.map((d) => d.reverts), fmt: count, sum: true },
  ];
  const gate: Series[] = [
    { code: "DISPATCH", label: "결정", values: gates.map((g) => g.dispatchDecided), fmt: count, sum: true },
    { code: "DISPATCH", label: "일치율(누적)", values: gates.map((g) => g.dispatchAgreement), fmt: pct, max: 1, running: true },
    { code: "SCHEDULE", label: "결정", values: gates.map((g) => g.scheduleDecided), fmt: count, sum: true },
    { code: "SCHEDULE", label: "일치율(누적)", values: gates.map((g) => g.scheduleAgreement), fmt: pct, max: 1, running: true },
    { code: "CROSSCHECK", label: "일치(누적)", values: gates.map((g) => g.crosscheckMatch), fmt: pct, max: 1, running: true },
  ];
  const noDays = !days.length || days.every((d) => !d.arrived && !d.reverts && d.landingWaitMedianMin === null);
  const noGates =
    !gates.length ||
    gates.every((g) => !g.dispatchDecided && !g.scheduleDecided && g.dispatchAgreement === null && g.scheduleAgreement === null && g.crosscheckMatch === null);

  return (
    <>
      <h2 className="label">
        TRENDS <em>최근 {windowDays}일 · 서버 날짜</em>
      </h2>
      {noDays ? (
        <p className="empty nw-empty">최근 {windowDays}일 ARRIVED 기록이 없음 — LOGBOOK에 머지된 PR이 쌓이면 그려진다.</p>
      ) : (
        <div className="mx-trends">
          {flow.map((s) => (
            <Spark key={`${s.code}-${s.label}`} s={s} dates={days.map((d) => d.date)} />
          ))}
        </div>
      )}
      <h3 className="label nw-sub">
        GATES <em>DISPATCH·SCHEDULE 결정, 일치율, CROSSCHECK 일치</em>
      </h3>
      {noGates ? (
        <p className="empty nw-empty">최근 {windowDays}일 DISPATCH·SCHEDULE 결정과 CROSSCHECK 기록이 없음.</p>
      ) : (
        <div className="mx-trends">
          {gate.map((s) => (
            <Spark key={`${s.code}-${s.label}`} s={s} dates={gates.map((g) => g.date)} />
          ))}
        </div>
      )}
      {!(noDays && noGates) && <DailyTable days={days} gates={gates} />}
    </>
  );
}

// 계열 하나짜리 추이(METRICS의 Trend와 같은 모양). 값이 없는 날은 선을 끊는다.
// 가로선(마우스·방향키)으로 날짜와 값을 읽고, 아래 일별 표가 글 대안이다.
function Spark({ s, dates }: { s: Series; dates: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const n = s.values.length;
  const present = s.values.filter((v): v is number => v !== null);
  const name = `${s.code} ${s.label}`;

  if (n === 0 || present.length === 0) {
    return (
      <figure className="mx-trend nw-trend">
        <figcaption>
          <span className="mx-trend-code">{s.code}</span> {s.label}
        </figcaption>
        <p className="empty nw-trend-empty">기록 없음</p>
      </figure>
    );
  }

  const max = s.max ?? Math.max(1, ...present);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v: number) => 100 - (Math.min(v, max) / max) * 100;
  // 값이 이어지는 구간마다 선과 면
  const runs: number[][] = [];
  s.values.forEach((v, i) => {
    if (v === null) return;
    const last = runs.at(-1);
    if (last && last.at(-1) === i - 1) last.push(i);
    else runs.push([i]);
  });
  const lineOf = (run: number[]) => run.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(s.values[i]!)}`).join(" ");
  const line = runs.map(lineOf).join(" ");
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `${lineOf(r)} L${x(r.at(-1)!)},100 L${x(r[0])},100 Z`)
    .join(" ");
  const lone = runs.filter((r) => r.length === 1).map((r) => r[0]);

  let lastIdx = n - 1;
  while (lastIdx > 0 && s.values[lastIdx] === null) lastIdx--;
  const total = present.reduce((a, b) => a + b, 0);
  const i = hover ?? lastIdx;
  const head = hover !== null ? shortDate(dates[i] ?? "") : s.sum ? `${n}일 합계` : "최근";
  const headValue = hover === null && s.sum ? s.fmt(total) : s.fmt(s.values[i]);

  const summary = [
    s.sum ? `${n}일 합계 ${s.fmt(total)}` : `최근(${shortDate(dates[lastIdx] ?? "")}) ${s.fmt(s.values[lastIdx])}`,
    `최대 ${s.fmt(Math.max(...present))}`,
    `최소 ${s.fmt(Math.min(...present))}`,
    present.length < n ? `값이 있는 날 ${present.length}/${n}일` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(n > 1 ? Math.round(((e.clientX - box.left) / box.width) * (n - 1)) : 0);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setHover(Math.max(0, i - 1));
    else if (e.key === "ArrowRight") setHover(Math.min(n - 1, i + 1));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(n - 1);
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure className="mx-trend nw-trend">
      <figcaption>
        <span className="mx-trend-code">{s.code}</span> {s.label}
        {/* 키보드로 읽을 때만 바뀐 값을 읽어 준다(마우스 호버로 떠들지 않게) */}
        <span className="mx-trend-now" aria-live={focused ? "polite" : "off"}>
          {head} <b>{headValue}</b>
        </span>
      </figcaption>
      <div
        className="mx-plot"
        tabIndex={0}
        role="img"
        aria-roledescription="추이 차트"
        aria-label={`${name}: ${summary}. 방향키로 날짜별 값, 아래 일별 표에 전체 값`}
        onMouseMove={pick}
        onMouseLeave={() => setHover(null)}
        onKeyDown={key}
        onFocus={() => setFocused(true)}
        onBlur={() => (setHover(null), setFocused(false))}
      >
        <span className="mx-ymax">{s.fmt(max)}</span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line className="mx-grid" x1="0" x2="100" y1="0" y2="0" vectorEffect="non-scaling-stroke" />
          {area && <path className="mx-area" d={area} />}
          <path className="mx-line" d={line} vectorEffect="non-scaling-stroke" />
          <line className="mx-base" x1="0" x2="100" y1="100" y2="100" vectorEffect="non-scaling-stroke" />
        </svg>
        {lone.map((j) => (
          <span key={j} className="nw-pt" style={{ left: `${x(j)}%`, top: `${y(s.values[j]!)}%` }} />
        ))}
        {hover !== null && (
          <>
            <span className="mx-cross" style={{ left: `${x(i)}%` }} />
            {s.values[i] !== null && <span className="mx-dot" style={{ left: `${x(i)}%`, top: `${y(s.values[i]!)}%` }} />}
          </>
        )}
      </div>
      <div className="mx-xaxis">
        <span>{shortDate(dates[0] ?? "")}</span>
        <span>{shortDate(dates.at(-1) ?? "")}</span>
      </div>
    </figure>
  );
}

// 차트의 글 대안: 날짜별 모든 값. 접어 두고, 펼치면 최신 날짜부터.
function DailyTable({ days, gates }: { days: DayRow[]; gates: GateRow[] }) {
  const byDate = new Map<string, { day?: DayRow; gate?: GateRow }>();
  for (const d of days) byDate.set(d.date, { ...byDate.get(d.date), day: d });
  for (const g of gates) byDate.set(g.date, { ...byDate.get(g.date), gate: g });
  const rows = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <details className="nw-daily">
      <summary>일별 표로 보기</summary>
      <Scroll label="TRENDS 일별 표">
        <table className="mx-table nw-table">
          <caption className="nw-sr">TRENDS 일별 값, 최신 날짜부터. 일치율과 CROSSCHECK 일치는 그날까지 누적</caption>
          <thead>
            <tr>
              <th>
                <em>날짜</em>
              </th>
              <th className="num">ARRIVED</th>
              <th className="num">
                    LANDING <em>대기</em>
                  </th>
              <th className="num">
                    <em>되돌림</em>
                  </th>
              <th className="num">
                DISPATCH <em>결정</em>
              </th>
              <th className="num">
                DISPATCH <em>일치</em>
              </th>
              <th className="num">
                SCHEDULE <em>결정</em>
              </th>
              <th className="num">
                SCHEDULE <em>일치</em>
              </th>
              <th className="num">CROSSCHECK</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([date, { day, gate }]) => (
              <tr key={date}>
                <th scope="row" className="mono nw-name">
                  {date}
                </th>
                <td className="num">{count(day?.arrived ?? null)}</td>
                <td className="num">{dur(day?.landingWaitMedianMin ?? null)}</td>
                <td className="num">{count(day?.reverts ?? null)}</td>
                <td className="num">{count(gate?.dispatchDecided ?? null)}</td>
                <td className="num">{pct(gate?.dispatchAgreement ?? null)}</td>
                <td className="num">{count(gate?.scheduleDecided ?? null)}</td>
                <td className="num">{pct(gate?.scheduleAgreement ?? null)}</td>
                <td className="num">{pct(gate?.crosscheckMatch ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </details>
  );
}
