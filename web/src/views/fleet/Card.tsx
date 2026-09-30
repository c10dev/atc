import { useState } from "react";
import type { AircraftView } from "../../../../server/fleet.ts";
import { fleetStatusOf, flightDetailText } from "../../../../server/fleet-status.ts";
import { RESTARTING_TEXT } from "../../../../server/restarting.ts";
import { contextBadgeOf } from "../../../../server/fuel-context.ts";
import { fuelLabel, fuelTitle } from "../../../../server/fuel-remaining.ts";
import { usd } from "../../../../server/fuel-view.ts";
import { ACCOUNT_HOLD_NEXT, accountHoldDetail, accountHoldLabel } from "../../../../server/health.ts";
import { conflictHintOf, IDEA_SUPERSEDED, renameHintOf } from "../../../../server/registration.ts";
import type { RulesView } from "../../../../server/rules-state.ts";
import { isBackground, manualStepsOf, originBadgeOf } from "../../../../server/session-origin.ts";
import { flightNumber } from "../../aviation.ts";
import { timeAgo } from "../../derive.ts";
import { ActivityLine, JobDetail, NeedsYou, SuggestedReply } from "../../ui.tsx";
import { formatClock, useSettings } from "../../settings.ts";
import { FleetCrew } from "../FleetCrew.tsx";
import type { AbsentMark } from "./Absent.tsx";
import { ContextLine } from "./Context.tsx";
import { FuelBlock, RecentFuel } from "./Fuel.tsx";
import { ReportLine } from "./ReportMark.tsx";
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
            <li key={e.key} title={e.pr?.title ?? e.standFree?.evidence.note}>
              <a className="fl-log-flight" href={e.pr?.url ?? e.standFree?.evidence.url ?? undefined} target="_blank" rel="noreferrer">
                {e.flight ? flightNumber(e.flight) : "AD HOC"}
              </a>
              {/* STAND 없는 FLIGHT(ATC-72): PR 대신 확인한 증거 */}
              <span className="faint">{e.pr ? `#${e.pr.number}` : e.standFree?.arrivedVia === "confirmed-suggestion" ? "STAND 없음 · 후보 확인" : "STAND 없음 · 보고"}</span>
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
              {e.landingWaitMin != null && (
                <span className="faint" title="착륙 대기(PR → 머지)">
                  +{blockTime(e.landingWaitMin)}
                </span>
              )}
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
  stale = [],
  absent = null,
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
  stale?: SessionRow[]; // 멈췄는데 Claude Code가 아직 목록에 둔 job(ATC-93)
  absent?: AbsentMark | null; // 세션 없는 백그라운드 AIRCRAFT: LAUNCH on approve·RESUME after LIMIT(ATC-129)
  onLaunch: (opener: HTMLElement) => void;
  onStop: () => void;
  windowDays?: number;
  dispatchMode?: string;
  onCrewChanged: () => void;
}) {
  // 세션 출처(ATC-76): BG·DESKTOP·TERM과 permission mode. BG id는 툴팁에
  // 백그라운드면 세션 파일의 jobId가 우선(ATC-98, 스냅샷). 없으면 claude agents의 id
  const origin = originBadgeOf(a.background ? "background" : a.origin, a.permissionMode, a.background?.jobId ?? session?.id);
  return (
    <article className={`fl-card s-${a.status}${a.aog ? " is-aog" : ""}`}>
      <header className="fl-head">
        <b className="fl-callsign">{a.callsign}</b>
        <span className="mono faint">{a.registration}</span>
        {a.base && <span className="apt">{a.base}</span>}
        <span className="fl-status">{statusOf(a)}</span>
        {origin && (
          <span className={`fl-origin mono o-${origin.origin}`} title={origin.title}>
            {origin.badge}
            {origin.mode && <span className="fl-origin-mode"> {origin.mode}</span>}
          </span>
        )}
      </header>
      {/* 백그라운드가 아닌 세션(ATC-76): atc가 멈추거나 다시 띄우지 않는다 — 손 절차 */}
      {a.origin && !isBackground(a.origin) && <p className="fl-origin-note faint">{manualStepsOf(a.origin, a.registration, "stop")}</p>}
      {stale.length > 0 && (
        <p className="fl-origin-note fl-stale faint" title="claude agents --json에 pid·status 없이 남은 멈춘 background job. LAUNCH를 막지 않고 상한에 세지 않는다">
          <span className="fl-stale-mark mono">STALE {stale.map((x) => x.id).join(", ")}</span> Claude Code가 멈춘 job을 아직 목록에 둠 — 무시해도 된다
        </p>
      )}
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
      {a.report && <ReportLine r={a.report} />}
      {a.sessionConflict?.length ? (
        <p className="fl-name-conflict" title={conflictHintOf(a.sessionConflict, a.registration)}>
          세션 {a.sessionConflict.length}개가 {a.registration}로 읽힘:{" "}
          {a.sessionConflict.map((n, i) => (
            <span key={i}>
              {i ? ", " : ""}
              <code>{n}</code>
            </span>
          ))}{" "}
          — 합치지 않는다. 하나만 남기거나 이름을 바꾼다
          <a href={IDEA_SUPERSEDED} target="_blank" rel="noreferrer">
            idea #96
          </a>
        </p>
      ) : null}
      {a.sessionName && (
        <p className="fl-rename" title={renameHintOf(a.sessionName, a.registration)}>
          세션 이름 <code>{a.sessionName}</code> → <code>{a.registration}</code>로 바꾸면 좋다
        </p>
      )}
      {a.status === "absent" && (
        a.restarting ? (
          <p className="fl-absent faint" title="데스크톱의 /clear는 세션을 끝낸다. 새 세션은 같은 이름으로 다음 지시와 함께 뜬다">
            {RESTARTING_TEXT} — {a.restarting.until.slice(11, 16)}Z까지. 승인된 제안은 그동안 닫히지 않는다
          </p>
        ) : absent ? (
          <p className={`fl-absent${absent.resume ? " is-resume" : " is-launch"}`} title={absent.title}>
            {absent.label} — {absent.resume ? "reset 뒤 DISPATCH에 RESUME 카드가 나온다" : "DISPATCH 카드를 승인하면 atc가 띄운다"}. FLEET LAUNCH로 직접 띄워도 된다
          </p>
        ) : (
          <p className="fl-absent faint">세션이 없음 — LAUNCH로 띄우거나, CREW BRIEFING을 새 세션에 붙여 넣으면 IN SERVICE가 된다</p>
        )
      )}
      {a.flying.length > 0 && <p className="fl-flying">FLYING {a.flying.map(flightNumber).join(", ")}</p>}
      {a.status !== "absent" && <ActivityLine activity={a.activity} now={Date.now()} className="fl-activity" />}
      {(a.flights ?? []).some((f) => f.kept) && (
        <ul className="fl-kept">
          {a.flights
            .filter((f) => f.kept)
            .map((f) => {
              const d = f.detail ? flightDetailText(f.detail, Date.now()) : null;
              return (
                <li key={f.key} title="STAND 점유(claimTtl)는 지났지만 이 AIRCRAFT가 멈춘 채 쥔 FLIGHT">
                  HOLDING <b className="mono">{flightNumber(f.key)}</b>
                  {d && <span className={`fl-r-detail mono${d.unpushed ? " is-unpushed" : ""}`}>{d.text}</span>}
                </li>
              );
            })}
        </ul>
      )}
      <ContextLine c={contextBadgeOf(a.context)} />
      <RulesLine r={(a as AircraftView & { rules?: RulesView | null }).rules ?? null} />
      <LanguageLine l={(a as AircraftView & { language?: { at: string } | null }).language ?? null} />

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
      <p className="fl-line">
        {a.observedAccount ? (
          <span className="mono" title="세션이 home ACCOUNT와 다른 폴더에서 돌고 있다. 오류가 아니다">
            flying on {a.observedAccount} (home {a.account})
          </span>
        ) : a.account ? (
          <span className="mono">{a.account}</span>
        ) : (
          <span className="faint">지정 없음 — 한도는 reset 시각으로 묶는다</span>
        )}
      </p>
      {/* 출처 힌트(ATC-76): 백그라운드 세션은 이 호스트 CLI의 로그인을, 데스크톱 세션은 앱의 계정을 쓴다. 계정 정보는 읽지 않는다 */}
      {a.job?.state === "blocked" && (
        <div className="fl-needs-you">
          <NeedsYou job={a.job} />
          {a.job.detail && <p className="fl-line faint">{a.job.detail}</p>}
          <SuggestedReply job={a.job} />
        </div>
      )}
      {a.job?.state === "working" && (a.job.detail || a.job.settled) && <p className="fl-line"><JobDetail job={a.job} /></p>}
      {(a.origin === "background" || a.origin === "desktop") && (
        <p className="fl-origin-note faint">{a.origin === "background" ? "BG 세션 — 이 호스트의 CLI 로그인을 따른다" : "DESKTOP 세션 — Claude 앱의 계정을 따른다"}</p>
      )}
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
        {origin?.attach && <CopyAttach command={origin.attach} />}
        {session && isBackground(a.origin ?? (session.kind === "background" ? "background" : null)) && (
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

// BG 세션을 여는 명령을 복사한다(ATC-98). 복사가 막힌 환경에서는 조용히 넘어가고, 명령은 버튼 툴팁에 그대로 있다
function CopyAttach({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드를 못 쓰면 툴팁의 명령을 직접 복사한다
    }
  };
  return (
    <button type="button" className="fl-btn fl-copy-attach mono" title={command} aria-label={`${command} 복사`} onClick={copy}>
      {copied ? "복사됨" : "ATTACH 복사"}
    </button>
  );
}

// LANGUAGE(ATC-150): CAPTAIN이 SUPERVISOR가 읽는 글에 일본어(가나)를 썼다. 알림만 — 세션에는 아무것도 보내지 않는다
function LanguageLine({ l }: { l: { at: string } | null }) {
  if (!l) return null;
  return (
    <p className="fl-rules is-behind" title={`가나가 처음 보인 시각 ${l.at}. CREW BRIEFING을 다시 보내면 언어 규칙이 들어 있다(자동으로 보내지 않는다)`}>
      LANGUAGE 일본어로 씀 — CREW BRIEFING 다시 보내기
    </p>
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
