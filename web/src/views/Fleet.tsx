import { useCallback, useEffect, useState } from "react";
import type { AircraftView, CrewMember, FleetFile, Rating } from "../../../server/fleet.ts";
import { flightNumber } from "../aviation.ts";
import "./Fleet.css";

// FLEET: 팀(AIRCRAFT)마다 CREW COMPLEMENT, TYPE RATING, ROUTE, TARGETS. 설계: docs/fleet.md.
// 이 단계에서는 보여 주고 고치기만 한다. planner는 아직 이 값을 쓰지 않는다.

interface FleetBrief {
  ratings: Rating[];
  defaults: FleetFile["defaults"];
  projects: string[];
  aircraft: AircraftView[];
}

// RADAR·STRIPS와 같은 말: 작업 중 AIRBORNE, 대기 중 STAND를 쥐었으면 HOLDING, 아니면 PARKED
const statusOf = (a: AircraftView) =>
  a.status === "busy" ? "AIRBORNE" : a.status === "idle" ? (a.flying.length ? "HOLDING" : "PARKED") : a.status === "dead" ? "NORDO" : "NOT IN SERVICE";

const ratingHelp: Record<Rating, string> = {
  SEC: "DB·마이그레이션·RLS·인증·권한·보안·권리·배포·결제 (Codex Engineering Task)",
  UI: "화면·컴포넌트·시각 디자인·접근성",
  DATA: "언어 데이터·파이프라인·콘텐츠·분석",
  DOCS: "문서·규칙 파일·handoff",
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function Fleet({ refreshKey }: { refreshKey: string }) {
  const [brief, setBrief] = useState<FleetBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBrief(await api("GET", "/api/fleet"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const save = async (reg: string, patch: Record<string, unknown>) => {
    try {
      await api("PATCH", `/api/fleet/${encodeURIComponent(reg)}`, patch);
      setEditing(null);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  if (!brief) return <p className="empty">{error ? `불러오지 못함: ${error}` : "불러오는 중…"}</p>;

  return (
    <section className="fleet">
      <div className="toolbar">
        <span className="muted">
          팀(AIRCRAFT)마다 태우는 팀원(CREW), 맡을 수 있는 일(TYPE RATING), 주 담당 프로젝트(ROUTE), 목표(TARGETS). 기본값은 vocado
          CLAUDE.md의 팀원 규칙이다. planner는 아직 이 값을 쓰지 않는다.
        </span>
      </div>
      {error && (
        <p className="fl-error" role="alert">
          {error}
        </p>
      )}
      <div className="fl-cards">
        {brief.aircraft.map((a) =>
          editing === a.registration ? (
            <Editor key={a.registration} a={a} brief={brief} onCancel={() => setEditing(null)} onSave={(p) => save(a.registration, p)} />
          ) : (
            <Card key={a.registration} a={a} onEdit={() => (setError(null), setEditing(a.registration))} />
          ),
        )}
      </div>
    </section>
  );
}

function Card({ a, onEdit }: { a: AircraftView; onEdit: () => void }) {
  return (
    <article className={`fl-card s-${a.status}`}>
      <header className="fl-head">
        <b className="fl-callsign">{a.callsign}</b>
        <span className="mono faint">{a.registration}</span>
        {a.base && <span className="apt">{a.base}</span>}
        <span className="fl-status">{statusOf(a)}</span>
      </header>
      {a.flying.length > 0 && <p className="fl-flying">FLYING {a.flying.map(flightNumber).join(", ")}</p>}

      <h3 className="fl-sub">
        CREW COMPLEMENT {a.complementIsDefault && <em>기본값</em>}
      </h3>
      <ul className="fl-crew">
        <li>
          <span className="fl-pos">CAPTAIN</span> <span className="faint">팀 리더 세션</span>
        </li>
        {a.complement.map((m, i) => (
          <li key={i}>
            <span className="fl-pos">{m.position}</span> <span className="mono">{m.agent}</span>
            {m.limits?.length ? <span className="fl-limits">{m.limits.join(" · ")}</span> : null}
          </li>
        ))}
      </ul>

      <h3 className="fl-sub">
        TYPE RATING {a.ratingsIsDefault && <em>기본값</em>}
      </h3>
      <div className="fl-chips">
        {a.ratings.length ? (
          a.ratings.map((r) => (
            <span key={r} className={`fl-chip r-${r}`} title={ratingHelp[r]}>
              {r}
            </span>
          ))
        ) : (
          <span className="faint">없음</span>
        )}
      </div>

      <h3 className="fl-sub">ROUTE</h3>
      <p className="fl-line">{a.routes.length ? a.routes.join(", ") : <span className="faint">지정 없음</span>}</p>

      <h3 className="fl-sub">TARGETS</h3>
      <p className="fl-line">
        {a.targets.flightsPerWeek == null && a.targets.onTime == null ? (
          <span className="faint">지정 없음</span>
        ) : (
          <>
            {a.targets.flightsPerWeek != null && <>주 {a.targets.flightsPerWeek} FLIGHT</>}
            {a.targets.flightsPerWeek != null && a.targets.onTime != null && " · "}
            {a.targets.onTime != null && <>정시성 {Math.round(a.targets.onTime * 100)}%</>}
          </>
        )}
      </p>
      {a.note && <p className="fl-note">{a.note}</p>}

      <div className="fl-actions">
        <button className="fl-btn" onClick={onEdit}>
          고치기
        </button>
      </div>
    </article>
  );
}

function Editor({
  a,
  brief,
  onCancel,
  onSave,
}: {
  a: AircraftView;
  brief: FleetBrief;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [ratings, setRatings] = useState<Rating[]>(a.ratings);
  const [ratingsDefault, setRatingsDefault] = useState(a.ratingsIsDefault);
  const [routes, setRoutes] = useState<string[]>(a.routes);
  const [perWeek, setPerWeek] = useState(a.targets.flightsPerWeek?.toString() ?? "");
  const [onTime, setOnTime] = useState(a.targets.onTime != null ? String(Math.round(a.targets.onTime * 100)) : "");
  const [crewDefault, setCrewDefault] = useState(a.complementIsDefault);
  const [crew, setCrew] = useState<CrewMember[]>(a.complement);
  const [note, setNote] = useState(a.note ?? "");

  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const projects = [...new Set([...brief.projects, ...routes])];

  const submit = () => {
    const targets = { flightsPerWeek: perWeek === "" ? null : Number(perWeek), onTime: onTime === "" ? null : Number(onTime) / 100 };
    onSave({
      ratings: ratingsDefault ? null : ratings,
      complement: crewDefault ? null : crew.filter((m) => m.position.trim() && m.agent.trim()),
      routes: routes.length ? routes : null,
      targets: targets.flightsPerWeek == null && targets.onTime == null ? null : targets,
      note: note.trim() || null,
    });
  };

  return (
    <article className="fl-card is-editing">
      <header className="fl-head">
        <b className="fl-callsign">{a.callsign}</b>
        <span className="mono faint">{a.registration}</span>
      </header>

      <fieldset className="fl-field">
        <legend>CREW COMPLEMENT</legend>
        <label className="fl-check">
          <input type="checkbox" checked={crewDefault} onChange={(e) => setCrewDefault(e.target.checked)} /> 기본값 쓰기
        </label>
        {!crewDefault && (
          <>
            {crew.map((m, i) => (
              <div key={i} className="fl-crew-row">
                <input
                  className="fl-input"
                  value={m.position}
                  placeholder="position"
                  aria-label="position"
                  onChange={(e) => setCrew(crew.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)))}
                />
                <input
                  className="fl-input mono"
                  value={m.agent}
                  placeholder="agent / model"
                  aria-label="agent"
                  onChange={(e) => setCrew(crew.map((x, j) => (j === i ? { ...x, agent: e.target.value } : x)))}
                />
                <button className="fl-btn" onClick={() => setCrew(crew.filter((_, j) => j !== i))} aria-label="빼기">
                  −
                </button>
              </div>
            ))}
            <button className="fl-btn" onClick={() => setCrew([...crew, { position: "", agent: "" }])}>
              팀원 추가
            </button>
          </>
        )}
      </fieldset>

      <fieldset className="fl-field">
        <legend>TYPE RATING</legend>
        <label className="fl-check">
          <input type="checkbox" checked={ratingsDefault} onChange={(e) => setRatingsDefault(e.target.checked)} /> 기본값 쓰기 (
          {brief.defaults.ratings.join(", ") || "없음"})
        </label>
        {!ratingsDefault &&
          brief.ratings.map((r) => (
            <label key={r} className="fl-check" title={ratingHelp[r]}>
              <input type="checkbox" checked={ratings.includes(r)} onChange={() => setRatings(toggle(ratings, r))} /> {r}{" "}
              <span className="faint">{ratingHelp[r]}</span>
            </label>
          ))}
      </fieldset>

      <fieldset className="fl-field">
        <legend>ROUTE</legend>
        {projects.length ? (
          projects.map((p) => (
            <label key={p} className="fl-check">
              <input type="checkbox" checked={routes.includes(p)} onChange={() => setRoutes(toggle(routes, p))} /> {p}
            </label>
          ))
        ) : (
          <span className="faint">열린 FLIGHT에 프로젝트가 없음</span>
        )}
      </fieldset>

      <fieldset className="fl-field fl-targets">
        <legend>TARGETS</legend>
        <label>
          주{" "}
          <input className="fl-input fl-num" type="number" min={0} max={100} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />{" "}
          FLIGHT
        </label>
        <label>
          정시성 <input className="fl-input fl-num" type="number" min={0} max={100} value={onTime} onChange={(e) => setOnTime(e.target.value)} /> %
        </label>
      </fieldset>

      <fieldset className="fl-field">
        <legend>메모</legend>
        <input className="fl-input fl-wide" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="메모" />
      </fieldset>

      <div className="fl-actions">
        <button className="fl-btn" onClick={onCancel}>
          취소
        </button>
        <button className="fl-btn primary" onClick={submit}>
          저장
        </button>
      </div>
    </article>
  );
}
