import type { ReactNode } from "react";
import { elapsedText, type FleetRow } from "../../../../server/fleet-status.ts";
import { flightNumber } from "../../aviation.ts";
import { timeAgo } from "../../derive.ts";
import { ContextCell } from "./Context.tsx";
import { pct } from "./shared.ts";
import "./StatusList.css";

// 운항 상태 목록(ATC-44). 한 줄: REGISTRATION·callsign, AIRPORT, 상태, FLYING FLIGHT, 경과, 마지막 활동, 이번 주.
// 줄(버튼)을 누르면 아래에 그 AIRCRAFT의 카드가 펼쳐진다(키보드로도)
export function StatusList({ rows, open, onToggle, detail }: { rows: FleetRow[]; open: ReadonlySet<string>; onToggle: (reg: string) => void; detail: (reg: string) => ReactNode }) {
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
        <span>FOB</span>
        <span>FUEL 14일</span>
        <span />
      </div>
      <ul className="fl-rows">
        {rows.map((r) => {
          const isOpen = open.has(r.registration);
          return (
            <li key={r.registration} className={`fl-li st-${r.status.replace(/ /g, "-")}${r.health || r.accountHold || r.fuelHold ? " has-health" : ""}${isOpen ? " is-open" : ""}`}>
              <button className="fl-row" aria-expanded={isOpen} aria-controls={`fl-detail-${r.registration}`} onClick={() => onToggle(r.registration)}>
                <span className="fl-r-id">
                  <b>{r.callsign}</b> <span className="mono faint">{r.registration}</span>
                  {r.account && !r.accountIsDefault && (
                    <span className="fl-r-acct mono" title={`ACCOUNT ${r.account} — 사용 한도를 같이 쓰는 AIRCRAFT 묶음`}>
                      {r.account}
                    </span>
                  )}
                  {r.name && (
                    <span className={`fl-r-name${r.name.conflict ? " is-conflict" : ""}`} title={r.name.title}>
                      {r.name.label}
                    </span>
                  )}
                </span>
                <span className="fl-r-apt">{r.airport ? <span className="apt">{r.airport}</span> : <span className="faint">—</span>}</span>
                <span className="fl-r-status">{r.status}</span>
                <span className="fl-r-flight" title={r.flight ? `${r.flight.key}${r.flight.title ? ` ${r.flight.title}` : ""}${r.more ? ` 외 ${r.more}건` : ""}` : undefined}>
                  {r.health && (
                    <span className={`fl-r-health lv-${r.health.level}`} title={`${r.health.detail} — ${r.health.next}`}>
                      {r.health.label}
                    </span>
                  )}
                  {r.accountHold && (
                    <span className="fl-r-health lv-hold" title={`${r.accountHold.detail} — ${r.accountHold.next}`}>
                      {r.accountHold.label}
                    </span>
                  )}
                  {r.fuelHold && (
                    <span className="fl-r-health lv-hold" title={r.fuelHold.title}>
                      {r.fuelHold.label}
                    </span>
                  )}
                  {r.flight ? (
                    <>
                      <b className="mono">{flightNumber(r.flight.key)}</b> {r.flight.title && <span className="fl-r-title">{r.flight.title}</span>}
                      {r.more > 0 && <span className="fl-r-more">+{r.more}</span>}
                    </>
                  ) : r.health || r.accountHold || r.fuelHold ? null : (
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
                <ContextCell c={r.context} />
                <span className="fl-r-burn mono" title={r.fuelBurn?.title ?? "최근 14일 fuel이 있는 ARRIVED FLIGHT 없음(옛 LOGBOOK 줄에는 fuel이 없다)"}>
                  {r.fuelBurn ? r.fuelBurn.label.replace(/^FUEL /, "") : <span className="faint">FUEL —</span>}
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
