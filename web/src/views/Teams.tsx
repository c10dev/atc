import { useState } from "react";
import type { Claim, Clearance, Session, Snapshot } from "../../../server/model.ts";
import {
  type AircraftStatus,
  aircraftStatus,
  aircraftStatusCode,
  aircraftStatusLabel,
  callsign,
  flightNumber,
  flightPhase,
} from "../aviation.ts";
import { activeFirst, hasActiveClaim, type Index, sortSessions, timeAgo } from "../derive.ts";
import { formatClock, useSettings } from "../settings.ts";
import { AirportCode, AwayTag, SessionPlace } from "../ui.tsx";

const BAYS: AircraftStatus[] = ["airborne", "holding", "nordo", "parked"];
const agentCode = { claude: "CLD", codex: "CDX" } as const;

export function Teams({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const all = sortSessions(snapshot.sessions, idx);
  const visible = showAll ? all : all.filter((s) => s.status === "busy" || idx.claimsBySession.has(s.id));
  const hidden = all.length - visible.length;
  const nameOf = (id: string) => {
    const s = idx.sessionById.get(id);
    return s ? callsign(s) : id.slice(0, 8);
  };

  const bays = new Map<AircraftStatus, Session[]>(BAYS.map((b) => [b, []]));
  for (const s of visible) bays.get(aircraftStatus(s, hasActiveClaim(idx.claimsBySession.get(s.id))))!.push(s);

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
      {BAYS.map((bay) => {
        const sessions = bays.get(bay)!;
        if (!sessions.length) return null;
        return (
          <div key={bay} className={`bay bay-${bay}`}>
            <h2 className="label">
              {aircraftStatusCode[bay]}{" "}
              <em>
                {aircraftStatusLabel[bay]} · {sessions.length}
              </em>
            </h2>
            <div className="bay-rail">
              {sessions.map((s) => (
                <Strip
                  key={s.id}
                  session={s}
                  status={bay}
                  idx={idx}
                  now={now}
                  nameOf={nameOf}
                  clearances={snapshot.clearances.filter((c) => c.to === s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Strip({
  session: s,
  status,
  idx,
  now,
  nameOf,
  clearances,
}: {
  session: Session;
  status: AircraftStatus;
  idx: Index;
  now: number;
  nameOf: (id: string) => string;
  clearances: Clearance[];
}) {
  const { clock } = useSettings();
  const claims = activeFirst(idx.claimsBySession.get(s.id) ?? []);
  const sign = callsign(s);
  const conflicts = (c: Claim) =>
    c.state === "active" && (idx.alertsByWorkspace.get(c.workspacePath) ?? []).some((a) => a.kind === "conflict");
  const los = claims.some(conflicts);

  return (
    <article className={`strip is-${status}${los ? " is-los" : ""}`}>
      <div className="holder" title={aircraftStatusLabel[status]} />
      <div className="strip-id">
        <div className="cs" title={s.name}>
          {sign}
          <span className="type">{agentCode[s.agent]}</span>
          <AwayTag airports={idx.awayBySession.get(s.id)} />
        </div>
        <div className="sub">
          {sign !== s.name && `${s.name} · `}
          <SessionPlace session={s} idx={idx} /> · {timeAgo(s.lastActiveAt, now)}
        </div>
        <ClearanceStamps clearances={clearances} now={now} />
      </div>
      <div className="strip-legs">
        {claims.length ? (
          claims.map((c) => {
            const ws = idx.wsByPath.get(c.workspacePath);
            const ticket = ws?.ticketKey ? idx.ticketByKey.get(ws.ticketKey) : undefined;
            const others = conflicts(c)
              ? (idx.claimsByWorkspace.get(c.workspacePath) ?? [])
                  .filter((o) => o.sessionId !== s.id && o.state === "active")
                  .map((o) => nameOf(o.sessionId))
              : [];
            return (
              <div key={c.workspacePath} className={`leg${c.state === "handed-off" ? " is-handed-off" : ""}`}>
                <div className="cell">
                  <span className="cap">STAND 주기장</span>
                  <div className="val" title={c.workspacePath}>
                    <AirportCode airport={ws ? idx.airportByRepo.get(ws.repo) : undefined} />{" "}
                    {ws?.name ?? c.workspacePath.split("/").pop()}
                  </div>
                  <div className="sub">{ws?.branch ?? (ws ? `detached ${ws.head}` : "")}</div>
                </div>
                <div className="cell">
                  <span className="cap">FLIGHT 편</span>
                  {ws?.ticketKey ? (
                    <>
                      <a
                        className="val big"
                        href={ticket?.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        title={ws.ticketKey}
                      >
                        {flightNumber(ws.ticketKey)}
                      </a>
                      {ticket && <div className="sub">{flightPhase(ticket)}</div>}
                    </>
                  ) : (
                    <div className="val big none">—</div>
                  )}
                </div>
                <div className="cell cell-route">
                  <span className="cap">ROUTE 목적지</span>
                  <div className="route" title={ticket?.title}>
                    {ticket?.title ?? <span className="none">티켓 없음</span>}
                  </div>
                </div>
                <div className="cell">
                  <span className="cap">LAST 교신</span>
                  <div className="val">{formatClock(c.lastAt, clock)}</div>
                  <div className="sub">{timeAgo(c.lastAt, now)}</div>
                </div>
                <div className="cell cell-remarks">
                  {others.length > 0 && (
                    <span className="stamp red" title={`${others.join(", ")}와 같은 주기장`}>
                      LOS {others.join(", ")}
                    </span>
                  )}
                  {c.state === "handed-off" && (
                    <span className="stamp blue">→ {c.handedOffTo ? nameOf(c.handedOffTo) : "?"} 이양</span>
                  )}
                  {ws && s.repo && ws.repo !== s.repo && c.state === "active" && (
                    <span className="stamp away" title="소속 공항 밖 주기장">원정</span>
                  )}
                  {ws?.dirty ? <span className="stamp amber">Δ {ws.dirty}</span> : null}
                  {c.source === "transcript" && <span className="stamp dashed">추정 항적</span>}
                  {c.source === "cwd" && <span className="stamp dashed">CWD</span>}
                </div>
              </div>
            );
          })
        ) : (
          <div className="leg is-empty">
            <div className="cell">
              <span className="cap">STAND 주기장</span>
              <div className="sub">배정된 주기장 없음</div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

const OVERDUE_MS = 10 * 60_000;
const RECENT_READBACK_MS = 30 * 60_000;

// 관제 지시: 복창 대기(파랑), 10분 넘게 미복창(주황), 최근 30분 안에 복창 받음(점선)
function ClearanceStamps({ clearances, now }: { clearances: Clearance[]; now: number }) {
  const { clock } = useSettings();
  const shown = clearances.filter(
    (c) => !c.cancelledAt && (!c.readbackAt || now - Date.parse(c.readbackAt) < RECENT_READBACK_MS),
  );
  if (!shown.length) return null;
  return (
    <div className="sub">
      {shown.map((c) => {
        const overdue = !c.readbackAt && now - Date.parse(c.at) > OVERDUE_MS;
        const tone = c.readbackAt ? "dashed" : overdue ? "amber" : "blue";
        const state = c.readbackAt ? "복창" : overdue ? "미복창" : "복창 대기";
        return (
          <span key={c.id} className={`stamp ${tone}`} title={`${c.text}\n${formatClock(c.at, clock)} 발부 · ${state}`}>
            {c.id} {c.type} · {state}
          </span>
        );
      })}
    </div>
  );
}
