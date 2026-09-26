import type { Airport, Session } from "../../server/model.ts";
import { callsign } from "./aviation.ts";
import { type Index, sessionLocation } from "./derive.ts";
import "./ui.css";

// 저장소 = AIRPORT 코드(대문자 4자). 마우스를 올리면 저장소 이름과 경로.
export function AirportCode({ airport }: { airport: Airport | null | undefined }) {
  if (!airport) return null;
  return (
    <span className="apt" title={`${airport.name} (${airport.repo})`}>
      {airport.code}
    </span>
  );
}

// OUTSTATION: 소속 AIRPORT 밖 STAND를 점유 중일 때 "OUTSTATION TNNS"
export function AwayTag({ airports }: { airports: Airport[] | undefined }) {
  if (!airports?.length) return null;
  return (
    <span className="away-tag" title="소속 AIRPORT 밖 STAND에서 작업 중">
      OUTSTATION
      {airports.map((a) => (
        <AirportCode key={a.id} airport={a} />
      ))}
    </span>
  );
}

// 세션 위치: "VCDO TWR"(본 체크아웃), "VCDO vocado-voc-187"(워크트리), 저장소 밖이면 폴더 이름.
export function SessionPlace({ session, idx }: { session: Session; idx: Index }) {
  const { airport, place } = sessionLocation(session, idx);
  return (
    <>
      <AirportCode airport={airport} /> {place}
    </>
  );
}

const statusLabel = { busy: "AIRBORNE", idle: "대기", dead: "NORDO" } as const;

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

// Linear 우선순위: 1 긴급, 2 높음, 3 보통, 4 낮음.
const PRIORITY = [
  null,
  { code: "URG", label: "긴급" },
  { code: "HIGH", label: "높음" },
  { code: "MED", label: "보통" },
  { code: "LOW", label: "낮음" },
];

export function PriorityMark({ priority }: { priority: number }) {
  const p = PRIORITY[priority];
  if (!p) return null;
  return (
    <span className={`prio prio-${priority}`} title={`우선순위 ${p.label}`} aria-label={`우선순위 ${p.label}`}>
      {p.code}
    </span>
  );
}
