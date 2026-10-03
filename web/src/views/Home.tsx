import { useMemo } from "react";
import { actionsOf } from "../../../server/duty-card.ts";
import { openAlert, useAlerts } from "../alerts-runtime.ts";
import { alertLevelLabel, flightNumber } from "../aviation.ts";
import { buildIndex, timeAgo } from "../derive.ts";
import { Actions, useQueue } from "../DutyCards.tsx";
import { EffectRow, effectBad, useEffects } from "../EffectVerdict.tsx";
import { FlightBrakes } from "../FlightBrakes.tsx";
import { OpenFlight } from "../FlightLink.tsx";
import { homeAlertsOf, prNameOf, type ScheduleHome, scheduleHomeOf, SLIP_LABEL, slipLineOf, stuckRowsOf } from "../home-rows.ts";
import type { PullRequest, Snapshot } from "../../../server/model.ts";
import { callsign } from "../aviation.ts";
import { AtfmAlert, useAtfm } from "./Atfm.tsx";
import { useScheduleHome } from "./Brakes.tsx";
import { HumanRow } from "./HumanCheck.tsx";
import { useFollowBoard } from "./Follow.tsx";
import "../Drawer.css";
import "../DutyDrawer.css";
import "./fleet/Fleet.css";
import "./Home.css";
import { Fold } from "../kit/Fold.tsx";

// HOME(`#home`, ATC-377, docs/layout.md Y2): SUPERVISOR에게 아직 남은 일 한 화면. K1~K3 승인과 예외.
// SUPERVISOR QUEUE · WARNING·CAUTION 알림 · 막힌 FLIGHT 줄. 정상이면 아무것도 그리지 않는다(design-language 원칙 1).
// brake 줄은 아래 패널의 BRAKES 탭으로 갔다(ATC-455, views/Brakes.tsx). 실제 GROUND STOP의 ATFM 알림(AtfmAlert)은 여기 맨 위에 남는다.
// 새 사실은 없다: 큐와 알림, FOLLOW 보드, ATFM을 이미 있는 길로 읽고 같은 길로 누른다.

export function Home({ refreshKey, now, snapshot }: { refreshKey: string; now: number; snapshot: Snapshot }) {
  const atfm = useAtfm(refreshKey);
  const schedule = useScheduleHome(refreshKey);
  return (
    <section className="home" aria-label="HOME">
      <AtfmAlert atfm={atfm} now={now} />
      <HomeQueue refreshKey={refreshKey} now={now} snapshot={snapshot} />
      <HomeAlerts />
      <HomeStuck refreshKey={refreshKey} now={now} />
      <HomeEffects refreshKey={refreshKey} now={now} />
      <HomeSchedule data={schedule.data} now={now} />
    </section>
  );
}

// SUPERVISOR QUEUE: 줄마다 같은 버튼(DUTY 서랍의 QUEUE와 같은 Actions). 비면 아무것도 그리지 않는다
function HomeQueue({ refreshKey, now, snapshot }: { refreshKey: string; now: number; snapshot: Snapshot }) {
  const { queue, reload } = useQueue(refreshKey, true);
  const idx = useMemo(() => buildIndex(snapshot), [snapshot]);
  if (!queue || queue.items.length === 0) return null;
  const airports = snapshot.airports.map((a) => ({ name: a.name, code: a.code, repo: a.repo }));
  const nameOf = (id: string) => {
    const s = idx.sessionById.get(id);
    return s ? callsign(s) : id.slice(0, 8);
  };
  // HUMAN CHECK 줄(ATC-379): 큐 줄이 PR의 증거와 PASS·FAIL을 바로 보인다(STRIPS에 있던 것). 큐의 key는 `<저장소>#<번호>@<head>`
  const humanPull = (key: string): PullRequest | undefined => {
    const [id] = key.split("@");
    return (snapshot.pulls ?? []).find((p) => `${p.repo.replace(/\/+$/, "").split("/").pop()}#${p.number}` === id && p.uiChange && p.humanCheck);
  };
  return (
    <Fold title="QUEUE" label="SUPERVISOR QUEUE" count={queue.items.length}>
      <ul className="hm-list">
        {queue.items.map((i) => (
          <li key={`${i.kind}/${i.key}`} className="hm-row">
            <div className="hm-head">
              <span className="hm-kind mono">{i.kind}</span>
              <span className="hm-since faint">{i.since ? timeAgo(i.since, now) : "—"}</span>
            </div>
            <p className="hm-title mono">{i.title}</p>
            {i.detail && <p className="hm-detail muted">{i.detail}</p>}
            {i.kind === "HUMAN CHECK" && humanPull(i.key) ? (
              <ul className="hc-list">
                <HumanRow pr={humanPull(i.key)!} idx={idx} nameOf={nameOf} />
              </ul>
            ) : (
              <Actions item={i} actions={actionsOf(i, airports)} onDone={reload} />
            )}
          </li>
        ))}
      </ul>
    </Fold>
  );
}

// WARNING·CAUTION 알림(조건). 큐로 가는 것과 막힌 FLIGHT 줄(아래)이 이미 알리는 것은 빼서 한 곳에만 둔다
function HomeAlerts() {
  const { items } = useAlerts();
  const shown = homeAlertsOf(items);
  if (shown.length === 0) return null;
  return (
    <Fold title="ALERTS" label="ALERTS" count={shown.length} foldable={!shown.some((x) => x.level === "warning")}>
      <ul className="hm-list">
        {shown.map((a) => (
          <li key={a.key} className={`hm-row lv-${a.level}`}>
            <button type="button" className="hm-alert" onClick={() => openAlert(a)}>
              <span className="tag code-chip" data-tone="inherit">{alertLevelLabel[a.level!]}</span>
              <span className="mono">{[a.aircraft, a.flight].filter(Boolean).join(" · ") || a.group.toUpperCase()}</span>
              <span className="hm-atext">{a.text}</span>
              {a.next && <span className="muted">→ {a.next}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Fold>
  );
}

// 막힌 FLIGHT 줄: FOLLOW 보드가 이미 센 막힘(한도를 넘긴 줄). 줄에서 CANCEL·RECALL을 누를 수 있다
function HomeStuck({ refreshKey, now }: { refreshKey: string; now: number }) {
  const { data, reload } = useFollowBoard(refreshKey);
  const rows = stuckRowsOf(data?.bundles ?? []);
  if (rows.length === 0) return null;
  return (
    <Fold title="STUCK" label="막힌 FLIGHT" count={rows.length}>
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
    </Fold>
  );
}

// 지연 WAYPOINT(예외)와 Linear에서 직접 Done으로 바꿀 CLOSE. 둘 다 없으면 아무것도 그리지 않는다
function HomeSchedule({ data, now }: { data: ScheduleHome | null; now: number }) {
  const { slips, closeManual } = scheduleHomeOf(data);
  if (slips.length === 0 && closeManual.length === 0) return null;
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
      {closeManual.length > 0 && (
        <Fold title="LINEAR에서 직접 DONE" label="LINEAR에서 직접 DONE" count={closeManual.length}>
          <ul className="hm-list">
            {closeManual.map((x) => (
              <li key={x.id} className="hm-row">
                <div className="hm-head">
                  <span className="mono faint">{x.id}</span>
                  {x.flight && <OpenFlight k={x.flight} label={flightNumber(x.flight)} />}
                  <span className="hm-since faint">{timeAgo(x.statusAt, now)}</span>
                </div>
                <p className="hm-title">
                  <span className="muted">{x.title ?? x.flight}</span> · 승인한 CLOSE — OCC는 이슈 상태를 바꾸지 않으니 Linear에서 Done으로 바꾼다 ·{" "}
                  <a className="mono" href={x.pr.url} target="_blank" rel="noreferrer">
                    PR {prNameOf(x.pr)}
                  </a>
                  {x.url && (
                    <>
                      {" · "}
                      <a href={x.url} target="_blank" rel="noreferrer">
                        Linear에서 열기
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </>
  );
}

// EFFECT CHECK(ATC-402): 배포한 FLIGHT가 목표를 못 맞춘 평결(not improved·worse, 틀렸다고 표시하지 않은 것). 없으면 아무것도 그리지 않는다
function HomeEffects({ refreshKey, now }: { refreshKey: string; now: number }) {
  const { view, set } = useEffects(null, refreshKey);
  const rows = (view?.verdicts ?? []).filter((v) => effectBad(v) && !v.wrong);
  if (rows.length === 0) return null;
  return (
    <Fold title="EFFECT" label="EFFECT CHECK" summary={`${rows.length} · 평결 ${view?.misfire.verdicts ?? 0}건 중 틀림 ${view?.misfire.wrong ?? 0}`}>
      <ul className="hm-list">
        {rows.map((v) => (
          <li key={v.flight} className="hm-row">
            <div className="hm-head">
              <OpenFlight k={v.flight} label={flightNumber(v.flight)} />
              <span className="hm-since faint">배포 {timeAgo(v.deployedAt, now)}</span>
            </div>
            <EffectRow v={v} now={now} onView={set} />
          </li>
        ))}
      </ul>
    </Fold>
  );
}
