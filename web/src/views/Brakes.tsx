import { useCallback, useEffect, useState } from "react";
import { modeLine, modeSegments } from "../../../server/settings-policy.ts";
import { apiGet, apiSend } from "../api.ts";
import type { ScheduleHome } from "../home-rows.ts";
import { atfmAlertOf } from "../readiness-line.ts";
import { useServerSettings } from "../SettingsServer.tsx";
import { AtfmPanel, type useAtfm } from "./Atfm.tsx";
import { BulkPanel } from "./fleet/ControlBulk.tsx";
import "./Brakes.css";

// BRAKES(ATC-455, docs/layout.md S1c): 아래 패널의 BRAKES 탭 몸통. 예전에는 HOME의 맨 아래 줄이었다(ATC-377).
// 늘 있고 중립이다. GROUND STOP·수동 출발 중지(ATFM), STOP ALL, 자동화 스위치의 상태와 DISPATCH·SCHEDULE 모드.
// 누르기 전에는 아무것도 펴지지 않는다. 확인 문구는 예전 그대로이고 아직 `confirm()`이다.

// SCHEDULE 모드와 지연 WAYPOINT를 읽는다(`GET /api/schedule/home`). HOME도 같은 읽기를 쓴다
export function useScheduleHome(refreshKey: string): { data: ScheduleHome | null; reload: () => void } {
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

export function Brakes({ atfm, refreshKey, now, onOpenSettings }: { atfm: ReturnType<typeof useAtfm>; refreshKey: string; now: number; onOpenSettings: () => void }) {
  const { server } = useServerSettings();
  const schedule = useScheduleHome(refreshKey);
  const alertOn = atfmAlertOf(atfm.brief).active;
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

  // SCHEDULE 모드(S1 그림자 ↔ S2 승인): SCHEDULE 탭에 있던 스위치. 같은 길(POST /api/schedule/mode)
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
    <section className="bk" aria-label="BRAKES">
      <div className="bk-row">
        <span className="bk-chip" title="main 깨짐 등으로 실제로 걸린 GROUND STOP과 GROUND DELAY">
          GROUND STOP <b>{stops}</b>
        </span>
        <span className="bk-chip" title="SUPERVISOR가 손으로 건 출발 중지">
          수동 출발 중지 <b>{manual}</b>
        </span>
        <button type="button" className="btn" aria-expanded={atfmOpen} onClick={() => setAtfmOpen((v) => !v)}>
          ATFM…
        </button>
        <button type="button" className="btn is-danger" aria-expanded={stopAll} onClick={() => setStopAll((v) => !v)}>
          STOP ALL…
        </button>
      </div>
      <div className="bk-row">
        <span className="bk-switches faint" aria-label="자동화 스위치">
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
        <p className="bk-error" role="alert">
          {err}
        </p>
      )}
      {atfmOpen && <AtfmPanel atfm={atfm} now={now} alertShown={alertOn} />}
      {stopAll && <BulkPanel op="stop" onClose={() => setStopAll(false)} onDone={() => undefined} />}
    </section>
  );
}
