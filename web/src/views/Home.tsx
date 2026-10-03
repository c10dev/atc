import { useMemo } from "react";
import { openAlert } from "../alerts-runtime.ts";
import { alertLevelLabel, flightNumber } from "../aviation.ts";
import type { QueueItem } from "../../../server/supervisor-queue.ts";
import { buildIndex, timeAgo } from "../derive.ts";
import { Actions, useQueue } from "../DutyCards.tsx";
import { EffectRow, useEffects } from "../EffectVerdict.tsx";
import { FlightBrakes } from "../FlightBrakes.tsx";
import { OpenFlight } from "../FlightLink.tsx";
import { type ScheduleHome, scheduleHomeOf, SLIP_LABEL, slipLineOf } from "../home-rows.ts";
import type { PullRequest, Snapshot } from "../../../server/model.ts";
import { callsign } from "../aviation.ts";
import { AtfmAlert, useAtfm } from "./Atfm.tsx";
import { useScheduleHome } from "./Brakes.tsx";
import { HumanRow } from "./HumanCheck.tsx";
import "../Drawer.css";
import "../DutyDrawer.css";
import "./fleet/Fleet.css";
import "./Home.css";
import { Fold } from "../kit/Fold.tsx";

// HOME(`#home`, ATC-377, docs/layout.md Y2): SUPERVISOR에게 아직 남은 일 한 화면. K1~K3 승인과 예외.
// 할 일 목록(SUPERVISOR QUEUE: 승인·WARNING·CAUTION 알림·막힌 FLIGHT·EFFECT·CLOSE, ATC-454) · 지연 WAYPOINT. 정상이면 아무것도 그리지 않는다(design-language 원칙 1).
// brake 줄은 아래 패널의 BRAKES 탭으로 갔다(ATC-455, views/Brakes.tsx). 실제 GROUND STOP의 ATFM 알림(AtfmAlert)은 여기 맨 위에 남는다.
// 새 사실은 없다: 큐와 ATFM을 이미 있는 길로 읽고 같은 길로 누른다.

export function Home({ refreshKey, now, snapshot }: { refreshKey: string; now: number; snapshot: Snapshot }) {
  const atfm = useAtfm(refreshKey);
  const schedule = useScheduleHome(refreshKey);
  return (
    <section className="home" aria-label="HOME">
      <AtfmAlert atfm={atfm} now={now} />
      <HomeQueue refreshKey={refreshKey} now={now} snapshot={snapshot} />
      <HomeSchedule data={schedule.data} now={now} />
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

