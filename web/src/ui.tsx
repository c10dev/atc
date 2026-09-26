import type { Claim, Session, Ticket, Workspace } from "../../server/model.ts";
import { callsign, flightNumber, flightPhase } from "./aviation.ts";
import { timeAgo } from "./derive.ts";

const statusLabel = { busy: "비행 중", idle: "대기", dead: "무선 두절" } as const;

export function StatusDot({ status, label }: { status: Session["status"]; label?: string }) {
  const text = label ?? statusLabel[status];
  return <span className={`dot dot-${status}`} title={text} aria-label={text} />;
}

export function SessionBadge({ session }: { session: Session }) {
  return (
    <span className={`session-badge is-${session.status}`} title={session.name}>
      <StatusDot status={session.status} />
      {callsign(session)}
    </span>
  );
}

export function TicketChip({ ticket, ticketKey }: { ticket?: Ticket; ticketKey: string }) {
  const color = ticket?.stateColor ?? "var(--faint)";
  const inner = (
    <>
      <span className="ticket-chip-state" style={{ background: color }} />
      <span className="mono">{flightNumber(ticketKey)}</span>
      {ticket && <span className="ticket-chip-name">{flightPhase(ticket)}</span>}
    </>
  );
  return ticket?.url ? (
    <a
      className="ticket-chip"
      href={ticket.url}
      target="_blank"
      rel="noreferrer"
      title={`${ticketKey} · ${ticket.state} · ${ticket.title}`}
    >
      {inner}
    </a>
  ) : (
    <span className="ticket-chip" title={ticket ? `${ticketKey} · ${ticket.state} · ${ticket.title}` : ticketKey}>
      {inner}
    </span>
  );
}

const sourceLabel = { hook: null, cwd: "cwd", transcript: "추정 항적" } as const;

export function ClaimRow({
  claim,
  workspace,
  ticket,
  handedOffTo,
  now,
}: {
  claim: Claim;
  workspace?: Workspace;
  ticket?: Ticket;
  handedOffTo?: string;
  now: number;
}) {
  const label = sourceLabel[claim.source];
  const handedOff = claim.state === "handed-off";
  return (
    <li className={`claim is-${claim.source}${handedOff ? " is-handed-off" : ""}`}>
      <div className="claim-head">
        <span className="mono claim-ws" title={claim.workspacePath}>
          {workspace?.name ?? claim.workspacePath.split("/").pop()}
        </span>
        {handedOff && <span className="tag tag-handoff">→ {handedOffTo ?? "?"} 이양</span>}
        {label && <span className="tag">{label}</span>}
        <span className="claim-time">{timeAgo(claim.lastAt, now)}</span>
      </div>
      <div className="claim-meta">
        {workspace?.ticketKey && <TicketChip ticketKey={workspace.ticketKey} ticket={ticket} />}
        {workspace?.branch && <span className="mono faint claim-branch">{workspace.branch}</span>}
        {workspace?.dirty ? <span className="tag tag-warn">변경 {workspace.dirty}</span> : null}
      </div>
      {ticket && <div className="claim-title">{ticket.title}</div>}
    </li>
  );
}

// Linear 우선순위: 1 긴급, 2 높음, 3 보통, 4 낮음. 막대 수로 표시한다.
const PRIORITY = [null, { label: "긴급", bars: 0 }, { label: "높음", bars: 3 }, { label: "보통", bars: 2 }, { label: "낮음", bars: 1 }];

export function PriorityMark({ priority }: { priority: number }) {
  const p = PRIORITY[priority];
  if (!p) return null;
  return (
    <span className={`prio prio-${priority}`} title={`우선순위 ${p.label}`} aria-label={`우선순위 ${p.label}`}>
      {p.bars === 0 ? "!" : [1, 2, 3].map((i) => <i key={i} className={i <= p.bars ? "on" : ""} />)}
    </span>
  );
}
