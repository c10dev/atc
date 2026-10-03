import { lazy, Suspense, useEffect, useState } from "react";
import type { Snapshot } from "../../../server/model.ts";
import type { Index } from "../derive.ts";
import { TabLoading } from "../lazyTab.tsx";
import { VIEWS, type FlightsView, viewOfHash } from "../legacy-hash.ts";
import { Follow } from "./Follow.tsx";
import { FlightsLanding, Teams } from "./Teams.tsx";
import "./Flights.css";

// FLIGHTS(`#flights`, ATC-379, docs/layout.md Y4): 같은 FLIGHT들을 보는 한 화면. 목록(FOLLOW의 줄, 기본)·보드(FIDS)·레이더(RADAR)는 같은 FLIGHT의 다른 보기이고,
// 새 사실은 없다: 탭이 읽던 자료를 그대로 읽고 보기만 한 화면에 모았다. RADIO는 레일 화면이 됐다(ATC-446, `#radio`).
// 옛 주소 #follow·#strips·#board·#radar는 App의 canonicalHash가 이 화면의 보기로 바꾼다.
const MapView = lazy(() => import("./Map.tsx").then((m) => ({ default: m.MapView })));
const Tickets = lazy(() => import("./Tickets.tsx").then((m) => ({ default: m.Tickets })));

export function Flights({ snapshot, idx, now, refreshKey }: { snapshot: Snapshot; idx: Index; now: number; refreshKey: string }) {
  const [view, setView] = useState<FlightsView>(() => viewOfHash(location.hash));
  useEffect(() => {
    const onHash = () => setView(viewOfHash(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const go = (v: (typeof VIEWS)[number]) => {
    setView(v.id);
    history.replaceState(null, "", `#${v.hash}`);
  };
  return (
    <section className="flights" aria-label="FLIGHTS">
      <nav className="fl-views" role="tablist" aria-label="FLIGHTS 보기">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className="fl-view" onClick={() => go(v)}>
            {v.label}
          </button>
        ))}
      </nav>
      {view === "list" && (
        <>
          <Follow refreshKey={refreshKey} now={now} pulls={snapshot.pulls ?? []} />
          <FlightsLanding snapshot={snapshot} idx={idx} />
          <details className="fl-strips">
            <summary className="label">AIRCRAFT STRIPS</summary>
            <Teams snapshot={snapshot} idx={idx} now={now} />
          </details>
        </>
      )}
      <Suspense fallback={<TabLoading />}>
        {view === "board" && <Tickets snapshot={snapshot} idx={idx} now={now} />}
        {view === "radar" && <MapView snapshot={snapshot} idx={idx} now={now} />}
      </Suspense>
    </section>
  );
}
