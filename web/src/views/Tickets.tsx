import { useEffect, useRef, useState } from "react";
import { fidsRows, FIDS_ARRIVED_CAP } from "../fids-rows.ts";
import type { Snapshot, Ticket, TicketColumn } from "../../../server/model.ts";
import {
  alertCode,
  alertLabel,
  alertMessage,
  callsign,
  flightNumber,
  flightPhase,
  type PhaseTone,
  phaseTone,
} from "../aviation.ts";
import { type Index, occupantsOf, timeAgo } from "../derive.ts";
import { formatClock, type Settings, updateSettings, useSettings } from "../settings.ts";
import { SplitFlap } from "../SplitFlap.tsx";
import { AirportCode, PriorityMark, SessionBadge } from "../ui.tsx";

// DEPARTURES 순서: 곧 LANDING할 FLIGHT가 위로
const LIST_ORDER: PhaseTone[] = ["cleared", "approach", "enroute", "filed", "triage", "scheduled", "arrived", "canceled"];

export function Tickets({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const settings = useSettings();
  const showClosed = settings.fidsClosed;

  const columns = snapshot.columns.filter(
    (c) => showClosed || (c.type !== "canceled" && c.type !== "duplicate" && c.type !== "backlog"),
  );
  const shownStates = new Set(columns.map((c) => c.name));
  // ARRIVED는 최근 FIDS_ARRIVED_CAP개와 STAND가 남은 것만(ATC-112). "more" 줄을 누르면 그 자리에서 ARRIVED 전체(이 화면에서만, 저장하지 않음). fidsClosed는 전부(전과 같다)
  const [arrivedOpen, setArrivedOpen] = useState(false);
  const { rows, moreArrived } = fidsRows(snapshot.tickets.filter((t) => shownStates.has(t.state)), idx, showClosed || arrivedOpen);
  const more = { count: moreArrived, open: arrivedOpen && !showClosed, toggle: () => setArrivedOpen((v) => !v) };
  const lastDone = columns.filter((c) => c.type === "completed").at(-1)?.name;
  const byActivity = (a: Ticket, b: Ticket) =>
    occupantsOf(b.key, idx).length - occupantsOf(a.key, idx).length || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

  return (
    <section>
      <div className="toolbar">
        <span className="muted">
          {snapshot.linear.enabled
            ? `FIDS ${snapshot.linear.fetchedAt ? timeAgo(snapshot.linear.fetchedAt, now) : "불러오는 중"} 갱신 (Linear)`
            : "Linear 미연결 — 브랜치에서 찾은 편만 표시"}
          {snapshot.linear.error && <span className="error"> · {snapshot.linear.error}</span>}
        </span>
        <ViewOptions settings={settings} />
      </div>
      {settings.fidsView === "list" ? (
        <DepartureBoard
          more={more}
          tickets={[...rows]
            .sort((a, b) => LIST_ORDER.indexOf(phaseTone(a)) - LIST_ORDER.indexOf(phaseTone(b)) || byActivity(a, b))}
          idx={idx}
          clock={settings.clock}
          now={now}
        />
      ) : (
        <div className="board">
          {columns.map((col) => (
            <Column key={col.name} col={col} tickets={rows.filter((t) => t.state === col.name).sort(byActivity)} idx={idx} more={col.name === lastDone ? more : undefined} />
          ))}
        </div>
      )}
    </section>
  );
}

// ARRIVED "more" 줄(ATC-112): 가려진 수를 알리고 그 자리에서 펼친다(펼친 뒤엔 다시 접는다)
interface MoreArrived {
  count: number;
  open: boolean;
  toggle: () => void;
}
function MoreButton({ more }: { more: MoreArrived }) {
  return (
    <button type="button" className="fids-more-btn" aria-expanded={more.open} onClick={more.toggle}>
      {more.open ? `ARRIVED 최근 ${FIDS_ARRIVED_CAP}건만 · 접기` : `ARRIVED ${more.count} more · 전체 보기`}
    </button>
  );
}

// 표시 옵션: 목록/보드 전환과 표시 범위. 바깥을 누르거나 Esc로 닫는다.
function ViewOptions({ settings }: { settings: Settings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onPointer);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="view-options" ref={ref}>
      <button
        className="icon-button"
        aria-label="표시 옵션"
        title="표시 옵션"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersIcon />
      </button>
      {open && (
        <div className="view-menu" role="dialog" aria-label="표시 옵션">
          <div className="view-switch" role="radiogroup" aria-label="보기">
            {(
              [
                ["list", "List", <ListIcon key="i" />],
                ["board", "Board", <BoardIcon key="i" />],
              ] as const
            ).map(([id, label, icon]) => (
              <button key={id} role="radio" aria-checked={settings.fidsView === id} onClick={() => updateSettings({ fidsView: id })}>
                {icon}
                {label}
              </button>
            ))}
          </div>
          <p className="view-menu-hint">
            {settings.fidsView === "list" ? "DEPARTURES 안내판처럼 한 줄에 FLIGHT 하나, 곧 LANDING할 FLIGHT부터" : "비행 단계별 열"}
          </p>
          <label className="toggle view-menu-row">
            <input type="checkbox" checked={settings.fidsClosed} onChange={(e) => updateSettings({ fidsClosed: e.target.checked })} />
            SCHEDULED · ARRIVED · CANCELLED 포함
          </label>
        </div>
      )}
    </div>
  );
}

// 목록 보기: 실제 DEPARTURES 안내판. TIME · FLIGHT · DESTINATION · AIRCRAFT · STAND · PRI · REMARKS
function DepartureBoard({ tickets, idx, clock, now, more }: { tickets: Ticket[]; idx: Index; clock: Settings["clock"]; now: number; more: MoreArrived }) {
  return (
    <div className="fids-list">
      <header className="fids-list-head">
        <span className="fids-list-title">DEPARTURES</span>
        <span className="fids-list-meta">
          <SplitFlap bare text={String(tickets.length).padStart(2, "0")} /> FLIGHTS ·{" "}
          <SplitFlap bare text={formatClock(now, clock)} />
        </span>
      </header>
      <div className="fids-table-wrap">
        <table className="fids-table">
          <thead>
            <tr>
              <th className="col-time">
                TIME
              </th>
              <th>
                FLIGHT
              </th>
              <th>
                DESTINATION
              </th>
              <th>
                AIRCRAFT
              </th>
              <th className="col-stand">
                STAND
              </th>
              <th className="col-pri">PRI</th>
              <th>
                REMARKS
              </th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <DepartureRow key={t.key} ticket={t} idx={idx} clock={clock} />
            ))}
            {(more.count > 0 || more.open) && (
              <tr className="fids-more">
                <td colSpan={7}>
                  <MoreButton more={more} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {tickets.length === 0 && <p className="empty fids-empty">표시할 편이 없음</p>}
      </div>
    </div>
  );
}

function DepartureRow({ ticket: t, idx, clock }: { ticket: Ticket; idx: Index; clock: Settings["clock"] }) {
  const occupants = occupantsOf(t.key, idx);
  const workspaces = idx.workspacesByTicket.get(t.key) ?? [];
  const alerts = idx.alertsByTicket.get(t.key) ?? [];
  const noContact = alerts.some((a) => a.kind === "no-workspace");
  const tone = phaseTone(t);
  const stand = workspaces[0];
  return (
    <tr className={`tone-${tone}${occupants.length ? " is-occupied" : ""}`}>
      <td className="col-time mono">
        <SplitFlap bare text={t.updatedAt ? formatClock(t.updatedAt, clock) : "—"} />
      </td>
      <td>
        <SplitFlap text={flightNumber(t.key)} title={t.key} />
      </td>
      <td className="fids-dest">
        {t.url ? (
          <a href={t.url} target="_blank" rel="noreferrer" title={t.title}>
            {t.title}
          </a>
        ) : (
          <span title={t.title}>{t.title}</span>
        )}
      </td>
      <td className="fids-aircraft">
        {occupants.length ? occupants.map((s) => <SessionBadge key={s.id} session={s} />) : <span className="none">—</span>}
      </td>
      <td className="col-stand mono" title={workspaces.map((w) => w.path).join("\n")}>
        {stand ? (
          <>
            <AirportCode airport={idx.airportByRepo.get(stand.repo)} /> {stand.name}
            {workspaces.length > 1 && <span className="faint"> +{workspaces.length - 1}</span>}
          </>
        ) : (
          <span className="none">—</span>
        )}
      </td>
      <td className="col-pri">
        <PriorityMark priority={t.priority} />
      </td>
      <td className="fids-remark">
        <span className="remark" title={t.state}>
          <SplitFlap bare text={flightPhase(t)} />
        </span>
        {noContact && (
          <span className="code-chip alert-no-workspace" title={alertMessage(alerts.find((a) => a.kind === "no-workspace")!, (id) => id)}>
            NO CONTACT
          </span>
        )}
      </td>
    </tr>
  );
}

function Column({ col, tickets, idx, more }: { col: TicketColumn; tickets: Ticket[]; idx: Index; more?: MoreArrived }) {
  return (
    <div className={`column tone-${phaseTone(col)}`}>
      <header className="column-head" title={col.name}>
        <span className="column-code">{flightPhase(col)}</span>
        {flightPhase(col).toLowerCase() !== col.name.toLowerCase() && <span className="column-alias">{col.name}</span>}
        <span className="count">{String(tickets.length).padStart(2, "0")}</span>
      </header>
      <div className="column-body">
        {tickets.map((t) => (
          <TicketCard key={t.key} ticket={t} idx={idx} />
        ))}
        {more && (more.count > 0 || more.open) && <MoreButton more={more} />}
      </div>
    </div>
  );
}

function TicketCard({ ticket: t, idx }: { ticket: Ticket; idx: Index }) {
  const occupants = occupantsOf(t.key, idx);
  const workspaces = idx.workspacesByTicket.get(t.key) ?? [];
  const alerts = idx.alertsByTicket.get(t.key) ?? [];
  const body = (
    <>
      <div className="ticket-top">
        <SplitFlap text={flightNumber(t.key)} title={t.key} />
        <PriorityMark priority={t.priority} />
      </div>
      <div className="ticket-title">{t.title}</div>
      {(occupants.length > 0 || workspaces.length > 0 || t.assignee || t.takenBy) && (
        <div className="ticket-foot">
          {occupants.map((s) => (
            <SessionBadge key={s.id} session={s} />
          ))}
          {occupants.length === 0 && workspaces.length > 0 && <span className="tag">STAND {workspaces.length}</span>}
          {t.assignee && <span className="faint ticket-assignee">{t.assignee}</span>}
          {/* 위임 대상(Codex 등)은 담당자와 다를 때만 따로 보인다. DISPATCH가 배정하지 않는 FLIGHT다 */}
          {t.takenBy && t.takenBy !== t.assignee && (
            <span className="faint ticket-assignee" title="Linear 위임 — atc 밖에서 맡음, DISPATCH가 배정하지 않음">→ {t.takenBy}</span>
          )}
        </div>
      )}
      {alerts.map((a) => (
        <div key={a.kind} className={`ticket-alert alert-${a.kind}`}>
          <span className="code-chip">{alertCode[a.kind]}</span>
          {alertLabel[a.kind]} · {alertMessage(a, (id) => callsign(idx.sessionById.get(id) ?? { name: id }))}
        </div>
      ))}
    </>
  );
  const cls = `ticket${occupants.length ? " is-occupied" : ""}`;
  return t.url ? (
    <a className={cls} href={t.url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M2 4.5h12M2 11.5h12" />
      </g>
      <circle cx="5.5" cy="4.5" r="1.8" fill="var(--chrome)" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.5" cy="11.5" r="1.8" fill="var(--chrome)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <g fill="currentColor">
        <rect x="2" y="2" width="5" height="5" rx="1.2" />
        <rect x="9" y="2" width="5" height="5" rx="1.2" />
        <rect x="2" y="9" width="5" height="5" rx="1.2" />
        <rect x="9" y="9" width="5" height="5" rx="1.2" />
      </g>
    </svg>
  );
}
