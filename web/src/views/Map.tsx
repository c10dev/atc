import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session, Snapshot, Ticket, Workspace } from "../../../server/model.ts";
import { hasActiveClaim, type Index, sortSessions, timeAgo } from "../derive.ts";
import { AirportCode, AwayTag, SessionPlace } from "../ui.tsx";
import { aircraftStatus, aircraftStatusCode, aircraftStatusLabel, callsign, flightNumber, flightPhase, phaseCode, phaseTone } from "../aviation.ts";

interface Edge {
  from: string;
  to: string;
  kind: "claim" | "handoff" | "ticket";
  color: string;
  dashed: boolean;
}

interface Geometry {
  d: string;
  edge: Edge;
}

const sid = (id: string) => `s:${id}`;
const wid = (path: string) => `w:${path}`;
const tid = (key: string) => `t:${key}`;

const statusColor = { busy: "var(--radar)", idle: "var(--amber)", dead: "var(--alert)" } as const;

export function MapView({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const graph = useMemo(() => layout(snapshot, idx, showAll), [snapshot, idx, showAll]);

  const lit = useMemo(() => {
    if (!hover) return null;
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
      adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
    }
    const seen = new Set([hover]);
    const queue = [hover];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) seen.add(n), queue.push(n);
    return seen;
  }, [hover, graph]);

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<Geometry[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setSize({ w: box.width, h: el.scrollHeight });
      const next: Geometry[] = [];
      for (const edge of graph.edges) {
        const a = nodeRefs.current.get(edge.from)?.getBoundingClientRect();
        const b = nodeRefs.current.get(edge.to)?.getBoundingClientRect();
        if (!a || !b) continue;
        const x1 = a.right - box.left;
        const y1 = a.top + a.height / 2 - box.top;
        const x2 = b.left - box.left;
        const y2 = b.top + b.height / 2 - box.top;
        const mx = (x1 + x2) / 2;
        next.push({ edge, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` });
      }
      setPaths(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [graph]);

  const ref = (id: string) => (node: HTMLElement | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };
  const nodeProps = (id: string) => ({
    ref: ref(id),
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(id),
    onBlur: () => setHover(null),
    tabIndex: 0,
    "data-dim": lit && !lit.has(id) ? "" : undefined,
  });

  return (
    <section>
      <div className="toolbar">
        <span className="muted">
          AIRCRAFT {graph.sessions.length} · STAND {graph.workspaces.length} · FLIGHT {graph.tickets.length}
          <span className="legend">
            <i className="legend-line" /> IDENTIFIED <i className="legend-line is-dashed" /> ESTIMATED TRACK <i className="legend-line is-dotted" /> HANDOFF
          </span>
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          빈 STAND 포함
        </label>
      </div>
      <div className="scope-frame">
      <div className="sweep" aria-hidden />
      <div className="map" ref={containerRef}>
        <svg className="map-lines" width={size.w} height={size.h} aria-hidden>
          {paths.map(({ d, edge }) => {
            const on = !lit || (lit.has(edge.from) && lit.has(edge.to));
            return (
              <path
                key={`${edge.from}>${edge.to}`}
                d={d}
                stroke={edge.color}
                strokeDasharray={edge.kind === "handoff" ? "1 4" : edge.dashed ? "4 4" : undefined}
                className={`${edge.kind === "handoff" ? "is-handoff " : ""}${on ? (lit ? "is-lit" : "") : "is-dim"}`}
              />
            );
          })}
        </svg>

        <div className="map-col">
          <h2 className="label">AIRCRAFT</h2>
          {graph.sessions.map((s) => {
            const status = aircraftStatus(s, hasActiveClaim(idx.claimsBySession.get(s.id)));
            return (
              <div key={s.id} className={`blk ac is-${status}`} title={`${s.name} · ${aircraftStatusLabel[status]}`} {...nodeProps(sid(s.id))}>
                <i className="tgt" aria-label={aircraftStatusLabel[status]} />
                <div className="blk-l1">
                  <strong className="ellipsis">{callsign(s)}</strong>
                  <span className="blk-code">{aircraftStatusCode[status]}</span>
                  <AwayTag airports={idx.awayBySession.get(s.id)} />
                </div>
                <div className="blk-l2">
                  <SessionPlace session={s} idx={idx} /> · {timeAgo(s.lastActiveAt, now)}
                </div>
              </div>
            );
          })}
          {graph.sessions.length === 0 && <p className="empty">STAND를 점유한 AIRCRAFT 없음</p>}
        </div>

        <div className="map-col">
          <h2 className="label">STANDS</h2>
          {graph.workspaces.map((w) => {
            const claimed = hasActiveClaim(idx.claimsByWorkspace.get(w.path));
            const conflict = (idx.alertsByWorkspace.get(w.path) ?? []).some((a) => a.kind === "conflict");
            return (
              <div
                key={w.path}
                className={`blk stand${claimed ? "" : " is-free"}${conflict ? " is-los" : ""}`}
                title={w.path}
                {...nodeProps(wid(w.path))}
              >
                <i className="tgt" />
                <div className="blk-l1">
                  <AirportCode airport={idx.airportByRepo.get(w.repo)} />
                  <strong className="ellipsis">{w.name}</strong>
                  {conflict && <span className="los-tag" title="LOSS OF SEPARATION">LOS</span>}
                  {w.dirty ? <span className="dirty" title={`변경 파일 ${w.dirty}개`}>Δ{w.dirty}</span> : null}
                </div>
                <div className="blk-l2">{w.branch ?? `detached ${w.head}`}</div>
              </div>
            );
          })}
        </div>

        <div className="map-col">
          <h2 className="label">FLIGHT PLANS</h2>
          {graph.tickets.map((t) => {
            const noContact = (idx.alertsByTicket.get(t.key) ?? []).some((a) => a.kind === "no-workspace");
            const tone = phaseTone(t);
            return (
              <a
                key={t.key}
                className={`blk fp tone-${tone}${noContact ? " is-nocontact" : ""}`}
                href={t.url ?? undefined}
                title={`${t.key} · ${t.state}`}
                target="_blank"
                rel="noreferrer"
                {...nodeProps(tid(t.key))}
              >
                <i className="tgt" />
                <div className="blk-l1">
                  <strong>{flightNumber(t.key)}</strong>
                  {noContact ? (
                    <span className="nc" title="ENROUTE인데 STAND(워크트리)가 없음">NO CONTACT</span>
                  ) : (
                    <span className="ph">
                      {phaseCode[tone]}
                      {flightPhase(t) !== phaseCode[tone] && <> <em>{flightPhase(t)}</em></>}
                    </span>
                  )}
                </div>
                <div className="blk-l2 sans">{t.title}</div>
              </a>
            );
          })}
        </div>
      </div>
      </div>
    </section>
  );
}

// 교차를 줄이려고 왼쪽 열 순서의 평균(barycenter)으로 다음 열을 정렬한다.
function layout(snapshot: Snapshot, idx: Index, showAll: boolean) {
  const sessions = sortSessions(
    snapshot.sessions.filter((s) => idx.claimsBySession.has(s.id)),
    idx,
  );
  const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));

  const wsSet = new Set<Workspace>();
  for (const w of snapshot.workspaces) {
    if (w.isMain) continue;
    const ticket = w.ticketKey ? idx.ticketByKey.get(w.ticketKey) : undefined;
    if (showAll || idx.claimsByWorkspace.has(w.path) || ticket?.stateType === "started") wsSet.add(w);
  }
  const wsRank = (w: Workspace) => {
    const ranks = (idx.claimsByWorkspace.get(w.path) ?? []).map((c) => sessionOrder.get(c.sessionId) ?? 0);
    return ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : Infinity;
  };
  const workspaces = [...wsSet].sort((a, b) => wsRank(a) - wsRank(b) || a.name.localeCompare(b.name));
  const wsOrder = new Map(workspaces.map((w, i) => [w.path, i]));

  const ticketSet = new Map<string, Ticket>();
  for (const w of workspaces) {
    const t = w.ticketKey ? idx.ticketByKey.get(w.ticketKey) : undefined;
    if (t) ticketSet.set(t.key, t);
  }
  for (const t of snapshot.tickets) if (t.stateType === "started") ticketSet.set(t.key, t);
  const tRank = (t: Ticket) => {
    const ranks = (idx.workspacesByTicket.get(t.key) ?? []).map((w) => wsOrder.get(w.path)).filter((x) => x !== undefined);
    return ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : Infinity;
  };
  const tickets = [...ticketSet.values()].sort((a, b) => tRank(a) - tRank(b) || a.key.localeCompare(b.key));

  const edges: Edge[] = [];
  for (const c of snapshot.claims) {
    const s = idx.sessionById.get(c.sessionId) as Session | undefined;
    if (!s || !wsOrder.has(c.workspacePath)) continue;
    const handedOff = c.state === "handed-off";
    edges.push({
      from: sid(s.id),
      to: wid(c.workspacePath),
      kind: handedOff ? "handoff" : "claim",
      color: handedOff ? "var(--faint)" : statusColor[s.status],
      dashed: c.source === "transcript",
    });
  }
  for (const w of workspaces) {
    const t = w.ticketKey ? ticketSet.get(w.ticketKey) : undefined;
    if (t) edges.push({ from: wid(w.path), to: tid(t.key), kind: "ticket", color: `var(--phase-${phaseTone(t)})`, dashed: false });
  }
  return { sessions, workspaces, tickets, edges };
}
