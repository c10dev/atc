import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session, Snapshot, Ticket, Workspace } from "../../../server/model.ts";
import { hasActiveClaim, type Index, projectOf, sortSessions, timeAgo } from "../derive.ts";
import { aircraftStatus, aircraftStatusLabel, callsign, flightNumber, flightPhase } from "../aviation.ts";
import { StatusDot } from "../ui.tsx";

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

const statusColor = { busy: "var(--busy)", idle: "var(--idle-line)", dead: "var(--dead)" } as const;

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
          항공기 {graph.sessions.length} · 주기장 {graph.workspaces.length} · 편 {graph.tickets.length}
          <span className="legend">
            <i className="legend-line" /> 관제 확인 <i className="legend-line is-dashed" /> 추정 항적 <i className="legend-line is-dotted" /> 관제 이양
          </span>
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          빈 주기장 포함
        </label>
      </div>
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
          <h2 className="map-col-title">항공기 · 세션</h2>
          {graph.sessions.map((s) => (
            <div key={s.id} className={`map-node node-session is-${s.status}`} title={s.name} {...nodeProps(sid(s.id))}>
              <div className="map-node-row">
                <StatusDot status={s.status} label={aircraftStatusLabel[aircraftStatus(s, hasActiveClaim(idx.claimsBySession.get(s.id)))]} />
                <strong className="ellipsis">{callsign(s)}</strong>
                <span className="faint">{aircraftStatusLabel[aircraftStatus(s, hasActiveClaim(idx.claimsBySession.get(s.id)))]}</span>
              </div>
              <div className="map-node-sub">
                <span className="mono">{projectOf(s.cwd)}</span> · {timeAgo(s.lastActiveAt, now)}
              </div>
            </div>
          ))}
          {graph.sessions.length === 0 && <p className="empty">주기장을 점유한 항공기 없음</p>}
        </div>

        <div className="map-col">
          <h2 className="map-col-title">주기장 · 워크트리</h2>
          {graph.workspaces.map((w) => {
            const claimed = hasActiveClaim(idx.claimsByWorkspace.get(w.path));
            const alerts = idx.alertsByWorkspace.get(w.path) ?? [];
            return (
              <div
                key={w.path}
                className={`map-node node-ws${claimed ? "" : " is-free"}${alerts.some((a) => a.kind === "conflict") ? " is-conflict" : ""}`}
                title={w.path}
                {...nodeProps(wid(w.path))}
              >
                <div className="map-node-row">
                  <strong className="mono ellipsis">{w.name}</strong>
                  {w.dirty ? <span className="tag tag-warn">변경 {w.dirty}</span> : null}
                </div>
                <div className="map-node-sub mono ellipsis">{w.branch ?? `detached ${w.head}`}</div>
              </div>
            );
          })}
        </div>

        <div className="map-col">
          <h2 className="map-col-title">비행계획 · 티켓</h2>
          {graph.tickets.map((t) => (
            <a
              key={t.key}
              className={`map-node node-ticket${idx.alertsByTicket.has(t.key) ? " is-orphan" : ""}`}
              href={t.url ?? undefined}
              title={`${t.key} · ${t.state}`}
              target="_blank"
              rel="noreferrer"
              {...nodeProps(tid(t.key))}
            >
              <div className="map-node-row">
                <span className="column-dot" style={{ background: t.stateColor ?? "var(--faint)" }} />
                <strong className="mono">{flightNumber(t.key)}</strong>
                <span className="faint">{flightPhase(t)}</span>
              </div>
              <div className="map-node-sub ellipsis">{t.title}</div>
            </a>
          ))}
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
    if (t) edges.push({ from: wid(w.path), to: tid(t.key), kind: "ticket", color: t.stateColor ?? "var(--faint)", dashed: false });
  }
  return { sessions, workspaces, tickets, edges };
}
