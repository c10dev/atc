import { X } from "lucide-react";
import { IconButton } from "../kit/Icon.tsx";
import { type KeyboardEvent, useEffect, useState } from "react";
import "./RouteMap.css";
import { apiGet } from "../api.ts";
import { Empty } from "../kit/Empty.tsx";
import { Loading } from "../kit/Loading.tsx";

// ROUTE MAP: ROUTE(Linear 프로젝트)마다 WAYPOINT(마일스톤)를 가로 경로로. 읽기만 한다.
// 계산(상태·FLIGHT·ETA)은 서버(server/routes.ts)가 하고 여기서는 그리기만 한다. 설계: docs/routes.md

type WaypointState = "passed" | "active" | "planned";
type FlightPhase = "done" | "active" | "blocked" | "planned";
interface Flight {
  key: string;
  title: string;
  phase: FlightPhase;
  aircraft: string | null;
  url: string | null;
}
interface Eta {
  at: string | null;
  remaining: number;
  cumulative: number;
  reason: "few-samples" | "no-flights" | "truncated" | null;
}
// 완료 기준에 이어진 atc 게이트(server/waypoint-gates.ts GateCheck, docs/routes.md 6단계)
interface GateCheck {
  id: string;
  state: "pass" | "fail" | "insufficient" | "check";
  value: string;
  target: string;
}
const CHECK_MARK: Record<GateCheck["state"], string> = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족", check: "△ 확인 필요" };
interface Waypoint {
  id: string;
  name: string;
  state: WaypointState;
  linearStatus: string | null;
  progress: number | null;
  targetDate: string | null;
  criteria: string[];
  checks?: (GateCheck | null)[]; // 옛 서버면 없음
  flights: Flight[];
  counts: Record<FlightPhase, number>;
  truncated: boolean;
  late: boolean;
  eta: Eta | null;
}
interface Route {
  project: string;
  state: string | null;
  progress: number | null;
  targetDate: string | null;
  open: { active: number; blocked: number; planned: number };
  aircraft: string[];
  rate: { completed: number; perWeek: number };
  waypoints: Waypoint[];
}
interface RoutesData {
  ok: boolean;
  milestones: boolean;
  error: string | null;
  windowDays: number;
  routes: Route[];
}

const STATE_KO: Record<WaypointState, string> = { passed: "지남", active: "지금 구간", planned: "앞으로" };
const PHASE_KO: Record<FlightPhase, string> = { active: "진행", blocked: "막힘", planned: "계획", done: "완료" };
const PHASES: FlightPhase[] = ["active", "blocked", "planned", "done"];
const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);

function etaText(eta: Eta | null, windowDays: number, completed: number): string {
  if (!eta) return "—";
  if (eta.at) return eta.at;
  if (eta.reason === "few-samples") return `모름 (최근 ${windowDays}일 완료 ${completed}개, 3개 미만)`;
  if (eta.reason === "no-flights") return "모름 (남은 FLIGHT 없음)";
  if (eta.reason === "truncated") return "모름 (FLIGHT가 50개를 넘어 다 못 읽음)";
  return "모름";
}

export function RouteMap({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<RoutesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet("/api/routes")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: RoutesData) => alive && (setData({ ...d, routes: Array.isArray(d?.routes) ? d.routes : [] }), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const withWp = data?.routes.filter((r) => r.waypoints.length) ?? [];
  const bare = data?.routes.filter((r) => !r.waypoints.length) ?? [];
  return (
    <>
      <h2 className="label">
        ROUTE MAP <em>Linear 마일스톤(WAYPOINT)별 · ETA는 최근 {data?.windowDays ?? 28}일 완료 속도</em>
      </h2>
      {error && (
        <p className="mx-error" role="alert">
          ROUTE MAP을 불러오지 못함: {error}
        </p>
      )}
      {data && (!data.ok || !data.milestones) && (
        <ul className="nw-sources" aria-label="ROUTE MAP 출처 알림">
          <li>
            <span className="nw-source-code">LINEAR</span>
            {!data.ok ? "Linear 프로젝트를 읽지 못함" : "Linear 마일스톤을 읽지 못함 — WAYPOINT가 빠졌을 수 있음"}
            {data.error ? ` (${data.error})` : ""}
          </li>
        </ul>
      )}
      {!data ? (
        !error && <Loading>불러오는 중…</Loading>
      ) : !data.routes.length ? (
        <Empty className="nw-empty">보여 줄 ROUTE가 없음</Empty>
      ) : (
        <div className="rm-list">
          {withWp.map((r) => (
            <RouteCard key={r.project} route={r} windowDays={data.windowDays} />
          ))}
          {bare.length > 0 && <h3 className="rm-sub">WAYPOINT 없는 ROUTE</h3>}
          {bare.map((r) => (
            <RouteCard key={r.project} route={r} windowDays={data.windowDays} />
          ))}
        </div>
      )}
    </>
  );
}

function OpenCounts({ open }: { open: Route["open"] }) {
  return (
    <span className="rm-counts">
      진행 <b>{open.active}</b> · 계획 <b>{open.planned}</b> ·{" "}
      <span className={open.blocked ? "rm-blocked" : undefined}>
        막힘 <b>{open.blocked}</b>
      </span>
    </span>
  );
}

function RouteCard({ route, windowDays }: { route: Route; windowDays: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const sel = route.waypoints.find((w) => w.id === open) ?? null;
  return (
    <article className="rm-route" aria-label={`ROUTE ${route.project}`}>
      <header className="rm-head">
        <span className="rm-name">{route.project}</span>
        <span className="mono muted">{pct(route.progress)}</span>
        {route.targetDate && <span className="muted">목표 <span className="mono">{route.targetDate}</span></span>}
        <OpenCounts open={route.open} />
        {route.aircraft.length > 0 && <span className="mono rm-ac">✈ {route.aircraft.join(" · ")}</span>}
        <span className="muted rm-rate" title={`최근 ${windowDays}일에 끝난 FLIGHT(LOGBOOK ARRIVED·Linear 완료)`}>
          완료 {route.rate.completed}/{windowDays}일
        </span>
      </header>
      {route.waypoints.length ? (
        <>
          <div className="kit-scroll rm-scroll">
            <Line route={route} selected={open} onPick={(id) => setOpen((o) => (o === id ? null : id))} />
          </div>
          {sel && <Detail w={sel} route={route} windowDays={windowDays} onClose={() => setOpen(null)} />}
        </>
      ) : (
        <div className="rm-bare">
          <span className="rm-bare-line" aria-hidden />
          <span className="rm-bare-tag">WAYPOINT 없음</span>
        </div>
      )}
    </article>
  );
}

const STEP = 104;
const PAD = STEP / 2 + 4; // 첫·끝 WAYPOINT의 이름과 누름 영역이 잘리지 않게
const MIN_W = 260; // ✈ 표시가 들어갈 너비
const Y = 30;
const clip = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Line({ route, selected, onPick }: { route: Route; selected: string | null; onPick: (id: string) => void }) {
  const ws = route.waypoints;
  const w = Math.max(MIN_W, PAD * 2 + (ws.length - 1) * STEP);
  const x = (i: number) => PAD + i * STEP;
  const activeIdx = ws.findIndex((p) => p.state === "active");
  const flying = activeIdx >= 0 ? [...new Set(ws[activeIdx].flights.map((f) => f.aircraft).filter((a): a is string => Boolean(a)))] : [];
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(id);
    }
  };
  return (
    <svg className="rm-svg" width={w} height={78} viewBox={`0 0 ${w} 78`} role="group" aria-label={`${route.project} WAYPOINT ${ws.length}개`}>
      {ws.slice(1).map((p, j) => {
        const i = j + 1;
        const a = x(i - 1) + 10;
        const b = x(i) - 10;
        if (p.state === "passed") return <line key={p.id} className="rm-seg rm-seg-passed" x1={a} x2={b} y1={Y} y2={Y} />;
        if (p.state === "planned") return <line key={p.id} className="rm-seg rm-seg-planned" x1={a} x2={b} y1={Y} y2={Y} />;
        const m = a + (b - a) * Math.max(0, Math.min(1, p.progress ?? 0));
        return (
          <g key={p.id}>
            <line className="rm-seg rm-seg-active" x1={a} x2={m} y1={Y} y2={Y} />
            <line className="rm-seg rm-seg-planned" x1={m} x2={b} y1={Y} y2={Y} />
          </g>
        );
      })}
      {activeIdx >= 0 && flying.length > 0 && (
        <text
          className="rm-flying"
          x={activeIdx === 0 ? x(0) - 12 : activeIdx === ws.length - 1 ? x(activeIdx) + 12 : x(activeIdx)}
          y={11}
          textAnchor={activeIdx === 0 ? "start" : activeIdx === ws.length - 1 ? "end" : "middle"}
        >
          ✈ {flying.slice(0, 3).join(" ")}
          {flying.length > 3 ? ` +${flying.length - 3}` : ""}
        </text>
      )}
      {ws.map((p, i) => {
        const label = `${p.name}, ${STATE_KO[p.state]}, 진행률 ${pct(p.progress)}${p.late ? ", 지연" : ""}. 누르면 자세히`;
        return (
          <g
            key={p.id}
            className={`rm-wp rm-wp-${p.state}${p.late ? " rm-late" : ""}${selected === p.id ? " rm-sel" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected === p.id}
            onClick={() => onPick(p.id)}
            onKeyDown={(e) => key(e, p.id)}
          >
            <title>{p.name}</title>
            <rect className="rm-hit" x={x(i) - STEP / 2 + 4} y={Y - 16} width={STEP - 8} height={60} rx={4} />
            {p.state === "active" ? (
              <>
                <circle className="rm-dot-ring" cx={x(i)} cy={Y} r={8} />
                <circle className="rm-dot-core" cx={x(i)} cy={Y} r={3.5} />
              </>
            ) : (
              <circle className="rm-dot" cx={x(i)} cy={Y} r={6} />
            )}
            <text className="rm-wp-name" x={x(i)} y={Y + 24} textAnchor="middle">
              {clip(p.name)}
            </text>
            <text className="rm-wp-sub" x={x(i)} y={Y + 38} textAnchor="middle">
              {p.late ? "지연 · " : ""}
              {p.state === "passed" ? "✓" : pct(p.progress)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Detail({ w, route, windowDays, onClose }: { w: Waypoint; route: Route; windowDays: number; onClose: () => void }) {
  return (
    <section className="rm-detail" aria-label={`WAYPOINT ${w.name}`}>
      <header className="rm-detail-head">
        <strong>{w.name}</strong>
        <span className={`rm-chip rm-chip-${w.state}`}>{STATE_KO[w.state]}</span>
        {w.late && <span className="rm-chip rm-chip-late">지연</span>}
        <IconButton className="rm-close" onClick={onClose} label="WAYPOINT 닫기" icon={X} size={16} />
      </header>
      <dl className="rm-facts">
        <dt>진행률</dt>
        <dd className="mono">{pct(w.progress)}</dd>
        <dt>목표일</dt>
        <dd className="mono">{w.targetDate ?? "—"}</dd>
        {w.state !== "passed" && (
          <>
            <dt>ETA</dt>
            <dd className="mono">
              {etaText(w.eta, windowDays, route.rate.completed)}
              {w.eta && w.eta.cumulative > w.eta.remaining && <span className="muted"> · 앞 구간 포함 남은 FLIGHT {w.eta.cumulative}</span>}
            </dd>
          </>
        )}
        <dt>FLIGHT</dt>
        <dd>
          진행 {w.counts.active} · 막힘 {w.counts.blocked} · 계획 {w.counts.planned} · 완료 {w.counts.done}
          {w.truncated && <span className="muted"> (50개까지만 읽음)</span>}
        </dd>
      </dl>
      <h4 className="rm-h4">완료 기준</h4>
      {w.criteria.length ? (
        <ol className="rm-criteria">
          {w.criteria.map((c, i) => {
            const g = w.checks?.[i];
            return (
              <li key={i}>
                {c}
                {g && (
                  <span className={`rm-check c-${g.state}`} title={`atc 게이트 ${g.id} · 기준 ${g.target}`}>
                    <b>{CHECK_MARK[g.state]}</b> {g.value}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="faint">마일스톤 설명에 번호 목록이 없음</p>
      )}
      <h4 className="rm-h4">FLIGHT</h4>
      {w.flights.length ? (
        <ul className="rm-flights">
          {PHASES.flatMap((ph) =>
            w.flights
              .filter((f) => f.phase === ph)
              .map((f) => (
                <li key={f.key} className={`rm-f rm-f-${f.phase}`}>
                  <span className="rm-f-phase">{PHASE_KO[f.phase]}</span>
                  {f.url ? (
                    <a className="mono" href={f.url} target="_blank" rel="noreferrer">
                      {f.key}
                    </a>
                  ) : (
                    <span className="mono">{f.key}</span>
                  )}
                  <span className="rm-f-title">{f.title}</span>
                  {f.aircraft && <span className="mono rm-ac">✈ {f.aircraft}</span>}
                </li>
              )),
          )}
        </ul>
      ) : (
        <p className="faint">이 WAYPOINT에 걸린 FLIGHT가 없음</p>
      )}
    </section>
  );
}
