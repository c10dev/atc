import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { AircraftView } from "../../../../server/fleet.ts";
import type { AbsentAircraft } from "../../../../server/dispatch-launch.ts";
import { mergeLive } from "../../../../server/fleet-live.ts";
import { fleetRows } from "../../../../server/fleet-status.ts";
import type { Snapshot } from "../../../../server/model.ts";
import { DEFAULT_TEAM_PATTERN } from "../../../../server/registration.ts";
import { isBackground, manualStepsOf } from "../../../../server/session-origin.ts";
// CSS 순서: 한 파일이던 때처럼 FleetCrew·Checkride·FleetPlan → FLEET 공통(Fleet.css) → 부분별 CSS.
// 같은 세기의 규칙(.fc-error/.fl-error, .fp-switch/.fl-btn, .fl-input/.fl-reg·.fl-num)이 이 순서에 기댄다
import "../FleetCrew.css";
import { Checkride } from "../Checkride.tsx";
import { FleetPlan } from "../FleetPlan.tsx";
import "./Fleet.css";
import { absentMarkOf } from "./Absent.tsx";
import { BriefingPanel } from "./BriefingPanel.tsx";
import { ControlSessions } from "./ControlSessions.tsx";
import { Card } from "./Card.tsx";
import { Editor } from "./Editor.tsx";
import { EntryForm } from "./EntryForm.tsx";
import { FuelAccounts } from "./Fuel.tsx";
import { LaunchPanel } from "./LaunchPanel.tsx";
import { type FleetBrief, type SessionBrief, api } from "./shared.ts";
import { StatusList } from "./StatusList.tsx";

// FLEET: 팀(AIRCRAFT)마다 CREW COMPLEMENT, TYPE RATING, ROUTE, TARGETS. 설계: docs/fleet.md.
// 팀 빌딩: ENTRY INTO SERVICE(새 AIRCRAFT), CONFIGURATION(팀 구성 템플릿), CREW BRIEFING(세션 시작 지시문),
// AOG(잠시 운항 중지), RETIREMENT(퇴역). LAUNCH·STOP: atc가 `claude --bg`로 세션을 띄우고 멈춘다(docs/fleet.md 8.5).
// 사람이 직접 연 세션(데스크톱·터미널)은 CREW BRIEFING을 붙여 넣는 길도 그대로다.
// FLEET PLAN: atc가 그 버튼들을 언제 쓰자고 제안하는지(docs/fleet.md 8.6, 그림자).
// 운항 상태 목록(ATC-44): 기본은 AIRCRAFT 한 대가 한 줄인 목록. 줄을 누르면 그 AIRCRAFT의 카드가 펼쳐진다. 목록/카드 선택은 localStorage.
// 카드 버튼이 여는 패널(LAUNCH, CREW BRIEFING)은 그 카드 바로 아래에 열린다(ATC-61). ENTRY INTO SERVICE 뒤의 CREW BRIEFING만 맨 위.
// CONTROL(ATC-130·132): 관제 세션 그룹은 AIRCRAFT 목록과 같은 줄·같은 열(ControlSessions.tsx). LAUNCH·STOP·ACCOUNT 편집은 펼친 곳에. 주소 #fleet/control이 그룹을 연다.
// 파일: Fleet.tsx(이 쪽 틀·불러오기·목록/카드 선택), StatusList, Card(실적·RULES 포함), Fuel, EntryForm, LaunchPanel, BriefingPanel, Editor, shared(타입·api).

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

// 빠르게 바뀌는 값(상태·FLYING·마지막 활동·health·chips)은 SSE 스냅샷이 덮고, 느린 부분은 GET /api/fleet을 분마다 다시 읽는다(ATC-100)
export function Fleet({ refreshKey, snapshot }: { refreshKey: string; snapshot: Snapshot }) {
  const [brief, setBrief] = useState<FleetBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // opener: 패널을 연 버튼(닫으면 초점을 돌려준다). from: card면 그 카드 아래, entry면 맨 위(ENTRY INTO SERVICE 옆)
  const [briefing, setBriefing] = useState<{ registration: string; text: string; opener: HTMLElement | null; from: "card" | "entry" } | null>(null);
  const [control, setControl] = useState<SessionBrief | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<{ a: AircraftView; opener: HTMLElement | null } | null>(null);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  // #fleet/TEAM_G로 오면 그 줄을 펼쳐 둔다(METRICS FUEL 개요의 링크, ATC-137)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const m = /^#fleet\/([^/]+)/.exec(location.hash);
    return new Set(m ? [decodeURIComponent(m[1]).toUpperCase()] : []);
  });
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

  const showBriefing = async (reg: string, opener: HTMLElement | null, from: "card" | "entry") => {
    try {
      const r = await api("GET", `/api/fleet/${encodeURIComponent(reg)}/briefing`);
      setBriefing({ registration: reg, text: r.briefing, opener, from });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const enter = async (input: Record<string, unknown>) => {
    try {
      const r = await api("POST", "/api/fleet", input);
      await load();
      await showBriefing(r.aircraft.registration, null, "entry");
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

  // STALE 줄(ATC-93)은 살아 있는 세션이 아니다: LAUNCH를 막지 않고 STOP 대상도 아니다. 카드에는 따로 보인다
  const sessionOf = (reg: string) => control?.sessions.find((x) => !x.stale && (x.name ?? "").toUpperCase() === reg) ?? null;
  const staleOf = (reg: string) => control?.sessions.filter((x) => x.stale && (x.name ?? "").toUpperCase() === reg) ?? [];

  // 실패하면 사유를 돌려준다. 패널 안에 보인다(맨 위 오류 줄은 목록 아래쪽에서 안 보인다)
  const launch = async (reg: string, input: { permissionMode: string; model: string; account?: string }): Promise<string | null> => {
    try {
      await api("POST", `/api/fleet/${encodeURIComponent(reg)}/launch`, input);
      setLaunching(null);
      await load();
      return null;
    } catch (e) {
      return (e as Error).message;
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
    // 출처(ATC-76)가 background일 때만 atc가 세션을 멈춘다
    const row = sessionOf(a.registration);
    const bg = Boolean(row) && isBackground(a.origin ?? (row?.kind === "background" ? "background" : null));
    const live = bg
      ? `\n${a.registration}는 atc가 띄운 세션입니다. 퇴역하면 세션도 멈출지 다음에 묻습니다.`
      : a.status !== "absent"
        ? `\n${a.registration} 세션이 아직 살아 있습니다. atc는 배정만 멈춥니다. ${manualStepsOf(a.origin, a.registration, "stop")}`
        : "";
    const reason = prompt(`${a.callsign}(${a.registration})를 퇴역시킬까요? 사유(선택)${live}`);
    if (reason === null) return;
    const ok = await save(a.registration, { retired: { reason: reason.trim() || null } });
    if (ok && bg && confirm(`${a.registration} 세션도 멈출까요?`)) await stop(a, false);
  };

  const aircraft = useMemo(
    () => (brief ? mergeLive(brief.aircraft, snapshot, brief.teamPattern ?? DEFAULT_TEAM_PATTERN, Date.now()) : []),
    [brief, snapshot],
  );

  if (!brief) return <p className="empty">{error ? `불러오지 못함: ${error}` : "불러오는 중…"}</p>;
  const inService = aircraft.filter((a) => !a.retired);
  const retired = aircraft.filter((a) => a.retired);
  // 세션이 없을 때만: LAUNCH on approve 또는 RESUME after LIMIT(ATC-129)
  const absentMark = (a: AircraftView) => (a.status === "absent" && !a.restarting ? absentMarkOf(snapshot.absent?.find((x) => x.registration === a.registration), Boolean(a.aog), Date.now()) : null);
  // AIRCRAFT 한 대의 지금 카드(고치는 중이면 편집기). 목록에서 펼칠 때와 카드 보기에서 같이 쓴다.
  // 그 카드가 연 패널(LAUNCH, CREW BRIEFING)은 카드 바로 아래에 붙는다(ATC-61)
  const cardOf = (a: AircraftView) => (
    <Fragment key={a.registration}>
      {editing === a.registration ? (
        <Editor a={a} brief={brief} onCancel={() => setEditing(null)} onSave={(p) => save(a.registration, p)} />
      ) : (
        <Card
          a={a}
          onEdit={() => (setError(null), setEditing(a.registration))}
          onBriefing={(opener) => showBriefing(a.registration, opener, "card")}
          onAog={() => toggleAog(a)}
          onRetire={() => retire(a)}
          session={control ? sessionOf(a.registration) : undefined}
          stale={staleOf(a.registration)}
          absent={absentMark(a)}
          onLaunch={(opener) => (setError(null), setLaunching({ a, opener }))}
          onStop={() => stop(a)}
          windowDays={brief.observedWindowDays}
          dispatchMode={brief.dispatchMode}
          onCrewChanged={load}
        />
      )}
      {launching?.a.registration === a.registration && control && (
        <LaunchPanel
          key={`launch-${a.registration}`}
          a={a}
          control={control}
          opener={launching.opener}
          onCancel={() => setLaunching(null)}
          onLaunch={(input) => launch(a.registration, input)}
        />
      )}
      {briefing?.from === "card" && briefing.registration === a.registration && (
        <BriefingPanel registration={briefing.registration} text={briefing.text} opener={briefing.opener} onClose={() => setBriefing(null)} />
      )}
    </Fragment>
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
      {briefing?.from === "entry" && (
        <BriefingPanel registration={briefing.registration} text={briefing.text} opener={briefing.opener} onClose={() => setBriefing(null)} />
      )}
      {controlError && <p className="fl-entry-preview faint">세션 조종을 쓸 수 없음(LAUNCH·STOP 숨김): {controlError}</p>}
      <FleetPlan refreshKey={refreshKey} onChanged={load} fleetAccounts={brief.fuelAccounts} />
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
      {layout === "list" && inService.length > 0 ? (
        <StatusList
          rows={fleetRows(inService, Date.now())}
          open={open}
          onToggle={toggleOpen}
          absent={(reg) => {
            const a = inService.find((x) => x.registration === reg);
            return a ? absentMark(a) : null;
          }}
          detail={(reg) => {
            const a = inService.find((x) => x.registration === reg);
            return a ? cardOf(a) : null;
          }}
        >
          {/* CONTROL 그룹은 같은 격자로 이어진다(ATC-132) */}
          <ControlSessions snapshot={snapshot} attached />
        </StatusList>
      ) : (
        <>
          {/* 카드 보기이거나 운항 중인 AIRCRAFT가 없으면 CONTROL 그룹이 혼자 선다(StatusList는 빈 목록에서 그룹을 그리지 않는다) */}
          {layout === "cards" && <div className="fl-cards">{inService.map(cardOf)}</div>}
          <div className="fl-list fl-list-solo">
            <ControlSessions snapshot={snapshot} attached={false} />
          </div>
        </>
      )}
      <FuelAccounts accounts={brief.fuelAccounts ?? []} />
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
