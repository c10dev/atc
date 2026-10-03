import { useCallback, useEffect, useMemo, useState } from "react";
import { modeLine, modeSegments } from "../../../server/settings-policy.ts";
import { openAlert } from "../alerts-runtime.ts";
import { apiGet, apiSend } from "../api.ts";
import { alertLevelLabel, flightNumber } from "../aviation.ts";
import type { QueueItem } from "../../../server/supervisor-queue.ts";
import { buildIndex, timeAgo } from "../derive.ts";
import { Actions, useQueue } from "../DutyCards.tsx";
import { EffectRow, useEffects } from "../EffectVerdict.tsx";
import { FlightBrakes } from "../FlightBrakes.tsx";
import { OpenFlight } from "../FlightLink.tsx";
import { type ScheduleHome, scheduleHomeOf, SLIP_LABEL, slipLineOf } from "../home-rows.ts";
import { atfmAlertOf } from "../readiness-line.ts";
import { useServerSettings } from "../SettingsServer.tsx";
import type { PullRequest, Snapshot } from "../../../server/model.ts";
import { callsign } from "../aviation.ts";
import { AtfmAlert, AtfmPanel, useAtfm } from "./Atfm.tsx";
import { BulkPanel } from "./fleet/ControlBulk.tsx";
import { HumanRow } from "./HumanCheck.tsx";
import "../Drawer.css";
import "../DutyDrawer.css";
import "./fleet/Fleet.css";
import "./Home.css";
import { Fold } from "../kit/Fold.tsx";

// HOME(`#home`, ATC-377, docs/layout.md Y2): SUPERVISOR에게 아직 남은 일 한 화면. K1~K3 승인과 예외, 그리고 fleet 전체 brake.
// 할 일 목록(SUPERVISOR QUEUE: 승인·WARNING·CAUTION 알림·막힌 FLIGHT·EFFECT·CLOSE, ATC-454) · 지연 WAYPOINT · brake 줄(늘 있고 중립). 정상이면 brake 줄 말고는 아무것도 없다(design-language 원칙 1).
// 새 사실은 없다: 큐, ATFM, 설정을 이미 있는 길로 읽고 같은 길로 누른다.

// SCHEDULE 탭이 없어진 뒤(ATC-378) 남은 것: 모드, 지연 WAYPOINT, Linear에서 직접 Done으로 바꿀 CLOSE. 읽기는 `GET /api/schedule/home`
function useScheduleHome(refreshKey: string): { data: ScheduleHome | null; reload: () => void } {
  const [data, setData] = useState<ScheduleHome | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    apiGet("/api/schedule/home")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ScheduleHome) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, reload };
}

export function Home({ refreshKey, now, snapshot, onOpenSettings }: { refreshKey: string; now: number; snapshot: Snapshot; onOpenSettings: () => void }) {
  const atfm = useAtfm(refreshKey);
  const schedule = useScheduleHome(refreshKey);
  const alertOn = atfmAlertOf(atfm.brief).active;
  return (
    <section className="home" aria-label="HOME">
      <AtfmAlert atfm={atfm} now={now} />
      <HomeQueue refreshKey={refreshKey} now={now} snapshot={snapshot} />
      <HomeSchedule data={schedule.data} now={now} />
      <Brakes atfm={atfm} alertOn={alertOn} now={now} onOpenSettings={onOpenSettings} schedule={schedule} />
    </section>
  );
}

// SUPERVISOR의 할 일 목록(ATC-454, S1a): 서버가 한 순서로 준 줄을 그대로 그린다(알림·막힌 FLIGHT·EFFECT·CLOSE도 같은 목록). 줄마다 단추는 서버가 정한 `primary` 하나.
// 비면 아무것도 그리지 않는다. 레일의 HOME 배지·SUPERVISOR 요약의 todo와 같은 수(`items.length`)
function HomeQueue({ refreshKey, now, snapshot }: { refreshKey: string; now: number; snapshot: Snapshot }) {
  const { queue, reload } = useQueue(refreshKey, true);
  const { view: effects, set: setEffects } = useEffects(null, refreshKey);
  const idx = useMemo(() => buildIndex(snapshot), [snapshot]);
  if (!queue || queue.items.length === 0) return null;
  const nameOf = (id: string) => {
    const s = idx.sessionById.get(id);
    return s ? callsign(s) : id.slice(0, 8);
  };
  // HUMAN CHECK 줄(ATC-379): 큐 줄이 PR의 증거와 PASS·FAIL을 바로 보인다(STRIPS에 있던 것). 큐의 key는 `<저장소>#<번호>@<head>`
  const humanPull = (key: string): PullRequest | undefined => {
    const [id] = key.split("@");
    return (snapshot.pulls ?? []).find((p) => `${p.repo.replace(/\/+$/, "").split("/").pop()}#${p.number}` === id && p.uiChange && p.humanCheck);
  };
  const warning = queue.items.some((i) => i.level === "warning");
  return (
    <Fold title="TO DO" label="SUPERVISOR QUEUE · 할 일" count={queue.items.length} foldable={!warning}>
      <ul className="hm-list">
        {queue.items.map((i) => {
          const verdict = i.kind === "EFFECT" ? (effects?.verdicts ?? []).find((v) => v.flight === i.key) : undefined;
          return (
            <li key={`${i.kind}/${i.key}`} className="hm-row">
              <div className="hm-head">
                {i.level ? (
                  <span className="tag code-chip" data-tone="inherit">{alertLevelLabel[i.level]}</span>
                ) : (
                  <span className="hm-kind mono">{i.kind}</span>
                )}
                <span className="hm-since faint">{i.since ? timeAgo(i.since, now) : "—"}</span>
              </div>
              <p className="hm-title mono">{i.flight ? <OpenFlight k={i.flight} label={i.title} /> : i.title}</p>
              {i.detail && !verdict && <p className="hm-detail muted">{i.detail}</p>}
              {i.need && <p className="hm-need muted">→ {i.need}</p>}
              {verdict && <EffectRow v={verdict} now={now} onView={(v) => { setEffects(v); reload(); }} />}
              {i.kind === "HUMAN CHECK" && humanPull(i.key) ? (
                <ul className="hc-list">
                  <HumanRow pr={humanPull(i.key)!} idx={idx} nameOf={nameOf} />
                </ul>
              ) : (
                <Primary item={i} onDone={reload} />
              )}
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}

// 줄의 단추 하나: 서버가 정한 primary를 그대로 그린다. 승인·거절은 DUTY 서랍의 QUEUE와 같은 기존 길(Actions), brake는 FOLLOW 줄의 CANCEL·RECALL, open은 그 화면(url이 있으면 그 주소)을 연다
function Primary({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const p = item.primary;
  if (p.action === "approve" && p.op) return <Actions item={item} actions={[{ type: "inline", op: p.op }]} onDone={onDone} />;
  if (p.action === "brake" && item.brake && item.flight) return <FlightBrakes p={{ ...item.brake, flight: item.flight }} mode={item.brake.mode} onDone={onDone} />;
  // 손으로 전하는 카드(UNDELIVERED)·RELAY 카드는 Actions가 그리고, 그 줄의 링크도 거기 있다
  if (item.hand || item.offer) return <Actions item={item} actions={[{ type: "link", label: p.label, hash: p.hash ?? item.hash }]} onDone={onDone} />;
  if (item.kind === "ALERT") {
    return (
      <button type="button" className="dr-btn" onClick={() => openAlert({ key: item.key, link: p.hash ?? item.hash })}>
        {p.label}
      </button>
    );
  }
  return p.url ? (
    <a className="dr-btn" href={p.url} target="_blank" rel="noreferrer">
      {p.label}
    </a>
  ) : (
    <a className="dr-btn" href={p.hash ?? item.hash}>
      {p.label}
    </a>
  );
}

// 지연 WAYPOINT(예외). 없으면 아무것도 그리지 않는다. Linear에서 직접 Done으로 바꿀 CLOSE는 할 일 목록의 CLOSE 줄이다(ATC-454)
function HomeSchedule({ data, now }: { data: ScheduleHome | null; now: number }) {
  const { slips } = scheduleHomeOf(data);
  if (slips.length === 0) return null;
  return (
    <>
      {slips.length > 0 && (
        <Fold title="LATE WAYPOINTS" label="LATE WAYPOINTS" count={slips.length}>
          <ul className="hm-list">
            {slips.map((x) => (
              <li key={x.key} className="hm-row">
                <div className="hm-head">
                  <span className="tag code-chip" data-tone="inherit">{SLIP_LABEL[x.code]}</span>
                  <span className="mono">
                    {x.route} · <b>{x.waypoint}</b>
                  </span>
                  <span className="hm-since faint">{x.reportedAt ? `OCC 보고 ${timeAgo(x.reportedAt, now)}` : "OCC 보고 전"}</span>
                </div>
                <p className="hm-title mono muted">{slipLineOf(x)}</p>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </>
  );
}

// brake 줄: 늘 있고 중립이다. GROUND STOP·수동 출발 중지(ATFM), STOP ALL, 자동화 스위치의 상태와 DISPATCH 모드.
// 누르기 전에는 아무것도 펴지지 않는다
function Brakes({ atfm, alertOn, now, onOpenSettings, schedule }: { atfm: ReturnType<typeof useAtfm>; alertOn: boolean; now: number; onOpenSettings: () => void; schedule: ReturnType<typeof useScheduleHome> }) {
  const { server } = useServerSettings();
  const [atfmOpen, setAtfmOpen] = useState(false);
  const [stopAll, setStopAll] = useState(false);
  const [mode, setMode] = useState<"shadow" | "approval" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const brief = atfm.brief;
  const stops = brief ? brief.groundStops.filter((s) => s.enforced).length : 0;
  const manual = brief ? brief.config.manualStops.length : 0;
  const segs = server.state === "ready" ? modeSegments(server.data.switches) : [];
  const dispatchMode = mode ?? (server.state === "ready" ? (server.data.dispatchAuto?.mode ?? null) : null);

  const switchMode = async () => {
    if (!dispatchMode) return;
    const next = dispatchMode === "shadow" ? "approval" : "shadow";
    const text =
      next === "approval"
        ? "DISPATCH를 승인 운용(2b)으로 켤까요?\n\n켜면 승인한 제안이 OCC 세션을 거쳐 CAPTAIN(팀 세션)에게 FLIGHT PLAN으로 나갑니다."
        : "DISPATCH를 그림자 운용(2a)으로 돌릴까요? 이미 보낸 FLIGHT PLAN은 그대로 두고, 새로 보내지는 않습니다.";
    if (!confirm(text)) return;
    setErr(null);
    try {
      const res = await apiSend("POST", "/api/dispatch/mode", { mode: next });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMode(body.mode === "approval" ? "approval" : "shadow");
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };

  // SCHEDULE 모드(S1 그림자 ↔ S2 승인): SCHEDULE 탭에 있던 스위치가 여기로 왔다. 같은 길(POST /api/schedule/mode)
  const scheduleMode = schedule.data?.mode ?? null;
  const switchSchedule = async () => {
    if (!scheduleMode) return;
    const next = scheduleMode === "shadow" ? "approval" : "shadow";
    const text =
      next === "approval"
        ? 'SCHEDULE을 승인 운용(S2)으로 켤까요?\n\n켜면 승인한 SCHEDULE 작업을 OCC가 Linear에 씁니다(linear-guard가 입력을 비교). 준비: vocado 규칙의 "Linear에는 리더만 쓴다" 변경, Linear에 rating:SEC·UI·DATA·DOCS 라벨.'
        : "SCHEDULE을 그림자 운용(S1)으로 돌릴까요? 이미 발부한 작업은 그대로 두고, 새로 발부하지 않습니다(linear-guard가 모든 쓰기를 막음).";
    if (!confirm(text)) return;
    setErr(null);
    try {
      const res = await apiSend("POST", "/api/schedule/mode", { mode: next });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      schedule.reload();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };

  return (
    <section className="hm-brakes" aria-label="BRAKES">
      <div className="hm-brow">
        <h2 className="label">BRAKES</h2>
        <span className="hm-chip" title="main 깨짐 등으로 실제로 걸린 GROUND STOP과 GROUND DELAY">
          GROUND STOP <b>{stops}</b>
        </span>
        <span className="hm-chip" title="SUPERVISOR가 손으로 건 출발 중지">
          수동 출발 중지 <b>{manual}</b>
        </span>
        <button type="button" className="btn" aria-expanded={atfmOpen} onClick={() => setAtfmOpen((v) => !v)}>
          ATFM…
        </button>
        <button type="button" className="btn is-danger" aria-expanded={stopAll} onClick={() => setStopAll((v) => !v)}>
          STOP ALL…
        </button>
      </div>
      <div className="hm-brow">
        <span className="hm-switches faint" aria-label="자동화 스위치">
          {segs.length ? modeLine(segs) : server.state === "loading" ? "스위치 읽는 중…" : "스위치를 읽지 못함"}
        </span>
        {dispatchMode && (
          <button type="button" className="btn" onClick={() => void switchMode()} title="DISPATCH 모드(2a 그림자 ↔ 2b 승인). 자동 운항은 승인 운용에서만 일한다">
            DISPATCH {dispatchMode === "approval" ? "APPROVAL" : "SHADOW"} — {dispatchMode === "approval" ? "2a로" : "2b로"}
          </button>
        )}
        {scheduleMode && (
          <button type="button" className="btn" onClick={() => void switchSchedule()} title="SCHEDULE 모드(S1 그림자 ↔ S2 승인). S2에서 승인한 초안을 OCC가 Linear에 쓴다">
            SCHEDULE {scheduleMode === "approval" ? "APPROVAL" : "SHADOW"} — {scheduleMode === "approval" ? "S1로" : "S2로"}
          </button>
        )}
        <button type="button" className="btn" onClick={onOpenSettings}>
          스위치 설정
        </button>
      </div>
      {err && (
        <p className="hm-error" role="alert">
          {err}
        </p>
      )}
      {atfmOpen && <AtfmPanel atfm={atfm} now={now} alertShown={alertOn} />}
      {stopAll && <BulkPanel op="stop" onClose={() => setStopAll(false)} onDone={() => undefined} />}
    </section>
  );
}
