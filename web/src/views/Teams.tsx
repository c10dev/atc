import { useState } from "react";
import type { Snapshot } from "../../../server/model.ts";
import { type Index, projectOf, sortSessions, timeAgo } from "../derive.ts";
import { ClaimRow, StatusDot } from "../ui.tsx";

export function Teams({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const all = sortSessions(snapshot.sessions, idx);
  const visible = showAll ? all : all.filter((s) => s.status === "busy" || idx.claimsBySession.has(s.id));
  const hidden = all.length - visible.length;

  return (
    <section>
      <div className="toolbar">
        <span className="muted">
          세션 {visible.length}개{hidden > 0 && !showAll ? ` · 대기 중인 빈 세션 ${hidden}개 숨김` : ""}
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          모든 세션
        </label>
      </div>
      <div className="team-grid">
        {visible.map((s) => {
          const claims = idx.claimsBySession.get(s.id) ?? [];
          return (
            <article key={s.id} className={`card team is-${s.status}`}>
              <header className="team-head">
                <StatusDot status={s.status} />
                <h3 className="team-name" title={s.name}>
                  {s.name}
                </h3>
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
                        now={now}
                      />
                    );
                  })}
                </ul>
              ) : (
                <p className="empty">점유한 워크트리 없음</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
