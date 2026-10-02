import { useState } from "react";
import { actionsOf } from "../../../server/duty-card.ts";
import { modeLine, modeSegments } from "../../../server/settings-policy.ts";
import { openAlert, useAlerts } from "../alerts-runtime.ts";
import { apiSend } from "../api.ts";
import { alertLevelLabel, flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import { Actions, useQueue } from "../DutyCards.tsx";
import { FlightBrakes } from "../FlightBrakes.tsx";
import { OpenFlight } from "../FlightLink.tsx";
import { homeAlertsOf, stuckRowsOf } from "../home-rows.ts";
import { atfmAlertOf } from "../readiness-line.ts";
import { useServerSettings } from "../SettingsServer.tsx";
import type { Snapshot } from "../../../server/model.ts";
import { AtfmAlert, AtfmPanel, useAtfm } from "./Atfm.tsx";
import { BulkPanel } from "./fleet/ControlBulk.tsx";
import { useFollowBoard } from "./Follow.tsx";
import "../Drawer.css";
import "../DutyDrawer.css";
import "./fleet/Fleet.css";
import "./Home.css";

// HOME(`#home`, ATC-377, docs/layout.md Y2): SUPERVISOR에게 아직 남은 일 한 화면. K1~K3 승인과 예외, 그리고 fleet 전체 brake.
// SUPERVISOR QUEUE · WARNING·CAUTION 알림 · 막힌 FLIGHT 줄 · brake 줄(늘 있고 중립). 정상이면 brake 줄 말고는 아무것도 없다(design-language 원칙 1).
// 새 사실은 없다: 큐와 알림, FOLLOW 보드, ATFM, 설정을 이미 있는 길로 읽고 같은 길로 누른다.

export function Home({ refreshKey, now, snapshot, onOpenSettings }: { refreshKey: string; now: number; snapshot: Snapshot; onOpenSettings: () => void }) {
  const atfm = useAtfm(refreshKey);
  const alertOn = atfmAlertOf(atfm.brief).active;
  return (
    <section className="home" aria-label="HOME">
      <AtfmAlert atfm={atfm} now={now} />
      <HomeQueue refreshKey={refreshKey} now={now} snapshot={snapshot} />
      <HomeAlerts />
      <HomeStuck refreshKey={refreshKey} now={now} />
      <Brakes atfm={atfm} alertOn={alertOn} now={now} onOpenSettings={onOpenSettings} />
    </section>
  );
}

// SUPERVISOR QUEUE: 줄마다 같은 버튼(DUTY 서랍의 QUEUE와 같은 Actions). 비면 아무것도 그리지 않는다
function HomeQueue({ refreshKey, now, snapshot }: { refreshKey: string; now: number; snapshot: Snapshot }) {
  const { queue, reload } = useQueue(refreshKey, true);
  if (!queue || queue.items.length === 0) return null;
  const airports = snapshot.airports.map((a) => ({ name: a.name, code: a.code, repo: a.repo }));
  return (
    <section className="hm-sec" aria-label="SUPERVISOR QUEUE">
      <h2 className="label">
        QUEUE <em>{queue.items.length}</em>
      </h2>
      <ul className="hm-list">
        {queue.items.map((i) => (
          <li key={`${i.kind}/${i.key}`} className="hm-row">
            <div className="hm-head">
              <span className="hm-kind mono">{i.kind}</span>
              <span className="hm-since faint">{i.since ? timeAgo(i.since, now) : "—"}</span>
            </div>
            <p className="hm-title mono">{i.title}</p>
            <Actions item={i} actions={actionsOf(i, airports)} onDone={reload} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// WARNING·CAUTION 알림(조건). 큐로 가는 것과 막힌 FLIGHT 줄(아래)이 이미 알리는 것은 빼서 한 곳에만 둔다
function HomeAlerts() {
  const { items } = useAlerts();
  const shown = homeAlertsOf(items);
  if (shown.length === 0) return null;
  return (
    <section className="hm-sec" aria-label="ALERTS">
      <h2 className="label">
        ALERTS <em>{shown.length}</em>
      </h2>
      <ul className="hm-list">
        {shown.map((a) => (
          <li key={a.key} className={`hm-row lv-${a.level}`}>
            <button type="button" className="hm-alert" onClick={() => openAlert(a)}>
              <span className="code-chip">{alertLevelLabel[a.level!]}</span>
              <span className="mono">{[a.aircraft, a.flight].filter(Boolean).join(" · ") || a.group.toUpperCase()}</span>
              <span className="hm-atext">{a.text}</span>
              {a.next && <span className="muted">→ {a.next}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// 막힌 FLIGHT 줄: FOLLOW 보드가 이미 센 막힘(한도를 넘긴 줄). 줄에서 CANCEL·RECALL을 누를 수 있다
function HomeStuck({ refreshKey, now }: { refreshKey: string; now: number }) {
  const { data, reload } = useFollowBoard(refreshKey);
  const rows = stuckRowsOf(data?.bundles ?? []);
  if (rows.length === 0) return null;
  return (
    <section className="hm-sec" aria-label="막힌 FLIGHT">
      <h2 className="label">
        STUCK <em>{rows.length}</em>
      </h2>
      <ul className="hm-list">
        {rows.map((r) => (
          <li key={r.key} className="hm-row">
            <div className="hm-head">
              <OpenFlight k={r.key} label={flightNumber(r.key)} />
              <span className="hm-since faint">{r.stuck?.since ? timeAgo(r.stuck.since, now) : ""}</span>
            </div>
            <p className="hm-title">
              <span className="faint">{r.title ?? "—"}</span> · {r.stuck?.text}
            </p>
            {r.next && r.next.href && (
              <a className="dr-btn" href={r.next.href}>
                {r.next.label}
              </a>
            )}
            {r.proposalInfo && <FlightBrakes p={{ ...r.proposalInfo, flight: r.key }} mode={data?.dispatchMode} onDone={() => void reload()} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

// brake 줄: 늘 있고 중립이다. GROUND STOP·수동 출발 중지(ATFM), STOP ALL, 자동화 스위치의 상태와 DISPATCH 모드.
// 누르기 전에는 아무것도 펴지지 않는다
function Brakes({ atfm, alertOn, now, onOpenSettings }: { atfm: ReturnType<typeof useAtfm>; alertOn: boolean; now: number; onOpenSettings: () => void }) {
  const { server } = useServerSettings();
  const [atfmOpen, setAtfmOpen] = useState(false);
  const [stopAll, setStopAll] = useState(false);
  const [mode, setMode] = useState<"shadow" | "approval" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const brief = atfm.brief;
  const stops = brief ? brief.groundStops.filter((s) => s.enforced).length : 0;
  const manual = brief ? brief.config.manualStops.length : 0;
  const segs = server.state === "ready" ? modeSegments(server.data) : [];
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

  return (
    <section className="hm-brakes" aria-label="BRAKES">
      <div className="hm-brow">
        <h2 className="label">BRAKES</h2>
        <span className="hm-chip mono" title="main 깨짐 등으로 실제로 걸린 GROUND STOP과 GROUND DELAY">
          GROUND STOP <b>{stops}</b>
        </span>
        <span className="hm-chip mono" title="SUPERVISOR가 손으로 건 출발 중지">
          수동 출발 중지 <b>{manual}</b>
        </span>
        <button type="button" className="hm-btn" aria-expanded={atfmOpen} onClick={() => setAtfmOpen((v) => !v)}>
          ATFM…
        </button>
        <button type="button" className="hm-btn is-stop" aria-expanded={stopAll} onClick={() => setStopAll((v) => !v)}>
          STOP ALL…
        </button>
      </div>
      <div className="hm-brow">
        <span className="hm-switches faint" aria-label="자동화 스위치">
          {segs.length ? modeLine(segs) : server.state === "loading" ? "스위치 읽는 중…" : "스위치를 읽지 못함"}
        </span>
        {dispatchMode && (
          <button type="button" className="hm-btn" onClick={() => void switchMode()} title="DISPATCH 모드(2a 그림자 ↔ 2b 승인). 자동 운항은 승인 운용에서만 일한다">
            DISPATCH {dispatchMode === "approval" ? "APPROVAL" : "SHADOW"} — {dispatchMode === "approval" ? "2a로" : "2b로"}
          </button>
        )}
        <button type="button" className="hm-btn" onClick={onOpenSettings}>
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
