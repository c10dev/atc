import type { AircraftView } from "../../../../server/fleet.ts";
import { fleetStatusOf } from "../../../../server/fleet-status.ts";
import { contextBadgeOf } from "../../../../server/fuel-context.ts";
import { fuelLabel, fuelTitle } from "../../../../server/fuel-remaining.ts";
import { usd } from "../../../../server/fuel-view.ts";
import { ACCOUNT_HOLD_NEXT, accountHoldDetail, accountHoldLabel } from "../../../../server/health.ts";
import type { RulesView } from "../../../../server/rules-state.ts";
import { flightNumber } from "../../aviation.ts";
import { timeAgo } from "../../derive.ts";
import { formatClock, useSettings } from "../../settings.ts";
import { FleetCrew } from "../FleetCrew.tsx";
import { ContextLine } from "./Context.tsx";
import { FuelBlock, RecentFuel } from "./Fuel.tsx";
import { type SessionRow, pct, ratingHelp } from "./shared.ts";
import "./Card.css";

// AIRCRAFT 한 대의 카드: 상태, CREW, TYPE RATING, ROUTE, ACCOUNT, FUEL, TARGETS와 실적, 버튼들

const statusOf = fleetStatusOf;

// TARGETS 한 줄: 주 5 FLIGHT · 정시성 80% · FLIGHT당 NET $8 이하 · CACHE HIT 95%
function targetParts(t: AircraftView["targets"]): string[] {
  return [
    t.flightsPerWeek != null ? `주 ${t.flightsPerWeek} FLIGHT` : null,
    t.onTime != null ? `정시성 ${pct(t.onTime)}` : null,
    t.fuelPerFlight != null ? `FLIGHT당 NET ${usd(t.fuelPerFlight)} 이하` : null,
    t.cacheHit != null ? `CACHE HIT ${pct(t.cacheHit)}` : null,
  ].filter((x): x is string => x !== null);
}

// block time: 45m, 3h30m, 2d4h
function blockTime(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? `${String(min % 60).padStart(2, "0")}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}

// TARGETS 옆 실적(LOGBOOK, docs/fleet.md 7.2). 보여 주기만 한다.
function Actuals({ a }: { a: AircraftView }) {
  const x = a.actuals;
  const fuelOf = new Map((a.fuelRecent ?? []).map((f) => [f.key, f]));
  const t = a.targets;
  const weekShort = t.flightsPerWeek != null && x.week < t.flightsPerWeek;
  const lateShort = t.onTime != null && x.onTime.rate != null && x.onTime.rate < t.onTime;
  return (
    <>
      <p className="fl-actuals">
        <span className={weekShort ? "fl-short" : undefined}>
          이번 주 {x.week}
          {t.flightsPerWeek != null && `/${t.flightsPerWeek}`}
        </span>
        {" · "}
        <span
          className={lateShort ? "fl-short" : undefined}
          title={`최근 14일, 기대 block time이 있는 ${x.onTime.measured}건 중 ${x.onTime.within}건이 기대치 안`}
        >
          정시 {x.onTime.rate == null ? "—" : pct(x.onTime.rate)}
          {t.onTime != null && <span className="faint"> (목표 {pct(t.onTime)})</span>}
        </span>
      </p>
      <p className="fl-actuals faint">
        14일 ARRIVED {x.total} · 되돌림 <span className={x.reverted ? "fl-bad" : undefined}>{x.reverted}</span> · LOS{" "}
        <span className={x.los ? "fl-bad" : undefined}>{x.los}</span>
      </p>
      {x.landingWait.medianMin != null && (
        <p className="fl-actuals faint" title="PR을 연 뒤 머지될 때까지(리뷰·머지 대기). 정시율에는 넣지 않는다">
          착륙 대기 중앙값 {blockTime(Math.round(x.landingWait.medianMin))}
        </p>
      )}
      {x.recent.length ? (
        <ul className="fl-log" aria-label={`${a.registration} 최근 FLIGHT`}>
          {x.recent.map((e) => (
            <li key={e.key} title={e.pr.title}>
              <a className="fl-log-flight" href={e.pr.url} target="_blank" rel="noreferrer">
                {e.flight ? flightNumber(e.flight) : "AD HOC"}
              </a>
              <span className="faint">#{e.pr.number}</span>
              <span
                className="fl-log-block"
                title={
                  e.blockMin == null
                    ? "팀 소요 시간 모름(점유가 PR보다 늦게 잡힘)"
                    : `팀 소요 시간(착수 → PR)${e.expectMin == null ? ", 기대치 없음" : `, 기대 ${blockTime(Math.round(e.expectMin))} 이내`}`
                }
              >
                {e.blockMin == null ? "—" : blockTime(e.blockMin)}
              </span>
              <span className="faint" title="착륙 대기(PR → 머지)">
                +{blockTime(e.landingWaitMin)}
              </span>
              {e.onTime != null && <span className={e.onTime ? "fl-ontime" : "fl-late"}>{e.onTime ? "ON TIME" : "DELAYED"}</span>}
              {e.reverted && <span className="fl-bad">REVERTED</span>}
              {e.los > 0 && <span className="fl-bad">LOS {e.los}</span>}
              <span className="faint fl-log-date">{e.arrivedAt.slice(5, 10)}</span>
              <RecentFuel f={fuelOf.get(e.key)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="fl-line faint">LOGBOOK에 ARRIVED 기록 없음</p>
      )}
    </>
  );
}

export function Card({
  a,
  onEdit,
  onBriefing,
  onAog,
  onRetire,
  session,
  onLaunch,
  onStop,
  windowDays,
  dispatchMode,
  onCrewChanged,
}: {
  a: AircraftView;
  onEdit: () => void;
  onBriefing: (opener: HTMLElement) => void;
  onAog: () => void;
  onRetire: () => void;
  session: SessionRow | null | undefined; // undefined: 세션 조종을 못 읽음
  onLaunch: (opener: HTMLElement) => void;
  onStop: () => void;
  windowDays?: number;
  dispatchMode?: string;
  onCrewChanged: () => void;
}) {
  return (
    <article className={`fl-card s-${a.status}${a.aog ? " is-aog" : ""}`}>
      <header className="fl-head">
        <b className="fl-callsign">{a.callsign}</b>
        <span className="mono faint">{a.registration}</span>
        {a.base && <span className="apt">{a.base}</span>}
        <span className="fl-status">{statusOf(a)}</span>
        {session?.kind === "background" && (
          <span className="fl-bg mono" title="atc가 띄운 백그라운드 세션 — claude attach로 열 수 있다">
            BG {session.id}
          </span>
        )}
      </header>
      {a.aog && (
        <p className="fl-aog">
          <span className="fl-aog-mark">AOG</span> {a.aog.reason}
          {a.aog.until ? <span className="faint"> · ~{a.aog.until}</span> : null}
        </p>
      )}
      {a.accountHold && (
        <p className="fl-acct-hold" title={ACCOUNT_HOLD_NEXT}>
          {accountHoldLabel(a.accountHold, Date.now())} <span className="faint">· {accountHoldDetail(a.accountHold)}</span>
        </p>
      )}
      {a.status === "absent" && (
        <p className="fl-absent faint">세션이 없음 — LAUNCH로 띄우거나, CREW BRIEFING을 새 세션에 붙여 넣으면 IN SERVICE가 된다</p>
      )}
      {a.flying.length > 0 && <p className="fl-flying">FLYING {a.flying.map(flightNumber).join(", ")}</p>}
      <ContextLine c={contextBadgeOf(a.context)} />
      <RulesLine r={(a as AircraftView & { rules?: RulesView | null }).rules ?? null} />

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
      <FleetCrew a={a} windowDays={windowDays} dispatchMode={dispatchMode} onChanged={onCrewChanged} />

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

      <h3 className="fl-sub">
        ACCOUNT {a.accountIsDefault && <em>기본값</em>}
      </h3>
      <p className="fl-line">{a.account ? <span className="mono">{a.account}</span> : <span className="faint">지정 없음 — 한도는 reset 시각으로 묶는다</span>}</p>
      {a.fuel && (
        <p className={`fl-fuel lv-${a.fuel.level}`} title={fuelTitle(a.fuel, Date.now())}>
          ACCOUNT{a.fuel.account ? ` ${a.fuel.account}` : ""} {fuelLabel(a.fuel, Date.now())} <span className="faint">· {a.fuel.fromKind === "control" ? "control " : ""}{a.fuel.from} statusline</span>
        </p>
      )}

      <FuelBlock a={a} />

      <h3 className="fl-sub">TARGETS</h3>
      <p className="fl-line">
        {targetParts(a.targets).length ? targetParts(a.targets).join(" · ") : <span className="faint">지정 없음</span>}
      </p>
      <Actuals a={a} />
      {a.note && <p className="fl-note">{a.note}</p>}

      <div className="fl-actions">
        {session === null && (
          <button className="fl-btn primary" onClick={(e) => onLaunch(e.currentTarget)}>
            LAUNCH
          </button>
        )}
        {session?.kind === "background" && (
          <button className="fl-btn" onClick={onStop}>
            STOP
          </button>
        )}
        <button className="fl-btn" onClick={(e) => onBriefing(e.currentTarget)}>
          CREW BRIEFING
        </button>
        <button className="fl-btn" onClick={onAog}>
          {a.aog ? "AOG 해제" : "AOG"}
        </button>
        <button className="fl-btn danger" onClick={onRetire}>
          퇴역
        </button>
        <button className="fl-btn" onClick={onEdit}>
          고치기
        </button>
      </div>
    </article>
  );
}

// 규칙 파일 확인 상태(ATC-42, hooks/rules-drift.mjs). hook 기록이 없는 AIRCRAFT에는 보이지 않는다
function RulesLine({ r }: { r: RulesView | null }) {
  const { clock } = useSettings();
  if (!r) return null;
  if (r.current) {
    return (
      <p className="fl-rules is-current" title={`세션 ${r.sessions}개가 규칙 파일의 지금 내용을 확인함`}>
        RULES current
      </p>
    );
  }
  const title = `이 AIRCRAFT의 세션이 아직 받지 않은 규칙 변경${r.since ? ` · ${r.since}` : ""}. 다음 턴에 rules-drift hook이 diff를 준다`;
  return (
    <p className="fl-rules is-behind" title={title}>
      RULES 미확인{r.since && <> since {formatClock(r.since, clock)} <span className="faint">({timeAgo(r.since, Date.now())})</span></>} <span className="mono">{r.behind.join(", ")}</span>
    </p>
  );
}
