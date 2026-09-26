import { useState } from "react";
import type { Snapshot } from "../../../server/model.ts";
import { aircraftStatus, aircraftStatusLabel, callsign } from "../aviation.ts";
import { activeFirst, hasActiveClaim, type Index, projectOf, sortSessions, timeAgo } from "../derive.ts";
import { ClaimRow, StatusDot } from "../ui.tsx";

export function Teams({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const all = sortSessions(snapshot.sessions, idx);
  const visible = showAll ? all : all.filter((s) => s.status === "busy" || idx.claimsBySession.has(s.id));
  const hidden = all.length - visible.length;
  const nameOf = (id: string) => {
    const s = idx.sessionById.get(id);
    return s ? callsign(s) : id.slice(0, 8);
  };

  return (
    <section>
      <div className="toolbar">
        <span className="muted">
          항공기 {visible.length}대{hidden > 0 && !showAll ? ` · 주기 중인 ${hidden}대 숨김` : ""}
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          주기 중인 항공기 포함
        </label>
      </div>
      <div className="team-grid">
        {visible.map((s) => {
          const claims = activeFirst(idx.claimsBySession.get(s.id) ?? []);
          const status = aircraftStatus(s, hasActiveClaim(claims));
          const sign = callsign(s);
          return (
            <article key={s.id} className={`card team is-${s.status}`}>
              <header className="team-head">
                <StatusDot status={s.status} label={aircraftStatusLabel[status]} />
                <h3 className="team-name" title={s.name}>
                  {sign}
                  {sign !== s.name && <span className="team-alias">{s.name}</span>}
                </h3>
                <span className={`phase phase-${status}`}>{aircraftStatusLabel[status]}</span>
                <span className={`agent agent-${s.agent}`}>{s.agent}</span>
              </header>
              <div className="team-sub muted">
                <span className="mono">{projectOf(s.cwd)}</span>
                <span>· {timeAgo(s.lastActiveAt, now)}</span>
              </div>
              {claims.length ? (
                <ul className="claims">
                  {claims.map((c) => {
                    const ws = idx.wsByPath.get(c.workspacePath);
                    return (
                      <ClaimRow
                        key={c.workspacePath}
                        claim={c}
                        workspace={ws}
                        ticket={ws?.ticketKey ? idx.ticketByKey.get(ws.ticketKey) : undefined}
                        handedOffTo={c.handedOffTo ? nameOf(c.handedOffTo) : undefined}
                        now={now}
                      />
                    );
                  })}
                </ul>
              ) : (
                <p className="empty">배정된 주기장 없음</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
