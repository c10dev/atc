import type { Airport, Session } from "../../server/model.ts";
import type { Job } from "../../server/job-state.ts";
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

// NEEDS YOU(ATC-99): 백그라운드 job이 blocked면 사람의 답을 기다린다. needs가 글, detail은 툴팁. 읽기만 한다
export function NeedsYou({ job, className = "" }: { job: Job | null | undefined; className?: string }) {
  if (job?.state !== "blocked") return null;
  return (
    <span className={`needs-you mono ${className}`.trim()} title={[job.detail, job.since ? `since ${job.since.slice(11, 16)}Z` : "", "SUPERVISOR가 `claude attach <id>`로 붙어 답하거나 메시지를 보낸다"].filter(Boolean).join(" — ")}>
      NEEDS YOU{job.needs ? <span className="needs-you-text"> · {job.needs}</span> : null}
    </span>
  );
}

// working 중인 백그라운드 job의 한 줄(Claude Code가 적은 detail)
export function JobDetail({ job }: { job: Job | null | undefined }) {
  if (job?.state !== "working") return null;
  const st = job.settled;
  if (st) {
    // ATC-133: 파일은 blocked로 남았지만 이미 일하는 job. 파일의 원래 모습을 툴팁에 남긴다
    const hm = (t: string | null) => (t ? `${t.slice(11, 16)}Z` : "");
    const tip = `job 파일은 blocked${st.since ? ` since ${hm(st.since)}` : ""}${st.resumedAt ? `, working since ${hm(st.resumedAt)}` : ""}${st.reason === "tempo" ? " (tempo active)" : " (이후 턴 있음)"}`;
    return <span className="job-detail faint" title={tip}>working</span>;
  }
  if (!job.detail) return null;
  return <span className="job-detail faint" title="백그라운드 job의 detail(Claude Code가 적음)">{job.detail}</span>;
}

// suggestedReply: 복사만 한다. atc는 어디에도 보내지 않는다
export function SuggestedReply({ job }: { job: Job | null | undefined }) {
  if (job?.state !== "blocked" || !job.suggestedReply) return null;
  const copy = () => void navigator.clipboard?.writeText(job.suggestedReply!).catch(() => {});
  return (
    <p className="needs-you-reply" title="Claude Code가 제안한 답. atc는 보내지 않는다 — 복사해서 그 세션에 직접 붙여 넣는다">
      <span className="faint">제안된 답 </span>
      <code>{job.suggestedReply}</code>{" "}
      <button type="button" className="needs-you-copy" onClick={copy}>
        복사
      </button>
    </p>
  );
}
