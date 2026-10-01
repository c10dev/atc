import type { Airport, Session } from "../../server/model.ts";
import { pendingNeedsOf } from "../../server/pending.ts";
import type { Job } from "../../server/job-state.ts";
import { type Activity, activityParts } from "../../server/activity.ts";
import { standNeedsHint } from "../../server/stand-hint.ts";
import { callsign } from "./aviation.ts";
import { type Index, sessionLocation } from "./derive.ts";
import "./ui.css";

// 저장소 = AIRPORT 코드(대문자 4자). 마우스를 올리면 저장소 이름과 경로.
// plain: 툴팁 없이(FIDS처럼 줄마다 붙는 곳. 저장소 경로는 숫자뿐인 툴팁이라 화면에 두지 않는다)
export function AirportCode({ airport, plain = false }: { airport: Airport | null | undefined; plain?: boolean }) {
  if (!airport) return null;
  return (
    <span className="apt" title={plain ? undefined : `${airport.name} (${airport.repo})`}>
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
// attach: 카드가 복사하는 것과 같은 명령(ATC-301, 기본이 아닌 폴더면 CLAUDE_CONFIG_DIR가 붙는다). 모르면 `claude attach <id>`
export function NeedsYou({ job, attach, className = "" }: { job: Job | null | undefined; attach?: string | null; className?: string }) {
  if (job?.state !== "blocked") return null;
  return (
    <span className={`needs-you mono ${className}`.trim()} title={[job.detail, job.since ? `since ${job.since.slice(11, 16)}Z` : "", `SUPERVISOR가 \`${attach || "claude attach <id>"}\`로 붙어 답하거나 메시지를 보낸다`].filter(Boolean).join(" — ")}>
      NEEDS YOU{job.needs ? <span className="needs-you-text"> · {job.needs}</span> : null}
      {standNeedsHint(job.needs) ? <span className="needs-you-text"> · {standNeedsHint(job.needs)}</span> : null}
    </span>
  );
}

// PENDING approval(ATC-327): 세션이 도구 승인 프롬프트에 서 있고 Claude Code가 청하는 것을 적어 두었으면(state가 working이어도) 그 한 줄을 보인다.
// NEEDS YOU와 같은 모양, 색은 --blue(사람의 결정을 기다림, 오류가 아님). attach: 카드가 복사하는 것과 같은 명령. 읽기만 한다 — 승인은 SUPERVISOR가 그 세션에서 한다
export function PendingApproval({ job, health, attach, className = "" }: { job: Job | null | undefined; health?: { code: string } | null; attach?: string | null; className?: string }) {
  const needs = pendingNeedsOf({ health, job });
  if (!needs) return null;
  return (
    <span className={`needs-you is-pending mono ${className}`.trim()} title={`SUPERVISOR가 \`${attach || "claude attach <id>"}\`로 붙어 승인하거나 거절한다`}>
      PENDING<span className="needs-you-text"> · {needs}</span>
    </span>
  );
}

// ACTIVITY(ATC-97): "Bash · Run the test suite · 12s". 도구가 돌면 tool, 모델 대기는 model, idle은 흐리게. 본문은 없다
const PHASE_TIP = { tool: "도구 실행 중", model: "도구 결과 뒤 모델 응답 대기", idle: "턴이 끝나 쉬는 중" } as const;
export function ActivityLine({ activity, now, className = "" }: { activity: Activity | null | undefined; now: number; className?: string }) {
  if (!activity) return null;
  const { what, ago } = activityParts(activity, now);
  return (
    <span className={`activity is-${activity.phase} ${className}`.trim()} title={`ACTIVITY — ${PHASE_TIP[activity.phase]}\n${what ? `${what} · ` : ""}${ago}`}>
      <span className="activity-dot" aria-hidden="true" />
      {what && <span className="activity-what">{what}</span>}
      <span className="activity-ago">{what ? " · " : ""}{ago}</span>
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
