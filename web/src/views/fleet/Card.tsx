import { ChevronDown, Ellipsis, X } from "lucide-react";
import { Icon, IconButton } from "../../kit/Icon.tsx";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { AircraftView } from "../../../../server/fleet.ts";
import { fleetStatusOf, flightDetailText } from "../../../../server/fleet-status.ts";
import { RESTARTING_TEXT } from "../../../../server/restarting.ts";
import { contextBadgeOf } from "../../../../server/fuel-context.ts";
import { fuelLabel, fuelTitle } from "../../../../server/fuel-remaining.ts";
import { NEXT_LAUNCH_TITLE } from "../../../../server/launch-note.ts";
import { type LaunchModelSetting, NEXT_MODEL_TITLE, nextModelNote } from "../../../../server/launch-model.ts";
import { usd } from "../../../../server/fuel-view.ts";
import { ACCOUNT_HOLD_NEXT, accountHoldDetail, accountHoldLabel } from "../../../../server/health.ts";
import { conflictHintOf, IDEA_SUPERSEDED, renameHintOf } from "../../../../server/registration.ts";
import type { RulesView } from "../../../../server/rules-state.ts";
import { isBackground, manualStepsOf, originBadgeOf } from "../../../../server/session-origin.ts";
import { flightNumber } from "../../aviation.ts";
import { OpenFlight } from "../../FlightLink.tsx";
import { RelayBox } from "../../Relay.tsx";
import { timeAgo } from "../../derive.ts";
import { jobKnownText } from "../../../../server/job-age.ts";
import { ActivityLine, JobDetail, NeedsYou, PendingApproval, SuggestedReply } from "../../badges.tsx";
import { pendingNeedsOf } from "../../../../server/pending.ts";
import { formatClock, useSettings } from "../../settings.ts";
import { CrewChangePending, CrewTable } from "../FleetCrew.tsx";
import type { AbsentMark } from "./Absent.tsx";
import { ContextLine } from "./Context.tsx";
import { FuelSummary, RecentFuel } from "./Fuel.tsx";
import { Kv } from "./Kv.tsx";
import { type LaunchInfo, type LaunchInput, LaunchOptions, launchDefaultsOf } from "./LaunchPanel.tsx";
import { ReportLine } from "./ReportMark.tsx";
import { Fold } from "./Fold.tsx";
import { LOG_OUTCOME_TEXT, type SessionBrief, type SessionRow, logOutcomeOf, pct, ratingHelp, stripOf } from "./shared.ts";
import "./Card.css";

// AIRCRAFT 한 대의 카드(ATC-280): 머리(이름·상태·버튼) → 경보 띠(있을 때만) → 네 칸 본문(NOW · CREW · ACCOUNT·FUEL · PERFORMANCE).
// variant detail은 목록 행 아래(FLYING·활동·FOB는 행이 이미 보인다), card는 "카드" 보기(전부)

const statusOf = fleetStatusOf;

// block time: 45m, 3h30m, 2d4h
function blockTime(min: number) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? `${String(min % 60).padStart(2, "0")}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}

// TARGETS 옆 실적(LOGBOOK, docs/fleet.md 7.2). 보여 주기만 한다.
// REPOSITION(ATC-179): 마지막 옮김 한 줄(base 옆). 실패한 옮김은 그렇게 적는다
type LastReposition = { from: string; to: string; at: string; by: string; ok: boolean };
function RepositionNote({ r }: { r: LastReposition | null }) {
  if (!r) return null;
  return (
    <span className="faint" title={`REPOSITION ${r.from} → ${r.to} · ${r.by} · ${r.at.slice(0, 16).replace("T", " ")}Z${r.ok ? "" : " · 실패"}`}>
      ← {r.from}
      {r.ok ? "" : " (실패)"} · {timeAgo(r.at, Date.now())}
    </span>
  );
}

// LOGBOOK 최근 FLIGHT는 이만큼만 먼저 보이고 나머지는 더 보기
const LOG_ROWS = 5;

// PERFORMANCE(ATC-287): 라벨·값 줄, 목표는 값 옆의 캡션. 되돌림·LOS는 0보다 클 때만(14일 건수·착륙 대기 중앙값은 툴팁)
function factsOf(a: AircraftView) {
  const x = a.actuals;
  return [
    `최근 14일 ARRIVED ${x.total} · 되돌림 ${x.reverted} · LOS ${x.los}`,
    x.landingWait.medianMin != null ? `착륙 대기 중앙값 ${blockTime(Math.round(x.landingWait.medianMin))}(PR을 연 뒤 머지될 때까지. 정시율에는 넣지 않는다)` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
function PerformanceKv({ a }: { a: AircraftView }) {
  const x = a.actuals;
  const t = a.targets;
  const weekShort = t.flightsPerWeek != null && x.week < t.flightsPerWeek;
  const lateShort = t.onTime != null && x.onTime.rate != null && x.onTime.rate < t.onTime;
  const facts = factsOf(a);
  return (
    <>
      <Kv label="이번 주" tone={weekShort ? "short" : undefined} target={t.flightsPerWeek != null ? `목표 ${t.flightsPerWeek}` : undefined} title={facts}>
        {x.week}
      </Kv>
      <Kv
        label="정시"
        tone={lateShort ? "short" : undefined}
        target={t.onTime != null ? `목표 ${pct(t.onTime)}` : undefined}
        title={`최근 14일, 기대 block time이 있는 ${x.onTime.measured}건 중 ${x.onTime.within}건이 기대치 안`}
      >
        {x.onTime.rate == null ? "—" : pct(x.onTime.rate)}
      </Kv>
      {x.reverted > 0 && (
        <Kv label="되돌림" tone="bad" title={facts}>
          {x.reverted}
        </Kv>
      )}
      {x.los > 0 && (
        <Kv label="LOS" tone="bad" title={facts}>
          {x.los}
        </Kv>
      )}
    </>
  );
}

// LOGBOOK 띠(ATC-325): 최근 14 FLIGHT를 작은 막대로, 오래된 것부터. 막대마다 결과(정시·지연·PR 없음·UNEXPECTED)와 읽을 수 있는 라벨이 있고,
// 같은 말이 펼친 표에도 있다(툴팁에만 있는 결정은 없다)
function LogStrip({ a }: { a: AircraftView }) {
  const fuelOf = new Map((a.fuelRecent ?? []).map((f) => [f.key, f]));
  const bars = stripOf(a.actuals.recent);
  return (
    <span className="fl-strip" role="list" aria-label={`${a.registration} 최근 FLIGHT ${bars.length}건`}>
      {bars.map((e) => {
        const o = logOutcomeOf(e, fuelOf.get(e.key)?.verdict);
        const text = `${e.flight ? flightNumber(e.flight) : "AD HOC"} · ${e.pr ? `PR #${e.pr.number}` : "PR 없음"} · ${LOG_OUTCOME_TEXT[o]} · ${e.arrivedAt.slice(5, 10)}`;
        return <i key={e.key} role="listitem" className={`fl-bar-o o-${o}`} aria-label={text} title={text} />;
      })}
    </span>
  );
}

// LOGBOOK 접힘 머리의 접근 가능한 이름: 막대마다의 라벨(아래 표에 같은 말이 있다)이 이어붙지 않게 결과별 수 한 줄로
function logbookName(a: AircraftView) {
  const fuelOf = new Map((a.fuelRecent ?? []).map((f) => [f.key, f]));
  const bars = stripOf(a.actuals.recent);
  const n: Record<string, number> = {};
  for (const e of bars) {
    const o = logOutcomeOf(e, fuelOf.get(e.key)?.verdict);
    n[o] = (n[o] ?? 0) + 1;
  }
  const parts = (Object.keys(LOG_OUTCOME_TEXT) as (keyof typeof LOG_OUTCOME_TEXT)[]).filter((o) => n[o]).map((o) => `${LOG_OUTCOME_TEXT[o]} ${n[o]}`);
  return `LOGBOOK, 최근 FLIGHT ${bars.length}건: ${parts.join(" · ")}`;
}

function LogTable({ a }: { a: AircraftView }) {
  const x = a.actuals;
  const [more, setMore] = useState(false);
  const fuelOf = new Map((a.fuelRecent ?? []).map((f) => [f.key, f]));
  const shown = more ? x.recent : x.recent.slice(0, LOG_ROWS);
  return (
    <>
      <table className="fl-log" aria-label={`${a.registration} 최근 FLIGHT`}>
        <thead>
          <tr>
            <th scope="col">FLIGHT</th>
            <th scope="col">PR</th>
            <th scope="col" className="r">
              소요
            </th>
            <th scope="col" className="r">
              NET
            </th>
            <th scope="col" className="r">
              날짜
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => {
            const blockTitle =
              e.blockMin == null
                ? "팀 소요 시간 모름(점유가 PR보다 늦게 잡힘)"
                : `팀 소요 시간(착수 → PR)${e.expectMin == null ? ", 기대치 없음" : `, 기대 ${blockTime(Math.round(e.expectMin))} 이내`}${e.onTime == null ? "" : e.onTime ? " · ON TIME" : " · DELAYED"}`;
            return (
              <tr key={e.key} title={e.pr?.title ?? e.standFree?.evidence.note}>
                <td>
                  <a className="fl-log-flight mono" href={e.pr?.url ?? e.standFree?.evidence.url ?? undefined} target="_blank" rel="noreferrer">
                    {e.flight ? flightNumber(e.flight) : "AD HOC"}
                  </a>
                  {e.reverted && <span className="fl-bad"> REVERTED</span>}
                  {e.los > 0 && <span className="fl-bad"> LOS {e.los}</span>}
                </td>
                {/* STAND 없는 FLIGHT(ATC-72): PR 대신 확인한 증거 */}
                <td className={`muted tn${e.pr ? " mono" : " fl-log-note"}`}>{e.pr ? `#${e.pr.number}` : e.standFree?.arrivedVia === "confirmed-suggestion" ? "STAND 없음 · 후보 확인" : "STAND 없음 · 보고"}</td>
                <td className="r tn mono" title={blockTitle}>
                  <span className={e.onTime === false ? "fl-late" : undefined}>{e.blockMin == null ? "—" : blockTime(e.blockMin)}</span>
                  {e.landingWaitMin != null && (
                    <span className="muted" title="착륙 대기(PR → 머지)">
                      {" "}
                      +{blockTime(e.landingWaitMin)}
                    </span>
                  )}
                </td>
                <td className="r tn mono">
                  <RecentFuel f={fuelOf.get(e.key)} />
                </td>
                <td className="r muted tn mono">{e.arrivedAt.slice(5, 10)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {x.recent.length > LOG_ROWS && (
        <button type="button" className="fl-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? "접기" : `더 보기 (${x.recent.length - LOG_ROWS})`}
        </button>
      )}
    </>
  );
}

// USAGE 막대(ATC-287·325): ACCOUNT 사용 한도(FUEL REMAINING, 같은 ACCOUNT의 모든 AIRCRAFT가 같이 쓴다). 맥락 창의 FOB가 아니다(그것은 NOW의 ContextLine). NOW의 초점 줄에 있고, 목록 행 아래(detail)에서는 NOW가 짧아 ACCOUNT 칸에 둔다. 80%(info)부터 amber, 95%(hold)부터 alert
// FUEL 요약의 cache: CAPTAIN/CREW 둘 다 알면 `99/97%`, 하나만 알면 그 하나, 모르면 —
function cacheText(c: { captain?: number | null; crew?: number | null } | null | undefined) {
  const p = (v: number) => Math.round(v * 100);
  if (c?.captain != null && c.crew != null) return `${p(c.captain)}/${p(c.crew)}%`;
  if (c?.captain != null) return `${p(c.captain)}%`;
  if (c?.crew != null) return `CREW ${p(c.crew)}%`;
  return "—";
}

function UsageBar({ fuel, now }: { fuel: NonNullable<AircraftView["fuel"]>; now: number }) {
  return (
    <div role="img" className={`fl-usage lv-${fuel.level}`} title={fuelTitle(fuel, now)} aria-label={fuelLabel(fuel, now)}>
      <span className="fl-usage-k">USAGE</span>
      <span className="fl-bar" aria-hidden="true">
        <i style={{ width: `${Math.max(0, Math.min(100, fuel.top.pct))}%` }} />
      </span>
      <b className="tn mono">{Math.round(fuel.top.pct)}%</b>
      <span className="fl-kv-t tn">resets {fuelLabel(fuel, now).split(" · ")[1]?.replace("resets ", "")}</span>
    </div>
  );
}

export function Card({
  a,
  variant = "card",
  onEdit,
  onBriefing,
  onAog,
  onRetire,
  session,
  stale = [],
  absent = null,
  onLaunch,
  control = null,
  launchInfo = null,
  onStop,
  windowDays,
  dispatchMode,
  launchAccount,
  launchModel,
  onCrewChanged,
}: {
  a: AircraftView;
  variant?: "detail" | "card"; // detail: 목록 행 아래(행이 이미 보이는 FLYING·활동·FOB는 뺀다), card: "카드" 보기
  onEdit: () => void;
  onBriefing: (opener: HTMLElement) => void;
  onAog: () => void;
  onRetire: () => void;
  session: SessionRow | null | undefined; // undefined: 세션 조종을 못 읽음
  stale?: SessionRow[]; // 멈췄는데 Claude Code가 아직 목록에 둔 job(ATC-93)
  absent?: AbsentMark | null; // 세션 없는 백그라운드 AIRCRAFT: LAUNCH on approve·RESUME after LIMIT(ATC-129)
  onLaunch: (input?: LaunchInput) => Promise<string | null>; // input 없음 = 서버 기본값(ATC-310)
  control?: SessionBrief | null;
  launchInfo?: LaunchInfo | null;
  onStop: () => void;
  windowDays?: number;
  dispatchMode?: string;
  launchAccount?: string | null; // LAUNCH ACCOUNT(AIRCRAFT용, ATC-257)
  launchModel?: LaunchModelSetting; // LAUNCH MODEL(ATC-279)
  onCrewChanged: () => void;
}) {
  const nextModel = nextModelNote({ registration: a.registration, airport: a.base ?? null, setting: launchModel }); // ATC-279
  // 세션 출처(ATC-76): BG·DESKTOP·TERM과 permission mode. BG id는 툴팁에
  // 백그라운드면 세션 파일의 jobId가 우선(ATC-98, 스냅샷). 없으면 claude agents의 id
  const origin = originBadgeOf(a.background ? "background" : a.origin, a.permissionMode, a.background?.jobId ?? session?.id, a.background?.attachDir ?? session?.attachDir);
  // 출처 힌트(ATC-76): 백그라운드 세션은 이 호스트 CLI의 로그인을, 데스크톱 세션은 앱의 계정을 쓴다. 계정 정보는 읽지 않는다 — 배지 툴팁으로 옮겼다(ATC-280)
  const originHint = a.origin === "background" ? "BG 세션 — 이 호스트의 CLI 로그인을 따른다" : a.origin === "desktop" ? "DESKTOP 세션 — Claude 앱의 계정을 따른다" : null;
  const now = Date.now();
  const rules = (a as AircraftView & { rules?: RulesView | null }).rules ?? null;
  const language = (a as AircraftView & { language?: { at: string } | null }).language ?? null;
  const ctx = contextBadgeOf(a.context);
  const detail = variant === "detail";
  const kept = (a.flights ?? []).filter((f) => f.kept);
  const working = a.job?.state === "working" && (a.job.detail || a.job.settled);
  // 경보 띠: 켜진 것만, 이 순서로 한 줄씩. 하나도 없으면 띠를 그리지 않는다
  // 상태 점(ATC-287): 일하는 세션 radar, NEEDS YOU blue, NORDO alert, AOG amber, 나머지는 회색. 말은 늘 같이 적는다
  const dot = a.job?.state === "blocked" ? "needs" : a.aog ? "amber" : a.status === "dead" ? "alert" : a.status === "busy" ? "live" : "idle";
  // 경보 띠의 가장 높은 단계: alert(WARNING) > amber(CAUTION). 카드 안쪽 막대 색을 정한다(AOG는 늘 amber)
  let tone: "alert" | "amber" | null = a.aog ? "amber" : null;
  const raise = (t: "alert" | "amber") => {
    if (t === "alert" || tone === null) tone = t;
  };
  const alerts: ReactNode[] = [];
  // LAUNCH(ATC-310): 한 번 눌러 기본값으로, 옵션은 ▾에서. 거절 사유는 경보 띠에 한 줄로 남고 닫을 수 있다
  const [optsOpen, setOptsOpen] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const optsId = useId();
  const defaults = session === null ? launchDefaultsOf(a, launchInfo, control, launchModel) : null;
  const runLaunch = async (input?: LaunchInput) => {
    setLaunchBusy(true);
    setLaunchErr(null);
    const err = await onLaunch(input);
    setLaunchBusy(false);
    if (err) setLaunchErr(err);
  };
  if (launchErr) {
    raise("amber");
    alerts.push(
      <li key="launch-err" className="fl-launch-err" role="alert">
        <span>LAUNCH 못 함: {launchErr}</span>
        <IconButton className="fl-dismiss" label="LAUNCH 오류 닫기" icon={X} onClick={() => setLaunchErr(null)} />
      </li>,
    );
  }
  if (a.job?.state === "blocked") {
    alerts.push(
      <li key="needs" className="fl-needs-you">
        <NeedsYou job={a.job} attach={origin?.attach} />
        {a.job.detail && <span className="fl-line faint"> {a.job.detail} · {jobKnownText(a.job, now)}</span>}
        <SuggestedReply job={a.job} />
      </li>,
    );
  }
  if (pendingNeedsOf(a)) {
    alerts.push(
      <li key="pending" className="fl-needs-you">
        <PendingApproval job={a.job} health={a.health} attach={origin?.attach} />
        {origin?.attach && <span className="fl-line faint mono"> {origin.attach}</span>}
      </li>,
    );
  }
  if (a.aog) {
    alerts.push(
      <li key="aog" className="fl-aog">
        <span className="fl-aog-mark">AOG</span> {a.aog.reason}
        {a.aog.until ? <span className="faint"> · ~{a.aog.until}</span> : null}
      </li>,
    );
  }
  if (a.accountHold) {
    raise("amber");
    alerts.push(
      <li key="hold" className="fl-acct-hold" title={ACCOUNT_HOLD_NEXT}>
        {accountHoldLabel(a.accountHold, now)} <span className="faint">· {accountHoldDetail(a.accountHold)}</span>
      </li>,
    );
  }
  if (a.report) alerts.push(<li key="report"><ReportLine r={a.report} /></li>);
  if (a.sessionConflict?.length) {
    raise("alert");
    alerts.push(
      <li key="conflict" className="fl-name-conflict" title={conflictHintOf(a.sessionConflict, a.registration)}>
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
      </li>,
    );
  }
  if (a.sessionName) {
    raise("amber");
    alerts.push(
      <li key="rename" className="fl-rename" title={renameHintOf(a.sessionName, a.registration)}>
        세션 이름 <code>{a.sessionName}</code> → <code>{a.registration}</code>로 바꾸면 좋다
      </li>,
    );
  }
  if (a.status === "absent") {
    alerts.push(
      a.restarting ? (
        <li key="absent" className="fl-absent faint" title="데스크톱의 /clear는 세션을 끝낸다. 새 세션은 같은 이름으로 다음 지시와 함께 뜬다">
          {RESTARTING_TEXT} — {a.restarting.until.slice(11, 16)}Z까지. 승인된 제안은 그동안 닫히지 않는다
        </li>
      ) : absent ? (
        <li key="absent" className={`fl-absent${absent.resume ? " is-resume" : " is-launch"}`} title={absent.title}>
          {absent.label} — {absent.resume ? "reset 뒤 DISPATCH에 RESUME 카드가 나온다" : "DISPATCH 카드를 승인하면 atc가 띄운다"}. FLEET LAUNCH로 직접 띄워도 된다
        </li>
      ) : (
        <li key="absent" className="fl-absent faint">
          세션이 없음 — LAUNCH로 띄우거나, CREW BRIEFING을 새 세션에 붙여 넣으면 IN SERVICE가 된다
        </li>
      ),
    );
  }
  if (rules && !rules.current) (raise("amber"), alerts.push(<RulesLine key="rules" r={rules} />));
  if (language) (raise("amber"), alerts.push(<LanguageLine key="language" l={language} />));
  // 백그라운드가 아닌 세션(ATC-76): atc가 멈추거나 다시 띄우지 않는다 — 손 절차
  if (a.origin && !isBackground(a.origin)) alerts.push(<li key="manual" className="fl-origin-note faint">{manualStepsOf(a.origin, a.registration, "stop")}</li>);

  // NOW(초점 하나, ATC-325): 무엇을 나는가(키 + 제목 한 줄) · 상태(일하는 중·마지막 도구·시각) · 맥락 FOB(ContextLine) · ACCOUNT USAGE 막대. 목록 행 아래(detail)는 행이 이미 보여 주니 뺀다
  const flyingNow = a.flights.filter((f) => !f.kept && a.flying.includes(f.key));
  const nowCol: ReactNode[] = [];
  if (!detail && a.flying.length > 0) {
    nowCol.push(
      <ul key="flying" className="fl-now-flights" aria-label="FLYING">
        {a.flying.map((k) => {
          const title = flyingNow.find((f) => f.key === k)?.title;
          return (
            <li key={k}>
              <b className="mono">{flightNumber(k)}</b>
              {title && <span className="fl-now-title" title={title}>{title}</span>}
            </li>
          );
        })}
      </ul>,
    );
  }
  if (!detail && a.status !== "absent" && a.activity) nowCol.push(<ActivityLine key="activity" activity={a.activity} now={now} className="fl-activity" />);
  if (!detail && a.fuel) nowCol.push(<UsageBar key="usage" fuel={a.fuel} now={now} />);
  if (kept.length > 0) {
    nowCol.push(
      <ul key="kept" className="fl-kept">
        {kept.map((f) => {
          const d = f.detail ? flightDetailText(f.detail, now) : null;
          return (
            <li key={f.key} title="STAND 점유(claimTtl)는 지났지만 이 AIRCRAFT가 멈춘 채 쥔 FLIGHT">
              HOLDING <b className="mono"><OpenFlight k={f.key} /></b>
              {d && <span className={`fl-r-detail mono${d.unpushed ? " is-unpushed" : ""}`}>{d.text}</span>}
            </li>
          );
        })}
      </ul>,
    );
  }
  if (!detail && ctx) nowCol.push(<ContextLine key="ctx" c={ctx} />);
  if (working) nowCol.push(<p key="job" className="fl-line"><JobDetail job={a.job} /></p>);

  // ACCOUNT: 이름은 한 번씩. 날고 있는 곳(관측)이 home과 다르면 home을 덧붙이고, next LAUNCH는 지금 나는 곳과 다를 때만
  const flyingOn = a.observedAccount ?? a.account;
  const nextLaunch = launchAccount && launchAccount !== flyingOn ? launchAccount : null;

  // 접는 칸의 한 줄 요약(ATC-325)
  const crewDrift = (a as AircraftView & { crewDrift?: { unused?: string[] } | null }).crewDrift;
  const unused = crewDrift?.unused?.length ?? 0;
  const crewSummary = a.complement.length
    ? `${a.complement.length} · ${a.complement[0]!.agent}${a.complement.length > 1 ? ` 외 ${a.complement.length - 1}` : ""}${unused ? ` · 안 씀 ${unused}` : ""}`
    : "—";
  const resets = a.fuel ? fuelLabel(a.fuel, now).split(" · ")[1]?.replace("resets ", "") : null;
  const accountName = a.observedAccount ?? a.account;
  const accountSummary = `${accountName ?? "지정 없음"}${a.fuel ? ` · ${Math.round(a.fuel.top.pct)}%` : ""}${resets ? ` · resets ${resets}` : ""}`;
  const accountBody = Boolean(a.observedAccount || nextLaunch || nextModel || a.accountIsDefault || !a.account);
  const fb = a.fuelBurn;
  const t = a.targets;
  const fuelShort = Boolean(fb && ((t.fuelPerFlight != null && fb.netPerFlight !== null && fb.netPerFlight > t.fuelPerFlight) || (t.cacheHit != null && fb.cacheHit?.total != null && fb.cacheHit.total < t.cacheHit)));
  const warnCount = fb?.crewWarnings?.reduce((n, w) => n + w.count, 0) ?? 0;
  const fuelSummary = fb
    ? fb.withFuel === 0
      ? `fuel 기록 없음 · ARRIVED ${fb.arrived}`
      : `${fb.netPerFlight === null ? "—" : usd(fb.netPerFlight)}/FLT · cache ${cacheText(fb.cacheHit)}${warnCount ? ` · 경고 ${warnCount}` : ""}`
    : null;
  const x = a.actuals;
  const perfShort = (t.flightsPerWeek != null && x.week < t.flightsPerWeek) || (t.onTime != null && x.onTime.rate != null && x.onTime.rate < t.onTime);
  const perfSummary = `이번 주 ${x.week} · 정시 ${x.onTime.rate == null ? "—" : pct(x.onTime.rate)}${x.reverted ? ` · 되돌림 ${x.reverted}` : ""}${x.los ? ` · LOS ${x.los}` : ""}`;

  return (
    <article className={`fl-card s-${a.status}${a.aog ? " is-aog" : ""}${tone ? ` fl-tone-${tone}` : ""}${detail ? " is-detail" : ""}`}>
      <header className="fl-head">
        <div className="fl-id">
          <b className="fl-callsign">{a.callsign}</b>
          <span className="mono faint">{a.registration}</span>
          {a.base && <span className="apt">{a.base}</span>}
          <RepositionNote r={(a as AircraftView & { lastReposition?: LastReposition | null }).lastReposition ?? null} />
          <span className="fl-status">
            <i className={`fl-dot is-${dot}`} aria-hidden="true" />
            {statusOf(a)}
          </span>
          {origin && (
            <span className={`fl-origin mono o-${origin.origin}`} title={[origin.title, originHint].filter(Boolean).join(" · ")}>
              {origin.badge}
              {origin.mode && <span className="fl-origin-mode"> {origin.mode}</span>}
            </span>
          )}
          {stale.length > 0 && (
            <span
              className="fl-stale-mark mono"
              title={`${stale.map((x) => x.id).join(", ")} — claude agents --json에 pid·status 없이 남은 멈춘 background job. Claude Code가 멈춘 job을 아직 목록에 둠 — 무시해도 된다. LAUNCH를 막지 않고 상한에 세지 않는다`}
            >
              STALE {stale.length}
            </span>
          )}
        </div>
        <div className="fl-actions fl-head-actions">
          {session === null && defaults && (
            <span className="fl-launch">
              <span className="fl-split" role="group" aria-label="LAUNCH">
                {!optsOpen && (
                  <button type="button" className="fl-btn primary fl-split-main" disabled={launchBusy || Boolean(defaults.refused)} title={defaults.cap || undefined} onClick={() => runLaunch()}>
                    {launchBusy ? "띄우는 중…" : "LAUNCH"}
                  </button>
                )}
                <button
                  ref={toggleRef}
                  type="button"
                  className={`fl-btn fl-split-more${optsOpen ? " is-open" : ""}`}
                  aria-expanded={optsOpen}
                  aria-controls={optsId}
                  aria-label={optsOpen ? "LAUNCH 옵션 닫기" : "LAUNCH 옵션"}
                  onClick={() => setOptsOpen(!optsOpen)}
                >
                  <Icon icon={ChevronDown} />
                </button>
              </span>
              {!optsOpen && (
                <span className="fl-launch-cap faint" title={defaults.refused ?? (defaults.cap || undefined)}>
                  {defaults.refused ? `LAUNCH 불가 — ${defaults.refused}` : defaults.caption}
                </span>
              )}
            </span>
          )}
          {session && isBackground(a.origin ?? (session.kind === "background" ? "background" : null)) && (
            <button className="fl-btn" onClick={onStop}>
              STOP
            </button>
          )}
          <button className="fl-btn" onClick={(e) => onBriefing(e.currentTarget)}>
            CREW BRIEFING
          </button>
          <RelayBox to={a.registration} flight={(a.flying[0] as string | undefined) ?? kept[0]?.key ?? null} notesFlight={(a.flying[0] as string | undefined) ?? kept[0]?.key ?? null} btnClass="fl-btn" />
          <MoreMenu aog={Boolean(a.aog)} onEdit={onEdit} attach={origin?.attach ?? null} onAog={onAog} onRetire={onRetire} />
        </div>
      </header>
      {session === null && optsOpen && control && (
        <div id={optsId}>
          <LaunchOptions
            a={a}
            control={control}
            info={launchInfo}
            launchModel={launchModel}
            busy={launchBusy}
            onLaunch={(input) => void runLaunch(input)}
            onClose={() => {
              setOptsOpen(false);
              toggleRef.current?.focus();
            }}
          />
        </div>
      )}
      {alerts.length > 0 && <ul className={`fl-alerts${a.job?.state === "blocked" ? " has-needs" : ""}`}>{alerts}</ul>}

      <div className="fl-body">
        {nowCol.length > 0 && (
          <section className="fl-now" aria-label="NOW">
            {nowCol}
          </section>
        )}
        <div className="fl-folds">
          <Fold
            id="crew"
            label="CREW"
            summary={crewSummary}
          >
            <CrewTable a={a} windowDays={windowDays} />
          </Fold>
          <Fold
            id="rating"
            label="TYPE RATING"
            summary={
              <>
                {a.ratings.length ? (
                  <span className="fl-chips">
                    {a.ratings.map((r) => (
                      <span key={r} className={`fl-chip r-${r}`} title={ratingHelp[r]}>
                        {r}
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                )}
                {a.ratingsIsDefault && <em className="fl-default"> 기본값</em>}
              </>
            }
          >
            {a.routes.length > 0 ? (
              <>
                <h3 className="fl-sub">ROUTE</h3>
                <p className="fl-line">{a.routes.join(", ")}</p>
              </>
            ) : undefined}
          </Fold>
          <Fold id="account" label="ACCOUNT" summary={accountSummary}>
            {accountBody ? (
              <>
                <p className="fl-line mono">
                  {a.observedAccount ? (
                    <span title="세션이 home ACCOUNT와 다른 폴더에서 돌고 있다. 오류가 아니다">
                      {a.observedAccount} <span className="muted">· home {a.account}</span>
                    </span>
                  ) : a.account ? (
                    <span>{a.account}</span>
                  ) : (
                    <span className="muted">지정 없음 — 한도는 reset 시각으로 묶는다</span>
                  )}
                  {a.accountIsDefault && <span className="muted"> · 기본값</span>}
                  {nextLaunch && (
                    <span title={NEXT_LAUNCH_TITLE}>
                      {" "}
                      · next LAUNCH {nextLaunch}
                    </span>
                  )}
                  {nextModel && (
                    <span title={NEXT_MODEL_TITLE}>
                      {" "}
                      · {nextModel}
                    </span>
                  )}
                </p>
                {detail && a.fuel && <UsageBar fuel={a.fuel} now={now} />}
              </>
            ) : undefined}
          </Fold>
          {fuelSummary && (
            <Fold id="fuel" label="FUEL" summary={fuelSummary} tone={fuelShort ? "short" : undefined}>
              <FuelSummary a={a} />
            </Fold>
          )}
          <Fold id="perf" label="PERFORMANCE" summary={perfSummary} tone={perfShort ? "short" : undefined}>
            <PerformanceKv a={a} />
            {a.note && <p className="fl-note">{a.note}</p>}
          </Fold>
          {x.recent.length ? (
            <Fold id="logbook" label="LOGBOOK" name={logbookName(a)} summary={<><LogStrip a={a} /><span className="fl-strip-n tn">{x.recent.length}</span></>}>
              <LogTable a={a} />
            </Fold>
          ) : (
            <Fold id="logbook" label="LOGBOOK" summary="ARRIVED 기록 없음" />
          )}
        </div>
      </div>
      <CrewChangePending a={a} dispatchMode={dispatchMode} onChanged={onCrewChanged} />
    </article>
  );
}

// ⋯ 메뉴(ATC-280·325): 고치기·ATTACH 복사·AOG·퇴역. 버튼 + aria-expanded, 화살표로 옮기고 Escape·바깥 클릭·Tab으로 닫으며 닫을 때 초점은 버튼으로
function MoreMenu({ aog, onEdit, attach, onAog, onRetire }: { aog: boolean; onEdit: () => void; attach: string | null; onAog: () => void; onRetire: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = () => [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && e.target !== btn.current) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const key = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="fl-more-menu">
      <button ref={btn} type="button" className="fl-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label="더 보기" onClick={() => setOpen(!open)}>
        <Icon icon={Ellipsis} />
      </button>
      {open && (
        <div ref={box} id={id} role="menu" className="fl-menu" onKeyDown={key}>
          <button type="button" role="menuitem" className="fl-btn" onClick={run(onEdit)}>
            고치기
          </button>
          {attach && (
            <button
              type="button"
              role="menuitem"
              className="fl-btn"
              title={attach}
              aria-label={`${attach} 복사`}
              onClick={async () => {
                const ok = await copyText(attach);
                setCopied(ok ? "ok" : "fail");
                setTimeout(() => setCopied(null), 1500);
              }}
            >
              {copied === "ok" ? "복사됨" : copied === "fail" ? "복사 못 함 — 툴팁의 명령을 직접" : "ATTACH 복사"}
            </button>
          )}
          <button type="button" role="menuitem" className="fl-btn" onClick={run(onAog)}>
            {aog ? "AOG 해제" : "AOG"}
          </button>
          <button type="button" role="menuitem" className="fl-btn danger" onClick={run(onRetire)}>
            퇴역
          </button>
        </div>
      )}
    </div>
  );
}

// BG 세션을 여는 명령을 복사한다(ATC-98). 복사가 막힌 환경에서는 조용히 넘어가고, 명령은 메뉴 항목 툴팁에 그대로 있다
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // 클립보드를 못 쓰면 툴팁의 명령을 직접 복사한다
  }
}

// LANGUAGE(ATC-150): CAPTAIN이 SUPERVISOR가 읽는 글에 일본어(가나)를 썼다. 알림만 — 세션에는 아무것도 보내지 않는다
function LanguageLine({ l }: { l: { at: string } | null }) {
  if (!l) return null;
  return (
    <li className="fl-rules is-behind" title={`가나가 처음 보인 시각 ${l.at}. CREW BRIEFING을 다시 보내면 언어 규칙이 들어 있다(자동으로 보내지 않는다)`}>
      LANGUAGE 일본어로 씀 — CREW BRIEFING 다시 보내기
    </li>
  );
}

// 규칙 파일 확인 상태(ATC-42, hooks/rules-drift.mjs). 뒤처졌을 때만 경보 띠에 나온다(RULES current는 카드에서 뺐다, ATC-280)
function RulesLine({ r }: { r: RulesView }) {
  const { clock } = useSettings();
  const title = `이 AIRCRAFT의 세션이 아직 받지 않은 규칙 변경${r.since ? ` · ${r.since}` : ""}. 다음 턴에 rules-drift hook이 diff를 준다`;
  return (
    <li className="fl-rules is-behind" title={title}>
      RULES 미확인{r.since && <> since {formatClock(r.since, clock)} <span className="faint">({timeAgo(r.since, Date.now())})</span></>} <span className="mono">{r.behind.join(", ")}</span>
    </li>
  );
}
