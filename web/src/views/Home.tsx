import { useEffect, useMemo, useState } from "react";
import { alertLevelLabel, callsign } from "../aviation.ts";
import type { QueueItem } from "../../../server/supervisor-queue.ts";
import type { PullRequest, Snapshot } from "../../../server/model.ts";
import { openAlert } from "../alerts-runtime.ts";
import { buildIndex, timeAgo } from "../derive.ts";
import { Actions, useQueue } from "../DutyCards.tsx";
import { EffectRow, useEffects } from "../EffectVerdict.tsx";
import { FlightBrakes } from "../FlightBrakes.tsx";
import { OpenFlight } from "../FlightLink.tsx";
import { homeNeedOf } from "../home-rows.ts";
import { Empty } from "../kit/Empty.tsx";
import { SectionHead, TodoRow } from "../kit/TodoRow.tsx";
import { SinceLook } from "../SinceLook.tsx";
import { homeFilterOf, homeFilterOfKind } from "../sidebar-rows.ts";
import { AtfmAlert, useAtfm } from "./Atfm.tsx";
import { HumanRow } from "./HumanCheck.tsx";
import "./Home.css";

// HOME(`#home`, ATC-377, ATC-422 S1b): 답하는 질문은 하나다 — 지금 내가 할 일이 있나. 순서대로: ATFM 알림(걸렸을 때), SINCE LAST LOOK 한 줄, 할 일 목록.
// 할 일 목록은 SUPERVISOR QUEUE(GET /api/supervisor/queue, S1a) 그대로다: 서버가 정한 순서, 줄마다 서버가 정한 단추 하나(`primary`). 화면은 고르지 않고 그린다.
// 비면 SINCE LAST LOOK 줄과 옅은 한 줄 `할 일 없음`뿐이다(design-language 원칙 1). BRAKES는 아래 패널 탭(ATC-455), LATE WAYPOINTS는 FLIGHTS 목록 맨 위로 갔다.
// 읽는 칸의 폭은 880px쯤이고 가운데에 놓는다(design-language 원칙 8의 예외: 목록을 읽는 화면).

// 주소의 거름(#home/alert …): 사이드바가 정하고 HOME이 읽는다
function useHomeFilter() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return homeFilterOf(hash);
}

export function Home({ refreshKey, now, snapshot }: { refreshKey: string; now: number; snapshot: Snapshot }) {
  const atfm = useAtfm(refreshKey);
  return (
    <section className="home" aria-label="HOME">
      <AtfmAlert atfm={atfm} now={now} />
      <SinceLook refreshKey={snapshot.at.slice(0, 16)} />
      <TodoList refreshKey={refreshKey} now={now} snapshot={snapshot} />
    </section>
  );
}

function TodoList({ refreshKey, now, snapshot }: { refreshKey: string; now: number; snapshot: Snapshot }) {
  const { queue, reload } = useQueue(refreshKey, true);
  const { view: effects, set: setEffects } = useEffects(null, refreshKey);
  const filter = useHomeFilter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const idx = useMemo(() => buildIndex(snapshot), [snapshot]);
  if (!queue) return null;
  if (queue.items.length === 0) return <Empty className="home-empty">할 일 없음</Empty>;
  const nameOf = (id: string) => {
    const s = idx.sessionById.get(id);
    return s ? callsign(s) : id.slice(0, 8);
  };
  // HUMAN CHECK 줄(ATC-379): 줄을 열면 PR의 증거와 PASS·FAIL이 보인다. 큐의 key는 `<저장소>#<번호>@<head>`
  const humanPull = (key: string): PullRequest | undefined => {
    const [id] = key.split("@");
    return (snapshot.pulls ?? []).find((p) => `${p.repo.replace(/\/+$/, "").split("/").pop()}#${p.number}` === id && p.uiChange && p.humanCheck);
  };
  const shown = filter === "all" ? queue.items : queue.items.filter((i) => homeFilterOfKind(i.kind) === filter);
  return (
    <div className="home-list">
      <SectionHead count={shown.length}>할 일</SectionHead>
      {shown.length === 0 ? (
        <Empty>이 종류의 할 일 없음</Empty>
      ) : (
        <ul className="home-rows" aria-label="할 일">
          {shown.map((i) => {
            const rk = `${i.kind}/${i.key}`;
            const open = openKey === rk;
            const toggle = () => setOpenKey(open ? null : rk);
            const hc = i.kind === "HUMAN CHECK" ? humanPull(i.key) : undefined;
            const verdict = i.kind === "EFFECT" ? (effects?.verdicts ?? []).find((v) => v.flight === i.key) : undefined;
            return (
              <TodoRow
                key={rk}
                tag={i.level ? alertLevelLabel[i.level] : i.kind}
                tone={i.level ?? null}
                subject={i.title}
                need={homeNeedOf(i)}
                age={i.since ? timeAgo(i.since, now) : "—"}
                open={open}
                onToggle={toggle}
                action={<RowAction item={i} open={open} toggle={toggle} />}
                detail={
                  <ItemDetail item={i} onDone={reload}>
                    {hc && (
                      <ul className="hc-list">
                        <HumanRow pr={hc} idx={idx} nameOf={nameOf} />
                      </ul>
                    )}
                    {verdict && <EffectRow v={verdict} now={now} onView={(v) => { setEffects(v); reload(); }} />}
                  </ItemDetail>
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

// 줄의 단추 하나: 서버가 정한 primary 그대로. 바로 하는 것(알림 열기, 화면·Linear 열기)은 단추가 하고, 확인이 필요한 것(승인·거절, CANCEL·RECALL, 손으로 전하기, HUMAN CHECK)은 줄을 열어 상세에서 한다
function RowAction({ item, open, toggle }: { item: QueueItem; open: boolean; toggle: () => void }) {
  const p = item.primary;
  const inDetail = p.action === "approve" || p.action === "brake" || Boolean(item.hand || item.offer) || (item.kind === "HUMAN CHECK" && Boolean(p.hash === "#home"));
  if (inDetail) {
    return (
      <button type="button" className="btn is-primary" aria-expanded={open} onClick={toggle}>
        {p.label}
      </button>
    );
  }
  if (item.kind === "ALERT") {
    return (
      <button type="button" className="btn" onClick={() => openAlert({ key: item.key, link: p.hash ?? item.hash })}>
        {p.label}
      </button>
    );
  }
  return p.url ? (
    <a className="btn" href={p.url} target="_blank" rel="noreferrer">
      {p.label}
    </a>
  ) : (
    <a className="btn" href={p.hash ?? item.hash}>
      {p.label}
    </a>
  );
}

// 열린 줄의 상세: 필요한 것 한 문장 전체, 이유, 남은 동작(승인·거절, CANCEL·RECALL, 손으로 전하기 …), HUMAN CHECK 증거. 되돌리기 어려운 동작은 여기서 한 번 더 묻는다(각 단추가 확인을 든다)
function ItemDetail({ item, onDone, children }: { item: QueueItem; onDone: () => void; children: React.ReactNode }) {
  const p = item.primary;
  return (
    <>
      <p className="home-need">{homeNeedOf(item)}</p>
      {item.detail && <p>{item.detail}</p>}
      {item.flight && (
        <p>
          FLIGHT <OpenFlight k={item.flight} />
        </p>
      )}
      {p.action === "approve" && p.op && <Actions item={item} actions={[{ type: "inline", op: p.op }]} onDone={onDone} />}
      {p.action === "brake" && item.brake && item.flight && <FlightBrakes p={{ ...item.brake, flight: item.flight }} mode={item.brake.mode} onDone={onDone} />}
      {(item.hand || item.offer) && <Actions item={item} actions={[{ type: "link", label: p.label, hash: p.hash ?? item.hash }]} onDone={onDone} />}
      {children}
    </>
  );
}
