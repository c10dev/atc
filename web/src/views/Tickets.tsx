import { useState } from "react";
import type { Snapshot, Ticket } from "../../../server/model.ts";
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
            ? `Linear ${snapshot.linear.fetchedAt ? timeAgo(snapshot.linear.fetchedAt, now) : "불러오는 중"} 갱신`
            : "Linear 미연결 — 브랜치에서 찾은 티켓만 표시"}
          {snapshot.linear.error && <span className="error"> · {snapshot.linear.error}</span>}
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Backlog·지난 완료·취소 포함
        </label>
      </div>
      <div className="board">
        {columns.map((col) => {
          const tickets = snapshot.tickets
            .filter((t) => t.state === col.name && keep(t))
            .sort((a, b) => occupantsOf(b.key, idx).length - occupantsOf(a.key, idx).length || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
          return (
            <div key={col.name} className="column">
              <header className="column-head">
                <span className="column-dot" style={{ background: col.color ?? "var(--faint)" }} />
                {col.name}
                <span className="count">{tickets.length}</span>
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
        <span className="mono faint">{t.key}</span>
        <PriorityMark priority={t.priority} />
      </div>
      <div className="ticket-title">{t.title}</div>
      {(occupants.length > 0 || workspaces.length > 0 || t.assignee) && (
        <div className="ticket-foot">
          {occupants.map((s) => (
            <SessionBadge key={s.id} session={s} />
          ))}
          {occupants.length === 0 && workspaces.length > 0 && (
            <span className="tag">워크트리 {workspaces.length}</span>
          )}
          {t.assignee && <span className="faint ticket-assignee">{t.assignee}</span>}
        </div>
      )}
      {alerts.map((a) => (
        <div key={a.kind} className="ticket-alert">
          {a.message}
        </div>
      ))}
    </>
  );
  const cls = `card ticket${occupants.length ? " is-occupied" : ""}`;
  return t.url ? (
    <a className={cls} href={t.url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
