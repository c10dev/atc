import { useState } from "react";
import { DEFAULT_ACCOUNT } from "../../../../server/crew.ts";
import type { AircraftView, CrewMember, Rating } from "../../../../server/fleet.ts";
import { type FleetBrief, ratingHelp } from "./shared.ts";
import "./Editor.css";

// 고치기: 카드 자리에 열리는 편집기. CREW COMPLEMENT, TYPE RATING, ROUTE, TARGETS, ACCOUNT, 메모
export function Editor({
  a,
  brief,
  onCancel,
  onSave,
}: {
  a: AircraftView;
  brief: FleetBrief;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>, launchModel?: string) => Promise<boolean>; // launchModel: 이 AIRCRAFT의 LAUNCH MODEL(ATC-279). 바뀌었을 때만 넘긴다
}) {
  const [ratings, setRatings] = useState<Rating[]>(a.ratings);
  const [ratingsDefault, setRatingsDefault] = useState(a.ratingsIsDefault);
  const [routes, setRoutes] = useState<string[]>(a.routes);
  const [perWeek, setPerWeek] = useState(a.targets.flightsPerWeek?.toString() ?? "");
  const [onTime, setOnTime] = useState(a.targets.onTime != null ? String(Math.round(a.targets.onTime * 100)) : "");
  const [fuelPerFlight, setFuelPerFlight] = useState(a.targets.fuelPerFlight?.toString() ?? "");
  const [cacheHit, setCacheHit] = useState(a.targets.cacheHit != null ? String(Math.round(a.targets.cacheHit * 100)) : "");
  const [crewDefault, setCrewDefault] = useState(a.complementIsDefault);
  const [crew, setCrew] = useState<CrewMember[]>(a.complement);
  const [note, setNote] = useState(a.note ?? "");
  const [account, setAccount] = useState(a.accountIsDefault ? "" : (a.account ?? ""));
  const modelNow = brief.launchModel?.aircraft?.[a.registration.toUpperCase()] ?? "";
  const [launchModel, setLaunchModel] = useState(modelNow);

  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const projects = [...new Set([...brief.projects, ...routes])];

  const submit = () => {
    const targets = {
      flightsPerWeek: perWeek === "" ? null : Number(perWeek),
      onTime: onTime === "" ? null : Number(onTime) / 100,
      fuelPerFlight: fuelPerFlight === "" ? null : Number(fuelPerFlight),
      cacheHit: cacheHit === "" ? null : Number(cacheHit) / 100,
    };
    onSave({
      ratings: ratingsDefault ? null : ratings,
      complement: crewDefault ? null : crew.filter((m) => m.position.trim() && m.agent.trim()),
      routes: routes.length ? routes : null,
      targets: Object.values(targets).every((v) => v == null) ? null : targets,
      note: note.trim() || null,
      account: account.trim().toLowerCase() || null,
    }, launchModel.trim() === modelNow ? undefined : launchModel.trim());
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
            <label key={r} className="fl-check">
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
        <label title="최근 14일 FLIGHT당 NET FUEL COST가 이 값 이하면 목표 안(보여 주기만 한다)">
          FLIGHT당 NET ${" "}
          <input className="fl-input fl-num" type="number" min={0} step="0.5" value={fuelPerFlight} onChange={(e) => setFuelPerFlight(e.target.value)} /> 이하
        </label>
        <label title="최근 14일 CACHE HIT(CAPTAIN + CREW)이 이 값 이상이면 목표 안(보여 주기만 한다)">
          CACHE HIT <input className="fl-input fl-num" type="number" min={0} max={100} value={cacheHit} onChange={(e) => setCacheHit(e.target.value)} /> %
        </label>
      </fieldset>

      <fieldset className="fl-field">
        <legend>ACCOUNT</legend>
        <input
          className="fl-input mono"
          value={account}
          maxLength={24}
          placeholder={DEFAULT_ACCOUNT}
          onChange={(e) => setAccount(e.target.value)}
          aria-label="ACCOUNT"
        />
        <span className="faint fl-hint">사용 한도를 같이 쓰는 AIRCRAFT에 같은 라벨(main, pro-2 …). email은 쓰지 않는다. 비우면 {DEFAULT_ACCOUNT}</span>
      </fieldset>

      <fieldset className="fl-field">
        <legend>LAUNCH MODEL</legend>
        <input className="fl-input" value={launchModel} maxLength={60} onChange={(e) => setLaunchModel(e.target.value)} placeholder="opus · sonnet · claude-opus-5-5 …" aria-label="LAUNCH MODEL" />
        <span className="faint fl-hint">이 AIRCRAFT를 다음에 띄울 때 `--model`로 넘긴다(AIRPORT·기본 설정보다 먼저). 비우면 설정 → ACCOUNTS의 LAUNCH MODEL을 따른다. 돌고 있는 세션은 옮기지 않는다</span>
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
