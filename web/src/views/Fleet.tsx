import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import type { AircraftView, CrewMember, FleetFile, Rating } from "../../../server/fleet.ts";
import { elapsedText, type FleetRow, fleetRows, fleetStatusOf } from "../../../server/fleet-status.ts";
import type { RulesView } from "../../../server/rules-state.ts";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import { formatClock, useSettings } from "../settings.ts";
import { FleetCrew } from "./FleetCrew.tsx";
import { Checkride } from "./Checkride.tsx";
import { FleetPlan } from "./FleetPlan.tsx";
import "./Fleet.css";

// FLEET: 팀(AIRCRAFT)마다 CREW COMPLEMENT, TYPE RATING, ROUTE, TARGETS. 설계: docs/fleet.md.
// 팀 빌딩: ENTRY INTO SERVICE(새 AIRCRAFT), CONFIGURATION(팀 구성 템플릿), CREW BRIEFING(세션 시작 지시문),
// AOG(잠시 운항 중지), RETIREMENT(퇴역). LAUNCH·STOP: atc가 `claude --bg`로 세션을 띄우고 멈춘다(docs/fleet.md 8.5).
// 사람이 직접 연 세션(데스크톱·터미널)은 CREW BRIEFING을 붙여 넣는 길도 그대로다.
// FLEET PLAN: atc가 그 버튼들을 언제 쓰자고 제안하는지(docs/fleet.md 8.6, 그림자).
// 운항 상태 목록(ATC-44): 기본은 AIRCRAFT 한 대가 한 줄인 목록. 줄을 누르면 그 AIRCRAFT의 카드가 펼쳐진다. 목록/카드 선택은 localStorage.

interface Configuration {
  id: string;
  label: string;
  complement: CrewMember[];
  ratings: Rating[];
}

interface FleetBrief {
  ratings: Rating[];
  defaults: FleetFile["defaults"];
  projects: string[];
  aircraft: AircraftView[];
  configurations: Configuration[];
  airports: string[];
  defaultBase: string | null;
  nextRegistration: string | null;
  observedWindowDays?: number; // 관측 CREW를 세는 기간(옛 서버엔 없음)
  dispatchMode?: "shadow" | "approval"; // CREW CHANGE 승인은 approval(2b)에서만(옛 서버엔 없음)
}

// GET /api/fleet/sessions: REGISTRATION 이름의 세션(claude agents --json)
interface SessionRow {
  id?: string;
  name?: string;
  kind: string; // background | interactive
  status?: string;
}
interface SessionBrief {
  max: number;
  permissionModes: string[];
  sessions: SessionRow[];
}

const statusOf = fleetStatusOf;

// 목록/카드 선택(ATC-44). 저장소를 못 쓰면 목록이 기본
type Layout = "list" | "cards";
const LAYOUT_KEY = "atc.fleet.layout";
function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "cards" ? "cards" : "list";
  } catch {
    return "list";
  }
}
function saveLayout(l: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, l);
  } catch {}
}

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
  const [briefing, setBriefing] = useState<{ registration: string; text: string } | null>(null);
  const [control, setControl] = useState<SessionBrief | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<AircraftView | null>(null);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const chooseLayout = (l: Layout) => {
    setLayout(l);
    saveLayout(l);
  };
  const toggleOpen = (reg: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(reg)) next.add(reg);
      return next;
    });

  const load = useCallback(async () => {
    try {
      setBrief(await api("GET", "/api/fleet"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // 세션 조종은 따로 읽는다. 못 읽어도 FLEET는 보인다(LAUNCH·STOP만 숨김)
    try {
      setControl(await api("GET", "/api/fleet/sessions"));
      setControlError(null);
    } catch (e) {
      setControl(null);
      setControlError((e as Error).message);
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

  const showBriefing = async (reg: string) => {
    try {
      const r = await api("GET", `/api/fleet/${encodeURIComponent(reg)}/briefing`);
      setBriefing({ registration: reg, text: r.briefing });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const enter = async (input: Record<string, unknown>) => {
    try {
      const r = await api("POST", "/api/fleet", input);
      await load();
      await showBriefing(r.aircraft.registration);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const toggleAog = (a: AircraftView) => {
    if (a.aog) return save(a.registration, { aog: null });
    const reason = prompt(`${a.callsign}(${a.registration})를 AOG로 둡니다. 사유는?`);
    if (!reason?.trim()) return;
    const until = prompt("해제 예정일(YYYY-MM-DD, 비워도 됨)") ?? "";
    return save(a.registration, { aog: { reason, until: until.trim() || null } });
  };

  const sessionOf = (reg: string) => control?.sessions.find((x) => (x.name ?? "").toUpperCase() === reg) ?? null;

  const launch = async (reg: string, input: { permissionMode: string; model: string }) => {
    try {
      await api("POST", `/api/fleet/${encodeURIComponent(reg)}/launch`, input);
      setLaunching(null);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const stop = async (a: AircraftView, ask = true) => {
    const row = sessionOf(a.registration);
    if (ask && !confirm(`${a.callsign}(${a.registration}) 세션 ${row?.id ?? ""}을 멈출까요?\n대화는 남아서 claude attach나 --resume으로 다시 열 수 있습니다.`)) return;
    try {
      await api("POST", `/api/fleet/${encodeURIComponent(a.registration)}/stop`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const retire = async (a: AircraftView) => {
    if (a.retired) return save(a.registration, { retired: false });
    const bg = sessionOf(a.registration)?.kind === "background";
    const live = bg
      ? `\n${a.registration}는 atc가 띄운 세션입니다. 퇴역하면 세션도 멈출지 다음에 묻습니다.`
      : a.status !== "absent"
        ? `\n${a.registration} 세션이 아직 살아 있습니다. 데스크톱·터미널 세션은 atc가 닫지 않고, 배정만 멈춥니다.`
        : "";
    const reason = prompt(`${a.callsign}(${a.registration})를 퇴역시킬까요? 사유(선택)${live}`);
    if (reason === null) return;
    const ok = await save(a.registration, { retired: { reason: reason.trim() || null } });
    if (ok && bg && confirm(`${a.registration} 세션도 멈출까요?`)) await stop(a, false);
  };

  if (!brief) return <p className="empty">{error ? `불러오지 못함: ${error}` : "불러오는 중…"}</p>;
  const inService = brief.aircraft.filter((a) => !a.retired);
  const retired = brief.aircraft.filter((a) => a.retired);
  // AIRCRAFT 한 대의 지금 카드(고치는 중이면 편집기). 목록에서 펼칠 때와 카드 보기에서 같이 쓴다
  const cardOf = (a: AircraftView) =>
    editing === a.registration ? (
      <Editor key={a.registration} a={a} brief={brief} onCancel={() => setEditing(null)} onSave={(p) => save(a.registration, p)} />
    ) : (
      <Card
        key={a.registration}
        a={a}
        onEdit={() => (setError(null), setEditing(a.registration))}
        onBriefing={() => showBriefing(a.registration)}
        onAog={() => toggleAog(a)}
        onRetire={() => retire(a)}
        session={control ? sessionOf(a.registration) : undefined}
        onLaunch={() => (setError(null), setLaunching(a))}
        onStop={() => stop(a)}
        windowDays={brief.observedWindowDays}
        dispatchMode={brief.dispatchMode}
        onCrewChanged={load}
      />
    );

  return (
    <section className="fleet">
      <div className="toolbar">
        <span className="muted">
          AIRCRAFT(팀 세션)마다 태우는 CREW, 맡을 수 있는 일(TYPE RATING), 주 담당 프로젝트(ROUTE), 목표(TARGETS). 기본값은 vocado
          CLAUDE.md의 팀원 규칙이고, DISPATCH planner가 TYPE RATING·CREW·ROUTE를 쓴다.
        </span>
      </div>
      {error && (
        <p className="fl-error" role="alert">
          {error}
        </p>
      )}
      <EntryForm brief={brief} onEnter={enter} />
      {briefing && <BriefingPanel registration={briefing.registration} text={briefing.text} onClose={() => setBriefing(null)} />}
      {launching && control && (
        <LaunchPanel
          a={launching}
          control={control}
          onCancel={() => setLaunching(null)}
          onLaunch={(input) => launch(launching.registration, input)}
        />
      )}
      {controlError && <p className="fl-entry-preview faint">세션 조종을 쓸 수 없음(LAUNCH·STOP 숨김): {controlError}</p>}
      <FleetPlan refreshKey={refreshKey} onChanged={load} />
      <div className="fl-layout" role="group" aria-label="FLEET 보기">
        <h2 className="label">
          AIRCRAFT <em>{inService.length}</em>
        </h2>
        <button className={`fl-layout-btn${layout === "list" ? " is-on" : ""}`} aria-pressed={layout === "list"} onClick={() => chooseLayout("list")}>
          목록
        </button>
        <button className={`fl-layout-btn${layout === "cards" ? " is-on" : ""}`} aria-pressed={layout === "cards"} onClick={() => chooseLayout("cards")}>
          카드
        </button>
      </div>
      {layout === "list" ? (
        <StatusList
          rows={fleetRows(inService, Date.now())}
          open={open}
          onToggle={toggleOpen}
          detail={(reg) => {
            const a = inService.find((x) => x.registration === reg);
            return a ? cardOf(a) : null;
          }}
        />
      ) : (
        <div className="fl-cards">{inService.map(cardOf)}</div>
      )}
      <Checkride refreshKey={refreshKey} onChanged={load} />
      {retired.length > 0 && (
        <>
          <h2 className="label fl-retired-label">
            RETIRED <em>{retired.length}</em>
          </h2>
          <ul className="fl-retired">
            {retired.map((a) => (
              <li key={a.registration}>
                <b>{a.callsign}</b> <span className="mono faint">{a.registration}</span>
                <span className="faint">
                  {" "}
                  · {a.retired!.at.slice(0, 10)}
                  {a.retired!.reason ? ` · ${a.retired!.reason}` : ""}
                </span>
                <button className="fl-btn" onClick={() => retire(a)}>
                  복귀
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// 운항 상태 목록(ATC-44). 한 줄: REGISTRATION·callsign, AIRPORT, 상태, FLYING FLIGHT, 경과, 마지막 활동, 이번 주.
// 줄(버튼)을 누르면 아래에 그 AIRCRAFT의 카드가 펼쳐진다(키보드로도)
function StatusList({ rows, open, onToggle, detail }: { rows: FleetRow[]; open: ReadonlySet<string>; onToggle: (reg: string) => void; detail: (reg: string) => ReactNode }) {
  const now = Date.now();
  if (!rows.length) return <p className="fl-line faint">운항 중인 AIRCRAFT 없음</p>;
  return (
    <div className="fl-list">
      <div className="fl-list-head" aria-hidden="true">
        <span>AIRCRAFT</span>
        <span>AIRPORT</span>
        <span>STATUS</span>
        <span>FLYING</span>
        <span>경과</span>
        <span>마지막 활동</span>
        <span>이번 주</span>
        <span />
      </div>
      <ul className="fl-rows">
        {rows.map((r) => {
          const isOpen = open.has(r.registration);
          return (
            <li key={r.registration} className={`fl-li st-${r.status.replace(/ /g, "-")}${r.health ? " has-health" : ""}${isOpen ? " is-open" : ""}`}>
              <button className="fl-row" aria-expanded={isOpen} aria-controls={`fl-detail-${r.registration}`} onClick={() => onToggle(r.registration)}>
                <span className="fl-r-id">
                  <b>{r.callsign}</b> <span className="mono faint">{r.registration}</span>
                </span>
                <span className="fl-r-apt">{r.airport ? <span className="apt">{r.airport}</span> : <span className="faint">—</span>}</span>
                <span className="fl-r-status">{r.status}</span>
                <span className="fl-r-flight" title={r.flight ? `${r.flight.key}${r.flight.title ? ` ${r.flight.title}` : ""}${r.more ? ` 외 ${r.more}건` : ""}` : undefined}>
                  {r.health && (
                    <span className={`fl-r-health lv-${r.health.level}`} title={`${r.health.detail} — ${r.health.next}`}>
                      {r.health.label}
                    </span>
                  )}
                  {r.flight ? (
                    <>
                      <b className="mono">{flightNumber(r.flight.key)}</b> {r.flight.title && <span className="fl-r-title">{r.flight.title}</span>}
                      {r.more > 0 && <span className="fl-r-more">+{r.more}</span>}
                    </>
                  ) : r.health ? null : (
                    <span className="faint">—</span>
                  )}
                </span>
                <span className="fl-r-elapsed mono" title="지금 쥔 STAND를 잡은 뒤 흐른 시간">
                  {r.elapsedMin == null ? <span className="faint">—</span> : elapsedText(r.elapsedMin)}
                </span>
                <span className="fl-r-last" title={r.lastActiveAt ?? undefined}>
                  {r.lastActiveAt ? timeAgo(r.lastActiveAt, now) : <span className="faint">—</span>}
                </span>
                <span className="fl-r-week" title="이번 주(월요일부터) ARRIVED와 정시율(기대 block time이 있는 FLIGHT만)">
                  {r.week}건 · 정시 {r.weekOnTime == null ? "—" : pct(r.weekOnTime)}
                </span>
                <span className="fl-r-chev" aria-hidden="true">
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen && (
                <div className="fl-detail" id={`fl-detail-${r.registration}`}>
                  {detail(r.registration)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="fl-line faint">LOGBOOK에 ARRIVED 기록 없음</p>
      )}
    </>
  );
}

function Card({
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
  onBriefing: () => void;
  onAog: () => void;
  onRetire: () => void;
  session: SessionRow | null | undefined; // undefined: 세션 조종을 못 읽음
  onLaunch: () => void;
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
      {a.status === "absent" && (
        <p className="fl-absent faint">세션이 없음 — LAUNCH로 띄우거나, CREW BRIEFING을 새 세션에 붙여 넣으면 IN SERVICE가 된다</p>
      )}
      {a.flying.length > 0 && <p className="fl-flying">FLYING {a.flying.map(flightNumber).join(", ")}</p>}
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

      <h3 className="fl-sub">TARGETS</h3>
      <p className="fl-line">
        {a.targets.flightsPerWeek == null && a.targets.onTime == null ? (
          <span className="faint">지정 없음</span>
        ) : (
          <>
            {a.targets.flightsPerWeek != null && <>주 {a.targets.flightsPerWeek} FLIGHT</>}
            {a.targets.flightsPerWeek != null && a.targets.onTime != null && " · "}
            {a.targets.onTime != null && <>정시성 {pct(a.targets.onTime)}</>}
          </>
        )}
      </p>
      <Actuals a={a} />
      {a.note && <p className="fl-note">{a.note}</p>}

      <div className="fl-actions">
        {session === null && (
          <button className="fl-btn primary" onClick={onLaunch}>
            LAUNCH
          </button>
        )}
        {session?.kind === "background" && (
          <button className="fl-btn" onClick={onStop}>
            STOP
          </button>
        )}
        <button className="fl-btn" onClick={onBriefing}>
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

function EntryForm({ brief, onEnter }: { brief: FleetBrief; onEnter: (input: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [registration, setRegistration] = useState(brief.nextRegistration ?? "");
  const [configuration, setConfiguration] = useState("general");
  const [base, setBase] = useState(brief.defaultBase ?? brief.airports[0] ?? "");
  const cfg = brief.configurations.find((c) => c.id === configuration);

  if (!open) {
    return (
      <div className="fl-entry-toggle">
        <button className="fl-btn primary" onClick={() => (setRegistration(brief.nextRegistration ?? ""), setOpen(true))}>
          ENTRY INTO SERVICE — 새 AIRCRAFT 들이기
        </button>
      </div>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onEnter({ registration: registration.trim(), configuration, base: base || null })) setOpen(false);
  };
  return (
    <form className="fl-entry" onSubmit={submit}>
      <h2 className="label">ENTRY INTO SERVICE</h2>
      <label>
        등록번호{" "}
        <input
          className="fl-input fl-reg"
          value={registration}
          onChange={(e) => setRegistration(e.target.value.toUpperCase())}
          aria-label="등록번호"
          required
        />
      </label>
      <label>
        CONFIGURATION{" "}
        <select className="fl-input" value={configuration} onChange={(e) => setConfiguration(e.target.value)} aria-label="CONFIGURATION">
          {brief.configurations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        AIRPORT{" "}
        <select className="fl-input" value={base} onChange={(e) => setBase(e.target.value)} aria-label="AIRPORT">
          {brief.airports.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {cfg && (
        <p className="fl-entry-preview faint">
          CREW {cfg.complement.map((m) => `${m.position}(${m.agent})`).join(", ")} · TYPE RATING {cfg.ratings.join(", ")}
        </p>
      )}
      <div className="fl-actions">
        <button type="button" className="fl-btn" onClick={() => setOpen(false)}>
          취소
        </button>
        <button type="submit" className="fl-btn primary">
          들이기
        </button>
      </div>
    </form>
  );
}

function LaunchPanel({
  a,
  control,
  onCancel,
  onLaunch,
}: {
  a: AircraftView;
  control: SessionBrief;
  onCancel: () => void;
  onLaunch: (input: { permissionMode: string; model: string }) => Promise<boolean>;
}) {
  const [permissionMode, setPermissionMode] = useState(control.permissionModes[0] ?? "auto");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const launched = control.sessions.filter((x) => x.kind === "background").length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onLaunch({ permissionMode, model: model.trim() });
    setBusy(false);
  };
  return (
    <form className="fl-entry fl-launch" onSubmit={submit} aria-label={`${a.registration} LAUNCH`}>
      <h2 className="label">
        LAUNCH <em>{a.callsign} ({a.registration}) · AIRPORT {a.base ?? "—"}</em>
      </h2>
      <p className="fl-entry-preview faint">
        그 AIRPORT 저장소에서 백그라운드 세션을 띄우고 CREW BRIEFING을 첫 지시로 넣는다. 세션은 사용량 한도를 쓴다. 지금 백그라운드 세션 {launched}/
        {control.max}.
      </p>
      <label>
        permission mode{" "}
        <select className="fl-input" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} aria-label="permission mode">
          {control.permissionModes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        모델{" "}
        <input className="fl-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="기본값" aria-label="모델" />
      </label>
      <div className="fl-actions">
        <button type="button" className="fl-btn" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className="fl-btn primary" disabled={busy}>
          {busy ? "띄우는 중…" : "LAUNCH"}
        </button>
      </div>
    </form>
  );
}

function BriefingPanel({ registration, text, onClose }: { registration: string; text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="fl-briefing" aria-label={`${registration} CREW BRIEFING`}>
      <h2 className="label">
        CREW BRIEFING <em>{registration} — 새 세션을 그 저장소에서 열고, 세션 이름을 {registration}로 둔 뒤 아래를 붙여 넣는다</em>
      </h2>
      <p className="fl-entry-preview faint">Linear에 tail:{registration} 라벨이 없으면 먼저 만들어야 이 팀에 배정 라벨을 붙일 수 있다.</p>
      <textarea className="fl-briefing-text" readOnly value={text} rows={Math.min(24, text.split("\n").length + 1)} />
      <div className="fl-actions">
        <button className="fl-btn" onClick={onClose}>
          닫기
        </button>
        <button className="fl-btn primary" onClick={copy}>
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </section>
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
