import { useState } from "react";
import type { Snapshot, Ticket } from "../../../server/model.ts";
import { alertCode, alertLabel, alertMessage, callsign, flightNumber, flightPhase, phaseCode, phaseTone } from "../aviation.ts";
import { type Index, occupantsOf, timeAgo } from "../derive.ts";
import { PriorityMark, SessionBadge } from "../ui.tsx";

const RECENT_DONE_MS = 3 * 86_400_000;

export function Tickets({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const [showClosed, setShowClosed] = useState(false);

  const columns = snapshot.columns.filter(
    (c) => showClosed || (c.type !== "canceled" && c.type !== "duplicate" && c.type !== "backlog"),
  );
  const keep = (t: Ticket) =>
    showClosed ||
    t.stateType !== "completed" ||
    idx.workspacesByTicket.has(t.key) ||
    (t.updatedAt !== null && now - Date.parse(t.updatedAt) < RECENT_DONE_MS);

  return (
    <section>
      <div className="toolbar">
        <span className="muted">
          {snapshot.linear.enabled
            ? `운항 정보 ${snapshot.linear.fetchedAt ? timeAgo(snapshot.linear.fetchedAt, now) : "불러오는 중"} 갱신 (Linear)`
            : "Linear 미연결 — 브랜치에서 찾은 편만 표시"}
          {snapshot.linear.error && <span className="error"> · {snapshot.linear.error}</span>}
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          운항 예정·지난 도착·결항 포함
        </label>
      </div>
      <div className="board">
        {columns.map((col) => {
          const tickets = snapshot.tickets
            .filter((t) => t.state === col.name && keep(t))
            .sort((a, b) => occupantsOf(b.key, idx).length - occupantsOf(a.key, idx).length || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
          return (
            <div key={col.name} className={`column tone-${phaseTone(col)}`}>
              <header className="column-head" title={col.name}>
                <span className="column-code">{phaseCode[phaseTone(col)]}</span>
                <span className="column-label">{flightPhase(col)}</span>
                {flightPhase(col) !== col.name && <span className="column-alias">{col.name}</span>}
                <span className="count">{String(tickets.length).padStart(2, "0")}</span>
              </header>
              <div className="column-body">
                {tickets.map((t) => (
                  <TicketCard key={t.key} ticket={t} idx={idx} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
      {(occupants.length > 0 || workspaces.length > 0 || t.assignee) && (
        <div className="ticket-foot">
          {occupants.map((s) => (
            <SessionBadge key={s.id} session={s} />
          ))}
          {occupants.length === 0 && workspaces.length > 0 && (
            <span className="tag">STAND {workspaces.length}</span>
          )}
          {t.assignee && <span className="faint ticket-assignee">{t.assignee}</span>}
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

// 공항 출발 안내판처럼 한 글자씩 판에 새긴다.
function SplitFlap({ text, title }: { text: string; title: string }) {
  return (
    <span className="flap" title={title} aria-label={title}>
      {[...text].map((c, i) => (
        <b key={i} aria-hidden>
          {c}
        </b>
      ))}
    </span>
  );
}
